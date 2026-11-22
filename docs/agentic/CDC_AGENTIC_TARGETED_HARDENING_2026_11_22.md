# AI-NÉGOCE — Agentic : amélioration ciblée contre le cahier des charges v1.0

**Référence contractuelle** : `AI_NEGOCE_Cahier_des_charges_Intelligence_Suite_V1 (1)(5).pdf`, daté du 18 novembre 2026, 253 identifiants (DIR 9, REV 40, FIN 60, SCA 72, BSA 72).

**Statut** : fonctions **partiellement développées** sur données fictives, actions manuelles. Ce rapport ne certifie pas la conformité complète des 253 exigences.

## Fonctionnalités livrées

| Exigence CDC | Couverture effectivement implémentée | Ce qui reste non démontré |
|---|---|---|
| REV-01, REV-05, REV-06, REV-07 | CA et marge des comptes lorsque coûts complets; familles détenues; comparaison de catégories observées auprès des autres clients de la même agence; devis/brouillon sous revue | Contacts CRM, historique devis, recouvrement client 360 complet, politiques commerciales, affinité prédictive, qualité des pairs |
| FIN-14, FIN-16, FIN-40 | File de contrôle des créances avec délai de retard, montants échus, références de factures et paiements documentés reliés; classement sans effacer automatiquement les encours | Imputation exacte des avoirs, litiges, rapprochement bancaire, méthode de recouvrement consentie et statut ERP réel |
| SCA-01, SCA-07, SCA-10, SCA-25 | Proposition minimale au seuil, coût indicatif si connu, mise en regard d'une prévision SKU backtestée, preuves de stock; action brouillon | MOQ, délai fournisseur, réservation, disponibilité effective, budget d'achat validé, bon de commande ERP, date de rupture prédite avec stock projeté |
| SCA-19, SCA-20 | Candidats de transfert source/destination existants gardés avec revue humaine | Aucun WMS, transit, capacité, réservation ni coût de transfert validés |
| BSA-01, BSA-04, BSA-19 | Analyse agence en périmètre autorisé, marge si coûts complets, créances, dates et factures; liste explicite des prérequis pour ouvrir une nouvelle agence | Étude de marché Sfax/Sousse, concurrence, coûts immobiliers, demande externe et dossier d'investissement officiel |
| BSA-11, FIN-43, FIN-44, FIN-45 | Nouveau scénario **hypothétique** d'expansion : CAPEX, BFR, CA additionnel, marge brute, OPEX, cannibalisation, taux d'actualisation, VAN, retour simple en mois, cash post-investissement et plancher de liquidité | Calendrier ramp-up, fiscalité, subventions, valeur terminale, coûts variables, risques, business plan et décision d'investissement réel |
| DIR-04, DIR-05, DIR-09 | Dossier transversal des quatre agents avec version de snapshot, source, agence, période, statut de couverture, pièces documentées, vérifications humaines obligatoires et aucune écriture ERP | Cohérence de tous les contrats KPI LAI, preuve des effets réellement observés, audit/réconciliation ERP, programmation autonome de la décision |
| DIR-06 | Missions/approbations persistantes PostgreSQL déjà présentes ; hash de preuve élargi aux paiements clients et factures fournisseurs documentaires | ERP live, contrôle de clôture des actions et automatisation des sorties |

Ces références désignent des **sous-fonctions** démontrables, jamais l'exigence entière. Les nouveaux développements ne constituent pas une réception intégrale du CDC.

## Décisions chiffrées et limites

- **Commercial** : proposer une catégorie complémentaire uniquement lorsqu'au moins deux comptes de l'agence la documentent et que le client ne l'a pas achetée pendant la période. Ne jamais affirmer qu'il acceptera l'offre.
- **Finance** : l'encours provient du snapshot `receivables`, les paiements liés de `collections`. Le paiement ne réduit **pas une seconde fois** l'encours, car il peut déjà être imputé dans le snapshot. Toute anomalie est renvoyée à la finance.
- **Approvisionnement** : manque minimal `ceil(max(0,seuil-disponible))` ; coût indicatif `manque × coût unitaire`. Sans MOQ, lead-time et réservations, aucune quantité optimisée ni commande n'est annoncée.
- **Expansion** : VAN calculée uniquement à partir de valeurs et horizon saisis par l'utilisateur, pas des valeurs de CA BI. Si le cash calculé après CAPEX/BFR est inférieur au plancher, avertir **même si la VAN est positive**.
- **Director** : lecture seule, dossiers et hypothèses séparés, validation humaine, aucun outil avec droit de write-back ERP.

## Tests prévus dans la branche

- `server/agents/specialist-action-plans.api.test.ts` : proposition commerciale liée aux factures, isolation agence, recouvrement documenté, proposition stock, comparaison expansion, VAN/payback/cash-floor, refus d'accès.
- `server/agents/final-demo-recipe.pg.test.ts` : BI / Data Science / Agentic / quatre spécialistes depuis le **même snapshot PostgreSQL** ; nouvelle révision et invalidation d'approbation après modification de données.
- `server/agents/revenue-12000-customers.test.ts` : garde-fou pour le volume documentaire fictif de 12 000 clients.
- CI `agentic-specialists-and-director`, `agentic-command-center`, `quality`, `revenue-growth-agent`.

## Restant indispensable pour homologuer les 253 exigences

Le document `docs/agentic/CDC_CAPABILITY_MATRIX_README.md` reste conservateur et **ne doit pas être présenté comme terminé**. Pour chaque ID, il faut : preuve exhaustive des sous-fonctions, tests négatifs/permissions, jeux de données étiquetés, statut de workflow, logs, supervision, seuils approuvés, coûts réels, API LAI officielle, décision humaine et reprise après incident.

**La connexion ERP LAI est reportée volontairement** pour cette démonstration. Aucun paiement, ordre d'achat, devis, transfert, communication client ou nouvelle agence n'est exécuté.
