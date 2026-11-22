import { useEffect, useMemo, useRef, useState, type ReactNode, type FormEvent } from "react"
import Icon from "./Icon"
import {
  agents, byAgent, decisionLabel, initialAlerts, initialAudit, initialDecisions,
  initialMissions, priorityLabel, statusLabel,
  type AgentKey, type Alert, type Audit, type Decision,
  type DecisionState, type Mission, type MissionState, type Priority,
} from "./data"
import {
  createLocalDemoSession, createReinvestigation, fetchPlatformContext, fetchRevenueGrowth,
  fetchSpecialistReport, fetchDirectorReport, fetchSharedOverview,
  type PlatformContext, type AnalyticsOverview, type SharedFilters, type RevenueResult, type SpecialistReport,
  type SpecialistAgent, type DirectorReport,
} from "./api"
import UnifiedExperience from "./UnifiedExperience"
import DecisionScenarioLab from "./DecisionScenarioLab"
import SpecialistDecisionSupport from "./SpecialistDecisionSupport"
import DecisionIntelligencePanel from "./DecisionIntelligencePanel"
import { AGENT_DOMAIN, AdvancedMissions, AdvancedApprovals, AdvancedNotifications, AdvancedAgentChat, AdvancedOverview } from "./AdvancedWorkspace"

type Page = "overview" | "missions" | "agents" | "agent" | "director" | "decisions" | "notifications" | "platforms" | "connections" | "audit" | "settings"
const PERIODS: Record<string, { from: string; to: string }> = {
  "T4 2026": { from: "2026-10-01", to: "2026-12-31" },
  "T3 2026": { from: "2026-07-01", to: "2026-09-30" },
  "2026": { from: "2026-01-01", to: "2026-12-31" },
}

type ChatMessage = { role: "user" | "assistant"; content: string; time: string }
type Tone = "blue" | "green" | "amber" | "red" | "gray"

const navigation: { page: Page; label: string; icon: string }[] = [
  { page: "overview", label: "Vue d'ensemble", icon: "home" },
  { page: "missions", label: "Centre de missions", icon: "target" },
  { page: "agents", label: "Mes agents", icon: "users" },
  { page: "director", label: "AI Director", icon: "layers" },
  { page: "decisions", label: "Décisions et approbations", icon: "shield" },
  { page: "notifications", label: "Notifications", icon: "bell" },
  { page: "platforms", label: "Plateformes BI / DS", icon: "chart" },
  { page: "connections", label: "Connexions BI / Data Science", icon: "database" },
  { page: "audit", label: "Historique & audit", icon: "history" },
  { page: "settings", label: "Paramètres", icon: "settings" },
]
const stateTone: Record<MissionState, Tone> = {
  a_planifier: "gray", en_cours: "blue", en_revue: "amber", terminee: "green",
}
const priorityTone: Record<Priority, Tone> = { haute: "red", moyenne: "amber", basse: "blue" }
const decisionTone: Record<DecisionState, Tone> = { pending: "amber", review: "blue", approved: "green", rejected: "red" }
const states: MissionState[] = ["a_planifier", "en_cours", "en_revue", "terminee"]
const timeNow = () => new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })

function Pill({ children, tone = "gray", dot = false }: { children: ReactNode; tone?: Tone; dot?: boolean }) {
  return <span className={"pill pill-" + tone}>{dot && <i className="pill-dot" />}{children}</span>
}
function Action({ icon, children, onClick, light = false, disabled = false, className = "" }: {
  icon?: string; children: ReactNode; onClick?: () => void; light?: boolean; disabled?: boolean; className?: string
}) {
  return <button type="button" className={"action " + (light ? "action-light " : "action-primary ") + className} onClick={onClick} disabled={disabled}>{icon && <Icon name={icon} size={16} />}{children}</button>
}
function Card({ title, icon, children, action, className = "" }: {
  title?: string; icon?: string; children: ReactNode; action?: ReactNode; className?: string
}) {
  return <section className={"card " + className}>
    {(title || action) && <div className="card-head"><div className="card-title">{icon && <Icon name={icon} size={19} />}{title}</div>{action}</div>}
    {children}
  </section>
}
function Stat({ label, value, icon, detail, tone = "blue" }: {
  label: string; value: string | number; icon: string; detail?: string; tone?: Tone
}) {
  return <div className="stat-card"><div className={"stat-icon stat-" + tone}><Icon name={icon} size={27} /></div><div className="stat-body"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div></div>
}
function Progress({ value, green = false }: { value: number; green?: boolean }) {
  return <div className="progress"><span style={{ width: Math.max(0, Math.min(100, value)) + "%", backgroundColor: green ? "#159447" : undefined }} /></div>
}
function Avatar({ agent, size = "normal" }: { agent: AgentKey | "director"; size?: "normal" | "large" }) {
  return <div className={"agent-avatar " + (size === "large" ? "avatar-large" : "")}><Icon name={agent === "director" ? "layers" : byAgent(agent).icon} size={size === "large" ? 27 : 20} /></div>
}
function AgentLabel({ agent }: { agent: AgentKey }) {
  return <span className="agent-label"><Avatar agent={agent} /> <span>{byAgent(agent).name}</span></span>
}
function SmallLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" className="small-link" onClick={onClick}>{children}<Icon name="arrow" size={15} /></button>
}
function Stepper({ steps, progress }: { steps: string[]; progress: number }) {
  const complete = Math.floor(Math.max(0, Math.min(100, progress)) / 100 * steps.length)
  return <div className="stepper">{steps.map((label, index) => {
    const kind = index < complete ? "done" : index === complete && progress < 100 ? "active" : "next"
    return <div key={label + index} className={"step " + kind}><div className="step-top"><span className="step-circle">{kind === "done" ? <Icon name="check" size={14} /> : index + 1}</span></div><b>{label}</b><small>{kind === "done" ? "Terminée" : kind === "active" ? "En cours" : "À venir"}</small></div>
  })}</div>
}
function Empty({ icon = "layers", title, text }: { icon?: string; title: string; text: string }) {
  return <div className="empty"><Icon name={icon} size={30} /><strong>{title}</strong><span>{text}</span></div>
}
function MiniChart({ values = [36, 51, 47, 64, 62, 78, 72, 91] }: { values?: number[] }) {
  const pts = values.map((n, i) => (24 + i * (410 / Math.max(1, values.length - 1))) + "," + (155 - n * 1.2)).join(" ")
  return <div className="mini-chart"><div className="chart-caption"><b>Évolution observée / illustrative</b><Pill tone="gray">DÉMO</Pill></div><svg viewBox="0 0 460 180" role="img" aria-label="Courbe illustrative du chiffre d'affaires"><path className="chart-grid" d="M24 35H440M24 80H440M24 125H440M24 155H440" /><polyline points={pts} fill="none" stroke="#0c5be9" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />{values.map((n, i) => <circle key={i} cx={24 + i * 410 / Math.max(1, values.length - 1)} cy={155 - n * 1.2} r="4" fill="white" stroke="#0c5be9" strokeWidth="2.5" />)}</svg><div className="chart-labels"><span>Période N-1</span><span>Période N</span></div></div>
}

