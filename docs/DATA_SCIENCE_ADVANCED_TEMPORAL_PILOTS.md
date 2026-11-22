# AI-NÉGOCE — Data Science avancée, pilotes évalués (22/11/2026)

## Architecture et données communes

Le backend continue d'utiliser **le même snapshot PostgreSQL versionné et isolé par organisation** pour BI, Data Science et les cinq agents. Il ne comporte pas de deuxième base analytique.

En plus de `sales`, `inventory` et `receivables`, la commande déjà présente
`npm run analytics:seed -- --source=synthetic --replace` importe maintenant deux relations optionnelles depuis le **SQLite synthétique** généré :
- `collections` : `payments` → `sales_invoices` → `agencies`, avec ID d'événement, numéro de facture, date et montant TND. Une écriture de paiement documentaire n'est pas un rapprochement bancaire.
- `supplierDocuments` : `supplier_invoices` → `purchase_orders` → `suppliers/agencies`, avec IDs stables, dates de commande et facture, intervalle en jours et montant TND. **Facturation ne signifie pas réception ni performance OTIF**.

Les tables sources comportent leurs propres liens et dates ; aucune date de livraison, solde bancaire ou label de résiliation contractuelle n'est inventé. Le snapshot PostgreSQL enregistre les nouvelles relations en JSONB et les protège par les règles RLS existantes et sa révision SHA-256. Les données absentes restent optionnelles (aucun fallback de chiffres fabriqués).

## Modèles et comparaison objective

| Domaine | Cible historique | Modèles comparés | Métrique sur période non entraînée | Règle |
|---|---|---|---|---|
| Churn proxy | Absence de nouvel achat positif dans les 90 jours après cutoff, **pas résiliation réelle** | Prévalence globale, classes récence, fréquence, récence × fréquence avec lissage | Brier (plus petit meilleur) sur 3 dates de cutoff finales, train sur dates antérieures | Minimum 100 observations train, 40 test, 10 cas de chaque label en train, 3 dans le holdout. N'accepter la variante que si elle bat le taux de base de 0,002 Brier |
| Recouvrement documenté | Montants historiques des `payments` par mois clos | Dernier mois, moyenne mobile 3 mois, moyenne mobile 6 mois | WAPE en walk-forward sur 4 mois, aucun réapprentissage sur la valeur cible du mois | Au moins 10 mois, couverture des mois ≥80 %, WAPE ≤45 %. Ne mesure pas le cash bancaire ou les décaissements |
| Demande SKU × agence | Quantités facturées, avoirs négatifs | Dernier mois, moyenne mobile 3 mois, saisonnier si 16 mois | WAPE, biais sur 4 mois | Pilote déjà présent ; minimum 10 mois et 8 mois actifs, refus en cas d'historique non fiable |
| Fournisseurs | Délai de commande à **facture fournisseur** | Moyenne historique, moyenne mobile 6 pièces, médiane mobile 6 | MAE en jours sur 4 documents chronologiquement réservés | Au moins 12 jalons par fournisseur/agence, MAE ≤30 jours ; pas de mesure livraison ni OTIF |

Tous les scores sont reproductibles, utilisent des **bornes de date et un périmètre agence** et affichent les cas d'abstention. Les comparateurs ne peuvent jamais déclencher une action de paiement, achat ou transfert. `verifiedProduction=false`.

### Ce que le laboratoire prouve — et ce qu'il ne prouve pas

**Prouvé si la CI passe :** calculs chronologiques reproductibles, segmentation agence, métriques contre références, mise à jour sur la même version du dataset et conservation du résultat dans les rapports DS.

**Non prouvé :** calibration de probabilités de churn individuel, labels contractuels, liquidité bancaire réelle, réceptions d'achats, délai promis, prix d'achat négocié, promotion MLOps ou performance sur des données de LAI ERP. Toute absence de lien documentaire rend le modèle indisponible.

## Pour activer les nouveaux historiques dans la démo

Sur la branche d'intégration (le code doit être fusionné à `feature/ai-negoce-complete-demo` avant le lancement) :

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
# Terminal 2 :
npm run agentic:dev
```

**Attention :** `db:seed` reconstruit le SQLite synthétique. Le `--replace` met à jour le snapshot PostgreSQL, sa révision et rend les anciennes approbations dépendantes de ce snapshot périmées.

Ouvrir `http://127.0.0.1:8444`, connecter la session sandbox, puis dans Data Science visiter les pages **Accueil, Churn, Finance, Fournisseurs, Modèles**. Les scores sont soumis au filtre de période : T3/T4 seuls peuvent volontairement montrer `insufficient_history` ; utiliser une période comprenant l'historique complet pour étudier les modèles.

## Tests de non-régression

```powershell
npm run typecheck
npm run agentic:typecheck
npx vitest run server/data-science-advanced.test.ts server/data-science-platform.test.ts server/sku-demand-model.test.ts
# Sur DB PostgreSQL de TEST et non la base de démo :
npx vitest run server/analytics-database.pg.test.ts
npx playwright test --config dashboards/agentic-ai/playwright.config.ts
```

**Phase de validation restant pour LAI :** séries véritables de ventes et résiliations, paiements rapprochés, bons de réception, règles d'unités pour SKU, jeux de labels approuvés par le métier, monitoring de dérive, validation chronologique hors échantillon, contrôle des permissions et validation des décisions par responsable métier.
