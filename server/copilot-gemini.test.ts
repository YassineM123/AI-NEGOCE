import { describe, expect, it } from "vitest"
import { processConversationalQuery } from "./copilot-engine.js"
import { defaultDataset } from "./services.js"
import type { LlmProvider } from "./llm/index.js"

const structuredLlm = (content: string): LlmProvider => ({
  name: "gemini-test",
  isConfigured: () => true,
  chat: async () => ({ content, model: "gemini-test" }),
})

describe("Gemini-backed Copilot planning", () => {
  it.each(["aateni les factures mtaa sna", "donne moi les factures de 2026"])(
    "lists ERP invoices for: %s",
    async (question) => {
      const result = await processConversationalQuery(question, {
        scope: "*",
        dataset: defaultDataset(),
        llm: structuredLlm(JSON.stringify({
          intent: "sales_invoices",
          language: question.startsWith("aateni") ? "tn" : "fr",
          from: "2026-01-01",
          to: "2026-12-31",
        })),
      })
      expect(result.status).toBe("ok")
      expect(result.tool).toBe("list_sales_invoices")
      expect(result.filters.from).toBe("2026-01-01")
      expect(result.table).toBeInstanceOf(Array)
      expect(result.answer).toMatch(/facture/i)
    },
  )

  it("never lets a planned agency escape the authenticated scope", async () => {
    const result = await processConversationalQuery("aateni les factures de Sousse", {
      scope: ["Sfax"],
      dataset: defaultDataset(),
      llm: structuredLlm(JSON.stringify({ intent: "sales_invoices", language: "tn", agency: "Sousse" })),
    })
    expect(result.status).toBe("denied")
    expect(result.sources).toEqual([])
  })
})
