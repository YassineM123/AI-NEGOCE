import { Pool } from "pg"
import type { Extraction } from "./ocr.js"

export type DocumentRecord = {
  id: string
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

export interface Store {
  createDocument(record: DocumentRecord): Promise<void>
  getDocument(id: string): Promise<DocumentRecord | undefined>
  findDocumentByHash(
    ownerId: string,
    sha256: string,
  ): Promise<DocumentRecord | undefined>
  listDocuments(agencies?: string[]): Promise<DocumentRecord[]>
  saveExtraction(documentId: string, extraction: Extraction): Promise<void>
  getExtraction(documentId: string): Promise<Extraction | undefined>
  updateDocumentStatus(id: string, status: string): Promise<void>
  audit(event: AuditEvent): Promise<void>
  createConversation(ownerId: string, title: string): Promise<Conversation>
  getConversation(
    id: string,
    ownerId: string,
  ): Promise<Conversation | undefined>
  addMessage(
    id: string,
    message: Conversation["messages"][number],
  ): Promise<void>
  health(): Promise<boolean>
  close(): Promise<void>
}

export class MemoryStore implements Store {
  documents = new Map<string, DocumentRecord>()
  extractions = new Map<string, Extraction>()
  conversations = new Map<string, Conversation>()
  audits: AuditEvent[] = []
  async createDocument(r: DocumentRecord) {
    this.documents.set(r.id, r)
  }
  async getDocument(id: string) {
    return this.documents.get(id)
  }
  async findDocumentByHash(ownerId: string, sha256: string) {
    return [...this.documents.values()].find(
      (d) => d.ownerId === ownerId && d.sha256 === sha256,
    )
  }
  async listDocuments(agencies?: string[]) {
    const all = [...this.documents.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )
    if (!agencies) return all
    return all.filter((d) => agencies.includes(d.agency))
  }
  async saveExtraction(documentId: string, extraction: Extraction) {
    this.extractions.set(documentId, extraction)
  }
  async getExtraction(documentId: string) {
    return this.extractions.get(documentId)
  }
  async updateDocumentStatus(id: string, status: string) {
    const r = this.documents.get(id)
    if (r) this.documents.set(id, { ...r, status })
  }
  async audit(e: AuditEvent) {
    this.audits.push(e)
  }
  async createConversation(ownerId: string, title: string) {
    const c = {
      id: crypto.randomUUID(),
      ownerId,
      title,
      createdAt: new Date().toISOString(),
      messages: [],
    }
    this.conversations.set(c.id, c)
    return c
  }
  async getConversation(id: string, ownerId: string) {
    const c = this.conversations.get(id)
    return c?.ownerId === ownerId ? c : undefined
  }
  async addMessage(id: string, m: Conversation["messages"][number]) {
    this.conversations.get(id)?.messages.push(m)
  }
  async health() {
    return true
  }
  async close() {}
}

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
  async createDocument(r: DocumentRecord) {
    await this.pool.query(
      "INSERT INTO documents(id,owner_id,agency,filename,storage_key,mime_type,size_bytes,sha256,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        r.id,
        r.ownerId,
        r.agency,
        r.filename,
        r.storageKey,
        r.mimeType,
        r.size,
        r.sha256,
        r.status,
        r.createdAt,
      ],
    )
  }
  async getDocument(id: string) {
    const q = await this.pool.query(
      'SELECT id,owner_id AS "ownerId",agency,filename,storage_key AS "storageKey",mime_type AS "mimeType",size_bytes AS size,sha256,status,created_at AS "createdAt" FROM documents WHERE id=$1',
      [id],
    )
    return q.rows[0]
  }
  async findDocumentByHash(ownerId: string, sha256: string) {
    const q = await this.pool.query(
      'SELECT id,owner_id AS "ownerId",agency,filename,storage_key AS "storageKey",mime_type AS "mimeType",size_bytes AS size,sha256,status,created_at AS "createdAt" FROM documents WHERE owner_id=$1 AND sha256=$2',
      [ownerId, sha256],
    )
    return q.rows[0]
  }
  async listDocuments(agencies?: string[]) {
    const columns =
      'id,owner_id AS "ownerId",agency,filename,storage_key AS "storageKey",mime_type AS "mimeType",size_bytes AS size,sha256,status,created_at AS "createdAt"'
    const q = agencies
      ? await this.pool.query(
          `SELECT ${columns} FROM documents WHERE agency = ANY($1) ORDER BY created_at DESC`,
          [agencies],
        )
      : await this.pool.query(
          `SELECT ${columns} FROM documents ORDER BY created_at DESC`,
        )
    return q.rows
  }
  async saveExtraction(documentId: string, extraction: Extraction) {
    await this.pool.query(
      "INSERT INTO invoice_extractions(document_id,provider,payload,confidence,version) VALUES($1,$2,$3,$4,(SELECT COALESCE(MAX(version),0)+1 FROM invoice_extractions WHERE document_id=$1))",
      [documentId, extraction.provider, extraction, extraction.confidence],
    )
  }
  async getExtraction(documentId: string) {
    const q = await this.pool.query(
      "SELECT payload FROM invoice_extractions WHERE document_id=$1 ORDER BY version DESC LIMIT 1",
      [documentId],
    )
    return q.rows[0]?.payload
  }
  async updateDocumentStatus(id: string, status: string) {
    await this.pool.query(
      "UPDATE documents SET status=$2, updated_at=now() WHERE id=$1",
      [id, status],
    )
  }
  async audit(e: AuditEvent) {
    await this.pool.query(
      "INSERT INTO audit_logs(actor_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5)",
      [e.actorId, e.action, e.resourceType, e.resourceId, e.metadata ?? {}],
    )
  }
  async createConversation(ownerId: string, title: string) {
    const q = await this.pool.query(
      'INSERT INTO conversations(owner_id,title) VALUES($1,$2) RETURNING id,owner_id AS "ownerId",title,created_at AS "createdAt"',
      [ownerId, title],
    )
    return { ...q.rows[0], messages: [] }
  }
  async getConversation(id: string, ownerId: string) {
    const c = await this.pool.query(
      'SELECT id,owner_id AS "ownerId",title,created_at AS "createdAt" FROM conversations WHERE id=$1 AND owner_id=$2',
      [id, ownerId],
    )
    if (!c.rows[0]) return undefined
    const m = await this.pool.query(
      'SELECT role,content,sources,created_at AS "createdAt" FROM messages WHERE conversation_id=$1 ORDER BY created_at',
      [id],
    )
    return { ...c.rows[0], messages: m.rows }
  }
  async addMessage(id: string, m: Conversation["messages"][number]) {
    await this.pool.query(
      "INSERT INTO messages(conversation_id,role,content,sources,created_at) VALUES($1,$2,$3,$4,$5)",
      [id, m.role, m.content, m.sources ?? [], m.createdAt],
    )
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
