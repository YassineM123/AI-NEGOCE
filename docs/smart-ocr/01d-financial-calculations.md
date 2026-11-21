# Phase 1 · Step 4 — Exact financial calculations

- Date: 2026-10-20 · Files: `server/money.ts`, `server/financial-rules.ts`, `server/invoice-validation.ts`, migration `004_financial_rules.sql`.

## 1. Exact representation

`Decimal` (`server/money.ts`) stores an integer number of units (`BigInt`) and a scale: `12.345` = 12345 at scale 3. Addition, subtraction, multiplication and percentages are exact; division and every reduction of precision go through an explicit rounding mode. No binary floating point is used in the Smart OCR financial path (verified: no `Number()`, `parseFloat` or `Math.round` in these modules).

| Rounding mode | Rule | Example (3 decimals) |
|---|---|---|
| `half_up` | ties away from zero | 0.0005 → 0.001; −0.0005 → −0.001 |
| `half_even` | ties to the even neighbour | 0.0015 → 0.002; 0.0025 → 0.002 |
| `down` | toward zero | 2.999 → 2.99 (2 decimals) |
| `up` | away from zero | 2.001 → 2.01 (2 decimals) |

Parsing is strict: `"1234.567"`, `"-3"`, finite numbers whose literal is plain (`9.5`). Locale formats (`"1 234,5"`, `"12,5"`), exponents, `NaN` and more than 18 decimals are refused. Converting OCR text to canonical decimals belongs to normalization (Phase 3); an unreadable value produces `INVALID_AMOUNT` rather than a computation.

## 2. Configurable rules (per organization)

| Setting | Meaning |
|---|---|
| `currency` | ISO code accepted on invoices |
| `moneyScale` | decimals of amounts (3 for TND) |
| `quantityScale` | decimals of converted stock quantities |
| `roundingMode` | one of the four modes above |
| `vatRounding` | `line` (round each line's VAT, then sum) or `document` (VAT per rate on the summed base) |
| `vatRates` | list of `{code, rate, label}`; any rate not listed raises `UNKNOWN_VAT_RATE` |
| `stampDuty` | expected stamp amount, or `null` (not checked) |
| `tolerance` | accepted absolute difference between declared and computed amounts (`0` = exact) |
| `maxDiscountPct` | discount above it raises a warning, or `null` |
| `verified`, `verifiedBy`, `verifiedAt` | set by the server only |
| `source` | who provided the values (returned with every approval) |

Storage: `organization_financial_rules` (one row per organization, RLS, `revision` for optimistic concurrency, `verified_by` must be a user of the organization).

API:
- `GET /api/v1/settings/financial-rules` (permission `documents.read`).
- `PUT /api/v1/settings/financial-rules` (permission `settings.manage`, admin only): `{ rules, markVerified, expectedRevision? }`. Verification fields in `rules` are refused. **Any change clears the verification** unless the same request sets `markVerified: true`, which records the acting user and time. Stale `expectedRevision` → 409 `REVISION_CONFLICT`. Audited (`financial_rules.updated`).

**No Tunisian rule is hardcoded as verified.** The only built-in values, `DEMO_FINANCIAL_RULES`, are the figures the prototype hardcoded before (TND, 3 decimals, half-up, line-level VAT, rates 0/7/13/19, discount warning above 30 %, stamp not checked, tolerance 0). They are flagged `verified: false` with the source "non vérifiées par un expert-comptable", and are seeded only into the synthetic development organizations.

## 3. Computation

- Line HT = quantity × unit price − (gross × discount % / 100) − discount amount, rounded to `moneyScale`.
- Line VAT = HT × rate / 100, rounded (line mode); document mode rounds once per rate on the summed base.
- Additional charges (transport, packaging, …) carry their own HT and VAT rate and are included in the totals.
- Stamp: the invoice's own value; the configured `stampDuty` is used only when the invoice gives none, and checked when configured (`STAMP_MISMATCH`).
- TTC = HT + VAT + stamp.
- Unit conversion: stock quantity = purchase quantity × approved conversion factor, rounded to `quantityScale`; a factor ≤ 0 is refused.

## 4. Validation and approval

`validateInvoice(invoice, { rules })` returns issues `{ code, message, line?, severity }`, deterministic for the same input. Codes: `MISSING_INVOICE_NUMBER`, `MISSING_SUPPLIER`, `DUPLICATE_INVOICE`, `CURRENCY_MISMATCH`, `UNKNOWN_PURCHASE_ORDER`, `INVALID_AMOUNT`, `NEGATIVE_QUANTITY`, `UNKNOWN_VAT_RATE`, `INVALID_DISCOUNT`, `UNUSUAL_DISCOUNT` (warning), `LINE_TOTAL_MISMATCH`, `LINE_VAT_MISMATCH`, `DUPLICATE_LINE`, `CHARGE_VAT_MISMATCH`, `HT_MISMATCH`, `VAT_MISMATCH`, `STAMP_MISMATCH`, `TOTAL_MISMATCH`. Until the review workflow lets a reviewer acknowledge warnings (Phase 7), **every issue still blocks approval**.

The approve route now:
1. loads the organization's rules; none → 409 `FINANCIAL_RULES_MISSING`;
2. unverified rules on a customer (non-synthetic) organization → 409 `FINANCIAL_RULES_UNVERIFIED`;
3. validates with those rules (previously: hardcoded TND and rates 0/7/13/19);
4. answers with the rules' revision, verification status and source.

## 5. Scope notes

- BI 360 and the ERP sandbox keep their own amount handling (integer millimes from `Number`); not modified, by scope.
- Withholding tax (retenue à la source), multi-currency invoices and per-product tax treatment are not modelled; they need the accountant's specification.

## 6. Tests

`tests/qa/financial.test.ts` (76): strict parsing (valid/invalid literals, non-finite numbers); exactness where floats fail (`0.1 + 0.2`, `1.005 → 1.01`, large products, percentages); 22 rounding boundary cases across the four modes including negatives and ties; division with rounding and division by zero; fixed formatting; reference invoice totals; line vs document VAT rounding producing different, configured results; percentage and amount discounts; additional charges; stamp handling; money scale and rounding mode at a 2-decimal boundary; unit conversions; tolerance; organization VAT rates; configured stamp; charges in totals; unreadable amounts; severity; schema validation; approval gate (missing, unverified for customers, verified, synthetic); rules API (server-side verification, reset on change, client cannot set verification fields, revision conflict, duplicate VAT codes, permissions). Plus the 15 existing anomaly fixtures (unchanged expectations) and a PostgreSQL test of rules persistence, verification FK, revisions and isolation.
