import type { LlmMessage, LlmOptions, LlmProvider, LlmResponse } from "./types.js"

export class MockLlmProvider implements LlmProvider {
  readonly name = "mock"

  isConfigured(): boolean {
    return true
  }

  async chat(messages: LlmMessage[], options: LlmOptions = {}): Promise<LlmResponse> {
    const lastMsg = messages.filter((m) => m.role === "user").at(-1)?.content || ""
    const norm = lastMsg.trim().toLowerCase()
    const previousAssistantMsg = messages.filter((m) => m.role === "assistant").at(-1)?.content || ""

    let answer = ""

    // 1. Natural greetings
    if (/^(hi|hello|hey)\b/i.test(norm)) {
      answer = "Bonjour ! Comment puis-je vous aider ?"
    } else if (/\b(comme\s+cv|ca\s+va|ça\s+va|kifesh\s+rak|cv)\b/i.test(norm)) {
      answer = "Ça va, merci ! Comment puis-je vous aider aujourd'hui ?"
    } else if (/\b(salut|slt|bonjour|bonsoir|coucou)\b/i.test(norm)) {
      answer = "Bonjour ! Je suis à votre écoute pour analyser vos données ERP ou répondre à vos questions."
    } else if (/\b(chnowa\s+ahwelek|chnawa\s+a7welek|ahla|3aslema|aslema)\b/i.test(norm)) {
      answer = "3aslema ! Labes el hamdullah, kifesh n3awnek lyoum bikhsous el société mte3ek ?"
    } else if (/شنو(ا)? أحوالك|عسلامة|أهلا|مرحبا/i.test(norm)) {
      answer = "عسلامة! الحمد لله، كيفاش نقدر نعاونك اليوم بخصوص شركتك أو معطيات الـ ERP؟"
    } else if (/\b(merci|thanks|chokran|يعطيك الصحة|شكرا)\b/i.test(norm)) {
      answer = "Je vous en prie ! N'hésitez pas si vous avez d'autres questions sur vos indicateurs de vente, marge ou stock."
    } else if (/\b(explain this|explique|explique-moi|pourquoi)\b/i.test(norm)) {
      if (previousAssistantMsg) {
        answer = `Voici les détails explicatifs : le résultat précédent dépend de la répartition des ventes par agence, des marges appliquées sur les familles de produits et des coûts d'achats constatés dans l'ERP.`
      } else {
        answer = "Que souhaitez-vous que je vous explique en détail ? Vous pouvez me poser une question sur le chiffre d'affaires, la marge ou les impayés."
      }
    } else if (/\b(continue|continuer|poursuis)\b/i.test(norm)) {
      answer = "Je poursuis l'analyse. Souhaitez-vous approfondir par agence, par client ou comparer avec une période antérieure ?"
    } else {
      answer = `Je suis votre assistant AI-NÉGOCE. Vous pouvez me poser des questions sur vos ventes, marges, créances clients ou stocks, ou simplement converser.`
    }

    const promptTokens = messages.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0)
    const completionTokens = Math.ceil(answer.length / 4)

    return {
      content: answer,
      model: "mock-llm-v1",
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    }
  }

  async *chatStream(messages: LlmMessage[], options: LlmOptions = {}): AsyncIterable<string> {
    const res = await this.chat(messages, options)
    const words = res.content.split(" ")
    for (const w of words) {
      yield `${w} `
      await new Promise((r) => setTimeout(r, 10))
    }
  }
}
