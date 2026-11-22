# AI-NÉGOCE — Historiques fictifs reliés et exploitables (22/11/2026)

## Objectif

Conserver une **unique base analytique PostgreSQL versionnée** pour BI 360, Data Science et Agentic. Le générateur fictif existant contient déjà des pièces sources ; le présent lot **extrait leurs relations** plutôt que d'inventer de nouveaux KPI.

### Relations activées depuis le SQLite synthétique

| Historique | Source SQLite | Clé métier | Utilisation |
|---|---|---|---|
| Ventes et avoirs | sales_invoices, sales_invoice_lines | agence, client ID, produit ID, numéro et date | CA/marge, fréquence, demande |
| Paiements | payments → sales_invoices | facture + client ID + agence | encaissements documentaires, revue créances |
| Fournisseurs | purchase_orders → supplier_invoices | fournisseur, agence, commande | temps commande→facture, non OTIF |
| **Mouvements de stock** | stock_movements → products → agencies | SKU, produit ID, agence, date, référence mouvement | preuve historique de stocks et contrôle des flux |
| **Achats par article** | purchase_order_lines → supplier_invoice_lines | commande, produit, fournisseur, agence | quantité commandée et quantité **facturée**, pas livrée |
| **Référentiel client** | customers → agencies/representatives | client ID + agence | segments, conditions de paiement et plafonds de crédit **fictifs** |
| Stock d'ouverture | inventory → products/agencies | SKU + agence + date ouverture | réconciliation historique, sans reconstruire un stock non documenté |

Le générateur source fixe actuellement par défaut 500 profils clients, 100 fournisseurs, 2 000 articles, environ 10 000 documents de vente, 1 500 commandes, 3 000 factures fournisseurs et 30 000 mouvements. **Chiffres de configuration**, non promesse de volumes utilisables : l'audit calcule les comptes réellement chargés après génération.

### Règles de calcul et abstention

- Stock : `stock_final_reconstitué = stock_ouverture + somme(mouvements documentés)`. **Aucun stock historique publié si le journal est absent, l'ouverture manque ou la position courante ne se réconcilie pas à ±0,001 unité.** Si réconcilié, quantité à date de fin = ouverture + mouvements jusqu'à cette date.
- Achats : quantité facturée liée à une commande + référence de chaque facture fournisseur. Ce calcul **ne mesure ni les réceptions, ni la livraison à temps, ni les réservations**. Si la quantité facturée est supérieure à celle commandée, le contrôle le signale.
- CRM : plafonds de crédit et segments sont des caractéristiques **fictives** du référentiel. L'encours est relié par **ID client et agence**, jamais par le nom seul.
- Supply Chain : un fournisseur éventuellement affiché est celui d'une **commande antérieure liée au SKU**, pas un fournisseur actuellement capable de livrer. Le rapprochement prévisions SKU utilise le vrai ID produit lorsque les mouvements/commandes le documentent.
- Le simulateur d'entreprise fictive ajoute dorénavant un mouvement pour les ventes/réapprovisionnements et une ligne de commande pour la facture fournisseur fictive, afin de ne pas désynchroniser l'historique.
- Toutes les fonctions respectent le filtre agence et les droits existants. Les rapports Data Science ajoutent uniquement des **résumés et 10 preuves au maximum**, jamais le journal entier brut. Le snapshot source reste limité à 24 Mio.

### Activation de la démo locale

```powershell
git fetch origin
git switch feature/ai-negoce-complete-demo
git pull --ff-only origin feature/ai-negoce-complete-demo
npm ci
npm run db:dev:up
npm run migrate

# Étape facultative sur une copie de démonstration neuve UNIQUEMENT :
$env:SYNTHETIC_PERIOD_END = "2026-10-20"
npm run dataset:generate
Remove-Item Env:SYNTHETIC_PERIOD_END
npm run db:seed

# Vérifier les vrais liens et quantités dans le SQLite généré :
npm run qa:linked-data

# Remplacer le snapshot existant de démonstration — écrase ses anciennes données fictives :
npm run analytics:seed -- --source=synthetic --replace

# 3 terminaux :
npm run dev:api
npm run agentic:dev
npm run analytics:demo:live -- --agency=Sfax --ticks=4 --interval-seconds=5
```

**ATTENTION :** la régénération du jeu synthétique et le `--replace` détruisent/écrasent les modifications de démo précédentes. Utiliser une copie de la base. Tout changement de snapshot provoque l'invalidation des anciennes approbations si l'empreinte est modifiée.

Ouvrir le Command Center `http://127.0.0.1:8444` → **Plateformes BI / DS** → Data Science → Stocks / Fournisseurs / Qualité. Choisir T4 2026, puis T3 2026 pour comparer la vue historique reconstituée. La vue classique « stocks actuels » reste explicitement N/D pour une période ancienne ; seule la nouvelle table historique réconciliée affiche les stocks datés.

## Reproductibilité et sécurité

```powershell
npm run qa:linked-data
npm run typecheck
npm run agentic:typecheck
npx vitest run server/linked-business-evidence.test.ts
# Tests PostgreSQL de test uniquement (TEST_DATABASE_URL) :
npx vitest run server/analytics-database.pg.test.ts
```

Le job `quality` appelle désormais l'audit des liens du **vrai SQLite généré** avant de lancer les autres tests. Le scénario PostgreSQL vérifie l'isolation agence/tenant, la conservation de ces relations et la validité du contrat DS.

## Limites inchangées

Ce lot **n'ajoute pas** une banque, un moteur OCR, de vraies commandes de livraison, des résultats de transport, ni un connecteur officiel LAI ERP. Il ne démontre pas non plus la conformité des 253 exigences Agentic. Tous les profils, commandes, mouvements et dossiers utilisés ici sont **entièrement fictifs**.
