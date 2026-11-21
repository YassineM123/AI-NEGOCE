export type AgentKey = "revenue" | "finance" | "supply" | "strategy"
export type MissionState = "a_planifier" | "en_cours" | "en_revue" | "terminee"
export type Priority = "haute" | "moyenne" | "basse"
export type DecisionState = "pending" | "review" | "approved" | "rejected"

export type AgentInfo = {
  id: AgentKey
  name: string
  subtitle: string
  description: string
  icon: string
  category: string
  implemented: boolean
  accent: string
}
export type Mission = {
  id: string
  title: string
  objective: string
  agent: AgentKey
  state: MissionState
  priority: Priority
  progress: number
  deadline: string
  steps: string[]
}
export type Decision = {
  id: string
  title: string
  agent: AgentKey
  impact: string
  priority: Priority
  risk: string
  status: DecisionState
  rationale: string
  evidence: string[]
  missionId: string
  date: string
}
export type Alert = {
  id: string
  agent: AgentKey
  title: string
  detail: string
  priority: Priority
  seen: boolean
  timestamp: string
}
export type Audit = {
  id: string
  time: string
  action: string
  actor: string
  agent: AgentKey | "director"
  result: string
  missionId: string
}

export const agents: AgentInfo[] = [
  { id: "revenue", name: "Revenue Growth", subtitle: "Développement commercial", icon: "chart", accent: "#075bf1", category: "Croissance", implemented: true, description: "Identification des clients à relancer, évolution du chiffre d'affaires et opportunités de croissance." },
  { id: "finance", name: "Financial Strategy", subtitle: "Finance et trésorerie", icon: "coins", accent: "#0c7bca", category: "Finance", implemented: true, description: "Analyse des créances, gestion de trésorerie et simulations de scénarios financiers." },
  { id: "supply", name: "Supply Chain Intelligence", subtitle: "Stocks et achats", icon: "cube", accent: "#1465e9", category: "Opérations", implemented: true, description: "Anticipation des ruptures, couverture de stocks et aide au réapprovisionnement." },
  { id: "strategy", name: "Business Strategy", subtitle: "Décisions stratégiques", icon: "layers", accent: "#304ac2", category: "Stratégie", implemented: true, description: "Évaluation des scénarios d'investissement et pilotage des orientations commerciales." },
]
export const byAgent = (id: AgentKey) => agents.find((agent) => agent.id === id)!

