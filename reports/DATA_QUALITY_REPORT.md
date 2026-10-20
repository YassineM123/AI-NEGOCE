# Data quality report

Tool: `tools/qa/data_quality.py`. It is written in Python with `Decimal` arithmetic, reads the raw CSV files, and shares no code with the application.
Command: `python tools/qa/data_quality.py datasets/synthetic/v1 --json … --md …`, executed 15 October 2026 (logs in `reports/evidence/02_*`).

## 1. Summary

- **87 executable checks** produced **698,834 record evaluations** on synthetic v1. **0 failing records.**
- **Validator sensitivity:** 13/13 deliberately injected defects were detected (`tools/qa/mutation_check.py`, run on throwaway copies). A zero-failure result is only meaningful if the validator catches known defects, which it does.
- **Defects in the QA tool itself, fixed before reporting:** the validator crashed on orphan rows (a hard lookup sat outside the guarded predicate) and on non-integer quantities (in the failure-description callback). Both were found by the mutation run.
- **Scope note:** the dataset is synthetic. These checks prove the dataset is internally consistent and that the checks work. They say nothing about real ERP data, which was not available.

## 2. Results by category

| Category | Checks | Records tested | Failed |
|---|---:|---:|---:|
| broken_foreign_key | 27 | 215,005 | 0 |
| cross_agency_integrity | 2 | 10,500 | 0 |
| duplicate_invoice | 2 | 13,000 | 0 |
| duplicate_primary_key | 17 | 100,882 | 0 |
| financial_reconciliation | 3 | 51,381 | 0 |
| invalid_date | 4 | 23,069 | 0 |
| invalid_numeric | 8 | 73,075 | 0 |
| invalid_type | 4 | 57,943 | 0 |
| inventory_movements | 4 | 57,042 | 0 |
| invoice_totals | 2 | 13,000 | 0 |
| missing_value | 5 | 23,892 | 0 |
| orphaned_record | 2 | 19,492 | 0 |
| payment_balance | 3 | 28,684 | 0 |
| referential_integrity | 4 | 11,869 | 0 |

Cross-agency *access* (unauthorised API reads) is an application-security property, not a data property. It is tested in `SECURITY_AUDIT.md`. The data check here verifies agency consistency between invoices, customers and representatives.

## 3. Mutation test (validator sensitivity)

| Injected defect | Table | Expected category | Detected categories | Detected |
|---|---|---|---|---|
| duplicate customer id | customers | duplicate_primary_key | duplicate_primary_key | yes |
| orphan invoice line (unknown invoice) | sales_invoice_lines | broken_foreign_key | broken_foreign_key, inventory_movements, invoice_totals | yes |
| missing invoice number | sales_invoices | missing_value | missing_value | yes |
| header total off by 1 millime | sales_invoices | invoice_totals | invoice_totals | yes |
| line VAT wrong | sales_invoice_lines | financial_reconciliation | financial_reconciliation, invoice_totals | yes |
| over-payment | payments | payment_balance | payment_balance | yes |
| payment before invoice date | payments | invalid_date | invalid_date | yes |
| negative payment | payments | invalid_numeric | invalid_numeric, payment_balance | yes |
| non-integer quantity | sales_invoice_lines | invalid_type | financial_reconciliation, invalid_type, inventory_movements | yes |
| invoice in wrong agency | sales_invoices | cross_agency_integrity | cross_agency_integrity | yes |
| stock drift | inventory | inventory_movements | inventory_movements | yes |
| duplicate supplier invoice number | supplier_invoices | duplicate_invoice | duplicate_invoice, referential_integrity | yes |
| unknown VAT rate | sales_invoice_lines | invalid_numeric | financial_reconciliation, invalid_numeric | yes |

## 4. All checks (synthetic v1)

Each row gives the records tested, records failed, expected rule and actual result. For a failed check, the generated report also includes a sanitised example record. There were none in this run.

