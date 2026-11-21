/**
 * LOCAL SYNTHETIC DEMO ONLY — simulate one sales-line price correction.
 * Demonstrates PostgreSQL revision -> BI / DS refresh -> new Agentic dossier.
 * Never modifies the real ERP, customer exports, or non-synthetic tenants.
 *
 * npm run analytics:demo:change -- --agency=Sfax --from=2026-10-01 --to=2026-10-20 --increase-tnd=150.000
 */
import {PostgresStore} from "../server/store.js"
import {readAnalyticalDataset,saveAnalyticalDataset} from "../server/analytics-database.js"
const flags=new Map(process.argv.slice(2).map(x=>{
  const match=/^--([a-z-]+)=(.+)$/.exec(x)
  if(!match)throw new Error("Only --agency, --from, --to and --increase-tnd=value supported")
  return [match[1],match[2]] as const
}))
if(flags.size!==4||[...flags.keys()].some(x=>!["agency","from","to","increase-tnd"].includes(x)))
  throw new Error("Usage: --agency=Sfax --from=2026-10-01 --to=2026-10-20 --increase-tnd=150.000")
const agency=flags.get("agency")!,from=flags.get("from")!,to=flags.get("to")!
const deltaText=flags.get("increase-tnd")!
if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to||
  !/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'-]{1,79}$/.test(agency)||
  !/^(?:[1-9]\d{0,4}|0)\.\d{3}$/.test(deltaText)||Number(deltaText)<=0)
  throw new Error("Invalid scope or TND amount; use a positive value with exactly three decimals")
const url=process.env.DATABASE_URL
if(process.env.NODE_ENV==="production"||process.env.AUTH_MODE!=="local-dev"||
  process.env.UNIFIED_ANALYTICS_SOURCE!=="postgres"||!url)
  throw new Error("Only sandbox local-dev + PostgreSQL analytics source allowed")
const dbUrl=new URL(url)
if(!["localhost","127.0.0.1","::1","[::1]"].includes(dbUrl.hostname))
  throw new Error("Only loopback PostgreSQL is allowed")
const store=new PostgresStore(url)
try{
  const org=await store.getOrganization("demo-fictive")
  if(!org?.isSynthetic||org.status!=="active")throw new Error("Synthetic demo-fictive tenant required")
  const tenant=store.forTenant("demo-fictive")
  const current=await readAnalyticalDataset(tenant)
  if(!current||current.sourceKind!=="synthetic")throw new Error("Synthetic PostgreSQL dataset required")
  if(to>current.dataset.metadata.asOf)throw new Error("Period exceeds the dataset business date")
  const row=current.dataset.sales.find(s=>s.agency===agency&&s.date>=from&&s.date<=to&&
    s.kind!=="credit_note"&&s.status!=="cancelled"&&s.revenue>0)
  if(!row)throw new Error("No eligible posted invoice line in this agency and period")
  const deltaMillimes=Math.round(Number(deltaText)*1000)
  const beforeMillimes=Math.round(row.revenue*1000)
  const after=(beforeMillimes+deltaMillimes)/1000
  if(!Number.isSafeInteger(beforeMillimes+deltaMillimes))throw new Error("Amount overflow")
  // Preserve invoice line identity and cost; this is a fictional price-only correction.
  const changed={
    ...current.dataset,
    sales:current.dataset.sales.map(s=>s.id===row.id?{...s,revenue:after}:s),
    metadata:{...current.dataset.metadata,lastUpdated:new Date().toISOString()},
  }
  const saved=await saveAnalyticalDataset(tenant,changed,"synthetic",true)
  console.log(JSON.stringify({
    status:"synthetic_change_persisted",tenant:"demo-fictive",
    agency,from,to,invoiceLineId:row.id,invoiceId:row.invoiceId,
    oldRevenueTnd:row.revenue,newRevenueTnd:after,
    previousRevision:current.revision,newRevision:saved.revision,
    previousHash:current.sourceHash,newHash:saved.sourceHash,erpWrites:0,
    next:"Refresh the Command Center. BI and DS will use this snapshot; use the AI Director change alert to create a new dossier.",
  },null,2))
}finally{
  await store.close()
}
