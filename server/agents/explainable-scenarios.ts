/**
 * Governed, read-only business what-if calculator.
 * ALL inputs are explicitly supplied hypotheses, never inferred bank balances,
 * daily demand or ERP lead times. Calculations use integer millimes internally.
 */
import {z} from "zod"

const date=z.iso.date()
const money=z.number().finite().min(0).max(1_000_000_000)
const quantity=z.number().finite().min(0).max(1_000_000_000)
const positive=z.number().finite().gt(0).max(1_000_000_000)
export const decisionSimulationSchema=z.discriminatedUnion("kind",[
  z.object({
    kind:z.literal("liquidity"),agency:z.string().trim().min(1).max(80),
    from:date.optional(),to:date.optional(),
    inputs:z.object({
      asOf:date,days:z.number().int().min(1).max(365),
      openingCashTnd:money,inflowsTnd:money,outflowsTnd:money,floorTnd:money,
    }).strict(),
  }).strict(),
  z.object({
    kind:z.literal("expansion_investment"),agency:z.string().trim().min(1).max(80),
    from:date.optional(),to:date.optional(),
    inputs:z.object({
      asOf:date,locationName:z.string().trim().min(2).max(120),
      capexTnd:money,additionalWorkingCapitalTnd:money,
      monthlyIncrementalRevenueTnd:money,expectedGrossMarginPercent:z.number().finite().min(0).max(100),
      monthlyOperatingCostTnd:money,monthlyCannibalizedMarginTnd:money,
      annualDiscountRatePercent:z.number().finite().min(0).max(100),
      horizonMonths:z.number().int().min(1).max(120),
      cashAvailableForInvestmentTnd:money,cashFloorTnd:money,
    }).strict(),
  }).strict(),
  z.object({
    kind:z.literal("stock_coverage"),agency:z.string().trim().min(1).max(80),
    from:date.optional(),to:date.optional(),
    inputs:z.object({
      asOf:date,sku:z.string().trim().min(1).max(80),
      availableUnits:quantity,dailyDemandUnits:positive,
      replenishmentLeadDays:z.number().int().min(1).max(365),
    }).strict(),
  }).strict(),
])
type SimulationInput=z.infer<typeof decisionSimulationSchema>
const toMilli=(x:number)=>Math.round(x*1000)
const fromMilli=(x:number)=>x/1000
const amount=(x:number)=>Math.round(x*1000)/1000
const candidates=[
  {id:"review_supplier",label:"Contacter le fournisseur",requiresHumanApproval:true},
  {id:"review_transfer",label:"Examiner un transfert inter-agences",requiresHumanApproval:true},
  {id:"review_emergency",label:"Étudier une livraison prioritaire",requiresHumanApproval:true},
]
export function simulateDecision(input:SimulationInput) {
  if(input.from&&input.to&&input.from>input.to)
    throw new Error("INVALID_PERIOD")
  if(input.kind==="liquidity"){
    const x=input.inputs
    const closingMilli=toMilli(x.openingCashTnd)+toMilli(x.inflowsTnd)-toMilli(x.outflowsTnd)
    const shortfallMilli=Math.max(0,toMilli(x.floorTnd)-closingMilli)
    return {
      kind:input.kind,status:"hypothesis_only" as const,
      agency:input.agency,from:input.from??null,to:input.to??null,
      asOf:x.asOf,horizonDays:x.days,unit:"TND" as const,
      inputs:x,
      result:{
        projectedCashTnd:fromMilli(closingMilli),
        floorTnd:amount(x.floorTnd),
        shortfallToFloorTnd:fromMilli(shortfallMilli),
        breachesFloor:shortfallMilli>0,
      },
      explanation:"Solde hypothétique = solde initial + entrées - sorties. Écart = max(0, plancher - solde calculé).",
      evidence:{type:"user_supplied_assumptions" as const,documentIds:[] as string[]},
      suggestedReviews:[
        {id:"review_collections",label:"Vérifier les encaissements attendus",requiresHumanApproval:true},
        {id:"review_disbursements",label:"Vérifier les décaissements décalables",requiresHumanApproval:true},
        {id:"review_financing",label:"Étudier une facilité bancaire avec la finance",requiresHumanApproval:true},
      ],
      warnings:[
        "Démonstration de sensibilité, pas une prévision de liquidité issue de transactions bancaires.",
        "Entrées, sorties et plancher doivent être justifiés avant toute décision.",
        "Aucun ordre bancaire ni écriture ERP n'est exécuté.",
      ],
      erpWrites:0 as const,
    }
  }
  if(input.kind==="expansion_investment"){
    const x=input.inputs
    const initial=toMilli(x.capexTnd)+toMilli(x.additionalWorkingCapitalTnd)
    const monthlyGross=toMilli(x.monthlyIncrementalRevenueTnd*x.expectedGrossMarginPercent/100)
    const contributionMilli=monthlyGross-toMilli(x.monthlyOperatingCostTnd)-toMilli(x.monthlyCannibalizedMarginTnd)
    const monthlyRate=Math.pow(1+x.annualDiscountRatePercent/100,1/12)-1
    let discounted=0,firstPayback:null|number=null
    for(let month=1;month<=x.horizonMonths;month++){
      discounted+=contributionMilli/Math.pow(1+monthlyRate,month)
      if(firstPayback===null&&contributionMilli>0&&contributionMilli*month>=initial)
        firstPayback=month
    }
    const cashPostInvestmentMilli=toMilli(x.cashAvailableForInvestmentTnd)-initial
    const floorBreached=cashPostInvestmentMilli<toMilli(x.cashFloorTnd)
    return {
      kind:input.kind,status:"hypothesis_only" as const,agency:input.agency,
      from:input.from??null,to:input.to??null,asOf:x.asOf,unit:"TND" as const,
      inputs:x,
      result:{
        upfrontInvestmentTnd:fromMilli(initial),
        monthlyGrossContributionTnd:fromMilli(monthlyGross),
        monthlyNetContributionTnd:fromMilli(contributionMilli),
        npvTnd:amount((discounted-initial)/1000),
        paybackMonth:firstPayback,expectedHorizonMonths:x.horizonMonths,
        cashAfterInitialInvestmentTnd:fromMilli(cashPostInvestmentMilli),
        breachesAssumedCashFloor:floorBreached,
        reviewRequired:true as const,
      },
      explanation:"VAN = -CAPEX - BFR initial + somme des contributions mensuelles actualisées. Contribution = CA additionnel × marge brute hypothétique - OPEX - cannibalisation. Sans valeur terminale ni impôt.",
      evidence:{type:"user_supplied_assumptions" as const,documentIds:[] as string[]},
      suggestedReviews:[
        {id:"market",label:"Valider demande et concurrence locales",requiresHumanApproval:true},
        {id:"finance",label:"Confirmer CAPEX, BFR, cash disponible et marge",requiresHumanApproval:true},
        {id:"operations",label:"Vérifier disponibilité opérationnelle et autorisations",requiresHumanApproval:true},
      ],
      warnings:[
        "Scénario d'investissement fictif, ni étude de marché ni prévision certifiée.",
        "Pas de fiscalité, valeur terminale, ramp-up, loyers variables, inflation ou engagements financiers réels.",
        "La VAN positive ne prouve pas la faisabilité; aucune ouverture ni écriture ERP automatique.",
      ],erpWrites:0 as const,
    }
  }
  const x=input.inputs
  const available=x.availableUnits,demand=x.dailyDemandUnits,lead=x.replenishmentLeadDays
  const coverageDays=amount(available/demand)
  const shortageUnits=amount(Math.max(0,lead*demand-available))
  const breach=coverageDays<lead
  return {
    kind:input.kind,status:"hypothesis_only" as const,
    agency:input.agency,from:input.from??null,to:input.to??null,
    asOf:x.asOf,unit:"units" as const,
    inputs:x,
    result:{
      coverageDays,leadTimeDays:lead,shortfallDays:amount(Math.max(0,lead-coverageDays)),
      shortageUnits,beforeReplenishment:breach,
    },
    explanation:"Couverture = stock disponible / demande journalière. Manque avant réception = max(0, délai × demande - disponible).",
    evidence:{type:"user_supplied_assumptions" as const,documentIds:[] as string[]},
    suggestedReviews:candidates,
    warnings:[
      "Demande stable supposée; réservations, stocks en transit, unité SKU et fournisseurs non rapprochés.",
      "Options de transfert et d'urgence indicatives, sans devis ni validation de disponibilité.",
      "Aucune commande ERP ni transfert physique créé.",
    ],
    erpWrites:0 as const,
  }
}
