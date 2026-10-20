import crypto from "node:crypto"
import type { NextFunction, Request, RequestHandler, Response } from "express"
import { createRemoteJWKSet, jwtVerify } from "jose"
import type { AppConfig } from "./config.js"

export type Role = "admin" | "manager" | "accountant" | "commercial"
export type Principal = {
  id: string
  /** Tenant of the user, always taken from verified server-side context, never from input. */
  organizationId: string
  name: string
  role: Role
  agencies: string[]
}

/** Development organizations (AUTH_MODE=local-dev only): synthetic data, never customers. */
export const DEV_ORGANIZATIONS = [
  { id: "demo-fictive", name: "Organisation de démonstration — données fictives", status: "active", isSynthetic: true },
  { id: "demo-fictive-b", name: "Organisation de test B — données fictives", status: "active", isSynthetic: true },
] as const
const ORGANIZATION_ID = /^[a-z0-9][a-z0-9-]{1,62}$/
declare global {
  namespace Express {
    interface Request {
      principal?: Principal
    }
  }
}

/**
 * Local development identities (AUTH_MODE=local-dev only). The catalogue lives on the server:
 * a development token only names one of these keys, so it can never claim another role or
 * agency. Names are deliberately not personal names.
 */
export const DEV_IDENTITIES: Readonly<Record<string, Principal>> = Object.freeze({
  admin: {
    id: "usr-admin",
    organizationId: "demo-fictive",
    name: "Administrateur (développement)",
    role: "admin",
    agencies: ["*"],
  },
  "manager-sfax": {
    id: "usr-sfax",
    organizationId: "demo-fictive",
    name: "Responsable Sfax (développement)",
    role: "manager",
    agencies: ["Sfax"],
  },
  "commercial-tunis": {
    id: "usr-tunis",
    organizationId: "demo-fictive",
    name: "Commercial Tunis (développement)",
    role: "commercial",
    agencies: ["Tunis Centre"],
  },
  // Second synthetic organization, to exercise tenant isolation by hand.
  "admin-org-b": {
    id: "usr-admin-b",
    organizationId: "demo-fictive-b",
    name: "Administrateur organisation B (développement)",
    role: "admin",
    agencies: ["*"],
  },
})
export const devIdentity = (key: string) =>
  Object.prototype.hasOwnProperty.call(DEV_IDENTITIES, key) ? DEV_IDENTITIES[key] : undefined

const DEV_ISSUER = "ai-negoce/local-dev"
const DEV_AUDIENCE = "ai-negoce-api/local-dev"
export const DEV_SESSION_TTL_SECONDS = 60 * 60

const b64url = (value: string) => Buffer.from(value).toString("base64url")

/** HS256 development token naming one identity of DEV_IDENTITIES (synchronous, so tests can mint it). */
export function signDevToken(
  key: string,
  identity: string,
  opts: { ttlSeconds?: number; now?: number } = {},
) {
  const now = opts.now ?? Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const payload = b64url(
    JSON.stringify({
      sub: identity,
      iss: DEV_ISSUER,
      aud: DEV_AUDIENCE,
      iat: now,
      exp: now + (opts.ttlSeconds ?? DEV_SESSION_TTL_SECONDS),
      jti: crypto.randomUUID(),
    }),
  )
  const signature = crypto
    .createHmac("sha256", key)
    .update(`${header}.${payload}`)
    .digest("base64url")
  return `${header}.${payload}.${signature}`
}

/** True for 127.0.0.0/8 and ::1, including IPv4-mapped IPv6 forms. */
export function isLoopbackAddress(address?: string) {
  if (!address) return false
  const a = address.toLowerCase().startsWith("::ffff:") ? address.slice(7) : address
  return a === "::1" || /^127(?:\.\d{1,3}){3}$/.test(a)
}

// Present when a proxy or tunnel relays the request: the client is then not this machine.
const PROXY_HEADERS = [
  "x-forwarded-for",
  "x-forwarded-host",
  "forwarded",
  "x-real-ip",
  "cf-connecting-ip",
  "true-client-ip",
]

