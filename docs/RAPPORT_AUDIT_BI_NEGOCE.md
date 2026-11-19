# Audit BI approfondi — AI‑NÉGOCE / Vente

Préparé le 19 novembre 2026 — dossier `IAI`, dépôt `DEPOT RT MAHDIA`, base `IAINEG`.

## Synthèse exécutive

L'installation contient un périmètre BI plus riche que le premier inventaire ne le montrait. Le dictionnaire interne `dbo.descrip_menu`, les écrans ouverts et le catalogue SQL attestent des analyses natives sur les ventes, la marge, les prix, les promotions, les devis/commandes, le stock, les encaissements, les créances et les soldes âgés. Le potentiel observable est structuré en six dashboards; **Ventes & CA** reste le meilleur premier chantier car ses données sont directement disponibles au grain document et ligne, et le Journal des ventes fournit l'état de référence le plus proche.

Le Journal des ventes a été ouvert. Il permet de filtrer le journal, le statut fiscal, le dépôt et la période, puis d'afficher Date, Numéro, Client, HT, TTC et taxes. Les exports Excel, CSV et PDF sont visibles. La période a été positionnée au 01–20 octobre 2026 dans les contrôles, mais l'aperçu n'a pas été rafraîchi par l'automatisation : aucun total ERP n'est donc déclaré comme rapproché. SQL retourne sur cette période **28 documents, 357 430,356 TND HT et 383 878,325 TND TTC** au niveau en-tête.

## Couverture réelle

| Menu | Vérifié par écran | Visible/catalogué à approfondir | Inaccessible | Motif principal |
|---|---:|---:|---:|---|
| Restitutions | 2 | 34 | 0 | Sous-écrans non ouverts; dictionnaire interne disponible |
| Ventes | 0 | 9 | 0 | Écrans de saisie non ouverts pour éviter mutation |
| Bases | 0 | 7 | 0 | Sous-menus non parcourus |
| Modules | 0 | 6 | 1 | Production grisée; autres modules non parcourus |
| Dossiers | 0 | 8 | 0 | Changement de contexte et actions administratives non déclenchés |
| Intégrations | 1 | 2 | 0 | Préparation/export non déclenchés |
| Traitements | 0 | 7 | 0 | Libellés prouvés par `descrip_menu`, traitements non lancés |
| Sécurité | 0 | 0 | 1 | Aucun sous-menu confirmé avec le compte actuel |

Le fichier `INVENTAIRE_NEGOCE_V2.csv` porte le statut détaillé et la preuve de chaque ligne. Un élément prouvé uniquement par `dbo.descrip_menu` n'est pas présenté comme écran vérifié.

## Capacités Data Analyse et BI observables

### Ventes

- Journal fiscal et commercial avec HT, TTC et taxes.
- CA client, ventes détaillées par article, BL par client/article/représentant.
- Analyses quotidiennes, synthétiques, annuelles et ventilées.
- Evolution des prix de vente et performance des promotions.
- Prévisions et évolution du CA par groupe clients.

### Rentabilité

- Etat des marges par article et facture.
- Marge sur factures réglées.
- Champs SQL explicites `prix_revient`, `margebrut`, `margenet`, `pmpa` et `dprixa`.
- La présence des champs prouve la possibilité technique, pas encore la définition comptable ni l'historicité.

### Cycle commercial

- Suivi et édition des devis et commandes.
- Etats d'avancement des devis/commandes.
- Commandes non soldées, solde et réanimation des documents.

### Stock

- Articles à commander, avec ou sans encours.
- Vues de stock, disponible, réservations et mouvements dans `IAINEG`.
- Valeur et couverture de stock possibles, sous réserve de confirmer PMP et formule du disponible.

### Recouvrement

- Relevés quotidiens d'encaissements, impayés et annulés.
- Documents non réglés, factures en cours, extraits de compte.
- Soldes âgés, risques âgés, scoring et performance de recouvrement.
- Vue native avec tranches 0, 30, 60, 90, 120 et >120 jours.

## Test ERP–SQL ventes

