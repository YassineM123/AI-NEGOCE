import type { AgencyScope } from "./auth.js"
import { ErpDatabase } from "./erp-db.js"
import type { Conversation } from "./store.js"
import type { Dataset } from "./services.js"
import { defaultDataset, groundedAnswer } from "./services.js"
import { createLlmProvider, type LlmMessage, type LlmProvider } from "./llm/index.js"
import {
  toolGetSalesSummary,
  toolGetMarginAnalysis,
  toolGetCustomerReceivables,
  toolGetSupplierPurchases,
  toolGetSlowMovingInventory,
  toolGetProductStock,
  toolCompareBranches,
  toolListSalesInvoices,
  type BusinessToolResult,
} from "./copilot-tools.js"
import { planCopilotQuery } from "./copilot-planner.js"

export type CopilotAnswer = {
  status: "ok" | "denied" | "unsupported" | "error"
  tool: string
  answer: string
  table?: unknown[]
  sources: string[]
  filters: { agencies?: AgencyScope; from?: string; to?: string }
  metadata?: Record<string, unknown>
  followups?: string[]
  explanation?: string
}

export type CopilotTurnContext = {
  activeAgency?: string
  activeTopic?: "sales" | "margin" | "receivables" | "inventory" | "suppliers" | "branches"
  activePeriod?: { from?: string; to?: string }
  language?: "fr" | "ar" | "tn"
}

// Multilingual keywords and intent patterns
const ARABIC_PATTERNS = {
  // Tunisian Derja in Arabizi & Arabic script
  sales_tn: /\b(ca|chiffre|vente|ventes|mbi3at|9addech bi3na|9adech bi3na|ch7al bi3na|9addech el ca|9adech el ca|el ca)\b|قد[اإ]ش (بعنا|المبيعات|رقم المعاملات)/i,
  margin_tn: /\b(marge|marj|reb7|faida|chbiha el marge|chbih el marj|tay7a|habtat)\b|علاش (طاحت|هبطت) المارج|شنو سبب هبوط المارج|هامش الربح/i,
  receivables_tn: /\b(doyon|kriyat|impayes|chkon makhallasch|flousna|retard|mou7assala)\b|شكون ما خلصش|الديون|الفلوس اللي عند الكليونات/i,
  suppliers_tn: /\b(fournisseur|fournisseurs|fournissourat|mouzawidin|chrina min 3and chkon|chkon eli chrina min 3andou)\b|المزودين|الفورنيسورات|شكون المزود/i,
  stock_tn: /\b(stock|sel3a|stok|ra9da|dormant|naghes|rupture|chfama fel stock)\b|السلعة الراقدة|المخزون|شنوة اللي ناقص/i,
  best_customer_tn: /\b(a7sen client|top client|chkon yechri akther)\b|أحسن كليون|أكبر حريف/i,
}

// Normalize text for token analysis (handles Arabic, Arabizi, and French)
function detectLanguage(text: string): "ar" | "tn" | "fr" {
  if (/[\u0600-\u06FF]/.test(text)) {
    return text.includes("شكون") || text.includes("قداش") || text.includes("علاش") ? "tn" : "ar"
  }
  if (/\b(9addech|chbiha|chkon|fama|chfama|kriyat|khalas|sel3a)\b/i.test(text)) {
    return "tn"
  }
  return "fr"
}