export default function App() {
  const [page, setPage] = useState<Page>("overview")
  const [selectedAgent, setSelectedAgent] = useState<AgentKey>("revenue")
  const [missions, setMissions] = useState<Mission[]>(initialMissions)
  const [decisions, setDecisions] = useState<Decision[]>(initialDecisions)
  const [alerts, setAlerts] = useState<Alert[]>(initialAlerts)
  const [audit, setAudit] = useState<Audit[]>(initialAudit)
  const [missionId, setMissionId] = useState("M-2026-014")
  const [decisionId, setDecisionId] = useState("DEC-2026-041")
  const [agency, setAgency] = useState("all")
  const [period, setPeriod] = useState("T4 2026")
  const [refreshSeq, setRefreshSeq] = useState(0)
  const [portalTab, setPortalTab] = useState<"bi" | "ds">("bi")
  const [sharedOverview, setSharedOverview] = useState<AnalyticsOverview | null>(null)
  const [sharedError, setSharedError] = useState("")
  const snapshotsSeen = useRef<Record<string,string>>({})
  const [snapshotChange,setSnapshotChange] = useState<{previous:string;current:string}|null>(null)
  const [reinvestigating,setReinvestigating] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const bridgeVersion = useRef(0)
  const sharedFilters: SharedFilters = useMemo(
    () => ({ agency, ...PERIODS[period] }), [agency, period],
  )
  const [query, setQuery] = useState("")
  const [missionFilter, setMissionFilter] = useState("all")
  const [agentFilter, setAgentFilter] = useState("all")
  const [notificationOpen, setNotificationOpen] = useState(false)
  const [missionModal, setMissionModal] = useState(false)
  const [newTitle, setNewTitle] = useState("")
  const [newAgent, setNewAgent] = useState<AgentKey>("revenue")
  const [newPriority, setNewPriority] = useState<Priority>("moyenne")
  const [chatDraft, setChatDraft] = useState("")
  const [chats, setChats] = useState<Record<AgentKey, ChatMessage[]>>({
    revenue: [{ role: "assistant", content: "Bonjour. Je suis l'espace de suivi Revenue Growth. Connectez le sandbox pour consulter les opportunités calculées par le moteur métier.", time: "—" }],
    finance: [{ role: "assistant", content: "Espace Financial Strategy prêt. Le service agentique conversationnel reste à connecter : aucune donnée financière réelle n'est disponible ici.", time: "—" }],
    supply: [{ role: "assistant", content: "Espace Supply Chain prêt. L'intégration du spécialiste et des données stock reste à réaliser.", time: "—" }],
    strategy: [{ role: "assistant", content: "Espace Business Strategy prêt. Les simulations et le service conversationnel sont en attente d'intégration.", time: "—" }],
  })
  const [token, setToken] = useState<string | null>(null)
  const [demoIdentity, setDemoIdentity] = useState("admin")
  const [platform, setPlatform] = useState<PlatformContext | null>(null)
  const [revenue, setRevenue] = useState<RevenueResult | null>(null)
  const [specialistReports, setSpecialistReports] = useState<Partial<Record<SpecialistAgent, SpecialistReport>>>({})
  const [specialistErrors, setSpecialistErrors] = useState<Partial<Record<SpecialistAgent, string>>>({})
  const [directorReport, setDirectorReport] = useState<DirectorReport | null>(null)
  const [directorObjective, setDirectorObjective] = useState("Analyser la croissance, les créances, les stocks et la stratégie")
  const [directorBusy, setDirectorBusy] = useState(false)
  const [directorError, setDirectorError] = useState("")
  const [backendStatus, setBackendStatus] = useState<"disconnected" | "loading" | "connected" | "error">("disconnected")
  const [apiError, setApiError] = useState("")
  const [toast, setToast] = useState("")
  const [notificationRules, setNotificationRules] = useState({ alerts: true, approvals: true, summary: false })

  useEffect(() => {
    if (!toast) return
    const timeout = setTimeout(() => setToast(""), 4200)
    return () => clearTimeout(timeout)
  }, [toast])
  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    setRevenue(null)
    setBackendStatus("loading")
    void (async () => {
      try {
        const context = await fetchPlatformContext(token, controller.signal)
        if (controller.signal.aborted) return
        setPlatform(context)
        const result = context.permissions.includes("agentic.read")
          ? await fetchRevenueGrowth(token, agency, controller.signal, sharedFilters)
          : null
        if (controller.signal.aborted) return
        setRevenue(result)
        setBackendStatus("connected")
        setApiError(context.permissions.includes("agentic.read") ? "" : "Accès Revenue Growth non autorisé")
      } catch (err: unknown) {
        if (controller.signal.aborted) return
        setRevenue(null)
        setPlatform(null)
        setBackendStatus("error")
        setApiError(err instanceof Error ? err.message : "Erreur API")
      }
    })()
    return () => controller.abort()
  }, [token, agency, sharedFilters, refreshSeq])
  useEffect(() => {
    setSpecialistReports({})
    setSpecialistErrors({})
    setDirectorReport(null)
    if (!token) return
    const controller = new AbortController()
    for (const agent of ["finance", "supply", "strategy"] as const) {
      fetchSpecialistReport(token, agent, agency, controller.signal, sharedFilters)
        .then((report) => {
          if (!controller.signal.aborted)
            setSpecialistReports((prev) => ({...prev, [agent]:report}))
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setSpecialistErrors((prev) => ({...prev, [agent]:error instanceof Error ? error.message : "Erreur API"}))
        })
    }
    return () => controller.abort()
  }, [token, agency, sharedFilters, refreshSeq])


  // Single contract-validated snapshot for BI, Data Science and Agentic.
  useEffect(() => {
    setSharedOverview(null)
    setSharedError("")
    if (!token) return
    const controller = new AbortController()
    fetchSharedOverview(token, sharedFilters, controller.signal).then((data) => {
      if (!controller.signal.aborted) setSharedOverview(data)
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setSharedError(error instanceof Error ? error.message : "Source indisponible")
    })
    return () => controller.abort()
  }, [token, sharedFilters, refreshSeq])

  // Detect only changed revisions for the SAME agency and period; changing
  // filters alone must never manufacture a data-change notification.
  useEffect(()=>{
    if(!sharedOverview||!token)return
    const key=JSON.stringify([platform?.principal.organizationId||"sandbox",agency,sharedFilters.from,sharedFilters.to])
    const previous=snapshotsSeen.current[key]
    const current=sharedOverview.snapshotId
    if(sharedOverview.snapshot.storage==="postgres" && previous && previous!==current){
      setSnapshotChange({previous,current})
    }else if(!previous||previous===current){
      setSnapshotChange(null)
    }
    snapshotsSeen.current[key]=current
  },[sharedOverview,token,platform?.principal.organizationId,agency,sharedFilters])

  // Lightweight revision polling; full BI/DS and specialist refresh only when
  // the snapshot actually changes. No direct browser-to-PostgreSQL connection.
  useEffect(()=>{
    if(!token)return
    let busy=false
    const interval=window.setInterval(()=>{
      if(busy||document.visibilityState!=="visible")return
      busy=true
      void fetchSharedOverview(token,sharedFilters).then(next=>{
        if(next.snapshot.storage!=="postgres")return
        const key=JSON.stringify([platform?.principal.organizationId||"sandbox",agency,sharedFilters.from,sharedFilters.to])
        const previous=snapshotsSeen.current[key]
        if(previous && previous!==next.snapshotId){
          setRefreshSeq(n=>n+1)
        }
      }).catch(()=>{/* keep the last known snapshot; manual refresh shows errors */})
        .finally(()=>{busy=false})
    },30000)
    return ()=>window.clearInterval(interval)
  },[token,sharedFilters,agency,platform?.principal.organizationId])

  const reinvestigate=async()=>{
    if(!token||!sharedOverview||!snapshotChange)return
    setReinvestigating(true)
    try{
      const result=await createReinvestigation(token,sharedFilters,snapshotChange.current)
      setSnapshotChange(null)
      setToast("Dossier "+result.missionId+" créé : "+result.findings+" constat(s), "+
        (result.approvalId?"validation humaine requise.":"aucune approbation nécessaire."))
      setPage("missions")
    }catch(error){
      setToast(error instanceof Error?error.message:"Création du dossier impossible")
    }finally{setReinvestigating(false)}
  }

  // Child apps never receive tokens. A strict origin/source allow-list limits bridge requests.
  useEffect(() => {
    const version = ++bridgeVersion.current
    const origin = window.location.origin
    const sendState = () => iframeRef.current?.contentWindow?.postMessage({
      type: "AI_NEGOCE_BRIDGE_STATE",
      revision: version, connected: Boolean(token), filters: sharedFilters,
    }, origin)
    const handleMessage = (event: MessageEvent) => {
      const frame = iframeRef.current?.contentWindow
      if (!frame || event.origin !== origin || event.source !== frame) return
      const msg = event.data as { type?: string; id?: unknown; operation?: unknown } | null
      if (!msg || typeof msg !== "object") return
      if (msg.type === "AI_NEGOCE_BRIDGE_READY") { sendState(); return }
      // Same-origin child dashboards can navigate to a specialist without
      // receiving the access token. Restrict the action to four known agents.
      if (msg.type === "AI_NEGOCE_BRIDGE_OPEN_AGENT") {
        const target = (event.data as {agent?:unknown}).agent
        const allowed = ["revenue","finance","supply","strategy"]
        if (token && typeof target === "string" && allowed.includes(target)) {
          setSelectedAgent(target as AgentKey)
          setPage("agent")
        }
        return
      }
      if (msg.type !== "AI_NEGOCE_BRIDGE_REQUEST" ||
        typeof msg.id !== "string" || !/^req-[0-9]{1,8}$/.test(msg.id)) return
      const reply = (data: unknown, error?: string) =>
        frame.postMessage({ type: "AI_NEGOCE_BRIDGE_RESPONSE", id: msg.id, data, error }, origin)
      if (!token) { reply(null, "Session centrale déconnectée"); return }
      if (msg.operation === "context") {
        void fetchPlatformContext(token).then((data) => reply(data))
          .catch(() => reply(null, "Contexte non autorisé"))
      } else if (msg.operation === "overview") {
        const required = portalTab === "bi" ? "analytics.bi.read" : "analytics.ds.read"
        void fetchPlatformContext(token).then((context) => {
          if (!context.permissions.includes(required)) throw new Error("Permission de plateforme absente")
          return fetchSharedOverview(token, sharedFilters)
        }).then((data) => reply(data))
          .catch(() => reply(null, "Snapshot non autorisé ou indisponible"))
      } else {
        reply(null, "Opération refusée")
      }
    }
    window.addEventListener("message", handleMessage)
    sendState()
    return () => window.removeEventListener("message", handleMessage)
  }, [token, sharedFilters, page, portalTab, refreshSeq])

  const activeMission = missions.find((item) => item.id === missionId) ?? missions[0]
  const activeDecision = decisions.find((item) => item.id === decisionId) ?? decisions[0]
  const pendingDecisions = decisions.filter((item) => item.status === "pending" || item.status === "review")
  const unread = alerts.filter((item) => !item.seen).length
  const filteredMissions = useMemo(() => missions.filter((item) => {
    if (missionFilter !== "all" && item.state !== missionFilter) return false
    if (agentFilter !== "all" && item.agent !== agentFilter) return false
    const haystack = (item.title + " " + item.id + " " + byAgent(item.agent).name).toLowerCase()
    return haystack.includes(query.toLowerCase())
  }), [missions, missionFilter, agentFilter, query])
  const selectedNotifications = alerts.filter((item) => item.agent === selectedAgent)
  const sampleImpact = "—"

  const navigate = (dest: Page, agent?: AgentKey) => {
    if (agent) setSelectedAgent(agent)
    setPage(dest)
    setNotificationOpen(false)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }
  const track = (action: string, result: string, agent: AgentKey | "director", id = "—") => {
    setAudit((prev) => [{
      id: "EVT-" + Date.now(),
      time: new Date().toLocaleString("fr-FR"),
      action,
      actor: "Utilisateur (session démo)",
      agent,
      result,
      missionId: id,
    }, ...prev])
  }
  const connectSandbox = async () => {
    setBackendStatus("loading")
    setApiError("")
    try {
      const sessionToken = await createLocalDemoSession(demoIdentity)
      setToken(sessionToken)
      setToast("Sandbox de développement connecté. Aucun accès ERP réel.")
    } catch (error) {
      setBackendStatus("error")
      setApiError(error instanceof Error ? error.message : "Connexion impossible")
      setToast("Connexion impossible : démarrez le backend local.")
    }
  }
  const disconnectSandbox = () => {
    setToken(null)
    setPlatform(null)
    setSharedOverview(null)
    setSnapshotChange(null)
    snapshotsSeen.current={}
    setRevenue(null)
    setSpecialistReports({})
    setSpecialistErrors({})
    setDirectorReport(null)
    setBackendStatus("disconnected")
    setApiError("")
  }
  const platformStatus = (key: "bi" | "dataScience" | "agentic") => platform?.platforms[key].status ?? "unavailable"
  const hasPlatformPermission = (permission: PlatformContext["permissions"][number]) => platform?.permissions.includes(permission) ?? false
  const platformLabel = (key: "bi" | "dataScience", permission: PlatformContext["permissions"][number]) =>
    !platform ? "Non connectée" : hasPlatformPermission(permission) ? platformStatus(key) : "Accès refusé"
  const runDirector = async () => {
    if (!token) {
      setToast("Connectez le sandbox local avant de lancer une analyse Director.")
      return
    }
    if (directorObjective.trim().length < 5) {
      setToast("Décrivez une mission de 5 caractères minimum.")
      return
    }
    setDirectorBusy(true)
    setDirectorError("")
    try {
      const report = await fetchDirectorReport(token, directorObjective.trim(), agency, undefined, sharedFilters)
      setDirectorReport(report)
      track("AI Director", "Investigation read-only terminée", "director")
      setToast("Investigation Director terminée : aucun changement ERP.")
    } catch (error) {
      setDirectorReport(null)
      setDirectorError(error instanceof Error ? error.message : "Erreur d'analyse")
    } finally {
      setDirectorBusy(false)
    }
  }
  const addMission = () => {
    const title = newTitle.trim()
    if (title.length < 5) {
      setToast("Veuillez saisir un objectif d'au moins 5 caractères.")
      return
    }
    const id = "M-DEMO-" + Date.now().toString().slice(-7)
    setMissions((prev) => [{ id, title, objective: title, agent: newAgent, state: "a_planifier", priority: newPriority, progress: 0, deadline: "Non planifiée", steps: ["Cadrage", "Collecte", "Analyse", "Revue"] }, ...prev])
    setMissionId(id)
    setNewTitle("")
    setMissionModal(false)
    track("Mission créée", "Brouillon local", newAgent, id)
    setToast("Mission créée en mode démonstration. Aucune exécution réelle.")
    navigate("missions")
  }
  const updateDecision = (next: DecisionState) => {
    const previous = activeDecision
    setDecisions((list) => list.map((item) => item.id === previous.id ? { ...item, status: next } : item))
    track("Décision", decisionLabel[next] + " (démo)", previous.agent, previous.missionId)
    setToast("Décision modifiée dans l'interface de démonstration. Aucune écriture ERP.")
  }
  const readAlert = (item: Alert) => {
    setAlerts((list) => list.map((alert) => alert.id === item.id ? { ...alert, seen: true } : alert))
    setSelectedAgent(item.agent)
    navigate("agent", item.agent)
  }
  const sendChat = (event: FormEvent) => {
    event.preventDefault()
    const message = chatDraft.trim()
    if (!message) return
    const moment = timeNow()
    let answer = "Le moteur conversationnel de cet agent n'est pas encore connecté. Cette interface ne génère pas de conseils métiers fictifs."
    if (selectedAgent === "revenue" && revenue && backendStatus === "connected") {
      const top = revenue.opportunities.slice(0, 3)
      answer = top.length
        ? "Analyse déterministe sur " + revenue.snapshot.source + " (au " + revenue.snapshot.asOf + "). " + revenue.analysis.opportunitiesFound + " opportunité(s) identifiée(s). Priorités : " + top.map((op) => op.customerName + " [" + op.state + ", score " + op.priorityScore + "/100]").join("; ") + ". Le score est une heuristique, pas une probabilité. Consulter les preuves avant toute action."
        : "Aucune opportunité calculée sur le périmètre choisi. Source : " + revenue.snapshot.source + "."
    } else if (selectedAgent !== "revenue" && specialistReports[selectedAgent]) {
      const report = specialistReports[selectedAgent]
      const top = report.findings.slice(0, 3)
      answer = "Voici le dernier rapport déterministe disponible sur " + report.snapshot.source +
        " (au " + report.snapshot.asOf + "). " + report.findings.length +
        " élément(s) à examiner. " + (top.length ?
          top.map((f) => f.title + " : " + f.explanation).join("; ") :
          "Aucune alerte vérifiée dans la source actuelle.") +
        " Ce message résume le rapport disponible et ne constitue pas une réponse générative à votre question. Aucune action ERP n'est lancée."
    }
    const updated: ChatMessage[] = [{ role: "user", content: message, time: moment }, { role: "assistant", content: answer, time: moment }]
    setChats((prev) => ({ ...prev, [selectedAgent]: [...prev[selectedAgent], ...updated] }))
    setChatDraft("")
  }
  const missionDetail = (mission: Mission) => {
    setMissionId(mission.id)
    navigate("missions")
  }


  function sharedSnapshotPanel() {
    if (!sharedOverview) return token && sharedError
      ? <div className="no-connection" role="status">API analytique : {sharedError}</div>
      : null
    const x = sharedOverview
    return <section className="shared-global-kpis" data-platform-app="agentic"
      data-platform-snapshot={x.snapshotId} aria-label="Snapshot analytique commun">
      <div><strong>Snapshot partagé — BI / Data Science / Agentic</strong>
        <span>{x.snapshot.storage==="postgres"?"PostgreSQL partagé · révision "+x.snapshot.revision+" · ":"Source locale · "}{x.snapshot.source} · arrêté au {x.snapshot.asOf} · {x.snapshot.source.includes("IAINEG") ? "EXTRAITS PSEUDONYMISÉS · SQL NON RAPPROCHÉ · TND SEUL" : x.snapshot.isSynthetic ? "Données synthétiques" : "Source à vérifier"}</span></div>
      <div><small>CA HT · TND</small><b data-shared-kpi="revenue">{x.bi.data.revenue.toFixed(3)}</b></div>
      <div><small>Créances · TND</small><b data-shared-kpi="receivables">{x.snapshot.source.includes("Database/extractions")?"N/D":x.bi.data.receivables.toFixed(3)}</b></div>
      <div><small>Agence / Période</small><b>{x.scope === "*" ? "Toutes" : x.scope.join(", ")} · {period}</b></div>
    </section>
  }
  function platformsPage() {
    const src = portalTab === "bi" ? "/platform/bi/" : "/platform/ds/"
    return <>
      <UnifiedExperience overview={sharedOverview} agency={agency}
        from={sharedFilters.from} to={sharedFilters.to} connected={Boolean(token)}
        onNavigate={(target)=>target==="agentic"?navigate("missions"):setPortalTab(target)}/>
      <DecisionScenarioLab token={token} agency={agency} asOf={sharedOverview?.snapshot.asOf??""}
        from={sharedFilters.from} to={sharedFilters.to}/>
      <Card title="Accès unifié aux trois applications" action={<Pill tone={token ? "green" : "amber"}>{token ? "Session centrale ouverte" : "Session déconnectée"}</Pill>}>
        <p className="muted-text">Même origine, même identité et même période / agence. Les cartes API partagées ont la même source, tandis que les anciens graphiques locaux BI/DS restent clairement distincts et non certifiés ERP.</p>
        {!token && <label className="aw-identity">Identité de test
          <select aria-label="Identité sandbox" value={demoIdentity} onChange={e=>setDemoIdentity(e.target.value)}>
            <option value="admin">Administrateur — créateur</option>
            <option value="manager-sfax">Manager Sfax — approbateur</option>
            <option value="commercial-tunis">Commercial Tunis — accès limité</option>
          </select>
        </label>}
        <div className="horizontal-actions">
          {token ? <Action light icon="close" onClick={disconnectSandbox}>Déconnecter les 3 plateformes</Action>
            : <Action icon="link" onClick={connectSandbox}>Connecter la session sandbox</Action>}
          <Pill tone="gray">Jeton conservé dans le Command Center seulement</Pill>
        </div>
      </Card>
      <div className="platform-tabs" role="tablist" aria-label="Choisir la plateforme">
        <button type="button" role="tab" aria-selected={portalTab === "bi"}
          onClick={() => setPortalTab("bi")}>Data Analyse · BI</button>
        <button type="button" role="tab" aria-selected={portalTab === "ds"}
          onClick={() => setPortalTab("ds")}>Data Science · Studio</button>
      </div>
      <div className="platform-frame-wrap">
        <iframe key={src} ref={iframeRef} src={src}
          title={portalTab === "bi" ? "Data Analyse" : "Data Science"}
          sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
          onLoad={() => iframeRef.current?.contentWindow?.postMessage({
            type: "AI_NEGOCE_BRIDGE_STATE",
            revision: bridgeVersion.current,
            connected: Boolean(token),
            filters: sharedFilters,
          }, window.location.origin)}
        />
      </div>
    </>
  }
  function overview() {
    if (token) return <>
      <DecisionIntelligencePanel overview={sharedOverview} revenue={revenue}
        specialists={specialistReports} errors={specialistErrors} filters={sharedFilters}
        connected={backendStatus==="connected"} onOpenAgent={agent=>navigate("agent",agent)}/>
      <AdvancedOverview token={token} agency={agency} role={platform?.principal.role} from={sharedFilters.from} to={sharedFilters.to} onNavigate={(dest) => navigate(dest)}/>
      <Card title="AI Director — Coordination read-only" action={<Pill tone="blue">4 moteurs métier</Pill>}>
        <p className="card-sub">Les dossiers et événements en haut proviennent du backend. Aucune action ERP automatique.</p>
        {orchestrator()}
      </Card>
    </>
    return <>
      <div className="stats-row stats-five">
        <Stat icon="layers" label="Missions actives" value={missions.filter((m) => m.state === "en_cours").length} detail="Missions en exécution (démo)" />
        <Stat icon="check" label="Approbations en attente" value={pendingDecisions.length} detail="Validation humaine requise" />
        <Stat icon="target" label="Opportunités identifiées" value={revenue ? revenue.analysis.opportunitiesFound : "—"} detail={revenue ? "Source API sandbox" : "Source non connectée"} />
        <Stat icon="coins" label="Impact estimé (CA)" value={sampleImpact} detail="Calcul ERP à connecter" />
        <Stat icon="shield" label="Agents développés" value="4 / 4" detail="Moteurs déterministes en sandbox" />
      </div>
      <div className="overview-main">
        <div className="stack">
          <Card title="AI Director — Orchestrateur" action={<Pill tone="blue">MVP read-only</Pill>}>
            <p className="card-sub">Moteur de délégation déterministe et suivi supervisé, sans actions automatiques ERP.</p>
            {orchestrator()}
          </Card>
          <Card title="Mission active" action={<SmallLink onClick={() => missionDetail(activeMission)}>Voir la mission</SmallLink>}>
            <div className="mission-summary"><b>{activeMission.id} — {activeMission.title}</b><Pill tone={stateTone[activeMission.state]}>{statusLabel[activeMission.state]}</Pill></div>
            <Stepper steps={activeMission.steps} progress={activeMission.progress} />
          </Card>
          <Card title="Missions en cours" action={<SmallLink onClick={() => navigate("missions")}>Toutes les missions</SmallLink>}>
            {missionsTable(missions.slice(0, 5))}
          </Card>
        </div>
        <div className="stack">
          <Card title={"Décisions et approbations (" + pendingDecisions.length + ")"} action={<SmallLink onClick={() => navigate("decisions")}>Voir tout</SmallLink>}>
            {pendingDecisions.map((item) => <div key={item.id} className="decision-short">
              <Avatar agent={item.agent} /><div><b>{item.title}</b><small>Recommandé par {byAgent(item.agent).name} · {item.impact}</small></div>
              <button type="button" className="outline-mini" onClick={() => { setDecisionId(item.id); navigate("decisions") }}>Revoir</button>
            </div>)}
          </Card>
          <Card title="Connexions BI / Data Science" action={<SmallLink onClick={() => navigate("connections")}>Détails</SmallLink>}>
            <div className="connection-line"><Avatar agent="revenue" /><span><b>Data Analyse (BI)</b><small>Dataset commun et KPI gouvernés</small></span><Pill tone={platformStatus("bi")==="available"?"green":"gray"}>{platformStatus("bi")==="available"?"Connectée":"Indisponible"}</Pill></div>
            <div className="connection-line"><Icon name="spark" size={25} /><span><b>Data Science</b><small>Analyses connectées · prévision pilote non certifiée</small></span><Pill tone={platformStatus("dataScience")==="available"?"green":"gray"}>{platformStatus("dataScience")==="available"?"Connectée":"Indisponible"}</Pill></div>
            <div className="connection-line"><Icon name="database" size={25} /><span><b>Revenue Growth API</b><small>{backendStatus === "connected" ? "Sandbox opérationnel" : "Backend local"}</small></span><Pill tone={backendStatus === "connected" ? "green" : "gray"}>{backendStatus === "connected" ? "Connectée" : "Non connectée"}</Pill></div>
          </Card>
          <Card title="Notifications prioritaires" action={<SmallLink onClick={() => navigate("agents")}>Voir tout</SmallLink>}>
            {alerts.filter((n) => !n.seen).slice(0, 3).map((n) => <button type="button" className="alert-inline" key={n.id} onClick={() => readAlert(n)}>
              <span className={"alert-marker marker-" + priorityTone[n.priority]}><Icon name="bell" size={17} /></span><span><b>{n.title}</b><small>{byAgent(n.agent).name}</small></span><Icon name="chevron" size={16} />
            </button>)}
          </Card>
        </div>
      </div>
      <div className="sync-strip"><Icon name="history" size={18}/><b>Journal & synchronisation</b><span><i className="soft-dot" /> Design React actif</span><span><i className="soft-dot" /> Revenue Growth : {backendStatus === "connected" ? "Sandbox connecté" : "À connecter"}</span><span>BI & DS : intégration à réaliser</span></div>
    </>
  }
  function orchestrator() {
    return <div className="orchestrator"><div className="director-node" onClick={() => navigate("director")} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") navigate("director") }}><Icon name="layers" size={25} /><span><b>AI Director</b><small>Orchestration · Délégation · Arbitrage</small></span></div><div className="connector-line" /><div className="orchestrator-children">{agents.map((agent) => <button key={agent.id} type="button" className="agent-node" onClick={() => navigate("agent", agent.id)}><Icon name={agent.icon} size={26}/><strong>{agent.name}</strong><Pill tone={agent.implemented ? "green" : "gray"}>{agent.implemented ? "MVP disponible" : "À intégrer"}</Pill></button>)}</div></div>
  }
  function missionsTable(items: Mission[]) {
    return <div className="table-scroll"><table><thead><tr><th>Mission</th><th>Agent</th><th>Statut</th><th>Avancement</th><th>Échéance</th></tr></thead><tbody>{items.map((m) => <tr key={m.id} className="clickable-row" onClick={() => missionDetail(m)}><td><b>{m.id}</b><span className="cell-secondary">{m.title}</span></td><td>{byAgent(m.agent).name}</td><td><Pill tone={stateTone[m.state]}>{statusLabel[m.state]}</Pill></td><td><div className="progress-cell"><Progress value={m.progress} green={m.state === "terminee"} /><span>{m.progress} %</span></div></td><td>{m.deadline}</td></tr>)}</tbody></table></div>
  }
  function missionsPage() {
    return <>
      <div className="stats-row stats-five">
        <Stat icon="calendar" label="Planifiées" value={missions.filter((m) => m.state === "a_planifier").length} />
        <Stat icon="play" label="En cours" value={missions.filter((m) => m.state === "en_cours").length} />
        <Stat icon="check" label="Terminées" value={missions.filter((m) => m.state === "terminee").length} tone="green" />
        <Stat icon="alert" label="En revue" value={missions.filter((m) => m.state === "en_revue").length} tone="amber" />
        <Stat icon="target" label="Missions totales" value={missions.length} />
      </div>
      <div className="filter-bar"><label><Icon name="search" size={16}/><input aria-label="Rechercher une mission" placeholder="Rechercher une mission..." value={query} onChange={(e) => setQuery(e.target.value)} /></label><select aria-label="Filtrer par agent" value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}><option value="all">Tous les agents</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><select aria-label="Filtrer par statut" value={missionFilter} onChange={(e) => setMissionFilter(e.target.value)}><option value="all">Tous les statuts</option>{states.map((s) => <option key={s} value={s}>{statusLabel[s]}</option>)}</select><button className="text-link" onClick={() => { setQuery(""); setAgentFilter("all"); setMissionFilter("all") }}>Réinitialiser</button></div>
      <div className="missions-layout">
        <Card title={"Tableau des missions (" + filteredMissions.length + ")"} className="mission-board-card" action={<Pill tone="blue">Vue Kanban</Pill>}>
          <div className="kanban">
            {states.map((state) => <div className="kanban-column" key={state}><div className={"kanban-header kanban-" + state}><span>{statusLabel[state]}</span><strong>{filteredMissions.filter((m) => m.state === state).length}</strong></div>
              {filteredMissions.filter((m) => m.state === state).map((m) => <button type="button" key={m.id} className={"mission-tile " + (m.id === missionId ? "selected" : "")} onClick={() => setMissionId(m.id)}><div className="tile-top"><b>{m.id}</b><Pill tone={priorityTone[m.priority]}>{priorityLabel[m.priority]}</Pill></div><strong>{m.title}</strong><small>{byAgent(m.agent).name}</small><div className="tile-bottom"><span>{m.deadline}</span><span>{m.progress} %</span></div><Progress value={m.progress} green={m.state === "terminee"} /></button>)}
            </div>)}
          </div>
        </Card>
        <Card className="mission-detail" title={activeMission.id} action={<Pill tone={stateTone[activeMission.state]}>{statusLabel[activeMission.state]}</Pill>}>
          <div className="detail-highlight"><Icon name="target" size={23}/><div><b>Objectif</b><p>{activeMission.objective}</p></div></div>
          <h4>Agent responsable</h4><AgentLabel agent={activeMission.agent} />
          <h4>Étapes de la mission</h4><div className="stage-list">{activeMission.steps.map((step, index) => <div key={step} className="stage-row"><span className={"stage-bullet " + (index < activeMission.progress / 25 ? "on" : "")}>{index + 1}</span><span>{step}</span></div>)}</div>
          <h4>Avancement</h4><div className="progress-cell detail-progress"><Progress value={activeMission.progress}/><b>{activeMission.progress} %</b></div>
          <h4>Suivi et recommandations</h4><p className="muted-text">Cet écran présente un workflow de démonstration. Les étapes ne représentent pas une exécution ERP réelle.</p>
          <div className="horizontal-actions"><Action icon="message" onClick={() => navigate("agent", activeMission.agent)}>Parler à l'agent</Action><Action light icon="shield" onClick={() => navigate("decisions")}>Décisions liées</Action></div>
        </Card>
      </div>
      <Card title="Activité récente des missions" action={<SmallLink onClick={() => navigate("audit")}>Historique complet</SmallLink>}>
        <div className="table-scroll"><table><thead><tr><th>Date</th><th>Mission</th><th>Événement</th><th>Agent</th><th>Résultat</th></tr></thead><tbody>{audit.slice(0, 6).map((row) => <tr key={row.id}><td>{row.time}</td><td>{row.missionId}</td><td>{row.action}</td><td>{row.agent === "director" ? "AI Director" : byAgent(row.agent).name}</td><td>{row.result}</td></tr>)}</tbody></table></div>
      </Card>
    </>
  }
  function agentsPage() {
    return <>
      {token&&<DecisionIntelligencePanel overview={sharedOverview} revenue={revenue}
        specialists={specialistReports} errors={specialistErrors} filters={sharedFilters}
        connected={backendStatus==="connected"} onOpenAgent={agent=>navigate("agent",agent)}/>}
      <div className="stats-row stats-four">
        <Stat icon="layers" label="Agents développés" value="4 / 4" detail="Quatre moteurs métier read-only" />
        <Stat icon="bell" label="Alertes ouvertes" value={unread} detail="Notifications illustratives" tone="amber" />
        <Stat icon="document" label="Décisions à revoir" value={pendingDecisions.length} />
        <Stat icon="layers" label="Escalades vers AI Director" value={directorReport?.summary.agentsInvoked ?? "—"} detail="Dernière investigation Director" />
      </div>
      <div className="agents-layout">
        <div className="agent-grid">
          {agents.map((agent) => <Card key={agent.id} className={"agent-card " + (selectedAgent === agent.id ? "agent-selected" : "")}>
            <div className="agent-card-top"><Avatar agent={agent.id} size="large"/><Pill tone={agent.implemented ? "green" : "gray"}>{agent.implemented ? "MVP disponible" : "À intégrer"}</Pill></div>
            <h3>{agent.name}</h3><p>{agent.description}</p>
            <div className="agent-stat"><span>Dernière exécution</span><b>{agent.id === "revenue" ? (revenue?.snapshot.asOf ?? "Non disponible") : (specialistReports[agent.id]?.snapshot.asOf ?? "Non disponible")}</b></div>
            <div className="agent-stat"><span>Notifications (démo)</span><Pill tone="amber">{alerts.filter((n) => n.agent === agent.id && !n.seen).length}</Pill></div>
            <div className="agent-stat"><span>Service API</span><b>{agent.id === "revenue" ? (backendStatus === "connected" ? "Sandbox connecté" : "Non connecté") : (specialistReports[agent.id] ? "Sandbox connecté" : "Non connecté")}</b></div>
            <div className="agent-buttons"><Action icon="message" onClick={() => navigate("agent", agent.id)}>Parler</Action><Action icon="chart" light onClick={() => { setSelectedAgent(agent.id); navigate("agent", agent.id) }}>Suivre</Action></div>
          </Card>)}
        </div>
        <Card title="Vue rapide de l'agent sélectionné"><div className="selected-agent-top"><Avatar agent={selectedAgent} size="large"/><div><h3>{byAgent(selectedAgent).name}</h3><span>{byAgent(selectedAgent).subtitle}</span></div></div><div className="detail-highlight"><Icon name="document"/><div><b>Résumé</b><p>{byAgent(selectedAgent).description}</p></div></div><div className="detail-highlight"><Icon name="shield"/><div><b>État de l'intégration</b><p>{selectedAgent === "revenue" ? "Moteur Revenue Growth disponible en lecture seule." : "Moteur déterministe disponible en lecture seule ; connexion API locale requise."}</p></div></div><h4>Prochaine action suggérée</h4><button className="suggested-action" onClick={() => navigate("agent", selectedAgent)}>Ouvrir le dossier de {byAgent(selectedAgent).name} <Icon name="chevron" size={16} /></button><h4>Notifications</h4>{selectedNotifications.slice(0, 2).map((n) => <div key={n.id} className="small-notice">{n.title}</div>)}</Card>
      </div>
      <Card title="Flux de recommandations" action={<span className="muted-text small">Suggestions illustratives</span>}>
        <div className="table-scroll"><table><thead><tr><th>Date / Heure</th><th>Agent</th><th>Notification</th><th>Priorité</th><th>Statut</th><th /></tr></thead><tbody>{alerts.map((n) => <tr key={n.id}><td>{n.timestamp}</td><td><AgentLabel agent={n.agent}/></td><td><b>{n.title}</b><span className="cell-secondary">{n.detail}</span></td><td><Pill tone={priorityTone[n.priority]}>{priorityLabel[n.priority]}</Pill></td><td><Pill tone={n.seen ? "gray" : "green"}>{n.seen ? "Lue" : "À traiter"}</Pill></td><td><button aria-label={"Voir " + n.title} className="icon-button" onClick={() => readAlert(n)}><Icon name="chevron" /></button></td></tr>)}</tbody></table></div>
      </Card>
    </>
  }
  function agentPage() {
    const a = byAgent(selectedAgent)
    const reportMatches=(period?:{from:string|null;to:string|null})=>period?.from===sharedFilters.from&&period?.to===sharedFilters.to
    const revenueResult = selectedAgent === "revenue" && reportMatches(revenue?.snapshot.period) ? revenue : null
    const specialist = selectedAgent === "revenue" ? null :
      reportMatches(specialistReports[selectedAgent]?.snapshot.period)?specialistReports[selectedAgent]:null
    const specialistError = selectedAgent === "revenue" ? null : specialistErrors[selectedAgent]
    const opportunities = revenueResult?.opportunities ?? []
    const findings = specialist?.findings ?? []
    const trendMonths=sharedOverview?.insights?.months??[]
    const metricEntries = specialist ? Object.entries(specialist.metrics).slice(0, 4) : []
    const source = specialist?.snapshot.source ?? revenueResult?.snapshot.source
    const asOf = specialist?.snapshot.asOf ?? revenueResult?.snapshot.asOf
    return <>
      <div className="agent-page-head">
        <Avatar agent={selectedAgent} size="large"/>
        <div><h1>{a.name} Agent</h1><p>{a.description}</p></div>
        <Pill tone="green">Moteur read-only</Pill>
        <Action light icon="layers" onClick={() => navigate("director")}>Voir AI Director</Action>
        <Action icon="plus" onClick={() => token ? navigate("missions") : (setNewAgent(selectedAgent),setMissionModal(true))}>Créer une mission</Action>
      </div>
      <div className="agent-detail-grid">
        {token ? <AdvancedAgentChat token={token} agency={agency} from={sharedFilters.from} to={sharedFilters.to} agent={AGENT_DOMAIN[selectedAgent]}/> : <Card className="chat-card" title={"Conversation — " + a.name} action={<Pill tone="gray">Rapport guidé · Non LLM</Pill>}>
          <div className="chat-messages">{chats[selectedAgent].map((m, i) =>
            <div key={i} className={"chat-message " + m.role}>
              <div className="chat-avatar">{m.role === "user" ? "VO" : <Icon name={a.icon} size={16}/>}</div>
              <div className="chat-bubble"><div className="chat-byline">{m.role === "user" ? "Vous" : a.name + " · Interface"}<span>{m.time}</span></div><p>{m.content}</p></div>
            </div>
          )}</div>
          <form className="chat-input" onSubmit={sendChat}>
            <input value={chatDraft} onChange={(e) => setChatDraft(e.target.value)} placeholder={"Demandez le dernier rapport à " + a.name + "..."} aria-label={"Message à " + a.name}/>
            <button type="submit" aria-label="Envoyer"><Icon name="send" size={18}/></button>
          </form>
          <div className="chat-disclaimer">Le chat reprend les rapports métier calculés par les APIs : aucune conversation LLM autonome n'est encore active.</div>
        </Card>}
        <div className="stack">
          <Card title={"Analyse — " + a.category} action={<Pill tone={source ? "blue" : "gray"}>{source ? "API sandbox" : "À connecter"}</Pill>}>
            <div className="mini-stats">
              {selectedAgent === "revenue" ? <>
                <div><span>Clients analysés</span><b>{revenueResult?.analysis.customersAnalyzed ?? "—"}</b></div>
                <div><span>En croissance</span><b>{revenueResult ? opportunities.filter((o)=>o.state==="growing").length : "—"}</b></div>
                <div><span>Opportunités</span><b>{revenueResult?.analysis.opportunitiesFound ?? "—"}</b></div>
                <div><span>Impact validé</span><b>—</b></div>
              </> : specialist ? metricEntries.map(([key,value]) =>
                <div key={key}><span>{key.replace(/([A-Z])/g, " $1")}</span><b>{value === null || specialist.status==="no_data" ? "N/D" : typeof value === "number" ? value.toLocaleString("fr-FR",{maximumFractionDigits:3}) : String(value)}</b></div>
              ) : <>
                <div><span>Rapport</span><b>—</b></div><div><span>Mission</span><b>—</b></div>
                <div><span>Actions</span><b>—</b></div><div><span>Source</span><b>—</b></div>
              </>}
            </div>
            {source
              ? <p className="source-note"><Icon name="database" size={15}/> Source : {source} · arrêté au {asOf} · période : {sharedFilters.from} → {sharedFilters.to} · lecture seule</p>
              : <div className="no-connection"><Icon name="alert" size={18}/> {specialistError ?? "Connectez le sandbox pour interroger ce spécialiste."}</div>}
          </Card>
          <Card title="Évolution du CA HT — données BI synchronisées">
            {trendMonths.length?
              <div className="table-scroll" data-agentic-period-chart={sharedOverview?.snapshotId}>
                <table><thead><tr><th>Mois</th><th>CA HT · TND</th><th>Période complète</th></tr></thead>
                  <tbody>{trendMonths.map(m=><tr key={m.month}>
                    <td>{m.month}</td><td>{m.revenue.toLocaleString("fr-FR",{minimumFractionDigits:3,maximumFractionDigits:3})}</td>
                    <td>{m.closed?"Oui":"Partielle"}</td>
                  </tr>)}</tbody>
                </table>
                <p className="source-note">Snapshot : {sharedOverview?.snapshotId} · source : {sharedOverview?.snapshot.source}</p>
              </div>:
              token?<Empty icon="database" title="Aucune vente sur la période" text="Aucune courbe de démonstration n'est substituée aux données filtrées."/>:
              <MiniChart/>}
          </Card>
          <Card title={selectedAgent === "revenue" ? "Opportunités calculées" : "Recommandations vérifiables"}
            action={<Pill tone="gray">{selectedAgent === "revenue" ? opportunities.length : findings.length} éléments</Pill>}>
            {selectedAgent === "revenue" && opportunities.length > 0
              ? <div className="table-scroll"><table><thead><tr><th>Client</th><th>Situation</th><th>CA période (TND)</th><th>Évolution</th><th>Priorité</th></tr></thead>
                <tbody>{opportunities.slice(0,10).map((o) => <tr key={o.agency+o.customerId}><td><b>{o.customerName}</b><span className="cell-secondary">{o.agency}</span></td><td><Pill tone={o.state==="growing"?"green":o.state==="dormant"?"amber":"blue"}>{o.state}</Pill></td><td>{o.metrics.currentRevenueTnd.toLocaleString("fr-FR",{minimumFractionDigits:3})}</td><td>{o.metrics.growthPercent===null?"N/D":o.metrics.growthPercent+" %"}</td><td><Pill tone="blue">{o.priorityScore}/100</Pill></td></tr>)}</tbody></table></div>
              : specialist && findings.length > 0
                ? <div className="agentic-findings">{findings.map((item)=><article key={item.id} className="recommendation"><div className="recommendation-top"><Icon name="target" size={18}/><b>{item.title}</b><Pill tone={item.priority==="high"?"red":item.priority==="medium"?"amber":"blue"}>{item.priority}</Pill></div><p>{item.explanation}</p><div className="evidence-items">{item.evidence.slice(0,5).map((e,i)=><span key={e.id+i}><Icon name="document" size={14}/>{e.type} · {e.id}</span>)}</div><p className="source-note">Action : {item.action.type} · Brouillon · Validation humaine obligatoire</p></article>)}</div>
                : <Empty icon="database" title="Aucun résultat exploitable" text={source ? "Aucune recommandation calculée sur cette source et ce périmètre." : "Connectez le sandbox pour lire l'API de cet agent."}/>}
          </Card>
          {source && <SpecialistDecisionSupport agent={selectedAgent}
            support={selectedAgent==="revenue"?revenueResult?.decisionSupport:specialist?.decisionSupport}
            source={source} from={sharedFilters.from} to={sharedFilters.to}
            snapshotId={sharedOverview?.snapshotId}/>}
          {specialist && <Card title="Scénarios de sensibilité">{specialist.scenarios.length ? specialist.scenarios.map((scenario)=>
            <div className="decision-short" key={scenario.id}><Avatar agent={selectedAgent}/><div><b>{scenario.label}</b><small>{scenario.assumption}</small></div><Pill tone="blue">{scenario.valueTnd===null?"N/D":scenario.valueTnd.toLocaleString("fr-FR",{minimumFractionDigits:3})+" TND"}</Pill></div>
          ) : <Empty title="Aucun scénario" text="Pas d'hypothèse validée pour cette analyse."/>}<p className="muted-text small">Hypothèses de calcul, pas de prévision ni d'engagement financier.</p></Card>}
          {specialist && <Card title="Réserves et conditions">{specialist.warnings.map((warning,index)=><div key={index} className="governance-row"><Icon name="alert" size={16}/><div><small>{warning}</small></div></div>)}</Card>}
          <Card title="Missions liées">{missions.filter((m) => m.agent===selectedAgent).map((m)=><div key={m.id} className="related-mission" onClick={() => missionDetail(m)} role="button" tabIndex={0} onKeyDown={(e)=>{if(e.key==="Enter")missionDetail(m)}}><span><b>{m.id}</b><small>{m.title}</small></span><div><Progress value={m.progress}/><small>{m.progress} %</small></div><Icon name="chevron" size={16}/></div>)}</Card>
        </div>
        <div className="stack">
          <Card title="Actions suggérées" action={<Pill tone="amber">Revue humaine</Pill>}>
            {alerts.filter((n) => n.agent===selectedAgent).map((n)=><div key={n.id} className="recommendation">
              <div className="recommendation-top"><Icon name="target" size={18}/><b>{n.title}</b><Pill tone={priorityTone[n.priority]}>{priorityLabel[n.priority]}</Pill></div>
              <p>{n.detail}</p><div className="recommendation-actions"><Action icon="plus" onClick={()=>{setNewAgent(selectedAgent);setNewTitle(n.title);setMissionModal(true)}}>Créer une mission</Action><Action light icon="check" onClick={()=>setAlerts(prev=>prev.map(x=>x.id===n.id?{...x,seen:true}:x))}>Marquer lue</Action></div>
            </div>)}
          </Card>
          <Card title="Notification & suivi"><div className="notification-settings"><div><Icon name="bell" size={19}/><b>Alertes de cet agent</b></div><strong>{selectedNotifications.filter((n)=>!n.seen).length}</strong></div><p className="muted-text">Les notifications visibles sont des maquettes. L'envoi réel exige un worker, une persistence et des canaux d'envoi.</p><Action light icon="history" onClick={()=>navigate("audit")}>Voir l'historique</Action></Card>
        </div>
      </div>
    </>
  }
  function directorPage() {
    return <>
      {token && <AdvancedAgentChat token={token} agency={agency} from={sharedFilters.from} to={sharedFilters.to} agent="director"/>}
      <Card title="Lancer une investigation multi-agents" icon="layers" action={<Pill tone={directorReport ? "green" : "blue"}>{directorReport ? "Rapport calculé" : "Mode read-only"}</Pill>}>
        <div className="director-investigation">
          <label htmlFor="director-objective">Objectif métier</label>
          <textarea id="director-objective" className="director-objective" rows={2} maxLength={500}
            value={directorObjective} onChange={(e)=>setDirectorObjective(e.target.value)}
            placeholder="Ex. Analyse les clients à relancer, les créances et les ruptures de stock"/>
          <div className="horizontal-actions">
            <Action icon="play" disabled={!token || directorBusy} onClick={runDirector}>{directorBusy ? "Analyse en cours..." : "Analyser avec AI Director"}</Action>
            {!token && <Action icon="database" light onClick={()=>navigate("connections")}>Connecter le sandbox</Action>}
            <Pill tone="gray">Lecture seule · 4 spécialistes · aucune action ERP</Pill>
          </div>
        </div>
        {directorError && <div className="error-banner">{directorError}</div>}
        {directorReport && <>
          <p className="source-note"><Icon name="database" size={15}/> Source : {directorReport.snapshot.source} · arrêté au {directorReport.snapshot.asOf} · période : {sharedFilters.from} → {sharedFilters.to} · périmètre : {directorReport.snapshot.scope === "*" ? "toutes les agences" : directorReport.snapshot.scope.join(", ")}</p>
          <div className="stats-row stats-four director-result-stats">
            <Stat icon="layers" label="Agents sollicités" value={directorReport.summary.agentsInvoked}/>
            <Stat icon="target" label="Constats" value={directorReport.summary.totalFindings}/>
            <Stat icon="shield" label="Revues humaines" value={directorReport.summary.requiresHumanReview ? "Requises" : "—"}/>
            <Stat icon="check" label="Écritures ERP" value="0" detail="Read-only"/>
          </div>
          <div className="director-result-grid">
            <div className="stack">
              <Card title="Plan de délégation confirmé">
                <div className="table-scroll"><table><thead><tr><th>Étape</th><th>Agent</th><th>Exécution</th><th>Résultat</th></tr></thead><tbody>{directorReport.plan.map((step)=><tr key={step.agent}><td>{step.step}</td><td>{step.agent.replace(/_/g," ")}</td><td><Pill tone="green">Read-only</Pill></td><td>{directorReport.sections.find((r)=>r.agent===step.agent)?.status==="ok"?"Analysé":"Données absentes"}</td></tr>)}</tbody></table></div>
              </Card>
              <Card title="Constats priorisés">
                {directorReport.highlights.length ? directorReport.highlights.map((item)=><div className="recommendation" key={item.agent+item.id}><div className="recommendation-top"><Icon name="target" size={18}/><b>{item.title}</b><Pill tone={item.priority==="high"?"red":item.priority==="medium"?"amber":"blue"}>{item.priority}</Pill></div><p>{item.explanation}</p><div className="evidence-items">{item.evidence.slice(0,4).map((e,i)=><span key={e.id+i}><Icon name="document" size={14}/>{e.agency} · {e.id}</span>)}</div><p className="source-note">Spécialiste : {item.agent.replace(/_/g," ")} · Brouillon / validation humaine</p></div>)
                : <Empty title="Aucun constat" text="Les données disponibles ne permettent pas de prioriser une action."/>}
              </Card>
            </div>
            <Card title="Contrôles & limites">
              {directorReport.decisionDossier && <div data-director-decision-dossier={directorReport.decisionDossier.snapshotRevision??"local"}>
                <h4>Dossier transverse · arrêté {directorReport.decisionDossier.dataAsOf}</h4>
                <p className="source-note">Révision PostgreSQL : {directorReport.decisionDossier.snapshotRevision??"N/D"} · revue humaine obligatoire</p>
                {directorReport.decisionDossier.domainCoverage.map(d=>
                  <div className="governance-row" key={d.agent}><Icon name={d.status==="ok"?"check":"alert"} size={16}/>
                    <div><b>{d.agent.replace(/_/g," ")}</b><small>{d.findings} constats · {d.evidenceCount} preuve(s) · {d.status}</small></div></div>)}
                <h4>Vérifications avant approbation</h4>
                {directorReport.decisionDossier.unresolvedDependencies.map((d,i)=>
                  <div className="governance-row" key={i}><Icon name="alert" size={16}/><div><small>{d}</small></div></div>)}
              </div>}
              {directorReport.warnings.map((w,i)=><div className="governance-row" key={i}><Icon name="alert" size={17}/><div><small>{w}</small></div></div>)}
              <p className="muted-text">Les rapports des spécialistes partagent le snapshot BI/DS. Cette investigation reste en lecture seule ; les missions et validations persistantes sont gérées dans le workspace serveur. Aucun write-back ERP.</p>
            </Card>
          </div>
        </>}
      </Card>
      <div className="stats-row stats-four">
        <Stat icon="layers" label="Agents coordonnables" value="4" detail="4 moteurs déterministes read-only" />
        <Stat icon="calendar" label="Missions enregistrées" value={missions.length} />
        <Stat icon="shield" label="Décisions en revue" value={pendingDecisions.length} />
        <Stat icon="alert" label="Blocages d'intégration" value="3" tone="amber" detail="BI, DS, ERP réel" />
      </div>
      <div className="director-grid">
        <div className="stack">
          <Card title="Orchestration des agents — Délégation et coordination" action={<Pill tone="blue">Moteur API disponible</Pill>}>{orchestrator()}</Card>
          <Card title="Planification de mission" action={<Action light icon="plus" onClick={() => setMissionModal(true)}>Nouvelle mission</Action>}>
            <p className="muted-text">Les missions ci-dessous sont des exemples visuels. Le plan API confirmé apparaît en haut après exécution.</p>
            <div className="director-work"><div><Icon name="target" /><span><b>{activeMission.id} — {activeMission.title}</b><small>Priorité : {priorityLabel[activeMission.priority]} · Progression : {activeMission.progress} %</small></span></div><Progress value={activeMission.progress}/></div>
            <div className="table-scroll"><table><thead><tr><th>Étape</th><th>Agent</th><th>Statut</th><th>Avancement</th></tr></thead><tbody>{agents.map((a, i) => <tr key={a.id}><td>{["Analyse clients", "Projection financière", "Évaluation stocks", "Arbitrage stratégique"][i]}</td><td><AgentLabel agent={a.id}/></td><td><Pill tone={a.implemented ? "green" : "gray"}>{a.implemented ? "MVP" : "À intégrer"}</Pill></td><td>{a.implemented ? "API disponible" : "Non exécutée"}</td></tr>)}</tbody></table></div>
          </Card>
        </div>
        <div className="stack">
          <Card title="Synthèse du Director" action={<Pill tone="blue">Orchestration read-only</Pill>}><div className="detail-highlight"><Icon name="target" size={22}/><div><b>Prochaine action recommandée</b><p>Les quatre Agents calculent des constats en lecture seule. Les validations et actions ERP exigent encore un backend de décisions persistant.</p></div></div><div className="check-list"><p><Icon name="check" size={17}/> Revenue Growth, Financial, Supply Chain, Business : API disponibles</p><p><Icon name="check" size={17}/> Interface de pilotage React créée</p><p><Icon name="clock" size={17}/> AI Director : orchestration read-only implémentée</p><p><Icon name="clock" size={17}/> Actions métier et notifications persistantes à développer</p></div><div className="horizontal-actions"><Action icon="plus" onClick={() => setMissionModal(true)}>Créer un plan</Action><Action light icon="document" onClick={() => navigate("decisions")}>Décisions</Action></div></Card>
          <Card title="Arbitrages en attente">{pendingDecisions.slice(0, 3).map((d) => <button key={d.id} type="button" className="alert-inline" onClick={() => { setDecisionId(d.id); navigate("decisions") }}><span className="alert-marker marker-amber"><Icon name="alert" size={17}/></span><span><b>{d.title}</b><small>{d.risk} · {byAgent(d.agent).name}</small></span><Icon name="chevron" size={16}/></button>)}</Card>
          <Card title="Demandes à traiter"><button className="director-request" onClick={() => setMissionModal(true)}><Icon name="target"/><span><b>Lancer une investigation</b><small>Créer une mission pour l'agent adapté</small></span><Icon name="chevron"/></button></Card>
        </div>
      </div>
    </>
  }
  function decisionsPage() {
    return <>
      <div className="stats-row stats-four">
        <Stat icon="layers" label="Approbations en attente" value={pendingDecisions.length} />
        <Stat icon="check" label="Approuvées (démo)" value={decisions.filter((d) => d.status === "approved").length} tone="green" />
        <Stat icon="close" label="Refusées (démo)" value={decisions.filter((d) => d.status === "rejected").length} tone="red" />
        <Stat icon="coins" label="Impact validé (CA)" value="—" detail="Chiffres ERP non vérifiés" />
      </div>
      <div className="decisions-layout">
        <div className="stack">
          <Card title={"Boîte de décisions à examiner (" + pendingDecisions.length + ")"} action={<Pill tone="gray">Validation locale · Démo</Pill>}>
            <div className="table-scroll"><table><thead><tr><th>Décision</th><th>Agent</th><th>Impact</th><th>Urgence</th><th>Statut</th></tr></thead><tbody>{decisions.map((d) => <tr key={d.id} className={"clickable-row " + (d.id === decisionId ? "row-selected" : "")} onClick={() => setDecisionId(d.id)}><td><b>{d.title}</b><span className="cell-secondary">{d.id}</span></td><td>{byAgent(d.agent).name}</td><td>{d.impact}</td><td><Pill tone={priorityTone[d.priority]}>{priorityLabel[d.priority]}</Pill></td><td><Pill tone={decisionTone[d.status]}>{decisionLabel[d.status]}</Pill></td></tr>)}</tbody></table></div>
          </Card>
          <Card title="Activité récente">{audit.filter((a) => a.action === "Décision").length ? audit.filter((a) => a.action === "Décision").slice(0, 5).map((a) => <div className="audit-short" key={a.id}><Icon name="check"/><span>{a.result}</span><small>{a.time}</small></div>) : <Empty icon="history" title="Aucune décision locale enregistrée" text="Les actions dans cet écran seront visibles ici et dans l'audit de démonstration."/>}</Card>
        </div>
        <Card className="decision-detail" title={activeDecision.title} action={<Pill tone={decisionTone[activeDecision.status]}>{decisionLabel[activeDecision.status]}</Pill>}>
          <div className="detail-tabs"><span className="tab-active">Détail</span><span>Évidences ({activeDecision.evidence.length})</span><span>Impacts & risques</span></div>
          <div className="detail-highlight"><Icon name="target" size={23}/><div><b>Justification</b><p>{activeDecision.rationale}</p></div></div>
          <div className="decision-facts"><div><span>Impact estimé</span><strong>{activeDecision.impact}</strong></div><div><span>Risque</span><strong>{activeDecision.risk}</strong></div><div><span>Priorité</span><strong>{priorityLabel[activeDecision.priority]}</strong></div></div>
          <h4>Éléments à vérifier</h4><div className="evidence-items">{activeDecision.evidence.map((e) => <span key={e}><Icon name="document" size={14}/>{e}</span>)}</div>
          <h4>Mission liée</h4><button type="button" className="related-link" onClick={() => { setMissionId(activeDecision.missionId); navigate("missions") }}><Icon name="layers"/>{activeDecision.missionId} <Icon name="chevron" size={14}/></button>
          <div className="decision-note"><Icon name="alert" size={19}/> Les boutons ci-dessous changent uniquement le statut de la maquette. Aucun achat, paiement, facture ni message ERP n'est déclenché.</div>
          <div className="decision-actions"><Action icon="check" onClick={() => updateDecision("approved")}>Approuver (démo)</Action><Action light icon="history" onClick={() => updateDecision("review")}>À revoir</Action><button type="button" className="action-danger" onClick={() => updateDecision("rejected")}><Icon name="close" size={17}/> Refuser</button></div>
        </Card>
      </div>
    </>
  }
  function connectionsPage() {
    return <>
      <div className="stats-row stats-four">
        <Stat icon="database" label="Sources ERP réelles" value="0" detail="Adaptateur LAI non configuré" />
        <Stat icon="check" label="APIs Agentic" value={backendStatus === "connected" ? "1" : "0"} detail="Sandbox de test uniquement" tone={backendStatus === "connected" ? "green" : "blue"} />
        <Stat icon="check" label="Plateformes analytiques connectées" value={platformStatus("bi")==="available"&&platformStatus("dataScience")==="available"?"2 / 2":"À vérifier"} detail="BI + Data Science · snapshot commun" tone="blue" />
        <Stat icon="layers" label="Modèles DS validés" value="—" detail="Catalogue non connecté" />
      </div>
      <div className="connections-grid">
        <Card title="Data Analyse (BI)" icon="chart"><div className="integration-header"><Avatar agent="revenue" size="large"/><div><b>Dashboard Data Analyse</b><p>Tableaux de bord et métriques métier</p></div><Pill tone={platformStatus("bi") === "available" ? "green" : "gray"}>{platformLabel("bi", "analytics.bi.read")}</Pill></div><div className="health-grid"><div><span>Contrat</span><b>{platform?.contractVersion ?? "—"}</b></div><div><span>Périmètre</span><b>{platform?.principal.agencies === "*" ? "Toutes agences" : platform?.principal.agencies.join(", ") || "—"}</b></div><div><span>Statut</span><b>{platform ? platformStatus("bi") : "Non connectée"}</b></div><div><span>Permission</span><b>{platform ? hasPlatformPermission("analytics.bi.read") ? "Lecture" : "Absente" : "—"}</b></div></div><p className="muted-text">Les données restent soumises au tenant et au périmètre agence vérifiés par le serveur.</p></Card>
        <Card title="Data Science" icon="spark"><div className="integration-header"><Icon name="spark" size={36}/><div><b>Dashboard Data Science</b><p>Calculs serveur communs · prévision pilote</p></div><Pill tone={platformStatus("dataScience")==="available"?"green":"gray"}>{platformLabel("dataScience", "analytics.ds.read")}</Pill></div><div className="health-grid"><div><span>API</span><b>{platform ? platformStatus("dataScience") : "Non connectée"}</b></div><div><span>Modèles servis</span><b>{platform?.platforms.dataScience.modelServingVerified ? "Vérifiés" : "Aucun"}</b></div><div><span>Backtest pilote</span><b>{sharedOverview?.dataScience.analysis?.forecast.backtest.holdoutMonths ?? "N/D"} mois</b></div><div><span>Prévision API</span><b>{sharedOverview?.dataScience.analysis?.forecast.status ?? "N/D"}</b></div></div><p className="muted-text">Les analyses Data Science utilisent le même snapshot que BI et Agentic. Le modèle de prévision reste expérimental, avec abstention si l'historique est insuffisant. Aucun modèle n'est certifié production.</p></Card>
        <Card title="Agentic Backend — Revenue Growth" icon="layers"><div className="integration-header"><Avatar agent="revenue" size="large"/><div><b>API gouvernée de démonstration</b><p>Express · RBAC · Isolation agence</p></div><Pill tone={backendStatus === "connected" ? "green" : backendStatus === "error" ? "red" : "gray"}>{backendStatus === "connected" ? "Connectée" : backendStatus === "loading" ? "Connexion..." : "Déconnectée"}</Pill></div><p className="muted-text">Testez la connexion uniquement sur votre poste local avec AUTH_MODE=local-dev. Les jetons restent en mémoire dans le navigateur parent. Pour une approbation, déconnectez le créateur et reconnectez le rôle Manager Sfax.</p>
        {!token && <label className="aw-identity">Identité de test
          <select aria-label="Identité sandbox" value={demoIdentity} onChange={e=>setDemoIdentity(e.target.value)}>
            <option value="admin">Administrateur — créateur</option>
            <option value="manager-sfax">Manager Sfax — approbateur</option>
            <option value="commercial-tunis">Commercial Tunis — accès limité</option>
          </select>
        </label>}
        {apiError && <div className="error-banner">{apiError}</div>}<div className="horizontal-actions">{backendStatus === "connected" ? <Action icon="close" light onClick={disconnectSandbox}>Déconnecter</Action> : <Action icon="link" onClick={connectSandbox} disabled={backendStatus === "loading"}>Connecter sandbox local</Action>}<Action light icon="chart" onClick={() => navigate("agent", "revenue")}>Ouvrir Revenue Growth</Action></div></Card>
        <Card title="Qualité et gouvernance" icon="shield"><div className="governance-row"><Icon name="check" size={18}/><div><b>Données de démonstration identifiées</b><small>Jamais présentées comme données de production</small></div></div><div className="governance-row"><Icon name="check" size={18}/><div><b>Approbation humaine obligatoire</b><small>Les écritures ERP sont désactivées depuis ce dashboard</small></div></div><div className="governance-row"><Icon name="clock" size={18}/><div><b>Connexions inter-plateformes</b><small>Auth SSO, APIs, erreurs et métriques à implémenter</small></div></div></Card>
      </div>
      <Card title="Pipelines de modèles et sources" action={<Pill tone="gray">À connecter</Pill>}><div className="table-scroll"><table><thead><tr><th>Service</th><th>Rôle</th><th>Dernière synchronisation</th><th>Statut</th></tr></thead><tbody>{[["BI 360°","KPI partagés",sharedOverview?.snapshot.asOf ?? "—"],["Data Science","Calculs descriptifs + pilote",sharedOverview?.dataScience.analysis?.asOf ?? "—"],["ERP LAI","Transactions métier","—"],["Revenue Growth","Analyse déterministe",revenue?.snapshot.asOf ?? "—"]].map((row, i) => <tr key={row[0]}><td><b>{row[0]}</b></td><td>{row[1]}</td><td>{row[2]}</td><td><Pill tone={(i===0&&platformStatus("bi")==="available")||(i===1&&platformStatus("dataScience")==="available")||(i===3&&backendStatus==="connected")?"green":"gray"}>{(i===0&&platformStatus("bi")==="available")||(i===1&&platformStatus("dataScience")==="available")||(i===3&&backendStatus==="connected")?"Sandbox actif":"À intégrer"}</Pill></td></tr>)}</tbody></table></div></Card>
    </>
  }
  function auditPage() {
    return <>
      <div className="stats-row stats-four">
        <Stat icon="layers" label="Événements affichés" value={audit.length} detail="Démonstration locale" />
        <Stat icon="check" label="Décisions approuvées" value={decisions.filter((d) => d.status === "approved").length} />
        <Stat icon="history" label="Missions créées" value={missions.length - initialMissions.length} />
        <Stat icon="alert" label="Événements ERP prouvés" value="0" detail="Aucun write-back" tone="amber" />
      </div>
      <div className="audit-layout">
        <Card title="Journal des événements" action={<span className="muted-text small">Trace locale UI uniquement</span>}><div className="table-scroll"><table><thead><tr><th>Date / heure</th><th>Action</th><th>Acteur</th><th>Agent</th><th>Mission</th><th>Résultat</th></tr></thead><tbody>{audit.map((entry) => <tr key={entry.id}><td>{entry.time}</td><td><Pill tone="blue">{entry.action}</Pill></td><td>{entry.actor}</td><td>{entry.agent === "director" ? "AI Director" : byAgent(entry.agent).name}</td><td>{entry.missionId}</td><td>{entry.result}</td></tr>)}</tbody></table></div></Card>
        <Card title="Traçabilité & conformité"><div className="detail-highlight"><Icon name="shield"/><div><b>Audit du backend</b><p>Le backend existant journalise les investigations Revenue Growth avec l'identité, le périmètre et les volumes analysés.</p></div></div><div className="detail-highlight"><Icon name="document"/><div><b>Audit du frontend</b><p>Les événements affichés ci-contre sont uniquement des interactions locales de démonstration, sans valeur probante serveur.</p></div></div><div className="detail-highlight"><Icon name="lock"/><div><b>Pour la production</b><p>Conserver les missions, approbations et notifications côté serveur avec ID, horodatage, version et preuves.</p></div></div></Card>
      </div>
    </>
  }
  function settingsPage() {
    return <>
      <div className="stats-row stats-four">
        <Stat icon="users" label="Agents configurables" value="4" />
        <Stat icon="shield" label="Accès métier" value="RBAC" detail="Contrôlé côté backend" />
        <Stat icon="bell" label="Alertes visibles" value={alerts.length} />
        <Stat icon="database" label="Connexions actives" value={backendStatus === "connected" ? "1" : "0"} detail="Sandbox uniquement" />
      </div>
      <div className="settings-grid">
        <Card title="Profil de la plateforme" icon="settings"><div className="form-grid"><label>Produit<input readOnly value="AI-NÉGOCE Intelligence Suite"/></label><label>Espace<input readOnly value="Agentic AI Command Center"/></label><label>Devise<input readOnly value="TND — 3 décimales"/></label><label>Langue<input readOnly value="Français"/></label></div><p className="muted-text small">Profil et identité métier gérés par l'authentification ERP à intégrer.</p></Card>
        <Card title="Agents et droits" icon="users">{agents.map((a) => <div className="settings-line" key={a.id}><span><b>{a.name}</b><small>{a.implemented ? "MVP déterministe, lecture seule" : "Service à développer"}</small></span><Pill tone={a.implemented ? "green" : "gray"}>{a.implemented ? "MVP" : "Prévu"}</Pill></div>)}</Card>
        <Card title="Préférences de notifications" icon="bell"><div className="settings-line"><span><b>Alertes prioritaires</b><small>Afficher les recommandations importantes dans l'interface</small></span><input aria-label="Alertes prioritaires" type="checkbox" checked={notificationRules.alerts} onChange={(e) => setNotificationRules((p) => ({ ...p, alerts: e.target.checked }))}/></div><div className="settings-line"><span><b>Décisions à approuver</b><small>Notifier les demandes de validation</small></span><input aria-label="Décisions à approuver" type="checkbox" checked={notificationRules.approvals} onChange={(e) => setNotificationRules((p) => ({ ...p, approvals: e.target.checked }))}/></div><div className="settings-line"><span><b>Synthèse quotidienne</b><small>Nécessite un worker serveur planifié</small></span><input aria-label="Synthèse quotidienne" type="checkbox" checked={notificationRules.summary} onChange={(e) => setNotificationRules((p) => ({ ...p, summary: e.target.checked }))}/></div><p className="muted-text small">Préférences locales de l'aperçu : aucun email ou push n'est envoyé.</p></Card>
        <Card title="Intégrations & sécurité" icon="lock"><div className="settings-line"><span><b>Connecteur ERP LAI</b><small>Un contrat d'API et l'authentification réelle sont nécessaires</small></span><Pill>Non configuré</Pill></div><div className="settings-line"><span><b>Actions en écriture</b><small>Pas de validation automatique, ni de mutation ERP</small></span><Pill tone="green">Désactivées</Pill></div><div className="settings-line"><span><b>Connexion BI / DS</b><small>API et données communes à brancher</small></span><Action light icon="external" onClick={() => navigate("connections")}>Voir</Action></div></Card>
      </div>
    </>
  }

  const title = page === "overview" ? "Centre de commandement — Agentic AI" : page === "missions" ? "Centre de missions" : page === "agents" ? "Mes agents" : page === "director" ? "AI Director — Orchestration centrale" : page === "decisions" ? "Décisions et approbations" : page === "notifications" ? "Notifications automatiques" : page === "connections" ? "Connexions BI / Data Science" : page === "platforms" ? "Plateformes — BI et Data Science" : page === "audit" ? "Historique & audit" : page === "settings" ? "Paramètres" : byAgent(selectedAgent).name + " Agent"
  const subtitle = page === "overview" ? "Orchestration des agents IA, suivi des missions, décisions et impact business sur l'ERP."
    : page === "missions" ? "Suivez les missions de l'ensemble des agents et contrôlez les étapes de validation."
    : page === "agents" ? "Parlez à chaque agent et suivez les recommandations, notifications et analyses."
    : page === "director" ? "Pilotage central, délégation des missions et arbitrage métier."
    : page === "decisions" ? "Revue et validation humaine des recommandations proposées par les agents."
    : page === "notifications" ? "Rappels et événements créés par le serveur, synchronisés avec votre session."
    : page === "platforms" ? "Les applications utilisent la même session et le même snapshot analytique."
    : page === "connections" ? "Suivi des connexions, synchronisations et contrats d'API."
    : page === "audit" ? "Traçabilité de l'activité, des décisions et des opérations."
    : page === "settings" ? "Personnalisez les préférences et supervisez la configuration." : ""

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Icon name="layers" size={27}/></div><div><strong>AI-NÉGOCE</strong><span>Intelligence Suite</span></div></div><p className="brand-sub">ERP & Agentic AI Enterprise</p>
      <nav aria-label="Navigation principale">{navigation.map((item) => <button key={item.page} type="button" aria-label={item.label} className={"nav-link " + ((page === item.page || item.page === "agents" && page === "agent") ? "active" : "")} onClick={() => navigate(item.page)}><Icon name={item.icon} size={19}/><span>{item.label}</span>{item.page === "decisions" && pendingDecisions.length > 0 && <em>{pendingDecisions.length}</em>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-rule" /><b>Plateformes</b><div className="sidebar-system"><i className="system-dot amber"/>ERP LAI <span>à connecter</span></div><div className="sidebar-system"><i className="system-dot amber"/>Data Analyse <span>à connecter</span></div><div className="sidebar-system"><i className="system-dot amber"/>Data Science <span>à connecter</span></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="header-filter"><label>Entreprise : <b>AI-NÉGOCE Distribution</b><Icon name="down" size={15}/></label><label>Agence : <select aria-label="Agence" value={agency} onChange={(e) => {setAgency(e.target.value);setRevenue(null);setSpecialistReports({});setDirectorReport(null);setSharedOverview(null)}}><option value="all">Toutes les agences</option>{["Tunis Centre", "Sfax", "Sousse", "Bizerte", "Nabeul", "Non ventilée (extraction)"].map((a) => <option key={a} value={a}>{a}</option>)}</select></label><label>Période : <select aria-label="Période" value={period} onChange={(e) => {setPeriod(e.target.value);setRevenue(null);setSpecialistReports({});setDirectorReport(null);setSharedOverview(null)}}><option>T4 2026</option><option>T3 2026</option><option>2026</option></select></label></div><div className="topbar-right"><button aria-label="Notifications" className="bell-button" onClick={() => token ? navigate("notifications") : setNotificationOpen((p) => !p)}><Icon name="bell" size={21}/>{!token && unread > 0 && <i/>}</button><div className="user-avatar">AD</div><div className="user-info"><b>Administrateur</b><span>Environnement démo</span></div><Icon name="down" size={15}/></div></header>
      <main className="main-content">
        {page !== "agent" && <div className="page-heading"><div><div className="breadcrumb">AI-NÉGOCE / AGENTIC INTELLIGENCE</div><h1>{title}</h1><p>{subtitle}</p></div><div className="heading-actions"><Action light icon="refresh" onClick={() => { if (token) { setRefreshSeq((n) => n + 1); setToast("Actualisation de la session et des rapports en cours."); } else setToast("Connectez la session centrale pour actualiser."); }}>Rafraîchir</Action>{(page === "overview" || page === "missions" || page === "director") && <Action icon="play" onClick={() => token ? navigate("missions") : setMissionModal(true)}>Lancer une mission</Action>}</div></div>}
        <div className="demo-banner"><Icon name="alert" size={17}/><span><strong>{token ? "Session sandbox connectée." : "Mode démonstration."}</strong> {token ? "Missions, approbations et notifications serveur actives. Le chat LLM exige une clé modèle réelle. Aucun write-back ERP." : "Les missions et décisions affichées sont illustratives tant que le backend n'est pas connecté."}</span><SmallLink onClick={() => navigate("connections")}>Connexions</SmallLink></div>
        {sharedSnapshotPanel()}
        {token&&snapshotChange&&sharedOverview?.snapshot.storage==="postgres"&&
          <section className="demo-banner" role="status" data-analytics-change={snapshotChange.current}>
            <Icon name="refresh" size={18}/>
            <span><strong>Nouvelle révision du dataset détectée.</strong> BI, Data Science et les spécialistes ont été recalculés sur le snapshot {snapshotChange.current}. Les anciennes approbations sont revalidées avant toute transmission.</span>
            {agency==="all"?<span>Sélectionnez une agence pour réinvestiguer.</span>:
              <Action light disabled={reinvestigating} onClick={()=>{void reinvestigate()}}>
                {reinvestigating?"Analyse en cours…":"Créer nouveau dossier AI Director"}
              </Action>}
          </section>}

        {page === "overview" ? overview()
          : page === "missions" ? (token ? <AdvancedMissions token={token} agency={agency} from={sharedFilters.from} to={sharedFilters.to}/> : missionsPage())
          : page === "agents" ? agentsPage()
          : page === "agent" ? agentPage()
          : page === "director" ? directorPage()
          : page === "decisions" ? (token ? <AdvancedApprovals token={token} agency={agency} from={sharedFilters.from} to={sharedFilters.to} userId={platform?.principal.id}/> : decisionsPage())
          : page === "notifications" ? (token ? <AdvancedNotifications token={token} agency={agency} userId={platform?.principal.id}/> : <Card title="Notifications démo"><p>Connectez le backend pour les notifications persistantes.</p></Card>)
          : page === "platforms" ? platformsPage()
          : page === "connections" ? connectionsPage()
          : page === "audit" ? auditPage() : settingsPage()}
      </main>
    </div>
    {notificationOpen && !token && <div className="notifications-popover"><div className="popover-head"><b>Notifications ({unread})</b><button aria-label="Fermer" className="icon-button" onClick={() => setNotificationOpen(false)}><Icon name="close"/></button></div>{alerts.map((n) => <button type="button" key={n.id} className={"popover-notice " + (!n.seen ? "unread" : "")} onClick={() => readAlert(n)}><span className={"alert-marker marker-" + priorityTone[n.priority]}><Icon name="bell" size={17}/></span><span><b>{n.title}</b><small>{n.detail}</small><em>{n.timestamp}</em></span></button>)}</div>}
    {missionModal && !token && <div className="modal-overlay" role="presentation" onMouseDown={() => setMissionModal(false)}><section className="modal" role="dialog" aria-modal="true" aria-label="Nouvelle mission" onMouseDown={(e) => e.stopPropagation()}><div className="modal-header"><div><h2>Créer une nouvelle mission</h2><p>Préparer un brouillon local de mission agentique.</p></div><button className="icon-button" aria-label="Fermer" onClick={() => setMissionModal(false)}><Icon name="close"/></button></div><label>Objectif de mission<textarea value={newTitle} onChange={(e) => setNewTitle(e.target.value)} rows={3} placeholder="Ex. Identifier les clients prioritaires à relancer..."/></label><div className="modal-form-row"><label>Agent responsable<select value={newAgent} onChange={(e) => setNewAgent(e.target.value as AgentKey)}>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>Priorité<select value={newPriority} onChange={(e) => setNewPriority(e.target.value as Priority)}><option value="basse">Basse</option><option value="moyenne">Moyenne</option><option value="haute">Haute</option></select></label></div><p className="modal-info"><Icon name="shield" size={18}/> Enregistrement dans la maquette uniquement : pas d'exécution en arrière-plan.</p><div className="modal-footer"><Action light onClick={() => setMissionModal(false)}>Annuler</Action><Action icon="plus" onClick={addMission}>Créer le brouillon</Action></div></section></div>}
    {toast && <div className="toast" role="status"><Icon name="check" size={17}/>{toast}</div>}
  </div>
}
