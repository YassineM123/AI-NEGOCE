# API locale

- `GET /api/v1/livez` : liveness publique.
- `GET /api/v1/readyz` : readiness des dépendances.
- `GET /api/v1/me` : identité, rôle et agences du JWT.
- `GET /api/v1/bi/overview?agency=&from=&to=` : CA, coût, marge, créances et stock calculés.
- `POST /api/v1/copilot/query` : `{ "question": "...", "filters": { ... } }`; réponse fondée sur les outils autorisés et références sources.
- `POST /api/v1/conversations` et `GET /api/v1/conversations/:id` : historique persistant et limité au propriétaire.
- `POST /api/v1/documents` : multipart `file`; PDF/PNG/JPEG, 15 Mo maximum. Retourne `needs_review` et des champs vides tant que l’OCR n’est pas configuré.
- `GET /api/v1/documents?agency=` : liste les documents importés du périmètre (admin/manager/comptable), du plus récent au plus ancien.
- `GET /api/v1/documents/:id` : métadonnées protégées par rôle/agence.
- `POST /api/v1/documents/:id/approve` : réservé admin/comptable; refusé si l’extraction n’est pas complète.

Toutes les routes métier exigent `Authorization: Bearer <token>`. Les erreurs suivent `{ "error": { "code", "message", "details?" } }`.
