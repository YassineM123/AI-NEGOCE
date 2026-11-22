# AI-NÉGOCE — Démonstration d'entreprise vivante sur PostgreSQL

**Objet :** alimenter BI 360, Data Science et Agentic avec **une même base PostgreSQL fictive qui change automatiquement** lorsque le processus de simulation est lancé. Aucun ERP LAI, service bancaire ou système fournisseur réel n'est utilisé.

## Fonctionnement

La simulation modifie, en cycle déterministe, quatre éléments du **snapshot PostgreSQL synthétique** :

| Tour | Événement | Pièces liées et métriques concernées |
|---|---|---|
| 1 | Vente fictive | Une ligne de facture et une créance liées au client/article/agence existants ; le stock diminue. Le CA et la marge BI, Data Science et Revenue Growth sont recalculés |
| 2 | Encaissement fictif | Un paiement lié à une créance existante réduit son **encours**, sans ajouter de CA et sans prétendre à une transaction bancaire. Financial Strategy et Data Science relisent les paiements documentaires |
| 3 | Réapprovisionnement fictif | Une position de stock augmente avec une quantité et un montant indicatif ; Supply Chain actualise les seuils. **Pas de bon de réception ERP réel** |
| 4 | Jalon fournisseur | Une commande et sa facture fournisseur fictives, avec délai documentaire calculé, sont ajoutées. **Commande → facture ≠ livraison** |

Le script publie une révision atomique PostgreSQL pour chaque événement, avec empreinte SHA-256. Un contrôle de concurrence `expectedRevision` refuse l'écrasement d'un snapshot modifié entre sa lecture et son écriture. Les 100 derniers événements sont documentés dans le snapshot (jamais dans l'ERP).

### Rafraîchissement

Le portail connecté vérifie le `snapshotId` **toutes les 30 secondes**, lorsque l'onglet est visible. Le changement de révision provoque un rafraîchissement des chiffres BI, des indicateurs Data Science et des rapports Agentic ; le portail affiche la dernière activité fictive dans le périmètre autorisé. Le bouton « Rafraîchir » permet une vérification immédiate. Les dossiers persistants AI Director continuent à exiger **un clic explicite** et une validation humaine, même si les calculs se mettent à jour.

**Ce n'est pas du streaming en temps réel** et la simulation ne démarre pas avec les dashboards : elle tourne dans **un processus local séparé**, uniquement après commande de l'utilisateur.

## Installation (Windows PowerShell)

Sur `feature/ai-negoce-complete-demo` **après intégration de la PR** :

```powershell
git fetch origin
git switch feature/ai-negoce-complete-demo
git pull --ff-only origin feature/ai-negoce-complete-demo
npm ci
```

Configurer un `.env` **local et privé** :

```dotenv
NODE_ENV=development
AUTH_MODE=local-dev
HOST=127.0.0.1
UNIFIED_ANALYTICS_SOURCE=postgres
ERP_SANDBOX_ORGANIZATION=demo-fictive
POSTGRES_PASSWORD=UN_MOT_DE_PASSE_PRIVE
DATABASE_URL=postgresql://ai_negoce:UN_MOT_DE_PASSE_PRIVE@127.0.0.1:5432/ai_negoce
```

Initialiser **une seule fois** la démo :

```powershell
npm run db:dev:up
npm run migrate
$env:SYNTHETIC_PERIOD_END = "2026-10-20"
npm run dataset:generate
Remove-Item Env:SYNTHETIC_PERIOD_END
npm run db:seed
npm run analytics:seed -- --source=synthetic
```

Si le snapshot est déjà présent, **ne pas réimporter sauf si une remise à zéro des données est souhaitée** : `npm run analytics:seed -- --source=synthetic --replace` supprime l'effet des mutations antérieures dans la copie analytique et invalide les approbations liées aux anciennes empreintes.

Démarrer dans **trois terminaux** :

**Terminal A : API**
```powershell
npm run dev:api
```

**Terminal B : UI intégrée**
```powershell
npm run agentic:dev
```

**Terminal C : simulation fictive en continu**
```powershell
npm run analytics:demo:live -- --agency=Sfax --ticks=0 --interval-seconds=30
```

Ouvrir `http://127.0.0.1:8444`, connecter la session sandbox, choisir **Sfax / T4 2026**. Constater l'évolution des KPI, le numéro de révision PostgreSQL et la dernière activité fictive. Les encaissements modifient les créances, pas le CA. Les achats fournisseurs documentaires n'impliquent pas automatiquement une réception de stock.

**Arrêter la simulation : Ctrl+C dans Terminal C.** Cela n'efface ni la base ni les données déjà générées.

Pour une démonstration rapide, lancer **quatre événements** espacés de 5 secondes :
```powershell
npm run analytics:demo:live -- --agency=Sfax --ticks=4 --interval-seconds=5
```

Pour simuler aussi le passage de jours fictifs (et non de jours calendaires réels) : ajouter `--advance-days=1`. Par défaut, la date d'arrêté reste stable pendant la démonstration, mais chaque version est historisée par sa révision.

### Limitations et sécurité

- **Local uniquement :** `NODE_ENV` différent de `production`, `AUTH_MODE=local-dev`, PostgreSQL sur `localhost/127.0.0.1`, organisation `demo-fictive` active et synthétique, `UNIFIED_ANALYTICS_SOURCE=postgres`.
- **Pas d'écriture ERP** : même une vente ou livraison « fictive » n'est qu'une mutation du dataset de démonstration.
- **Pas de promesse de transactions réalistes certifiées** : TVA, retours, taxes, paiements bancaires, réservations/approbations d'achats, réceptions physiques et comptabilité générale non modélisées.
- **Contrôle de concurrence :** une écriture concurrente est refusée au lieu d'écraser une autre révision. Relancer après inspection de la source.
- **Capacité :** snapshot JSONB 24 Mo et limites de ligne par type ; le processus s'arrête de façon explicite si une limite est atteinte.
- **Authentification :** la simulation ne fournit jamais de jeton au navigateur et ne crée pas de compte de production.
- **Confidentialité :** les événements d'autres agences ne sont pas exposés via le champ `snapshot.demo.lastEvent` ou les métadonnées BI d'une agence restreinte.
- **Actualisation :** polling 30 s, onglet visible et API joignable ; pas de websocket instantané et pas de notifications push.
- **Décisions :** les missions persistantes, approbations et envois restent volontaires. Aucune relance commerciale, transaction financière ou commande n'est déclenchée automatiquement.

### Vérification reproductible

```powershell
npm run typecheck
npm run agentic:typecheck
npx vitest run server/demo-live-simulator.test.ts
# PostgreSQL de test isolée seulement :
npx vitest run server/agents/final-demo-recipe.pg.test.ts
npx playwright test --config dashboards/agentic-ai/playwright.config.ts
```

Le test PostgreSQL vérifie : une suite vente → paiement → stock → fournisseur ; révision + empreinte ; KPI BI et simulations Data Science recalculés ; quatre agents disponibles ; refus d'une écriture concurrencée ; absence de fuite d'événements inter-agences et inter-organisations ; aucun write-back ERP.

**Non validé :** rafraîchissement push temps réel, modèles ML homologués, vraie base LAI, conformité légale des documents commerciaux et connecteur de production.