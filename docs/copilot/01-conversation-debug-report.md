# AI-NÉGOCE Copilot — Diagnostic & Debug Report (Step 0)

**Date :** 22 Octobre 2026  
**Auditeur :** Principal AI Engineer & Enterprise SaaS Architect  
**Statut :** Phase 0 — Diagnostic complet (Arrêt strict avant modification de code)  
**Fichier cible :** `docs/copilot/01-conversation-debug-report.md`

---

## 1. Vue d'ensemble du flux d'exécution actuel

Le flux de bout en bout de l'AI Copilot dans l'application existante s'établit comme suit :

```
[Utilisateur tape dans App.tsx]
       │
       ▼
[ask() dans App.tsx] ─────────► Si activeConversationId == null, envoie conversationId = undefined
       │
       ▼
[api.ask() ou api.askStream()] ──► Requête HTTP POST /api/v1/copilot/query (ou /stream)
       │
       ▼
[Auth Middleware] ─────────────► requireRoles("admin", "manager", "accountant", "commercial") + requireErpData
       │
       ▼
[Zod Schema Validation] ───────► question: z.string().trim().min(3).max(1000)
       │                          ↳ Si question < 3 car. ("hi", "ok", "cv") ➔ HTTP 400 "Question invalide"
       ▼
[Tenant & Conversation Lookup] ──► if (!req.body.conversationId) ➔ Pas de lookup, c = undefined
       │
       ▼
[copilot-engine.ts] ───────────► Intent matching par regex statiques (ARABIC_PATTERNS, GREETING_PATTERN, etc.)
       │                          ↳ Si pas de match ➔ groundedAnswer() dans services.ts (regex ERP statiques)
       │                          ↳ Si toujours pas de match ➔ status: "unsupported" ("Question non prise en charge")
       ▼
[Persistence Check] ───────────► if (c) { tenant.addMessage(...) }
       │                          ↳ Comme c == undefined, AUCUNE écriture en base de données !
       ▼
[Réponse JSON / SSE] ──────────► Renvoie answer, table, sources, mais AUCUN conversationId
       │
       ▼
[Frontend App.tsx] ────────────► Stocke le message uniquement dans `turns` (React state en mémoire vive)
                                  ↳ activeConversationId reste null
                                  ↳ GET /api/v1/conversations renvoie []
                                  ↳ Sidebar affiche : "Aucune discussion enregistrée"
                                  ↳ Au rechargement (F5) : tout l'historique est perdu !
```

---

## 2. Causes exactes des anomalies observées

### Anomalie A : "Question invalide"

