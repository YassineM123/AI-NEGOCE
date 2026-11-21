# Performance report

**Command:** `npx tsx tools/qa/perf.ts reports/evidence/performance.json`, run 15 October 2026.

**Setup:**
- Machine: AMD Ryzen 5 7535HS (12 threads), 23 GB RAM, Windows 11, Node v24.14.0
- A single API process with a real HTTP server, the in-memory store, and the synthetic dataset loaded: 17,127 fact lines, 9,492 receivables, 7,909 inventory rows
- The load client runs on the same machine, so its overhead is included in the figures
- Load increases progressively: concurrency 1 (40 requests), 4 (120), 16 (240)

## 1. Results

| Endpoint | Concurrency | p50 ms | p95 ms | p99 ms | Errors | Req/s |
|---|---:|---:|---:|---:|---:|---:|
| `GET /bi/overview` company | 1 | 6.6 | 15.7 | 97.3 | 0 % | 100 |
|  | 4 | 23.1 | 32.3 | 33.3 | 0 % | 171 |
|  | 16 | 83.3 | 109.5 | 129.3 | 0 % | 187 |
| `GET /bi/overview` agency + period | 1 | 3.0 | 6.0 | 8.2 | 0 % | 289 |
|  | 4 | 11.8 | 19.2 | 24.5 | 0 % | 330 |
|  | 16 | 40.5 | 56.3 | 57.9 | 0 % | 387 |
| `POST /copilot/query` agency comparison | 1 | 17.9 | 27.2 | 50.6 | 0 % | 52 |
|  | 4 | 69.0 | 82.5 | 86.5 | 0 % | 57 |
|  | 16 | 264.9 | 294.9 | 363.8 | 0 % | 62 |
| `POST /copilot/query` top customers | 1 | 14.6 | 28.7 | 32.8 | 0 % | 63 |
|  | 4 | 50.8 | 73.8 | 75.9 | 0 % | 76 |
|  | 16 | 186.6 | 196.8 | 334.8 | 0 % | 85 |
| `POST /documents` 40 KB PDF (OCR disabled) | 1 | 4.3 | 7.1 | 14.6 | 0 % | 198 |
|  | 4 | 12.8 | 23.6 | 28.3 | 0 % | 281 |
|  | 16 | 40.7 | 52.9 | 54.9 | 0 % | 376 |

**Memory (RSS):** 96 MB at start, 124 MB after loading the dataset (load time 204 ms), 305 MB at the end of the run. The heap stayed at about 41–43 MB, so most RSS growth is upload buffers (multer memory storage) and allocator retention, not a leak in the heap.

## 2. Interpretation

- **Every request rescans the full dataset.** The CPU-bound handlers saturate one core, so throughput plateaus at about 190 req/s for company BI and about 60 req/s for the Copilot comparison, and latency grows roughly linearly with concurrency. That is acceptable for an MVP with a few users. At real ERP volumes (millions of lines) it would not be.
  - **Recommendation:** pre-aggregate by agency × day in the database, or use ERP-side queries.
- The single p99 spike at concurrency 1 (97 ms) is warm-up (JIT and first allocation).

## 3. Not measured (blocked)

- **OCR processing time:** no engine.
- **LLM latency:** no LLM.
- **Background job throughput:** no queue exists.
- **PostgreSQL query performance:** no database.
- **Behaviour behind a reverse proxy or across processes.**

No production or shared environment was load-tested.
