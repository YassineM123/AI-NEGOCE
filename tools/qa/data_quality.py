"""Executable data-quality validation for an AI-NEGOCE canonical dataset (CSV export).

Independent of the TypeScript application: uses Python Decimal and reads raw CSV.
Usage: python tools/qa/data_quality.py [dataset_dir] [--json out.json] [--md out.md]
Exit code 1 when any check fails.
"""
from __future__ import annotations

import csv
import json
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path

M = Decimal("0.001")
VAT_RATES = {0, 7, 13, 19}


def load(ds: Path):
    return {p.stem: list(csv.DictReader(p.open(encoding="utf-8"))) for p in sorted((ds / "csv").glob("*.csv"))}


def dec(v):
    return Decimal(v)


def rhu(x: Decimal) -> Decimal:
    return x.quantize(M, rounding=ROUND_HALF_UP)


class Report:
    def __init__(self):
        self.checks = []

    def check(self, name, category, table, rows, predicate, expected, actual_fn=None, key="id"):
        failed = []
        tested = 0
        for r in rows:
            tested += 1
            try:
                ok = predicate(r)
            except (InvalidOperation, ValueError, KeyError, TypeError) as e:
                ok, r = False, {**r, "_error": type(e).__name__}
            if not ok:
                failed.append(r)
        example = None
        actual = "as expected"
        if failed:
            f = failed[0]
            example = {k: f[k] for k in list(f)[:8]}
            try:
                actual = actual_fn(f) if actual_fn and "_error" not in f else f.get("_error", "predicate false")
            except (InvalidOperation, ValueError, KeyError, TypeError) as e:
                actual = type(e).__name__
        self.checks.append({"check": name, "category": category, "table": table, "tested": tested, "failed": len(failed), "expected": expected, "actual": actual, "example": example})


