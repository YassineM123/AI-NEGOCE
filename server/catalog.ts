import type { ErpDatabase } from "./erp-db.js"

export type CatalogProduct = {
  externalId: string
  designation: string
  stockUnit: string
  packaging?: string | null
  active: boolean
  source: "csv_import" | "erp_api" | "sandbox"
}

export type CatalogReadResult = { products: CatalogProduct[]; errors: { row: number; message: string }[] }
export interface CatalogConnector { readonly source: CatalogProduct["source"]; read(organizationId: string): Promise<CatalogReadResult> }

type CsvMapping = { externalId: string; designation: string; stockUnit: string; active?: string; packaging?: string }

/** RFC-4180-style parser with a configurable delimiter. It deliberately returns row errors instead of guessing values. */
function parseDelimited(input: string, delimiter = ";") {
  const rows: string[][] = []
  let row: string[] = [], value = "", quoted = false
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { value += '"'; i++ }
      else if (c === '"') quoted = false
      else value += c
    } else if (c === '"') quoted = true
    else if (c === delimiter) { row.push(value); value = "" }
    else if (c === "\n") { row.push(value.replace(/\r$/, "")); rows.push(row); row = []; value = "" }
    else value += c
  }
  if (quoted) throw new Error("CSV_UNTERMINATED_QUOTE")
  if (value || row.length) { row.push(value.replace(/\r$/, "")); rows.push(row) }
  return rows
}

export class CsvCatalogImporter implements CatalogConnector {
  readonly source = "csv_import" as const
  constructor(private csv: string, private mapping: CsvMapping, private delimiter = ";") {}
  async read(_organizationId: string): Promise<CatalogReadResult> {
    let rows: string[][]
    try { rows = parseDelimited(this.csv, this.delimiter) }
    catch (error) { return { products: [], errors: [{ row: 1, message: error instanceof Error ? error.message : "CSV_INVALID" }] } }
    if (!rows.length) return { products: [], errors: [{ row: 1, message: "CSV_EMPTY" }] }
    const header = rows[0].map(v => v.trim())
    const at = (name?: string) => name ? header.indexOf(name) : -1
    const indices = { id: at(this.mapping.externalId), designation: at(this.mapping.designation), unit: at(this.mapping.stockUnit), active: at(this.mapping.active), packaging: at(this.mapping.packaging) }
    if (indices.id < 0 || indices.designation < 0 || indices.unit < 0)
      return { products: [], errors: [{ row: 1, message: "CSV_REQUIRED_COLUMN_MISSING" }] }
    const products: CatalogProduct[] = [], errors: CatalogReadResult["errors"] = []
    rows.slice(1).forEach((values, offset) => {
      if (values.every(v => !v.trim())) return
      const externalId = values[indices.id]?.trim(), designation = values[indices.designation]?.trim(), stockUnit = values[indices.unit]?.trim()
      const activeRaw = indices.active < 0 ? "true" : values[indices.active]?.trim().toLowerCase()
      if (!externalId || !designation || !stockUnit || !["true", "false", "1", "0"].includes(activeRaw)) {
        errors.push({ row: offset + 2, message: "CSV_INVALID_PRODUCT" }); return
      }
      products.push({ externalId, designation, stockUnit, packaging: indices.packaging < 0 ? null : values[indices.packaging]?.trim() || null, active: activeRaw === "true" || activeRaw === "1", source: this.source })
    })
    return { products, errors }
  }
}

