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
