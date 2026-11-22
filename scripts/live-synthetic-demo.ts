/**
 * Run a synthetic "living company" over the ONE versioned PostgreSQL snapshot.
 * This process runs only while launched locally; stop with Ctrl+C.
 *
 * npm run analytics:demo:live -- --agency=Sfax --ticks=0 --interval-seconds=30
 * npm run analytics:demo:live -- --agency=Sfax --ticks=4 --interval-seconds=5
 *
 * --ticks=0 is explicitly continuous. Default = one tick, no background task.
 */
import {PostgresStore} from "../server/store.js"
import {readAnalyticalDataset,saveAnalyticalDataset} from "../server/analytics-database.js"
import {applySyntheticDemoEvent,type DemoKind} from "../server/demo-live-simulator.js"
const names=new Set(["agency","ticks","interval-seconds","advance-days","kind"])
const flags=new Map<string,string>()
for(const raw of process.argv.slice(2)){
 const match=/^--([a-z-]+)=(.+)$/.exec(raw)
 if(!match||!names.has(match[1])||flags.has(match[1]))
  throw new Error("Usage: --agency=Sfax --ticks=0 --interval-seconds=30 --advance-days=0 --kind=cycle")
 flags.set(match[1],match[2])
}
function integer(name:string,fallback:number,min:number,max:number){
 const raw=flags.get(name)
 if(raw===undefined)return fallback
 if(!/^\d+$/.test(raw)||Number(raw)<min||Number(raw)>max)
  throw new Error("DEMO_INVALID_"+name.toUpperCase().replace(/-/g,"_"))
 return Number(raw)
}
const ticks=integer("ticks",1,0,10000)
const interval=integer("interval-seconds",30,2,3600)
const advanceDays=integer("advance-days",0,0,30)
const kind=(flags.get("kind")??"cycle") as DemoKind
if(!["cycle","sale","collection","restock","supplier"].includes(kind))
 throw new Error("DEMO_INVALID_KIND")
const agency=flags.get("agency")
if(agency&&!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'-]{1,79}$/.test(agency))
 throw new Error("DEMO_INVALID_AGENCY")
const database=process.env.DATABASE_URL
if(process.env.NODE_ENV==="production"||process.env.AUTH_MODE!=="local-dev"||
 process.env.UNIFIED_ANALYTICS_SOURCE!=="postgres"||
 (process.env.ERP_SANDBOX_ORGANIZATION??"demo-fictive")!=="demo-fictive"||!database)
 throw new Error("DEMO_LOCAL_SYNTHETIC_POSTGRES_REQUIRED")
const u=new URL(database)
if(!["localhost","127.0.0.1","[::1]","::1"].includes(u.hostname))
 throw new Error("DEMO_DB_LOOPBACK_REQUIRED")
const store=new PostgresStore(database)
let stop=false
process.once("SIGINT",()=>{stop=true})
process.once("SIGTERM",()=>{stop=true})
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))
try{
 const org=await store.getOrganization("demo-fictive")
 if(!org?.isSynthetic||org.status!=="active")
  throw new Error("DEMO_SYNTHETIC_ORGANIZATION_REQUIRED")
 const tenant=store.forTenant("demo-fictive")
 for(let step=0;!stop&&(ticks===0||step<ticks);step++){
  const current=await readAnalyticalDataset(tenant)
  if(!current||current.sourceKind!=="synthetic")
   throw new Error("DEMO_REQUIRES_SYNTHETIC_SNAPSHOT: run analytics:seed -- --source=synthetic")
  const {dataset,event}=applySyntheticDemoEvent(current.dataset,{
   sequence:current.revision,agency,kind,advanceDays,
  })
  const saved=await saveAnalyticalDataset(tenant,dataset,"synthetic",true,current.revision)
  console.log(JSON.stringify({
   status:"published",step:step+1,previousRevision:current.revision,
   revision:saved.revision,sourceHash:saved.sourceHash,
   businessDate:dataset.metadata.asOf,event,
   dashboardRefresh:"polling up to 30s on visible connected portal",
   requiresHumanApproval:true,erpWrites:0,
  }))
  if(!stop&&(ticks===0||step+1<ticks))await sleep(interval*1000)
 }
}catch(e){
 console.error("[analytics:demo:live]",e instanceof Error?e.message:String(e))
 process.exitCode=1
}finally{await store.close()}
