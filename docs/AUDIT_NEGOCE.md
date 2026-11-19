# Audit vérifiable AI‑NÉGOCE / Vente et SQL Server

Préparé le 19 novembre 2026 — audit en lecture seule, poste `SAFA`.

## Synthèse exécutive

AI‑NÉGOCE/Vente est ouvert sur le dossier `IAI`, le dépôt `DEPOT RT MAHDIA`, avec l’utilisateur `SUPNEGOCE`, version affichée `AI V 2026,10`. La session SQL de ce même utilisateur est connectée à la base `IAINEG` (`database_id = 7`) : il s’agit de la preuve directe reliant le dossier ERP ouvert à la base auditée.

La base contient les briques nécessaires à un premier pilotage commercial : clients, articles, factures/avoirs, lignes, règlements et vues de ventes. Le premier chantier recommandé est **un dashboard “Chiffre d’affaires et marge des ventes”**, fondé sur `dbo.view_detail_fact` et les référentiels client/article. Il répond à un besoin déjà visible dans `Restitutions > Journal des ventes`, `Relevés des ventes` et `Chiffre d'affaire client`, tout en apportant des visualisations et filtres absents des écrans vérifiés.

Le rapprochement chiffré ERP–SQL n’est pas validé dans cette passe : le menu natif est visible, mais l’état de ventes n’a pas été exécuté de façon fiable sans risquer une action de traitement. Aucun total ERP n’a donc été inventé. Ce point est un critère bloquant de recette du dashboard, pas une absence de données SQL.

## Périmètre et preuves

- Application : AI‑NÉGOCE/Vente, dossier `IAI`, dépôt `DEPOT RT MAHDIA`, utilisateur `SUPNEGOCE`, poste `SAFA`.
- Version : `AI V 2026,10` (barre de titre).
- SQL Server : instance locale `SAFA`, SQL Server 2019 `15.0.2000.5`.
- Bases candidates : `bdcommunn`, `IAINEG`, `LaiCentralBase`, `Trefle`.
- Preuve de correspondance : `sys.dm_exec_sessions` retourne pour `login_name='SUPNEGOCE'` : `database_id=7`, `DB_NAME(database_id)='IAINEG'`.
- Captures : `erp_home.png`, `menu_modules.png`, `menu_dossiers.png`, `menu_bases.png`, `menu_ventes.png`, `menu_restitutions.png`, `menu_integrations.png`, `erp_journal_ventes2.png`, `ssms_object_explorer.png`.
- Confidentialité : aucune donnée nominative ni aucune ligne transactionnelle n’est reproduite; seuls schémas et agrégats sont conservés.

## Inventaire fonctionnel

L’inventaire détaillé et statué se trouve dans `INVENTAIRE_NEGOCE.csv`. Les statuts signifient :

- **vérifié** : écran ou contexte effectivement ouvert et inspecté;
- **visible mais non vérifié** : option observée mais écran non parcouru;
- **inaccessible avec le compte actuel** : option grisée ou sous-menu non accessible/confirmé.

Les menus de premier niveau observés sont : Modules, Dossiers, Bases, Ventes, Restitutions, Intégrations, Traitements et Sécurité. Le menu Intégrations a permis de vérifier l’écran `Intégration des Factures à la Comptabilité`, avec filtres de dates, états d’intégration, mode création/ajout et grille de factures. Les actions `Préparation`, import, suppression, annulation, mise à jour et intégration n’ont pas été déclenchées.

## Cartographie SQL

Le détail est dans `MAPPING_SQL_NEGOCE.csv`.

### Volumétrie et couverture

| Objet | Lignes |
|---|---:|
| `dbo.client` | 3 364 |
| `dbo.ARTICLE` | 5 045 |
| `dbo.doc_ent_facture` | 37 278 |
| `dbo.view_detail_fact` | 195 726 |
| `dbo.encentrecenc` | 32 853 |

La vue `dbo.view_detail_fact` couvre du **02/06/2012** au **20/10/2026**, avec 37 278 documents distincts. Les sommes techniques non filtrées des lignes sont `552 762 149,218` en HT et `646 246 716,060` en TTC. Elles ne constituent pas encore un KPI gouverné : le signe des avoirs, les séries, statuts et limites de dépôt doivent être confirmés.

### Relations déclarées et déduites

Les PK clients (`client.code`) et articles (`ARTICLE.REF_C`) sont déclarées. Plusieurs FK de référentiels sont déclarées, par exemple `adresses.codetiers -> client.code` et `article_site.ref_c -> ARTICLE.REF_C`. En revanche, les liens transactionnels principaux observés dans les champs — `doc_ent_facture.clicode -> client.code`, `doc_ligne.ref_c -> ARTICLE.REF_C`, et le triplet série/préfixe/document entre en-tête et lignes — sont **déduits** et doivent être testés pour les orphelins et les multiplications de jointure.

### Requêtes de preuve exécutées

```sql
SELECT session_id, login_name, host_name, database_id,
       DB_NAME(database_id) AS database_name
FROM sys.dm_exec_sessions
WHERE login_name = 'SUPNEGOCE';
```

```sql
SELECT MIN(datefacture), MAX(datefacture), COUNT_BIG(*),
       COUNT(DISTINCT CONCAT(iddocserie,'|',prefixe,'|',numero)),
       SUM(CAST(LigMtHt AS decimal(38,3))),
       SUM(CAST(LigMtttc AS decimal(38,3)))
FROM dbo.view_detail_fact;
```

