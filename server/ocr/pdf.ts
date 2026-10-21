// PDF access through pdfjs-dist: native text layer with positions, and page rasterization for
// image-only (scanned) pages.
import { createCanvas } from "@napi-rs/canvas"
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs"
import { OcrError, clamp01, unionBox, type OcrLine, type OcrPage, type OcrWord } from "./types.js"

type TextItem = { str: string; transform: number[]; width: number; height: number }

export async function openPdf(buffer: Buffer) {
  try {
    return await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      verbosity: 0,
    }).promise
  } catch (error) {
    throw new OcrError("CORRUPT_DOCUMENT", `PDF illisible : ${error instanceof Error ? error.message : String(error)}`)
  }
}
export type PdfDocument = Awaited<ReturnType<typeof openPdf>>

/**
 * Text layer of one page as lines of text runs. Runs on the same baseline (within half a line
 * height) are joined left to right. Each run keeps its own box; confidence is null because the
 * characters are exact, not recognized.
 */
export async function pdfTextPage(doc: PdfDocument, pageNumber: number): Promise<OcrPage & { characters: number }> {
  const page = await doc.getPage(pageNumber)
  const { width, height } = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const runs: OcrWord[] = []
  for (const raw of content.items as TextItem[]) {
    if (!("str" in raw) || !raw.str.trim()) continue
    const [, , , , x, y] = raw.transform
    const h = raw.height || Math.abs(raw.transform[3]) || 1
    runs.push({
      text: raw.str.replace(/\s+/g, " ").trim(),
      bbox: {
        x0: clamp01(x / width),
        x1: clamp01((x + raw.width) / width),
        // PDF origin is bottom-left; boxes are top-left based.
        y0: clamp01(1 - (y + h) / height),
        y1: clamp01(1 - y / height),
      },
      confidence: null,
    })
  }
  return {
    page: pageNumber,
    width,
    height,
    unit: "pt",
    source: "native_text",
    granularity: "text_run",
    rotationApplied: 0,
    meanConfidence: null,
    lines: groupIntoLines(runs),
    characters: runs.reduce((n, r) => n + r.text.replace(/\s/g, "").length, 0),
  }
}

/** Renders one page to PNG at the given resolution (dots per inch). */
export async function renderPdfPage(doc: PdfDocument, pageNumber: number, dpi: number) {
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale: dpi / 72 })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const context = canvas.getContext("2d")
  context.fillStyle = "#ffffff"
  context.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: context as unknown as CanvasRenderingContext2D, viewport, canvas: canvas as unknown as HTMLCanvasElement }).promise
  return canvas.toBuffer("image/png")
}

/** Groups word or run boxes into reading-order lines (top to bottom, then left to right). */
export function groupIntoLines(words: OcrWord[]): OcrLine[] {
  const sorted = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0)
  const lines: OcrWord[][] = []
  for (const w of sorted) {
    const mid = (w.bbox.y0 + w.bbox.y1) / 2
    const line = lines.find((l) => {
      const box = unionBox(l.map((x) => x.bbox))
      const h = box.y1 - box.y0
      return mid >= box.y0 - h * 0.25 && mid <= box.y1 + h * 0.25 && Math.abs((box.y0 + box.y1) / 2 - mid) < h * 0.6
    })
    if (line) line.push(w)
    else lines.push([w])
  }
  return lines
    .map((l) => l.sort((a, b) => a.bbox.x0 - b.bbox.x0))
    .map((l) => ({ text: l.map((w) => w.text).join(" "), bbox: unionBox(l.map((w) => w.bbox)), words: l }))
    .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0)
}