/** AUTH_MODE=local-dev: refuses any request that does not come directly from this machine. */
export function localOnly(): RequestHandler {
  return (req, res, next) =>
    isLoopbackAddress(req.socket.remoteAddress) &&
    !PROXY_HEADERS.some((h) => req.headers[h] !== undefined)
      ? next()
      : res.status(403).json({
          error: {
            code: "LOCAL_DEV_ONLY",
            message: "Mode développement local : accès limité à ce poste",
          },
        })
}

export function createAuth(config: AppConfig) {
  const devKey =
    config.AUTH_MODE === "local-dev"
      ? config.AUTH_DEV_SIGNING_KEY ?? crypto.randomBytes(32).toString("base64url")
      : null
  const devSecret = devKey ? new TextEncoder().encode(devKey) : null
  // oidc mode always has a JWKS (enforced by loadConfig); local-dev may also accept real
  // identity-provider tokens when one is configured.
  const jwks = config.OIDC_JWKS_URL ? createRemoteJWKSet(new URL(config.OIDC_JWKS_URL)) : null

  /** Unverified issuer, used only to choose the single verification path for a token. */
  const issuerOf = (token: string) => {
    try {
      const iss = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()).iss
      return typeof iss === "string" ? iss : undefined
    } catch {
      return undefined
    }
  }

  async function verify(token: string): Promise<Principal> {
    if (devSecret && issuerOf(token) === DEV_ISSUER) {
      const { payload } = await jwtVerify(token, devSecret, {
        algorithms: ["HS256"],
        issuer: DEV_ISSUER,
        audience: DEV_AUDIENCE,
        requiredClaims: ["sub", "exp"],
      })
      const identity = typeof payload.sub === "string" ? devIdentity(payload.sub) : undefined
      if (!identity) throw new Error("Unknown development identity")
      return identity
    }
    if (!jwks) throw new Error("No identity provider configured")
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.OIDC_ISSUER,
      audience: config.OIDC_AUDIENCE,
    })
    const role = payload.role
    const organizationId = payload[config.OIDC_ORGANIZATION_CLAIM]
    if (
      !payload.sub ||
      typeof role !== "string" ||
      !["admin", "manager", "accountant", "commercial"].includes(role) ||
      // No tenant, no access: a token without a well-formed organization is refused.
      typeof organizationId !== "string" ||
      !ORGANIZATION_ID.test(organizationId)
    )
      throw new Error("Invalid claims")
    return {
      id: payload.sub,
      organizationId,
      name: typeof payload.name === "string" ? payload.name : payload.sub,
      role: role as Role,
      agencies: Array.isArray(payload.agencies)
        ? payload.agencies.filter((x): x is string => typeof x === "string")
        : [],
    }
  }

  const middleware = async (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
    if (!token)
      return res.status(401).json({
        error: { code: "AUTH_REQUIRED", message: "Authentification requise" },
      })
    try {
      req.principal = await verify(token)
      return next()
    } catch {
      // The token and the verification error are never logged.
      return res
        .status(401)
        .json({ error: { code: "INVALID_TOKEN", message: "Jeton invalide" } })
    }
  }

  return {
    mode: config.AUTH_MODE,
    middleware,
    /** local-dev only: a short-lived token for a catalogued identity. */
    issueDevToken(identity: string) {
      if (!devKey || !devIdentity(identity)) throw new Error("Development sessions unavailable")
      const now = Math.floor(Date.now() / 1000)
      return {
        token: signDevToken(devKey, identity, { now }),
        expiresAt: new Date((now + DEV_SESSION_TTL_SECONDS) * 1000).toISOString(),
      }
    },
  }
}

export function requireRoles(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) =>
    req.principal && roles.includes(req.principal.role)
      ? next()
      : res.status(403).json({
          error: { code: "FORBIDDEN", message: "Action non autorisée" },
        })
}

/** "*" = every agency; a list = exactly those agencies; null = outside the principal's scope. */
export type AgencyScope = "*" | string[]

export function scopedAgencies(
  req: Request,
  requested?: string,
): AgencyScope | null {
  const agencies = req.principal?.agencies ?? []
  const all = !requested || requested === "all"
  if (agencies.includes("*")) return all ? "*" : [requested]
  // A principal without any agency claim has no data scope (fail closed).
  if (!agencies.length) return null
  if (all) return [...agencies]
  return agencies.includes(requested) ? [requested] : null
}
