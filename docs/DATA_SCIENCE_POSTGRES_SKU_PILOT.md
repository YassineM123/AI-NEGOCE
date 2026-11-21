# Lot Data Science — demande SKU sur snapshot PostgreSQL (pilote)

## Périmètre livré
- Le jeu de ventes métier conserve désormais la **quantité réelle des lignes de facture** (`sales.quantity`, nullable), en plus de l'identifiant stable de produit/client, agence, date, montant et coût.
- `datasetFrom` lit `sales_invoice_lines.quantity` de SQLite synthétique; `analytics:seed -- --source=synthetic --replace` republie le jeu dans le **même snapshot PostgreSQL** que BI et Agentic. Pas de second référentiel.
- `server/sku-demand-model.ts` réalise un pilote de prévision de quantité par **SKU × agence**, sans reconstruire artificiellement l'historique de stock.
- Comparaison walk-forward de quatre derniers mois clos : dernière observation, moyenne mobile 3 mois, saisonnalité 12 mois si au moins 16 mois disponibles. WAPE et biais publiés avec WAPE de référence.
- Adoption conditionnelle : >=10 mois observés, >=8 mois de demande positive, WAPE <=45%, |biais| <=30%; sinon `insufficient_history` / `rejected_backtest`.
- Les calculs sont intégrés à `dataScience.analysis.skuDemand` sur `/api/v1/analytics/overview` avec les mêmes filtres société/agence/période que BI et Agentic. La vérification de production demeure **false**.

## Exécution de démonstration
Dans un environnement isolé, configurer `NODE_ENV=development`, `AUTH_MODE=local-dev`, `UNIFIED_ANALYTICS_SOURCE=postgres`, `DATABASE_URL` PostgreSQL **local** et organisation `demo-fictive`.

```powershell
npm ci
npm run db:dev:up
npm run migrate
$env:SYNTHETIC_PERIOD_END = "2026-10-20"
npm run dataset:generate
Remove-Item Env:SYNTHETIC_PERIOD_END
npm run db:seed
npm run analytics:seed -- --source=synthetic --replace
npm run dev:api
```

Le portage du dataset doit être relancé après modification de la source. Le mode `--replace` incrémente la révision, les snapshots et invalide les approbations dépendant de la version précédente.

## Recette
```powershell
npm run typecheck
npm run agentic:typecheck
npx vitest run server/sku-demand-model.test.ts server/data-science-platform.test.ts server/analytics-platform.test.ts
# avec TEST_DATABASE_URL et une base de TEST dédiée
npx vitest run server/analytics-database.pg.test.ts
```

Vérifier : même snapshotId dans les trois vues; quantités manquantes => abstention; aucune fuite agence; factures annulées exclues; avoirs en quantité négative; quatre mois de holdout; statuts et sources; pas d'action ERP automatique.

## Limites explicites
1. Cette évolution ne constitue **pas** une homologation Data Science. Le générateur de référence produit 10 000 factures sur 2 000 produits : de nombreux SKU peuvent avoir trop peu de mois de demande pour un modèle admissible. Il est normal qu'ils restent sans prédiction.
2. Les annulations d'inventaire, ruptures de stock et ventes perdues ne sont pas distinguées. Les mois sans vente sont assimilés à zéro de **ventes observées**, et non à une demande latente certaine.
3. Les quantités hors unité cohérente (colis versus pièces) nécessitent un contrat d'unité métier. La prévision ne déclenche ni achat, ni transfert, ni réapprovisionnement.
4. Un dataset d'essai autonome avec continuité mensuelle est couvert par les tests unitaires; il ne représente pas une mesure de performance sur l'ERP LAI.
5. Prévisions financières, churn supervisé, approvisionnement, segmentation multi-critères, dérive en exploitation et rapprochement ERP restent des lots distincts.
