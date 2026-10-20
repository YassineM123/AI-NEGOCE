import { z } from "zod"

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  API_PORT: z.coerce.number().int().positive().default(3001),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:8443"),
  UPLOAD_DIR: z.string().default("var/uploads"),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
  DATABASE_URL: z.string().min(1).optional(),
  OIDC_ISSUER: z.string().url().optional(),
  OIDC_AUDIENCE: z.string().min(1).optional(),
  OIDC_JWKS_URL: z.string().url().optional(),
  ERP_BASE_URL: z.string().url().optional(),
  ERP_API_TOKEN: z.string().min(16).optional(),
  OCR_PROVIDER: z.enum(["disabled", "http"]).default("disabled"),
  OCR_ENDPOINT: z.string().url().optional(),
  OCR_API_KEY: z.string().min(8).optional(),
})

export type AppConfig = z.infer<typeof schema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const config = schema.parse(env)
  if (config.NODE_ENV === "production") {
    const missing = [
      "DATABASE_URL",
      "OIDC_ISSUER",
      "OIDC_AUDIENCE",
      "OIDC_JWKS_URL",
      "ERP_BASE_URL",
      "ERP_API_TOKEN",
    ].filter((key) => !env[key])
    if (missing.length)
      throw new Error(
        `Production configuration incomplete: ${missing.join(", ")}`,
      )
  }
  if (
    config.OCR_PROVIDER === "http" &&
    (!config.OCR_ENDPOINT || !config.OCR_API_KEY)
  )
    throw new Error("OCR http provider requires OCR_ENDPOINT and OCR_API_KEY")
  return config
}
