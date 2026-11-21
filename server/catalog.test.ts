import { describe, expect, it } from "vitest"
import { CsvCatalogImporter, ErpApiConnector, MemoryCatalogRepository, syncCatalog, SqliteSandboxConnector } from "./catalog.js"

describe("catalog synchronization", () => {
  const csv = "id;designation;unit;active\np1;Câble;M;true\np2;Vis;U;true"
  const mapping = { externalId: "id", designation: "designation", stockUnit: "unit", active: "active" }
  it("validates CSV rows without silently filling missing values", async () => {
    const result = await new CsvCatalogImporter("id;designation;unit\np1;;M\np2;Vis;U", mapping).read("org-a")
    expect(result.errors).toHaveLength(1)
    expect(result.products).toHaveLength(1)
  })
  it("parses escaped quotes, separators and multiline descriptions", async () => {
    const result = await new CsvCatalogImporter('id;designation;unit\np1;"Câble; ""bleu""\nlong";M', mapping).read("org-a")
    expect(result.products[0].designation).toBe('Câble; "bleu"\nlong')
  })
  it("upserts idempotently and confines search and jobs to the tenant", async () => {
    const repo = new MemoryCatalogRepository()
    await syncCatalog(repo.forTenant("org-a"), new CsvCatalogImporter(csv, mapping))
    await syncCatalog(repo.forTenant("org-a"), new CsvCatalogImporter(csv, mapping))
    expect(await repo.forTenant("org-a").search("")).toHaveLength(2)
    expect(await repo.forTenant("org-b").search("")).toEqual([])
    expect(await repo.forTenant("org-b").status()).toEqual([])
  })
  it("deactivates only explicit inactive rows for partial CSV imports", async () => {
    const repo = new MemoryCatalogRepository()
    await syncCatalog(repo.forTenant("org-a"), new CsvCatalogImporter(csv, mapping))
    await syncCatalog(repo.forTenant("org-a"), new CsvCatalogImporter("id;designation;unit;active\np1;Câble;M;false", mapping))
    expect((await repo.forTenant("org-a").search("")).map(p => p.externalId)).toEqual(["p2"])
  })
  it("refuses all changes when any CSV row is invalid", async () => {
    const repo = new MemoryCatalogRepository()
    const result = await syncCatalog(repo.forTenant("org-a"), new CsvCatalogImporter(csv + "\np3;;", mapping))
    expect(result.status).toBe("failed")
    expect(await repo.forTenant("org-a").search("")).toEqual([])
  })
  it("never fabricates a configured ERP endpoint", async () => {
    await expect(new ErpApiConnector().read("org-a")).rejects.toThrow("NOT_CONFIGURED")
  })
  it("refuses sandbox access from another tenant before reading SQLite", async () => {
    await expect(new SqliteSandboxConnector(null).read("org-b")).rejects.toThrow("SANDBOX_TENANT_FORBIDDEN")
  })
})
