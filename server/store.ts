import { Pool, type PoolClient } from "pg"
import type { Extraction } from "./ocr.js"
import type { FinancialRules } from "./financial-rules.js"

/** Rules content as edited by an administrator (verification fields are set by the server). */
export type FinancialRulesInput = Omit<FinancialRules, "verified" | "verifiedBy" | "verifiedAt">
export type StoredFinancialRules = { rules: FinancialRules; revision: number }
export class RevisionConflictError extends Error {}

export type Organization = {
  id: string
  name: string
  status: "active" | "suspended" | "quarantine"
  /** true for demonstration organizations whose data is entirely fictitious */
  isSynthetic: boolean
}
export type DocumentRecord = {
  id: string
  organizationId: string
  ownerId: string
  agency: string
  filename: string
  storageKey: string
  mimeType: string
  size: number
  sha256: string
  status: string
  createdAt: string
}
export type AuditEvent = {
  actorId: string
  action: string
  resourceType: string
  resourceId: string
  metadata?: Record<string, unknown>
}
export type StoredAuditEvent = AuditEvent & { organizationId: string; createdAt: string }
/** One audit row as shown in a resource's history (oldest first). */
export type AuditEntry = Omit<StoredAuditEvent, "organizationId" | "resourceType" | "resourceId"> & { id: string; actorName: string | null }
export type UserRecord = { id: string; displayName: string; role: string; agencies: string[] }
export type ApprovalEvent = {
  documentId: string
  actorId: string
  decision: "approved" | "rejected" | "corrected" | "reopened"
  invoiceId?: string
  invoiceVersion?: number
  correction?: Record<string, unknown>
}
export type Conversation = {
  id: string
  ownerId: string
  title: string
  createdAt: string
  messages: {
    role: "user" | "assistant"
    content: string
    sources?: string[]
    createdAt: string
  }[]
}

/** Every operation is confined to one organization; it cannot be widened by its arguments. */
export interface TenantStore {
  readonly organizationId: string
  transaction?<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>
  createDocument(record: Omit<DocumentRecord, "organizationId">): Promise<void>
  getDocument(id: string): Promise<DocumentRecord | undefined>
  findDocumentByHash(sha256: string): Promise<DocumentRecord | undefined>
  listDocuments(agencies?: string[]): Promise<DocumentRecord[]>
  saveExtraction(documentId: string, extraction: Extraction): Promise<void>
  getExtraction(documentId: string): Promise<Extraction | undefined>
  updateDocumentStatus(id: string, status: string): Promise<void>
  /** Atomic compare-and-set used for review decisions to prevent concurrent transitions. */
  transitionDocumentStatus(id: string, expected: string[], status: string): Promise<boolean>
  audit(event: AuditEvent): Promise<void>
  listAuditEvents(resourceType: string, resourceId: string): Promise<AuditEntry[]>
  createConversation(ownerId: string, title: string): Promise<Conversation>
  getConversation(id: string, ownerId: string): Promise<Conversation | undefined>
  addMessage(id: string, message: Conversation["messages"][number]): Promise<void>
  /** Upserts the user as seen in the verified token (history and foreign keys only). */
  recordUser(user: UserRecord): Promise<void>
  recordApprovalEvent(event: ApprovalEvent): Promise<void>
  getFinancialRules(): Promise<StoredFinancialRules | undefined>
  /**
   * Replaces the rules. Any change clears the verification unless markVerified is true, in
   * which case the acting user and time are recorded. expectedRevision guards concurrent edits.
   */
  saveFinancialRules(input: { rules: FinancialRulesInput; actorId: string; markVerified: boolean; expectedRevision?: number }): Promise<StoredFinancialRules>
  /** Inserts rules only when the organization has none (development seeding). */
  ensureFinancialRules(rules: FinancialRulesInput): Promise<void>
}

export interface Store {
  forTenant(organizationId: string): TenantStore
  getOrganization(id: string): Promise<Organization | undefined>
  /** Creates the organization when absent (used for development organizations only). */
  ensureOrganization(org: Organization): Promise<void>
  health(): Promise<boolean>
  close(): Promise<void>
}

const requireTenant = (organizationId: string) => {
  if (!organizationId) throw new Error("Tenant context required")
  return organizationId
}

export class MemoryStore implements Store {
  organizations = new Map<string, Organization>()
  documents = new Map<string, DocumentRecord>()
  extractions = new Map<string, Extraction & { organizationId: string }>()
  conversations = new Map<string, Conversation & { organizationId: string }>()
  audits: StoredAuditEvent[] = []
  users = new Map<string, UserRecord & { organizationId: string; lastSeenAt: string }>()
  approvalEvents: (ApprovalEvent & { organizationId: string; createdAt: string })[] = []
  financialRules = new Map<string, StoredFinancialRules>()

