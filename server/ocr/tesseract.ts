// Local image OCR with Tesseract (tesseract.js, WebAssembly). Documents never leave the server;
// only the language models are downloaded once into OCR_CACHE_DIR (or read from OCR_LANG_PATH).
import { createCanvas, loadImage } from "@napi-rs/canvas"
import { createWorker, type Worker } from "tesseract.js"
import { OcrError, clamp01, event, type OcrPage, type OcrWord, type RecognizeOptions } from "./types.js"
import { groupIntoLines } from "./pdf.js"

export type TesseractOptions = {
  languages: string[]
  cachePath: string
  /** Directory or URL holding <lang>.traineddata; default: tesseract.js CDN (models only). */
  langPath?: string
  /** Try 90/180/270 degree rotations when a page reads poorly. */
  autoRotate: boolean
  pageTimeoutMs: number
}

type TWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }

export class TesseractEngine {
  private worker: Promise<Worker> | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private progress: ((p: number) => void) | null = null
  constructor(readonly options: TesseractOptions) {}

  private getWorker() {
    this.worker ??= createWorker(this.options.languages, 1, {
      cachePath: this.options.cachePath,
      ...(this.options.langPath ? { langPath: this.options.langPath } : {}),
      logger: (m: { status: string; progress: number }) => {
        if (m.status === "recognizing text") this.progress?.(m.progress)
      },
    }).catch((error) => {
      this.worker = null
      throw new OcrError("ENGINE_UNAVAILABLE", `Moteur OCR indisponible : ${error instanceof Error ? error.message : String(error)}`)
    })
    return this.worker
  }

  /** One recognition at a time per engine (a single WebAssembly worker). */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  private async recognizeRaw(image: Buffer, onProgress?: (p: number) => void) {
    const worker = await this.getWorker()
    this.progress = onProgress ?? null
    let timer: NodeJS.Timeout | undefined
    try {
      const result = await Promise.race([
        worker.recognize(image, {}, { blocks: true }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new OcrError("TIMEOUT", "Délai de reconnaissance dépassé")), this.options.pageTimeoutMs)
        }),
      ])
      const words: TWord[] = (result.data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)))
      return words.filter((w) => w.text.trim())
    } finally {
      clearTimeout(timer)
      this.progress = null
    }
  }

  /** Recognizes one image page; returns word boxes normalized to the (possibly rotated) image. */
  recognizePage(image: Buffer, pageNumber: number, options: RecognizeOptions = {}): Promise<OcrPage> {
    return this.exclusive(async () => {
      const decoded = await loadImage(image).catch(() => {
        throw new OcrError("CORRUPT_DOCUMENT", "Image illisible")
      })
      const emit = options.onEvent
      emit?.(event("ocr", { page: pageNumber, progress: 0 }))
      let best = { rotation: 0 as 0 | 90 | 180 | 270, words: await this.recognizeRaw(image, (p) => emit?.(event("ocr", { page: pageNumber, progress: p }))), width: decoded.width, height: decoded.height }
      if (this.options.autoRotate && poorReading(best.words)) {
        for (const rotation of [90, 180, 270] as const) {
          emit?.(event("orientation", { page: pageNumber, detail: `essai rotation ${rotation}°` }))
          const rotated = rotate(decoded, rotation)
          const words = await this.recognizeRaw(rotated.png)
          if (score(words) > score(best.words) * 1.2) best = { rotation, words, width: rotated.width, height: rotated.height }
        }
      }
      const words: OcrWord[] = best.words.map((w) => ({
        text: w.text,
        confidence: clamp01(w.confidence / 100),
        bbox: {
          x0: clamp01(w.bbox.x0 / best.width),
          y0: clamp01(w.bbox.y0 / best.height),
          x1: clamp01(w.bbox.x1 / best.width),
          y1: clamp01(w.bbox.y1 / best.height),
        },
      }))
      return {
        page: pageNumber,
        width: best.width,
        height: best.height,
        unit: "px" as const,
        source: "image_ocr" as const,
        granularity: "word" as const,
        rotationApplied: best.rotation,
        meanConfidence: words.length ? words.reduce((s, w) => s + (w.confidence ?? 0), 0) / words.length : null,
        lines: groupIntoLines(words),
      }
    })
  }

  async close() {
    const w = this.worker
    this.worker = null
    if (w) await (await w.catch(() => null))?.terminate()
  }
}

/** Score used to compare orientations: amount of confidently read text. */
const score = (words: TWord[]) => words.reduce((s, w) => s + (w.confidence / 100) * w.text.length, 0)
const poorReading = (words: TWord[]) =>
  words.length < 8 || words.reduce((s, w) => s + w.confidence, 0) / words.length < 60

function rotate(image: Awaited<ReturnType<typeof loadImage>>, degrees: 90 | 180 | 270) {
  const swap = degrees !== 180
  const width = swap ? image.height : image.width
  const height = swap ? image.width : image.height
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext("2d")
  ctx.translate(width / 2, height / 2)
  ctx.rotate((degrees * Math.PI) / 180)
  ctx.drawImage(image, -image.width / 2, -image.height / 2)
  return { png: canvas.toBuffer("image/png"), width, height }
}
