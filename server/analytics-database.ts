/**
 * Tenant-isolated, versioned PostgreSQL analytics dataset.
 * BI, Data Science and Agentic load it through the same request-scoped context.
 * Only an explicit local-dev CLI may overwrite the dataset. No public write API.
 */
import crypto from "node:crypto"
import {z} from "zod"
import type {TenantStore} from "./store.js"
import type {Dataset} from "./services.js"

const iso=z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const finite=z.number().finite()
const sale=z.object({
  id:z.string().min(1),invoiceId:z.string().min(1),date:iso,
  agency:z.string().min(1),customer:z.string().min(1),customerId:z.string().optional(),
  product:z.string(),productId:z.string().optional(),quantity:finite.nullable().optional(),family:z.string(),
  representative:z.string(),revenue:finite,cost:finite.nullable(),
  kind:z.enum(["invoice","credit_note"]).optional(),
  status:z.enum(["posted","cancelled"]).optional(),
})
const receivable=z.object({
  invoiceId:z.string().min(1),agency:z.string().min(1),
  customer:z.string(),customerId:z.string().optional(),date:iso,dueDate:iso,outstanding:finite.nonnegative(),
})
const stock=z.object({
  reference:z.string().min(1),product:z.string(),agency:z.string().min(1),
  quantity:finite,reorderPoint:finite,unitCost:finite.nonnegative(),
  openingDate:iso.nullable().optional(),openingQuantity:finite.nullable().optional(),
})
const datasetSchema=z.object({
  sales:z.array(sale).max(100000),
  receivables:z.array(receivable).max(100000),
  inventory:z.array(stock).max(100000),
  collections:z.array(z.object({
    id:z.string().min(1),invoiceId:z.string().min(1),
    agency:z.string().min(1),customerId:z.string().min(1).optional(),date:iso,amountTnd:finite.nonnegative(),
  }).strict()).max(100000).optional(),
  supplierDocuments:z.array(z.object({
    orderId:z.string().min(1),supplierId:z.string().min(1),
    supplier:z.string().min(1),agency:z.string().min(1),orderDate:iso,invoiceDate:iso,
    invoiceId:z.string().min(1),lagDays:z.number().int().nonnegative().max(3650),
    amountTnd:finite.nonnegative(),
  }).strict()).max(100000).optional(),
  stockMovements:z.array(z.object({
    id:z.string().min(1),date:iso,agency:z.string().min(1),
    productId:z.string().min(1),sku:z.string().min(1),
    type:z.enum(["receipt","sale","return","transfer_in","transfer_out","adjustment"]),
    quantity:finite,reference:z.string(),
  }).strict()).max(100000).optional(),
  procurementLines:z.array(z.object({
    orderLineId:z.string().min(1),orderId:z.string().min(1),
    agency:z.string().min(1),sku:z.string().min(1),productId:z.string().min(1),
    supplierId:z.string().min(1),supplier:z.string().min(1),orderDate:iso,
    orderedUnits:finite.nonnegative(),invoicedUnits:finite.nonnegative(),
    unitCostTnd:finite.nonnegative(),
    status:z.enum(["open","invoiced"]),supplierInvoiceIds:z.array(z.string().min(1)).max(1000),
  }).strict()).max(100000).optional(),
  customerProfiles:z.array(z.object({
    id:z.string().min(1),name:z.string().min(1),agency:z.string().min(1),
    segment:z.string().min(1),creditLimitTnd:finite.nonnegative(),
    paymentTermsDays:z.number().nonnegative().max(3650),
    representativeId:z.string().nullable(),
  }).strict()).max(100000).optional(),
  metadata:z.object({
    adapter:z.string(),source:z.string().min(4),currency:z.literal("TND"),
    asOf:iso,lastUpdated:z.string().min(10),
  }).passthrough(),
}).strict()
export type AnalyticalSourceKind="synthetic"|"extractions"
export type PersistedDataset={dataset:Dataset;revision:number;sourceHash:string;sourceKind:AnalyticalSourceKind;importedAt:string}
const transaction=(tenant:TenantStore)=>{
  if(!tenant.transaction)throw new Error("ANALYTICS_POSTGRES_REQUIRED: PostgreSQL tenant transaction unavailable")
  return tenant.transaction.bind(tenant)
}
function validate(data:unknown):Dataset{
  const parsed=datasetSchema.parse(data)
  if(parsed.sales.some(r=>r.date>parsed.metadata.asOf) ||
     parsed.receivables.some(r=>r.date>parsed.metadata.asOf) ||
     parsed.collections?.some(r=>r.date>parsed.metadata.asOf) ||
     parsed.supplierDocuments?.some(r=>r.invoiceDate>parsed.metadata.asOf||
       r.orderDate>r.invoiceDate||
       Math.abs((Date.parse(r.invoiceDate+"T00:00:00Z")-Date.parse(r.orderDate+"T00:00:00Z"))/86400000-r.lagDays)>0.01) ||
     parsed.stockMovements?.some(r=>r.date>parsed.metadata.asOf) ||
     parsed.procurementLines?.some(r=>r.orderDate>parsed.metadata.asOf))
    throw new Error("ANALYTICS_INVALID_DATE: fact rows after asOf are forbidden")
  return parsed as unknown as Dataset
}
/** Read always in an RLS-protected transaction, with no cross-tenant fallback. */
export async function readAnalyticalDataset(tenant:TenantStore):Promise<PersistedDataset|null>{
  const tx=transaction(tenant)
  return tx(async c=>{
    const q=await c.query<{
      payload:unknown;revision:string|number;source_kind:AnalyticalSourceKind;
      source_hash:string;imported_at:Date
    }>("SELECT payload,revision,source_kind,source_hash,imported_at FROM analytics_datasets WHERE organization_id=$1",[tenant.organizationId])
    const row=q.rows[0]
    if(!row)return null
    const dataset=validate(row.payload)
    dataset.metadata={...dataset.metadata,snapshotRevision:Number(row.revision)}
    return {dataset,revision:Number(row.revision),sourceHash:row.source_hash,
      sourceKind:row.source_kind,importedAt:row.imported_at.toISOString()}
  })
}
/** Offline seed only; deny accidental replacement unless explicitly authorized. */
export async function saveAnalyticalDataset(
  tenant:TenantStore,data:Dataset,sourceKind:AnalyticalSourceKind,replace=false,
  expectedRevision?:number,
):Promise<{revision:number;sourceHash:string;rows:number}>{
  const dataset=validate(data)
  if(sourceKind==="extractions"&&!dataset.metadata.source.includes("Database/extractions"))
    throw new Error("EXTRACT_PROVENANCE_REQUIRED")
  if(sourceKind==="synthetic"&&dataset.metadata.source.includes("Database/extractions"))
    throw new Error("EXTRACT_MUST_BE_LABELLED")
  const json=JSON.stringify(dataset)
  if(Buffer.byteLength(json)>24*1024*1024)throw new Error("DATASET_TOO_LARGE_FOR_DEMO_SNAPSHOT")
  const sourceHash=crypto.createHash("sha256").update(json).digest("hex")
  const tx=transaction(tenant)
  const revision=await tx(async c=>{
    const existing=await c.query<{revision:string|number}>(
      "SELECT revision FROM analytics_datasets WHERE organization_id=$1 FOR UPDATE",
      [tenant.organizationId])
    if(existing.rows.length&&!replace)throw new Error("ANALYTICS_EXISTS: explicit --replace required")
    const actual=existing.rows.length?Number(existing.rows[0].revision):0
    if(expectedRevision!==undefined&&actual!==expectedRevision)
      throw new Error("ANALYTICS_REVISION_CONFLICT: source changed; reload before writing")
    const next=actual+1
    await c.query(
      "INSERT INTO analytics_datasets (organization_id,revision,source_kind,source_hash,payload,imported_at) VALUES($1,$2,$3,$4,$5::jsonb,now()) ON CONFLICT (organization_id) DO UPDATE SET revision=EXCLUDED.revision,source_kind=EXCLUDED.source_kind,source_hash=EXCLUDED.source_hash,payload=EXCLUDED.payload,imported_at=now()",
      [tenant.organizationId,next,sourceKind,sourceHash,json])
    return next
  })
  return {revision,sourceHash,rows:dataset.sales.length}
}
