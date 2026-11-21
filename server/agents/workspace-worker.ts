import { Pool } from "pg"
import { PostgresStore } from "../store.js"
import { AgenticWorkspace } from "./workspace.js"

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
let running=false
let stopping=false
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
