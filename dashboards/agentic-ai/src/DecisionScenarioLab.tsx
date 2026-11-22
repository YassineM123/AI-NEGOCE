import {useEffect,useState,type FormEvent} from "react"

type Mode="liquidity"|"stock_coverage"|"expansion_investment"
type Outcome={
 kind:Mode;status:"hypothesis_only";agency:string;asOf:string;erpWrites:0
 result:{projectedCashTnd?:number;shortfallToFloorTnd?:number;breachesFloor?:boolean;
   coverageDays?:number;shortfallDays?:number;shortageUnits?:number;beforeReplenishment?:boolean;
   upfrontInvestmentTnd?:number;monthlyNetContributionTnd?:number;npvTnd?:number;
   paybackMonth?:number|null;cashAfterInitialInvestmentTnd?:number;breachesAssumedCashFloor?:boolean}
 explanation:string;warnings:string[]
 sourceContext:{source:string;asOf:string;usedForCalculations:false}
}
const tnd=(v:number|undefined)=>typeof v==="number"?
 v.toLocaleString("fr-FR",{minimumFractionDigits:3,maximumFractionDigits:3})+" TND":"N/D"
export default function DecisionScenarioLab({
 token,agency,asOf,from,to,
}:{token:string|null;agency:string;asOf:string;from:string;to:string}){
 const [mode,setMode]=useState<Mode>("liquidity")
 const [cash,setCash]=useState({openingCashTnd:650000,inflowsTnd:300000,
   outflowsTnd:800000,floorTnd:250000,days:30})
 const [stock,setStock]=useState({sku:"SKU-A",availableUnits:120,
   dailyDemandUnits:20,replenishmentLeadDays:10})
 const [expansion,setExpansion]=useState({
   locationName:"Sousse Démo",capexTnd:100000,additionalWorkingCapitalTnd:20000,
   monthlyIncrementalRevenueTnd:30000,expectedGrossMarginPercent:40,
   monthlyOperatingCostTnd:4000,monthlyCannibalizedMarginTnd:1000,
   annualDiscountRatePercent:0,horizonMonths:24,
   cashAvailableForInvestmentTnd:200000,cashFloorTnd:100000,
 })
 const [outcome,setOutcome]=useState<Outcome|null>(null)
 const [working,setWorking]=useState(false)
 const [error,setError]=useState("")
 useEffect(()=>{setOutcome(null);setError("")},[token,agency,from,to,mode,asOf])
 const simulation=async(event:FormEvent)=>{
  event.preventDefault()
  if(!token||agency==="all"){setError("Sélectionnez une agence et connectez la session.");return}
  setWorking(true);setError("");setOutcome(null)
  try{
   const body={kind:mode,agency,from,to,inputs:{asOf,...(mode==="liquidity"?cash:mode==="stock_coverage"?stock:expansion)}}
   const response=await fetch("/api/v1/agentic/simulations/explain",{
    method:"POST",
    headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
    body:JSON.stringify(body),
   })
   if(!response.ok)throw new Error("Simulation indisponible : HTTP "+response.status)
   const result=await response.json() as Outcome
   if(result.kind!==mode||result.status!=="hypothesis_only"||result.erpWrites!==0 ||
     result.sourceContext?.usedForCalculations!==false)
     throw new Error("Contrat ou provenance de simulation invalide")
   setOutcome(result)
  }catch(e){setError(e instanceof Error?e.message:"Erreur de simulation")}
  finally{setWorking(false)}
 }
 const exportEvidence=()=>{
  if(!outcome)return
  const object={...outcome,scope:{agency,from,to},
    disclaimer:"Scénario fictif fondé sur des hypothèses saisies, non sur un solde ERP/bancaire."}
  const url=URL.createObjectURL(new Blob([JSON.stringify(object,null,2)],{type:"application/json"}))
  const a=document.createElement("a");a.href=url;a.download="ai-negoce-hypothese-"+mode+"-"+agency.replace(/\W+/g,"-")+".json"
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)
 }
 const num=(label:string,key:keyof typeof cash,step="0.001")=><label className="scenario-field">
   <span>{label}</span><input type="number" min="0" step={step} value={cash[key]}
     onChange={e=>setCash(previous=>({...previous,[key]:Number(e.target.value)}))} required/>
 </label>
 const expansionNum=(label:string,key:Exclude<keyof typeof expansion,"locationName">)=>
  <label className="scenario-field"><span>{label}</span><input type="number" required min="0"
   step={key==="horizonMonths"?"1":"0.001"} value={expansion[key]}
   onChange={e=>setExpansion(v=>({...v,[key]:Number(e.target.value)}))}/></label>
 const stockNum=(label:string,key:"availableUnits"|"dailyDemandUnits"|"replenishmentLeadDays")=>
  <label className="scenario-field"><span>{label}</span><input type="number"
    min={key==="replenishmentLeadDays"?"1":key==="dailyDemandUnits"?"0.001":"0"}
    step={key==="replenishmentLeadDays"?"1":"0.001"} required value={stock[key]}
    onChange={e=>setStock(previous=>({...previous,[key]:Number(e.target.value)}))}/></label>
 return <section className="scenario-lab" aria-label="Simulations métier explicables">
  <header className="scenario-head">
   <div><strong>Laboratoire de décision · simulations vérifiables</strong>
    <p>Exemples AG-02 / AG-03 du cahier des charges, hypothèses éditables · calcul côté serveur, aucune écriture ERP</p></div>
   <span>HYPOTHÈSES UNIQUEMENT</span>
  </header>
  <div className="scenario-modes" role="group" aria-label="Type de simulation">
   <button type="button" aria-pressed={mode==="liquidity"}
     onClick={()=>setMode("liquidity")}>Trésorerie · J+30</button>
   <button type="button" aria-pressed={mode==="stock_coverage"}
     onClick={()=>setMode("stock_coverage")}>Couverture stock</button>
   <button type="button" aria-pressed={mode==="expansion_investment"}
     onClick={()=>setMode("expansion_investment")}>Expansion · VAN / cash</button>
  </div>
  <form onSubmit={e=>{void simulation(e)}}>
   <div className="scenario-inputs">
    {mode==="liquidity"?<>
     {num("Solde initial · TND","openingCashTnd")}
     {num("Encaissements prévus · TND","inflowsTnd")}
     {num("Décaissements prévus · TND","outflowsTnd")}
     {num("Plancher de sécurité · TND","floorTnd")}
     {num("Horizon · jours","days","1")}
    </>:mode==="stock_coverage"?<>
     <label className="scenario-field"><span>Référence SKU</span><input required
       value={stock.sku} onChange={e=>setStock(v=>({...v,sku:e.target.value}))}/></label>
     {stockNum("Stock disponible · unités","availableUnits")}
     {stockNum("Consommation · unités / jour","dailyDemandUnits")}
     {stockNum("Délai de réapprovisionnement · jours","replenishmentLeadDays")}
    </>:<>
     <label className="scenario-field"><span>Implantation envisagée</span><input required
       value={expansion.locationName}
       onChange={e=>setExpansion(v=>({...v,locationName:e.target.value}))}/></label>
     {expansionNum("CAPEX initial · TND","capexTnd")}
     {expansionNum("BFR initial · TND","additionalWorkingCapitalTnd")}
     {expansionNum("CA additionnel mensuel · TND","monthlyIncrementalRevenueTnd")}
     {expansionNum("Marge brute estimée · %","expectedGrossMarginPercent")}
     {expansionNum("OPEX mensuels · TND","monthlyOperatingCostTnd")}
     {expansionNum("Cannibalisation de marge · TND / mois","monthlyCannibalizedMarginTnd")}
     {expansionNum("Taux d'actualisation annuel · %","annualDiscountRatePercent")}
     {expansionNum("Horizon · mois","horizonMonths")}
     {expansionNum("Trésorerie disponible hypothétique · TND","cashAvailableForInvestmentTnd")}
     {expansionNum("Plancher de trésorerie · TND","cashFloorTnd")}
    </>}
   </div>
   <div className="scenario-footer">
    <small>Agence : <b>{agency==="all"?"Sélection requise":agency}</b> · Arrêté : {asOf||"N/D"} · source = saisie utilisateur, pas ERP</small>
    <button type="submit" disabled={!token||agency==="all"||!asOf||working}>
      {working?"Calcul en cours…":"Calculer et expliquer"}
    </button>
   </div>
  </form>
  {error&&<p className="scenario-error" role="alert">{error}</p>}
  {outcome&&<div className="scenario-answer" role="status">
   <strong>{mode==="liquidity"?"Projection de liquidité hypothétique":mode==="stock_coverage"?
    "Couverture de stock hypothétique":"Expansion · VAN hypothétique, sans étude de marché"}</strong>
   <div className="scenario-results">
    {mode==="liquidity"?<>
     <div><small>Solde estimé · J+30</small><b>{tnd(outcome.result.projectedCashTnd)}</b></div>
     <div><small>Déficit sous le plancher</small><b>{tnd(outcome.result.shortfallToFloorTnd)}</b></div>
    </>:mode==="stock_coverage"?<>
     <div><small>Couverture disponible</small><b>{outcome.result.coverageDays} jours</b></div>
     <div><small>Écart avant réception</small><b>{outcome.result.shortfallDays} jours / {outcome.result.shortageUnits} unités</b></div>
    </>:<>
     <div><small>VAN fictive (sans impôt ni valeur terminale)</small><b>{tnd(outcome.result.npvTnd)}</b></div>
     <div><small>Contribution nette mensuelle</small><b>{tnd(outcome.result.monthlyNetContributionTnd)}</b></div>
     <div><small>Retour simple</small><b>{outcome.result.paybackMonth==null?"N/D":outcome.result.paybackMonth+" mois"}</b></div>
     <div><small>Cash post-investissement</small><b>{tnd(outcome.result.cashAfterInitialInvestmentTnd)}</b></div>
     <div><small>Plancher de cash</small><b>{outcome.result.breachesAssumedCashFloor?"Sous le plancher":"Non franchi"}</b></div>
    </>}
   </div>
   <p>{outcome.explanation}</p>
   <small>Preuve : hypothèses saisies dans ce formulaire · document ERP : aucun · {outcome.warnings[0]}</small>
   <button type="button" onClick={exportEvidence}>Exporter le calcul et les hypothèses · JSON</button>
  </div>}
 </section>
}
