// Shared QA harness: builds isolated app instances and a local OIDC issuer (JWKS over HTTP)
// so the production JWT path is exercised with real signatures, not only dev tokens.
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { SignJWT, exportJWK, generateKeyPair } from "jose"
import { createApp } from "../../../server/app.js"
import { signDevToken } from "../../../server/auth.js"
import { loadConfig } from "../../../server/config.js"
import { MemoryStore } from "../../../server/store.js"
import { DisabledOcrProvider, type OcrProvider } from "../../../server/ocr.js"
import { TestErpAdapter } from "../../../server/erp.js"

process.env.LOG_LEVEL = "silent"

export const ISSUER = "https://issuer.qa.local/"
export const AUDIENCE = "ai-negoce-api"

export async function startIssuer() {
  const { publicKey, privateKey } = await generateKeyPair("RS256")
  const jwk = { ...(await exportJWK(publicKey)), kid: "qa-key", alg: "RS256", use: "sig" }
  const server = http.createServer((_req, res) => {
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ keys: [jwk] }))
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const port = (server.address() as { port: number }).port
  const sign = (claims: Record<string, unknown>, opts: { issuer?: string; audience?: string; expiresIn?: string | number; key?: CryptoKey } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "qa-key" })
      .setIssuer(opts.issuer ?? ISSUER)
      .setAudience(opts.audience ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? "5m")
      .sign(opts.key ?? privateKey)
  return {
    jwksUrl: `http://127.0.0.1:${port}/jwks.json`,
    sign,
    close: () => new Promise<void>((r) => server.close(() => r())),
  }
}

export function makeApp(opts: { ocr?: OcrProvider; store?: MemoryStore; env?: Record<string, string>; data?: unknown } = {}) {
  const store = opts.store ?? new MemoryStore()
  const config = loadConfig({
    NODE_ENV: "test",
    AUTH_MODE: "local-dev",
    AUTH_DEV_SIGNING_KEY: TEST_DEV_KEY,
    UPLOAD_DIR: path.join(os.tmpdir(), `ai-negoce-qa-${crypto.randomUUID()}`),
    FRONTEND_ORIGIN: "http://localhost:8443",
    ...opts.env,
  })
  const deps: Record<string, unknown> = { config, store, ocr: opts.ocr ?? new DisabledOcrProvider(), erp: new TestErpAdapter() }
  if (opts.data) deps.data = opts.data
  return { app: createApp(deps as Parameters<typeof createApp>[0]), store, config }
}

/** Test-only HS256 key for AUTH_MODE=local-dev apps built by the test suites. */
export const TEST_DEV_KEY = "qa-only-local-dev-signing-key-not-a-secret-0001"
const DEV_ALIASES: Record<string, string> = {
  "dev-admin": "admin",
  "dev-manager-sfax": "manager-sfax",
  "dev-commercial-tunis": "commercial-tunis",
}
/**
 * Authorization header. `dev-<identity>` names a local development identity: a signed session
 * token is minted for it with TEST_DEV_KEY. Any other string is sent verbatim, so the raw text
 * "dev-admin" is itself never a valid credential.
 */
export const bearer = (token: string) => ({
  Authorization: `Bearer ${Object.prototype.hasOwnProperty.call(DEV_ALIASES, token) ? signDevToken(TEST_DEV_KEY, DEV_ALIASES[token]) : token}`,
})
export const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n")

export class StubOcr implements OcrProvider {
  readonly name = "qa-stub"
  calls = 0
  constructor(private behaviour: "complete" | "incomplete" | "throw") {}
  async extract() {
    this.calls++
    if (this.behaviour === "throw") throw new Error("OCR backend timeout (stub)")
    const complete = this.behaviour === "complete"
    return {
      fields: complete
        ? { supplier: "SUP-001", invoiceNumber: "F001-2026-0041", invoiceDate: "2026-03-12", currency: "TND", lines: [{ productId: "PRD-00005", description: "Ramette A4 Eco", quantity: 50, unitPrice: "9.500", discountPct: 0, vatRate: 7, lineHt: "475.000", lineVat: "33.250" }], totals: { ht: "475.000", vat: "33.250", stamp: "1.000", ttc: "509.250" } }
        : { supplier: "SUP-001" },
      missingFields: complete ? [] : ["invoiceNumber", "totals"],
      provider: this.name,
      confidence: complete ? 0.97 : 0.41,
    }
  }
}