### Périmètre préparé

- Etat : `Restitutions > Journal des ventes`.
- Journal : Factures.
- Affichage : Tous.
- Dépôt observé : choix Encours/Tous/Famille; le dépôt actif de la fenêtre est `DEPOT RT MAHDIA` (`site_param.id_site=1`).
- Période SQL : 01/10/2026 inclus au 20/10/2026 inclus.

### Résultat SQL

| Série | Etat comptable | Etat statistique | Documents | HT | TTC |
|---|---|---|---:|---:|---:|
| 0110 | I | N | 1 | 55 667,610 | 66 907,181 |
| 0110 | N | N | 3 | 235 644,871 | 238 250,274 |
| 015 | N | N | 19 | 64 349,335 | 76 613,308 |
| 016 | N | N | 1 | 544,538 | 648,000 |
| 017 | N | N | 1 | 492,228 | 585,751 |
| 025 | N | N | 2 | 560,337 | 668,801 |
| 045 | N | N | 1 | 171,437 | 205,010 |
| **Total** |  |  | **28** | **357 430,356** | **383 878,325** |

La vue de détail donne le même HT, mais `383 853,325` TTC, soit **25,000 TND de moins** que les en-têtes. Une requête indépendante sur les composantes d’en-tête retourne exactement `SUM(mttimbre) = 25,000`, tandis que transport, TVA transport, frais, TVA frais et arrondi sont nuls sur la période. L’écart est donc expliqué par les timbres : les KPI documentaires doivent utiliser `doc_ent_facture`, tandis que les analyses article utilisent les montants de ligne et rapprochent séparément les charges d’en-tête.

### Statut de recette

| KPI | Statut | ERP | SQL | Ecart |
|---|---|---:|---:|---:|
| Nombre de factures | À tester | aperçu non rafraîchi | 28 | n/a |
| CA HT brut | À tester | aperçu non rafraîchi | 357 430,356 | n/a |
| CA TTC brut | À tester | aperçu non rafraîchi | 383 878,325 | n/a |
| TTC lignes vs en-têtes | Rapproché techniquement | n/a | -25,000 | écart égal aux timbres d'en-tête |
| CA net d'avoirs | À tester | non isolé | non calculé | dictionnaire séries requis |
| Marge brute | À tester | état non ouvert | champs disponibles | coût historique requis |

## Questions à poser à LAI

1. Quelles séries correspondent aux factures, avoirs, factures export et exonérées?
2. `etatcompt='I'` signifie-t-il intégré, imputé ou autre, et doit-il être inclus dans le CA?
3. `etatstat='N'` est-il le statut normal inclus dans les statistiques?
4. Le dépôt du document est-il porté par la série, une table d'en-tête générique ou un autre champ?
5. Le Journal « dépôt Encours » signifie-t-il dépôt actif, tous les sites autorisés ou dépôt de la série?
6. Les avoirs sont-ils stockés positifs puis soustraits, ou déjà signés négativement?
7. Quelle différence explique 25,000 TND entre TTC en-tête et lignes sur octobre 2026?
8. Le prix de revient des vues de marge est-il figé à la date de vente, recalculé au PMP, ou actuel?
9. Les tables `statistique` sont-elles des agrégats préparés; quelle fréquence et quel traitement les actualisent?
10. Quelle définition officielle doit gouverner CA HT net, marge brute, marge nette et taux de recouvrement?

## Ordre de développement

1. Créer la couche ventes au grain document depuis `doc_ent_facture` et la couche lignes depuis `view_detail_fact`.
2. Charger et gouverner le dictionnaire séries/statuts/dépôts.
3. Rapprocher deux périodes closes avec le Journal des ventes.
4. Livrer Ventes & CA avec CA HT, CA TTC, factures, panier moyen et avoirs.
5. Ajouter CA client/article après contrôles de jointure.
6. Développer Recouvrement, puis Marge après certification du coût.
7. Aborder Commandes et Stock après validation de leurs règles métiers.

## Premier dashboard retenu

