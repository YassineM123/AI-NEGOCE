# Déploiement

Cette tranche est adaptée au développement/local, pas encore à la production client.

1. Copier `.env.example` vers `.env` et fournir PostgreSQL, OIDC et ERP via un gestionnaire de secrets.
2. Installer avec `npm ci`.
3. Valider avec typecheck, tests, build et audit.
4. Exécuter `npm run migrate`, puis lancer l’API via `npm run start:api` derrière un reverse proxy TLS.
5. Servir `dist/` après `npm run build`.

Avant production : conteneur non-root, volume privé/chiffré ou stockage objet, antivirus, authentification OIDC, base durable/migrations, secrets managés, logs sans données sensibles, sauvegarde/restauration et supervision.

Compose est fourni pour reproductibilité. Un déploiement doit attendre un `readyz` HTTP 200. Sauvegarde minimale : `pg_dump --format=custom`; restauration : nouvelle base isolée avec `pg_restore`, validation des contraintes et smoke tests avant bascule. Le rollback applicatif réutilise l’image précédente; les migrations destructives sont interdites sans migration inverse testée.