  async getOrganization(id: string) {
    return this.organizations.get(id)
  }
  async ensureOrganization(org: Organization) {
    if (!this.organizations.has(org.id)) this.organizations.set(org.id, org)
  }
  async health() {
    return true
  }
  async close() {}

  forTenant(organizationId: string): TenantStore {
    const org = requireTenant(organizationId)
    const doc = (id: string) => {
      const d = this.documents.get(id)
      return d?.organizationId === org ? d : undefined
    }
    return {
      organizationId: org,
      createDocument: async (r) => {
        if ([...this.documents.values()].some((d) => d.organizationId === org && d.sha256 === r.sha256))
          throw new Error("duplicate key value violates unique constraint uq_documents_org_sha")
        this.documents.set(r.id, { ...r, organizationId: org })
      },
      getDocument: async (id) => doc(id),
      findDocumentByHash: async (sha256) =>
        [...this.documents.values()].find((d) => d.organizationId === org && d.sha256 === sha256),
      listDocuments: async (agencies) =>
        [...this.documents.values()]
          .filter((d) => d.organizationId === org && (!agencies || agencies.includes(d.agency)))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      saveExtraction: async (documentId, extraction) => {
        if (!doc(documentId)) throw new Error("Document outside tenant")
        this.extractions.set(documentId, { ...extraction, organizationId: org })
      },
      getExtraction: async (documentId) => {
        const e = this.extractions.get(documentId)
        if (!e || e.organizationId !== org) return undefined
        const { organizationId: _, ...extraction } = e
        return extraction
      },
      updateDocumentStatus: async (id, status) => {
        const d = doc(id)
        if (d) this.documents.set(id, { ...d, status })
      },
      transitionDocumentStatus: async (id, expected, status) => {
        const d = doc(id)
        if (!d || !expected.includes(d.status)) return false
        this.documents.set(id, { ...d, status })
        return true
      },
      audit: async (e) => {
        this.audits.push({ ...e, organizationId: org, createdAt: new Date().toISOString() })
      },
      listAuditEvents: async (resourceType, resourceId) =>
        this.audits.flatMap((a, index) =>
          a.organizationId === org && a.resourceType === resourceType && a.resourceId === resourceId
            ? [{ id: String(index + 1), actorId: a.actorId, actorName: this.users.get(`${org}|${a.actorId}`)?.displayName ?? null, action: a.action, metadata: a.metadata ?? {}, createdAt: a.createdAt }]
            : [],
        ),
      createConversation: async (ownerId, title) => {
        const c = { id: crypto.randomUUID(), ownerId, title, createdAt: new Date().toISOString(), messages: [] }
        this.conversations.set(c.id, { ...c, organizationId: org })
        return c
      },
      getConversation: async (id, ownerId) => {
        const c = this.conversations.get(id)
        if (!c || c.organizationId !== org || c.ownerId !== ownerId) return undefined
        const { organizationId: _, ...conversation } = c
        return conversation
      },
      addMessage: async (id, m) => {
        const c = this.conversations.get(id)
        if (c?.organizationId === org) c.messages.push(m)
      },
      recordUser: async (u) => {
        this.users.set(`${org}|${u.id}`, { ...u, organizationId: org, lastSeenAt: new Date().toISOString() })
      },
      recordApprovalEvent: async (e) => {
        if (!doc(e.documentId)) throw new Error("Document outside tenant")
        this.approvalEvents.push({ ...e, organizationId: org, createdAt: new Date().toISOString() })
      },
      getFinancialRules: async () => this.financialRules.get(org),
      saveFinancialRules: async ({ rules, actorId, markVerified, expectedRevision }) => {
        const current = this.financialRules.get(org)
        if (expectedRevision !== undefined && (current?.revision ?? 0) !== expectedRevision)
          throw new RevisionConflictError("Les règles ont été modifiées entre-temps")
        const stored = {
          rules: { ...rules, verified: markVerified, verifiedBy: markVerified ? actorId : null, verifiedAt: markVerified ? new Date().toISOString() : null },
          revision: (current?.revision ?? 0) + 1,
        }
        this.financialRules.set(org, stored)
        return stored
      },
      ensureFinancialRules: async (rules) => {
        if (!this.financialRules.has(org))
          this.financialRules.set(org, { rules: { ...rules, verified: false, verifiedBy: null, verifiedAt: null }, revision: 1 })
      },
    }
  }
}

