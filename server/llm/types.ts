export type LlmRole = "system" | "user" | "assistant"

export type LlmMessage = {
  role: LlmRole
  content: string
}

export type LlmUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export type LlmResponse = {
  content: string
  usage?: LlmUsage
  model: string
  finishReason?: string
}

export type LlmOptions = {
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  signal?: AbortSignal
  systemPrompt?: string
  systemInstruction?: string
  /** Ask the provider for machine-readable JSON. Kept provider-neutral for routing. */
  responseMimeType?: "application/json" | "text/plain"
  responseSchema?: Record<string, unknown>
}

export interface LlmProvider {
  name: string
  isConfigured(): boolean
  chat(messages: LlmMessage[], options?: LlmOptions): Promise<LlmResponse>
  chatStream?(messages: LlmMessage[], options?: LlmOptions): AsyncIterable<string>
}
