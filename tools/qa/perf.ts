// Repeatable local performance test. Real HTTP server (ephemeral port) over the 10,000-document
// synthetic dataset, progressively increasing concurrency. Local machine only — never production.
// Usage: npx tsx tools/qa/perf.ts [out.json]
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { AddressInfo } from "node:net"
import { createApp } from "../../server/app.js"
import { loadConfig } from "../../server/config.js"
import { MemoryStore } from "../../server/store.js"
import { DisabledOcrProvider } from "../../server/ocr.js"
import { TestErpAdapter } from "../../server/erp.js"
import { synthetic } from "../../tests/qa/support/synthetic.js"

process.env.LOG_LEVEL = "silent"
const out = process.argv[2] ?? "reports/evidence/performance.json"
const mb = (n: number) => Math.round((n / 1024 / 1024) * 10) / 10
const before = process.memoryUsage()
const t0 = performance.now()
const s = synthetic()
const loadMs = performance.now() - t0
const data = { sales: s.sales, receivables: s.receivables, inventory: s.inventory, metadata: s.datasetMetadata }
const afterLoad = process.memoryUsage()
const app = createApp({
  config: loadConfig({ NODE_ENV: "test", RATE_LIMIT_PER_MINUTE: "1000000", UPLOAD_DIR: path.join(os.tmpdir(), `ai-negoce-perf-${Date.now()}`) }),
  store: new MemoryStore(),
  ocr: new DisabledOcrProvider(),
  erp: new TestErpAdapter(),
  data,
})
const server = app.listen(0, "127.0.0.1")
await new Promise((r) => server.once("listening", r))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`
const auth = { Authorization: "Bearer dev-admin" }

type Scenario = { name: string; make: (i: number) => [string, RequestInit] }
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) })
const scenarios: Scenario[] = [
  { name: "GET /bi/overview (company, 17k lines)", make: () => [`${base}/bi/overview?agency=all`, { headers: auth }] },
  { name: "GET /bi/overview (agency + period filter)", make: () => [`${base}/bi/overview?agency=Sfax&from=2025-10-01&to=2025-12-31`, { headers: auth }] },
  { name: "POST /copilot/query (agency comparison)", make: () => [`${base}/copilot/query`, json({ question: "Compare les agences" })] },
  { name: "POST /copilot/query (top customers)", make: () => [`${base}/copilot/query`, json({ question: "Quel est le meilleur client ?" })] },
  {
    name: "POST /documents (40 KB PDF upload, OCR disabled)",
    make: (i) => {
      const form = new FormData()
      form.append("agency", "Tunis Centre")
      form.append("file", new Blob([Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(40_000, 32), Buffer.from(`%${i}-${Math.random()}\n%%EOF`)])], { type: "application/pdf" }), `perf-${i}.pdf`)
      return [`${base}/documents`, { method: "POST", headers: auth, body: form }]
    },
  },
]
const LEVELS = [
  { concurrency: 1, requests: 40 },
  { concurrency: 4, requests: 120 },
  { concurrency: 16, requests: 240 },
]
const pct = (xs: number[], q: number) => xs[Math.min(xs.length - 1, Math.ceil(q * xs.length) - 1)]
const results: Record<string, unknown>[] = []
let seq = 0
for (const sc of scenarios)
  for (const lv of LEVELS) {
    const lat: number[] = []
    let errors = 0
    let next = 0
    const start = performance.now()
    await Promise.all(
      Array.from({ length: lv.concurrency }, async () => {
        while (next < lv.requests) {
          next++
          const [url, init] = sc.make(seq++)
          const t = performance.now()
          try {
            const r = await fetch(url, init)
            await r.arrayBuffer()
            if (r.status >= 400) errors++
          } catch {
            errors++
          }
          lat.push(performance.now() - t)
        }
      }),
    )
    const wall = (performance.now() - start) / 1000
    lat.sort((a, b) => a - b)
    const row = { scenario: sc.name, ...lv, p50Ms: +pct(lat, 0.5).toFixed(1), p95Ms: +pct(lat, 0.95).toFixed(1), p99Ms: +pct(lat, 0.99).toFixed(1), maxMs: +lat[lat.length - 1].toFixed(1), errorRate: errors / lat.length, throughputRps: +(lat.length / wall).toFixed(1) }
    results.push(row)
    console.log(JSON.stringify(row))
  }
const end = process.memoryUsage()
const report = {
  executedAt: new Date().toISOString(),
  host: { cpus: os.cpus().length, cpu: os.cpus()[0]?.model, totalMemGb: Math.round(os.totalmem() / 1024 ** 3), node: process.version, platform: process.platform },
  dataset: { salesLines: s.sales.length, receivables: s.receivables.length, inventoryRows: s.inventory.length, loadMs: Math.round(loadMs) },
  memoryMb: { rssBefore: mb(before.rss), rssAfterDatasetLoad: mb(afterLoad.rss), heapAfterLoad: mb(afterLoad.heapUsed), rssEnd: mb(end.rss), heapEnd: mb(end.heapUsed) },
  notes: ["Single Node process, in-memory store, client and server on the same machine (client overhead included).", "OCR disabled: upload latency excludes OCR processing. Copilot is the deterministic router; no LLM latency."],
  results,
}
fs.writeFileSync(out, JSON.stringify(report, null, 2))
server.close()
