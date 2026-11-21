"""Independent BI oracle: computes expected KPIs from the raw canonical CSV dataset
with Decimal arithmetic. It shares no code with server/services.ts.

KPI definitions (QA assumptions v1 — to be validated by the business):
  revenue        = sum(total_ht posted invoices) - sum(total_ht posted credit notes), by document date
  cost           = sum(line_cost invoices) - sum(line_cost credit notes); cancelled documents excluded
  grossMargin    = revenue - cost ; grossMarginPercent = margin / revenue * 100, null when revenue = 0
  receivables    = sum(outstanding TTC) of posted invoices dated in the period (as of dataset as-of date)
  overdue        = part of receivables whose due_date < as-of
  inventoryValue = sum(current_quantity * unit_cost) for the agency scope (not date filtered)
  lowStock       = inventory rows with current_quantity <= reorder_point
  dormantStock   = rows with current_quantity > 0 and no sale movement in the 180 days before as-of
  recordCount    = number of posted documents (invoices + credit notes) in the period

Usage: python tools/qa/bi_oracle.py [dataset_dir] [out.json]
"""
import csv
import json
import sys
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

ds = Path(sys.argv[1] if len(sys.argv) > 1 else "datasets/synthetic/v1")
out = Path(sys.argv[2] if len(sys.argv) > 2 else "reports/evidence/bi_expected.json")
T = {p.stem: list(csv.DictReader(p.open(encoding="utf-8"))) for p in (ds / "csv").glob("*.csv")}
AS_OF = "2026-06-30"
agency_name = {a["id"]: a["name"] for a in T["agencies"]}
customer_name = {c["id"]: c["name"] for c in T["customers"]}
product_name = {p["id"]: p["name"] for p in T["products"]}
D = Decimal
lines_by_doc = defaultdict(list)
for l in T["sales_invoice_lines"]:
    lines_by_doc[l["sales_invoice_id"]].append(l)
rec_by_inv = {r["sales_invoice_id"]: r for r in T["receivables"]}
last_sale = {}
for m in T["stock_movements"]:
    if m["type"] == "sale":
        k = (m["product_id"], m["agency_id"])
        last_sale[k] = max(last_sale.get(k, ""), m["date"])
dormant_cutoff = (date.fromisoformat(AS_OF) - timedelta(days=180)).isoformat()


def s(x):
    return None if x is None else f"{x:.3f}"


def kpis(agencies=None, frm=None, to=None):
    docs = [d for d in T["sales_invoices"] if d["status"] == "posted" and (agencies is None or agency_name[d["agency_id"]] in agencies) and (frm is None or d["invoice_date"] >= frm) and (to is None or d["invoice_date"] <= to)]
    revenue = cost = receivables = overdue = D(0)
    by_agency = defaultdict(lambda: {"revenue": D(0), "cost": D(0)})
    by_customer = defaultdict(lambda: {"revenue": D(0), "cost": D(0)})
    by_product = defaultdict(lambda: {"revenue": D(0), "cost": D(0)})
    for d in docs:
        sign = -1 if d["doc_type"] == "credit_note" else 1
        revenue += sign * D(d["total_ht"])
        cost += sign * D(d["total_cost"])
        a = agency_name[d["agency_id"]]
        by_agency[a]["revenue"] += sign * D(d["total_ht"])
        by_agency[a]["cost"] += sign * D(d["total_cost"])
        by_customer[d["customer_id"]]["revenue"] += sign * D(d["total_ht"])
        by_customer[d["customer_id"]]["cost"] += sign * D(d["total_cost"])
        for l in lines_by_doc[d["id"]]:
            by_product[l["product_id"]]["revenue"] += sign * D(l["line_ht"])
            by_product[l["product_id"]]["cost"] += sign * D(l["line_cost"])
        if d["doc_type"] == "invoice":
            r = rec_by_inv[d["id"]]
            receivables += D(r["outstanding"])
            if r["due_date"] < AS_OF:
                overdue += D(r["outstanding"])
    inv = [i for i in T["inventory"] if agencies is None or agency_name[i["agency_id"]] in agencies]
    margin = revenue - cost
    top = lambda g: max(g.items(), key=lambda kv: (kv[1]["revenue"], kv[0]))[0] if g else None
    return {
        "revenue": s(revenue), "cost": s(cost), "grossMargin": s(margin),
        "grossMarginPercent": None if revenue == 0 else f"{(margin / revenue * 100):.4f}",
        "receivables": s(receivables), "overdue": s(overdue),
        "inventoryValue": s(sum((int(i["current_quantity"]) * D(i["unit_cost"]) for i in inv), D(0))),
        "lowStockCount": sum(1 for i in inv if int(i["current_quantity"]) <= int(i["reorder_point"])),
        "dormantStockCount": sum(1 for i in inv if int(i["current_quantity"]) > 0 and last_sale.get((i["product_id"], i["agency_id"]), "") < dormant_cutoff),
        "recordCount": len(docs),
        "invoiceCount": sum(1 for d in docs if d["doc_type"] == "invoice"),
        "creditNoteCount": sum(1 for d in docs if d["doc_type"] == "credit_note"),
        "byAgency": {k: {"revenue": s(v["revenue"]), "margin": s(v["revenue"] - v["cost"])} for k, v in sorted(by_agency.items())},
        # grouped by customer/product ID (names are not unique); reported as display name
        "topCustomer": customer_name[top(by_customer)] if by_customer else None,
        "topCustomerRevenue": s(by_customer[top(by_customer)]["revenue"]) if by_customer else None,
        "topProduct": product_name[top(by_product)] if by_product else None,
    }


AG = sorted(agency_name.values())
scenarios = [{"id": "all", "agencies": None}]
scenarios += [{"id": f"agency:{a}", "agencies": [a]} for a in AG]
scenarios += [
    {"id": "year:2025", "from": "2025-01-01", "to": "2025-12-31"},
    {"id": "h1:2026", "from": "2026-01-01", "to": "2026-06-30"},
    {"id": "month:2025-02", "from": "2025-02-01", "to": "2025-02-28"},
    {"id": "day:2025-03-15", "from": "2025-03-15", "to": "2025-03-15"},
    {"id": "empty:2024", "from": "2024-01-01", "to": "2024-12-31"},
    {"id": "Sfax:q4-2025", "agencies": ["Sfax"], "from": "2025-10-01", "to": "2025-12-31"},
    {"id": "Tunis Centre:2026-03", "agencies": ["Tunis Centre"], "from": "2026-03-01", "to": "2026-03-31"},
    {"id": "scope:Tunis Centre+Sfax", "agencies": ["Tunis Centre", "Sfax"]},
]
result = {"asOf": AS_OF, "dataset": str(ds.as_posix()), "scenarios": []}
for sc in scenarios:
    result["scenarios"].append({**sc, "expected": kpis(sc.get("agencies"), sc.get("from"), sc.get("to"))})
# property: agency totals reconcile with company total
total = D(result["scenarios"][0]["expected"]["revenue"])
agency_sum = sum(D(x["expected"]["revenue"]) for x in result["scenarios"][1:6])
result["properties"] = {"agencyRevenueSumEqualsCompany": agency_sum == total, "agencyRevenueSum": s(agency_sum), "companyRevenue": s(total)}
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
print(json.dumps({k: v for k, v in result["scenarios"][0]["expected"].items() if k not in ("byAgency",)}, ensure_ascii=False))
print("properties:", result["properties"])