export class ErpApiConnector implements CatalogConnector {
  readonly source = "erp_api" as const
  constructor(private endpoint?: string, private token?: string) {}
  async read(organizationId: string): Promise<CatalogReadResult> {
    if (!this.endpoint || !this.token) throw new Error("NOT_CONFIGURED")
    const response = await fetch(this.endpoint, { headers: { authorization: `Bearer ${this.token}`, "x-organization-id": organizationId } })
    if (!response.ok) throw new Error(`ERP_HTTP_${response.status}`)
    const payload = await response.json() as { products?: unknown }
    if (!Array.isArray(payload.products)) throw new Error("ERP_INVALID_RESPONSE")
    const products: CatalogProduct[] = [], errors: CatalogReadResult["errors"] = []
    payload.products.forEach((raw, index) => {
      const p = raw as Record<string, unknown>
      if (typeof p.externalId !== "string" || typeof p.designation !== "string" || typeof p.stockUnit !== "string") errors.push({ row: index + 1, message: "ERP_INVALID_PRODUCT" })
      else products.push({ externalId: p.externalId, designation: p.designation, stockUnit: p.stockUnit, packaging: typeof p.packaging === "string" ? p.packaging : null, active: p.active !== false, source: this.source })
    })
    return { products, errors }
  }
}

export class SqliteSandboxConnector implements CatalogConnector {
  readonly source = "sandbox" as const
  constructor(private db: ErpDatabase | null, private allowedOrganization = process.env.ERP_SANDBOX_ORGANIZATION ?? "demo-fictive") {}
  async read(organizationId: string): Promise<CatalogReadResult> {
    if (organizationId !== this.allowedOrganization) throw new Error("SANDBOX_TENANT_FORBIDDEN")
    if (!this.db) throw new Error("SANDBOX_UNAVAILABLE")
    const products = this.db.all<{ id: string; name: string; uom: string | null }>("SELECT id,name,uom FROM products ORDER BY id").map(p => ({ externalId: p.id, designation: p.name, stockUnit: p.uom ?? "", packaging: null, active: true, source: this.source }))
    const errors = products.flatMap((p, i) => p.stockUnit ? [] : [{ row: i + 1, message: "ERP_INVALID_PRODUCT" }])
    return { products: products.filter(p => p.stockUnit), errors }
  }
}

export type CatalogSync = { id: string; source: CatalogProduct["source"]; status: "running" | "succeeded" | "failed"; counts: { read: number; active: number }; errors: CatalogReadResult["errors"]; catalogVersion: number; startedAt: string; finishedAt?: string }
export interface TenantCatalogRepository { readonly organizationId: string; replace(products: CatalogProduct[], job: CatalogSync): Promise<void>; search(query: string): Promise<CatalogProduct[]>; status(): Promise<CatalogSync[]>; nextVersion(): Promise<number> }

export class MemoryCatalogRepository {
  private products = new Map<string, Map<string, CatalogProduct>>(); private jobs = new Map<string, CatalogSync[]>()
  forTenant(organizationId: string): TenantCatalogRepository {
    if (!organizationId) throw new Error("Tenant context required")
    return {
      organizationId,
      replace: async (incoming, job) => { const current = new Map(this.products.get(organizationId) ?? []); for (const p of incoming) current.set(p.externalId, { ...p }); this.products.set(organizationId, current); this.jobs.set(organizationId, [...(this.jobs.get(organizationId) ?? []), structuredClone(job)]) },
      search: async query => [...(this.products.get(organizationId)?.values() ?? [])].filter(p => p.active && `${p.externalId} ${p.designation}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
      status: async () => structuredClone(this.jobs.get(organizationId) ?? []),
      nextVersion: async () => Math.max(0, ...(this.jobs.get(organizationId) ?? []).map(j => j.catalogVersion)) + 1,
    }
  }
}

export async function syncCatalog(repository: TenantCatalogRepository, connector: CatalogConnector): Promise<CatalogSync> {
  const startedAt = new Date().toISOString(), catalogVersion = await repository.nextVersion(), id = crypto.randomUUID()
  const result = await connector.read(repository.organizationId)
  const job: CatalogSync = { id, source: connector.source, status: result.errors.length ? "failed" : "succeeded", counts: { read: result.products.length, active: result.products.filter(p => p.active).length }, errors: result.errors, catalogVersion, startedAt, finishedAt: new Date().toISOString() }
  if (!result.errors.length) await repository.replace(result.products, job)
  return job
}
