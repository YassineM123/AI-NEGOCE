# Traçabilité des 253 exigences Agentic du CDC

Source : cahier des charges AI-NÉGOCE Intelligence Suite V1.0 du 18 novembre 2026, pages 5 et 11–25.

253 identifiants uniques : 9 exigences Director et 244 capacités spécialistes.

| Agent | Exigences catalogue | Partiel dans agents dédiés | Non démontré par cet audit |
|---|---:|---:|---:|
| DIR | 9 | 7 | 2 |
| REV | 40 | 7 | 33 |
| FIN | 60 | 8 | 52 |
| SCA | 72 | 5 | 67 |
| BSA | 72 | 7 | 65 |

Statuts **conservateurs** : « partiel » indique un noyau de calcul ou de workflow lié à l'exigence, sans prouver la totalité de l'exigence ni sa recette. « Non démontré » signifie **non démontré dans le code dédié revu**, pas une preuve qu'aucune fonctionnalité n'existe ailleurs (ERP natif, BI/DS, extensions).

Le champ intitulé contient la **première ligne extraite** du libellé PDF ; certains libellés longs continuent sur la ligne suivante du PDF. Ne pas l'utiliser comme dictionnaire définitif des intitulés. Le PDF reste la référence contractuelle.

Pour livrer « implémenté » sur une exigence : (1) contrat entrée/sortie validé, (2) données propres au client, (3) sécurité tenant/role, (4) cas normal/erreur, (5) preuve QA/métiers, (6) monitoring et reprise, (7) version ERP.
