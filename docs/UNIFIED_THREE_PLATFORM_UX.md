# AI-NÉGOCE — Expérience unifiée BI / Data Science / Agentic

## Périmètre de l'harmonisation

Cette évolution ajoute une **vue transversale** au Command Center, sans mélanger les calculs locaux CSV avec l'API gouvernée.

| Dimension | Comportement commun |
|---|---|
| Navigation | Boutons BI 360, Data Science et Missions Agentic. Les deux premiers changent l'onglet; le troisième ouvre les missions persistantes |
| Contexte | Organisation de la session centrale; agence/période du sélecteur parent; aucune authentification indépendante des iframe |
| KPI | CA HT TND à trois décimales, créances, clients distincts; N/D explicite si source absente |
| Graphiques | Courbe mensuelle du CA calculée à partir de `insights.months`, sans série fictive de substitution |
| Preuves | SnapshotId, source, date d'arrêté, révision PostgreSQL, coût manquant, état des modèles |
| Statuts | Sandbox synthétique, source non homologuée, lecture seule; aucun modèle certifié ni écriture ERP |
| Exports | Rapport transversal JSON; KPI CSV; exports de preuve JSON spécifiques dans BI et DS |
| Agentic | Missions, examens, approbations et exports manuels restent gérés par le workspace existant |

## Origine des exports

- **Command Center** : `ai-negoce-<snapshotId>.json` et `.csv`, avec source, périmètre, métriques, scénario et présence/absence du backtest.
- **BI** : `ai-negoce-bi-<snapshotId>.json`, avec `bi.data`, `insights`, provenance et limites.
- **Data Science** : `ai-negoce-ds-<snapshotId>.json`, avec `dataScience.analysis`, infos de modèle, provenance et limites.
- **Agentic** : exports de paquets de décision existants, manuels après seconde validation; aucun déclenchement d'action ERP.

Tout téléchargement utilise le navigateur local; aucune écriture dans PostgreSQL ou l'ERP. Les exports client portent seulement le **périmètre filtré exposé par l'API**, jamais le token d'authentification.

## Vérifications à exécuter

```bash
npm run typecheck
npm run agentic:typecheck
npm run agentic:build
npx playwright test --config dashboards/agentic-ai/playwright.config.ts
```

Vérifier à la main sur le portail `http://127.0.0.1:8444` :
1. Choisir Sfax/T3 et ouvrir BI puis DS; chaque bandeau doit porter le même snapshotId, CA et créances.
2. Examiner « Sources & statut » dans BI : en mode connecté, preuve API, pas le CSV local.
3. Exporter les trois rapports; vérifier que `snapshotId`, `source`, `from`, `to`, `scope` coïncident.
4. Changer l'agence/la période : preuves et exports changent avec le périmètre. Tester qu'une agence hors autorisation renvoie 403.
5. En mode déconnecté, préserver les simulations comme telles, sans les présenter comme des calculs API.
6. Vérifier que les rapports Agentic s'exécutent sur la même période/agence et qu'un paquet approuvé reste un transfert manuel.
7. Tester affichage mobile, focus clavier, responsive et lecteurs d'écran.

## Limites non masquées

- Le portail relie encore deux anciennes interfaces en iframe : cette étape fournit un cadre visuel et fonctionnel cohérent, mais ne remplace pas leur code de rendu intégral.
- Les données physiques restent un snapshot JSONB de démonstration PostgreSQL; pas de source ERP officielle.
- Le comparatif contractuel des KPI avec les éditions LAI, la conformité des modèles et la validation UX utilisateur restent à réaliser.
