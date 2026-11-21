import { Pool } from "pg"
import { PostgresStore } from "../store.js"
import { AgenticWorkspace } from "./workspace.js"
import { loadExtractedDemo } from "../demo-database.js"
import { defaultDataset } from "../services.js"

// Durable in-app due reminders: run as a separate single-purpose process.
// It never executes ERP actions or sends external messages.
// Each due notification has a deterministic per-day key, deduplicated under a row lock.
const url=process.env.DATABASE_URL
if (!url) {
  console.error("[agentic-worker] DATABASE_URL required; no volatile fallback")
  process.exit(1)
}
const store=new PostgresStore(url)
const adminPool=new Pool({
  connectionString:url,
  max:2,
  ssl:process.env.NODE_ENV==="production"?{rejectUnauthorized:true}:undefined,
})
const workspace=new AgenticWorkspace(store)
// Explicit demo opt-in. Real ERP proactive monitoring requires a tenant-specific
// validated connector; never broadcast one global synthetic dataset to clients.
const proactiveDemo=process.env.AGENTIC_PROACTIVE_DEMO==="1" && process.env.NODE_ENV!=="production"
const sandboxOrg=process.env.ERP_SANDBOX_ORGANIZATION||"demo-fictive"
const demoData=proactiveDemo
  ? (process.env.DEMO_DATA_SOURCE==="extractions"?loadExtractedDemo().dataset:defaultDataset())
  : null
let running=false
let stopping=false
let lastRetentionDay:string|null=null
async function cycle() {
  if(running || stopping)return
  running=true
  try {
    const q=await adminPool.query("SELECT id FROM organizations WHERE status='active' ORDER BY id LIMIT 10000")
    let emitted=0
    for(const row of q.rows as {id:string}[]) {
      try { emitted+=await workspace.scanDue(row.id) }
      catch(error) { console.error("[agentic-worker] tenant job failed",row.id,error) }
    }
    if(emitted)console.log("[agentic-worker] in-app due notifications created:",emitted)
    // Nightly retention. Do not churn every tenant JSONB payload on each minute.
    const today=new Date().toISOString().slice(0,10)
    if(lastRetentionDay!==today){
      const retention=Number(process.env.AGENTIC_CHAT_RETENTION_DAYS||"90")
      const days=Number.isInteger(retention)&&retention>=7&&retention<=365?retention:90
      let removed=0
      for(const row of q.rows as {id:string}[]){
        try{removed+=await workspace.pruneChat(row.id,new Date().toISOString(),days)}
        catch(error){console.error("[agentic-worker] retention failed",row.id,error)}
      }
      lastRetentionDay=today
      if(removed)console.log("[agentic-worker] expired chat records pruned:",removed)
    }
    if(demoData && (q.rows as {id:string}[]).some(x=>x.id===sandboxOrg)){
      try{
        const result=await workspace.scanSignals(sandboxOrg,demoData)
        if(result.created) console.log("[agentic-worker] proactive demo alerts:",result.created)
      }catch(error){ console.error("[agentic-worker] demo proactive scan failed",error) }
    }
  }catch(error){console.error("[agentic-worker] cycle failed",error)}
  finally{running=false}
}
const timer=setInterval(()=>{void cycle()},60_000)
void cycle()
async function shutdown() {
  stopping=true
  clearInterval(timer)
  await Promise.all([store.close(),adminPool.end()])
  process.exit(0)
}
process.on("SIGTERM",()=>{void shutdown()})
process.on("SIGINT",()=>{void shutdown()})
