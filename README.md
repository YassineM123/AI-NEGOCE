# AI-NEGOCE Intelligence Suite

Interface React conservée et reliée à une API Express sécurisée. La fondation V1 inclut OIDC/JWT, permissions serveur, périmètres agence, PostgreSQL, audit, conversations persistantes et adaptateurs OCR/ERP. Les intégrations externes restent désactivées tant qu’elles ne sont pas configurées et vérifiées.

## Démarrage local

Prérequis : Node.js 22, npm et Docker (PostgreSQL de développement).

```bash
npm install
cp .env.example .env        # puis remplacer POSTGRES_PASSWORD et DATABASE_URL
npm run db:dev:up
npm run migrate
npm run dev:api
npm run dev
```

Frontend : `http://localhost:8443` — API : `http://127.0.0.1:3001/api/v1`.

## Authentification

`AUTH_MODE` est obligatoire ; l’API refuse de démarrer sans lui.

- `oidc` : jetons du fournisseur d’identité (`OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL`). Seul mode autorisé en production et sur tout serveur partagé.
- `local-dev` : identités de développement (`admin`, `manager-sfax`, `commercial-tunis`) pour un poste de travail. L’API écoute uniquement sur l’interface locale (`HOST` de bouclage obligatoire) et refuse toute requête distante ou relayée par un proxy. Le navigateur obtient un jeton de courte durée via `POST /api/v1/auth/dev-session` pour l’identité `VITE_DEV_IDENTITY` ; aucun jeton n’est intégré au bundle.

Voir `docs/smart-ocr/01a-authentication.md`.

## Validation

```bash
npm run typecheck
npm test
npm run build
npm run check:bundle
npm audit
```

En production, les endpoints métier exigent un JWT OIDC vérifié et BI/Copilot renvoient `503` si l’adaptateur ERP réel n’est pas disponible. L’API ne remplit aucun champ OCR sans fournisseur configuré et ne prétend jamais avoir écrit dans l’ERP.
