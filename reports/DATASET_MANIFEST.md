# Dataset manifest and data dictionary

## 1. Datasets

| Dataset | Type | How to reproduce | Status |
|---|---|---|---|
| Real ERP export | Real | `npx tsx tools/dataset/export.ts --source erp` | **BLOCKED**: no ERP read adapter, schema or credentials. The tool refuses (exit 3) and exports nothing. |
| Fixture export | Pseudonymised copy of `server/data.ts` | `npm run dataset:export` | Works. Output goes to `datasets/exports/` (git-ignored). Customer and rep names become HMAC pseudonyms, and the key is never written to disk. |
| Synthetic v1 | **SYNTHETIC**, fictional, deterministic | `npm run dataset:generate` (seed `20261015`, generator 1.0.0) | Generated and validated. Two runs gave identical SHA-256 hashes for all 35 files (`reports/evidence/01_dataset_reproducibility.log`). |
| Adverse fixtures | Fictional | `npm run dataset:adverse` | Committed under `fixtures/adverse/`. |

Synthetic v1 is written as CSV (`csv/`), JSON (`json/`) and a PostgreSQL fixture script (`sql/fixtures.sql`, schema `qa_synthetic`). Every name is suffixed `[FICTIF]`.

### Record counts (synthetic v1)

| Entity | Target | Generated |
|---|---:|---:|
| Agencies | 5 | 5 (Tunis Centre, Sfax, Sousse, Bizerte, Nabeul) |
| Commercial representatives | 25 | 25 |
| Product categories | — | 12 |
| Suppliers | 100 | 100 |
| Customers | 500 | 500 |
| Products | 2,000 | 2,000 |
| Purchase orders / lines | 1,500 | 1,500 / 3,779 |
| Supplier invoices / lines | 3,000 | 3,000 / 7,037 (1,677 linked to a PO, incl. partial invoicing) |
| Sales documents / lines | 10,000 | 10,000 (9,492 posted invoices, 208 cancelled, 300 credit notes) / 17,127 |
| Payments | 8,000 | **8,392** (approximate target; full, split and partial payments) |
| Receivables | — | 9,492 (6,747 settled, 868 partially paid, 1,877 open) |
| Stock movements | 30,000 | 30,000 (receipts, sales, returns, transfers in/out, adjustments) |
| Inventory (product × agency) | — | 7,909 |
| Roles / permission definitions | — | 4 |

## 2. Test scenario assumptions

These are explicit test assumptions. They are **not** statements about current Tunisian tax law.

| Parameter | Value |
|---|---|
| Currency | TND, 3 decimals (millimes) |
| VAT rates | 19 % (70 %), 13 % (12 %), 7 % (13 %), 0 % (5 %); mostly by category |
| Stamp duty | 1.000 TND per sales invoice; none on credit notes |
| Period / as-of date | 2025-01-01 → 2026-06-30 / 2026-06-30 |
| Cost rule | Line cost = quantity × product standard unit cost (no weighted-average revaluation) |
| Rounding | Half away from zero, to the millime, at line level |

## 3. Data dictionary (main tables)

Monetary columns are decimal strings with 3 decimals and are always positive. A document's `doc_type` gives the sign.

| Table | Key | Fields and business rules |
|---|---|---|
| `agencies` | `id` | `name`, `city` |
| `representatives` | `id` | `name`, `agency_id` → agencies, `hire_date` |
| `product_categories` | `id` | `name`, `default_vat_rate` |
| `suppliers` | `id` | `name`, fictional `tax_id`, `city`, `payment_terms_days`, `category_ids` (pipe-separated) |
| `products` | `id` | `sku`, `name`, `category_id`, `supplier_id`, `unit_cost`, `list_price`, `vat_rate`, `reorder_point`, `uom` |
| `customers` | `id` | `agency_id`, `representative_id` (same agency), `segment`, `credit_limit`, `payment_terms_days`, `customer_discount_pct` |
| `purchase_orders` / `_lines` | `id` | `supplier_id`, `agency_id`, `order_date`, `status`; lines: `product_id`, `quantity`, `unit_cost`, `line_total` |
| `supplier_invoices` / `_lines` | `id` | `supplier_invoice_number` (unique per supplier), `purchase_order_id` (nullable, same supplier, invoiced quantity ≤ ordered), `total_ht = Σ line_ht`, `total_vat = Σ line_vat`, `total_ttc = ht + vat` |
| `sales_invoices` | `id` | `number` (FV-/AV-YYMM-nnnnn, unique), `doc_type` (invoice/credit_note), `original_invoice_id` (credit notes), `status` (posted/cancelled), `customer_id`, `agency_id`, `representative_id`, `invoice_date`, `due_date = date + terms`, `total_discount`, `total_ht`, `total_vat`, `stamp_duty`, `total_ttc = ht + vat + stamp`, `total_cost` |
| `sales_invoice_lines` | `id` | `line_ht = round(qty × unit_price × (100 − discount_pct)/100)`, `line_vat = round(line_ht × vat_rate/100)`, `line_cost = qty × unit_cost` |
| `payments` | `id` | Linked to a posted invoice of the same customer; `payment_date` between the invoice date and the as-of date; `amount > 0` |
| `receivables` | `sales_invoice_id` | `outstanding = total_ttc − credited_ttc − paid`; `status` settled/partially_paid/open; `days_overdue` at the as-of date |
| `stock_movements` | `id` | Signed `quantity`; a sale movement for every posted invoice line (none for cancelled invoices); a return for each credit-note line; a receipt for each supplier-invoice line; transfers net to zero |
| `inventory` | (`product_id`, `agency_id`) | `current_quantity = opening_quantity + Σ movements`; the running balance is never negative |

All of these rules are enforced as executable checks in `tools/qa/data_quality.py`. See `DATA_QUALITY_REPORT.md`.

## 4. Adverse fixtures (`fixtures/adverse/`)

| File | Content | Expected behaviour |
|---|---|---|
| `invoices/invoice_anomalies.json` | 15 supplier-invoice cases: valid baseline, duplicate, missing number or supplier, wrong totals, VAT mismatch, wrong line VAT rate, negative quantity, 85 % discount, EUR currency, 21 % VAT, duplicate line, unknown PO, line arithmetic error, valid mixed-VAT | Exact set of validation codes per case |
| `bi/bi_anomalies.json` | 10 cases: negative margin, empty period, missing cost, cancelled, credit note, partial payment, duplicate transaction, out-of-period, inconsistent agency ID, float precision | Expected KPI values or behaviour |
| `ocr/*.png, *.jpg, *.pdf` + `ground_truth.json` | 15 real files: clean PNG/JPEG, 7° and 90° rotation, blur, low resolution (image and PDF), image-only PDF, 2-page PDF, French and Arabic (pre-shaped glyphs), decimal comma, incomplete invoice, unusual layout, O/0 and l/1 confusables, born-digital PDF with a text layer | Field-level ground truth for each file |
| `upload/*` + `expected.json` | 7 hostile files: fake PNG, PDF declared as PNG, EXE renamed `.pdf`, SVG with script, empty file, DOCX, PDF/HTML polyglot | Expected HTTP status |
| Copilot anomalies | Ambiguous, missing-data, contradictory, access-control and prompt-injection questions | In `tests/qa/copilot-benchmark.test.ts` (questions D01–D10, X01–X12) |
