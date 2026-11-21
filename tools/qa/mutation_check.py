"""Mutation test for tools/qa/data_quality.py: injects known defects into a COPY of the
dataset and asserts each one is detected by the expected check category.
Usage: python tools/qa/mutation_check.py [dataset_dir] [--json out.json]
"""
import csv
import json
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import data_quality  # noqa: E402


def rw(path: Path, mutate):
    rows = list(csv.DictReader(path.open(encoding="utf-8")))
    cols = list(rows[0])
    mutate(rows)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, cols)
        w.writeheader()
        w.writerows(rows)


MUTATIONS = [
    ("duplicate customer id", "customers", lambda r: r.append(dict(r[0])), "duplicate_primary_key"),
    ("orphan invoice line (unknown invoice)", "sales_invoice_lines", lambda r: r[5].update(sales_invoice_id="SV-99999"), "broken_foreign_key"),
    ("missing invoice number", "sales_invoices", lambda r: r[3].update(number=""), "missing_value"),
    ("header total off by 1 millime", "sales_invoices", lambda r: r[10].update(total_ht=f"{float(r[10]['total_ht']) + 0.001:.3f}"), "invoice_totals"),
    ("line VAT wrong", "sales_invoice_lines", lambda r: r[20].update(line_vat="0.000") if r[20]["vat_rate"] != "0" else r[21].update(line_vat="0.000"), "financial_reconciliation"),
    ("over-payment", "payments", lambda r: r[0].update(amount="99999999.000"), "payment_balance"),
    ("payment before invoice date", "payments", lambda r: r[1].update(payment_date="2024-01-01"), "invalid_date"),
    ("negative payment", "payments", lambda r: r[2].update(amount="-5.000"), "invalid_numeric"),
    ("non-integer quantity", "sales_invoice_lines", lambda r: r[30].update(quantity="2.5"), "invalid_type"),
    ("invoice in wrong agency", "sales_invoices", lambda r: r[40].update(agency_id="AG05" if r[40]["agency_id"] != "AG05" else "AG01"), "cross_agency_integrity"),
    ("stock drift", "inventory", lambda r: r[0].update(current_quantity=str(int(r[0]["current_quantity"]) + 1)), "inventory_movements"),
    ("duplicate supplier invoice number", "supplier_invoices", lambda r: r[1].update(supplier_id=r[0]["supplier_id"], supplier_invoice_number=r[0]["supplier_invoice_number"]), "duplicate_invoice"),
    ("unknown VAT rate", "sales_invoice_lines", lambda r: r[50].update(vat_rate="21"), "invalid_numeric"),
]


def main():
    args = sys.argv[1:]
    src = Path(args[0]) if args and not args[0].startswith("--") else Path("datasets/synthetic/v1")
    results = []
    for name, table, mutate, category in MUTATIONS:
        with tempfile.TemporaryDirectory() as tmp:
            dst = Path(tmp) / "ds"
            shutil.copytree(src / "csv", dst / "csv")
            rw(dst / "csv" / f"{table}.csv", mutate)
            checks = data_quality.run(dst)
            hit = sorted({c["category"] for c in checks if c["failed"]})
            results.append({"mutation": name, "table": table, "expectedCategory": category, "detectedCategories": hit, "detected": category in hit})
            print(f"{'DETECTED' if category in hit else 'MISSED  '}  {name:40s} -> {hit}")
    if "--json" in args:
        Path(args[args.index("--json") + 1]).write_text(json.dumps(results, indent=2), encoding="utf-8")
    missed = [r for r in results if not r["detected"]]
    print(f"{len(results) - len(missed)}/{len(results)} injected defects detected")
    sys.exit(1 if missed else 0)


if __name__ == "__main__":
    main()