* **Symptôme :** L'utilisateur envoie `"hi"` et reçoit immédiatement un bloc d'erreur rouge `"Question invalide"`.
* **Cause racine :**
  Dans [`server/app.ts`](file:///c:/Users/anoth/Desktop/AI-NEGOCE%20MVP%20Prototype%20Design/server/app.ts#L655-L671) et [`server/app.ts`](file:///c:/Users/anoth/Desktop/AI-NEGOCE%20MVP%20Prototype%20Design/server/app.ts#L730-L743) :
  ```typescript
  const parsed = z
    .object({
      question: z.string().trim().min(3).max(1000),
      conversationId: z.string().uuid().optional(),
      filters: z.object({ agency: z.string().max(80).optional() }).and(periodSchema).optional(),
    })
    .safeParse(req.body)
  if (!parsed.success) return res.status(400).json({
    error: {
      code: "INVALID_REQUEST",
      message: "Question invalide",
      details: parsed.error.flatten(),
    },
  })
  ```
  La contrainte `.min(3)` est également directement vérifiée dans [`tests/qa/security.test.ts`](file:///c:/Users/anoth/Desktop/AI-NEGOCE%20MVP%20Prototype%20Design/tests/qa/security.test.ts#L113) (`expect(post({ question: "ok" }).status).toBe(400)`).
  Toute entrée utilisateur de 1 ou 2 caractères (`"hi"`, `"ok"`, `"cv"`, `"yo"`) est donc rejetée avec un code HTTP 400.
  Dans [`src/api.ts`](file:///c:/Users/anoth/Desktop/AI-NEGOCE%20MVP%20Prototype%20Design/src/api.ts#L598), l'appel API lève une exception avec `body.error.message` (`"Question invalide"`), qui est capturée dans [`src/App.tsx`](file:///c:/Users/anoth/Desktop/AI-NEGOCE%20MVP%20Prototype%20Design/src/App.tsx#L1827) pour créer un tour avec `status: "error"`, affiché sous forme d'une carte d'erreur rouge.

---

### Anomalie B : "Question non prise en charge"

* **Symptôme :** L'utilisateur envoie `"comme cv ?"` et le Copilot répond `"Question non prise en charge"` avec un badge d'avertissement.
* **Cause racine :**
  Dans [`server/copilot-engine.ts`](file:///c:/Users/anoth/Desktop/AI-NEGOCE%20MVP%20Prototype%20Design/server/copilot-engine.ts#L100-L150) et [`server/services.ts`](file:///c:/Users/anoth/Desktop/AI-NEGOCE%20MVP%20Prototype%20Design/server/services.ts#L220-L363) :
  L'application n'utilise aucun modèle de langage (LLM). Elle s'appuie sur des expressions régulières strictes :
  1. `ARABIC_PATTERNS` recherche des mots-clés spécifiques de vente ou de marge.
  2. `GREETING_PATTERN` teste `^(hi|hello|hey|bonjour|bonsoir|salut|slt|coucou|yo|ca va|ça va|qui es-tu...)\b`.
     La phrase `"comme cv ?"` commence par `"comme"` (qui ne figure pas dans la regex de salutation) et utilise l'abréviation familière `"cv"` au lieu de `"ca va"`.
  3. Le moteur bascule alors sur le routeur de secours [`groundedAnswer()`](file:///c:/Users/anoth/Desktop/AI-NEGOCE%20MVP%20Prototype%20Design/server/services.ts#L220) qui recherche des motifs ERP prédéfinis (`CA`, `MARGE`, `RECEIVABLES`, `LOW_STOCK`, `BRANCHES`, `TOP_CUSTOMERS`).
  4. Aucun motif ne correspondant, `groundedAnswer()` retourne :
     ```typescript
     reply(
       "unsupported",
       "none",
       "Cette question n'est pas comprise ou porte sur des indicateurs non exposés. Consultez le tableau BI 360 ou formulez votre demande (chiffre d'affaires, marge, impayés, stock à réapprovisionner, comparaison d'agences)."
     )
     ```
  5. Dans [`src/App.tsx`](file:///c:/Users/anoth/Desktop/AI-NEGOCE%20MVP%20Prototype%20Design/src/App.tsx#L2032-L2034) :
     ```tsx
     {unsupported && (
       <Badge tone="warning">Question non prise en charge</Badge>
     )}
     ```
     Le Copilot traite ainsi une simple question de courtoisie comme une requête ERP défaillante.

---

### Anomalie C : Sidebar vide ("Aucune discussion enregistrée") malgré des messages visibles

* **Symptôme :** Les messages sont affichés à l'écran, mais la barre latérale affiche `"Aucune discussion enregistrée"`.
* **Cause racine (Code Evidence) :**
  1. Dans [`src/App.tsx`](file:///c:/Users/anoth/Desktop/AI-NEGOCE%20MVP%20Prototype%20Design/src/App.tsx#L1624-L1664) :
     Au démarrage, `activeConversationId` est initialisé à `null` (ou lu depuis `localStorage`).
  2. Lorsque l'utilisateur tape un message dans le formulaire vide sans avoir préalablement cliqué sur `"Nouvelle conversation"`, `activeConversationId` vaut `null`.
  3. Dans `ask()` :
     ```typescript
     const result = await api.ask(queryToSend, activeConversationId || undefined)
     ```
     La requête HTTP `POST /api/v1/copilot/query` est envoyée avec le corps `{ "question": "..." }` sans champ `conversationId`.
  4. Dans [`server/app.ts`](file:///c:/Users/anoth/Desktop/AI-NEGOCE%20MVP%20Prototype%20Design/server/app.ts#L680-L714) :
     ```typescript
     const c = parsed.data.conversationId
       ? await tenant(req).getConversation(parsed.data.conversationId, req.principal!.id)
       : undefined;
     ...
     if (c) {
       await tenant(req).addMessage(c.id, { role: "user", ... });
       await tenant(req).addMessage(c.id, { role: "assistant", ... });
     }
     return res.json(answer);
     ```
     **Constat critique :** Le backend ne crée JAMAIS de conversation automatique si `conversationId` est absent. Il considère la requête comme "éphémère" (`resourceId: parsed.data.conversationId || "ephemeral"`).
  5. Le backend renvoie `answer`, mais **aucun `conversationId`** n'est présent dans la réponse.
  6. Le frontend met à jour son état React local (`setTurns(...)`), mais `activeConversationId` reste `null`.
  7. L'appel à `loadConversations()` interroge `GET /api/v1/conversations`, qui renvoie un tableau vide `[]` car aucune conversation n'a été insérée en base.
  8. Conséquence : la sidebar affiche `"Aucune discussion enregistrée"`. Si l'utilisateur actualise la page (F5) ou redémarre le serveur, l'état React s'efface et tout l'échange est définitivement perdu.

---

### Anomalie D : Présence trompeuse de sources ERP ("ERP Nexora") sur de simples salutations

* **Symptôme :** Même sur un message comme `"hi"` ou `"merci"`, la réponse affiche `"ERP Nexora — Connecteur en temps réel"` et la mention `"Réponse fondée sur vos données ERP"`.
* **Cause racine :**
  Dans [`server/copilot-engine.ts`](file:///c:/Users/anoth/Desktop/AI-NEGOCE%20MVP%20Prototype%20Design/server/copilot-engine.ts#L137,L158,L178) :
  Le bloc de traitement des salutations renvoyait en dur :
  ```typescript
  sources: ["ERP Nexora — Connecteur en temps réel"]
  ```
  Et dans [`src/App.tsx`](file:///c:/Users/anoth/Desktop/AI-NEGOCE%20MVP%20Prototype%20Design/src/App.tsx#L2094-L2098) :
  La mention de bas de carte affichait aveuglément :
  ```tsx
  <span>Réponse fondée sur les données ERP autorisées</span>
  ```
  Cela viole la règle de traçabilité : une salutation ou une question générale ne doit jamais prétendre être une réponse fondée sur l'ERP ni inventer une source.

---

## 3. Nature exacte de l'implémentation existante

| Composant | État réel dans le code |
| :--- | :--- |
| **SDK LLM installé** | **AUCUN** (ni `@google/genai`, ni `openai`, ni `@anthropic-ai/sdk` dans `package.json`). |
| **Configuration LLM** | **ABSENTE** (`server/config.ts` ne contient aucune variable LLM, `.env.example` contient seulement une ligne commentée `# LLM_PROVIDER_API_KEY=`). |
| **Moteur conversationnel** | **100% basé sur des règles et regex statiques** (`copilot-engine.ts` + `groundedAnswer` dans `services.ts`). |
| **Streaming SSE** | **Simulé** : découpage artificiel d'une chaîne statique pré-générée en tranches de 2 caractères avec `setTimeout(18ms)`. |
| **Outils ERP** | **Réels et sécurisés** : `server/copilot-tools.ts` exécute de vraies requêtes SQLite/paramétrées avec contrôle de périmètre d'agence. |
| **Persistance DB** | **Tables PostgreSQL existantes** (`conversations`, `messages`, `conversation_events`, `user_memory_preferences`), mais **non invoquées** lors d'une première question sans conversation active. |

**Classification :** L'implémentation actuelle est un **routeur d'intentions ERP déterministe à base d'expressions régulières (Rule-Based ERP Intent Router)** avec un streaming artificiel et un système de persistance déconnecté du flux utilisateur initial.

---

## 4. Matrice de résolution requise pour les étapes suivantes

1. **Étape 1 (Couche conversationnelle LLM) :**
   - Configurer un adaptateur LLM authentique (ex. Google Gemini via `@google/genai` ou API REST compatible) avec clés d'API protégées côté serveur.
   - Si la clé LLM est absente ou non configurée, retourner une erreur explicite de configuration du service plutôt que de feindre une réponse générative.
   - Classifier en amont :
     * *A. Conversation générale / salutations / small talk* ➔ Réponse LLM naturelle directe (sans sources ERP).
     * *B. Question métier ERP* ➔ Appel des outils ERP typés (`copilot-tools.ts`), injection des résultats certifiés dans le contexte, réponse fondée avec vraies sources.
     * *C. Demande hors périmètre / RH* ➔ Refus sécurisé immédiat côté serveur.

2. **Étape 2 & 3 (Cycle de vie & Mémoire de conversation) :**
   - Dans `POST /api/v1/copilot/query` et `/query/stream` : si `conversationId` est absent, **créer automatiquement** la conversation en base de données, générer un titre concis à partir du premier message, y rattacher les tours (user et assistant), et renvoyer le `conversationId`.
   - Dans `src/App.tsx` : mettre à jour `activeConversationId` dès la première réponse pour que la conversation apparaisse immédiatement dans la barre latérale et survive au rechargement.
   - Conserver l'historique des derniers tours pour résoudre les questions contextuelles (ex. : *"Quelle était ma marge en février ?"* puis *"Et en janvier ?"*).

3. **Étape 4 & 5 (Vérité des données & UX) :**
   - N'afficher les badges de sources et le label *"Réponse fondée sur vos données ERP"* **que** lorsqu'un outil ERP a réellement été exécuté avec des données probantes.
   - Retirer le streaming simulé au profit d'un vrai streaming LLM (ou basculer proprement selon la disponibilité du provider).

---

## 5. Conclusion du diagnostic

Le diagnostic est achevé. Les causes racines de `"Question invalide"`, `"Question non prise en charge"`, de la sidebar vide et de la simulation de streaming sont formellement isolées et prouvées par le code source.

Conformément à la consigne :
> **"STOP after diagnosis and provide the report."**

Aucune modification de code n'est entreprise à ce stade. Nous attendons votre validation pour engager l'**Étape 1 (Intégration d'une couche conversationnelle LLM réelle)**.