def run(ds: Path):
    t = load(ds)
    R = Report()
    ids = {name: {r[next(iter(r))] for r in rows} for name, rows in t.items()}
    # ---- primary keys
    for name, rows in t.items():
        pk = "sales_invoice_id" if name == "receivables" else ("product_id" if name == "inventory" else next(iter(rows[0])))
        keyf = (lambda r: (r["product_id"], r["agency_id"])) if name == "inventory" else (lambda r, pk=pk: r[pk])
        counts = Counter(keyf(r) for r in rows)
        R.check(f"{name}: unique primary key", "duplicate_primary_key", name, rows, lambda r, c=counts, k=keyf: c[k(r)] == 1, "every key appears once", lambda r, c=counts, k=keyf: f"key {k(r)} appears {c[k(r)]} times")
    # ---- foreign keys
    fks = [
        ("representatives", "agency_id", "agencies"), ("customers", "agency_id", "agencies"), ("customers", "representative_id", "representatives"),
        ("products", "category_id", "product_categories"), ("products", "supplier_id", "suppliers"),
        ("purchase_orders", "supplier_id", "suppliers"), ("purchase_orders", "agency_id", "agencies"),
        ("purchase_order_lines", "purchase_order_id", "purchase_orders"), ("purchase_order_lines", "product_id", "products"),
        ("supplier_invoices", "supplier_id", "suppliers"), ("supplier_invoices", "purchase_order_id", "purchase_orders"), ("supplier_invoices", "agency_id", "agencies"),
        ("supplier_invoice_lines", "supplier_invoice_id", "supplier_invoices"), ("supplier_invoice_lines", "product_id", "products"),
        ("sales_invoices", "customer_id", "customers"), ("sales_invoices", "agency_id", "agencies"), ("sales_invoices", "representative_id", "representatives"), ("sales_invoices", "original_invoice_id", "sales_invoices"),
        ("sales_invoice_lines", "sales_invoice_id", "sales_invoices"), ("sales_invoice_lines", "product_id", "products"),
        ("payments", "sales_invoice_id", "sales_invoices"), ("payments", "customer_id", "customers"),
        ("receivables", "sales_invoice_id", "sales_invoices"), ("stock_movements", "product_id", "products"), ("stock_movements", "agency_id", "agencies"),
        ("inventory", "product_id", "products"), ("inventory", "agency_id", "agencies"),
    ]
    for table, col, ref in fks:
        R.check(f"{table}.{col} -> {ref}", "broken_foreign_key", table, t[table], lambda r, c=col, ref=ref: r[c] == "" and c in ("purchase_order_id", "original_invoice_id") or r[c] in ids[ref], f"{col} references an existing {ref}", lambda r, c=col: f"{c}={r[c]!r} not found")
    # ---- required values & types
    required = {"sales_invoices": ["number", "customer_id", "agency_id", "invoice_date", "total_ht"], "supplier_invoices": ["supplier_invoice_number", "supplier_id", "invoice_date"], "products": ["name", "unit_cost", "list_price"], "customers": ["name", "agency_id"], "payments": ["amount", "payment_date"]}
    for table, cols in required.items():
        R.check(f"{table}: required fields present", "missing_value", table, t[table], lambda r, cols=cols: all(r[c] != "" for c in cols), f"non-empty {', '.join(cols)}", lambda r, cols=cols: f"empty: {[c for c in cols if r[c] == '']}")
    money_cols = {"sales_invoices": ["total_ht", "total_vat", "total_ttc", "stamp_duty", "total_cost"], "sales_invoice_lines": ["unit_price", "line_ht", "line_vat", "unit_cost", "line_cost"], "supplier_invoices": ["total_ht", "total_vat", "total_ttc"], "payments": ["amount"], "products": ["unit_cost", "list_price"]}
    for table, cols in money_cols.items():
        R.check(f"{table}: monetary values are non-negative 3-decimal numbers", "invalid_numeric", table, t[table], lambda r, cols=cols: all(dec(r[c]) >= 0 and dec(r[c]) == rhu(dec(r[c])) for c in cols), "decimal >= 0 with <= 3 decimals")
    R.check("payments: amount strictly positive", "invalid_numeric", "payments", t["payments"], lambda r: dec(r["amount"]) > 0, "> 0")
    for table in ["sales_invoice_lines", "supplier_invoice_lines", "purchase_order_lines"]:
        R.check(f"{table}: integer positive quantity", "invalid_type", table, t[table], lambda r: str(int(r["quantity"])) == r["quantity"] and int(r["quantity"]) > 0, "integer > 0")
        if table != "purchase_order_lines":
            R.check(f"{table}: VAT rate in scenario set {{0,7,13,19}}", "invalid_numeric", table, t[table], lambda r: int(r["vat_rate"]) in VAT_RATES, "vat_rate in {0,7,13,19}")
    R.check("stock_movements: quantity is a non-zero integer", "invalid_type", "stock_movements", t["stock_movements"], lambda r: int(r["quantity"]) != 0, "integer != 0")
    # ---- dates
    start, end = date(2025, 1, 1), date(2026, 6, 30)
    d = date.fromisoformat
    R.check("sales_invoices: date within dataset period, due >= issue", "invalid_date", "sales_invoices", t["sales_invoices"], lambda r: start <= d(r["invoice_date"]) <= end and d(r["due_date"]) >= d(r["invoice_date"]), f"{start} <= date <= {end}; due_date >= invoice_date")
    R.check("supplier_invoices: due >= issue", "invalid_date", "supplier_invoices", t["supplier_invoices"], lambda r: d(r["due_date"]) >= d(r["invoice_date"]), "due_date >= invoice_date")
    inv_by_id = {r["id"]: r for r in t["sales_invoices"]}
    R.check("payments: paid on/after invoice date and not after as-of", "invalid_date", "payments", t["payments"], lambda r: d(inv_by_id[r["sales_invoice_id"]]["invoice_date"]) <= d(r["payment_date"]) <= end, "invoice_date <= payment_date <= as-of")
    po_by_id = {r["id"]: r for r in t["purchase_orders"]}
    R.check("supplier_invoices: invoice on/after purchase order date", "invalid_date", "supplier_invoices", [r for r in t["supplier_invoices"] if r["purchase_order_id"]], lambda r: d(r["invoice_date"]) >= d(po_by_id[r["purchase_order_id"]]["order_date"]), "invoice_date >= order_date")
    # ---- invoice arithmetic (sales)
    lines_by_inv = defaultdict(list)
    for l in t["sales_invoice_lines"]:
        lines_by_inv[l["sales_invoice_id"]].append(l)
    R.check("sales_invoice_lines: line HT = qty x price x (1 - discount)", "financial_reconciliation", "sales_invoice_lines", t["sales_invoice_lines"], lambda l: rhu(int(l["quantity"]) * dec(l["unit_price"]) * (100 - dec(l["discount_pct"])) / 100) == dec(l["line_ht"]), "exact to the millime (half-up)", lambda l: f"computed {rhu(int(l['quantity']) * dec(l['unit_price']) * (100 - dec(l['discount_pct'])) / 100)} vs {l['line_ht']}")
    R.check("sales_invoice_lines: line VAT = HT x rate", "financial_reconciliation", "sales_invoice_lines", t["sales_invoice_lines"], lambda l: rhu(dec(l["line_ht"]) * int(l["vat_rate"]) / 100) == dec(l["line_vat"]), "exact to the millime")
    R.check("sales_invoice_lines: line cost = qty x unit cost", "financial_reconciliation", "sales_invoice_lines", t["sales_invoice_lines"], lambda l: int(l["quantity"]) * dec(l["unit_cost"]) == dec(l["line_cost"]), "exact")
    R.check("sales_invoices: header totals = sum of lines (+ stamp)", "invoice_totals", "sales_invoices", t["sales_invoices"], lambda r: sum(dec(l["line_ht"]) for l in lines_by_inv[r["id"]]) == dec(r["total_ht"]) and sum(dec(l["line_vat"]) for l in lines_by_inv[r["id"]]) == dec(r["total_vat"]) and dec(r["total_ht"]) + dec(r["total_vat"]) + dec(r["stamp_duty"]) == dec(r["total_ttc"]) and sum(dec(l["line_cost"]) for l in lines_by_inv[r["id"]]) == dec(r["total_cost"]), "HT, VAT, cost reconcile; TTC = HT + VAT + stamp", lambda r: f"lines HT {sum(dec(l['line_ht']) for l in lines_by_inv[r['id']])} vs header {r['total_ht']}")
    R.check("sales_invoices: every document has >= 1 line (orphan header)", "orphaned_record", "sales_invoices", t["sales_invoices"], lambda r: len(lines_by_inv[r["id"]]) > 0, ">= 1 line")
    sil_by_inv = defaultdict(list)
    for l in t["supplier_invoice_lines"]:
        sil_by_inv[l["supplier_invoice_id"]].append(l)
    R.check("supplier_invoices: header totals = sum of lines", "invoice_totals", "supplier_invoices", t["supplier_invoices"], lambda r: sum(dec(l["line_ht"]) for l in sil_by_inv[r["id"]]) == dec(r["total_ht"]) and sum(dec(l["line_vat"]) for l in sil_by_inv[r["id"]]) == dec(r["total_vat"]) and dec(r["total_ht"]) + dec(r["total_vat"]) == dec(r["total_ttc"]) and len(sil_by_inv[r["id"]]) > 0, "HT/VAT reconcile; TTC = HT + VAT")
    seen = Counter((r["supplier_id"], r["supplier_invoice_number"]) for r in t["supplier_invoices"])
    R.check("supplier_invoices: (supplier, number) unique — duplicate invoice detection", "duplicate_invoice", "supplier_invoices", t["supplier_invoices"], lambda r: seen[(r["supplier_id"], r["supplier_invoice_number"])] == 1, "unique per supplier")
    nums = Counter(r["number"] for r in t["sales_invoices"])
    R.check("sales_invoices: document number unique", "duplicate_invoice", "sales_invoices", t["sales_invoices"], lambda r: nums[r["number"]] == 1, "unique")
    # PO consistency
    pol = defaultdict(Counter)
    for l in t["purchase_order_lines"]:
        pol[l["purchase_order_id"]][l["product_id"]] += int(l["quantity"])
    inv_q = defaultdict(Counter)
    for r in t["supplier_invoices"]:
        if r["purchase_order_id"]:
            for l in sil_by_inv[r["id"]]:
                inv_q[r["purchase_order_id"]][l["product_id"]] += int(l["quantity"])
    R.check("supplier_invoices: same supplier as its purchase order", "referential_integrity", "supplier_invoices", [r for r in t["supplier_invoices"] if r["purchase_order_id"]], lambda r: po_by_id[r["purchase_order_id"]]["supplier_id"] == r["supplier_id"], "supplier matches PO")
    R.check("purchase_orders: invoiced quantity <= ordered quantity", "referential_integrity", "purchase_orders", t["purchase_orders"], lambda r: all(q <= pol[r["id"]][p] for p, q in inv_q[r["id"]].items()), "never over-invoiced")
    # ---- credit notes
    cns = [r for r in t["sales_invoices"] if r["doc_type"] == "credit_note"]
    def cn_ok(r):
        o = inv_by_id[r["original_invoice_id"]]
        orig_q = Counter()
        for l in lines_by_inv[o["id"]]:
            orig_q[l["product_id"]] += int(l["quantity"])
        return o["status"] == "posted" and o["doc_type"] == "invoice" and o["customer_id"] == r["customer_id"] and r["invoice_date"] >= o["invoice_date"] and all(int(l["quantity"]) <= orig_q[l["product_id"]] for l in lines_by_inv[r["id"]])
    R.check("credit notes: reference a posted invoice of the same customer; returned qty <= sold qty", "referential_integrity", "sales_invoices", cns, cn_ok, "valid original invoice")
    # ---- payments & receivables
    paid = defaultdict(Decimal)
    for p in t["payments"]:
        paid[p["sales_invoice_id"]] += dec(p["amount"])
    credited = defaultdict(Decimal)
    for c in cns:
        credited[c["original_invoice_id"]] += dec(c["total_ttc"])
    R.check("payments: linked to a posted (non-cancelled) invoice of the same customer", "referential_integrity", "payments", t["payments"], lambda p: inv_by_id[p["sales_invoice_id"]]["status"] == "posted" and inv_by_id[p["sales_invoice_id"]]["doc_type"] == "invoice" and inv_by_id[p["sales_invoice_id"]]["customer_id"] == p["customer_id"], "posted invoice, same customer")
    R.check("sales_invoices: payments + credits never exceed TTC", "payment_balance", "sales_invoices", [r for r in t["sales_invoices"] if r["doc_type"] == "invoice"], lambda r: paid[r["id"]] + credited[r["id"]] <= dec(r["total_ttc"]), "no over-payment", lambda r: f"paid {paid[r['id']]} + credited {credited[r['id']]} > {r['total_ttc']}")
    R.check("receivables: outstanding = TTC - credits - payments", "payment_balance", "receivables", t["receivables"], lambda r: dec(r["outstanding"]) == dec(inv_by_id[r["sales_invoice_id"]]["total_ttc"]) - credited[r["sales_invoice_id"]] - paid[r["sales_invoice_id"]] and dec(r["paid"]) == paid[r["sales_invoice_id"]] and dec(r["credited_ttc"]) == credited[r["sales_invoice_id"]], "exact reconciliation")
    R.check("receivables: status consistent with balance", "payment_balance", "receivables", t["receivables"], lambda r: (r["status"] == "settled") == (dec(r["outstanding"]) == 0) and (r["status"] != "partially_paid" or dec(r["paid"]) > 0), "settled <=> outstanding = 0")
    posted_inv = {r["id"] for r in t["sales_invoices"] if r["status"] == "posted" and r["doc_type"] == "invoice"}
    rec_ids = {r["sales_invoice_id"] for r in t["receivables"]}
    R.check("receivables: one row per posted invoice", "orphaned_record", "sales_invoices", [r for r in t["sales_invoices"] if r["id"] in posted_inv], lambda r: r["id"] in rec_ids, "receivable exists")
    cancelled = {r["id"] for r in t["sales_invoices"] if r["status"] == "cancelled"}
    # ---- stock
    mv_by_key = defaultdict(int)
    for m in t["stock_movements"]:
        mv_by_key[(m["product_id"], m["agency_id"])] += int(m["quantity"])
    R.check("inventory: current = opening + sum(movements)", "inventory_movements", "inventory", t["inventory"], lambda r: int(r["current_quantity"]) == int(r["opening_quantity"]) + mv_by_key[(r["product_id"], r["agency_id"])], "exact", key="product_id")
    opening = {(r["product_id"], r["agency_id"]): int(r["opening_quantity"]) for r in t["inventory"]}
    running, negatives = defaultdict(int), []
    for m in sorted(t["stock_movements"], key=lambda m: m["id"]):
        k = (m["product_id"], m["agency_id"])
        running[k] += int(m["quantity"])
        if opening.get(k, 0) + running[k] < 0:
            negatives.append(m)
    neg_ids = {m["id"] for m in negatives}
    R.check("stock_movements: running balance never negative", "inventory_movements", "stock_movements", t["stock_movements"], lambda m: m["id"] not in neg_ids, "balance >= 0 at every movement")
    sale_mv = Counter()
    for m in t["stock_movements"]:
        if m["type"] == "sale":
            sale_mv[(m["reference"], m["product_id"])] -= int(m["quantity"])
    R.check("stock_movements: every posted invoice line has a matching sale movement; cancelled invoices move no stock", "inventory_movements", "sales_invoice_lines", [l for l in t["sales_invoice_lines"] if inv_by_id.get(l["sales_invoice_id"], {}).get("doc_type", "invoice") == "invoice"], lambda l: sale_mv[(l["sales_invoice_id"], l["product_id"])] == (0 if l["sales_invoice_id"] in cancelled else int(l["quantity"])), "1:1 quantity match")
    tr = defaultdict(int)
    for m in t["stock_movements"]:
        if m["type"].startswith("transfer"):
            tr[m["reference"]] += int(m["quantity"])
    R.check("stock_movements: transfers net to zero", "inventory_movements", "stock_movements", [m for m in t["stock_movements"] if m["type"].startswith("transfer")], lambda m: tr[m["reference"]] == 0, "out + in = 0")
    # ---- agency consistency (cross-agency integrity)
    cust = {r["id"]: r for r in t["customers"]}
    rep = {r["id"]: r for r in t["representatives"]}
    R.check("sales_invoices: customer and representative belong to the invoice agency", "cross_agency_integrity", "sales_invoices", t["sales_invoices"], lambda r: cust[r["customer_id"]]["agency_id"] == r["agency_id"] and rep[r["representative_id"]]["agency_id"] == r["agency_id"], "same agency")
    R.check("customers: representative belongs to customer agency", "cross_agency_integrity", "customers", t["customers"], lambda r: rep[r["representative_id"]]["agency_id"] == r["agency_id"], "same agency")
    return R.checks


