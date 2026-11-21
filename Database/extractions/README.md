# Extractions BI de démonstration

Extraction effectuée le 19 novembre 2026 depuis `IAINEG`, en lecture seule.

Les fichiers sont séparés par `;`, encodés en UTF‑8 et ne contiennent ni nom, adresse, téléphone, matricule fiscal, numéro de document réel, code client réel ni référence article réelle. Les identifiants `document_id`, `client_id` et `article_id` sont des préfixes stables de SHA‑256, utilisables pour les jointures de démonstration.

| Fichier | Grain | Période/arrêté | Provenance | Statut |
|---|---|---|---|---|
| `ventes/journal_ventes_2026_demo.csv` | document | 01/01–20/10/2026 | `doc_ent_facture` | SQL à rapprocher |
| `ventes/journal_ventes_2026_10_01_20.csv` | document | 01–20/10/2026 | `doc_ent_facture` | SQL à rapprocher au Journal |
| `ventes/ventes_quotidiennes_2026.csv` | jour | 01/01–20/10/2026 | `doc_ent_facture` | SQL à rapprocher |
| `ventes/ca_clients_2026.csv` | client pseudonymisé | 01/01–20/10/2026 | `doc_ent_facture` | SQL à rapprocher |
| `ventes/ventes_articles_2026.csv` | article pseudonymisé | 01/01–20/10/2026 | `view_detail_fact`, `ARTICLE` | SQL à rapprocher |
| `marge/marge_mensuelle_2026.csv` | mois × dépôt | 01/01–31/10/2026 | `statistique` | Coût à confirmer |
| `stock/stock_disponible_demo.csv` | dépôt × article | état courant | `stk_art`, `ARTICLE` | Formule à rapprocher |
| `recouvrement/encaissements_mensuels_2026.csv` | mois × type × état | 01/01–31/10/2026 | `encentrecenc` | SQL à rapprocher |
| `recouvrement/creances_agees_demo.csv` | client × tranche | arrêté 20/10/2026 | `View_echeancefact` | SQL à rapprocher |

Les nombres décimaux conservent une précision de trois décimales, correspondant aux montants TND observés dans NÉGOCE.

## Phase 2 — contrôles de confiance (21/11/2026)

Les identifiants sont **pseudonymisés**, et non des identifiants de production à exposer au public. Les 3 158 documents du journal sont répartis en **3 101 TND**, **56 EUR**, **1 USD**. Il est incorrect de les additionner en TND ; les KPI partagés n'utilisent que les documents explicitement en TND.

Le journal n'a pas de colonne agence/dépôt. Il ne fournit pas non plus de coût par facture. Le fichier de stock ne comporte pas de PMP pour **4 618 positions sur 4 619**. Les créances sont agrégées par client et tranche sans date d'échéance par facture. Ces champs ne sont **pas complétés artificiellement**.

Deux scénarios 100 % synthétiques, sans ID commun avec IAINEG, ont été ajoutés :

- `demonstration/fournisseurs_livraisons_demo_synthetique.csv` : 8 commandes hypothétiques ;
- `demonstration/plan_tresorerie_demo_synthetique.csv` : 6 mois de flux hypothétiques, soldes mathématiquement réconciliés.

Contrôle reproductible : `npm run demo:database:audit`. Mode intégré local : `DEMO_DATA_SOURCE=extractions`. Voir [`docs/PHASE2_DATABASE_DEMO.md`](../../docs/PHASE2_DATABASE_DEMO.md). Les fichiers extraits d'origine restent inchangés.
