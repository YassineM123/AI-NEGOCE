# Security audit

**Scope:** non-destructive tests against in-process local application instances only. No production or shared system was contacted, and there was no high-volume load.

**Tools:**
- `tests/qa/security.test.ts` (22 tests)
- `tests/qa/defects.test.ts` (security probes)
- the Copilot access-control and prompt-injection questions
- a local RS256 OIDC issuer (real JWKS over HTTP), so the production JWT path was exercised with real signatures

## 1. Findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| BUG-001 | **CRITICAL** | A correctly signed OIDC token **without an `agencies` claim, or with an empty one**, received company-wide BI and Copilot data: `scopedAgency()` returned "no filter". | **Fixed**: fails closed (403). Regression tests added. |
| BUG-002 | HIGH | A user assigned to several agencies who requested "all" received **every** agency, including unassigned ones. | **Fixed**: scope is the explicit agency list. |
| BUG-007 | MEDIUM | The Copilot ignored the agency named in a question, so out-of-scope requests were answered with in-scope data presented as an answer. No data leaked, but the answer was misleading. | **Fixed**: explicit refusal. |
| BUG-004 / BUG-013 | MEDIUM / LOW | Malformed or oversized JSON returned 500 and was logged as a server error. Unknown routes returned HTML instead of the JSON envelope. | **Fixed** |
| BUG-024 | HIGH | The frontend has **no authentication flow**. `src/api.ts` falls back to the hardcoded `dev-admin` token. In production the API correctly rejects development tokens (tested), so this is not a bypass, but the frontend cannot work against a production API. | **Open**: needs the ERP identity provider. |
| SEC-OBS-1 | MEDIUM | **Polyglot upload:** a file starting with `%PDF-` and embedding HTML/JS is accepted. Validation reads only the first bytes. | Open: antivirus and deep parsing needed. |
| SEC-OBS-2 | LOW | `GET /readyz` is public and reveals dependency state (database, ERP, OCR). | Open: restrict to the internal network. |
| SEC-OBS-3 | LOW | In PostgreSQL mode a malformed document or conversation ID would have produced a database error (500). Found by code inspection; PostgreSQL was not run. | Hardened: IDs are UUID-validated before any lookup (404). **Not verified against PostgreSQL.** |
| SEC-OBS-4 | INFO | Dead code in `OCRModule` renders a fabricated "Facture importée avec succès — FA-2502-0196" ERP success. It is unreachable in the current state flow (verified by code reading). | Recommend deleting it. |

## 2. Verified controls (final run: all pass)

| Control | Tests |
|---|---|
| Authentication | Missing, Basic and garbage tokens → 401. Development tokens refused when `NODE_ENV=production`. A valid OIDC token is accepted and its claims mapped. Expired token, wrong audience, wrong issuer, foreign signing key, unknown role and `alg=none` → 401. |
| Role-based access | A commercial user cannot upload or read documents; a manager cannot approve; approval is limited to admin and accountant. |
| Cross-agency isolation | Documents (403). BI and Copilot with empty, single and multi-agency scopes. 106/106 benchmark and 35/35 held-out Copilot answers had no out-of-scope sources. |
| Cross-user isolation | Another user's conversation → 404 (no existence oracle). Messages cannot be appended to it. |
| File upload | Magic-byte check vs. declared type. Allow-list (PDF, PNG, JPEG). 15 MiB limit. One file per request. Random storage key. A client filename such as `../../../../etc/passwd.pdf` is reduced to its base name, and the file stays inside the upload directory. |
| Path traversal | URL-encoded traversal in the document ID → 404. |
| SQL injection | `' OR 1=1 --` as an agency is treated as data (admin: empty result; scoped user: 403). The PostgreSQL store uses parameterised queries throughout (code review). |
| XSS | Payloads are returned as `application/json` and never reflected as HTML. Copilot answers do not echo the question. React escapes rendered text, and no `dangerouslySetInnerHTML` exists. |
| CSRF | Not applicable: bearer-token API, and no cookies are issued (verified). |
| CORS | Only the configured frontend origin is allowed. |
| Headers | Helmet headers present (`nosniff`, frame options); `x-powered-by` absent. |
| Error leakage | A forced internal error containing a fake connection string returns only `INTERNAL_ERROR`, with no message or stack. |
| Input validation | Question length (3–1000), agency length (≤ 80), UUIDs, real calendar dates, `from ≤ to`. |
| Rate limiting | 429 after 120 requests per minute (now configurable). |
| Prompt injection | 5 benchmark injections plus 2 held-out ones: all stayed within scope. |

## 3. Not tested (blocked)

- A real identity provider and its claim mapping
- TLS and reverse proxy
- Secrets management
- PostgreSQL row-level behaviour
- Antivirus
- Production network exposure
- Dependency CVE scanning beyond `npm audit` (0 known vulnerabilities, production and development)