def write_md(checks, ds: Path, out: Path):
    failed = [c for c in checks if c["failed"]]
    total = sum(c["tested"] for c in checks)
    lines = [f"| {c['check']} | {c['category']} | {c['table']} | {c['tested']:,} | {c['failed']:,} | {c['expected']} | {c['actual']} |" for c in checks]
    out.write_text("\n".join([
        f"<!-- generated by tools/qa/data_quality.py on {datetime.now(timezone.utc).isoformat(timespec='seconds')} for {ds.as_posix()} -->",
        f"**{len(checks)} checks, {total:,} record evaluations, {len(failed)} failing checks.**", "",
        "| Check | Category | Table | Tested | Failed | Expected | Actual |", "|---|---|---|---:|---:|---|---|", *lines, "",
        *(f"- Example failing record for `{c['check']}`: `{json.dumps(c['example'], ensure_ascii=False)}`" for c in failed),
    ]) + "\n", encoding="utf-8")


if __name__ == "__main__":
    args = sys.argv[1:]
    ds = Path(args[0]) if args and not args[0].startswith("--") else Path("datasets/synthetic/v1")
    checks = run(ds)
    if "--json" in args:
        Path(args[args.index("--json") + 1]).write_text(json.dumps(checks, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    if "--md" in args:
        write_md(checks, ds, Path(args[args.index("--md") + 1]))
    bad = [c for c in checks if c["failed"]]
    for c in checks:
        print(f"{'FAIL' if c['failed'] else 'ok  '} {c['tested']:>7} {c['failed']:>6}  {c['check']}")
    print(f"{len(checks)} checks, {len(bad)} failing")
    sys.exit(1 if bad else 0)
