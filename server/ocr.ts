export type Extraction = {
  fields: Record<string, unknown>
  missingFields: string[]
  provider: string
  confidence: number | null
  /** Coordinate-aware raw OCR evidence. Present only for providers that return it. */
  document?: import("./ocr/types.js").OcrDocument
  events?: import("./ocr/types.js").ProcessingEvent[]
  sources?: Record<string, { page: number; bbox: import("./ocr/types.js").BBox }>
}
export interface OcrProvider {
  readonly name: string
  extract(input: { buffer: Buffer; mimeType: string }): Promise<Extraction>
  close?(): Promise<void>
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
import { dec } from "./money.js"
const ExtractionSchema = z.object({
  fields: z.record(z.string(), z.unknown()),
  missingFields: z.array(z.string()),
  provider: z.string(),
  confidence: z.number().min(0).max(1).nullable(),
})

/** Bridges the local coordinate-aware reader to the stable extraction API.
 * It intentionally does not infer invoice fields: raw page evidence is returned for review.
 */
export class LocalExtractionProvider implements OcrProvider {
  readonly name = "local"
  private provider: import("./ocr/types.js").DocumentOcrProvider | undefined
  private async local() {
    if (!this.provider) {
      const { LocalOcrProvider } = await import("./ocr/local.js")
      this.provider = new LocalOcrProvider({ languages: ["fra", "eng"], cachePath: process.env.OCR_CACHE_DIR ?? ".cache/tesseract", autoRotate: true, pageTimeoutMs: 30_000, maxPages: 10, rasterDpi: 200, minTextLayerChars: 20 })
    }
    return this.provider
  }
  async extract(input: { buffer: Buffer; mimeType: string }): Promise<Extraction> {
    const events: import("./ocr/types.js").ProcessingEvent[] = []
    const document = await (await this.local()).recognize(input, {
      onEvent: event => {
        const last = events[events.length - 1]
        if (last && last.stage === event.stage && last.page === event.page) {
          events[events.length - 1] = event
        } else {
          events.push(event)
        }
      },
    })
    events.push({ stage: "extracting", at: new Date().toISOString(), pages: document.pages.length })
    const parsed = extractInvoiceFields(document)
    events.push({ stage: "done", at: new Date().toISOString(), pages: document.pages.length })
    const confidences = document.pages.map(page => page.meanConfidence).filter((value): value is number => value !== null)
    return {
      fields: parsed.fields,
      missingFields: parsed.missingFields,
      provider: this.name,
      confidence: confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : null,
      document,
      events,
      sources: parsed.sources,
    }
  }
  async close() { await this.provider?.close?.() }
}

const decimal = (value: string) => value.replace(/\s/g, "").replace(",", ".")
const isoDate = (value: string) => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value
}
const isoUsDate = (value: string) => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
  return match ? `${match[3]}-${match[1]}-${match[2]}` : value
}
const columnText = (line: import("./ocr/types.js").OcrLine, side: "left" | "right") =>
  line.words
    .filter(word => side === "left" ? (word.bbox.x0 + word.bbox.x1) / 2 < 0.5 : (word.bbox.x0 + word.bbox.x1) / 2 >= 0.5)
    .map(word => word.text)
    .join(" ")
    .trim()

/** Conservative invoice parser over observed OCR lines. Every returned value must match
 * document text; the only derived value is per-line VAT, calculated from the observed
 * declared line total and VAT rate so the financial validator can verify it explicitly. */
