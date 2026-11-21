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
  const match = /^(\d{2})[/.-](\d{2})[/.-](\d{4})$/.exec(value.trim())
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value
}
const isoUsDate = (value: string) => {
  const match = /^(\d{2})[/.-](\d{2})[/.-](\d{4})$/.exec(value.trim())
  return match ? `${match[3]}-${match[1]}-${match[2]}` : value
}
const frenchMonths = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"]
const frenchDate = (value: string) => {
  const match = /^(\d{1,2})(?:er)?\s+(\S+)\s+(\d{4})$/.exec(value.trim())
  const month = match ? frenchMonths.indexOf(match[2].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()) : -1
  return match && month >= 0 ? `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}` : null
}

/** Item rows under a "Désignation … Total HT … TVA" header, read by word position: each
 * word goes to the header column whose centre is nearest. Stops at the first totals line. */
function columnRows(observed: Array<{ page: number; line: import("./ocr/types.js").OcrLine }>) {
  const headerAt = observed.findIndex(entry => /D[ée]signation/i.test(entry.line.text) && /Total\s+HT/i.test(entry.line.text) && entry.line.words.length > 1)
  if (headerAt < 0) return []
  const header = observed[headerAt]
  const columns = header.line.words.map(word => {
    const text = word.text.toLowerCase()
    const role = /d[ée]signation/.test(text) ? "description" : /^qt/.test(text) ? "quantity" : /^pu/.test(text) ? "unitPrice" : /^total/.test(text) ? "total" : /^tva/.test(text) ? "vat" : "other"
    return { role, centre: (word.bbox.x0 + word.bbox.x1) / 2 }
  })
  const rows: Array<{ page: number; bbox: import("./ocr/types.js").BBox; description: string; quantity?: string; unitPrice: string; total: string; vat: string }> = []
  for (const entry of observed.slice(headerAt + 1)) {
    if (entry.page !== header.page || /^Total\b/i.test(entry.line.text)) break
    const cells: Record<string, string> = {}
    for (const word of entry.line.words) {
      const centre = (word.bbox.x0 + word.bbox.x1) / 2
      const role = columns.reduce((best, column) => Math.abs(column.centre - centre) < Math.abs(best.centre - centre) ? column : best).role
      cells[role] = cells[role] ? `${cells[role]} ${word.text}` : word.text
    }
    const amount = /^\d[\d\s]*[.,]\d{2,3}$/
    if (!cells.description || !amount.test(cells.total ?? "") || !amount.test(cells.unitPrice ?? "") || !/^\d+(?:[.,]\d+)?\s*%?$/.test(cells.vat ?? "")) continue
    if (cells.quantity && !/^\d+(?:[.,]\d+)?$/.test(cells.quantity)) continue
    rows.push({ page: entry.page, bbox: entry.line.bbox, description: cells.description.trim(), quantity: cells.quantity, unitPrice: cells.unitPrice, total: cells.total, vat: cells.vat.replace(/\s*%$/, "") })
  }
  return rows
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
      const value = match?.[1] ? transform(match[1]) : null
      if (value == null) continue
      fields[key] = value
      sources[key] = { page: entry.page, bbox: entry.line.bbox }
      return
    }
  }
  // Label row / value row grids ("Facture N°" above "0022628700117"): the value is the first
  // word on the next line whose nearest label, by left edge, is the wanted one.
  const labelled = (key: string, label: RegExp, value: RegExp, transform: (value: string) => unknown = value => value) => {
    for (const [index, entry] of observed.entries()) {
      const target = entry.line.words.find(word => label.test(word.text.trim()))
      const next = observed[index + 1]
      if (!target || !next || next.page !== entry.page) continue
      const nearest = (x: number) => entry.line.words.reduce((best, word) => Math.abs(word.bbox.x0 - x) < Math.abs(best.bbox.x0 - x) ? word : best)
      const cell = next.line.words.find(word => nearest(word.bbox.x0) === target && value.test(word.text.trim()))
      if (!cell) continue
      fields[key] = transform(cell.text.trim())
      sources[key] = { page: next.page, bbox: next.line.bbox }
      return
    }
  }
  labelled("invoiceNumber", /^Facture\s*N[°o]?$/i, /^[\w/-]*\d[\w/-]*$/)
  labelled("invoiceDate", /^Date\s+de\s+Facture/i, /^\d{2}[/.-]\d{2}[/.-]\d{4}$/, isoDate)

  const supplier = observed.find(entry => /\b(?:SARL|SA|SUARL|SAS|SASU|EURL|SNC)\b/i.test(entry.line.text) && !/CLIENT/i.test(entry.line.text) && !/capital/i.test(entry.line.text))
  if (supplier) {
    fields.supplier = columnText(supplier.line, "left") || supplier.line.text.trim()
    sources.supplier = { page: supplier.page, bbox: supplier.line.bbox }
  } else {
    const sasIndex = observed.findIndex(entry => /\b(?:SAS|SARL)\b/i.test(entry.line.text) && /capital/i.test(entry.line.text))
    // The seller block's address and VAT lines sit between the name and "SAS au capital".
    const seller = observed.slice(Math.max(0, sasIndex - 6), Math.max(0, sasIndex)).reverse()
      .find(entry => /^Soci[ée]t[ée]\s+\S/i.test(columnText(entry.line, "left")))
    if (seller) {
      fields.supplier = columnText(seller.line, "left")
      sources.supplier = { page: seller.page, bbox: seller.line.bbox }
    }
  }
  if (!("supplier" in fields)) capture("supplier", /(?:Fournisseur|Vendeur)\s*:\s*([^\n\r]+)/i)
  if (!("supplier" in fields)) capture("supplier", /(?:règlement\s+)?à\s+l['’]ordre\s+de\s+(.+?)(?:\s+au\s+\d|\s*$|\s*[,.-])/i)

  capture("supplierTaxId", /Matricule\s+fiscal\s*:\s*([^\s]+(?:\/[A-Z0-9]+){2,})/i)
  if (!("invoiceNumber" in fields)) capture("invoiceNumber", /\bFacture\s*N[\u00b0o]?\s*:\s*([^\s]+)/i)
  if (!("invoiceNumber" in fields)) capture("invoiceNumber", /\bN[\u00b0o]\s*(?:de\s+)?facture\s*:?\s*([^\s]+)/i)
  if (!("invoiceNumber" in fields)) capture("invoiceNumber", /Invoice\s*(?:no\.?|#|number)\s*:?\s*([^\s]+)/i)
  if (!("invoiceNumber" in fields)) capture("invoiceNumber", /\bFacture\s*N[°o]\s*:?\s*([^\s:]*\d[^\s:]*)/i)
  if (!("invoiceNumber" in fields)) capture("invoiceNumber", /\bFACTURE\s*[:#]\s*([A-Z0-9/-]*\d[A-Z0-9/-]*)/i)

  if (!("invoiceDate" in fields)) capture("invoiceDate", /\bDate(?:\s+(?:de\s+facture|de\s+facturation|d['’]émission|facture))?\s*:\s*(\d{2}[/.-]\d{2}[/.-]\d{4})/i, isoDate)
  if (!("invoiceDate" in fields)) capture("invoiceDate", /Date\s+of\s+issue\s*:\s*(\d{2}[/.-]\d{2}[/.-]\d{4})/i, isoUsDate)
  if (!("invoiceDate" in fields)) capture("invoiceDate", /\b(?:le|du)\s+(\d{1,2}(?:er)?\s+[a-zéûA-ZÉÛ]+\s+\d{4})\b/i, frenchDate)
  if (!("invoiceDate" in fields)) capture("invoiceDate", /\bDate\s*:\s*(\d{2}[/.-]\d{2}[/.-]\d{4})/i, isoDate)

  capture("dueDate", /(?:Echeance|Échéance)\s*:\s*(\d{2}[/.-]\d{2}[/.-]\d{4})/i, isoDate)
  capture("currency", /Devise\s*:\s*([A-Z]{3})\b/i, value => value.toUpperCase())
  if (!("currency" in fields) && observed.some(entry => /\b(?:TND|DT)\b/i.test(entry.line.text))) fields.currency = "TND"
  if (!("currency" in fields) && observed.some(entry => /\$|\bUSD\b/i.test(entry.line.text))) fields.currency = "USD"
  if (!("currency" in fields) && observed.some(entry => /€|\bEUR\b/i.test(entry.line.text))) fields.currency = "EUR"

  // Common English/USD computer-generated layout. The seller and client share visual
  // rows, so use the observed word coordinates instead of guessing from concatenated text.
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
    ["ht", /\bTotal\s+HT\s+([\d\s]+[.,]\d{3})(?:\s+[A-Z]{3})?/i],
    ["vat", /^(?:Total\s+)?TVA(?:\s+\d+(?:[.,]\d+)?\s*%)?\s+([\d\s]+[.,]\d{3})(?:\s+[A-Z]{3})?/i],
    ["stamp", /^Timbre(?:\s+fiscal)?\s+([\d\s]+[.,]\d{3})(?:\s+[A-Z]{3})?/i],
    ["ttc", /^(?:TOTAL\s+TTC|NET\s+[ÀA]\s+PAYER)\s+([\d\s]+[.,]\d{3})(?:\s+[A-Z]{3})?/i],
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

  if (!("totals" in fields)) {
    const eurPatterns: Array<[string, RegExp]> = [
      ["ht", /\bTotal\s+(?:Hors\s+Taxes|HT)\s*€?\s*([\d\s]+[.,]\d{2})\s*€?$/i],
      ["vat", /^TVA\s+(?:à\s+)?\d+(?:[.,]\d+)?\s*%\s*€?\s*([\d\s]+[.,]\d{2})\s*€?$/i],
      ["ttc", /\bTotal\s+T\.?\s*T\.?\s*C\.?\s*€?\s*([\d\s]+[.,]\d{2})\s*€?$/i],
    ]
    const eur: Record<string, string> = {}
    for (const [name, pattern] of eurPatterns) {
      const entry = observed.find(candidate => pattern.test(candidate.line.text))
      const match = entry && pattern.exec(entry.line.text)
      if (entry && match?.[1]) {
        eur[name] = decimal(match[1])
        sources[`totals.${name}`] = { page: entry.page, bbox: entry.line.bbox }
      }
    }
    if (Object.keys(eur).length) fields.totals = eur
  }

  // VAT summary table: "Taux T.V.A. Montant T.V.A. Total H.T. Total T.T.C." then "TOTAL a b c",
  // with the amounts in the header's column order.
  if (!("totals" in fields)) {
    const labels: Array<[string, RegExp]> = [["vat", /Montant\s+T\.?V\.?A/i], ["ht", /Total\s+H\.?T/i], ["ttc", /Total\s+T\.?T\.?C/i]]
    const headerAt = observed.findIndex(entry => labels.every(([, label]) => label.test(entry.line.text)))
    const row = headerAt >= 0 ? observed.slice(headerAt + 1).find(entry => /^TOTAL(?:\s+[\d\s]*\d[.,]\d{2}){3}$/i.test(entry.line.text)) : undefined
    const amounts = row?.line.text.match(/\d[\d\s]*?[.,]\d{2}/g)
    if (row && amounts?.length === 3) {
      const header = observed[headerAt].line.text
      const ordered = [...labels].sort(([, a], [, b]) => header.search(a) - header.search(b))
      fields.totals = Object.fromEntries(ordered.map(([name], index) => [name, decimal(amounts[index])]))
      for (const [name] of ordered) sources[`totals.${name}`] = { page: row.page, bbox: row.line.bbox }
    }
  }

  if (!("totals" in fields)) {
    const totalLine = observed.find(entry => /^TOTAL\s+([\d\s]+[.,]\d{2})\s+([\d\s]+[.,]\d{2})\s+([\d\s]+[.,]\d{2})$/i.test(entry.line.text))
    const match = totalLine && /^TOTAL\s+([\d\s]+[.,]\d{2})\s+([\d\s]+[.,]\d{2})\s+([\d\s]+[.,]\d{2})$/i.exec(totalLine.line.text)
    if (totalLine && match) {
      fields.totals = { vat: decimal(match[1]), ht: decimal(match[2]), ttc: decimal(match[3]) }
      for (const name of ["ht", "vat", "ttc"]) sources[`totals.${name}`] = { page: totalLine.page, bbox: totalLine.line.bbox }
    }
  }

  let lineIndex = 0
  const lines: Array<{
    supplierReference?: string
    description: string
    quantity: string
    unitPrice: string
    discountPct?: string
    vatRate: string
    lineHt: string
    lineVat: string
  }> = observed.flatMap(entry => {
    const match = /^(\S+)\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+(\d+[.,]\d{3})\s+(?:(\d+(?:[.,]\d+)?)\s*%\s+)?(\d+(?:[.,]\d+)?)\s*%\s+(\d+[.,]\d{3})$/.exec(entry.line.text)
    if (!match) return []
    const lineHt = decimal(match[7])
    const vatRate = decimal(match[6])
    const lineVat = dec(lineHt).percent(dec(vatRate)).round(3, "half_up").toString()
    sources[`lines.${lineIndex++}`] = { page: entry.page, bbox: entry.line.bbox }
    return [{
      supplierReference: match[1],
      description: match[2].trim(),
      quantity: decimal(match[3]),
      unitPrice: decimal(match[4]),
      ...(match[5] ? { discountPct: decimal(match[5]) } : {}),
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
  if (!lines.length) {
    for (const row of columnRows(observed)) {
      const lineHt = decimal(row.total), vatRate = decimal(row.vat), unitPrice = decimal(row.unitPrice)
      // A blank "Qté" cell is read as 1 only when the unit price already equals the line
      // total (deposit / lump-sum rows); any other blank quantity is left unextracted.
      const quantity = row.quantity ? decimal(row.quantity) : dec(unitPrice).eq(dec(lineHt)) ? "1" : undefined
      if (!quantity) continue
      lines.push({
        description: row.description,
        quantity,
        unitPrice,
        vatRate,
        lineHt,
        lineVat: dec(lineHt).percent(dec(vatRate)).round(2, "half_up").toString(),
      })
      sources[`lines.${lineIndex++}`] = { page: row.page, bbox: row.bbox }
    }
  }
  if (!lines.length) {
    const vatRatesByCode: Record<string, string> = {}
    for (const entry of observed) {
      const m = /^([A-Z])\s+([\d\s]+[.,]\d{2})\s*%\s+([\d\s]+[.,]\d{2})/i.exec(entry.line.text)
      if (m) vatRatesByCode[m[1].toUpperCase()] = decimal(m[2])
    }
    for (const entry of observed) {
      const match = /^(?:\d+\s+)?(.+?)\s+(\d{4,10})\s+([\d\s]+[.,]\d{2})\s+([\d\s]+[.,]\d{2})\s+([\d\s]+[.,]\d{2})\s+([A-Z])\s+([\d\s]+[.,]\d{2})$/.exec(entry.line.text)
      if (!match) continue
      const desc = match[1].trim()
      const ref = match[2]
      const unitPrice = decimal(match[4])
      const quantity = decimal(match[5])
      const vatCode = match[6].toUpperCase()
      const lineHt = decimal(match[7])
      const vatRate = vatRatesByCode[vatCode] ?? "20.00"
      const lineVat = dec(lineHt).percent(dec(vatRate)).round(2, "half_up").toString()
      lines.push({
        supplierReference: ref,
        description: desc,
        quantity,
        unitPrice,
        vatRate,
        lineHt,
        lineVat,
      })
      sources[`lines.${lineIndex++}`] = { page: entry.page, bbox: entry.line.bbox }
    }
  }
  if (lines.length) fields.lines = lines

  const required = ["supplier", "invoiceNumber", "invoiceDate", "currency", "lines", "totals"]
  return { fields, sources, missingFields: required.filter(key => !(key in fields)) }
}
