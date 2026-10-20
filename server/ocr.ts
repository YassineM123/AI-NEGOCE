export type Extraction = {
  fields: Record<string, unknown>
  missingFields: string[]
  provider: string
  confidence: number | null
}
export interface OcrProvider {
  readonly name: string
  extract(input: { buffer: Buffer; mimeType: string }): Promise<Extraction>
}
export class DisabledOcrProvider implements OcrProvider {
  readonly name = "disabled"
  async extract() {
    return {
      fields: {},
      missingFields: [
        "supplier",
        "invoiceNumber",
        "invoiceDate",
        "currency",
        "lines",
        "totals",
      ],
      provider: this.name,
      confidence: null,
    }
  }
}
export class HttpOcrProvider implements OcrProvider {
  readonly name = "http"
  constructor(
    private endpoint: string,
    private apiKey: string,
  ) {}
  async extract(input: { buffer: Buffer; mimeType: string }) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    try {
      const body = new Uint8Array(input.buffer)
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": input.mimeType,
        },
        body,
        signal: controller.signal,
      })
      if (!response.ok)
        throw new Error(`OCR provider returned ${response.status}`)
      return ExtractionSchema.parse(await response.json())
    } finally {
      clearTimeout(timeout)
    }
  }
}
import { z } from "zod"
const ExtractionSchema = z.object({
  fields: z.record(z.string(), z.unknown()),
  missingFields: z.array(z.string()),
  provider: z.string(),
  confidence: z.number().min(0).max(1).nullable(),
})