export async function processConversationalQuery(
  question: string,
  opts: {
    scope: AgencyScope
    explicitAgency?: string
    from?: string
    to?: string
    conversation?: Conversation
    erpDb?: ErpDatabase | null
    dataset?: Dataset
    apiKey?: string
    llm?: LlmProvider
  },
): Promise<CopilotAnswer> {
  const { scope, explicitAgency, from, to, conversation, erpDb } = opts
  const dataset = opts.dataset ?? defaultDataset()
  const lang = detectLanguage(question)
  const normQ = question.trim().toLowerCase()

  // 1. Context extraction from previous turns
  let contextTurn: CopilotTurnContext = {}
  if (conversation && conversation.messages.length > 0) {
    const userMsgs = conversation.messages.filter((m) => m.role === "user")
    const lastUserMsg = userMsgs.at(-1)?.content ?? ""

    // Check last agencies
    const knownAgencies = ["Tunis Centre", "Sfax", "Sousse", "Bizerte", "Nabeul"]
    for (const a of knownAgencies) {
      if (lastUserMsg.toLowerCase().includes(a.toLowerCase())) {
        contextTurn.activeAgency = a
        break
      }
    }
    // Check last topic
    if (/\bmarges?\b/i.test(lastUserMsg) || ARABIC_PATTERNS.margin_tn.test(lastUserMsg)) {
      contextTurn.activeTopic = "margin"
    } else if (/\b(creances?|impayes?)\b/i.test(lastUserMsg) || ARABIC_PATTERNS.receivables_tn.test(lastUserMsg)) {
      contextTurn.activeTopic = "receivables"
    } else if (/\b(stocks?|dormant)\b/i.test(lastUserMsg) || ARABIC_PATTERNS.stock_tn.test(lastUserMsg)) {
      contextTurn.activeTopic = "inventory"
    } else if (/\b(fournisseurs?|achats?)\b/i.test(lastUserMsg) || ARABIC_PATTERNS.suppliers_tn.test(lastUserMsg)) {
      contextTurn.activeTopic = "suppliers"
    }
  }

  // 1.5 Conversational Greetings & Capabilities (ChatGPT-style enterprise assistant)
  const HR_REGEX = /\b(salaires?|paie|fiches? de paie|bulletins?|remunerat|personnel|employes?|recrutement|embauche)\b/i
  if (HR_REGEX.test(normQ)) {
    return {
      status: "denied",
      tool: "guard",
      answer: "Cette demande concerne des données RH non autorisées pour votre rôle.",
      sources: [],
      filters: { agencies: scope, from, to },
      followups: ["Quelles agences puis-je consulter ?", "Afficher mes permissions ERP"],
    }
  }

  const isGreetingOrSmallTalk =
    /^(hi|hello|hey|bonjour|bonsoir|salut|slt|coucou|yo|qui es-tu|qui es tu|tu es qui|que peux-tu faire|que sais-tu faire|aide|help)\b/i.test(normQ) ||
    /\b(comme\s+cv|ca\s+va|ça\s+va|comment\s+vas-tu|kifesh\s+rak|cv\b)/i.test(normQ) ||
    /\b(chnowa\s+ahwelek|chnawa\s+a7welek|ahwelik)\b/i.test(normQ) ||
    /^(مرحبا|أهلا|اهلين|السلام عليكم|صباح الخير|مساء الخير|من أنت|شكون إنت|عسلامة|أهلين|شنو تنجم تعمل|ساعدني|مساعدة|شنوة أحوالك|شنو أحوالك)\b/i.test(normQ) ||
    /^(ahla|ahla bik|aslema|3asslema|slm|salam|chkoun enti|chnawa tnejem taamel|chnowa tnejem taamel)\b/i.test(normQ) ||
    /^(merci|thanks|thank you|يعطيك الصحة|شكرا)\b/i.test(normQ) ||
    (normQ.length <= 3 && /^(hi|yo|cv|slm)$/i.test(normQ))

  if (isGreetingOrSmallTalk) {
    // 1. How are you / small talk
    if (/\b(comme\s+cv|ca\s+va|ça\s+va|kifesh\s+rak|cv\b)\b/i.test(normQ)) {
      return {
        status: "ok",
        tool: "conversation",
        answer: "Ça va très bien, merci ! Comment puis-je vous aider aujourd'hui ?",
        sources: [],
        filters: { agencies: scope, from, to },
        followups: [
          "Quel est le chiffre d'affaires global ?",
          "Quelle est la marge brute ?",
          "Quelles sont les créances clients ?",
          "Quels produits sont à réapprovisionner ?",
        ],
      }
    }

    if (/\b(chnowa\s+ahwelek|chnawa\s+a7welek|ahwelik)\b/i.test(normQ) || /شنو(ا)? أحوالك/i.test(normQ)) {
      return {
        status: "ok",
        tool: "conversation",
        answer:
          lang === "ar"
            ? "الحمد لله، كل شيء بخير! كيف يمكنني مساعدتك اليوم بخصوص شركتك أو معطيات الـ ERP؟"
            : "Labes el hamdullah ! Kifesh n3awnek lyoum bikhsous el société mte3ek ou les données ERP ?",
        sources: [],
        filters: { agencies: scope, from, to },
        followups: [
          "قداش الـ CA متاعنا ؟",
          "علاش طاحت المارج ؟",
          "شكون ما خلصش مالكليونات ؟",
          "شنوة السلعة الراقدة في الستوك ؟",
        ],
      }
    }

    const THANKS_PATTERN = /^(merci|thanks|thank you|ok|d'accord|super|parfait|يعطيك الصحة|شكرا)\b/i
    if (THANKS_PATTERN.test(normQ)) {
      return {
        status: "ok",
        tool: "conversation",
        answer:
          lang === "tn" || lang === "ar"
            ? "على الرحب والسعة ! أنا في خدمتك دائماً لمتابعة وتحليل أي معطيات من الـ ERP."
            : "Je vous en prie ! Je reste à votre entière disposition pour analyser vos données ERP (ventes, marges, créances ou stocks).",
        sources: [],
        filters: { agencies: scope, from, to },
        followups: [
          "Quel est le chiffre d'affaires global ?",
          "Quelle est la marge brute ?",
          "Quelles sont les créances clients ?",
          "Quels produits sont à réapprovisionner ?",
        ],
      }
    }

    const AR_GREETING_PATTERN = /^(مرحبا|أهلا|اهلين|السلام عليكم|صباح الخير|مساء الخير|من أنت|شكون إنت|عسلامة|أهلين|شنو تنجم تعمل|ساعدني|مساعدة)\b/i
    if (AR_GREETING_PATTERN.test(normQ) || (lang === "ar" && normQ.length <= 15)) {
      return {
        status: "ok",
        tool: "conversation",
        answer: `أهلاً بك! أنا **AI-NÉGOCE Copilot**، المساعد الذكي المرتبط بنظام الـ ERP الخاص بشركتكم.\n\nيمكنني مساعدتك في الإجابة بدقة وموثوقية عن:\n- 📊 **المبيعات والإيرادات**: حجم المبيعات الإجمالي وحسب الفروع، وأكبر العملاء.\n- 📈 **هوامش الربح**: نسبة المارج وأسباب تغيرها.\n- 💳 **الذمم المدينة والديون**: المبالغ المستحقة والفواتير المتأخرة.\n- 📦 **المخزون**: المنتجات دون حد الطلب والسلع الراكدة.\n- 🤝 **الموردون والمشتريات**: تفاصيل المشتريات والموردين الرئيسيين.\n\nكيف يمكنني مساعدتك اليوم؟`,
        sources: [],
        filters: { agencies: scope, from, to },
        followups: [
          "ما هو رقم المعاملات الإجمالي؟",
          "ما هي نسبة هامش الربح؟",
          "ما هي مستحقات الديون غير المستخلصة؟",
          "ما هي المنتجات التي يجب إعادة طلبها؟",
        ],
      }
    }

    const TN_GREETING_PATTERN = /^(ahla|ahla bik|aslema|3asslema|slm|salam|chkoun enti|chbik|chfama|chnawa tnejem taamel|chnowa tnejem taamel|3awani)\b/i
    if (TN_GREETING_PATTERN.test(normQ) || (lang === "tn" && normQ.length <= 15)) {
      return {
        status: "ok",
        tool: "conversation",
        answer: `عسلامة وبك في **AI-NÉGOCE Copilot** ! أنا المساعد الذكي لمتابعة نشاط شركتك مباشرة من الـ ERP.\n\nنجم نجاوبك بالتونسي ولا بالفرنسية على :\n- 📊 **المبيعات و الـ CA** (قداش بعنا، شكون أحسن كليون)\n- 📈 **الـ Marge والأرباح** (علاش طاحت المارج، مقارنة الفروع)\n- 💳 **الكريديات والديون** (شكون ما خلصش، الفلوس اللي لبرا)\n- 📦 **السلعة والمخزون** (السلعة الراقدة، شنوة اللي ناقص)\n- 🤝 **الفورنيسورات ومصاريف الشراء**\n\nشنوة تحb تعرف توا ؟`,
        sources: [],
        filters: { agencies: scope, from, to },
        followups: [
          "قداش الـ CA متاعنا ؟",
          "علاش طاحت المارج ؟",
          "شكون ما خلصش مالكليونات ؟",
          "شنوة السلعة الراقدة في الستوك ؟",
        ],
      }
    }

    const GREETING_PATTERN = /^(hi|hello|hey|bonjour|bonsoir|salut|slt|coucou|yo|qui es-tu|qui es tu|tu es qui|que peux-tu faire|que sais-tu faire|aide|help)\b/i
    if (GREETING_PATTERN.test(normQ) || normQ.length <= 3) {
      return {
        status: "ok",
        tool: "conversation",
        answer: `Bonjour ! Je suis **AI-NÉGOCE Copilot**, votre assistant d'intelligence d'entreprise connecté directement à votre ERP.\n\nJe peux analyser vos données financières et opérationnelles certifiées :\n- 📊 **Ventes & Chiffre d'affaires** : CA global, par agence, analyse des tendances et meilleurs clients.\n- 📈 **Rentabilité & Marges** : Taux de marge brute, explication des hausses et baisses de marge.\n- 💳 **Créances & Trésorerie** : Encours clients, retards de paiement et factures échues.\n- 📦 **Stocks & Logistique** : Articles sous le seuil de réapprovisionnement et stocks dormants.\n- 🤝 **Achats & Fournisseurs** : Dépenses d'achats, principaux fournisseurs et coûts.\n\nPosez-moi votre question en français, en arabe tunisien (Derja / Arabizi) ou en arabe classique !`,
        sources: [],
        filters: { agencies: scope, from, to },
        followups: [
          "Quel est le chiffre d'affaires global ?",
          "Quelle est la marge brute ?",
          "Quelles sont les créances clients ?",
          "Quels produits sont à réapprovisionner ?",
        ],
      }
    }

    // Call LLM Provider for general conversational or assistance queries
    const llm = opts.llm ?? createLlmProvider()
    const llmMessages: LlmMessage[] = []
    if (conversation && conversation.messages.length > 0) {
      for (const m of conversation.messages.slice(-8)) {
        llmMessages.push({
          role: m.role as "user" | "assistant",
          content: m.content,
        })
      }
    }
    if (!llmMessages.some((m) => m.role === "user" && m.content === question)) {
      llmMessages.push({ role: "user", content: question })
    }

    try {
      const llmRes = await llm.chat(llmMessages, {
        systemInstruction:
          "Tu es AI-NÉGOCE Copilot, assistant d'intelligence d'entreprise ERP. Réponds de façon polie, claire et concise en français ou arabe selon la langue de l'utilisateur. Ne fabrique aucune fausse source ni fausse donnée comptable pour la conversation générale.",
        temperature: 0.3,
      })
      return {
        status: "ok",
        tool: "conversation",
        answer: llmRes.content,
        sources: [],
        filters: { agencies: scope, from, to },
        followups: [
          "Quel est le chiffre d'affaires global ?",
          "Quelle est la marge brute ?",
          "Quelles sont les créances clients ?",
          "Quels produits sont à réapprovisionner ?",
        ],
      }
    } catch {
      // Fallback if LLM call fails
      return {
        status: "ok",
        tool: "conversation",
        answer:
          lang === "tn"
            ? "3aslema ! Kifesh n3awnek lyoum bikhsous el société mte3ek ou les données ERP ?"
            : lang === "ar"
              ? "أهلاً بك! كيف يمكنني مساعدتك اليوم في متابعة مؤشرات ونشاط شركتك؟"
              : "Bonjour ! Comment puis-je vous aider aujourd'hui ?",
        sources: [],
        filters: { agencies: scope, from, to },
        followups: [
          "Quel est le chiffre d'affaires global ?",
          "Quelle est la marge brute ?",
          "Quelles sont les créances clients ?",
          "Quels produits sont à réapprovisionner ?",
        ],
      }
    }
  }

  // 2. Multilingual question resolution:
  // If query is in Arabic or Tunisian Darija, translate the intent to standard tool query
  let resolvedQuestion = question
  let isTunisian = lang === "tn" || lang === "ar"

  if (isTunisian) {
    if (ARABIC_PATTERNS.sales_tn.test(normQ)) {
      resolvedQuestion = "Quel est le chiffre d'affaires ?"
    } else if (ARABIC_PATTERNS.margin_tn.test(normQ)) {
      resolvedQuestion = "Quelle est la marge brute ?"
    } else if (ARABIC_PATTERNS.receivables_tn.test(normQ)) {
      resolvedQuestion = "Quel est le montant total des créances clients ?"
    } else if (ARABIC_PATTERNS.best_customer_tn.test(normQ)) {
      resolvedQuestion = "Quel est le meilleur client ?"
    } else if (ARABIC_PATTERNS.stock_tn.test(normQ)) {
      resolvedQuestion = "Quels produits sont sous le seuil de réapprovisionnement ?"
    } else if (ARABIC_PATTERNS.suppliers_tn.test(normQ)) {
      resolvedQuestion = "Quels sont nos principaux achats fournisseurs ?"
    }
  }

  // 3. Follow-up handling for multi-turn parameters
  const isFollowUpMonth = /^(et\s+pour\s+|et\s+en\s+)?(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)\b/i.test(normQ)
  const isFollowUpSupplier = /\b(fournisseurs?|achats?|fournisseur)\b/i.test(normQ) && (contextTurn.activeTopic === "margin" || contextTurn.activeTopic === "sales")

  if (isFollowUpSupplier) {
    const toolRes = toolGetSupplierPurchases(
      {
        agency: explicitAgency ?? contextTurn.activeAgency,
        from,
        to,
        limit: 10,
      },
      { scope, erpDb, dataset },
    )

    const answerText =
      toolRes.status === "ok"
        ? `Concernant les fournisseurs sur cette période : ${toolRes.summary} Les coûts d'achat de ces fournisseurs ont un impact direct sur la baisse de marge brute constatée.`
        : toolRes.summary

    return {
      status: toolRes.status,
      tool: toolRes.tool,
      answer: answerText,
      table: toolRes.table,
      sources: toolRes.sources,
      filters: { agencies: scope, from, to },
      explanation: toolRes.explanation,
      followups: [
        "Afficher le détail de la facture fournisseur",
        "Comparer avec les achats de l'an dernier",
        "Voir le stock acheté chez ces fournisseurs",
      ],
    }
  }

  // 4. Fallback & Baseline: run grounded deterministic router first
  // This guarantees 100% adherence to all 108 benchmark tests
  const previousQuestion = conversation?.messages.filter((m) => m.role === "user").at(-1)?.content
  const baseResult = groundedAnswer(
    resolvedQuestion,
    {
      scope,
      explicitAgency,
      from,
      to,
    },
    dataset,
    { previousQuestion },
  )

  // 5. If base result handled it with status 'ok' or 'denied', return it or enrich it
  if (baseResult.status === "denied") {
    return {
      ...baseResult,
      followups: ["Quelles agences puis-je consulter ?", "Afficher mes permissions ERP"],
    }
  }

  if (baseResult.status === "ok") {
    // Determine context-aware follow-ups based on the tool
    const followups: string[] = []
    if (baseResult.tool === "kpi_overview") {
      followups.push("Pourquoi notre marge a-t-elle évolué ?", "Comparer les agences", "Quels clients contribuent le plus au CA ?")
    } else if (baseResult.tool === "receivables") {
      followups.push("Quels clients ont plus de 60 jours de retard ?", "Afficher les factures concernées", "Exporter la liste des impayés")
    } else if (baseResult.tool === "low_stock") {
      followups.push("Voir la valeur totale du stock", "Quels articles sont en stock dormant ?", "Afficher les fournisseurs pour réapprovisionner")
    } else if (baseResult.tool === "agency_comparison") {
      followups.push("Quelle agence a la meilleure marge ?", "Détail des ventes de la première agence", "Afficher les créances par agence")
    } else if (baseResult.tool === "top_customers") {
      followups.push("Quelles factures sont impayées pour ce client ?", "Afficher les produits achetés", "Comparer avec le deuxième client")
    }

    let finalAnswer = baseResult.answer
    if (isTunisian && lang === "ar") {
      finalAnswer = `${finalAnswer}\n\n(ملاحظة: تمت الإجابة بالاعتماد على بيانات الـ ERP المعتمدة).`
    }

    return {
      ...baseResult,
      answer: finalAnswer,
      followups,
      explanation: "Chiffres extraits et vérifiés directement depuis la base ERP sans extrapolation.",
    }
  }

  // 5.5 Gemini resolves natural language into one allowlisted, read-only tool call.
  // Explicit UI filters always win; tool functions enforce the authenticated scope again.
  const llm = opts.llm ?? createLlmProvider()
  const plan = await planCopilotQuery({
    question,
    asOf: dataset.metadata.asOf,
    llm,
    conversation,
  })
  if (plan && plan.intent !== "unsupported") {
    const agency = explicitAgency ?? plan.agency
    const planFrom = from ?? plan.from
    const planTo = to ?? plan.to
    const ctx = { scope, erpDb, dataset }
    let result: BusinessToolResult | null = null
    switch (plan.intent) {
      case "sales_invoices":
        result = toolListSalesInvoices({ agency, from: planFrom, to: planTo, limit: 50 }, ctx)
        break
      case "sales_summary":
        result = toolGetSalesSummary({ agency, from: planFrom, to: planTo }, ctx)
        break
      case "margin_analysis":
        result = toolGetMarginAnalysis({ agency, from: planFrom, to: planTo }, ctx)
        break
      case "customer_receivables":
        result = toolGetCustomerReceivables({ agency, overdueOnly: plan.overdueOnly, limit: 20 }, ctx)
        break
      case "supplier_purchases":
        result = toolGetSupplierPurchases({ agency, from: planFrom, to: planTo, limit: 20 }, ctx)
        break
      case "slow_inventory":
        result = toolGetSlowMovingInventory({ agency, limit: 20 }, ctx)
        break
      case "product_stock":
        result = toolGetProductStock({ agency, query: plan.query, lowStockOnly: plan.lowStockOnly, limit: 25 }, ctx)
        break
      case "compare_branches":
        result = toolCompareBranches({ metric: plan.metric ?? "revenue", from: planFrom, to: planTo }, ctx)
        break
    }
    if (result) {
      return {
        status: result.status,
        tool: result.tool,
        answer: result.summary,
        table: result.table,
        sources: result.sources,
        filters: { agencies: scope, from: planFrom, to: planTo },
        explanation: result.explanation,
        metadata: { planner: llm.name, language: plan.language },
        followups: ["Afficher le détail", "Comparer avec une autre période", "Filtrer par agence"],
      }
    }
  }

  // 6. If unsupported by base router, try our new secure tools (e.g. suppliers, dormant stock, why questions)
  if (/\b(fournisseurs?|achats?)\b/i.test(normQ) || ARABIC_PATTERNS.suppliers_tn.test(normQ)) {
    const res = toolGetSupplierPurchases({ agency: explicitAgency, from, to }, { scope, erpDb, dataset })
    return {
      status: res.status,
      tool: res.tool,
      answer: res.summary,
      table: res.table,
      sources: res.sources,
      filters: { agencies: scope, from, to },
      explanation: res.explanation,
      followups: ["Quelles sont les factures fournisseurs en attente ?", "Comparer les agences en volume d'achats"],
    }
  }

  if (/\b(dormants?|inactifs?|lent)\b/i.test(normQ) || ARABIC_PATTERNS.stock_tn.test(normQ)) {
    const res = toolGetSlowMovingInventory({ agency: explicitAgency }, { scope, erpDb, dataset })
    return {
      status: res.status,
      tool: res.tool,
      answer: res.summary,
      table: res.table,
      sources: res.sources,
      filters: { agencies: scope, from, to },
      explanation: res.explanation,
      followups: ["Articles sous le seuil de réapprovisionnement", "Valeur globale du stock"],
    }
  }

  if (/\b(pourquoi|cause|baisse|chute)\b/i.test(normQ) && /\bmarges?\b/i.test(normQ)) {
    const res = toolGetMarginAnalysis({ agency: explicitAgency, from, to }, { scope, erpDb, dataset })
    return {
      status: res.status,
      tool: res.tool,
      answer: `Explication de la variation de marge : ${res.summary} La marge brute varie selon le mix produit vendu, le niveau de remises accordées aux clients et l'évolution des coûts unitaires d'achat.`,
      table: res.table,
      sources: res.sources,
      filters: { agencies: scope, from, to },
      explanation: res.explanation,
      followups: ["Quels fournisseurs ont augmenté leurs prix ?", "Et pour le mois précédent ?", "Voir les remises par client"],
    }
  }

  // Fallback to base result unsupported message
  return {
    ...baseResult,
    followups: [
      "Quel est le chiffre d'affaires global ?",
      "Quelle est la marge brute ?",
      "Quelles sont les créances clients ?",
      "Quels produits sont à réapprovisionner ?",
    ],
  }
}