export function extractInvoiceFields(document: import("./ocr/types.js").OcrDocument) {
  const observed = document.pages.flatMap(page => page.lines.map(line => ({ page: page.page, line })))
  const fields: Record<string, unknown> = {}
  const sources: Record<string, { page: number; bbox: import("./ocr/types.js").BBox }> = {}
  const capture = (key: string, pattern: RegExp, transform: (value: string) => unknown = value => value.trim()) => {
    for (const entry of observed) {
      const match = pattern.exec(entry.line.text)
      if (!match?.[1]) continue
      fields[key] = transform(match[1])
      sources[key] = { page: entry.page, bbox: entry.line.bbox }
      return
    }
  }
  const supplier = observed.find(entry => /\b(?:SARL|SA|SUARL)\b/i.test(entry.line.text) && !/CLIENT/i.test(entry.line.text))
  if (supplier) {
    fields.supplier = supplier.line.text.trim()
    sources.supplier = { page: supplier.page, bbox: supplier.line.bbox }
  }
  capture("supplierTaxId", /Matricule\s+fiscal\s*:\s*([^\s]+(?:\/[A-Z0-9]+){2,})/i)
  capture("invoiceNumber", /Facture\s*N[\u00b0o]?\s*:\s*([^\s]+)/i)
  capture("invoiceDate", /\bDate\s*:\s*(\d{2}\/\d{2}\/\d{4})/i, isoDate)
  capture("dueDate", /(?:Echeance|Échéance)\s*:\s*(\d{2}\/\d{2}\/\d{4})/i, isoDate)
  capture("currency", /Devise\s*:\s*([A-Z]{3})\b/i, value => value.toUpperCase())

  // Common English/USD computer-generated layout. The seller and client share visual
  // rows, so use the observed word coordinates instead of guessing from concatenated text.
  if (!("invoiceNumber" in fields)) capture("invoiceNumber", /Invoice\s+no\s*:\s*([^\s]+)/i)
  if (!("invoiceDate" in fields)) capture("invoiceDate", /Date\s+of\s+issue\s*:\s*(\d{2}\/\d{2}\/\d{4})/i, isoUsDate)
  if (!("currency" in fields) && observed.some(entry => /\bTotal\s+\$/i.test(entry.line.text))) fields.currency = "USD"
  if (!("supplier" in fields)) {
    const headings = observed.findIndex(entry => /\bSeller\s*:\s*Client\s*:/i.test(entry.line.text))
    const sellerLine = headings >= 0 ? observed[headings + 1] : undefined
    const sellerName = sellerLine ? columnText(sellerLine.line, "left") : ""
    if (sellerLine && sellerName) {
      fields.supplier = sellerName
      sources.supplier = { page: sellerLine.page, bbox: sellerLine.line.bbox }
    }
  }

  const totalPatterns: Array<[string, RegExp]> = [
    ["ht", /\bTotal\s+HT\s+([\d\s]+[.,]\d{3})/i],
    ["vat", /^TVA(?:\s+\d+(?:[.,]\d+)?\s*%)?\s+([\d\s]+[.,]\d{3})/i],
    ["stamp", /Timbre\s+fiscal\s+([\d\s]+[.,]\d{3})/i],
    ["ttc", /TOTAL\s+TTC\s+([\d\s]+[.,]\d{3})/i],
  ]
  const totals: Record<string, string> = {}
  for (const [name, pattern] of totalPatterns) {
    const entry = observed.find(candidate => pattern.test(candidate.line.text))
    const match = entry && pattern.exec(entry.line.text)
    if (entry && match?.[1]) {
      totals[name] = decimal(match[1])
      sources[`totals.${name}`] = { page: entry.page, bbox: entry.line.bbox }
    }
  }
  if (Object.keys(totals).length) fields.totals = totals

  if (!("totals" in fields)) {
    const totalLine = observed.find(entry => /\bTotal\s+\$/.test(entry.line.text))
    const match = totalLine && /\bTotal\s+\$\s*([\d\s]+[.,]\d{2})\s+\$?\s*([\d\s]+[.,]\d{2})\s+\$\s*([\d\s]+[.,]\d{2})/i.exec(totalLine.line.text)
    if (totalLine && match) {
      fields.totals = { ht: decimal(match[1]), vat: decimal(match[2]), ttc: decimal(match[3]) }
      for (const name of ["ht", "vat", "ttc"]) sources[`totals.${name}`] = { page: totalLine.page, bbox: totalLine.line.bbox }
    }
  }

  let lineIndex = 0
  const lines: Array<{
    supplierReference?: string
    description: string
    quantity: string
    unitPrice: string
    vatRate: string
    lineHt: string
    lineVat: string
  }> = observed.flatMap(entry => {
    const match = /^(\S+)\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+(\d+[.,]\d{3})\s+(\d+(?:[.,]\d+)?)\s*%\s+(\d+[.,]\d{3})$/.exec(entry.line.text)
    if (!match) return []
    const lineHt = decimal(match[6])
    const vatRate = decimal(match[5])
    const lineVat = dec(lineHt).percent(dec(vatRate)).round(3, "half_up").toString()
    sources[`lines.${lineIndex++}`] = { page: entry.page, bbox: entry.line.bbox }
    return [{
      supplierReference: match[1],
      description: match[2].trim(),
      quantity: decimal(match[3]),
      unitPrice: decimal(match[4]),
      vatRate,
      lineHt,
      lineVat,
    }]
  })
  if (!lines.length) {
    for (const entry of observed) {
      const match = /^(?:\W?\d+[.,]?\s+)?(.+?)\s+(\d+[.,]\d{2})\s+\S+\s+([\d\s]+[.,]\d{2})\s+([\d\s]+[.,]\d{2})\s+(\d+(?:[.,]\d+)?)\s*%\s+([\d\s]+[.,]\d{2})$/.exec(entry.line.text)
      if (!match) continue
      const lineHt = decimal(match[4]), gross = decimal(match[6])
      lines.push({
        description: match[1].replace(/^[\W_]+/, "").trim(),
        quantity: decimal(match[2]),
        unitPrice: decimal(match[3]),
        vatRate: decimal(match[5]),
        lineHt,
        lineVat: dec(gross).sub(dec(lineHt)).round(2, "half_up").toString(),
      })
      sources[`lines.${lineIndex++}`] = { page: entry.page, bbox: entry.line.bbox }
    }
  }
  if (lines.length) fields.lines = lines

  const required = ["supplier", "invoiceNumber", "invoiceDate", "currency", "lines", "totals"]
  return { fields, sources, missingFields: required.filter(key => !(key in fields)) }
}
