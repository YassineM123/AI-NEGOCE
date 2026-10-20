import type { NextFunction, Request, Response } from "express"
import { createRemoteJWKSet, jwtVerify } from "jose"
import type { AppConfig } from "./config.js"

export type Role = "admin" | "manager" | "accountant" | "commercial"
export type Principal = {
  id: string
  name: string
  role: Role
  agencies: string[]
}
declare global {
  namespace Express {
    interface Request {
      principal?: Principal
    }
  }
}

const developmentUsers: Record<string, Principal> = {
  "dev-admin": {
    id: "usr-admin",
    name: "Sonia Ben Amor",
    role: "admin",
    agencies: ["*"],
  },
  "dev-manager-sfax": {
    id: "usr-sfax",
    name: "Manager Sfax",
    role: "manager",
    agencies: ["Sfax"],
  },
  "dev-commercial-tunis": {
    id: "usr-tunis",
    name: "Commercial Tunis",
    role: "commercial",
    agencies: ["Tunis Centre"],
  },
}

export function authenticate(config: AppConfig) {
  const jwks = config.OIDC_JWKS_URL
    ? createRemoteJWKSet(new URL(config.OIDC_JWKS_URL))
    : null
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
    if (!token) return res.status(401).json({
        error: { code: "AUTH_REQUIRED", message: "Authentification requise" },
      })
    try {
      if (config.NODE_ENV !== "production" && developmentUsers[token])
        req.principal = developmentUsers[token]
      else {
        if (!jwks || !config.OIDC_ISSUER || !config.OIDC_AUDIENCE)
          throw new Error("OIDC unavailable")
        const { payload } = await jwtVerify(token, jwks, {
          issuer: config.OIDC_ISSUER,
          audience: config.OIDC_AUDIENCE,
        })
        const role = payload.role
        if (
          !payload.sub ||
          typeof role !== "string" ||
          !["admin", "manager", "accountant", "commercial"].includes(role)
        )
          throw new Error("Invalid claims")
        req.principal = {
          id: payload.sub,
          name: typeof payload.name === "string" ? payload.name : payload.sub,
          role: role as Role,
          agencies: Array.isArray(payload.agencies)
            ? payload.agencies.filter((x): x is string => typeof x === "string")
            : [],
        }
      }
      return next()
    } catch {
      return res
        .status(401)
        .json({ error: { code: "INVALID_TOKEN", message: "Jeton invalide" } })
    }
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
