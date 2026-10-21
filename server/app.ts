import { importPurchase, purchaseSubmission } from "./ocr-purchases.js"
import express from "express"
import cors from "cors"
import helmet from "helmet"
import rateLimit from "express-rate-limit"
import multer from "multer"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import pino from "pino"
import pinoHttp from "pino-http"
import { z } from "zod"
import {
  DEV_IDENTITIES,
  DEV_ORGANIZATIONS,
  createAuth,
  devIdentity,
  localOnly,
  requireRoles,
  scopedAgencies,
} from "./auth.js"
import { hasPermission, requirePermission } from "./permissions.js"
import { loadConfig, type AppConfig } from "./config.js"
import {
  defaultDataset,
  groundedAnswer,
  overview,
  type Dataset,
} from "./services.js"
import { validateInvoice, type InvoiceInput } from "./invoice-validation.js"
import {
  DEMO_FINANCIAL_RULES,
  financialRulesSchema,
  rulesUsable,
} from "./financial-rules.js"
import {
  DisabledOcrProvider,
  LocalExtractionProvider,
  HttpOcrProvider,
  type OcrProvider,
} from "./ocr.js"
import {
  MemoryStore,
  PostgresStore,
  RevisionConflictError,
  type Organization,
  type Store,
} from "./store.js"
import { UnconfiguredErpAdapter, type ErpAdapter } from "./erp.js"
import { ErpDatabase } from "./erp-db.js"
import { managementPage } from "./erp-pages.js"
import { bi360, datasetFrom } from "./erp-bi.js"
import {
  ErpError,
  createPayment,
  createPurchaseOrder,
  createSalesInvoice,
  createStockMovement,
  lookups,
  paymentInput,
  purchaseOrderInput,
  receivePurchaseOrder,
  salesInvoiceInput,
  stockMovementInput,
} from "./erp-writes.js"
import type { AgencyScope } from "./auth.js"

export type Dependencies = {
  config: AppConfig
  store: Store
  ocr: OcrProvider
  erp: ErpAdapter
  /** BI/Copilot data source; defaults to the declared local test fixture */
  data?: Dataset
  /** Local ERP database (SQLite) behind the dashboard; null when not built */
  erpDb?: ErpDatabase | null
  /** Log destination; stdout when absent (tests inject one to inspect the output) */
  logDestination?: pino.DestinationStream
}
export function defaultDependencies(env = process.env): Dependencies {
  const config = loadConfig(env)
  return {
    config,
    store: config.DATABASE_URL
      ? new PostgresStore(config.DATABASE_URL)
      : new MemoryStore(),
    ocr:
      config.OCR_PROVIDER === "http"
        ? new HttpOcrProvider(config.OCR_ENDPOINT!, config.OCR_API_KEY!)
        : config.OCR_PROVIDER === "local"
          ? new LocalExtractionProvider()
          : new DisabledOcrProvider(),
    erp: new UnconfiguredErpAdapter(),
    erpDb: ErpDatabase.open(),
  }
}

