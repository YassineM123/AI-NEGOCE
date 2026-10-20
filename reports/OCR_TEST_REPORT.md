# Smart OCR test report

## 1. Headline

- **No OCR accuracy figure is reported.** No OCR engine is configured in the application (`OCR_PROVIDER=disabled`), and none is installed on the test machine (no Tesseract or OCR service). Field-level accuracy, exact-match accuracy, numeric accuracy, product-matching precision and recall, and extraction failure rate are therefore **BLOCKED**. The scoring harness and ground truth are ready (`fixtures/adverse/ocr/ground_truth.json`). They become measurable as soon as a provider is configured.
- What *was* tested with real files through the real API: upload validation, storage, non-fabrication of fields, duplicate detection, failure handling, the approval gate, the invoice validation rules, and the HTTP provider contract (against a local mock that is explicitly *not* an OCR model).

## 2. Coverage of the requested workflow

| # | Step | Result | Evidence |
|---|---|---|---|
| 1 | PDF upload | PASS. Image-only, multi-page, low-resolution and born-digital PDFs are all accepted. | `ocr-pipeline.test.ts` |
| 2 | PNG / JPEG upload | PASS (clean, rotated, blurred, low-resolution, bilingual, decimal-comma, confusables) | same |
| 3 | Content validation (magic bytes vs. declared type) | PASS. Fake PNG, PDF declared as PNG, EXE renamed `.pdf`, empty file → 415. | `fixtures/adverse/upload` |
| 4 | File size limit (15 MiB) | PASS. Exactly 15 MiB is accepted; 15 MiB + 1 byte is rejected with **400** `UPLOAD_ERROR` (413 would be more precise; cosmetic). | same |
| 5 | Unsupported formats | PASS. SVG with script and DOCX → 415. | same |
| 6–11 | OCR extraction; supplier, product, quantity, price and VAT recognition | **BLOCKED** (no OCR engine). The API returns empty fields and lists all six fields as missing. It **never invents values** (verified for all 15 fixture files). | `reports/evidence/ocr_pipeline_final.json` |
| 12 | Total reconciliation | PASS on structured invoices through the application's rules (`server/invoice-validation.ts`), now enforced at approval | §4 |
| 13 | Duplicate detection | PASS for identical files (409 `DUPLICATE_DOCUMENT`, BUG-010). The invoice-level rule (`DUPLICATE_INVOICE`, same supplier and number) is implemented and tested, but **not active at approval**: the registry of existing invoices must come from the ERP. | `defects.test.ts`, §4 |
| 14 | Purchase-order matching | Rule implemented and tested (`UNKNOWN_PURCHASE_ORDER`). **Not active at approval** for the same reason (ERP data needed). | §4 |
| 15 | Human correction | **NOT IMPLEMENTED.** There is no correction endpoint, and the `approval_events` table is unused. | code review |
| 16 | Approval permissions | PASS. A manager gets 403; admin and accountant only; agency scope enforced. | `security.test.ts` |
| 17 | ERP write | **BLOCKED / NOT IMPLEMENTED.** Approval does not call `ErpAdapter.createSupplierInvoice`. The UI states that no ERP submission happened. | code review, E2E |
| 18 | Failed jobs and retry | Failure handling PASS after the fix (BUG-009: 502, status `failed`, file kept). **No retry mechanism or queue exists.** | `defects.test.ts` |

Bugs found and fixed in this area: BUG-008 (approval of incomplete extractions), BUG-009, BUG-010, BUG-011, BUG-012.

## 3. Upload latency (OCR disabled, local)

16 successful fixture uploads through Supertest: p50 13.8 ms, p95 67.3 ms. This excludes OCR processing time, which cannot be measured. Under load, see `PERFORMANCE_REPORT.md` (p95 52.9 ms at 16 concurrent uploads of 40 KB).

## 4. Invoice validation rules (anomaly fixtures)

`fixtures/adverse/invoices/invoice_anomalies.json`: 15 cases, compared on the exact set of expected codes.

| Run | Exact cases | Detection rate (codes) | False positives |
|---|---:|---:|---:|
| Initial (original code) | 0 / 15 | 0 % (the application had no validation module) | — |
| Final | **15 / 15** | **100 %** | **0** |

The codes cover the following:
- missing invoice number or supplier
- duplicate invoice
- currency mismatch
- unknown purchase order
- negative quantity
- unknown VAT rate
- unusual discount (> 30 %)
- line total and line VAT mismatches
- duplicate line
- HT, VAT and TTC header mismatches

Amounts are compared in integer millimes. Caveat: the cases were written by the same QA team that wrote the rules, so this demonstrates that the rules work as specified. It is not independent evidence of robustness on real supplier layouts.

## 5. Provider contract (local mock HTTP server, not an OCR model)

PASS for all three checks:
- a schema-valid response is parsed and the bearer key is sent
- a schema-invalid response is rejected, with no fields invented
- an HTTP 500 from the provider is surfaced as an error

## 6. Residual risks

- **Polyglot files:** a PDF header followed by embedded HTML/JS is accepted (201). Only the first bytes are checked. Before production this needs antivirus scanning and deep parsing (or sandboxed rasterisation).
- OCR runs synchronously inside the HTTP request. A real provider (30 s timeout) would hold connections open, so a queue and worker are needed.
- **Arabic fixture caveat:** the Arabic text uses pre-shaped glyphs because the local PIL build has no libraqm. Real scans should be added once a provider exists.