// All of the records below are synthetic UI design fixtures, never actual ERP evidence.
export const initialMissions: Mission[] = [
  { id: "M-2026-014", title: "Identifier les clients à réactiver", objective: "Prioriser une campagne de relance commerciale sur la base de ventes comparables.", agent: "revenue", state: "en_cours", priority: "haute", progress: 72, deadline: "26 nov. 2026", steps: ["Collecte de données", "Analyse commerciale", "Recommandations", "Validation métier"] },
  { id: "M-2026-013", title: "Évaluer les risques de trésorerie", objective: "Identifier les créances sensibles et préparer des actions de suivi.", agent: "finance", state: "a_planifier", priority: "haute", progress: 0, deadline: "28 nov. 2026", steps: ["Collecte", "Évaluation", "Scénarios", "Validation"] },
  { id: "M-2026-012", title: "Optimiser les seuils de stock", objective: "Réduire le risque de rupture sur les références prioritaires.", agent: "supply", state: "en_revue", priority: "moyenne", progress: 90, deadline: "30 nov. 2026", steps: ["Collecte", "Diagnostic", "Recommandations", "Revue"] },
  { id: "M-2026-011", title: "Préparer la stratégie commerciale", objective: "Évaluer les options de croissance du prochain trimestre.", agent: "strategy", state: "a_planifier", priority: "moyenne", progress: 0, deadline: "04 déc. 2026", steps: ["Cadrage", "Scénarios", "Comparaison", "Décision"] },
  { id: "M-2026-010", title: "Revue des segments clients", objective: "Identifier les groupes de clients à fort potentiel.", agent: "revenue", state: "terminee", priority: "basse", progress: 100, deadline: "18 nov. 2026", steps: ["Collecte", "Analyse", "Synthèse", "Terminé"] },
]
export const initialDecisions: Decision[] = [
  { id: "DEC-2026-041", title: "Plan de relance des clients dormants", agent: "revenue", impact: "À évaluer", priority: "haute", risk: "Faible", status: "pending", rationale: "Rappeler les clients ayant réduit leur volume d'achats. Proposition illustrative à confirmer avec des preuves commerciales.", evidence: ["Historique des ventes", "Tendance par client", "Période de référence"], missionId: "M-2026-014", date: "20 nov. 2026" },
  { id: "DEC-2026-040", title: "Révision du stock de sécurité", agent: "supply", impact: "À évaluer", priority: "haute", risk: "Moyen", status: "pending", rationale: "Revoir les seuils d'articles potentiellement en rupture avant tout ordre d'achat.", evidence: ["Couverture de stock", "Délais fournisseurs", "Consommation moyenne"], missionId: "M-2026-012", date: "20 nov. 2026" },
  { id: "DEC-2026-039", title: "Scénario de trésorerie court terme", agent: "finance", impact: "À évaluer", priority: "moyenne", risk: "Moyen", status: "review", rationale: "Comparer plusieurs hypothèses d'encaissement avant de prendre une décision budgétaire.", evidence: ["Échéances ouvertes", "Historique encaissements"], missionId: "M-2026-013", date: "19 nov. 2026" },
]
export const initialAlerts: Alert[] = [
  { id: "N-001", agent: "revenue", title: "Clients à relancer", detail: "Une revue de l'activité clients est recommandée. Examinez les opportunités dans Revenue Growth.", priority: "haute", seen: false, timestamp: "Aujourd'hui, 09:42" },
  { id: "N-002", agent: "supply", title: "Seuils de stocks à examiner", detail: "Vérifier les seuils avant toute proposition de réapprovisionnement.", priority: "haute", seen: false, timestamp: "Aujourd'hui, 08:51" },
  { id: "N-003", agent: "finance", title: "Créances : revue recommandée", detail: "Une analyse du vieillissement des créances aiderait à prioriser le recouvrement.", priority: "moyenne", seen: false, timestamp: "Hier, 16:18" },
  { id: "N-004", agent: "strategy", title: "Plan stratégique en attente", detail: "Un scénario stratégique est en attente de cadrage métier.", priority: "basse", seen: true, timestamp: "Hier, 11:03" },
]
export const initialAudit: Audit[] = [
  { id: "EVT-101", time: "20 nov. 09:42", action: "Notification", actor: "Revenue Growth (démo)", agent: "revenue", result: "À traiter", missionId: "M-2026-014" },
  { id: "EVT-100", time: "20 nov. 08:51", action: "Alerte", actor: "Supply Chain (démo)", agent: "supply", result: "Proposition", missionId: "M-2026-012" },
  { id: "EVT-099", time: "19 nov. 17:12", action: "Analyse", actor: "AI Director (démo)", agent: "director", result: "À revoir", missionId: "M-2026-013" },
  { id: "EVT-098", time: "18 nov. 14:25", action: "Mission", actor: "Revenue Growth (démo)", agent: "revenue", result: "Terminée", missionId: "M-2026-010" },
]
export const statusLabel: Record<MissionState, string> = {
  a_planifier: "À planifier", en_cours: "En cours", en_revue: "En revue", terminee: "Terminée",
}
export const decisionLabel: Record<DecisionState, string> = {
  pending: "En attente", review: "À revoir", approved: "Approuvée", rejected: "Refusée",
}
export const priorityLabel: Record<Priority, string> = {
  haute: "Haute", moyenne: "Moyenne", basse: "Basse",
}