Les catalogues `sys.objects`, `sys.columns`, `sys.indexes`, `sys.index_columns`, `sys.foreign_keys` et `sys.foreign_key_columns` ont été utilisés pour les métadonnées. Les procédures ont été repérées au catalogue mais leur pertinence fonctionnelle détaillée reste à confirmer avec LAI.

## Rapprochement état ERP / SQL

État candidat : `Restitutions > Journal des ventes`.

| Période | Dépôt/société | Total ERP | Total SQL | Écart | Conclusion |
|---|---|---:|---:|---:|---|
| À définir dans l’état | IAI / DEPOT RT MAHDIA | non obtenu | non calculé au périmètre gouverné | n/a | État visible mais non exécuté; séries, statuts, avoirs et portée dépôt à confirmer |

Le test doit être refait sur deux mois complets comparables. Le SQL de recette devra filtrer exactement les mêmes séries, statuts, dates et dépôt, puis traiter les avoirs selon la règle ERP. Un total SQL brut de la vue ne peut pas remplacer ce rapprochement.

## Réutiliser, mieux visualiser, créer ou confirmer

### Réutiliser tel quel

- `dbo.view_detail_fact` comme source de détail des ventes, après validation du grain et des signes;
- `dbo.client` et `dbo.ARTICLE` comme dimensions;
- les PK de pièces et lignes;
- les états ERP natifs comme références de recette;
- le contexte dossier/dépôt/utilisateur exposé par l’application.

### Mieux visualiser

- évolution du CA HT/TTC dans le temps;
- contribution clients et articles;
- marge brute et taux de marge lorsque le coût est validé;
- avoirs et retours séparés des factures;
- filtres combinés période, dépôt, client, article, famille et série.

### Créer ou faire confirmer par LAI

- dictionnaire des séries et natures de pièces;
- règle de signe des avoirs/retours;
- définition officielle de CA (HT/TTC, statuts inclus, date comptable ou date facture);
- table/règle du dépôt dans les ventes;
- exclusion des pièces annulées ou non statistiques;
- coût de revient gouverné et formule de marge;
- relations transactionnelles non déclarées;
- sémantique des états `etatcompt` et `etatstat`.

## Premier chantier prioritaire : Dashboard CA & marge des ventes

### Rapport source

Référence métier : `Restitutions > Journal des ventes`, complétée par `Restitutions > Relevés des ventes` et `Restitutions > Chiffre d'affaire client`. Source SQL proposée : `dbo.view_detail_fact`, avec `dbo.client`, `dbo.ARTICLE`, familles/sous-familles et la dimension dépôt à confirmer.

### KPI

1. **CA HT net** = somme des montants HT des factures − somme des montants HT des avoirs, sur pièces admissibles.
2. **CA TTC net** = somme des montants TTC des factures − somme des montants TTC des avoirs.
3. **Marge brute** = CA HT net − coût de revient des quantités vendues.
4. **Taux de marge** = marge brute / CA HT net × 100, avec traitement explicite du dénominateur nul.
5. **Nombre de documents** = nombre distinct de `(iddocserie, prefixe, numero)` sur pièces admissibles.

### Graphiques et filtres

- courbe mensuelle CA HT net et marge brute;
- barres Top 10 clients par CA HT;
- barres Top 10 articles/familles par CA HT et marge;
- waterfall factures → avoirs → CA net;
- tableau détaillé exportable avec document, date, client, article, quantité, HT, TTC et marge.

Filtres : période, société/dossier, dépôt, série/type de pièce, statut, client, représentant, article, famille et sous-famille.

### Écarts connus

- aucun total ERP rapproché à ce stade;
- dépôt non encore relié de façon certaine au fait de vente;
- règle des avoirs non confirmée;
- coût de revient et marge à valider;
- vue de détail susceptible de répéter les montants d’en-tête : utiliser les montants de ligne pour les agrégats article et une déduplication au niveau document pour les KPI d’en-tête.

### Critères de recette

1. Écart absolu ERP–dashboard ≤ 0,01 dans la devise de dossier sur deux mois complets, ou écart documenté et accepté.
2. Même nombre distinct de documents que l’état ERP, avec même sélection de séries et statuts.
3. Avoirs testés séparément puis intégrés avec le signe officiel.
4. Aucun double comptage lors des jointures client/article/dépôt; contrôle avant/après jointure.
5. Filtres période, dépôt, client et article reproduisent des sous-totaux vérifiables dans l’ERP.
6. Export du tableau détaillé égal au total affiché et sans données personnelles non nécessaires.

## Reste à vérifier

- Tous les sous-menus de `Bases`, `Restitutions` et `Sécurité`.
- Les écrans DEVIS, commande, livraison, retour, avoir financier et annulation.
- Les formats d’export des états de restitution.
- Les KPI/graphiques éventuels des écrans Statistiques.
- Le menu Traitements et ses droits.
- Les procédures stockées réellement appelées par les états de ventes.
- La table de dépôt et le rattachement dépôt–document.
- Le dictionnaire séries/natures/statuts.
- Deux rapprochements ERP–SQL sur périodes closes.

## État de préparation

**À partager avec réserves.** La base et les objets majeurs sont prouvés, et la spécification du premier dashboard est exploitable. La définition officielle du CA, le traitement des avoirs, le dépôt et le rapprochement chiffré restent à faire confirmer avant développement en production.
