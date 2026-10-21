// OCR provider contract (Phase 1b). Providers return what they actually read, where they read
// it, and what their engine says about it; nothing is filled in or estimated.

/** Normalized page coordinates in [0, 1], origin top-left of the page as returned (after any rotation applied). */
export type BBox = { x0: number; y0: number; x1: number; y1: number }

export type OcrWord = {
  text: string
  bbox: BBox
  /** Engine confidence in [0, 1]; null when the engine reports none (e.g. exact PDF text). */
  confidence: number | null
}

export type OcrLine = { text: string; bbox: BBox; words: OcrWord[] }

export type OcrPage = {
  page: number
  /** Size of the page as processed: PDF points for native text, pixels for images. */
  width: number
  height: number
  unit: "pt" | "px"
  /** native_text: PDF text layer (exact characters); image_ocr: recognized from pixels. */
  source: "native_text" | "image_ocr"
  /** Granularity of the boxes: OCR gives word boxes; a PDF text layer gives text-run boxes. */
  granularity: "word" | "text_run"
  /** Clockwise rotation (degrees) applied before recognition; coordinates refer to the rotated page. */
  rotationApplied: 0 | 90 | 180 | 270
  /** Mean engine confidence of the page's words, or null. */
  meanConfidence: number | null
  lines: OcrLine[]
}

export type ProcessingStage =
  | "received"
  | "text_layer"
  | "rasterizing"
  | "ocr"
  | "orientation"
  | "page_done"
  | "extracting"
  | "done"
  | "failed"

/** A real step of the pipeline, timestamped when it happened (used for history and UI progress). */
export type ProcessingEvent = {
  stage: ProcessingStage
  at: string
  page?: number
  pages?: number
  /** Engine-reported progress in [0, 1], when the engine provides it. */
  progress?: number
  detail?: string
}

export type OcrDocument = {
  provider: string
  engine: string
  languages: string[]
  pages: OcrPage[]
  warnings: string[]
  durationMs: number
}

export type ProviderCapabilities = {
  nativeText: boolean
  imageOcr: boolean
  coordinates: "word" | "text_run" | "none"
  engineConfidence: boolean
  languages: string[]
  mimeTypes: string[]
  /** true when documents never leave the server. */
  runsLocally: boolean
}

export type OcrErrorCode =
  | "UNSUPPORTED_MIME"
  | "CORRUPT_DOCUMENT"
  | "TOO_MANY_PAGES"
  | "NO_TEXT_FOUND"
  | "ENGINE_UNAVAILABLE"
  | "TIMEOUT"

export class OcrError extends Error {
  constructor(
    readonly code: OcrErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "OcrError"
  }
}

export type RecognizeOptions = {
  onEvent?: (event: ProcessingEvent) => void
  signal?: AbortSignal
}

export interface DocumentOcrProvider {
  readonly name: string
  readonly capabilities: ProviderCapabilities
  recognize(input: { buffer: Buffer; mimeType: string }, options?: RecognizeOptions): Promise<OcrDocument>
  close?(): Promise<void>
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
export const unionBox = (boxes: BBox[]): BBox => ({
  x0: Math.min(...boxes.map((b) => b.x0)),
  y0: Math.min(...boxes.map((b) => b.y0)),
  x1: Math.max(...boxes.map((b) => b.x1)),
  y1: Math.max(...boxes.map((b) => b.y1)),
})
export const event = (stage: ProcessingStage, extra: Omit<ProcessingEvent, "stage" | "at"> = {}): ProcessingEvent => ({
  stage,
  at: new Date().toISOString(),
  ...extra,
})