export function createApp(deps = defaultDependencies()) {
  const { config, store, ocr, erp } = deps
  // BI/Copilot read the ERP database when it exists; tests inject their own dataset.
  const data = () => deps.data ?? (deps.erpDb ? datasetFrom(deps.erpDb) : defaultDataset())
  const isRealDate = (d: string) => {
    const t = Date.parse(`${d}T00:00:00Z`)
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d
  }
  const isoDate = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isRealDate, "Date invalide")
  const periodSchema = z
    .object({ from: isoDate.optional(), to: isoDate.optional() })
    .refine((p) => !p.from || !p.to || p.from <= p.to, "Période invalide")
  const uuid = z.string().uuid()
  const uploadDir = path.resolve(config.UPLOAD_DIR)
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  })
  const allowed = new Map([
    ["application/pdf", "%PDF-"],
    ["image/png", "\u0089PNG"],
    ["image/jpeg", "\u00ff\u00d8\u00ff"],
  ])
  const logger = pino(
    {
      level: process.env.LOG_LEVEL || "info",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        'res.headers["set-cookie"]',
        "req.body",
        "res.body",
      ],
    },
    deps.logDestination,
  )
  const app = express()
  app.disable("x-powered-by")
  app.use(helmet({ contentSecurityPolicy: false }))
  app.use(
    cors({
      origin: config.FRONTEND_ORIGIN,
      methods: ["GET", "POST", "PUT", "PATCH"],
      allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
    }),
  )
  app.use(express.json({ limit: "256kb" }))
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id =
          typeof req.headers["x-request-id"] === "string"
            ? req.headers["x-request-id"].slice(0, 100)
            : crypto.randomUUID()
        res.setHeader("x-request-id", id)
        return id
      },
    }),
  )
  app.use(
    "/api/",
    rateLimit({
      windowMs: 60_000,
      limit: config.RATE_LIMIT_PER_MINUTE,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  )
  app.get("/api/v1/livez", (_req, res) => res.json({ status: "ok" }))
  app.get("/api/v1/readyz", async (_req, res) => {
    const database = await store.health()
    const erpReady = await erp.health()
    const ready = database && (config.NODE_ENV !== "production" || erpReady)
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      dependencies: { database, erp: erpReady, ocr: ocr.name !== "disabled" },
    })
  })
  const auth = createAuth(config)
  // Development organizations are created on first use (local-dev only, synthetic data).
  let devOrganizations: Promise<void> | null = null
  const ensureDevOrganizations = () =>
    auth.mode !== "local-dev"
      ? Promise.resolve()
      : (devOrganizations ??= Promise.all(
          DEV_ORGANIZATIONS.map(async (o) => {
            await store.ensureOrganization({ ...o })
            // Demonstration rules, unverified: usable only because these organizations are synthetic.
            const { verified: _v, verifiedBy: _b, verifiedAt: _a, ...rules } = DEMO_FINANCIAL_RULES
            await store.forTenant(o.id).ensureFinancialRules(rules)
          }),
        )
          .then(() => undefined)
          .catch((error) => {
            devOrganizations = null
            throw error
          }))
  if (auth.mode === "local-dev") {
    // Development identities exist only on this machine: no remote client, no proxy.
    app.use("/api/v1", localOnly())
    app.post("/api/v1/auth/dev-session", async (req, res) => {
      // JSON only: a cross-site form post cannot reach this endpoint without a CORS preflight.
      if (!req.is("application/json"))
        return res.status(415).json({
          error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Corps JSON requis" },
        })
      const parsed = z.object({ identity: z.string().max(40) }).safeParse(req.body)
      const principal = parsed.success ? devIdentity(parsed.data.identity) : undefined
      if (!parsed.success || !principal)
        return res.status(400).json({
          error: {
            code: "UNKNOWN_IDENTITY",
            message: "Identité de développement inconnue",
            details: { available: Object.keys(DEV_IDENTITIES) },
          },
        })
      await ensureDevOrganizations()
      const session = auth.issueDevToken(parsed.data.identity)
      await store.forTenant(principal.organizationId).audit({
        actorId: principal.id,
        action: "auth.dev_session.issued",
        resourceType: "auth",
        resourceId: parsed.data.identity,
      })
      res.setHeader("Cache-Control", "no-store")
      return res.status(201).json({ ...session, principal })
    })
  }
  app.use("/api/v1", auth.middleware)
  // Tenant resolution: the organization comes only from the verified principal, and it must
  // exist and be active. Cached for 30 s, so a suspension takes effect within that delay.
  const organizations = new Map<string, { org: Organization | undefined; at: number }>()
  const recordedUsers = new Map<string, number>()
  app.use("/api/v1", async (req, res, next) => {
    try {
      await ensureDevOrganizations()
      const id = req.principal!.organizationId
      let hit = organizations.get(id)
      if (!hit || Date.now() - hit.at > 30_000) {
        hit = { org: await store.getOrganization(id), at: Date.now() }
        organizations.set(id, hit)
      }
      if (!hit.org || hit.org.status !== "active")
        return res.status(403).json({
          error: { code: "ORGANIZATION_INACTIVE", message: "Organisation inconnue ou inactive" },
        })
      res.locals.organization = hit.org
      // Keep the users table current (refreshed at most every 10 minutes per user/role/scope).
      const p = req.principal!
      const key = `${id}|${p.id}|${p.role}|${p.agencies.join(",")}`
      const seen = recordedUsers.get(key)
      if (!seen || Date.now() - seen > 600_000) {
        await store.forTenant(id).recordUser({ id: p.id, displayName: p.name, role: p.role, agencies: p.agencies })
        recordedUsers.set(key, Date.now())
      }
      return next()
    } catch (error) {
      return next(error)
    }
  })
  /** Store confined to the caller's organization. */
  const tenant = (req: express.Request) => store.forTenant(req.principal!.organizationId)
  const documentCapabilities = (req: express.Request, status: string, extraction?: { missingFields: string[]; provider?: string } | null) => ({
    canCorrect: status === "needs_review" && hasPermission(req.principal?.role, "invoice.correct"),
    canApprove: status === "needs_review" && !!extraction && extraction.missingFields.length === 0 && hasPermission(req.principal?.role, "invoice.approve"),
    canReject: status === "needs_review" && hasPermission(req.principal?.role, "invoice.approve"),
    canReopen: ["approved", "rejected", "failed"].includes(status) && hasPermission(req.principal?.role, "invoice.correct"),
    canRetry: (status === "failed" || (status === "needs_review" && (!extraction || extraction.provider === "disabled"))) && hasPermission(req.principal?.role, "documents.upload"),
    canIntegrate: status === "approved" && hasPermission(req.principal?.role, "erp.integrate") && sandboxTenant(req) && !!deps.erpDb,
  })
  app.get("/api/v1/me", async (req, res) => {
    const org = res.locals.organization as Organization
    // What the screens are really reading, so the UI never implies a production ERP link.
    const erpStatus = !erp.production ? "not_configured" : (await erp.health().catch(() => false)) ? "available" : "unavailable"
    const dataSource =
      req.principal!.organizationId === config.ERP_SANDBOX_ORGANIZATION && config.NODE_ENV !== "production"
        ? {
            kind: "sandbox" as const,
            label: deps.erpDb
              ? "Bac à sable ERP synthétique (SQLite) — données fictives"
              : "Jeu de données de test — données fictives",
          }
        : erpStatus === "available"
          ? { kind: "erp" as const, label: `Connecteur ERP « ${erp.name} »` }
          : { kind: "none" as const, label: "Aucune source ERP connectée" }
    res.json({
      ...req.principal,
      organization: { id: org.id, name: org.name, isSynthetic: org.isSynthetic },
      authMode: auth.mode,
      dataSource,
      erpStatus,
    })
  })
  // The SQLite ERP sandbox and the BI/Copilot fixtures hold one synthetic company: only the
  // designated sandbox organization may read or write them.
  const sandboxTenant = (req: express.Request) =>
    req.principal!.organizationId === config.ERP_SANDBOX_ORGANIZATION
  const sandboxDenied = (res: express.Response) =>
    res.status(403).json({
      error: { code: "ERP_SOURCE_UNAVAILABLE", message: "Aucune source ERP configurée pour cette organisation" },
    })
  const requireErpData: express.RequestHandler = (req, res, next) =>
    config.NODE_ENV === "production" && !erp.production
      ? res.status(503).json({ error: { code: "ERP_UNAVAILABLE", message: "Source ERP indisponible" } })
      : !sandboxTenant(req)
        ? sandboxDenied(res)
        : next()
  app.get(
    "/api/v1/bi/overview",
    requireRoles("admin", "manager", "accountant", "commercial"),
    requireErpData,
    (req, res) => {
      const parsed = z
        .object({ agency: z.string().max(80).optional() })
        .and(periodSchema)
        .safeParse(req.query)
      if (!parsed.success) return res.status(400).json({
          error: {
            code: "INVALID_REQUEST",
            message: "Filtres invalides",
            details: parsed.error.flatten(),
          },
        })
      const agencies = scopedAgencies(req, parsed.data.agency || "all")
      if (agencies === null) return res.status(403).json({
          error: {
            code: "AGENCY_FORBIDDEN",
            message: "Agence hors périmètre",
          },
        })
      return res.json(
        overview(
          { agencies, from: parsed.data.from, to: parsed.data.to },
          data(),
        ),
      )
    },
  )
  app.get(
    "/api/v1/dashboard",
    requireRoles("admin", "manager", "accountant", "commercial"),
    requireErpData,
    (req, res) => {
      if (!deps.erpDb)
        return res.status(503).json({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Base de données absente : lancez npm run db:seed",
          },
        })
      const parsed = z
        .object({
          agency: z.string().max(80).optional(),
          period: z.enum(["month", "quarter", "year"]).default("month"),
        })
        .safeParse(req.query)
      if (!parsed.success)
        return res.status(400).json({
          error: { code: "INVALID_REQUEST", message: "Filtres invalides", details: parsed.error.flatten() },
        })
      const agencies = scopedAgencies(req, parsed.data.agency || "all")
      if (agencies === null)
        return res.status(403).json({
          error: { code: "AGENCY_FORBIDDEN", message: "Agence hors périmètre" },
        })
      return res.json(deps.erpDb.dashboard(parsed.data.period, agencies))
    },
  )
  const erpGuard: express.RequestHandler = (req, res, next) =>
    !sandboxTenant(req)
      ? sandboxDenied(res)
      : deps.erpDb
      ? next()
      : res.status(503).json({
          error: { code: "DATABASE_UNAVAILABLE", message: "Base de données absente : lancez npm run db:reset" },
        })
  /** Runs a database write and maps business errors to 4xx responses. */
  const erpWrite =
    <S extends z.ZodTypeAny>(schema: S, action: string, fn: (db: ErpDatabase, scope: AgencyScope, input: z.infer<S>, req: express.Request) => { id?: string; reference?: string; supplierInvoiceId?: string }): express.RequestHandler =>
    async (req, res) => {
      const parsed = schema.safeParse(req.body)
      if (!parsed.success)
        return res.status(400).json({
          error: { code: "INVALID_REQUEST", message: parsed.error.issues[0]?.message ?? "Saisie invalide", details: parsed.error.flatten() },
        })
      const scope = scopedAgencies(req, "all")
      if (scope === null) return res.status(403).json({ error: { code: "AGENCY_FORBIDDEN", message: "Aucune agence autorisée" } })
      try {
        const result = fn(deps.erpDb!, scope, parsed.data, req)
        await tenant(req).audit({
          actorId: req.principal!.id,
          action,
          resourceType: "erp",
          resourceId: result.id ?? result.reference ?? result.supplierInvoiceId ?? "",
        })
        return res.status(201).json(result)
      } catch (error) {
        if (error instanceof ErpError)
          return res.status(error.status).json({ error: { code: "ERP_RULE", message: error.message } })
        throw error
      }
    }
  const pageQuery = z.object({
    agency: z.string().max(80).optional(),
    tab: z.string().max(30).optional(),
    days: z.enum(["30", "90", "365", "all"]).default("30"),
    q: z.string().max(100).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
  })
  app.get(
    "/api/v1/erp/pages/:module",
    requireRoles("admin", "manager", "accountant", "commercial"),
    erpGuard,
    (req, res) => {
      const module = z.enum(["sales", "purchases", "inventory", "finance"]).safeParse(req.params.module)
      const parsed = pageQuery.safeParse(req.query)
      if (!module.success || !parsed.success)
        return res.status(400).json({ error: { code: "INVALID_REQUEST", message: "Filtres invalides" } })
      const agencies = scopedAgencies(req, parsed.data.agency || "all")
      if (agencies === null)
        return res.status(403).json({ error: { code: "AGENCY_FORBIDDEN", message: "Agence hors périmètre" } })
      return res.json(managementPage(deps.erpDb!, module.data, agencies, parsed.data))
    },
  )
  app.get(
    "/api/v1/erp/lookups",
    requireRoles("admin", "manager", "accountant", "commercial"),
    erpGuard,
    (req, res) => {
      const agencies = scopedAgencies(req, "all")
      if (agencies === null)
        return res.status(403).json({ error: { code: "AGENCY_FORBIDDEN", message: "Aucune agence autorisée" } })
      return res.json(lookups(deps.erpDb!, agencies))
    },
  )
  app.get(
    "/api/v1/bi/360",
    requireRoles("admin", "manager", "accountant", "commercial"),
    requireErpData,
    erpGuard,
    (req, res) => {
      const parsed = z
        .object({
          agency: z.string().max(80).optional(),
          period: z.enum(["month", "quarter", "year", "all"]).default("year"),
          category: z.string().max(20).optional(),
          focusAgency: z.string().max(80).optional(),
        })
        .safeParse(req.query)
      if (!parsed.success)
        return res.status(400).json({ error: { code: "INVALID_REQUEST", message: "Filtres invalides" } })
      const agencies = scopedAgencies(req, parsed.data.agency || "all")
      if (agencies === null)
        return res.status(403).json({ error: { code: "AGENCY_FORBIDDEN", message: "Agence hors périmètre" } })
      const focus =
        parsed.data.category && parsed.data.focusAgency
          ? { categoryId: parsed.data.category, agency: parsed.data.focusAgency }
          : undefined
      return res.json(bi360(deps.erpDb!, agencies, parsed.data.period, focus))
    },
  )
  app.post(
    "/api/v1/erp/sales-invoices",
    requireRoles("admin", "manager", "commercial"),
    erpGuard,
    erpWrite(salesInvoiceInput, "erp.sales_invoice.created", createSalesInvoice),
  )
  app.post(
    "/api/v1/erp/purchase-orders",
    requireRoles("admin", "manager"),
    erpGuard,
    erpWrite(purchaseOrderInput, "erp.purchase_order.created", createPurchaseOrder),
  )
  app.post(
    "/api/v1/erp/purchase-orders/:id/receive",
    requireRoles("admin", "manager"),
    erpGuard,
    erpWrite(
      z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), supplierInvoiceNumber: z.string().trim().max(60).optional() }),
      "erp.purchase_order.received",
      (db, scope, input, req) => receivePurchaseOrder(db, scope, String(req.params.id), input),
    ),
  )
  app.post(
    "/api/v1/erp/stock-movements",
    requireRoles("admin", "manager"),
    erpGuard,
    erpWrite(stockMovementInput, "erp.stock_movement.created", createStockMovement),
  )
  app.post(
    "/api/v1/erp/payments",
    requireRoles("admin", "manager", "accountant"),
    erpGuard,
    erpWrite(paymentInput, "erp.payment.created", createPayment),
  )
  app.post(
    "/api/v1/conversations",
    requireRoles("admin", "manager", "accountant", "commercial"),
    async (req, res) => {
      const parsed = z
        .object({ title: z.string().trim().min(1).max(120) })
        .safeParse(req.body)
      if (!parsed.success) return res.status(400).json({
          error: { code: "INVALID_REQUEST", message: "Titre invalide" },
        })
      const c = await tenant(req).createConversation(
        req.principal!.id,
        parsed.data.title,
      )
      await tenant(req).audit({
        actorId: req.principal!.id,
        action: "conversation.created",
        resourceType: "conversation",
        resourceId: c.id,
      })
      return res.status(201).json(c)
    },
  )
  app.get(
    "/api/v1/conversations/:id",
    requireRoles("admin", "manager", "accountant", "commercial"),
    async (req, res) => {
      const id = String(req.params.id)
      const c = uuid.safeParse(id).success
        ? await tenant(req).getConversation(id, req.principal!.id)
        : undefined
      return c ? res.json(c) : res.status(404).json({
            error: { code: "NOT_FOUND", message: "Conversation introuvable" },
          })
    },
  )
  app.post(
    "/api/v1/copilot/query",
    requireRoles("admin", "manager", "accountant", "commercial"),
    requireErpData,
    async (req, res) => {
      const parsed = z
        .object({
          question: z.string().trim().min(3).max(1000),
          conversationId: z.string().uuid().optional(),
          filters: z
            .object({ agency: z.string().max(80).optional() })
            .and(periodSchema)
            .optional(),
        })
        .safeParse(req.body)
      if (!parsed.success) return res.status(400).json({
          error: {
            code: "INVALID_REQUEST",
            message: "Question invalide",
            details: parsed.error.flatten(),
          },
        })
      const requested = parsed.data.filters?.agency || "all"
      const scope = scopedAgencies(req, requested)
      if (scope === null) return res.status(403).json({
          error: {
            code: "AGENCY_FORBIDDEN",
            message: "Agence hors périmètre",
          },
        })
      const c = parsed.data.conversationId
        ? await tenant(req).getConversation(
            parsed.data.conversationId,
            req.principal!.id,
          )
        : undefined
      if (parsed.data.conversationId && !c) return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Conversation introuvable" },
        })
      const answer = groundedAnswer(
        parsed.data.question,
        {
          scope,
          explicitAgency: requested === "all" ? undefined : requested,
          from: parsed.data.filters?.from,
          to: parsed.data.filters?.to,
        },
        data(),
        {
          previousQuestion: c?.messages
            .filter((m) => m.role === "user")
            .at(-1)?.content,
        },
      )
      if (c) {
        const now = new Date().toISOString()
        await tenant(req).addMessage(c.id, {
          role: "user",
          content: parsed.data.question,
          createdAt: now,
        })
        await tenant(req).addMessage(c.id, {
          role: "assistant",
          content: answer.answer,
          sources: answer.sources,
          createdAt: now,
        })
      }
      await tenant(req).audit({
        actorId: req.principal!.id,
        action: "copilot.queried",
        resourceType: "copilot",
        resourceId: parsed.data.conversationId || "ephemeral",
        metadata: { sourceCount: answer.sources.length },
      })
      return res.json(answer)
    },
  )
  app.post(
    "/api/v1/documents",
    requirePermission("documents.upload"),
    upload.single("file"),
    async (req, res) => {
      if (!req.file) return res.status(400).json({
          error: { code: "FILE_REQUIRED", message: "Aucun fichier reçu" },
        })
      const signature = req.file.buffer.subarray(0, 5).toString("latin1")
      const expected = allowed.get(req.file.mimetype)
      if (!expected || !signature.startsWith(expected))
        return res.status(415).json({
          error: {
            code: "UNSUPPORTED_FILE",
            message: "Contenu non autorisé",
          },
        })
      const scope = scopedAgencies(req, String(req.body.agency || "all"))
      if (scope === null) return res.status(403).json({
          error: {
            code: "AGENCY_FORBIDDEN",
            message: "Agence hors périmètre",
          },
        })
      if (scope === "*" || scope.length !== 1) return res.status(400).json({
          error: {
            code: "AGENCY_REQUIRED",
            message: "Une agence autorisée est requise",
          },
        })
      const agency = scope[0]
      const id = crypto.randomUUID()
      const extension =
        req.file.mimetype === "application/pdf"
          ? ".pdf"
          : req.file.mimetype === "image/png"
            ? ".png"
            : ".jpg"
      // One directory per organization; the organization id is validated (^[a-z0-9-]+$).
      const storageKey = `${req.principal!.organizationId}/${id}${extension}`
      const sha256 = crypto
        .createHash("sha256")
        .update(req.file.buffer)
        .digest("hex")
      const existing = await tenant(req).findDocumentByHash(sha256)
      if (existing) {
        res.location(`/api/v1/documents/${existing.id}`)
        return res.status(409).json({
          error: {
            code: "DUPLICATE_DOCUMENT",
            message: "Ce fichier a déjà été importé",
            details: {
              existingId: existing.id,
              status: existing.status,
              action: "OPEN_EXISTING",
            },
          },
        })
      }
      await fs.mkdir(path.dirname(path.join(uploadDir, storageKey)), { recursive: true })
      await fs.writeFile(path.join(uploadDir, storageKey), req.file.buffer, {
        flag: "wx",
      })
      try {
        await tenant(req).createDocument({
          id,
          ownerId: req.principal!.id,
          agency,
          filename: path.basename(req.file.originalname),
          storageKey,
          mimeType: req.file.mimetype,
          size: req.file.size,
          sha256,
          status: "needs_review",
          createdAt: new Date().toISOString(),
        })
      } catch (error) {
        await fs.unlink(path.join(uploadDir, storageKey)).catch(() => {})
        throw error
      }
      let extraction
      try {
        extraction = await ocr.extract({
          buffer: req.file.buffer,
          mimeType: req.file.mimetype,
        })
      } catch (err) {
        // Keep the stored file so extraction can be retried, but never leave the
        // record looking reviewable.
        req.log.warn({ err, documentId: id }, "ocr extraction failed")
        await tenant(req).updateDocumentStatus(id, "failed")
        await tenant(req).audit({
          actorId: req.principal!.id,
          action: "document.ocr_failed",
          resourceType: "document",
          resourceId: id,
        })
        return res.status(502).json({
          error: {
            code: "OCR_FAILED",
            message: "Extraction OCR indisponible, réessayez plus tard",
            details: { id, status: "failed" },
          },
        })
      }
      await tenant(req).saveExtraction(id, extraction)
      await tenant(req).audit({
        actorId: req.principal!.id,
        action: "document.uploaded",
        resourceType: "document",
        resourceId: id,
        metadata: {
          agency,
          mimeType: req.file.mimetype,
          size: req.file.size,
        },
      })
      return res.status(201).json({
        id,
        filename: path.basename(req.file.originalname),
        mimeType: req.file.mimetype,
        size: req.file.size,
        status: "needs_review",
        extraction,
        erpSubmission: (sandboxTenant(req) ? purchaseSubmission(deps.erpDb, req.principal!.organizationId, id) : null) ?? { status: "not_submitted", adapter: erp.name },
      })
    },
  )
  app.get(
    "/api/v1/documents",
    requirePermission("documents.read"),
    async (req, res) => {
      const scope = scopedAgencies(req, String(req.query.agency || "all"))
      if (scope === null) return res.status(403).json({
          error: {
            code: "AGENCY_FORBIDDEN",
            message: "Agence hors périmètre",
          },
        })
      const documents = await tenant(req).listDocuments(
        scope === "*" ? undefined : scope,
      )
      return res.json({
        documents: documents.map((doc) => ({
          id: doc.id,
          filename: doc.filename,
          mimeType: doc.mimeType,
          size: doc.size,
          status: doc.status,
          agency: doc.agency,
          createdAt: doc.createdAt,
          erpSubmission: (sandboxTenant(req) ? purchaseSubmission(deps.erpDb, req.principal!.organizationId, doc.id) : null) ?? { status: "not_submitted", adapter: erp.name },
        })),
      })
    },
  )
  app.get(
    "/api/v1/documents/:id",
    requirePermission("documents.read"),
    async (req, res) => {
      const id = String(req.params.id)
      const doc = uuid.safeParse(id).success
        ? await tenant(req).getDocument(id)
        : undefined
      if (!doc) return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Document introuvable" },
        })
      if (scopedAgencies(req, doc.agency) === null) return res.status(403).json({
          error: {
            code: "AGENCY_FORBIDDEN",
            message: "Document hors périmètre",
          },
        })
      const extraction = await tenant(req).getExtraction(doc.id)
      return res.json({
        ...doc,
        storageKey: undefined,
        sha256: undefined,
        extraction: extraction ?? null,
        processing: {
          status: doc.status === "failed" ? "failed" : extraction ? "succeeded" : "pending",
          events: extraction?.events ?? [],
          error: doc.status === "failed" ? { code: "OCR_FAILED", message: "La dernière extraction OCR a échoué" } : null,
        },
        capabilities: documentCapabilities(req, doc.status, extraction),
        erpSubmission: (sandboxTenant(req) ? purchaseSubmission(deps.erpDb, req.principal!.organizationId, doc.id) : null) ?? { status: "not_submitted", adapter: erp.name },
      })
    },
  )
  app.post(
    "/api/v1/documents/:id/retry",
    requirePermission("documents.upload"),
    async (req, res) => {
      const id = String(req.params.id)
      const doc = uuid.safeParse(id).success ? await tenant(req).getDocument(id) : undefined
      if (!doc) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Document introuvable" } })
      if (scopedAgencies(req, doc.agency) === null) return res.status(403).json({ error: { code: "AGENCY_FORBIDDEN", message: "Document hors périmètre" } })
      const previous = await tenant(req).getExtraction(doc.id)
      const mayReprocessMissingOrDisabled = doc.status === "needs_review" && (!previous || previous.provider === "disabled")
      if (doc.status !== "failed" && !mayReprocessMissingOrDisabled) return res.status(409).json({ error: { code: "INVALID_STATE", message: `Nouvelle extraction impossible au statut ${doc.status}` } })
      let content: Buffer
      try { content = await fs.readFile(path.resolve(uploadDir, doc.storageKey)) }
      catch { return res.status(410).json({ error: { code: "FILE_MISSING", message: "Fichier original indisponible" } }) }
      try {
        const extraction = await ocr.extract({ buffer: content, mimeType: doc.mimeType })
        await tenant(req).saveExtraction(doc.id, extraction)
        await tenant(req).updateDocumentStatus(doc.id, "needs_review")
        await tenant(req).audit({ actorId: req.principal!.id, action: "document.ocr_retried", resourceType: "document", resourceId: doc.id })
        return res.json({ id: doc.id, status: "needs_review", extraction, processing: { status: "succeeded", events: extraction.events ?? [], error: null } })
      } catch (error) {
        req.log.warn({ err: error, documentId: doc.id }, "ocr retry failed")
        await tenant(req).updateDocumentStatus(doc.id, "failed")
        await tenant(req).audit({ actorId: req.principal!.id, action: "document.ocr_retry_failed", resourceType: "document", resourceId: doc.id })
        return res.status(502).json({ error: { code: "OCR_FAILED", message: "Extraction OCR indisponible, réessayez plus tard", details: { id: doc.id, status: "failed" } } })
      }
    },
  )
  app.get(
    "/api/v1/documents/:id/validation",
    requirePermission("documents.read"),
    async (req, res) => {
      const id = String(req.params.id)
      const doc = uuid.safeParse(id).success ? await tenant(req).getDocument(id) : undefined
      if (!doc) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Document introuvable" } })
      if (scopedAgencies(req, doc.agency) === null) return res.status(403).json({ error: { code: "AGENCY_FORBIDDEN", message: "Document hors périmètre" } })
      const extraction = await tenant(req).getExtraction(doc.id)
      const stored = await tenant(req).getFinancialRules()
      const ruleState = rulesUsable(stored?.rules, res.locals.organization as Organization)
      if (!extraction) return res.json({ ready: false, issues: [{ code: "EXTRACTION_MISSING", severity: "blocking", message: "Aucune extraction disponible" }], rules: stored ? { revision: stored.revision, verified: stored.rules.verified } : null })
      if (extraction.missingFields.length) return res.json({ ready: false, issues: extraction.missingFields.map(field => ({ code: "FIELD_MISSING", severity: "blocking", field, message: `Champ requis absent : ${field}` })), rules: stored ? { revision: stored.revision, verified: stored.rules.verified } : null })
      if (!ruleState.ok) return res.json({ ready: false, issues: [{ code: ruleState.code, severity: "blocking", message: ruleState.message }], rules: stored ? { revision: stored.revision, verified: stored.rules.verified } : null })
      const fields = extraction.fields as InvoiceInput & { supplier?: string }
      const issues = validateInvoice({ ...fields, supplierId: fields.supplierId ?? fields.supplier }, { rules: stored!.rules })
      return res.json({ ready: issues.length === 0, issues, rules: { revision: stored!.revision, verified: stored!.rules.verified, source: stored!.rules.source } })
    },
  )
  // Audit trail of one document, oldest first. Same checks as the document itself; the
  // lookup and the audit query are both tenant-scoped.
  app.get(
    "/api/v1/documents/:id/history",
    requirePermission("documents.read"),
    async (req, res) => {
      const id = String(req.params.id)
      const doc = uuid.safeParse(id).success ? await tenant(req).getDocument(id) : undefined
      if (!doc) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Document introuvable" } })
      if (scopedAgencies(req, doc.agency) === null) return res.status(403).json({ error: { code: "AGENCY_FORBIDDEN", message: "Document hors périmètre" } })
      return res.json({ events: await tenant(req).listAuditEvents("document", doc.id) })
    },
  )
  app.post(
    "/api/v1/documents/:id/reject",
    requirePermission("invoice.approve"),
    async (req, res) => {
      const id = String(req.params.id), reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : ""
      if (!reason || reason.length > 500) return res.status(400).json({ error: { code: "REASON_REQUIRED", message: "Un motif de rejet est requis (500 caractères maximum)" } })
      const doc = uuid.safeParse(id).success ? await tenant(req).getDocument(id) : undefined
      if (!doc) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Document introuvable" } })
      if (scopedAgencies(req, doc.agency) === null) return res.status(403).json({ error: { code: "AGENCY_FORBIDDEN", message: "Document hors périmètre" } })
      if (doc.status !== "needs_review") return res.status(409).json({ error: { code: "INVALID_STATE", message: `Rejet impossible au statut ${doc.status}` } })
      if (!await tenant(req).transitionDocumentStatus(doc.id, ["needs_review"], "rejected"))
        return res.status(409).json({ error: { code: "STATE_CONFLICT", message: "Le document a été modifié par un autre utilisateur" } })
      await tenant(req).recordApprovalEvent({ documentId: doc.id, actorId: req.principal!.id, decision: "rejected", correction: { reason } })
      await tenant(req).audit({ actorId: req.principal!.id, action: "document.rejected", resourceType: "document", resourceId: doc.id, metadata: { reason } })
      return res.json({ id: doc.id, status: "rejected" })
    },
  )
  app.post(
    "/api/v1/documents/:id/reopen",
    requirePermission("invoice.correct"),
    async (req, res) => {
      const id = String(req.params.id)
      const doc = uuid.safeParse(id).success ? await tenant(req).getDocument(id) : undefined
      if (!doc) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Document introuvable" } })
      if (scopedAgencies(req, doc.agency) === null) return res.status(403).json({ error: { code: "AGENCY_FORBIDDEN", message: "Document hors périmètre" } })
      if (!["approved", "rejected", "failed"].includes(doc.status)) return res.status(409).json({ error: { code: "INVALID_STATE", message: `Réouverture impossible au statut ${doc.status}` } })
      if (!await tenant(req).transitionDocumentStatus(doc.id, ["approved", "rejected", "failed"], "needs_review"))
        return res.status(409).json({ error: { code: "STATE_CONFLICT", message: "Le document a été modifié par un autre utilisateur" } })
      await tenant(req).recordApprovalEvent({ documentId: doc.id, actorId: req.principal!.id, decision: "reopened" })
      await tenant(req).audit({ actorId: req.principal!.id, action: "document.reopened", resourceType: "document", resourceId: doc.id })
      return res.json({ id: doc.id, status: "needs_review" })
    },
  )
  // Original file, for the review viewer. Same checks as the metadata: permission, tenant
  // (the lookup is tenant-scoped) and agency. Served inline with a sandboxing CSP.
  app.get(
    "/api/v1/documents/:id/file",
    requirePermission("documents.read"),
    async (req, res) => {
      const id = String(req.params.id)
      const doc = uuid.safeParse(id).success
        ? await tenant(req).getDocument(id)
        : undefined
      if (!doc)
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Document introuvable" } })
      if (scopedAgencies(req, doc.agency) === null)
        return res.status(403).json({ error: { code: "AGENCY_FORBIDDEN", message: "Document hors périmètre" } })
      const file = path.resolve(uploadDir, doc.storageKey)
      if (!file.startsWith(uploadDir + path.sep))
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Document introuvable" } })
      let content: Buffer
      try {
        content = await fs.readFile(file)
      } catch {
        return res.status(410).json({ error: { code: "FILE_MISSING", message: "Fichier original indisponible" } })
      }
      await tenant(req).audit({
        actorId: req.principal!.id,
        action: "document.file_read",
        resourceType: "document",
        resourceId: doc.id,
      })
      res.setHeader("Content-Type", doc.mimeType)
      res.setHeader("Content-Disposition", `inline; filename="${doc.id}${path.extname(doc.storageKey)}"`)
      res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'")
      res.setHeader("Cache-Control", "private, no-store")
      return res.send(content)
    },
  )
  app.post(
    "/api/v1/documents/:id/approve",
    requirePermission("invoice.approve"),
    async (req, res) => {
      const id = String(req.params.id)
      const doc = uuid.safeParse(id).success
        ? await tenant(req).getDocument(id)
        : undefined
      if (!doc) return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Document introuvable" },
        })
      if (scopedAgencies(req, doc.agency) === null) return res.status(403).json({
          error: {
            code: "AGENCY_FORBIDDEN",
            message: "Document hors périmètre",
          },
        })
      if (doc.status !== "needs_review") return res.status(409).json({
          error: {
            code: "INVALID_STATE",
            message: `Document au statut ${doc.status} : approbation impossible`,
          },
        })
      const extraction = await tenant(req).getExtraction(doc.id)
      if (!extraction || extraction.missingFields.length) return res.status(409).json({
          error: {
            code: "EXTRACTION_INCOMPLETE",
            message: "Approbation impossible sans extraction validée",
            details: { missingFields: extraction?.missingFields ?? [] },
          },
        })
      const fields = extraction.fields as InvoiceInput & { supplier?: string }
      const stored = await tenant(req).getFinancialRules()
      const usable = rulesUsable(stored?.rules, res.locals.organization as Organization)
      if (!usable.ok)
        return res.status(409).json({ error: { code: usable.code, message: usable.message } })
      const issues = validateInvoice(
        { ...fields, supplierId: fields.supplierId ?? fields.supplier },
        { rules: stored!.rules },
      )
      if (issues.length) return res.status(409).json({
          error: {
            code: "VALIDATION_FAILED",
            message: "La facture extraite comporte des incohérences",
            details: { issues },
          },
        })
      if (!await tenant(req).transitionDocumentStatus(doc.id, ["needs_review"], "approved"))
        return res.status(409).json({ error: { code: "STATE_CONFLICT", message: "Le document a été modifié par un autre utilisateur" } })
      await tenant(req).recordApprovalEvent({ documentId: doc.id, actorId: req.principal!.id, decision: "approved" })
      await tenant(req).audit({
        actorId: req.principal!.id,
        action: "document.approved",
        resourceType: "document",
        resourceId: doc.id,
      })
      return res.json({
        id: doc.id,
        status: "approved",
        // Which rules the totals were checked against, and whether an accountant validated them.
        financialRules: { revision: stored!.revision, verified: stored!.rules.verified, source: stored!.rules.source },
      })
    },
  )
  app.post("/api/v1/documents/:id/purchases", requirePermission("erp.integrate"), erpGuard, async (req, res) => {
    const doc = uuid.safeParse(req.params.id).success ? await tenant(req).getDocument(String(req.params.id)) : undefined
    if (!doc) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Document introuvable" } })
    if (scopedAgencies(req, doc.agency) === null) return res.status(403).json({ error: { code: "AGENCY_FORBIDDEN", message: "Document hors périmètre" } })
    if (doc.status !== "approved") return res.status(409).json({ error: { code: "NOT_APPROVED", message: "La facture doit être approuvée" } })
    const parsed = z.object({ supplierId: z.string().min(1), productIds: z.array(z.string().min(1)).min(1).max(500), receiptConfirmed: z.literal(true) }).strict().safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: { code: "INVALID_REQUEST", message: "Fournisseur, articles et confirmation de réception requis" } })
    const extraction = await tenant(req).getExtraction(doc.id)
    const stored = await tenant(req).getFinancialRules()
    const usable = rulesUsable(stored?.rules, res.locals.organization as Organization)
    if (!usable.ok || !extraction || extraction.missingFields.length) return res.status(409).json({ error: { code: "VALIDATION_FAILED", message: "Extraction ou règles financières non validées" } })
    const invoice = { ...extraction.fields, supplierId: parsed.data.supplierId } as InvoiceInput
    const issues = validateInvoice(invoice, { rules: stored!.rules })
    if (issues.length) return res.status(409).json({ error: { code: "VALIDATION_FAILED", message: "La facture comporte des incohérences", details: { issues } } })
    try {
      const result = importPurchase(deps.erpDb!, scopedAgencies(req, doc.agency)!, req.principal!.organizationId, doc.id, doc.agency, invoice, parsed.data.supplierId, parsed.data.productIds)
      await tenant(req).audit({ actorId: req.principal!.id, action: "document.purchases_integrated", resourceType: "document", resourceId: doc.id, metadata: result })
      return res.json(result)
    } catch (error) {
      if (error instanceof ErpError) return res.status(error.status).json({ error: { code: "PURCHASE_IMPORT_FAILED", message: error.message } })
      throw error
    }
  })
  // Organization financial rules. Reading is open to document reviewers; changing them is
  // reserved to settings.manage. Any change clears the verification unless the same request
  // marks them verified, which records the acting user and time.
  app.get(
    "/api/v1/settings/financial-rules",
    requirePermission("documents.read"),
    async (req, res) => {
      const stored = await tenant(req).getFinancialRules()
      if (!stored)
        return res.status(404).json({ error: { code: "FINANCIAL_RULES_MISSING", message: "Règles financières non configurées pour cette organisation" } })
      return res.json(stored)
    },
  )
  app.put(
    "/api/v1/settings/financial-rules",
    requirePermission("settings.manage"),
    async (req, res) => {
      const parsed = z
        .object({
          rules: financialRulesSchema.omit({ verified: true, verifiedBy: true, verifiedAt: true }).strict(),
          markVerified: z.boolean(),
          expectedRevision: z.number().int().min(0).optional(),
        })
        .strict()
        .safeParse(req.body)
      if (!parsed.success)
        return res.status(400).json({ error: { code: "INVALID_REQUEST", message: "Règles invalides", details: parsed.error.flatten() } })
      const codes = parsed.data.rules.vatRates.map((v) => v.code)
      if (new Set(codes).size !== codes.length)
        return res.status(400).json({ error: { code: "INVALID_REQUEST", message: "Codes de TVA en double" } })
      try {
        const saved = await tenant(req).saveFinancialRules({ ...parsed.data, actorId: req.principal!.id })
        await tenant(req).audit({
          actorId: req.principal!.id,
          action: "financial_rules.updated",
          resourceType: "financial_rules",
          resourceId: req.principal!.organizationId,
          metadata: { revision: saved.revision, verified: saved.rules.verified },
        })
        return res.json(saved)
      } catch (error) {
        if (error instanceof RevisionConflictError)
          return res.status(409).json({ error: { code: "REVISION_CONFLICT", message: error.message } })
        throw error
      }
    },
  )
  app.use("/api", (_req, res) =>
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Ressource introuvable" },
    }),
  )
  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const { type, status } = (err ?? {}) as { type?: string; status?: number }
      if (type === "entity.parse.failed") return res.status(400).json({
          error: { code: "INVALID_JSON", message: "Corps JSON invalide" },
        })
      if (type === "entity.too.large") return res.status(413).json({
          error: { code: "PAYLOAD_TOO_LARGE", message: "Requête trop volumineuse" },
        })
      if (status && status >= 400 && status < 500) return res.status(status).json({
          error: { code: "BAD_REQUEST", message: "Requête invalide" },
        })
      req.log.error({ err }, "request failed")
      if (err instanceof multer.MulterError) return res.status(400).json({
          error: {
            code: "UPLOAD_ERROR",
            message:
              err.code === "LIMIT_FILE_SIZE"
                ? "Fichier trop volumineux"
                : "Import invalide",
          },
        })
      return res
        .status(500)
        .json({ error: { code: "INTERNAL_ERROR", message: "Erreur interne" } })
    },
  )
  return app
}
