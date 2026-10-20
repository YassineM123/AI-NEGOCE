# Phase 3 — Normalisation conservatrice

`normalizeProduct` conserve le texte original et construit une représentation de comparaison Unicode NFKC, sans accents français, signes diacritiques arabes ni tatweel. Les variantes alef/ya/ta marbuta et chiffres arabo-indiens sont repliés. Le dictionnaire d'abréviations et les marques sont fournis par l'organisation ; aucune marque n'est déduite sans liste explicite.

Les unités explicites sont extraites (section, diamètre explicitement nommé, longueur, intensité, tension, puissance, poids, capacité). Les unités comparables sont ramenées à une unité de base. `2.5MM` garde une ambiguïté et ne devient jamais une section. Les valeurs absentes restent absentes. Des mesures contradictoires produisent une ambiguïté.

Vérification TDD : test initial en échec (module absent), puis `npx vitest run server/normalize/index.test.ts` : **4 tests réussis**. Les cas couvrent français, arabe, mélanges Unicode, abréviations, conditionnement et absence d'invention.

Limite : ce parseur lexical ne constitue pas une ontologie technique ; les conversions de conditionnement nécessitent une validation séparée.
