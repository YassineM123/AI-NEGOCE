# AI-NÉGOCE Copilot 2.0 — Authorized ERP Tools Catalog

This catalog documents the parameterized business tools available to the AI-NÉGOCE Copilot engine. Every tool executes deterministic queries against the verified SQLite/Postgres ERP database, strictly enforces agency RBAC scopes, and returns structured data with real source references.

---

## 1. toolGetSalesSummary
- **Purpose**: Retrieves aggregated sales revenue, invoice counts, average order values, and branch distribution.
- **Parameters**:
  - `agency` *(optional)*: Single agency filter (e.g. `"Tunis Centre"`, `"Sfax"`).
  - `from` *(optional)*: ISO start date `YYYY-MM-DD`.
  - `to` *(optional)*: ISO end date `YYYY-MM-DD`.
- **Security Check**: Verified against `scopedAgencies(principal)`. Access to out-of-scope agencies returns `status: "denied"`.
- **Sample Output**:
  ```json
  {
    "status": "ok",
    "tool": "sales_summary",
    "summary": "Chiffre d'affaires global de 1 245 800 TND réalisé sur 452 ventes.",
    "table": [{ "agency": "Tunis Centre", "revenue": 580000, "count": 210 }],
    "sources": ["ERP Nexora — Journal des ventes 2025/2026"]
  }
  ```

---

## 2. toolGetMarginAnalysis
- **Purpose**: Computes gross margin, margin percentage, discount impact, and causal explanation for margin fluctuations.
- **Parameters**:
  - `agency` *(optional)*: Agency filter.
  - `from` *(optional)*: ISO start date.
  - `to` *(optional)*: ISO end date.
- **Sample Output**:
  ```json
  {
    "status": "ok",
    "tool": "margin_analysis",
    "summary": "Taux de marge brute global de 28,4 % (marge brute de 353 800 TND).",
    "explanation": "La variation s'explique par une augmentation des remises accordées sur la famille outillage et la hausse des prix d'achat fournisseurs.",
    "sources": ["ERP Nexora — Écritures analytiques et calculs de marge"]
  }
  ```

---

## 3. toolGetCustomerReceivables
- **Purpose**: Identifies outstanding customer debts, overdue invoices, and aging breakdown.
- **Parameters**:
  - `agency` *(optional)*: Agency filter.
  - `minDaysOverdue` *(optional)*: Aging threshold (e.g. `30`, `60`, `90`).
- **Sample Output**:
  ```json
  {
    "status": "ok",
    "tool": "receivables",
    "summary": "Encours total impayé de 184 200 TND, dont 42 100 TND avec plus de 60 jours de retard.",
    "table": [{ "customer": "STE GENERALE TRAVAUX", "overdue": 24500, "days": 72 }],
    "sources": ["ERP Nexora — Balance âgée clients"]
  }
  ```

---

## 4. toolGetSupplierPurchases
- **Purpose**: Summarizes purchasing expenditures, top suppliers, and unit cost variations.
- **Parameters**:
  - `agency` *(optional)*: Agency filter.
  - `limit` *(optional)*: Number of top suppliers to return (default 5).
- **Sample Output**:
  ```json
  {
    "status": "ok",
    "tool": "suppliers",
    "summary": "Volume total d'achats fournisseurs de 892 000 TND. Top fournisseur : COMPTOIR TECHNIQUE.",
    "table": [{ "supplier": "COMPTOIR TECHNIQUE", "amount": 312000 }],
    "sources": ["ERP Nexora — Registre des achats et factures fournisseurs"]
  }
  ```

---

## 5. toolGetSlowMovingInventory
- **Purpose**: Detects dormant and slow-moving stock where capital is tied up without sales for >90 days.
- **Parameters**:
  - `agency` *(optional)*: Agency filter.
- **Sample Output**:
  ```json
  {
    "status": "ok",
    "tool": "dormant_inventory",
    "summary": "14 articles identifiés en stock dormant, représentant une valeur immobilisée de 48 300 TND.",
    "table": [{ "reference": "ART-8492", "label": "Groupe électrogène 5kVA", "stock": 4, "value": 14000 }],
    "sources": ["ERP Nexora — Balance d'inventaire et rotation des stocks"]
  }
  ```

---

## 6. toolGetProductStock
- **Purpose**: Reports articles below reorder thresholds and items nearing stockout.
- **Parameters**:
  - `agency` *(optional)*: Agency filter.
  - `category` *(optional)*: Product category filter.
- **Sample Output**:
  ```json
  {
    "status": "ok",
    "tool": "low_stock",
    "summary": "8 articles sous le seuil critique de réapprovisionnement.",
    "table": [{ "reference": "ART-104", "name": "Disque diamant 230mm", "current": 2, "threshold": 10 }],
    "sources": ["ERP Nexora — État des stocks par agence"]
  }
  ```

---

## 7. toolCompareBranches
- **Purpose**: Multi-agency benchmarking comparing turnover, margin rate, and outstanding receivables.
- **Parameters**:
  - `agencies`: List of agency names to compare.
- **Sample Output**:
  ```json
  {
    "status": "ok",
    "tool": "agency_comparison",
    "summary": "Comparaison calculée : Tunis Centre (CA 580k TND, marge 31%), Sfax (CA 410k TND, marge 27%).",
    "table": [
      { "agency": "Tunis Centre", "revenue": 580000, "marginRate": "31.0%" },
      { "agency": "Sfax", "revenue": 410000, "marginRate": "27.0%" }
    ],
    "sources": ["ERP Nexora — Comparatif multi-agences"]
  }
  ```
