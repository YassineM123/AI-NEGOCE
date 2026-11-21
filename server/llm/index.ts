import { GeminiProvider } from "./gemini-provider.js"
import { MockLlmProvider } from "./mock-provider.js"
import type { LlmMessage, LlmOptions, LlmProvider, LlmResponse } from "./types.js"

export * from "./types.js"
export { GeminiProvider } from "./gemini-provider.js"
export { MockLlmProvider } from "./mock-provider.js"

export class UnconfiguredLlmProvider implements LlmProvider {
  readonly name = "unconfigured"

  isConfigured(): boolean {
    return false
  }

  async chat(): Promise<LlmResponse> {
    throw new Error("LLM_PROVIDER_UNCONFIGURED: Aucun modèle de langage (LLM) n'est configuré sur ce serveur. Veuillez définir LLM_PROVIDER_API_KEY ou GEMINI_API_KEY.")
  }
}

export function createLlmProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  const apiKey = env.LLM_PROVIDER_API_KEY || env.GEMINI_API_KEY
  const providerType = (env.LLM_PROVIDER || env.AI_PROVIDER)?.toLowerCase()

  if (apiKey && (!providerType || providerType === "gemini")) {
    return new GeminiProvider(apiKey, env.LLM_MODEL || env.GEMINI_MODEL || "gemini-3.8-flash")
  }

  if (env.NODE_ENV === "test" || providerType === "mock" || !env.NODE_ENV || env.NODE_ENV === "development") {
    // In test and local development, default to MockLlmProvider so local developers and tests have instant natural dialogue
    return new MockLlmProvider()
  }

  return new UnconfiguredLlmProvider()
}
