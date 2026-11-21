/**
 * One-time PostgreSQL demo import (never touches LAI ERP or source CSVs).
 * Usage:
 *   npm run analytics:seed -- --source=synthetic
 *   npm run analytics:seed -- --source=extractions
 *   npm run analytics:seed -- --source=synthetic --replace
 * Local loopback database and explicit synthetic demo tenant only.
 */
import {PostgresStore} from "../server/store.js"
import {saveAnalyticalDataset,type AnalyticalSourceKind} from "../server/analytics-database.js"
import {loadExtractedDemo} from "../server/demo-database.js"
import {datasetFrom} from "../server/erp-bi.js"
import {ErpDatabase} from "../server/erp-db.js"

const args=process.argv.slice(2)
const source=args.find(s=>s.startsWith("--source="))?.slice("--source=".length)
const replace=args.includes("--replace")
if(args.some(s=>!s.startsWith("--source=")&&s!=="--replace")||
  !["synthetic","extractions"].includes(source??""))
  throw new Error("Use --source=synthetic|extractions [--replace]")
if(process.env.NODE_ENV==="production"||process.env.AUTH_MODE!=="local-dev")
  throw new Error("Only local-dev can import a demo dataset; never production")
const url=process.env.DATABASE_URL
if(!url)throw new Error("DATABASE_URL required; run db:dev:up, migrate and set .env")
const parsed=new URL(url)
if(!["localhost","127.0.0.1","[::1]","::1"].includes(parsed.hostname))
  throw new Error("Import refused: demo PostgreSQL must be on loopback")
const tenantId=process.env.ERP_SANDBOX_ORGANIZATION??"demo-fictive"
if(tenantId!=="demo-fictive")throw new Error("Demo seed is limited to demo-fictive tenant")
const store=new PostgresStore(url)
try{
  let dataset
  if(source==="extractions"){
    dataset=loadExtractedDemo().dataset
  }else{
    const db=ErpDatabase.open()
    if(!db)throw new Error("Synthetic SQLite fixture missing: run npm run dataset:generate && npm run db:seed")
    try{dataset=datasetFrom(db)}finally{db.close()}
  }
  await store.ensureOrganization({
    id:"demo-fictive",name:"Entreprise fictive AI-NÉGOCE",status:"active",isSynthetic:true,
  })
  const organization=await store.getOrganization(tenantId)
  if(!organization?.isSynthetic||organization.status!=="active")
    throw new Error("Refusing import into a non-synthetic or inactive organization")
  const saved=await saveAnalyticalDataset(store.forTenant(tenantId),dataset,source as AnalyticalSourceKind,replace)
  console.log(JSON.stringify({
    status:"imported",organization:"demo-fictive",sourceKind:source,
    revision:saved.revision,sourceHash:saved.sourceHash,sales:saved.rows,
    receivables:dataset.receivables.length,inventory:dataset.inventory.length,
    asOf:dataset.metadata.asOf,provenance:dataset.metadata.source,erpWrites:0,
  },null,2))
}catch(error){
  console.error("[analytics:seed]",error instanceof Error?error.message:String(error))
  process.exitCode=1
}finally{
  await store.close()
}
