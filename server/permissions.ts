import type { NextFunction, Request, Response } from "express"
import type { Role } from "./auth.js"

/** Smart OCR permissions, checked on the server for every protected route. */
export type Permission =
  | "analytics.bi.read"
  | "analytics.ds.read"
  | "agentic.read"
  | "documents.read"
  | "documents.upload"
  | "invoice.correct"
  | "invoice.approve"
  | "mapping.approve"
  | "erp.integrate"
  | "settings.manage"

// documents.* and invoice.approve reproduce the role checks the routes had before.
// invoice.correct, mapping.approve and erp.integrate are not used by any route yet; their
// assignment is a least-privilege default NOT yet validated by the business. settings.manage
// (organization financial rules) is reserved to administrators.
const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  admin: [
    "analytics.bi.read",
    "analytics.ds.read",
    "agentic.read",
    "documents.read",
    "documents.upload",
    "invoice.correct",
    "invoice.approve",
    "mapping.approve",
    "erp.integrate",
    "settings.manage",
  ],
  accountant: ["analytics.bi.read", "analytics.ds.read", "documents.read", "documents.upload", "invoice.correct", "invoice.approve"],
  manager: ["analytics.bi.read", "analytics.ds.read", "agentic.read", "documents.read", "documents.upload", "invoice.correct"],
  commercial: ["analytics.bi.read", "agentic.read"],
}

export const permissionsForRole = (role: Role | undefined): readonly Permission[] =>
  role ? ROLE_PERMISSIONS[role] ?? [] : []

export const hasPermission = (role: Role | undefined, permission: Permission) =>
  permissionsForRole(role).includes(permission)

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) =>
    hasPermission(req.principal?.role, permission)
      ? next()
      : res.status(403).json({
          error: { code: "FORBIDDEN", message: "Action non autorisée" },
        })
}
