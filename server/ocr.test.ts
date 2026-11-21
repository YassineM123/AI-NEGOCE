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

  it("extracts generated TND invoices with a discount column and net-to-pay total", () => {
    const document: OcrDocument = {
      provider: "local", engine: "pdf-text-layer", languages: ["fra"], warnings: [], durationMs: 1,
      pages: [{
        page: 1, width: 595, height: 842, unit: "pt", source: "native_text", granularity: "text_run", rotationApplied: 0, meanConfidence: null,
        lines: [
          line("STE RAVINO SARL FACTURE"),
          line("Facture N° : F001-2026-0091"),
          line("Date : 22/10/2026"),
          line("Devise : TND"),
          line("Réf. Désignation Qté P.U. HT Remise TVA Total HT"),
          line("RA4-ECO Ramette papier A4 Eco 50 9.500 0% 7% 475.000"),
          line("TON-PRO Toner Ravi Pro 4 185.000 0% 19% 740.000"),
          line("Total HT 1 215.000 TND"),
          line("Total TVA 173.850 TND"),
          line("Timbre 1.000 TND"),
          line("NET À PAYER 1 389.850 TND"),
        ],
      }],
    }
    const result = extractInvoiceFields(document)
    expect(result.fields).toMatchObject({
      totals: { ht: "1215.000", vat: "173.850", stamp: "1.000", ttc: "1389.850" },
      lines: [
        { supplierReference: "RA4-ECO", discountPct: "0", vatRate: "7", lineHt: "475.000", lineVat: "33.250" },
        { supplierReference: "TON-PRO", discountPct: "0", vatRate: "19", lineHt: "740.000", lineVat: "140.600" },
      ],
    })
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

  it("extracts a French EUR layout with a column header and written-out date", () => {
    const positioned = (parts: Array<[string, number, number]>): OcrLine => ({
      text: parts.map(([word]) => word).join(" "),
      bbox: { x0: 0.03, y0: 0.4, x1: 0.98, y1: 0.42 },
      words: parts.map(([word, x0, x1]) => ({ text: word, bbox: { x0, y0: 0.4, x1, y1: 0.42 }, confidence: null })),
    })
    const document: OcrDocument = {
      provider: "local", engine: "pdf-text-layer", languages: ["fra"], warnings: [], durationMs: 1,
      pages: [{
        page: 1, width: 595, height: 842, unit: "pt", source: "native_text", granularity: "text_run", rotationApplied: 0, meanConfidence: null,
        lines: [
          line("75008 PARIS"),
          line("Valenton, le 28 Août 2026"),
          positioned([["FACTURE N° 2026/2162", .42, .66]]),
          positioned([["Désignation", .221, .312], ["U", .536, .548], ["Qté", .596, .624], ["PU HT", .698, .751], ["Total HT", .818, .885], ["TVA", .934, .971]]),
          line("DEVIS N° 76 /2026 31/07/2026"),
          positioned([["Demande Acompte 50 % : 8 529.60 € HT", .029, .378], ["8 529.600", .704, .789], ["8 529.60", .849, .924], ["10.00", .936, .984]]),
          line("Total Hors Taxes € 8 529.60"),
          line("TVA à 10.00 % 852.96"),
          line("Total T.T.C. € 9 382.56"),
          line("Valeur en votre règlement à l'ordre de CHB au 28.08.2026"),
        ],
      }],
    }
    const result = extractInvoiceFields(document)
    expect(result.fields).toMatchObject({
      supplier: "CHB",
      invoiceNumber: "2026/2162",
      invoiceDate: "2026-08-28",
      currency: "EUR",
      totals: { ht: "8529.60", vat: "852.96", ttc: "9382.56" },
      lines: [{ description: "Demande Acompte 50 % : 8 529.60 € HT", quantity: "1", unitPrice: "8529.600", vatRate: "10.00", lineHt: "8529.60", lineVat: "852.96" }],
    })
    expect(result.missingFields).toEqual([])
  })

  it("reads a French retail layout with label rows, VAT codes and a VAT summary table", () => {
    const positioned = (parts: Array<[string, number]>): OcrLine => ({
      text: parts.map(([word]) => word).join(" "),
      bbox: { x0: 0.04, y0: 0.3, x1: 0.98, y1: 0.32 },
      words: parts.map(([word, x0]) => ({ text: word, bbox: { x0, y0: 0.3, x1: x0 + 0.05, y1: 0.32 }, confidence: null })),
    })
    const document: OcrDocument = {
      provider: "local", engine: "pdf-text-layer", languages: ["fra"], warnings: [], durationMs: 1,
      pages: [{
        page: 1, width: 595, height: 842, unit: "pt", source: "native_text", granularity: "text_run", rotationApplied: 0, meanConfidence: null,
        lines: [
          line("FACTURE DUPLICATA"),
          positioned([["Société ANKAA", 0.05], ["3", 0.55]]),
          line("105 rue La Fayette"),
          positioned([["75010 PARIS", 0.05], ["Coordonnées bancaires pour virements", 0.57]]),
          positioned([["N° TVA :", 0.05], ["FR52900302183", 0.16], ["IBAN :", 0.57], ["FR7610107001270041808946395", 0.67]]),
          line("SAS au capital de 2 281 500€ SWIFT : BREDFRPPXXX"),
          positioned([["Client N°", 0.08], ["Facture N°", 0.18], ["Date de Facture Date de retrait", 0.27], ["Commande N°", 0.47], ["Conditions de paiement", 0.62], ["Date de paiement", 0.83]]),
          positioned([["66061228", 0.08], ["0022628700117", 0.17], ["14/10/2026", 0.29], ["14/10/2026", 0.39]]),
          line("Description Référence Prix unitaire H.T. Prix remisé H.T. Quantité Code T.V.A. Total H.T. (EUR)"),
          line("1 SAC 10 POCH PLAN PERF S/RABAT 98067292 14,07 12,67 1,00 A 12,67"),
          line("1 CLAS A LEVIER A4 EXA D8 GRIS 98025976 3,41 3,07 4,00 A 12,27"),
          line("1 BLOC RHODIA N16 ORGE A5 5X5 10096 3,07 2,77 1,00 A 2,77"),
          line("0 Total remise(s) : -7,89"),
          line("Taux T.V.A. Montant T.V.A. Total H.T. Total T.T.C."),
          line("A 20.00 % 10,39 51,98 62,37"),
          line("TOTAL 10,39 51,98 62,37"),
        ],
      }],
    }
    const result = extractInvoiceFields(document)
    expect(result.fields).toMatchObject({
      supplier: "Société ANKAA",
      invoiceNumber: "0022628700117",
      invoiceDate: "2026-10-14",
      currency: "EUR",
      totals: { ht: "51.98", vat: "10.39", ttc: "62.37" },
      lines: [
        { supplierReference: "98067292", description: "SAC 10 POCH PLAN PERF S/RABAT", quantity: "1.00", unitPrice: "12.67", vatRate: "20.00", lineHt: "12.67", lineVat: "2.53" },
        { supplierReference: "98025976", description: "CLAS A LEVIER A4 EXA D8 GRIS", quantity: "4.00", unitPrice: "3.07", vatRate: "20.00", lineHt: "12.27", lineVat: "2.45" },
        { supplierReference: "10096", description: "BLOC RHODIA N16 ORGE A5 5X5", quantity: "1.00", unitPrice: "2.77", vatRate: "20.00", lineHt: "2.77", lineVat: "0.55" },
      ],
    })
    expect(result.missingFields).toEqual([])
  })
})
