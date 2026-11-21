// Local document OCR: PDF text layer when a page has one, Tesseract otherwise (scanned PDF pages
// are rendered first), Tesseract for images. Everything runs on the server.
import { openPdf, pdfTextPage, renderPdfPage } from "./pdf.js"
import { TesseractEngine, type TesseractOptions } from "./tesseract.js"
import {
  OcrError,
  event,
  type DocumentOcrProvider,
  type OcrDocument,
  type OcrPage,
  type ProviderCapabilities,
  type RecognizeOptions,
} from "./types.js"

export type LocalOcrOptions = TesseractOptions & {
  maxPages: number
  /** Resolution used to render scanned PDF pages before OCR. */
  rasterDpi: number
  /** A PDF page with fewer non-space characters in its text layer is treated as scanned. */
  minTextLayerChars: number
}

export class LocalOcrProvider implements DocumentOcrProvider {
  readonly name = "local"
  readonly capabilities: ProviderCapabilities
  private engine: TesseractEngine
  constructor(readonly options: LocalOcrOptions) {
    this.engine = new TesseractEngine(options)
    this.capabilities = {
      nativeText: true,
      imageOcr: true,
      coordinates: "word",
      engineConfidence: true,
      languages: options.languages,
      mimeTypes: ["application/pdf", "image/png", "image/jpeg"],
      runsLocally: true,
    }
  }

  async recognize(input: { buffer: Buffer; mimeType: string }, options: RecognizeOptions = {}): Promise<OcrDocument> {
    const started = Date.now()
    const emit = (e: ReturnType<typeof event>) => options.onEvent?.(e)
    const warnings: string[] = []
    const pages: OcrPage[] = []
    const check = () => {
      if (options.signal?.aborted) throw new OcrError("TIMEOUT", "Traitement interrompu")
    }
    if (!this.capabilities.mimeTypes.includes(input.mimeType))
      throw new OcrError("UNSUPPORTED_MIME", `Type de document non pris en charge : ${input.mimeType}`)
    if (input.mimeType === "application/pdf") {
      const doc = await openPdf(input.buffer)
      if (doc.numPages > this.options.maxPages)
        throw new OcrError("TOO_MANY_PAGES", `Document de ${doc.numPages} pages (maximum ${this.options.maxPages})`)
      emit(event("received", { pages: doc.numPages }))
      for (let n = 1; n <= doc.numPages; n++) {
        check()
        emit(event("text_layer", { page: n, pages: doc.numPages }))
        const text = await pdfTextPage(doc, n)
        if (text.characters >= this.options.minTextLayerChars) {
          const { characters: _c, ...page } = text
          pages.push(page)
        } else {
          if (text.characters > 0) warnings.push(`Page ${n} : couche texte trop courte (${text.characters} caractères), page lue par OCR`)
          emit(event("rasterizing", { page: n, pages: doc.numPages }))
          const png = await renderPdfPage(doc, n, this.options.rasterDpi)
          pages.push(await this.engine.recognizePage(png, n, options))
        }
        emit(event("page_done", { page: n, pages: doc.numPages }))
      }
      await doc.destroy()
    } else {
      emit(event("received", { pages: 1 }))
      pages.push(await this.engine.recognizePage(input.buffer, 1, options))
      emit(event("page_done", { page: 1, pages: 1 }))
    }
    for (const p of pages) if (p.rotationApplied) warnings.push(`Page ${p.page} : rotation de ${p.rotationApplied}° appliquée avant lecture`)
    if (!pages.some((p) => p.lines.length)) throw new OcrError("NO_TEXT_FOUND", "Aucun texte lisible dans le document")
    return {
      provider: this.name,
      engine: pages.some((p) => p.source === "image_ocr") ? `tesseract.js (${this.options.languages.join("+")})` : "pdf-text-layer",
      languages: this.options.languages,
      pages,
      warnings,
      durationMs: Date.now() - started,
    }
  }

  close() {
    return this.engine.close()
  }
}
