# Phase 1 · Step 5 — Accurate environment and data labels

- Date: 2026-10-20 · Visual design unchanged (same components and CSS classes).

## 1. Source of truth

`GET /api/v1/me` now returns, besides the user and organization:

| Field | Values |
|---|---|
| `dataSource.kind` / `label` | `sandbox` ("Bac à sable ERP synthétique (SQLite) — données fictives", or "Jeu de données de test — données fictives" without the SQLite file) for the sandbox organization outside production; `erp` only when an ERP connector is configured **and** its health check succeeds; otherwise `none` ("Aucune source ERP connectée") |
| `erpStatus` | `not_configured`, `available`, `unavailable` (from the adapter's health check) |

The frontend loads it once into a session context; every identity or connectivity label is rendered from it.

## 2. Changes

| Place | Before | After |
|---|---|---|
| Top bar badge | Always "Environnement de démonstration" | "Environnement de démonstration — Données fictives" for sandbox data or a synthetic organization; "ERP connecté : …" only for a healthy configured connector; otherwise "Aucune source ERP connectée" / "ERP indisponible" |
| Top bar company | "CARTHAGE MOBILIER SARL", "CM" | Organization name and initials from the session ("Organisation active") |
| Sidebar user | "Sonia Ben Amor · Administratrice" | Session user and role |
| Dashboard greeting | "Bonjour Sonia," | "Bonjour {prénom}," from the session |
| Copilot header | "Connecté aux données de CARTHAGE MOBILIER SARL" | "Source : {data source label}" |
| Settings › Société | Invented company name, tax id `9876543/B/A/M/000`, RNE, address, `+216 …`, `contact@carthage-mobilier.tn`, "Dossier actif", fiscal year 2025 | Organization name and id from the session; legal fields empty and read-only ("Non renseigné"), "Données fictives" badge for synthetic organizations |
| Settings save button | "Enregistrer les modifications" (saved nothing) | Disabled, "Enregistrement non disponible" |
| Settings › Taxes & comptabilité | Placeholder with "Configurée" | The organization's real financial rules, with "Non vérifiées" / "Validées par l’expert-comptable" |
| Settings › Intégrations | "Configurée", "28/02/2025 · Sonia Ben Amor" | Real data source and ERP connector status ("Non configuré") |
| Other settings sections | "Configurée", fake modification history | "Cette rubrique n’est pas encore disponible : aucun réglage n’y est enregistré." |
| API `source` (dashboard, BI 360) | "Base SQLite locale" | "Bac à sable ERP synthétique (SQLite) — données fictives" |

Supplier names in the sandbox keep their `[FICTIF]` suffix. Product, customer and document data shown by BI 360 and the management pages remain sandbox data under the "Données fictives" banner.

## 3. Tests

- API (`tests/qa/tenancy.test.ts`): the demo organization is reported as synthetic sandbox data with `erpStatus: not_configured`; a customer organization without connector gets `none` / "Aucune source ERP connectée".
- Browser (`tests/e2e/app.spec.ts`, desktop and mobile): banner text, organization and user from the session, no "CARTHAGE"/"Sonia"/"Ben Amor" anywhere on the page; Settings shows no invented identifiers, the save button is disabled, the tax section shows the unverified demonstration rules, the integration section shows "Non configuré".
