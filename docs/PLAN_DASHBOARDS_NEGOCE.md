# Plan de dashboards AI‑NÉGOCE Intelligence Suite

## Classement priorisé

| Rang | Dashboard | Valeur métier | Données disponibles | Facilité de validation | Décision |
|---:|---|---|---|---|---|
| 1 | Ventes & CA | Très forte | Forte : factures, lignes, clients, articles | Forte dès que le Journal est rafraîchi | Premier développement |
| 2 | Recouvrement & risque client | Très forte | Forte : factures, règlements, vues d'échéance | Moyenne : affectations à contrôler | Deuxième lot |
| 3 | Marge & rentabilité | Forte | Moyenne/forte : table statistique et vues de marge | Moyenne : coût historique à confirmer | Après validation LAI |
| 4 | Commandes & conversion | Forte | Moyenne : devis/commandes/livraisons présents | Moyenne/faible : lignage des transformations | Lot suivant |
| 5 | Stock & réapprovisionnement | Forte | Moyenne : nombreuses tables et vues stock | Faible tant que la formule de disponible n'est pas confirmée | Après cadrage stock |
| 6 | Promotions & prévisions | Moyenne | Tables et états visibles | Faible : règles et historique à qualifier | Phase avancée |

## 1. Dashboard Ventes & CA — priorité 1

Ordre de lecture : volume global → évolution → contributeurs → corrections → détail.

- Cartes : CA HT brut, CA HT net, CA TTC net, nombre de factures, panier moyen HT.
- Graphiques : courbe CA mensuel avec comparaison N-1; waterfall factures → avoirs → CA net; Pareto clients; barres familles/articles.
- Tableau : date, dépôt, série, numéro, client, représentant, article, quantité, HT, TTC, statut.
- Filtres : période, dépôt, série/type, statut, client, représentant, famille, article.
- Clic : mois → documents; client → factures; article → lignes de facture.
- Source ERP : Journal des ventes, Chiffre d'affaire client, Factures détaillées par article.

## 2. Dashboard Recouvrement & risque

Ordre : exposition → échéance → performance → dossiers à traiter.

- Cartes : créances totales, créances échues, taux de recouvrement, délai moyen de paiement, nombre de clients en dépassement.
- Graphiques : soldes âgés empilés; courbe encaissements; Pareto créances client; dispersion encours/délai.
- Tableau : client, document, facture, échéance, solde, jours de retard, commercial, dernière action si disponible.
- Filtres : date d'arrêté, dépôt, client, secteur, représentant, mode de paiement, tranche d'âge.

## 3. Dashboard Marge & rentabilité

Ordre : rentabilité totale → évolution → contributeurs → anomalies.

- Cartes : marge brute, marge nette, taux de marge, CA sous marge minimale.
- Graphiques : courbe CA/marge; Pareto marge client; barres marge article/famille; nuage CA–taux de marge.
- Tableau : facture, client, article, CA, prix de revient, marge, taux, seuil.
- Filtres : période, dépôt, client, représentant, famille, article, facture réglée/non réglée.
- Prérequis : confirmer `prix_revient`, `pmpa`, `margebrut`, `margenet` et leur historicité.

## 4. Dashboard Commandes & conversion

- Cartes : devis, taux de conversion, commandes ouvertes, montant restant, délai moyen de livraison.
- Graphiques : funnel devis → commande → livraison → facture; courbe backlog; barres ancienneté; performance commerciaux.
- Tableau : document source, client, dates, montant, exécuté, restant, statut.
- Filtres : période, dépôt, représentant, client, statut, famille/article.

## 5. Dashboard Stock & réapprovisionnement

- Cartes : valeur du stock, articles en rupture, articles sous sécurité, couverture moyenne, montant à commander.
- Graphiques : Pareto valeur stock; matrice rotation/couverture; courbe mouvements; barres stock disponible/encours.
- Tableau : dépôt, article, famille, stock, réservé, disponible, seuils, ventes moyennes, couverture, commande proposée.
- Filtres : dépôt, famille, article, marque, actif, rupture, rotation.

## Premier incrément de développement

Le premier dashboard est **Ventes & CA**, limité initialement à quatre KPI robustes et un KPI dérivé : CA HT brut, CA TTC brut, nombre de factures, panier moyen HT et montant des avoirs. La marge est exclue du premier incrément tant que le coût historique n'est pas certifié. Le CA net pourra être activé dès validation du dictionnaire des séries et du signe des avoirs.

Critère d'entrée en développement : obtenir le total d'une période close dans le Journal des ventes et figer les valeurs de dépôt, séries et statuts. Critère de sortie : écart absolu ERP–SQL inférieur ou égal à 0,001 TND sur deux périodes closes, même nombre de documents et aucun double comptage après jointure.
