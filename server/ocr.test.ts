import { describe, expect, it } from "vitest"
import { extractInvoiceFields } from "./ocr.js"
import type { OcrDocument, OcrLine } from "./ocr/types.js"

const line = (text: string): OcrLine => ({
  text,
  bbox: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.15 },
  words: [],
})

describe("local invoice field extraction", () => {
  it("returns only values observed in invoice text with source locations", () => {
    const document: OcrDocument = {
      provider: "local",
      engine: "fixture",
      languages: ["fra"],
      warnings: [],
      durationMs: 1,
      pages: [{
        page: 1,
        width: 595,
        height: 842,
        unit: "pt",
        source: "native_text",
        granularity: "text_run",
        rotationApplied: 0,
        meanConfidence: null,
        lines: [
          line("SOCIETE CARTHAGE FOURNITURES SARL"),
          line("Facture N° : FC-2026-00125"),
          line("Date : 15/10/2026"),
          line("Devise : TND"),
          line("PAP-A4-80 Ramette papier A4 80g 10 12,500 19 % 125,000"),
          line("Total HT 125,000 TND"),
          line("TVA 19 % 23,750 TND"),
          line("TOTAL TTC 148,750 TND"),
        ],
      }],
    }

    const result = extractInvoiceFields(document)
    expect(result.fields).toMatchObject({
      supplier: "SOCIETE CARTHAGE FOURNITURES SARL",
      invoiceNumber: "FC-2026-00125",
      invoiceDate: "2026-10-15",
      currency: "TND",
      totals: { ht: "125.000", vat: "23.750", ttc: "148.750" },
      lines: [{ supplierReference: "PAP-A4-80", quantity: "10", unitPrice: "12.500", lineVat: "23.750" }],
    })
    expect(result.sources.invoiceNumber).toEqual({ page: 1, bbox: expect.any(Object) })
    expect(result.missingFields).toEqual([])
  })

  it("does not invent absent required fields", () => {
    const document: OcrDocument = {
      provider: "local", engine: "fixture", languages: [], warnings: [], durationMs: 1,
      pages: [{ page: 1, width: 1, height: 1, unit: "pt", source: "native_text", granularity: "text_run", rotationApplied: 0, meanConfidence: null, lines: [line("Texte sans données de facture")] }],
    }
    const result = extractInvoiceFields(document)
    expect(result.fields).toEqual({})
    expect(result.missingFields).toEqual(["supplier", "invoiceNumber", "invoiceDate", "currency", "lines", "totals"])
  })

  it("extracts an English USD image layout using observed column coordinates", () => {
    const positioned = (text: string, parts: Array<[string, number, number]>): OcrLine => ({
      text,
      bbox: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.15 },
      words: parts.map(([word, x0, x1]) => ({ text: word, bbox: { x0, y0: 0.1, x1, y1: 0.15 }, confidence: 0.95 })),
    })
    const document: OcrDocument = {
      provider: "local", engine: "fixture", languages: ["eng"], warnings: [], durationMs: 1,
      pages: [{
        page: 1, width: 1000, height: 1400, unit: "px", source: "image_ocr", granularity: "word", rotationApplied: 0, meanConfidence: 0.95,
        lines: [
          line("Invoice no: 12847181"),
          line("Date of issue: 03/03/2012"),
          line("Seller: Client:"),
          positioned("Fitzpatrick and Sons Duncan PLC", [["Fitzpatrick", .1, .2], ["and", .21, .24], ["Sons", .25, .3], ["Duncan", .6, .67], ["PLC", .68, .72]]),
          line("HP Desktop Computer PC 4,00 each 139,95 559,80 10% 615,78"),
          line("CUSTOM BUILT AMD RYZEN 3,00 each 1 400,00 4 200,00 10% 4 620,00"),
          line("Total $ 4 759,80 $ 475,98 $ 5 235,78"),
        ],
      }],
    }
    const result = extractInvoiceFields(document)
    expect(result.fields).toMatchObject({
      supplier: "Fitzpatrick and Sons",
      invoiceNumber: "12847181",
      invoiceDate: "2012-03-03",
      currency: "USD",
      totals: { ht: "4759.80", vat: "475.98", ttc: "5235.78" },
      lines: [
        { description: "HP Desktop Computer PC", quantity: "4.00", unitPrice: "139.95", lineHt: "559.80", lineVat: "55.98" },
        { description: "CUSTOM BUILT AMD RYZEN", quantity: "3.00", unitPrice: "1400.00", lineHt: "4200.00", lineVat: "420.00" },
      ],
    })
    expect(result.missingFields).toEqual([])
    expect(result.sources.supplier).toEqual({ page: 1, bbox: expect.any(Object) })
  })
})
