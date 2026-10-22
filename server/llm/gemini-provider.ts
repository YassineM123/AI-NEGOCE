import type { LlmMessage, LlmOptions, LlmProvider, LlmResponse } from "./types.js"

export class GeminiProvider implements LlmProvider {
  readonly name = "gemini"
  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl = "https://generativelanguage.googleapis.com/v1beta/models"

  constructor(apiKey?: string, model = "gemini-3.8-flash") {
    this.apiKey = apiKey || ""
    this.model = model
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0)
  }

  async chat(messages: LlmMessage[], options: LlmOptions = {}): Promise<LlmResponse> {
    if (!this.isConfigured()) {
      throw new Error("GEMINI_API_KEY_MISSING: Gemini provider is not configured.")
    }

    const timeout = options.timeoutMs ?? 15000
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    if (options.signal) {
      options.signal.addEventListener("abort", () => controller.abort())
    }

    try {
      const contents = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        }))

      const systemMessage =
        messages.find((m) => m.role === "system")?.content ||
        options.systemInstruction ||
        options.systemPrompt

      const body: Record<string, unknown> = {
        contents,
        generationConfig: {
          temperature: options.temperature ?? 0.3,
          maxOutputTokens: options.maxTokens ?? 1024,
          ...(options.responseMimeType ? { responseMimeType: options.responseMimeType } : {}),
          ...(options.responseSchema ? { responseSchema: options.responseSchema } : {}),
        },
      }

      if (systemMessage) {
        body.systemInstruction = {
          parts: [{ text: systemMessage }],
        }
      }

      const url = `${this.baseUrl}/${encodeURIComponent(this.model)}:generateContent`

      let lastError: Error | null = null
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": this.apiKey,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          })

          if (!res.ok) {
            const errText = await res.text().catch(() => "")
            throw new Error(`Gemini API error (HTTP ${res.status}): ${errText}`)
          }

          const data = (await res.json()) as {
            candidates?: Array<{
              content?: { parts?: Array<{ text?: string }> }
              finishReason?: string
            }>
            usageMetadata?: {
              promptTokenCount?: number
              candidatesTokenCount?: number
              totalTokenCount?: number
            }
          }

          const candidate = data.candidates?.[0]
          const text = candidate?.content?.parts?.[0]?.text || ""

          return {
            content: text,
            model: this.model,
            finishReason: candidate?.finishReason,
            usage: data.usageMetadata
              ? {
                  promptTokens: data.usageMetadata.promptTokenCount ?? 0,
                  completionTokens: data.usageMetadata.candidatesTokenCount ?? 0,
                  totalTokens: data.usageMetadata.totalTokenCount ?? 0,
                }
              : undefined,
          }
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err))
          if (attempt === 0 && !controller.signal.aborted) {
            await new Promise((r) => setTimeout(r, 500))
            continue
          }
          throw lastError
        }
      }
      throw lastError || new Error("Gemini API call failed")
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async *chatStream(messages: LlmMessage[], options: LlmOptions = {}): AsyncIterable<string> {
    const res = await this.chat(messages, options)
    // Yield in small natural increments
    const words = res.content.split(" ")
    for (const w of words) {
      yield `${w} `
      await new Promise((r) => setTimeout(r, 15))
    }
  }
}