async function readRules(c: PoolClient, org: string, lock = false): Promise<StoredFinancialRules | undefined> {
  const q = await c.query(
    `SELECT rules, verified, verified_by AS "verifiedBy", verified_at AS "verifiedAt", revision FROM organization_financial_rules WHERE organization_id=$1${lock ? " FOR UPDATE" : ""}`,
    [org],
  )
  const row = q.rows[0]
  if (!row) return undefined
  return {
    rules: { ...row.rules, verified: row.verified, verifiedBy: row.verifiedBy, verifiedAt: row.verifiedAt ? new Date(row.verifiedAt).toISOString() : null },
    revision: row.revision,
  }
}

const DOCUMENT_COLUMNS =
  'id,organization_id AS "organizationId",owner_id AS "ownerId",agency,filename,storage_key AS "storageKey",mime_type AS "mimeType",size_bytes AS size,sha256,status,created_at AS "createdAt"'

export class PostgresStore implements Store {
  private pool: Pool
  constructor(url: string) {
    this.pool = new Pool({
      connectionString: url,
      max: 10,
      connectionTimeoutMillis: 5000,
      ssl:
        process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: true }
          : undefined,
    })
  }

  /**
   * Runs fn in a transaction as the restricted role ai_negoce_app with app.organization_id
   * set, so row-level security confines every statement to this organization even if a
   * query forgot its explicit filter.
   */
  async catalogTransaction<T>(organizationId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    return this.tenantTx(requireTenant(organizationId), fn)
  }

  private async tenantTx<T>(organizationId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")
      await client.query("SET LOCAL ROLE ai_negoce_app")
      await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId])
      const result = await fn(client)
      await client.query("COMMIT")
      return result
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  async getOrganization(id: string) {
    const q = await this.pool.query(
      'SELECT id,name,status,is_synthetic AS "isSynthetic" FROM organizations WHERE id=$1',
      [id],
    )
    return q.rows[0] as Organization | undefined
  }
  async ensureOrganization(org: Organization) {
    await this.pool.query(
      "INSERT INTO organizations(id,name,status,is_synthetic) VALUES($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING",
      [org.id, org.name, org.status, org.isSynthetic],
    )
  }

  forTenant(organizationId: string): TenantStore {
    const org = requireTenant(organizationId)
    const tx = <T>(fn: (c: PoolClient) => Promise<T>) => this.tenantTx(org, fn)
    return {
      organizationId: org,
      transaction: tx,
      createDocument: (r) =>
        tx(async (c) => {
          await c.query(
            "INSERT INTO documents(id,organization_id,owner_id,agency,filename,storage_key,mime_type,size_bytes,sha256,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
            [r.id, org, r.ownerId, r.agency, r.filename, r.storageKey, r.mimeType, r.size, r.sha256, r.status, r.createdAt],
          )
        }),
      getDocument: (id) =>
        tx(async (c) => (await c.query(`SELECT ${DOCUMENT_COLUMNS} FROM documents WHERE organization_id=$1 AND id=$2`, [org, id])).rows[0]),
      findDocumentByHash: (sha256) =>
        tx(async (c) => (await c.query(`SELECT ${DOCUMENT_COLUMNS} FROM documents WHERE organization_id=$1 AND sha256=$2`, [org, sha256])).rows[0]),
      listDocuments: (agencies) =>
        tx(async (c) =>
          (agencies
            ? await c.query(`SELECT ${DOCUMENT_COLUMNS} FROM documents WHERE organization_id=$1 AND agency = ANY($2) ORDER BY created_at DESC`, [org, agencies])
            : await c.query(`SELECT ${DOCUMENT_COLUMNS} FROM documents WHERE organization_id=$1 ORDER BY created_at DESC`, [org])
          ).rows,
        ),
      saveExtraction: (documentId, extraction) =>
        tx(async (c) => {
          await c.query(
            "INSERT INTO invoice_extractions(organization_id,document_id,provider,payload,confidence,version) VALUES($1,$2,$3,$4,$5,(SELECT COALESCE(MAX(version),0)+1 FROM invoice_extractions WHERE organization_id=$1 AND document_id=$2))",
            [org, documentId, extraction.provider, extraction, extraction.confidence],
          )
        }),
      getExtraction: (documentId) =>
        tx(async (c) => (await c.query("SELECT payload FROM invoice_extractions WHERE organization_id=$1 AND document_id=$2 ORDER BY version DESC LIMIT 1", [org, documentId])).rows[0]?.payload),
      updateDocumentStatus: (id, status) =>
        tx(async (c) => {
          await c.query("UPDATE documents SET status=$3, updated_at=now() WHERE organization_id=$1 AND id=$2", [org, id, status])
        }),
      transitionDocumentStatus: (id, expected, status) =>
        tx(async (c) => {
          const result = await c.query("UPDATE documents SET status=$4, updated_at=now() WHERE organization_id=$1 AND id=$2 AND status = ANY($3)", [org, id, expected, status])
          return result.rowCount === 1
        }),
      audit: (e) =>
        tx(async (c) => {
          await c.query(
            "INSERT INTO audit_logs(organization_id,actor_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5,$6)",
            [org, e.actorId, e.action, e.resourceType, e.resourceId, e.metadata ?? {}],
          )
        }),
      listAuditEvents: (resourceType, resourceId) =>
        tx(async (c) =>
          (await c.query(
            'SELECT a.id::text AS id,a.actor_id AS "actorId",u.display_name AS "actorName",a.action,a.metadata,a.created_at AS "createdAt" FROM audit_logs a LEFT JOIN users u ON u.organization_id=a.organization_id AND u.id=a.actor_id WHERE a.organization_id=$1 AND a.resource_type=$2 AND a.resource_id=$3 ORDER BY a.created_at, a.id LIMIT 500',
            [org, resourceType, resourceId],
          )).rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() })),
        ),
      createConversation: (ownerId, title) =>
        tx(async (c) => {
          const q = await c.query(
            'INSERT INTO conversations(organization_id,owner_id,title) VALUES($1,$2,$3) RETURNING id,owner_id AS "ownerId",title,created_at AS "createdAt"',
            [org, ownerId, title],
          )
          return { ...q.rows[0], messages: [] }
        }),
      getConversation: (id, ownerId) =>
        tx(async (c) => {
          const conv = await c.query(
            'SELECT id,owner_id AS "ownerId",title,created_at AS "createdAt" FROM conversations WHERE organization_id=$1 AND id=$2 AND owner_id=$3',
            [org, id, ownerId],
          )
          if (!conv.rows[0]) return undefined
          const m = await c.query(
            'SELECT role,content,sources,created_at AS "createdAt" FROM messages WHERE organization_id=$1 AND conversation_id=$2 ORDER BY created_at',
            [org, id],
          )
          return { ...conv.rows[0], messages: m.rows }
        }),
      addMessage: (id, m) =>
        tx(async (c) => {
          await c.query(
            "INSERT INTO messages(organization_id,conversation_id,role,content,sources,created_at) VALUES($1,$2,$3,$4,$5,$6)",
            [org, id, m.role, m.content, JSON.stringify(m.sources ?? []), m.createdAt],
          )
        }),
      recordUser: (u) =>
        tx(async (c) => {
          await c.query(
            "INSERT INTO users(organization_id,id,display_name,role,agencies) VALUES($1,$2,$3,$4,$5) ON CONFLICT (organization_id,id) DO UPDATE SET display_name=EXCLUDED.display_name, role=EXCLUDED.role, agencies=EXCLUDED.agencies, last_seen_at=now()",
            [org, u.id, u.displayName, u.role, u.agencies],
          )
        }),
      recordApprovalEvent: (e) =>
        tx(async (c) => {
          await c.query(
            "INSERT INTO approval_events(organization_id,document_id,actor_id,decision,correction,invoice_id,invoice_version) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [org, e.documentId, e.actorId, e.decision, e.correction ?? null, e.invoiceId ?? null, e.invoiceVersion ?? null],
          )
        }),
      getFinancialRules: () => tx((c) => readRules(c, org)),
      saveFinancialRules: ({ rules, actorId, markVerified, expectedRevision }) =>
        tx(async (c) => {
          const current = await readRules(c, org, true)
          if (expectedRevision !== undefined && (current?.revision ?? 0) !== expectedRevision)
            throw new RevisionConflictError("Les règles ont été modifiées entre-temps")
          await c.query(
            `INSERT INTO organization_financial_rules(organization_id,rules,verified,verified_by,verified_at,updated_by,updated_at,revision)
             VALUES($1,$2,$3,$4,$5,$6,now(),1)
             ON CONFLICT (organization_id) DO UPDATE SET rules=EXCLUDED.rules, verified=EXCLUDED.verified, verified_by=EXCLUDED.verified_by,
               verified_at=EXCLUDED.verified_at, updated_by=EXCLUDED.updated_by, updated_at=now(), revision=organization_financial_rules.revision+1`,
            [org, rules, markVerified, markVerified ? actorId : null, markVerified ? new Date().toISOString() : null, actorId],
          )
          return (await readRules(c, org))!
        }),
      ensureFinancialRules: (rules) =>
        tx(async (c) => {
          await c.query("INSERT INTO organization_financial_rules(organization_id,rules) VALUES($1,$2) ON CONFLICT (organization_id) DO NOTHING", [org, rules])
        }),
    }
  }

  async health() {
    try {
      await this.pool.query("SELECT 1")
      return true
    } catch {
      return false
    }
  }
  async close() {
    await this.pool.end()
  }
}
