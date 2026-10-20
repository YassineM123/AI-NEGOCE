import { describe, expect, it } from "vitest"
import { loadConfig } from "./config.js"
describe("production configuration", () => {
  it("fails closed without external dependencies", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        FRONTEND_ORIGIN: "https://app.example.com",
      }),
    ).toThrow(/Production configuration incomplete/)
  })
  it("rejects incomplete OCR provider", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        AUTH_MODE: "local-dev",
        OCR_PROVIDER: "http",
        OCR_ENDPOINT: "https://ocr.example.com",
      }),
    ).toThrow(/OCR_API_KEY/)
  })
})
