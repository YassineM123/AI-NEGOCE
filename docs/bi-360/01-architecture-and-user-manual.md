# AI-NÉGOCE / NEXORA — BI 360 ENTERPRISE
## Architecture Technique, Formules Métier & Manuel d'Utilisation

---

### 1. Vue d'Ensemble du Projet

La solution **BI 360 Enterprise** d'AI-NÉGOCE transforme les données de gestion commerciale, comptable et logistique (ERP SQLite / PostgreSQL) en indicateurs décisionnels fiables, certifiés et déterministes à destination des dirigeants et directeurs financiers des PME tunisiennes.

#### Principes Fondamentaux de Conception :
1. **Zéro hallucination financière :** Tous les chiffres, montants et pourcentages sont calculés directement à partir des écritures comptables et des pièces validées dans l'ERP (factures de vente, factures d'achat, bons de commande, mouvements de stocks, règlements).
2. **Arithmétique tunisienne exacte :** Calculs en millimes entiers (1 TND = 1 000 millimes) évitant tout biais d'arrondi à virgule flottante (`IEEE 754`).
3. **Séparation nette Taux de marque vs Taux de marge :**
   - **Taux de marque (Commercial) :** `(Marge Brute / Chiffre d'affaires HT) × 100` (part de marge contenue dans 100 DT de vente).
   - **Taux de marge (Achat / Coefficient) :** `(Marge Brute / Coût d'achat HT) × 100` (marge dégagée par rapport au coût de revient).
4. **Cloisonnement multi-tenant & habilitations par agence :**
   - Isolation stricte des données de l'organisation.
   - Filtrage obligatoire `scopedAgencies` garantissant qu'un commercial ou responsable d'agence n'accède qu'aux transactions de son périmètre géographique autorisé.

---

### 2. Architecture Modulaire (Modules A à K)

| Module | Intitulé | Responsabilité & Moteur Backend | Composant React |
|---|---|---|---|
| **A** | **Cockpit Direction** | 12 KPIs stratégiques, suivi des objectifs annuels, tendances mensuelles consolidées, répartition par agence, structure du stock. | `ExecutiveCockpitView.tsx` |
| **B** | **Intelligence Ventes** | Analyse de la dynamique commerciale, panier moyen, courbe Pareto 80/20 (classes A/B/C), Top produits et force de vente. | `SalesIntelligenceView.tsx` |
| **C** | **Rentabilité & Marges** | Pont de marge déterministe (Waterfall Bridge 4 facteurs : Volume/Mix, Prix, Coût, Remise), marges par famille et détection des ventes à perte. | `ProfitabilityView.tsx` |
| **D** | **Achats & Fournisseurs** | Suivi des approvisionnements, concentration du risque Top 3, alertes hausses de prix matières/fournisseurs (> 5%), engagements d'achat. | `PurchasesView.tsx` |
| **E** | **Stocks & Logistique** | Valorisation au PMP, matrices croisées ABC (valeur) & XYZ (variabilité de la demande), alertes de réapprovisionnement et stocks dormants > 90j. | `InventoryView.tsx` |
| **F** | **Finances & Créances** | Encours clients TTC, balance âgée (0-30j, 31-60j, 61-90j, >90j), DSO (délai moyen de recouvrement), Top débiteurs et prévisions de trésorerie nettes. | `FinanceView.tsx` |
| **G** | **Diagnostics Causes** | Décomposition causale déterministe pour répondre aux questions : *"Pourquoi la marge a baissé ?"*, *"Pourquoi les créances ont augmenté ?"*. | `DiagnosticsView.tsx` |
| **H** | **Centre d'Alertes** | Journal opérationnel multi-catégories (Marge, Stocks, Fournisseurs, Créances), seuils de détection paramétrés et acquittement d'état en base. | `AlertCenterView.tsx` |
| **I** | **Prévisions & Simulations** | Régression linéaire avec saisonnalité mensuelle, intervalles de confiance à 95%, métriques de backtest (MAPE, RMSE) et simulations d'élasticité prix/coûts. | `ForecastingView.tsx` |
| **J** | **Reporting & Export** | Moteur d'export corporate CSV et JSON avec en-têtes d'audit, horodatage, filtres appliqués et décomposition tabulaire. | `/api/v1/bi/360/export` |
| **K** | **Intégration Copilot** | Passerelle bidirectionnelle permettant d'approfondir n'importe quel tableau ou graphique via Copilot avec le contexte de données pré-injecté. | `onNavigateCopilot` bridge |

---

### 3. Répertoire des Endpoints d'API (`/api/v1/bi/360/`)

Tous les endpoints acceptent les paramètres universels :
- `period` : `month` \| `quarter` \| `year` \| `custom` \| `all`
- `agency` : nom de l'agence ou `all`
- `from` & `to` : dates `YYYY-MM-DD` (obligatoires en mode `custom`)
- `customerId`, `supplierId`, `categoryId`, `productId`, `repId`

```http
GET /api/v1/bi/360/cockpit
GET /api/v1/bi/360/sales
GET /api/v1/bi/360/profitability
GET /api/v1/bi/360/purchases
GET /api/v1/bi/360/inventory
GET /api/v1/bi/360/finance
GET /api/v1/bi/360/diagnostics
GET /api/v1/bi/360/alerts?includeAcknowledged=true|false
POST /api/v1/bi/360/alerts/:id/acknowledge
GET /api/v1/bi/360/forecasting
GET /api/v1/bi/360/export?module=cockpit|sales|...&format=csv|json
```

---

### 4. Tests & Validation de Qualité

1. **Compilation TypeScript :** `tsc --noEmit` exécuté avec succès (0 erreur).
2. **Vite Bundle Production :** `npm run build` généré en 633 ms sans anomalie de bundling.
3. **Tests Unitaires & Intégration :**
   - `server/bi/semantic.test.ts` : 5 tests passés (exactitude arithmétique, calculs en millimes, filtres SQL).
   - `server/bi/bi-modules.test.ts` : 12 tests d'intégration passés sur l'ERP synthétique (vérification des modules A à J).
   - Global test suite : 490 tests passés.
