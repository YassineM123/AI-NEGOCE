import { z } from "zod"

/** Hosts accepted as "this machine only" for the local development identities. */
export const LOOPBACK_HOSTS = ["127.0.0.1", "::1", "localhost"]

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  // No default: the authentication mode is always an explicit choice (fail closed).
  AUTH_MODE: z.enum(["oidc", "local-dev"]).optional(),
  // Bind address. Loopback by default so a forgotten setting never exposes the API;
  // containers set HOST=0.0.0.0 together with AUTH_MODE=oidc.
  HOST: z.string().min(1).default("127.0.0.1"),
  // HS256 key for local development sessions; a random per-process key when absent.
  AUTH_DEV_SIGNING_KEY: z.string().min(32).optional(),
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

export type AppConfig = Omit<z.infer<typeof schema>, "AUTH_MODE"> & {
  AUTH_MODE: "oidc" | "local-dev"
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const config = schema.parse(env)
  if (config.NODE_ENV === "production") {
    const missing = [
      "AUTH_MODE",
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
  if (!config.AUTH_MODE)
    throw new Error(
      "AUTH_MODE is required: 'oidc' (identity provider) or 'local-dev' (local development identities, loopback only)",
    )
  const oidcKeys = ["OIDC_ISSUER", "OIDC_AUDIENCE", "OIDC_JWKS_URL"]
  const oidcMissing = oidcKeys.filter((key) => !env[key])
  if (config.AUTH_MODE === "oidc" && oidcMissing.length)
    throw new Error(`AUTH_MODE=oidc requires ${oidcMissing.join(", ")}`)
  // A partial identity-provider configuration would skip issuer or audience checks.
  if (oidcMissing.length && oidcMissing.length < oidcKeys.length)
    throw new Error(`Incomplete OIDC configuration: missing ${oidcMissing.join(", ")}`)
  if (config.AUTH_MODE === "local-dev") {
    if (config.NODE_ENV === "production")
      throw new Error("AUTH_MODE=local-dev is forbidden when NODE_ENV=production")
    if (!LOOPBACK_HOSTS.includes(config.HOST))
      throw new Error(
        `AUTH_MODE=local-dev requires a loopback HOST (${LOOPBACK_HOSTS.join(", ")}); got ${config.HOST}`,
      )
  }
  if (
    config.OCR_PROVIDER === "http" &&
    (!config.OCR_ENDPOINT || !config.OCR_API_KEY)
  )
    throw new Error("OCR http provider requires OCR_ENDPOINT and OCR_API_KEY")
  return config as AppConfig
}
