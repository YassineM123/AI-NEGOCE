# AI-NEGOCE Intelligence Suite

Interface React conservée et reliée à une API Express sécurisée. La fondation V1 inclut OIDC/JWT, RBAC, périmètres agence, PostgreSQL, audit, conversations persistantes et adaptateurs OCR/ERP. Les intégrations externes restent désactivées tant qu’elles ne sont pas configurées et vérifiées.

## Démarrage local

Prérequis : Node.js 22 et npm.

```bash
npm install
npm run migrate
npm run dev:api
npm run dev
```

Frontend : `http://localhost:8443` — API : `http://localhost:3001/api/v1`.

## Validation

```bash
npm run typecheck
npm test
npm run build
npm audit
```

En développement, le token `dev-admin` et les fixtures sont explicites. En production, les endpoints métier exigent un JWT OIDC vérifié et BI/Copilot renvoient `503` si l’adaptateur ERP réel n’est pas disponible. L’API ne remplit aucun champ OCR sans fournisseur configuré et ne prétend jamais avoir écrit dans l’ERP.