| Check | Category | Table | Tested | Failed | Expected | Actual |
|---|---|---|---:|---:|---|---|
| agencies: unique primary key | duplicate_primary_key | agencies | 5 | 0 | every key appears once | as expected |
| customers: unique primary key | duplicate_primary_key | customers | 500 | 0 | every key appears once | as expected |
| inventory: unique primary key | duplicate_primary_key | inventory | 7,909 | 0 | every key appears once | as expected |
| payments: unique primary key | duplicate_primary_key | payments | 8,392 | 0 | every key appears once | as expected |
| product_categories: unique primary key | duplicate_primary_key | product_categories | 12 | 0 | every key appears once | as expected |
| products: unique primary key | duplicate_primary_key | products | 2,000 | 0 | every key appears once | as expected |
| purchase_order_lines: unique primary key | duplicate_primary_key | purchase_order_lines | 3,779 | 0 | every key appears once | as expected |
| purchase_orders: unique primary key | duplicate_primary_key | purchase_orders | 1,500 | 0 | every key appears once | as expected |
| receivables: unique primary key | duplicate_primary_key | receivables | 9,492 | 0 | every key appears once | as expected |
| representatives: unique primary key | duplicate_primary_key | representatives | 25 | 0 | every key appears once | as expected |
| roles: unique primary key | duplicate_primary_key | roles | 4 | 0 | every key appears once | as expected |
| sales_invoice_lines: unique primary key | duplicate_primary_key | sales_invoice_lines | 17,127 | 0 | every key appears once | as expected |
| sales_invoices: unique primary key | duplicate_primary_key | sales_invoices | 10,000 | 0 | every key appears once | as expected |
| stock_movements: unique primary key | duplicate_primary_key | stock_movements | 30,000 | 0 | every key appears once | as expected |
| supplier_invoice_lines: unique primary key | duplicate_primary_key | supplier_invoice_lines | 7,037 | 0 | every key appears once | as expected |
| supplier_invoices: unique primary key | duplicate_primary_key | supplier_invoices | 3,000 | 0 | every key appears once | as expected |
| suppliers: unique primary key | duplicate_primary_key | suppliers | 100 | 0 | every key appears once | as expected |
| representatives.agency_id -> agencies | broken_foreign_key | representatives | 25 | 0 | agency_id references an existing agencies | as expected |
| customers.agency_id -> agencies | broken_foreign_key | customers | 500 | 0 | agency_id references an existing agencies | as expected |
| customers.representative_id -> representatives | broken_foreign_key | customers | 500 | 0 | representative_id references an existing representatives | as expected |
| products.category_id -> product_categories | broken_foreign_key | products | 2,000 | 0 | category_id references an existing product_categories | as expected |
| products.supplier_id -> suppliers | broken_foreign_key | products | 2,000 | 0 | supplier_id references an existing suppliers | as expected |
| purchase_orders.supplier_id -> suppliers | broken_foreign_key | purchase_orders | 1,500 | 0 | supplier_id references an existing suppliers | as expected |
| purchase_orders.agency_id -> agencies | broken_foreign_key | purchase_orders | 1,500 | 0 | agency_id references an existing agencies | as expected |
| purchase_order_lines.purchase_order_id -> purchase_orders | broken_foreign_key | purchase_order_lines | 3,779 | 0 | purchase_order_id references an existing purchase_orders | as expected |
| purchase_order_lines.product_id -> products | broken_foreign_key | purchase_order_lines | 3,779 | 0 | product_id references an existing products | as expected |
| supplier_invoices.supplier_id -> suppliers | broken_foreign_key | supplier_invoices | 3,000 | 0 | supplier_id references an existing suppliers | as expected |
| supplier_invoices.purchase_order_id -> purchase_orders | broken_foreign_key | supplier_invoices | 3,000 | 0 | purchase_order_id references an existing purchase_orders | as expected |
| supplier_invoices.agency_id -> agencies | broken_foreign_key | supplier_invoices | 3,000 | 0 | agency_id references an existing agencies | as expected |
| supplier_invoice_lines.supplier_invoice_id -> supplier_invoices | broken_foreign_key | supplier_invoice_lines | 7,037 | 0 | supplier_invoice_id references an existing supplier_invoices | as expected |
| supplier_invoice_lines.product_id -> products | broken_foreign_key | supplier_invoice_lines | 7,037 | 0 | product_id references an existing products | as expected |
| sales_invoices.customer_id -> customers | broken_foreign_key | sales_invoices | 10,000 | 0 | customer_id references an existing customers | as expected |
| sales_invoices.agency_id -> agencies | broken_foreign_key | sales_invoices | 10,000 | 0 | agency_id references an existing agencies | as expected |
| sales_invoices.representative_id -> representatives | broken_foreign_key | sales_invoices | 10,000 | 0 | representative_id references an existing representatives | as expected |
| sales_invoices.original_invoice_id -> sales_invoices | broken_foreign_key | sales_invoices | 10,000 | 0 | original_invoice_id references an existing sales_invoices | as expected |
| sales_invoice_lines.sales_invoice_id -> sales_invoices | broken_foreign_key | sales_invoice_lines | 17,127 | 0 | sales_invoice_id references an existing sales_invoices | as expected |
| sales_invoice_lines.product_id -> products | broken_foreign_key | sales_invoice_lines | 17,127 | 0 | product_id references an existing products | as expected |
| payments.sales_invoice_id -> sales_invoices | broken_foreign_key | payments | 8,392 | 0 | sales_invoice_id references an existing sales_invoices | as expected |
| payments.customer_id -> customers | broken_foreign_key | payments | 8,392 | 0 | customer_id references an existing customers | as expected |
| receivables.sales_invoice_id -> sales_invoices | broken_foreign_key | receivables | 9,492 | 0 | sales_invoice_id references an existing sales_invoices | as expected |
| stock_movements.product_id -> products | broken_foreign_key | stock_movements | 30,000 | 0 | product_id references an existing products | as expected |
| stock_movements.agency_id -> agencies | broken_foreign_key | stock_movements | 30,000 | 0 | agency_id references an existing agencies | as expected |
| inventory.product_id -> products | broken_foreign_key | inventory | 7,909 | 0 | product_id references an existing products | as expected |
| inventory.agency_id -> agencies | broken_foreign_key | inventory | 7,909 | 0 | agency_id references an existing agencies | as expected |
| sales_invoices: required fields present | missing_value | sales_invoices | 10,000 | 0 | non-empty number, customer_id, agency_id, invoice_date, total_ht | as expected |
| supplier_invoices: required fields present | missing_value | supplier_invoices | 3,000 | 0 | non-empty supplier_invoice_number, supplier_id, invoice_date | as expected |
| products: required fields present | missing_value | products | 2,000 | 0 | non-empty name, unit_cost, list_price | as expected |
| customers: required fields present | missing_value | customers | 500 | 0 | non-empty name, agency_id | as expected |
| payments: required fields present | missing_value | payments | 8,392 | 0 | non-empty amount, payment_date | as expected |
| sales_invoices: monetary values are non-negative 3-decimal numbers | invalid_numeric | sales_invoices | 10,000 | 0 | decimal >= 0 with <= 3 decimals | as expected |
| sales_invoice_lines: monetary values are non-negative 3-decimal numbers | invalid_numeric | sales_invoice_lines | 17,127 | 0 | decimal >= 0 with <= 3 decimals | as expected |
| supplier_invoices: monetary values are non-negative 3-decimal numbers | invalid_numeric | supplier_invoices | 3,000 | 0 | decimal >= 0 with <= 3 decimals | as expected |
| payments: monetary values are non-negative 3-decimal numbers | invalid_numeric | payments | 8,392 | 0 | decimal >= 0 with <= 3 decimals | as expected |
| products: monetary values are non-negative 3-decimal numbers | invalid_numeric | products | 2,000 | 0 | decimal >= 0 with <= 3 decimals | as expected |
| payments: amount strictly positive | invalid_numeric | payments | 8,392 | 0 | > 0 | as expected |
| sales_invoice_lines: integer positive quantity | invalid_type | sales_invoice_lines | 17,127 | 0 | integer > 0 | as expected |
| sales_invoice_lines: VAT rate in scenario set {0,7,13,19} | invalid_numeric | sales_invoice_lines | 17,127 | 0 | vat_rate in {0,7,13,19} | as expected |
| supplier_invoice_lines: integer positive quantity | invalid_type | supplier_invoice_lines | 7,037 | 0 | integer > 0 | as expected |
| supplier_invoice_lines: VAT rate in scenario set {0,7,13,19} | invalid_numeric | supplier_invoice_lines | 7,037 | 0 | vat_rate in {0,7,13,19} | as expected |
| purchase_order_lines: integer positive quantity | invalid_type | purchase_order_lines | 3,779 | 0 | integer > 0 | as expected |
| stock_movements: quantity is a non-zero integer | invalid_type | stock_movements | 30,000 | 0 | integer != 0 | as expected |
| sales_invoices: date within dataset period, due >= issue | invalid_date | sales_invoices | 10,000 | 0 | 2025-01-01 <= date <= 2026-06-30; due_date >= invoice_date | as expected |
| supplier_invoices: due >= issue | invalid_date | supplier_invoices | 3,000 | 0 | due_date >= invoice_date | as expected |
| payments: paid on/after invoice date and not after as-of | invalid_date | payments | 8,392 | 0 | invoice_date <= payment_date <= as-of | as expected |
| supplier_invoices: invoice on/after purchase order date | invalid_date | supplier_invoices | 1,677 | 0 | invoice_date >= order_date | as expected |
| sales_invoice_lines: line HT = qty x price x (1 - discount) | financial_reconciliation | sales_invoice_lines | 17,127 | 0 | exact to the millime (half-up) | as expected |
| sales_invoice_lines: line VAT = HT x rate | financial_reconciliation | sales_invoice_lines | 17,127 | 0 | exact to the millime | as expected |
| sales_invoice_lines: line cost = qty x unit cost | financial_reconciliation | sales_invoice_lines | 17,127 | 0 | exact | as expected |
| sales_invoices: header totals = sum of lines (+ stamp) | invoice_totals | sales_invoices | 10,000 | 0 | HT, VAT, cost reconcile; TTC = HT + VAT + stamp | as expected |
| sales_invoices: every document has >= 1 line (orphan header) | orphaned_record | sales_invoices | 10,000 | 0 | >= 1 line | as expected |
| supplier_invoices: header totals = sum of lines | invoice_totals | supplier_invoices | 3,000 | 0 | HT/VAT reconcile; TTC = HT + VAT | as expected |
| supplier_invoices: (supplier, number) unique — duplicate invoice detection | duplicate_invoice | supplier_invoices | 3,000 | 0 | unique per supplier | as expected |
| sales_invoices: document number unique | duplicate_invoice | sales_invoices | 10,000 | 0 | unique | as expected |
| supplier_invoices: same supplier as its purchase order | referential_integrity | supplier_invoices | 1,677 | 0 | supplier matches PO | as expected |
| purchase_orders: invoiced quantity <= ordered quantity | referential_integrity | purchase_orders | 1,500 | 0 | never over-invoiced | as expected |
| credit notes: reference a posted invoice of the same customer; returned qty <= sold qty | referential_integrity | sales_invoices | 300 | 0 | valid original invoice | as expected |
| payments: linked to a posted (non-cancelled) invoice of the same customer | referential_integrity | payments | 8,392 | 0 | posted invoice, same customer | as expected |
| sales_invoices: payments + credits never exceed TTC | payment_balance | sales_invoices | 9,700 | 0 | no over-payment | as expected |
| receivables: outstanding = TTC - credits - payments | payment_balance | receivables | 9,492 | 0 | exact reconciliation | as expected |
| receivables: status consistent with balance | payment_balance | receivables | 9,492 | 0 | settled <=> outstanding = 0 | as expected |
| receivables: one row per posted invoice | orphaned_record | sales_invoices | 9,492 | 0 | receivable exists | as expected |
| inventory: current = opening + sum(movements) | inventory_movements | inventory | 7,909 | 0 | exact | as expected |
| stock_movements: running balance never negative | inventory_movements | stock_movements | 30,000 | 0 | balance >= 0 at every movement | as expected |
| stock_movements: every posted invoice line has a matching sale movement; cancelled invoices move no stock | inventory_movements | sales_invoice_lines | 16,733 | 0 | 1:1 quantity match | as expected |
| stock_movements: transfers net to zero | inventory_movements | stock_movements | 2,400 | 0 | out + in = 0 | as expected |
| sales_invoices: customer and representative belong to the invoice agency | cross_agency_integrity | sales_invoices | 10,000 | 0 | same agency | as expected |
| customers: representative belongs to customer agency | cross_agency_integrity | customers | 500 | 0 | same agency | as expected |

## 5. Adverse invoice fixtures

These anomalies are invoice-level validation concerns rather than dataset integrity. The 15 cases in `fixtures/adverse/invoices/` are checked by the application's own rules (`server/invoice-validation.ts`). See `OCR_TEST_REPORT.md` §4: 15/15 exact, 0 false positives.
