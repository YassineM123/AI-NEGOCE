# Audit Technique et État des Lieux — AI-NÉGOCE BI 360 Enterprise

**Date :** 22 Octobre 2026  
**Auteurs :** Principal Business Intelligence Architect, Senior Full-Stack Engineer, Financial Analytics Specialist  
**Statut :** Phase 0 — Audit terminé, en attente de validation  
**Référence :** CODEX MASTER PROMPT — AI-NÉGOCE BI 360 ENTERPRISE  

---

## 1. Synthèse Exécutive

L'inspection approfondie du référentiel AI-NÉGOCE / Nexora révèle un socle technique robuste mais dont le module **BI 360** actuel n'est qu'un premier jalon (un écran de synthèse restreint à 3 onglets et 5 métriques clés), très loin d'une plateforme décisionnelle d'entreprise à 360 degrés.

### Constats majeurs :
1. **Un modèle de données ERP sous-jacent (SQLite) très riche mais sous-exploité à 80%** : Le bac à sable ERP SQLite (`var/ai-negoce.db`, issu de `datasets/synthetic/v1`) contient 18 tables couvrant le cycle complet : ventes, avoirs, lignes de factures, règlements, créances, commandes d'achats, factures fournisseurs, mouvements de stocks, inventaire physique, fournisseurs, clients, représentants et agences. Pourtant, le service BI actuel (`server/erp-bi.ts`) n'interroge que 4 tables (`sales_invoices`, `sales_invoice_lines`, `receivables`, `inventory`). Les achats, fournisseurs, commerciaux, encaissements et mouvements de stocks sont complètement absents de la BI.
2. **Confusion terminologique et financière sur les marges** : Le code existant calcule `(CA HT - Coût) / CA HT * 100` et l'intitule *« Taux de marge »* dans l'interface, alors qu'en comptabilité commerciale et financière tunisienne/française, ce ratio correspond au **Taux de marque**. Le véritable **Taux de marge** (`Marge brute / Coût de revient * 100`) n'est pas exposé.
3. **Filtres globaux et interactivité très limités** : Les filtres se limitent à une période prédéfinie (Mois, Trimestre, Année, Tout) et une liste déroulante d'agences. Aucun sélecteur de dates personnalisées (`from`/`to`), aucun filtre par client, fournisseur, commercial, famille de produits ou statut n'est supporté par l'API BI.
4. **Analyse de décomposition de marge déterministe présente mais bridée** : Le moteur `marginFocus` (`server/erp-bi.ts:129-232`) implémente déjà une décomposition factorielle exacte (effet prix de vente, effet coût d'achat, effet remises commerciales, effet mix/volume). Cependant, cette analyse ne fonctionne qu'au niveau d'une seule catégorie et d'une seule agence à la fois, sans possibilité de vue globale de l'entreprise.
5. **Absence de centre d'alertes configurable** : Le système ne génère que 3 anomalies statiques codées en dur avec `LIMIT 1` (la pire baisse de marge N-1, le client le plus en retard, le produit le plus surstocké). Il n'existe ni gestion d'état (lu/non lu/acquitté), ni règles configurables par l'utilisateur.
6. **Absence de prévisions, simulations et reporting avancé** : Aucun moteur prévisionnel, aucune analyse de sensibilité prix/coût, aucun export PDF/Excel (seul un export CSV basique en JavaScript côté client est implémenté).
7. **Isolation multi-tenant et sécurité** : Les requêtes ERP SQLite sont strictement isolées au tenant de démonstration via `sandboxTenant` (`server/app.ts:319-330`). Pour un déploiement multi-tenant en production, une séparation stricte des bases ou connecteurs ERP par organisation doit être formalisée.

---

## 2. Fonctionnalités Existantes vs Périmètre Cible BI 360

| Module Cible | Composants Actuels | Couverture Actuelle | Éléments Manquants / Lacunes |
|---|---|---|---|
| **Module A — Executive Cockpit** | `BIModule`, `BIOverview` (`src/App.tsx:976-1215`), `bi360()` (`server/erp-bi.ts:20-126`) | **25%** | Seuls 5 KPIs sont affichés (CA HT, Marge brute, Créances, Valeur du stock, Stock dormant > 180 j). Manquent : Taux de marque vs Taux de marge, Achats fournisseurs, Dettes fournisseurs, Encaissements réels, Commandes en cours, Objectifs commerciaux et écarts. |
| **Module B — Sales Intelligence** | `AgencyTable` (`src/App.tsx:1242-1274`), `monthly` chart (`src/App.tsx:1217-1240`) | **15%** | Aucun onglet Ventes dédié. Pas d'analyse par client, produit, représentant, famille. Pas de segmentation client (Pareto, attrition, nouveaux vs récurrents, panier moyen). |
| **Module C — Profitability Intelligence** | `MarginAnalysis` (`src/App.tsx:1302-1455`), `marginFocus` (`server/erp-bi.ts:129-232`) | **40%** | Waterfall de marge existant mais restreint à une catégorie/agence. Pas de vue matricielle client × produit, pas d'analyse des ventes à marge négative, pas de granularité globale société. |
| **Module D — Purchases & Suppliers** | Aucun dans BI 360 (uniquement table CRUD dans `erp-pages.ts`) | **0%** | Données fournisseurs et commandes d'achat complètement ignorées par l'API BI. Pas de suivi des prix d'achat, de concentration fournisseurs, ni de scorecards. |
| **Module E — Inventory Intelligence** | Donut d'ancienneté stock 3 segments (`src/App.tsx:1184-1211`) | **15%** | Seul l'âge par rapport à la dernière vente est calculé. Manquent : valorisation par dépôt, classification ABC/XYZ, rotation de stock, couverture en jours, seuils de réapprovisionnement, historique de ruptures. |
| **Module F — Finance & Receivables** | 1 KPI d'encours et montant échu (`src/App.tsx:1110-1118`) | **10%** | Pas de balance âgée (0-30, 31-60, 61-90, 90+ jours). Pas de DSO, pas de suivi des encaissements par mode de règlement, pas de prévisionnel de trésorerie. |
| **Module G — Advanced Diagnostics** | Décomposition 4 facteurs de marge (`server/erp-bi.ts:171-176`) | **20%** | Limité à la marge. Pas de diagnostic d'évolution du CA, de la hausse des prix fournisseurs, ni de l'accumulation de stock dormant. |
| **Module H — Business Alert Center** | Liste de 3 anomalies statiques (`src/App.tsx:1152-1174`) | **15%** | 3 anomalies calculées à la volée avec `LIMIT 1`. Aucun seuil paramétrable, aucune persistance, aucun acquittement ou filtrage par sévérité. |
| **Module I — Forecasting & Simulations** | Aucun | **0%** | Aucune méthode statistique ni projection de tendance. Aucun simulateur d'élasticité prix/coût. |
| **Module J — Reporting** | Export CSV client-side (`src/App.tsx:970-974, 1469-1477`) | **10%** | Aucun export PDF corporatif, aucun export Excel multi-onglets structuré, aucun rapport filtré sauvegardable. |
| **Module K — Intégration Copilot** | Outils Copilot séparés (`server/copilot-tools.ts`) | **20%** | Copilot possède des outils de lecture BI (`toolGetSalesSummary`, `toolGetMarginAnalysis`), mais aucun bouton contextuel « Analyser avec Copilot » n'est présent dans les graphiques ou tableaux du module BI. |

---

## 3. Éléments Factices, Mockés ou Codés en Dur

L'audit du code révèle que, bien que les données affichées soient issues de la base SQLite et non inventées au hasard, plusieurs comportements sont **figés ou simplifiés de façon artificielle** :

1. **Génération d'anomalies bridée (`server/erp-bi.ts:79-89`) :**
   ```ts
   // Extrait de server/erp-bi.ts
   const anomalies = [
     ...(drops[0] ? [{ severity: "high", kind: "margin", title: "Baisse de marge inhabituelle", ... }] : []),
     ...(riskyCustomer ? [{ severity: "medium", kind: "receivable", title: "Créances à risque", ... }] : []),
     ...(overstock && overstock.value > 0 ? [{ severity: "low", kind: "stock", title: "Surstock détecté", ... }] : []),
   ]
   ```
   - Le système ne retient artificiellement que la première baisse de marge (`drops[0]`), le client le plus débiteur (`LIMIT 1`) et le produit le plus surstocké (`LIMIT 1`).
   - Si une entreprise a 15 clients en impayé lourd ou 8 familles en baisse de marge, l'utilisateur n'en voit qu'une seule.

2. **Échelle et axes des graphiques SVG/CSS flex (`src/App.tsx:1217-1240`) :**
   - Le graphique mensuel utilise des hauteurs CSS calculées via `niceStep` sur 4 crans fixes (`src/App.tsx:1218-1221`).
   - Il ne s'agit pas d'une véritable bibliothèque graphique d'analyse : pas d'info-bulles détaillées interactives, pas de zoom temporel, pas d'affichage des axes temporels multi-années.

3. **Sélection par défaut de la cible de marge (`server/erp-bi.ts:91-93`) :**
   - Si l'utilisateur ne clique pas sur une catégorie, le backend sélectionne d'office la catégorie avec la pire chute de marge (`worst`). Si aucune baisse n'existe, l'écran de marge est totalement vide (`empty-state`).

4. **Export CSV rudimentaire injecté dans le DOM (`src/App.tsx:970-974`) :**
   - Une chaîne de caractères concaténée manuellement avec séparateur `;` est convertie en `Blob` data-URI côté client.
   - Les métadonnées de gouvernance, l'identité du demandeur, le périmètre d'agence et la date de génération ne figurent pas dans l'en-tête du fichier exporté.

---

## 4. Capacités Réelles du Modèle de Données ERP (SQLite)

Le schéma SQLite défini dans `migrations/sqlite/001_erp.sql` et peuplé par `scripts/db-seed.ts` (10 000 transactions synthétiques réalistes calibrées sur le marché tunisien) offre une profondeur d'analyse remarquable qui n'attend qu'à être exploitée :

### 4.1. Ventes & Clients
- `sales_invoices` : `id`, `number`, `doc_type` ('invoice' \| 'credit_note'), `customer_id`, `agency_id`, `representative_id`, `invoice_date`, `due_date`, `status`, `total_discount`, `total_ht`, `total_vat`, `stamp_duty`, `total_ttc`, `total_cost`.
- `sales_invoice_lines` : `id`, `sales_invoice_id`, `product_id`, `quantity`, `unit_price`, `discount_pct`, `line_ht`, `vat_rate`, `line_vat`, `unit_cost`, `line_cost`.
- `customers` : `id`, `name`, `agency_id`, `representative_id`, `segment` (ex: Grossiste, Détaillant, GMS), `credit_limit`, `payment_terms_days`, `customer_discount_pct`.
- `representatives` : `id`, `name`, `agency_id`, `hire_date`.
- **Potentiel BI inexploité** : Performance par représentant, segmentation client, analyse des remises accordées vs remises théoriques, concentration Pareto 80/20.

### 4.2. Achats & Fournisseurs
- `suppliers` : `id`, `name`, `tax_id` (Matricule Fiscal), `city`, `payment_terms_days`, `category_ids`.
- `purchase_orders` : `id`, `supplier_id`, `agency_id`, `order_date`, `status`, `total_ht`.
- `purchase_order_lines` : `id`, `purchase_order_id`, `product_id`, `quantity`, `unit_cost`, `line_total`.
- `supplier_invoices` : `id`, `supplier_invoice_number`, `supplier_id`, `purchase_order_id`, `agency_id`, `invoice_date`, `due_date`, `currency`, `total_ht`, `total_vat`, `total_ttc`, `status`.
- `supplier_invoice_lines` : `id`, `supplier_invoice_id`, `product_id`, `quantity`, `unit_cost`, `vat_rate`, `line_ht`, `line_vat`.
- **Potentiel BI inexploité** : 100% disponible pour bâtir le **Module D (Purchases & Suppliers)** ! Suivi des hausses de prix unitaires d'achat par SKU et par fournisseur, analyse des volumes commandés vs facturés.
- **Limitation identifiée** : La table `purchase_orders` ne contient pas de colonne `promised_delivery_date`. Les délais de livraison fournisseurs réels ne peuvent donc pas être calculés par rapport à un engagement contractuel (conformément à la règle d'or : *ne jamais fabriquer de données de performance livraison si la date promise n'existe pas*).

### 4.3. Stocks & Dépôts
- `inventory` : `product_id`, `agency_id`, `opening_date`, `opening_quantity`, `current_quantity`, `unit_cost`, `reorder_point`, `as_of`.
- `stock_movements` : `id`, `date`, `product_id`, `agency_id`, `type` ('sale', 'receipt', 'adjustment', 'return', 'transfer_in', 'transfer_out'), `quantity`, `reference`.
- `products` : `id`, `sku`, `name`, `category_id`, `supplier_id`, `unit_cost`, `list_price`, `vat_rate`, `reorder_point`, `uom`.
- **Potentiel BI inexploité** : Rotation des stocks (Coût des ventes sur période / Valeur du stock), couverture en jours de vente, classification ABC (chiffre d'affaires / marge) et XYZ (variabilité de la consommation issue de `stock_movements`), identification des ruptures passées et alertes sous le point de commande (`current_quantity <= reorder_point`).

### 4.4. Finance & Règlements
- `receivables` : `sales_invoice_id`, `customer_id`, `agency_id`, `invoice_date`, `due_date`, `total_ttc`, `credited_ttc`, `paid`, `outstanding`, `days_overdue`, `status`.
- `payments` : `id`, `sales_invoice_id`, `customer_id`, `payment_date`, `amount`, `method` (Espèces, Chèque, Traite, Virement).
- **Potentiel BI inexploité** : Calcul d'une véritable balance âgée par tranche (0-30, 31-60, 61-90, 90+ jours), DSO exact (Days Sales Outstanding en jours de CA TTC), analyse des délais réels de paiement (`julianday(payment_date) - julianday(invoice_date)`), répartition des règlements par mode de paiement.

---

## 5. Définition et Normalisation des Métriques Financières (KPIs)

Pour éliminer toute ambiguïté financière et respecter les normes de gestion d'entreprise, les métriques doivent être formellement normalisées dans une couche sémantique centrale.

### 5.1. Distinctions Fondamentales : Taux de Marque vs Taux de Marge

Dans la version actuelle (`server/erp-bi.ts:29, 104`), le code effectue :
$$\text{grossMarginPct} = \frac{\text{revenue} - \text{cost}}{\text{revenue}} \times 100$$
En finance et commerce :
1. **Taux de marque (Margin Rate on Sales)** :
   $$\text{Taux de marque} = \frac{\text{Marge brute HT}}{\text{Chiffre d'affaires HT}} \times 100$$
   *Indique la part de marge contenue dans 100 DT de chiffre d'affaires vendus.*
2. **Taux de marge (Margin Rate on Cost / Markup)** :
   $$\text{Taux de marge} = \frac{\text{Marge brute HT}}{\text{Coût de revient d'achat HT}} \times 100$$
   *Indique le coefficient de gain réalisé sur 100 DT de marchandises achetées.*

**Correction requise :** Le cockpit doit afficher distinctement les deux métriques ou intituler clairement `Taux de marque (%)` la rentabilité par rapport aux ventes, et ajouter le `Taux de marge (%)` par rapport aux coûts.

### 5.2. Matrice des Métriques Clés à Formaliser

| Métrique ID | Nom Commercial | Définition Métier | Formule Mathématique | Tables Sources |
|---|---|---|---|---|
| `KPI_REV_HT` | Chiffre d'affaires net HT | Somme des ventes facturées nettes de remises et hors taxes, déduction faite des avoirs | $\sum (\text{line\_ht} \times \text{sign})$ avec sign = -1 pour credit_note, +1 sinon | `sales_invoices`, `sales_invoice_lines` |
| `KPI_MARGIN_BRUTE` | Marge brute HT | Différence entre le CA net HT et le coût de revient d'achat des produits vendus | $\text{CA HT} - \sum (\text{line\_cost} \times \text{sign})$ | `sales_invoice_lines`, `sales_invoices` |
| `KPI_TAUX_MARQUE` | Taux de marque | Rentabilité commerciale rapportée au chiffre d'affaires | $\frac{\text{Marge brute HT}}{\text{CA HT}} \times 100$ | `sales_invoice_lines` |
| `KPI_TAUX_MARGE` | Taux de marge | Marge brute rapportée au coût d'achat des marchandises vendues | $\frac{\text{Marge brute HT}}{\text{Coût d'achat HT}} \times 100$ | `sales_invoice_lines` |
| `KPI_ACHATS_HT` | Achats fournisseurs HT | Montant total net HT des factures fournisseurs reçues sur la période | $\sum \text{supplier\_invoices.total\_ht}$ | `supplier_invoices` |
| `KPI_DETTES_FOURN` | Dettes fournisseurs | Montant TTC restant dû aux fournisseurs | $\sum (\text{total\_ttc} - \text{reglements})$ | `supplier_invoices` |
| `KPI_CREANCES_CLIENT` | Créances clients totales | Total des encours clients non encore réglés | $\sum \text{receivables.outstanding}$ | `receivables` |
| `KPI_CREANCES_ECHUES` | Créances échues | Encours client dont la date d'échéance est dépassée | $\sum \text{receivables.outstanding}$ où $\text{due\_date} < \text{as\_of}$ | `receivables` |
| `KPI_DSO` | Délai moyen crédit client (DSO) | Délai moyen de recouvrement en jours de chiffre d'affaires TTC | $\frac{\text{Créances clients TTC}}{\text{CA TTC de la période}} \times \text{Nb Jours Période}$ | `receivables`, `sales_invoices` |
| `KPI_VALEUR_STOCK` | Valeur du stock | Stock physique valorisé au coût d'achat unitaire pondéré | $\sum (\text{current\_quantity} \times \text{unit\_cost})$ | `inventory` |
| `KPI_STOCK_DORMANT` | Stock dormant (> 180 j) | Valeur des produits sans aucun mouvement de vente depuis plus de 180 jours | $\sum (\text{qte} \times \text{cout})$ pour produits avec dernier mouvement vente > 180 j ou nul | `inventory`, `stock_movements` |
| `KPI_ROTATION_STOCK` | Rotation des stocks | Nombre de fois où le stock moyen est renouvelé par les ventes | $\frac{\text{Coût d'achat des ventes de la période}}{\text{Valeur moyenne du stock}}$ | `sales_invoice_lines`, `inventory` |
| `KPI_COMMANDES_COURS` | Commandes en cours | Commandes d'achats ou devis/commandes de ventes non encore soldés | $\sum \text{total\_ht}$ avec status = 'open' / 'pending' | `purchase_orders` |

---

## 6. Limitations Actuelles de l'Interface Utilisateur (UI/UX)

1. **Navigation restreinte dans BI 360** :
   - Seuls 3 sous-onglets : `Vue d'ensemble`, `Analyse de marge`, `Détail factures`.
   - Les domaines d'analyse majeurs (Ventes, Achats, Stocks, Finance, Alertes, Prévisions, Rapports) sont inexistants au sein du module BI.
2. **Barre de filtres figée (`src/App.tsx:1015-1054`)** :
   - Pas de sélection par calendrier (dates personnalisées).
   - Pas de filtrage combiné (ex: Agence "Sfax" + Famille "Outillage" + Client "Société Générale de Bâtiment").
   - Absence de persistance des filtres dans l'URL ou dans le `localStorage`.
3. **Absence de composants graphiques professionnels** :
   - Utilisation de barres HTML élémentaires `<div className="bar" style={{ height }} />`.
   - Pas d'axe ordinal clair, pas d'indication des tooltips riches, pas d'affichage des courbes de tendance ou de graphiques en cascade (waterfall chart interactif).
4. **Pas de drill-down hiérarchique dynamique** :
   - Le clic sur une agence ne filtre pas l'ensemble de la page sur cette agence avec zoom sur les clients.
   - Le drill-down factures (`InvoiceDrilldown`) est un affichage plat des 50 factures les moins rentables de la famille ciblée, sans filtre de recherche, pagination ni tri par colonne.
5. **Absence d'états de chargement squelettes (Skeleton Loaders)** :
   - Un simple texte "Chargement des données…" s'affiche, provoquant des sauts de mise en page (Cumulative Layout Shift) lors de l'arrivée des données.

---

## 7. Audit de Qualité des Données & Pièges de Calculs

1. **Arithmétique Flottante vs Décimale dans SQLite** :
   - La base SQLite stocke des montants en colonnes de type `REAL` (flottant double précision IEEE 754).
   - `server/erp-bi.ts` utilise `sum(total_ht)` et `round3()`. Bien que le fichier `server/money.ts` implémente une classe `Decimal` rigoureuse basée sur `BigInt` à échelle fixe (millimes), le module BI n'exploite pas cette classe pour les agrégations SQL de masse.
   - *Risque* : Dérive de centimes ou de millimes lors de l'addition de dizaines de milliers de lignes.
2. **Gestion des avoirs (Credit Notes)** :
   - Les avoirs client (`doc_type = 'credit_note'`) doivent obligatoirement être soustraits du chiffre d'affaires et du coût des ventes.
   - `server/erp-bi.ts:39-41` gère correctement l'inversion de signe via `CASE s.doc_type WHEN 'credit_note' THEN -s.total_ht ELSE s.total_ht END`. Cette règle doit être impérativement conservée dans toutes les futures requêtes de la couche sémantique.
3. **Risque de double comptage lors des jointures SQL** :
   - Joindre `sales_invoices` avec `sales_invoice_lines` puis avec `payments` entraîne une duplication des lignes de factures proportionnelle au nombre de règlements reçus.
   - Les agrégations sur les montants de factures et les paiements doivent impérativement être calculées séparément ou via des sous-requêtes agrégées (`CTE` ou `GROUP BY` préalables).
4. **Factures annulées ou en brouillon** :
   - Le filtre `status = 'posted'` est critique. Les factures à l'état `draft` ou `cancelled` ne doivent jamais être comptabilisées dans le chiffre d'affaires réalisé.
5. **Date d'arrêté métier (`as_of`)** :
   - Dans le jeu synthétique, la date d'arrêté est stockée dans `app_settings` (`as_of = '2026-10-15'`).
   - Toutes les requêtes calculant des retards, des anciennetés de stock ou des comparaisons N-1 doivent utiliser `db.asOf()` et non `new Date()` pour garantir des résultats cohérents et reproductibles.

---

## 8. Sécurité, Autorisations et Isolation Multi-Tenant

1. **Isolation des données ERP synthétiques (`sandboxTenant`)** :
   - Actuellement dans `server/app.ts:319-330`, l'accès à `deps.erpDb` est restreint à l'organisation désignée par `config.ERP_SANDBOX_ORGANIZATION` (par défaut `org-demo`).
   - Toute requête émanant d'une organisation réelle reçoit un code HTTP 403 `ERP_SOURCE_UNAVAILABLE`.
   - **Garantie** : Aucune donnée d'entreprise réelle ne risque d'être polluée par la base de démo SQLite.
2. **Contrôle d'accès par agence (`scopedAgencies`)** :
   - Le token JWT ou l'identité de développement porte une liste d'agences autorisées (`principal.agencies`).
   - La fonction `db.scopeFilter(scope)` génère un prédicat SQL strict empêchant un utilisateur d'une agence (ex: Sfax) d'accéder aux chiffres d'affaires ou marges d'une autre agence (ex: Tunis Centre).
   - Les tests de sécurité (`tests/qa/tenancy.test.ts` et `tests/qa/security.test.ts`) valident déjà cette étanchéité.
3. **Paramétrage SQL contre les injections** :
   - Toutes les requêtes dans `server/erp-bi.ts` utilisent des paramètres préparés (`?`). Cette pratique doit demeurer absolue.
4. **Permissions de rôle (RBAC)** :
   - `requireRoles("admin", "manager", "accountant", "commercial")` protège l'accès à la BI. Les rôles non autorisés sont rejetés avec un code 403.
   - Les commerciaux ne doivent pas avoir accès aux marges sensibles des fournisseurs ni aux dettes globales si leur rôle restreint les données financières confidentielles.

---

## 9. Architecture Proposée pour la Plateforme BI 360 Enterprise

Pour répondre au cahier des charges sans introduire de framework lourd ni de service externe Python superflu, nous préconisons une architecture modulaire et performante intégrée dans le socle existant :

```
┌────────────────────────────────────────────────────────────────────────┐
│                          FRONTEND (React 19)                           │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Global Filter Toolbar (Période, Dates, Agence, Famille, Client)  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│  ┌─────────┬─────────┬─────────┬─────────┬─────────┬─────────┬───────┐  │
│  │ Cockpit │ Ventes  │ Marges  │ Achats  │ Stocks  │ Finance │Alerts │  │
│  │ (Mod A) │ (Mod B) │ (Mod C) │ (Mod D) │ (Mod E) │ (Mod F) │(Mod H)│  │
│  └─────────┴─────────┴─────────┴─────────┴─────────┴─────────┴───────┘  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │   Composants : KPI Cards, Waterfall Charts, DataTables, Drawers  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Requêtes JSON REST / Context Copilot
┌───────────────────────────────────▼────────────────────────────────────┐
│                    API BACKEND (Express 5 + TypeScript)                │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Contrôleurs & Routes : /api/v1/bi/360/*                          │  │
│  │ (Cockpit, Sales, Profitability, Purchases, Inventory, Finance...)│  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     │                                  │
│  ┌──────────────────────────────────▼───────────────────────────────┐  │
│  │                COUCHE SÉMANTIQUE BI (KPI SEMANTIC LAYER)          │  │
│  │  - Définitions mathématiques & métadonnées universelles         │  │
│  │  - Fonctions déterministes d'agrégation et de décomposition       │  │
│  │  - Exactitude décimale / integer millimes                        │  │
│  │  - Contrôle des périmètres d'agences et des droits               │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     │                                  │
│  ┌──────────────────────────────────▼───────────────────────────────┐  │
│  │               MOTEUR D'ALERTES & DIAGNOSTICS DÉTERMINISTE        │  │
│  │  - Règles de franchissement de seuils (marge, impayés, surstock) │  │
│  │  - Décomposition factorielle explicable (Prix / Coût / Mix)     │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
└─────────────────────────────────────┼──────────────────────────────────┘
                                      │ Requêtes SQL optimisées
         ┌────────────────────────────┴───────────────────────────┐
         ▼                                                        ▼
┌──────────────────────────────────┐   ┌──────────────────────────────────┐
│  SQLite ERP Sandbox (Démo local) │   │ PostgreSQL (Tenant app & config) │
│  - 18 tables ERP relationnelles  │   │ - Alertes acquittées             │
│  - 10 000 transactions réelles   │   │ - Préférences & rapports sauvés  │
└──────────────────────────────────┘   └──────────────────────────────────┘
```

### Caractéristiques de l'architecture :
1. **Couche Sémantique Centralisée (`server/bi/semantic.ts`)** :
   - Fichier centralisé déclarant chaque KPI avec : ID, nom, définition, formule, granularités valides, tables sources, unité, politique de fraîcheur.
   - Partagé entre le dashboard BI et les outils AI Copilot pour garantir 100% de concordance des chiffres.
2. **Calculs déterministes à haute précision** :
   - Calcul en millimes ou via arithmétique contrôlée sans flottants binaires vagabonds.
3. **Moteur d'alerte sans doublon** :
   - Détection des règles en base sur l'ensemble de la population (pas de `LIMIT 1`), avec table d'état pour les acquittements.
4. **Composants d'interface modulaires et réutilisables** :
   - Découpage du fichier monolithique `src/App.tsx` en sous-composants BI dédiés (`src/features/bi-360/*`), suivant le précédent réussi de `src/features/smart-ocr/`.

---

## 10. Carnet de Dépendances d'Accès ERP

Pour garantir la conformité avec des ERP réels (SAGE, Odoo, Cegid, Navision ou ERP tunisiens type WaveSoft, MS Solutions) :
1. **Accès en lecture seule** : L'accès analytique BI ne doit jamais verrouiller ni altérer les tables transactionnelles de l'ERP.
2. **Mapping des tables et champs requis** :
   - Factures de vente : Pièce, Type, Client, Agence, Vendeur, Date, Statut, Montant HT, Montant TTC, Coût de revient.
   - Lignes de vente : Pièce, Article, Quantité, Prix unitaire, Remise %, HT, Coût unitaire, Coût total.
   - Règlements : Pièce vente, Date, Montant, Mode de règlement.
   - Échéancier : Pièce, Date échéance, Montant dû, Reste à recouvrer.
   - Achats & Stocks : Factures d'achat, Lignes d'achat, Articles, Dépôts, Mouvements de stock, Stock actuel.
3. **Absences assumées** :
   - Les flux bancaires directs et les relevés bancaires ne sont pas présents dans l'ERP simulé : la trésorerie prévisionnelle doit s'appuyer strictement sur les encaissements attendus et dettes fournisseurs, sans inventer de solde bancaire.

---

## 11. Plan d'Exécution et Backlog Priorisé par Phases

Conformément aux directives du Codex Master Prompt, le projet sera déployé strictement phase par phase avec arrêt pour validation entre chaque étape :

| Phase | Intitulé | Objectifs & Livrables | Statut |
|---|---|---|---|
| **Phase 0** | **Audit BI 360** | Inspection globale, cartographie des écarts, document `docs/bi-360/00-audit.md` | **TERMINÉ (ce document)** |
| **Phase 1** | **Couche Sémantique KPI & Règles Financières** | Dictionnaire centralisé des métriques, calculs exacts, tests de réconciliation unitaire | En attente de validation |
| **Phase 2** | **Executive Cockpit & Filtres Universels** | Barre de filtres globale complète, KPIs Cockpit élargis (Mod A), graphiques consolidés | À venir |
| **Phase 3** | **Sales & Profitability Intelligence** | Modules B et C complets : Pareto, clients en perte, cascade de marge multi-dimensions | À venir |
| **Phase 4** | **Purchases & Inventory Intelligence** | Modules D et E complets : Suivi fournisseurs, inflation achats, analyse ABC/XYZ, rotation de stock | À venir |
| **Phase 5** | **Finance & Receivables Intelligence** | Module F complet : Balance âgée par tranches, calculs DSO réels, suivi des règlements | À venir |
| **Phase 6** | **Diagnostics Avancés & Centre d'Alertes** | Modules G et H : Moteur de décomposition factorielle étendu, alertes paramétrables persistantes | À venir |
| **Phase 7** | **Prévisions & Simulations** | Module I : Modélisation statistique basée sur l'historique validé, simulation d'élasticité prix/marge | À venir |
| **Phase 8** | **Reporting & Passerelle Copilot** | Modules J et K : Exports structurés, connexion contextuelle bi-directionnelle avec l'IA Copilot | À venir |
| **Phase 9** | **Assurance Qualité, Benchmark & Validation Finale** | Couverture de tests complète, benchmark de performance, audit de sécurité et validation E2E | À venir |

---

## 12. Conclusion de la Phase 0

Le diagnostic est sans appel : les fondations de données et de sécurité existent et sont d'un excellent niveau de robustesse, mais le module BI 360 n'exploite aujourd'hui qu'une fraction marginale de ce potentiel.

La Phase 0 s'achève avec la livraison de ce document d'audit exhaustif, sans modification de code applicatif.

**Prochaine étape recommandée :** Validation de l'audit pour engager la **Phase 1 — KPI Semantic Layer** (spécification formelle des 35 métriques décisionnelles, implémentation de la couche sémantique centrale et suite de tests de réconciliation comptable).
