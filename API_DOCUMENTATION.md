# API locale

- `GET /api/v1/livez` : liveness publique.
- `GET /api/v1/readyz` : readiness des dépendances.
- `POST /api/v1/auth/dev-session` : **uniquement en `AUTH_MODE=local-dev`**, depuis ce poste (bouclage, sans en-tête de proxy). Corps JSON `{ "identity": "admin" | "manager-sfax" | "commercial-tunis" }`. Retourne `{ token, expiresAt, principal }` (jeton HS256 d’une heure, `Cache-Control: no-store`). Absente en `AUTH_MODE=oidc`.
- `GET /api/v1/me` : identité, rôle, agences et `authMode`.
- `GET /api/v1/bi/overview?agency=&from=&to=` : CA, coût, marge, créances et stock calculés.
- `POST /api/v1/copilot/query` : `{ "question": "...", "filters": { ... }, "conversationId": "..." }`; réponse fondée sur les outils autorisés et références sources, persistée dans l’historique.
- `POST /api/v1/copilot/query/stream` : `{ "question": "...", "filters": { ... }, "conversationId": "..." }`; streaming Server-Sent Events (SSE) progressif avec événements `init`, `status`, `tool`, `delta`, `done`, `error`.
- `GET /api/v1/conversations` : liste paginée des conversations de l'utilisateur connecté (`limit`, `search`).
- `POST /api/v1/conversations` : `{ "title": "..." }`; crée une nouvelle conversation.
- `GET /api/v1/conversations/:id` : historique complet des tours de conversation avec questions, réponses, métadonnées, sources et tables.
- `PATCH /api/v1/conversations/:id` : `{ "title": "..." }`; renommage d'une conversation.
- `DELETE /api/v1/conversations/:id` : suppression sécurisée d'une conversation et de tous ses tours (RLS / contrôle propriétaire).
- `GET /api/v1/copilot/preferences` : récupère les préférences de l'utilisateur (langue préférée, mode de streaming, agence par défaut, etc.).
- `PUT /api/v1/copilot/preferences` : `{ "key": "...", "value": "..." }`; sauvegarde d'une préférence utilisateur.
- `DELETE /api/v1/copilot/preferences?key=` : suppression d'une clé ou réinitialisation complète des préférences.
- `POST /api/v1/documents` : permission `documents.upload`. Multipart `file`; PDF/PNG/JPEG, 15 Mo maximum. Retourne `needs_review` et des champs vides tant que l’OCR n’est pas configuré.
- `GET /api/v1/documents?agency=` : permission `documents.read`. Liste les documents importés du périmètre, du plus récent au plus ancien.
- `GET /api/v1/documents/:id` : permission `documents.read` et périmètre d’agence.
- `POST /api/v1/documents/:id/approve` : permission `invoice.approve`; refusé si l’extraction n’est pas complète.

Toutes les routes sauf `livez`, `readyz` et `auth/dev-session` exigent `Authorization: Bearer <token>`. En `local-dev`, toute requête non locale ou relayée reçoit `403 LOCAL_DEV_ONLY`. Les erreurs suivent `{ "error": { "code", "message", "details?" } }`.