**Ventes & CA** avec cinq KPI : CA HT brut, CA TTC brut, nombre de factures, panier moyen HT et montant des avoirs. Ce choix maximise la valeur métier et la disponibilité des données tout en restant vérifiable par un état ERP natif. La marge est volontairement différée : les champs existent, mais leur définition historique n'est pas encore suffisamment prouvée.

## Conclusion de validation

**À partager avec réserves.** Le catalogue et le plan de développement sont exploitables. Les chiffres SQL sont reproductibles, mais aucun KPI de ventes n'est encore rapproché à un total ERP rafraîchi. Le premier développement peut commencer par la modélisation et les contrôles de qualité; la mise en production des cartes CA doit attendre le rapprochement sur deux périodes closes.

## Complément d'audit exhaustif — 19 novembre 2026

La session reconnectée confirme le contexte `IAI`, dépôt `DEPOT RT MAHDIA`, utilisateur `SUPNEGOCE`, version `AI V 2026,10`. Les écrans ci-dessous ont été ouverts directement dans l'installation et disposent désormais d'une preuve PNG dans `PREUVES_NEGOCE` :

- `Restitutions > Extrait de compte` : mouvements en cours/échus/soldés, non facturés, impayés non réglés, colonnes date, origine, nature, numéros interne/externe, référence, échéance, débit; soldes débiteur/créditeur et solde global.
- `Restitutions > Journal des ventes` : journal Factures, statuts d'affichage, dépôt en cours/tous/famille, période Du/Au; colonnes date, numéro, client, suspension, HT, TTC et taxes; export natif visible.
- `Restitutions > Relevés des ventes > Générales` : factures, factures + BL en cours ou BL en cours, détail, client Du/Au, période; débit, avoir et solde.
- `Restitutions > Relevés des ventes > Ventes et encaissements` : tiers Du/Au, période, débit, crédit et solde.
- `Restitutions > Listes > Liste des factures` : recherche document/code client/nom client, famille, plage de documents et dates; numéro, date, tiers et montant HT.
- `Restitutions > États d'avancement > Devis/Commandes` : analyse par document, tiers ou article, période et dépôt; référence, intitulé, quantité et quantité exécutée.
- `Restitutions > États des articles > À commander` : modèle, dépôt, département, famille, marque, choix, collection et intervalle article; stock minimal, maximal et stock à ce jour.
- `Restitutions > Gestion des paquets > Consultation` : disponible/réservé/vendu/retour, paquet, état, nombre de pièces, quantité disponible, prix HT, dépôt et dimensions.
- `Restitutions > Statistiques > Édition > Synthèse quotidienne` : article, article×tiers, article×catégorie, article×secteur, tiers×catégorie, période, tous dépôts, coût actuel ou historique et famille.
- `Restitutions > Statistiques > Édition > Annuelles` : période mois/année et jusqu'à trois axes hiérarchiques (département, famille/sous-famille, fournisseur, article, groupe tiers, tiers, secteur, catégorie, représentant).
- `Restitutions > Statistiques > Édition > Performance des promotions` : promotion, département, famille, intervalle article; stock et quantité vendue observables dans la structure du rapport.
- `Restitutions > Statistiques > Édition > Évolution des prix de vente` : année, famille, choix, marque, intervalle article; prix de vente moyen par mois.
- `Restitutions > Statistiques > Édition > État des marges > Par facture` : client, date de début, dépôt, montant HT, prix de revient et marge.
- `Restitutions > Statistiques > Édition > Factures réglées` : client, famille, sélection des factures et détail; date, facture, article, montant HT et prix de revient.
- `Restitutions > Statistiques > Scoring` : critères d'affichage et comparaisons annuelles CA, prévision et pourcentage de marge par tiers, famille et sous-famille. L'ouverture déclenche automatiquement un calcul natif; celui-ci s'est terminé sans action supplémentaire.

Ces éléments passent de **visible à approfondir** à **vérifié visuellement**. Les chiffres restent **à rapprocher** lorsqu'aucun total rafraîchi n'est affiché dans l'aperçu.
