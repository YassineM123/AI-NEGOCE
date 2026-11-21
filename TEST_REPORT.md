# Rapport de tests

Dernière exécution le 19 octobre 2026 (jeu de données synthétique seedé, jeu `var/e2e-ai-negoce.db` épinglé à `as_of 2026-06-30`) :

- `npm run typecheck` : réussi, 0 erreur.
- `npm test` : réussi, 12 fichiers et 274 tests sur 274 (API, BI vs oracle, Copilot benchmark + held-out, OCR, facture, sécurité, dashboard ERP, liste de documents par périmètre).
- `npm run test:e2e` : réussi, 32 tests sur 32 (bureau 1440 px + mobile Pixel 7) sur la base ERP seedée, période déterministe grâce à `as_of` figé.
- `npm run build` : réussi, 17 modules transformés.
- `npm audit --omit=dev` : 0 vulnérabilité connue.
- `docker compose config --quiet` : réussi avec des variables factices. La construction Docker n’a pas été exécutée (moteur Docker Desktop non démarré) ; aucun succès de conteneur n’est revendiqué.

Couverture : 401, jeton invalide, 403 inter-agence, périmètres agence multi-agences, rôles d’upload, BI réconciliée au millime, filtres de dates, fichier forgé/Polyglot, anti-doublon, persistance, blocage d’approbation, conversation, refus RH, refus hors domaine, injection (SQL/XSS), CORS, en-têtes, limitation de débit.

La passe E2E du 19 octobre utilise la base seedée plutôt que la fixture à 6 lignes : valeurs BI attendues re-dérivées de l’oracle (juin 2026 **2 910 303,283** ; trimestre Q2 **8 592 388,531** ; toutes dates **52 752 842,587** ; Sfax toutes dates **13 189 479,802**). Les cartes KPI affichent désormais la précision millime ; auparavant elles arrondissaient au dinar, ce qui masquait le total exact et faussait l’export CSV.

L’onglet Historique de Smart OCR est désormais alimenté par `GET /api/v1/documents` (périmètre agence) au lieu d’un texte statique, et la modale d’import affiche le fichier réellement téléversé au lieu de montants et d’une référence ERP inventés (`FA-2502-0196`).

Vite émet encore deux avertissements de compatibilité future sur le chargeur natif (`__dirname` et import JSON). Ils ne bloquent pas le build actuel.

Aucun test ne valide un ERP, OCR ou LLM externe.
