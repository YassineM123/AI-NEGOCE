# Architecture

```text
React/Vite SPA -> OIDC JWT -> Express modular API
                              |-- document upload (private local storage)
                              |-- PostgreSQL + audit/migrations
                              |-- governed BI/Copilot tools
                              `-- typed OCR and ERP adapters
```

La version actuelle est un monolithe modulaire volontairement simple. Les fixtures sont limitées au développement/tests; en production, BI et Copilot échouent avec `503` sans adaptateur ERP réel. `server/store.ts` fournit PostgreSQL et un magasin mémoire de test. `server/auth.ts` vérifie OIDC et impose rôles/agences.

Pour la production : OIDC existant de l’ERP, RBAC et périmètre agence serveur, PostgreSQL avec migrations, stockage objet privé et antivirus, worker durable pour OCR/LLM, observabilité et gestionnaire de secrets.
