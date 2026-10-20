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
  createAuth,
  devIdentity,
  localOnly,
  requireRoles,
  scopedAgencies,
} from "./auth.js"
import { requirePermission } from "./permissions.js"
import { loadConfig, type AppConfig } from "./config.js"
import {
  defaultDataset,
  groundedAnswer,
  overview,
  type Dataset,
} from "./services.js"
import { validateInvoice, type InvoiceInput } from "./invoice-validation.js"
import {
  DisabledOcrProvider,
  HttpOcrProvider,
  type OcrProvider,
} from "./ocr.js"
import { MemoryStore, PostgresStore, type Store } from "./store.js"
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
      methods: ["GET", "POST", "PATCH"],
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
      const session = auth.issueDevToken(parsed.data.identity)
      await store.audit({
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
  app.get("/api/v1/me", (req, res) =>
    res.json({ ...req.principal, authMode: auth.mode }),
  )
  const requireErpData: express.RequestHandler = (_req, res, next) =>
    config.NODE_ENV === "production" && !erp.production
      ? res.status(503).json({ error: { code: "ERP_UNAVAILABLE", message: "Source ERP indisponible" } })
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
  const erpGuard: express.RequestHandler = (_req, res, next) =>
    deps.erpDb
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
        await store.audit({
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
      const c = await store.createConversation(
        req.principal!.id,
        parsed.data.title,
      )
      await store.audit({
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
        ? await store.getConversation(id, req.principal!.id)
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
        ? await store.getConversation(
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
        await store.addMessage(c.id, {
          role: "user",
          content: parsed.data.question,
          createdAt: now,
        })
        await store.addMessage(c.id, {
          role: "assistant",
          content: answer.answer,
          sources: answer.sources,
          createdAt: now,
        })
      }
      await store.audit({
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
      const storageKey = `${id}${extension}`
      const sha256 = crypto
        .createHash("sha256")
        .update(req.file.buffer)
        .digest("hex")
      const existing = await store.findDocumentByHash(req.principal!.id, sha256)
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
      await fs.mkdir(uploadDir, { recursive: true })
      await fs.writeFile(path.join(uploadDir, storageKey), req.file.buffer, {
        flag: "wx",
      })
      try {
        await store.createDocument({
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
        await store.updateDocumentStatus(id, "failed")
        await store.audit({
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
      await store.saveExtraction(id, extraction)
      await store.audit({
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
        erpSubmission: { status: "not_submitted", adapter: erp.name },
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
      const documents = await store.listDocuments(
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
          erpSubmission: { status: "not_submitted", adapter: erp.name },
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
        ? await store.getDocument(id)
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
      const extraction = await store.getExtraction(doc.id)
      return res.json({
        ...doc,
        storageKey: undefined,
        sha256: undefined,
        extraction: extraction ?? null,
        erpSubmission: { status: "not_submitted", adapter: erp.name },
      })
    },
  )
  app.post(
    "/api/v1/documents/:id/approve",
    requirePermission("invoice.approve"),
    async (req, res) => {
      const id = String(req.params.id)
      const doc = uuid.safeParse(id).success
        ? await store.getDocument(id)
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
      const extraction = await store.getExtraction(doc.id)
      if (!extraction || extraction.missingFields.length) return res.status(409).json({
          error: {
            code: "EXTRACTION_INCOMPLETE",
            message: "Approbation impossible sans extraction validée",
            details: { missingFields: extraction?.missingFields ?? [] },
          },
        })
      const fields = extraction.fields as InvoiceInput & { supplier?: string }
      const issues = validateInvoice(
        { ...fields, supplierId: fields.supplierId ?? fields.supplier },
        { currency: "TND", vatRates: [0, 7, 13, 19] },
      )
      if (issues.length) return res.status(409).json({
          error: {
            code: "VALIDATION_FAILED",
            message: "La facture extraite comporte des incohérences",
            details: { issues },
          },
        })
      await store.updateDocumentStatus(doc.id, "approved")
      await store.audit({
        actorId: req.principal!.id,
        action: "document.approved",
        resourceType: "document",
        resourceId: doc.id,
      })
      return res.json({ id: doc.id, status: "approved" })
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
