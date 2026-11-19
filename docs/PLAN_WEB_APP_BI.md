# Plan de la future web app BI AI‑NÉGOCE

## Navigation proposée

1. Vue d’ensemble
2. Ventes
3. Clients & articles
4. Marge
5. Stock
6. Recouvrement
7. Commandes
8. Qualité et rapprochements

## Vue d’ensemble

- Cartes : CA HT, CA TTC, documents, panier moyen, encaissements.
- Graphiques : évolution mensuelle CA/encaissements; waterfall facturation → timbres → TTC; Top clients.
- Filtres : période, dépôt, série, état comptable/statistique.
- Sources NÉGOCE : Journal des ventes, Chiffre d'affaire client, Relevés ventes et encaissements.
- Statut : ventes et encaissements extraits en SQL; rapprochement ERP restant.

## Ventes

- Cartes : CA HT, CA TTC, documents, panier moyen, timbres.
- Graphiques : courbe quotidienne; ventilation par série; comparaison HT/TTC; waterfall factures/avoirs après dictionnaire des séries.
- Tableau : `journal_ventes_2026_demo.csv`, avec document et client pseudonymisés.
- Clic : jour → documents; série → documents; client → historique.
- Origine : `Restitutions > Journal des ventes` et listes par facture.

## Clients & articles

- Cartes : clients actifs, part Top 10, articles vendus, quantité.
- Graphiques : Pareto clients; Pareto articles; treemap famille/sous-famille; prix moyen pondéré.
- Tableaux : clients puis articles pseudonymisés.
- Origine : Chiffre d'affaire client et factures détaillées par article.

## Marge

- Cartes : CA net statistique, coût net, marge brute, taux de marge.
- Graphiques : courbe mensuelle par dépôt; Pareto articles/clients après extraction détaillée; nuage CA–marge.
- Tableau : mois, dépôt, CA, coût, marge.
- Origine : Etat des marges par article/facture/factures réglées.
- Avertissement visible : coût historique et traitement de préparation à valider.

## Stock

- Cartes : valeur PMP, stock disponible, références en rupture, réserves.
- Graphiques : Pareto valeur; matrice stock/disponible; barres par famille.
- Tableau : article pseudonymisé, stock, réserves, disponible, valeur.
- Origine : Module Stock et Etats des articles à commander.
- Avertissement : extraction calculée depuis `stk_art`; vue native en erreur de conversion et formule ERP à rapprocher.

## Recouvrement

- Cartes : encaissements, créances, créances échues, clients exposés.
- Graphiques : encaissements mensuels; soldes âgés empilés; Pareto des soldes.
- Tableau : client pseudonymisé, tranche, solde.
- Origine : Relevé quotidien, Documents non réglés, Soldes âgés et Performance de recouvrement.

## Commandes

- Cartes futures : devis, conversion, commandes ouvertes, montant restant.
- Graphiques futurs : funnel devis → commande → livraison → facture; ancienneté du backlog.
- Statut : structure fonctionnelle repérée, extraction non réalisée car le lignage documentaire reste à vérifier.

## Qualité et rapprochements

- Tableau par KPI : ERP, SQL, écart, statut, dernière date de test.
- Contrôles : doublons de clés, orphelins, couverture de jointure, fraîcheur, statut des séries.
- Résultat disponible : le TTC des lignes est inférieur de 25,000 TND aux en-têtes du 1–20 octobre 2026, différence exactement égale aux timbres.

## Fiches « Dans NÉGOCE → Dans la web app »

### Journal des ventes → Ventes interactives

- NÉGOCE : aperçu tabulaire, période/dépôt/type, exports Excel/CSV/PDF.
- Web : cartes HT/TTC/documents, courbe, séries, tableau filtrable et drill-down.
- Données : `EXTRACTIONS_BI/ventes/journal_ventes_2026_10_01_20.csv`.
- Validation : SQL reproductible; total ERP à rafraîchir.

### Chiffre d'affaire client → Pareto clients

- NÉGOCE : état CA client repéré.
- Web : barres Top 10 + courbe cumulée et détail des documents.
- Données : `EXTRACTIONS_BI/ventes/ca_clients_2026.csv`.
- Validation : SQL à rapprocher.

### Etat des marges → Rentabilité

- NÉGOCE : états par article, facture et factures réglées.
- Web : cartes CA/coût/marge, courbe mensuelle, anomalies de marge.
- Données : `EXTRACTIONS_BI/marge/marge_mensuelle_2026.csv`.
- Validation : définition du coût à confirmer.

### Stock / À commander → Disponibilité

- NÉGOCE : stock et états de réapprovisionnement repérés.
- Web : valeur, rupture, réserves, tableau priorisé.
- Données : `EXTRACTIONS_BI/stock/stock_disponible_demo.csv`.
- Validation : formule à rapprocher.

### Soldes âgés → Risque client

- NÉGOCE : soldes et risques âgés repérés dans Recouvrement.
- Web : barres par tranche, Pareto client, factures après clic.
- Données : `EXTRACTIONS_BI/recouvrement/creances_agees_demo.csv`.
- Validation : SQL à rapprocher.

## Parcours de démonstration recommandé

1. Montrer le Journal des ventes et ses filtres.
2. Ouvrir la page Ventes avec la même période; passer des cartes à la courbe puis aux 28 documents pseudonymisés.
3. Afficher le contrôle de rapprochement, notamment le traitement séparé des 25,000 TND de timbres.
4. Passer au Pareto clients puis cliquer sur un `client_id` pour montrer le détail sans révéler son identité.
5. Ouvrir Marge en signalant clairement le statut « à certifier » du coût.
6. Terminer par Stock et Soldes âgés pour illustrer l'extension opérationnelle de la suite.

## Couverture finale

Le manifeste recense 14 groupes de rapports : 2 écrans directement observés, 10 groupes dotés d'une extraction SQL réutilisable (plusieurs partageant le même dataset) et 4 groupes restant sans extraction ou validation complète. Les jeux exportés couvrent 9 fichiers distincts et conservent un lignage stable via `document_id`, `client_id` et `article_id` pseudonymisés.

| Module | Rapports repérés | Vérifiés par écran | Avec extraction réutilisable | Restant à traiter |
|---|---:|---:|---:|---:|
| Restitutions | 11 | 2 | 7 | 4 |
| Modules / Stock | 1 | 0 | 1 | 0 |
| Recouvrement | 2 | 0 | 2 | 0 |
| **Total** | **14** | **2** | **10** | **4** |

« Avec extraction » signifie qu'un fichier pseudonymisé est prêt pour la web app; cela ne signifie pas encore que son total est équivalent à NÉGOCE. Les statuts de rapprochement sont portés dans le manifeste.
# Extension de demonstration complete

Le Centre BI local contient maintenant 13 pages. Les neuf extractions pseudonymisees restent les sources des domaines deja disponibles. Quatre jeux synthetiques, ranges sous `EXTRACTIONS_BI/demonstration`, completent les ecrans ERP verifies mais sans donnees suffisantes :

- Commandes & devis : avancement, montant HT, quantites et taux d'execution.
- Promotions & prix : CA promotionnel, quantites, remises et prix moyen.
- Scoring : score client, segment, CA, marge, retard et decision proposee.
- Paquets : etat, pieces, quantite, disponible, reserve et vendu.

Ces quatre pages portent toujours le statut visible **Simulation de demonstration**. Elles illustrent le produit cible et ne constituent pas des observations reelles du client.
