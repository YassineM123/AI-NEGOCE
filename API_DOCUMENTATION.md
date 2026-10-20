# API locale

- `GET /api/v1/livez` : liveness publique.
- `GET /api/v1/readyz` : readiness des dépendances.
- `POST /api/v1/auth/dev-session` : **uniquement en `AUTH_MODE=local-dev`**, depuis ce poste (bouclage, sans en-tête de proxy). Corps JSON `{ "identity": "admin" | "manager-sfax" | "commercial-tunis" }`. Retourne `{ token, expiresAt, principal }` (jeton HS256 d’une heure, `Cache-Control: no-store`). Absente en `AUTH_MODE=oidc`.
- `GET /api/v1/me` : identité, rôle, agences et `authMode`.
- `GET /api/v1/bi/overview?agency=&from=&to=` : CA, coût, marge, créances et stock calculés.
- `POST /api/v1/copilot/query` : `{ "question": "...", "filters": { ... } }`; réponse fondée sur les outils autorisés et références sources.
- `POST /api/v1/conversations` et `GET /api/v1/conversations/:id` : historique persistant et limité au propriétaire.
- `POST /api/v1/documents` : permission `documents.upload`. Multipart `file`; PDF/PNG/JPEG, 15 Mo maximum. Retourne `needs_review` et des champs vides tant que l’OCR n’est pas configuré.
- `GET /api/v1/documents?agency=` : permission `documents.read`. Liste les documents importés du périmètre, du plus récent au plus ancien.
- `GET /api/v1/documents/:id` : permission `documents.read` et périmètre d’agence.
- `POST /api/v1/documents/:id/approve` : permission `invoice.approve`; refusé si l’extraction n’est pas complète.

Toutes les routes sauf `livez`, `readyz` et `auth/dev-session` exigent `Authorization: Bearer <token>`. En `local-dev`, toute requête non locale ou relayée reçoit `403 LOCAL_DEV_ONLY`. Les erreurs suivent `{ "error": { "code", "message", "details?" } }`.
