# Invoice dataset audit

Date: 2026-10-21  
Command: `npm run dataset:audit:invoices`  
Machine-readable evidence: `reports/evidence/invoice-dataset-audit.json`

## Intended use and grain

The confidential `Dataset/` directory is read-only and remains gitignored. It contains invoice images plus three CSV label files at invoice-image grain. The audit hashes files in place and writes aggregate evidence outside the dataset.

## Measured profile

| Check | Result |
|---|---:|
| Image/PDF files | 8,181 |
| Unique SHA-256 image contents | 5,199 |
| Exact duplicate files | 2,982 (36.45%) |
| CSV label rows | 1,414 |
| Distinct labeled filenames | 1,413 |
| Valid JSON labels | 1,414 (100%) |
| Labels without a corresponding image | 0 |

One filename is labeled twice. Duplicate images must remain in the same partition whenever a benchmark split is made, otherwise train/test leakage will materially inflate results.

## Fitness decision

This dataset is suitable for a separate OCR/text-extraction benchmark on its own US computer-generated English/USD template. It is not suitable for claiming Tunisian invoice accuracy because it does not represent Tunisian fiscal formats, French/Arabic scans, TND rules, supplier diversity, or real capture defects. It also contains no invoice-line-to-ERP-product labels, so it cannot train or measure catalog matching.

The automated total-consistency signal is diagnostic only: the label schema does not fully define whether each item amount is unit, net, or gross in every row. Suspect rows must be reviewed before being promoted to financial ground truth.

## Required controls

- Split by SHA-256 duplicate group, not filename.
- Report this dataset separately from `fixtures/adverse/ocr`.
- Never copy samples into source control, logs, or reports.
- Exclude or manually adjudicate duplicated labels and financially inconsistent rows.
- Do not use benchmark results as a production or Tunisia accuracy claim.
