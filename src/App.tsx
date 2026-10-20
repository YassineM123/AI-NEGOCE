import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  ApiError,
  api,
  type ApiState,
  type BiData,
  type BiPeriod,
  type DashboardData,
  type DashboardPeriod,
  type DocumentResponse,
  type DocumentSummary,
  type Lookups,
  type PageData,
  type Tone,
} from "./api"

type Module = "dashboard" | "sales" | "purchases" | "inventory" | "finance" | "ocr" | "bi" | "copilot" | "settings"
type IconName = "grid" | "sales" | "cart" | "stock" | "finance" | "ocr" | "chart" | "spark" | "settings" | "bell" | "search" | "plus" | "upload" | "check" | "warning" | "arrow" | "filter" | "download" | "send" | "lock" | "file" | "info"

const iconPaths: Record<IconName, ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  sales: (
    <>
      <path d="M4 19V9l8-5 8 5v10" />
      <path d="M8 19v-6h8v6M2 19h20" />
    </>
  ),
  cart: (
    <>
      <path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L20 8H6" />
      <circle cx="10" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
    </>
  ),
  stock: (
    <>
      <path d="m4 7 8-4 8 4-8 4-8-4Z" />
      <path d="m4 12 8 4 8-4M4 17l8 4 8-4" />
    </>
  ),
  finance: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M7 15h3" />
    </>
  ),
  ocr: (
    <>
      <path d="M7 3H4a1 1 0 0 0-1 1v3M17 3h3a1 1 0 0 1 1 1v3M7 21H4a1 1 0 0 1-1-1v-3M17 21h3a1 1 0 0 0 1-1v-3" />
      <rect x="7" y="6" width="10" height="12" rx="1" />
      <path d="M9 10h6M9 13h6M9 16h4" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      <path d="m3 8 6-4 6 5 6-6" />
    </>
  ),
  spark: (
    <>
      <path d="m12 3 1.3 4.2L17 9l-3.7 1.8L12 15l-1.3-4.2L7 9l3.7-1.8L12 3ZM5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14ZM19 13l.7 1.8 1.8.7-1.8.7L19 18l-.7-1.8-1.8-.7 1.8-.7L19 13Z" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  upload: (
    <>
      <path d="M12 16V4m0 0L7 9m5-5 5 5" />
      <path d="M5 14v5h14v-5" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  warning: (
    <>
      <path d="M12 3 2.5 20h19L12 3Z" />
      <path d="M12 9v5m0 3v.1" />
    </>
  ),
  arrow: <path d="m9 18 6-6-6-6" />,
  filter: <path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z" />,
  download: (
    <>
      <path d="M12 4v12m0 0 5-5m-5 5-5-5M4 20h16" />
    </>
  ),
  send: (
    <>
      <path d="m3 11 18-8-8 18-2-8-8-2Z" />
      <path d="m11 13 5-5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  file: (
    <>
      <path d="M6 2h8l4 4v16H6V2Z" />
      <path d="M14 2v5h5M9 12h6M9 16h6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v.1" />
    </>
  ),
}

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name]}
    </svg>
  )
}

function Button({
  children,
  variant = "primary",
  icon,
  onClick,
  disabled = false,
}: {
  children: ReactNode
  variant?: "primary" | "secondary" | "ghost" | "danger"
  icon?: IconName
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      className={`btn btn-${variant}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  )
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode
  tone?: "success" | "warning" | "danger" | "info" | "neutral"
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

function StatCard({
  label,
  value,
  delta,
  icon,
  tone = "blue",
  note,
  deltaTone,
}: {
  label: string
  value: string
  delta: string
  icon: IconName
  tone?: string
  note: string
  deltaTone?: "up" | "down"
}) {
  return (
    <article className="stat-card">
      <div className={`stat-icon stat-${tone}`}>
        <Icon name={icon} size={19} />
      </div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-meta">
        <span className={deltaTone ?? (delta.startsWith("-") ? "down" : "up")}>
          {delta}
        </span>
        <span>{note}</span>
      </div>
    </article>
  )
}

const navGroups: {
  label: string
  items: { id: Module; label: string; icon: IconName; fresh?: boolean }[]
}[] = [
  {
    label: "Pilotage",
    items: [
      {
        id: "dashboard" as Module,
        label: "Tableau de bord",
        icon: "grid" as IconName,
      },
    ],
  },
  {
    label: "Gestion",
    items: [
      { id: "sales" as Module, label: "Ventes", icon: "sales" as IconName },
      { id: "purchases" as Module, label: "Achats", icon: "cart" as IconName },
      { id: "inventory" as Module, label: "Stocks", icon: "stock" as IconName },
      {
        id: "finance" as Module,
        label: "Finance",
        icon: "finance" as IconName,
      },
    ],
  },
  {
    label: "Intelligence",
    items: [
      {
        id: "ocr" as Module,
        label: "Smart OCR",
        icon: "ocr" as IconName,
        fresh: true,
      },
      {
        id: "bi" as Module,
        label: "BI 360",
        icon: "chart" as IconName,
        fresh: true,
      },
      {
        id: "copilot" as Module,
        label: "AI Copilot",
        icon: "spark" as IconName,
        fresh: true,
      },
    ],
  },
]

function Sidebar({
  active,
  navigate,
}: {
  active: Module
  navigate: (module: Module) => void
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">AI</div>
        <div>
          <strong>AI-NEGOCE</strong>
          <span>Gestion commerciale</span>
        </div>
      </div>
      <nav className="side-nav">
        {navGroups.map((group) => (
          <div className="nav-group" key={group.label}>
            <div className="nav-label">{group.label}</div>
            {group.items.map((item) => (
              <button
                key={item.id}
                className={`nav-item ${active === item.id ? "active" : ""}`}
                onClick={() => navigate(item.id as Module)}
              >
                <Icon name={item.icon} size={18} />
                <span>{item.label}</span>
                {item.fresh && (
                  <span className="new-dot" title="Nouveau module" />
                )}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button
          className={`nav-item ${active === "settings" ? "active" : ""}`}
          onClick={() => navigate("settings")}
        >
          <Icon name="settings" size={18} />
          <span>Paramètres</span>
        </button>
        <div className="user-card">
          <div className="avatar">SB</div>
          <div>
            <strong>Sonia Ben Amor</strong>
            <span>Administratrice</span>
          </div>
          <span className="status-dot" />
        </div>
      </div>
    </aside>
  )
}

const moduleTitles: Record<Module, { title: string; breadcrumb: string }> = {
  dashboard: { title: "Tableau de bord", breadcrumb: "Accueil" },
  sales: { title: "Ventes", breadcrumb: "Gestion / Ventes" },
  purchases: { title: "Achats", breadcrumb: "Gestion / Achats" },
  inventory: { title: "Stocks", breadcrumb: "Gestion / Stocks" },
  finance: { title: "Finance", breadcrumb: "Gestion / Finance" },
  ocr: { title: "Smart OCR", breadcrumb: "Achats / Smart OCR" },
  bi: { title: "BI 360", breadcrumb: "Pilotage / BI 360" },
  copilot: { title: "AI Copilot", breadcrumb: "Intelligence / AI Copilot" },
  settings: { title: "Paramètres", breadcrumb: "Administration / Paramètres" },
}

function Topbar({ module }: { module: Module }) {
  return (
    <header className="topbar">
      <div>
        <div className="breadcrumb">{moduleTitles[module].breadcrumb}</div>
        <div className="page-title">{moduleTitles[module].title}</div>
      </div>
      <div className="top-actions">
        <div className="demo-pill">
          <span /> Environnement de démonstration
        </div>
        <button className="icon-btn" aria-label="Rechercher">
          <Icon name="search" />
        </button>
        <button className="icon-btn notification" aria-label="Notifications">
          <Icon name="bell" />
          <span />
        </button>
        <div className="company-select">
          <span className="company-logo">CM</span>
          <div>
            <small>Société active</small>
            <strong>CARTHAGE MOBILIER SARL</strong>
          </div>
          <Icon name="arrow" size={14} />
        </div>
      </div>
    </header>
  )
}

const periodLabels: Record<DashboardPeriod, string> = {
  month: "Ce mois",
  quarter: "Ce trimestre",
  year: "Cette année",
}
const fmtInt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 })
const fmt3 = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
})
const fmt1 = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const dt = (v: number) => `${fmt3.format(v)} DT`
const signed = (v: number | null, unit: string) =>
  v === null
    ? "—"
    : `${v > 0 ? "+" : v < 0 ? "-" : ""}${fmt1.format(Math.abs(v))} ${unit}`
const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
const shortMonth = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("fr-FR", {
    month: "short",
    timeZone: "UTC",
  })
const prevLabel = (period: DashboardPeriod, from: string) =>
  period === "month"
    ? `vs. ${new Date(`${from}T00:00:00Z`).toLocaleDateString("fr-FR", { month: "short", year: "numeric", timeZone: "UTC" })}`
    : `vs. même période ${from.slice(0, 4)}`

function Dashboard({ navigate }: { navigate: (module: Module) => void }) {
  const [period, setPeriod] = useState<DashboardPeriod>("month")
  const [agency, setAgency] = useState("all")
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [syncedAt, setSyncedAt] = useState("")
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .dashboard(period, agency)
      .then((result) => {
        if (cancelled) return
        setData(result)
        setError("")
        setSyncedAt(
          new Date().toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        )
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            e instanceof TypeError
              ? "API injoignable : lancez npm run dev:api"
              : e instanceof Error
                ? e.message
                : "Erreur de chargement",
          )
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [period, agency, reload])

  const k = data?.kpis
  const a = data?.alerts
  const placeholder = loading && !data ? "…" : "—"
  const alertCount = a
    ? [
        a.lateReceivables.count,
        a.belowReorderPoint,
        a.marginDropCount,
        a.overCreditLimit.count,
      ].filter(Boolean).length
    : 0
  const trendTotal = data?.trend.reduce((s, t) => s + t.revenue, 0) ?? 0
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>Bonjour Sonia,</h1>
          <p>
            Voici l’essentiel de l’activité
            {data ? ` au ${longDate(data.asOf)}` : ""}.
          </p>
        </div>
        <Button icon="plus">Nouvelle opération</Button>
      </div>
      <div className="filters-row">
        <div className="segmented">
          {(Object.keys(periodLabels) as DashboardPeriod[]).map((p) => (
            <button
              key={p}
              className={period === p ? "selected" : ""}
              onClick={() => setPeriod(p)}
            >
              {periodLabels[p]}
            </button>
          ))}
        </div>
        <label className="field compact">
          <span>Agence</span>
          <select value={agency} onChange={(e) => setAgency(e.target.value)}>
            <option value="all">Toutes les agences</option>
            {(data?.agencies ?? []).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div className="last-sync">
          {loading
            ? "Actualisation…"
            : syncedAt
              ? `Dernière actualisation : ${syncedAt}`
              : ""}
        </div>
      </div>
      {error && (
        <div className="dashboard-error" role="alert">
          <span>
            <strong>Données indisponibles.</strong> {error}
          </span>
          <Button variant="ghost" onClick={() => setReload((n) => n + 1)}>
            Réessayer
          </Button>
        </div>
      )}
      <section className={`stats-grid${loading ? " is-loading" : ""}`}>
        <StatCard
          label="Chiffre d’affaires"
          value={k ? dt(k.revenue) : placeholder}
          delta={k ? signed(k.revenueChangePct, "%") : ""}
          note={data ? prevLabel(period, data.previousRange.from) : ""}
          icon="chart"
        />
        <StatCard
          label="Marge brute"
          value={k ? dt(k.grossMargin) : placeholder}
          delta={k ? signed(k.grossMarginChangePts, "pts") : ""}
          note={
            k?.grossMarginPct != null
              ? `${fmt1.format(k.grossMarginPct)} % du CA`
              : ""
          }
          icon="finance"
          tone="green"
        />
        <StatCard
          label="Créances clients"
          value={k ? dt(k.receivables) : placeholder}
          delta={
            k && k.receivables
              ? `${fmt1.format((k.overdueReceivables / k.receivables) * 100)} % échu`
              : ""
          }
          deltaTone="down"
          note={
            k?.averageReceivableAgeDays != null
              ? `âge moyen ${k.averageReceivableAgeDays} j`
              : ""
          }
          icon="sales"
          tone="amber"
        />
        <StatCard
          label="Valeur du stock"
          value={k ? dt(k.inventoryValue) : placeholder}
          delta={a ? `${fmtInt.format(a.belowReorderPoint)} sous seuil` : ""}
          deltaTone="down"
          note={
            k?.dormantInventoryPct != null
              ? `dont ${fmt1.format(k.dormantInventoryPct)} % dormant`
              : ""
          }
          icon="stock"
          tone="purple"
        />
      </section>
      <div className="dashboard-grid">
        <section className="panel revenue-panel">
          <div className="panel-head">
            <div>
              <h2>Évolution du chiffre d’affaires</h2>
              <p>CA facturé HT net des avoirs — en milliers de DT</p>
            </div>
            {data && (
              <Badge tone="success">
                12 mois : {fmtInt.format(trendTotal / 1000)} k DT
              </Badge>
            )}
          </div>
          <TrendChart points={data?.trend ?? []} />
        </section>
        <section className="panel quick-panel">
          <div className="panel-head">
            <div>
              <h2>Modules intelligents</h2>
              <p>Accès rapide aux nouveaux outils</p>
            </div>
          </div>
          <button className="module-link" onClick={() => navigate("ocr")}>
            <span className="module-icon blue">
              <Icon name="ocr" />
            </span>
            <span>
              <strong>Smart OCR</strong>
              <small>Importer et vérifier des factures</small>
            </span>
            <Badge tone="warning">À traiter</Badge>
            <Icon name="arrow" />
          </button>
          <button className="module-link" onClick={() => navigate("bi")}>
            <span className="module-icon teal">
              <Icon name="chart" />
            </span>
            <span>
              <strong>BI 360</strong>
              <small>
                {a
                  ? `${a.marginDropCount} alerte${a.marginDropCount > 1 ? "s" : ""} de marge détectée${a.marginDropCount > 1 ? "s" : ""}`
                  : "Analyse des marges"}
              </small>
            </span>
            <Badge tone="info">Analyse</Badge>
            <Icon name="arrow" />
          </button>
          <button className="module-link" onClick={() => navigate("copilot")}>
            <span className="module-icon violet">
              <Icon name="spark" />
            </span>
            <span>
              <strong>AI Copilot</strong>
              <small>Interroger vos données ERP</small>
            </span>
            <Badge>Disponible</Badge>
            <Icon name="arrow" />
          </button>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Activité récente</h2>
              <p>Derniers documents ventes et achats</p>
            </div>
            <Button variant="ghost" onClick={() => navigate("sales")}>
              Voir tout
            </Button>
          </div>
          <ActivityTable rows={data?.activity ?? []} />
        </section>
        <section className="panel alerts">
          <div className="panel-head">
            <div>
              <h2>Points d’attention</h2>
              <p>Actions recommandées</p>
            </div>
            <span className="count">{alertCount}</span>
          </div>
          {a && (
            <>
              <AlertItem
                tone="danger"
                title="Retards de règlement"
                text={`${fmtInt.format(a.lateReceivables.count)} factures dépassent 60 jours`}
                value={dt(a.lateReceivables.amount)}
              />
              <AlertItem
                tone="warning"
                title="Stock sous seuil"
                text={`${fmtInt.format(a.belowReorderPoint)} articles nécessitent un réassort`}
                value={`${fmtInt.format(a.belowReorderPoint)} réf.`}
              />
              {a.marginDrops[0] && (
                <AlertItem
                  tone="info"
                  title="Marge en baisse"
                  text={`Famille ${a.marginDrops[0].category}, agence ${a.marginDrops[0].agency}`}
                  value={signed(a.marginDrops[0].deltaPts, "pts")}
                />
              )}
              <AlertItem
                tone="warning"
                title="Plafond de crédit dépassé"
                text={`${fmtInt.format(a.overCreditLimit.count)} clients au-delà de leur encours autorisé`}
                value={dt(a.overCreditLimit.amount)}
              />
            </>
          )}
        </section>
      </div>
    </div>
  )
}

/** Rounds up to 1, 2, 2.5 or 5 x 10^n so axis labels stay readable. */
function niceStep(x: number) {
  if (x <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(x))
  return ([1, 2, 2.5, 5, 10].find((m) => m * pow >= x) ?? 10) * pow
}

function TrendChart({
  points,
}: {
  points: { month: string; revenue: number }[]
}) {
  const W = 682
  const H = 142
  const values = points.map((p) => p.revenue / 1000)
  const step = niceStep(Math.max(0, ...values) / 3)
  const top = step * 3
  const coords = values.map((v, i) => [
    points.length > 1 ? (i * W) / (points.length - 1) : W / 2,
    H - (Math.max(v, 0) / top) * (H - 6),
  ])
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
  return (
    <div className="chart-wrap">
      <div className="y-labels">
        {[3, 2, 1, 0].map((n) => (
          <span key={n}>{fmtInt.format(step * n)}</span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="trend-chart"
      >
        <defs>
          <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--blue)" stopOpacity=".18" />
            <stop offset="1" stopColor="var(--blue)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {line.length > 1 && (
          <>
            <path
              d={`M${line.join(" L")} L${W},${H} L0,${H} Z`}
              fill="url(#area)"
              stroke="none"
            />
            <polyline
              points={line.join(" ")}
              fill="none"
              stroke="var(--blue)"
              strokeWidth="2.5"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
        {coords.map(([x, y], i) => (
          <circle
            key={points[i].month}
            cx={x}
            cy={y}
            r="3"
            fill="white"
            stroke="var(--blue)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          >
            <title>
              {`${shortMonth(points[i].month)} ${points[i].month.slice(0, 4)} : ${dt(points[i].revenue)}`}
            </title>
          </circle>
        ))}
      </svg>
      <div className="x-labels">
        {points.map((p) => (
          <span key={p.month}>{shortMonth(p.month)}</span>
        ))}
      </div>
    </div>
  )
}

const activityStatus: Record<
  string,
  { label: string; tone: "success" | "danger" | "info" | "neutral" }
> = {
  posted: { label: "Validée", tone: "success" },
  cancelled: { label: "Annulée", tone: "danger" },
  invoiced: { label: "Facturée", tone: "info" },
}

function ActivityTable({ rows }: { rows: DashboardData["activity"] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Document</th>
            <th>Tiers</th>
            <th>Type</th>
            <th>Montant</th>
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} style={{ textAlign: "center", color: "var(--muted)" }}>
                Aucun document pour le moment
              </td>
            </tr>
          )}
          {rows.map((row) => {
            const status = activityStatus[row.status] ?? {
              label: row.status,
              tone: "neutral" as const,
            }
            return (
              <tr key={`${row.type}-${row.id}`}>
                <td>
                  <strong>{row.number}</strong>
                  <small>{longDate(row.date)}</small>
                </td>
                <td>{row.party}</td>
                <td>{row.type}</td>
                <td className="number">{fmt3.format(row.amount)} DT</td>
                <td>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function AlertItem({
  tone,
  title,
  text,
  value,
}: {
  tone: string
  title: string
  text: string
  value: string
}) {
  return (
    <div className="alert-item">
      <span className={`alert-bar ${tone}`} />
      <div>
        <strong>{title}</strong>
        <small>{text}</small>
      </div>
      <b>{value}</b>
      <Icon name="arrow" size={16} />
    </div>
  )
}

function TabBar({
  tabs,
  active,
  setActive,
}: {
  tabs: { id: string; label: string; count?: number }[]
  active: string
  setActive: (id: string) => void
}) {
  return (
    <div className="tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={active === tab.id ? "active" : ""}
          onClick={() => setActive(tab.id)}
        >
          {tab.label}
          {tab.count !== undefined && <span>{tab.count}</span>}
        </button>
      ))}
    </div>
  )
}

function OCRModule() {
  const [tab, setTab] = useState("import")
  const [uploaded, setUploaded] = useState(false)
  // Number of documents the API reports for this user's agency scope; undefined
  // while unknown so the tab never shows an invented figure.
  const [historyCount, setHistoryCount] = useState<number | undefined>()
  const refreshHistoryCount = () =>
    api
      .documents()
      .then((r) => setHistoryCount(r.documents.length))
      .catch(() => setHistoryCount(undefined))
  useEffect(() => {
    void refreshHistoryCount()
  }, [])
  const [uploadResult, setUploadResult] = useState<DocumentResponse | null>(null)
  const [uploadError, setUploadError] = useState("")
  const [uploadNotice, setUploadNotice] = useState("")
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const upload = async (file?: File) => {
    if (!file) return
    setUploading(true)
    setUploadError("")
    setUploadNotice("")
    try {
      const result = await api.upload(file)
      setUploadResult(result)
      setUploaded(true)
      setTab("review")
      void refreshHistoryCount()
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "DUPLICATE_DOCUMENT" &&
        typeof error.details?.existingId === "string"
      ) {
        try {
          const existing = await api.document(error.details.existingId)
          setUploadResult(existing)
          setUploaded(true)
          setUploadNotice(
            "Ce fichier avait déjà été importé. Le document existant a été ouvert.",
          )
          setTab("review")
          return
        } catch {
          // Keep the original duplicate error if the existing document cannot
          // be loaded anymore.
        }
      }
      setUploadError(
        error instanceof Error ? error.message : "Échec de l’import",
      )
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>Traitement intelligent des factures</h1>
          <p>Extraction, rapprochement catalogue et validation avant import.</p>
        </div>
        <div className="heading-actions">
          <Button
            variant="secondary"
            icon="file"
            onClick={() => setTab("history")}
          >
            Historique
          </Button>
          <Button icon="upload" onClick={() => fileRef.current?.click()}>
            Importer une facture
          </Button>
        </div>
      </div>
      <div className="info-banner">
        <Icon name="spark" size={17} />
        <span>
          <strong>Pipeline local sécurisé.</strong> Le document est validé et
          stocké par l’API. OCR et ERP réels restent non configurés : aucune
          valeur ni réussite n’est inventée.
        </span>
      </div>
      {uploadError && (
        <div className="warning-box">
          <Icon name="warning" size={17} />
          <div>
            <strong>Import refusé</strong>
            <span>{uploadError}</span>
          </div>
        </div>
      )}
      {uploadNotice && (
        <div className="duplicate-notice" role="status">
          <Icon name="info" size={17} />
          <div>
            <strong>Document déjà présent</strong>
            <span>{uploadNotice}</span>
          </div>
        </div>
      )}
      <TabBar
        active={tab}
        setActive={setTab}
        tabs={[
          { id: "import", label: "1. Importer" },
          { id: "review", label: "2. Vérifier", count: uploaded ? 1 : 0 },
          { id: "history", label: "3. Historique", count: historyCount },
        ]}
      />
      {tab === "import" && (
        <section className="panel upload-page">
          <div
            className="upload-zone"
            onClick={() => !uploading && fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              void upload(e.dataTransfer.files[0])
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              onChange={(e) => void upload(e.target.files?.[0])}
              hidden
            />
            <div className="upload-icon">
              <Icon name="upload" size={24} />
            </div>
            <h2>
              {uploading ? "Import en cours…" : "Déposez votre facture ici"}
            </h2>
            <p>
              Glissez-déposez un PDF, JPG ou PNG, ou sélectionnez le fichier
              depuis votre ordinateur.
            </p>
            <Button variant="secondary" disabled={uploading}>
              Sélectionner un fichier
            </Button>
            <small>
              1 fichier · 15 Mo maximum · contenu vérifié côté serveur
            </small>
          </div>
          <div className="upload-guidance">
            <h3>Pour une extraction optimale</h3>
            <div>
              <span>
                <Icon name="check" size={15} />
              </span>
              <p>
                <strong>Document lisible</strong>Résolution recommandée de 300
                dpi
              </p>
            </div>
            <div>
              <span>
                <Icon name="check" size={15} />
              </span>
              <p>
                <strong>Une facture par fichier</strong>Toutes les pages dans le
                même PDF
              </p>
            </div>
            <div>
              <span>
                <Icon name="check" size={15} />
              </span>
              <p>
                <strong>Formats pris en charge</strong>PDF, JPG et PNG
              </p>
            </div>
          </div>
        </section>
      )}
      {tab === "review" && uploadResult ? (
        <UploadedReview
          document={uploadResult}
          onUpload={() => setTab("import")}
        />
      ) : (
        tab === "review" && (
          <section className="panel empty-state">
            <div className="empty-icon">
              <Icon name="file" size={26} />
            </div>
            <h2>Aucune facture à vérifier</h2>
            <p>Importez une facture fournisseur pour la contrôler ici.</p>
            <Button
              variant="secondary"
              icon="upload"
              onClick={() => setTab("import")}
            >
              Importer une facture
            </Button>
          </section>
        )
      )}
      {tab === "history" && <OCRHistory onCount={setHistoryCount} />}
    </div>
  )
}

function UploadedReview({
  document,
  onUpload,
}: {
  document: DocumentResponse
  onUpload: () => void
}) {
  return (
    <section className="panel empty-state">
      <div className="empty-icon">
        <Icon name="file" size={26} />
      </div>
      <Badge tone="warning">Révision humaine requise</Badge>
      <h2>{document.filename}</h2>
      <p>
        Document stocké sous l’identifiant <strong>{document.id}</strong>. Aucun
        moteur OCR n’étant configuré, les champs restent volontairement vides.
      </p>
      <div className="definition">
        <Icon name="info" size={16} />
        Champs manquants : {document.extraction?.missingFields.join(", ") || "aucun"}.
        Soumission ERP : non effectuée.
      </div>
      <Button variant="secondary" icon="upload" onClick={onUpload}>
        Importer un autre document
      </Button>
    </section>
  )
}

const documentStatus: Record<string, { label: string; tone: Tone }> = {
  needs_review: { label: "À vérifier", tone: "warning" },
  approved: { label: "Approuvé", tone: "success" },
  failed: { label: "Échec OCR", tone: "danger" },
}

function OCRHistory({ onCount }: { onCount: (count: number) => void }) {
  const [state, setState] = useState<ApiState<DocumentSummary[]>>({})
  const [reload, setReload] = useState(0)
  const [open, setOpen] = useState<DocumentResponse | null>(null)
  const [openError, setOpenError] = useState("")
  useEffect(() => {
    let cancelled = false
    setState({})
    api
      .documents()
      .then((r) => {
        if (cancelled) return
        setState({ data: r.documents })
        onCount(r.documents.length)
      })
      .catch(
        (e) =>
          !cancelled &&
          setState({
            error: e instanceof Error ? e.message : "Erreur de chargement",
          }),
      )
    return () => {
      cancelled = true
    }
  }, [reload])
  const openDocument = async (id: string) => {
    setOpenError("")
    try {
      setOpen(await api.document(id))
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : "Document introuvable")
    }
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Documents importés</h2>
          <p>
            Journal réel des imports. Seuls les documents de votre périmètre
            d’agence sont visibles.
          </p>
        </div>
        <Button variant="ghost" onClick={() => setReload((n) => n + 1)}>
          Actualiser
        </Button>
      </div>
      {state.error && (
        <div className="dashboard-error" role="alert">
          <span>
            <strong>Historique indisponible.</strong> {state.error}
          </span>
        </div>
      )}
      {openError && (
        <div className="warning-box">
          <Icon name="warning" size={17} />
          <div>
            <strong>Ouverture impossible</strong>
            <span>{openError}</span>
          </div>
        </div>
      )}
      {!state.data && !state.error && <p>Chargement…</p>}
      {state.data && state.data.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">
            <Icon name="file" size={26} />
          </div>
          <h2>Aucun document importé</h2>
          <p>
            Les factures que vous importez apparaîtront ici. Aucun exemple fictif
            n’est affiché comme une opération réelle.
          </p>
        </div>
      )}
      {state.data && state.data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Fichier</th>
              <th>Agence</th>
              <th>Importé le</th>
              <th>Statut</th>
              <th>Soumission ERP</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {state.data.map((doc) => (
              <tr key={doc.id}>
                <td>{doc.filename}</td>
                <td>{doc.agency}</td>
                <td>{new Date(doc.createdAt).toLocaleString("fr-FR")}</td>
                <td>
                  <Badge tone={documentStatus[doc.status]?.tone ?? "neutral"}>
                    {documentStatus[doc.status]?.label ?? doc.status}
                  </Badge>
                </td>
                <td>
                  {doc.erpSubmission.status === "not_submitted"
                    ? "Non soumis"
                    : doc.erpSubmission.status}
                </td>
                <td>
                  <Button
                    variant="ghost"
                    onClick={() => void openDocument(doc.id)}
                  >
                    Ouvrir
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon success">
              <Icon name="file" size={24} />
            </div>
            <h2>{open.filename}</h2>
            <p>
              Identifiant <strong>{open.id}</strong>. Statut :{" "}
              <strong>{documentStatus[open.status]?.label ?? open.status}</strong>
              .
            </p>
            <div className="definition">
              <Icon name="info" size={16} />
              Champs manquants :{" "}
              {open.extraction?.missingFields.join(", ") || "aucun"}. Soumission
              ERP : non effectuée.
            </div>
            <div className="modal-actions">
              <Button onClick={() => setOpen(null)}>Fermer</Button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

const biPeriodLabels: Record<BiPeriod, string> = {
  month: "Mois en cours",
  quarter: "Trimestre en cours",
  year: "Année en cours",
  all: "Toutes les dates",
}

function exportMetrics(data: BiData, agency: string) {
  const k = data.kpis
  const rows = [
    ["indicateur", "valeur"],
    ["agence", agency],
    ["periode", `${data.range.from} -> ${data.range.to}`],
    ["chiffre_affaires_ht", k.revenue],
    ["marge_brute", k.grossMargin],
    ["taux_marge_pct", k.grossMarginPct ?? ""],
    ["creances", k.receivables],
    ["creances_echues", k.overdueReceivables],
    ["valeur_stock", k.inventoryValue],
    ["stock_dormant", k.dormantInventory],
    ["factures", k.invoiceCount],
    ...data.agencies.map((a) => [`ca_${a.agency}`, a.revenue]),
  ]
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n")
  const link = document.createElement("a")
  link.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }))
  link.download = `bi360-${data.period}-${agency.replace(/\s+/g, "-").toLowerCase()}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}

function BIModule() {
  const [tab, setTab] = useState("overview")
  const [agency, setAgency] = useState("all")
  const [period, setPeriod] = useState<BiPeriod>("year")
  const [focus, setFocus] = useState<{ categoryId: string; agency: string } | undefined>()
  const [data, setData] = useState<BiData | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    setError("")
    setLoading(true)
    api
      .bi360(period, agency, focus)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e instanceof TypeError ? "API injoignable : lancez npm run dev:api" : e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [agency, period, focus])
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>Vue exécutive</h1>
          <p>Rentabilité, performance commerciale et santé du stock.</p>
        </div>
        <div className="heading-actions">
          <Button
            variant="secondary"
            icon="download"
            disabled={!data}
            onClick={() => data && exportMetrics(data, agency === "all" ? "toutes" : agency)}
          >
            Exporter le rapport
          </Button>
        </div>
      </div>
      <div className="bi-filterbar">
        <label className="field compact">
          <span>Période</span>
          <select
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value as BiPeriod)
              setFocus(undefined)
            }}
          >
            {(Object.keys(biPeriodLabels) as BiPeriod[]).map((p) => (
              <option key={p} value={p}>
                {biPeriodLabels[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="field compact">
          <span>Agence</span>
          <select
            value={agency}
            onChange={(e) => {
              setAgency(e.target.value)
              setFocus(undefined)
            }}
          >
            <option value="all">Toutes les agences</option>
            {(data?.agencyNames ?? []).map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <span className="refresh">
          {loading
            ? "Chargement des données…"
            : data
              ? `Du ${frDate(data.range.from)} au ${frDate(data.range.to)}${data.previousRange ? " · comparé à N-1" : ""}`
              : ""}
        </span>
      </div>
      <TabBar
        active={tab}
        setActive={setTab}
        tabs={[
          { id: "overview", label: "Vue d’ensemble" },
          { id: "margin", label: "Analyse de marge", count: data?.marginDrops.length ?? 0 },
          { id: "invoices", label: "Détail factures" },
        ]}
      />
      {error && (
        <div className="warning-box">
          <Icon name="warning" size={17} />
          <div>
            <strong>API BI indisponible</strong>
            <span>{error}</span>
          </div>
        </div>
      )}
      {tab === "overview" && <BIOverview data={data} goMargin={() => setTab("margin")} />}
      {tab === "margin" && (
        <MarginAnalysis
          data={data}
          onPick={(f) => setFocus(f)}
          goInvoices={() => setTab("invoices")}
        />
      )}
      {tab === "invoices" && <InvoiceDrilldown data={data} />}
    </div>
  )
}

function BIOverview({ data, goMargin }: { data: BiData | null; goMargin: () => void }) {
  const k = data?.kpis
  const v = (x?: number) => (x === undefined ? "…" : dt(x))
  const aging = data?.stockAging
  const stockTotal = aging ? aging.active + aging.watch + aging.dormant : 0
  const share = (x: number) => (stockTotal ? (x / stockTotal) * 100 : 0)
  return (
    <>
      <section className="stats-grid five">
        <StatCard
          label="Chiffre d’affaires HT"
          value={v(k?.revenue)}
          delta={k ? signed(k.revenueChangePct, "%") : ""}
          note={k ? `${fmtInt.format(k.invoiceCount)} document(s)` : ""}
          icon="chart"
        />
        <StatCard
          label="Marge brute"
          value={v(k?.grossMargin)}
          delta={k ? signed(k.grossMarginChangePts, "pts") : ""}
          note={k?.grossMarginPct != null ? `${fmt1.format(k.grossMarginPct)} % du CA` : "taux non défini (CA nul)"}
          icon="finance"
          tone="green"
        />
        <StatCard
          label="Créances"
          value={v(k?.receivables)}
          delta={k ? `${dt(k.overdueReceivables)} échus` : ""}
          deltaTone="down"
          note="soldes clients ouverts"
          icon="sales"
          tone="amber"
        />
        <StatCard
          label="Valeur du stock"
          value={v(k?.inventoryValue)}
          delta=""
          note="au coût unitaire"
          icon="stock"
          tone="purple"
        />
        <StatCard
          label="Stock dormant > 180 j"
          value={v(k?.dormantInventory)}
          delta={k?.inventoryValue ? `${fmt1.format((k.dormantInventory / k.inventoryValue) * 100)} %` : ""}
          deltaTone="down"
          note="sans vente ou jamais vendu"
          icon="warning"
          tone="red"
        />
      </section>
      <div className="bi-grid">
        <section className="panel wide">
          <div className="panel-head">
            <div>
              <h2>CA et marge brute</h2>
              <p>12 derniers mois — milliers de DT</p>
            </div>
            <div className="legend">
              <span className="blue-dot" />
              Chiffre d’affaires <span className="green-dot" />
              Marge brute
            </div>
          </div>
          <BarLineChart months={data?.monthly ?? []} />
        </section>
        <section className="panel anomaly-panel">
          <div className="panel-head">
            <div>
              <h2>Alertes & anomalies</h2>
              <p>Détectées sur la période</p>
            </div>
            <Badge tone={data?.anomalies.length ? "danger" : "success"}>
              {data?.anomalies.length ?? 0} active{(data?.anomalies.length ?? 0) > 1 ? "s" : ""}
            </Badge>
          </div>
          {data?.anomalies.length === 0 && <p className="erp-hint pad">Aucune anomalie détectée.</p>}
          {data?.anomalies.map((a) => (
            <button key={a.kind} className="anomaly" onClick={a.kind === "margin" ? goMargin : undefined}>
              <span className={`severity ${a.severity}`} />
              <div>
                <strong>{a.title}</strong>
                <p>{a.subject}</p>
                <small>{a.detail}</small>
              </div>
              <Icon name="arrow" />
            </button>
          ))}
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Performance par agence</h2>
              <p>Classement par chiffre d’affaires</p>
            </div>
          </div>
          <AgencyTable rows={data?.agencies ?? []} />
        </section>
        <section className="panel stock-panel">
          <div className="panel-head">
            <div>
              <h2>Structure du stock</h2>
              <p>Ancienneté depuis la dernière vente</p>
            </div>
          </div>
          <Donut active={share(aging?.active ?? 0)} watch={share(aging?.watch ?? 0)} total={stockTotal} />
          <div className="stock-legend">
            {(
              [
                ["d1", "Actif (< 90 j)", aging?.active ?? 0],
                ["d2", "À surveiller (90–180 j)", aging?.watch ?? 0],
                ["d3", "Dormant (> 180 j)", aging?.dormant ?? 0],
              ] as const
            ).map(([cls, label, value]) => (
              <div key={cls}>
                <span className={`dot ${cls}`} />
                <p>
                  <b>{label}</b>
                  <small>
                    {dt(value)} · {fmt1.format(share(value))} %
                  </small>
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}

function BarLineChart({ months }: { months: BiData["monthly"] }) {
  const step = niceStep(Math.max(0, ...months.map((m) => m.revenue / 1000)) / 4)
  const top = step * 4
  const h = (x: number) => `${Math.max(0, (x / 1000 / top) * 194)}px`
  return (
    <div className="bar-chart">
      <div className="chart-scale">
        {[4, 3, 2, 1, 0].map((n) => (
          <span key={n}>{fmtInt.format(step * n)}</span>
        ))}
      </div>
      <div className="bars">
        {months.map((m) => (
          <div className="bar-column" key={m.month} title={`${shortMonth(m.month)} ${m.month.slice(0, 4)} : CA ${dt(m.revenue)} · marge ${dt(m.margin)}`}>
            <div className="bar" style={{ height: h(m.revenue), minHeight: 0, maxHeight: "none" }}>
              <span className="margin-bar" style={{ height: h(m.margin) }} />
            </div>
            <small>{shortMonth(m.month)}</small>
          </div>
        ))}
      </div>
    </div>
  )
}

function AgencyTable({ rows }: { rows: BiData["agencies"] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Agence</th>
          <th>CA HT</th>
          <th>Évolution</th>
          <th>Marge brute</th>
          <th>Taux de marge</th>
          <th>Part du CA</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((a, i) => (
          <tr key={a.agency}>
            <td>
              <span className="rank">{i + 1}</span>
              <strong>{a.agency}</strong>
            </td>
            <td className="number">{dt(a.revenue)}</td>
            <td className={a.changePct === null ? "" : a.changePct < 0 ? "down" : "up"}>{signed(a.changePct, "%")}</td>
            <td className="number">{dt(a.margin)}</td>
            <td>{a.marginPct === null ? "—" : `${fmt1.format(a.marginPct)} %`}</td>
            <td>
              <Progress value={a.sharePct} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Progress({ value }: { value: number }) {
  return (
    <div className="progress">
      <span style={{ width: `${Math.min(value, 100)}%` }} />
      <b>{fmt1.format(value)} %</b>
    </div>
  )
}
function Donut({ active, watch, total }: { active: number; watch: number; total: number }) {
  return (
    <div
      className="donut"
      style={{
        background: total
          ? `conic-gradient(var(--blue) 0 ${active}%, var(--amber) ${active}% ${active + watch}%, var(--red) ${active + watch}% 100%)`
          : "var(--line)",
      }}
    >
      <div>
        <strong>{total >= 1000 ? `${fmt1.format(total / 1000)} k` : fmtInt.format(total)}</strong>
        <span>DT en stock</span>
      </div>
    </div>
  )
}

function MarginAnalysis({
  data,
  onPick,
  goInvoices,
}: {
  data: BiData | null
  onPick: (focus: { categoryId: string; agency: string }) => void
  goInvoices: () => void
}) {
  const f = data?.marginFocus
  if (!data) return <section className="panel empty-state"><h2>Chargement…</h2></section>
  if (!f)
    return (
      <section className="panel empty-state">
        <div className="empty-icon">
          <Icon name="chart" size={26} />
        </div>
        <h2>Pas assez de données pour analyser la marge</h2>
        <p>
          L’analyse compare la période choisie à la même période de l’année précédente. Elle apparaît dès que des
          ventes existent sur les deux périodes{data.period === "all" ? " (choisissez une période autre que « Toutes les dates »)" : ""}.
        </p>
      </section>
    )
  const maxFactor = Math.max(1, ...f.factors.map((x) => Math.abs(x.value)))
  return (
    <div className="margin-layout">
      <section className="panel margin-summary">
        <div className="analysis-title">
          <div>
            <Badge tone={f.gap < 0 ? "danger" : "success"}>{f.gap < 0 ? "Marge en baisse" : "Marge stable ou en hausse"}</Badge>
            <h2>
              {f.category} — {f.agency}
            </h2>
            <p>
              Du {frDate(data.range.from)} au {frDate(data.range.to)} · {f.invoiceCount} facture(s)
            </p>
            {data.marginDrops.length > 0 && (
              <label className="field compact">
                <span>Autres baisses détectées</span>
                <select
                  value={`${f.categoryId}|${f.agency}`}
                  onChange={(e) => {
                    const [categoryId, agency] = e.target.value.split("|")
                    onPick({ categoryId, agency })
                  }}
                >
                  {!data.marginDrops.some((d) => d.categoryId === f.categoryId && d.agency === f.agency) && (
                    <option value={`${f.categoryId}|${f.agency}`}>
                      {f.category} · {f.agency}
                    </option>
                  )}
                  {data.marginDrops.map((d) => (
                    <option key={`${d.categoryId}|${d.agency}`} value={`${d.categoryId}|${d.agency}`}>
                      {d.category} · {d.agency} ({fmt1.format(d.deltaPts)} pts)
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="metric-large">
            <span>Taux de marge</span>
            <strong>{f.marginPct === null ? "—" : `${fmt1.format(f.marginPct)} %`}</strong>
            <small>
              {f.marginPct === null ? "" : signed(f.marginPct - f.previousMarginPct, "pts")} vs {fmt1.format(f.previousMarginPct)} % en N-1
            </small>
          </div>
        </div>
        <div className="margin-kpis">
          <div>
            <span>CA de la sélection</span>
            <b>{dt(f.revenue)}</b>
          </div>
          <div>
            <span>Marge réalisée</span>
            <b>{dt(f.margin)}</b>
          </div>
          <div>
            <span>Marge attendue (taux N-1)</span>
            <b>{dt(f.expectedMargin)}</b>
          </div>
          <div className={f.gap < 0 ? "negative" : ""}>
            <span>Écart de marge</span>
            <b>{dt(f.gap)}</b>
          </div>
        </div>
      </section>
      <section className="panel factor-panel">
        <div className="panel-head">
          <div>
            <h2>Facteurs contributifs</h2>
            <p>Impact estimé sur la marge vs même période N-1</p>
          </div>
        </div>
        {f.factors.map((x, i) => (
          <div className="factor" key={x.label}>
            <span className="factor-rank">{i + 1}</span>
            <div>
              <div className="factor-label">
                <b>{x.label}</b>
                <strong className={x.value < 0 ? "negative" : "positive"}>
                  {x.value > 0 ? "+" : ""}
                  {dt(x.value)}
                </strong>
              </div>
              <div className="factor-track">
                <span className={x.value < 0 ? "negative" : "positive"} style={{ width: `${(Math.abs(x.value) / maxFactor) * 100}%` }} />
              </div>
            </div>
          </div>
        ))}
      </section>
      <section className="panel products-panel">
        <div className="panel-head">
          <div>
            <h2>Produits les plus contributeurs à l’écart</h2>
            <p>Triés par écart de marge vs taux N-1</p>
          </div>
          <Button variant="ghost" onClick={goInvoices}>
            Voir les factures <Icon name="arrow" size={15} />
          </Button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Produit</th>
              <th>Qté vendue</th>
              <th>CA HT</th>
              <th>Coût moyen</th>
              <th>Taux marge</th>
              <th>Écart</th>
            </tr>
          </thead>
          <tbody>
            {f.products.map((p) => (
              <tr key={p.sku}>
                <td>
                  <strong>{p.sku}</strong>
                  <small>{p.name}</small>
                </td>
                <td>{fmtInt.format(p.qty)}</td>
                <td className="number">{dt(p.revenue)}</td>
                <td className="number">{dt(p.averageCost)}</td>
                <td>{fmt1.format(p.marginPct)} %</td>
                <td className={p.gap < 0 ? "down" : "up"}>{dt(p.gap)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function InvoiceDrilldown({ data }: { data: BiData | null }) {
  const f = data?.marginFocus
  if (!f)
    return (
      <section className="panel empty-state">
        <div className="empty-icon">
          <Icon name="file" size={26} />
        </div>
        <h2>Aucune sélection</h2>
        <p>Le détail des factures suit la famille analysée dans « Analyse de marge ».</p>
      </section>
    )
  const exportCsv = () => {
    const rows = [["facture", "date", "client", "ca_ht", "cout", "marge", "taux"], ...f.invoices.map((i) => [i.number, i.date, i.customer, i.revenue, i.cost, i.margin, i.marginPct ?? ""])]
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n")
    const link = document.createElement("a")
    link.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }))
    link.download = `factures-${f.category}-${f.agency}.csv`.replace(/\s+/g, "-").toLowerCase()
    link.click()
    URL.revokeObjectURL(link.href)
  }
  return (
    <section className="panel history-panel">
      <div className="drill-head">
        <div>
          <Badge tone="info">Drill-down actif</Badge>
          <h2>
            Factures — {f.category} · {f.agency}
          </h2>
          <p>
            {f.invoiceCount} facture(s) · {dt(f.revenue)} de CA HT · {f.invoices.length < f.invoiceCount ? `${f.invoices.length} plus faibles marges affichées` : "triées par taux de marge"}
          </p>
        </div>
        <Button variant="secondary" icon="download" disabled={!f.invoices.length} onClick={exportCsv}>
          Exporter
        </Button>
      </div>
      <table>
        <thead>
          <tr>
            <th>N° facture</th>
            <th>Date</th>
            <th>Client</th>
            <th>CA HT</th>
            <th>Coût</th>
            <th>Marge</th>
            <th>Taux</th>
          </tr>
        </thead>
        <tbody>
          {f.invoices.map((r) => (
            <tr key={r.number}>
              <td>
                <strong>{r.number}</strong>
              </td>
              <td>{frDate(r.date)}</td>
              <td>{r.customer}</td>
              <td className="number">{fmt3.format(r.revenue)} DT</td>
              <td className="number">{fmt3.format(r.cost)} DT</td>
              <td className="number">{fmt3.format(r.margin)} DT</td>
              <td>
                <Badge tone={r.marginPct === null ? "neutral" : r.marginPct < f.previousMarginPct - 2 ? "danger" : r.marginPct < f.previousMarginPct ? "warning" : "success"}>
                  {r.marginPct === null ? "—" : `${fmt1.format(r.marginPct)} %`}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="definition">
        <Icon name="info" size={16} />
        Marge brute = CA HT – coût de revient des lignes. Les avoirs sont déduits sur leur date de comptabilisation.
      </div>
    </section>
  )
}

function CopilotModule() {
  const [mode, setMode] = useState<"chat" | "access">("chat")
  const [messages, setMessages] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [input, setInput] = useState("")
  const [answer, setAnswer] = useState<any>(null)
  const [error, setError] = useState("")
  const ask = async (question: string) => {
    const normalizedQuestion = question.trim()
    if (!normalizedQuestion || loading) return
    setMessages((m) => [...m, normalizedQuestion])
    setInput("")
    setLoading(true)
    setError("")
    setAnswer(null)
    try {
      setAnswer(await api.ask(normalizedQuestion))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur Copilot")
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="copilot-shell">
      <aside className="chat-history">
        <Button icon="plus" onClick={() => {
          setMessages([])
          setAnswer(null)
          setError("")
          setInput("")
        }}>
          Nouvelle conversation
        </Button>
        <div className="history-label">Aujourd’hui</div>
        <button className="history-item active">
          <Icon name="spark" size={16} />
          <span>Analyse marge février</span>
        </button>
        <button className="history-item">
          <Icon name="spark" size={16} />
          <span>Créances clients à risque</span>
        </button>
        <div className="history-label">Cette semaine</div>
        <button className="history-item">
          <Icon name="spark" size={16} />
          <span>État du stock dormant</span>
        </button>
        <button className="history-item">
          <Icon name="spark" size={16} />
          <span>Top fournisseurs 2025</span>
        </button>
        <div className="chat-note">
          <Icon name="lock" size={15} />
          <span>Les réponses respectent vos droits d’accès ERP.</span>
        </div>
      </aside>
      <section className="chat-main">
        <div className="chat-top">
          <div>
            <span className="ai-status">
              <i /> AI Copilot
            </span>
            <small>Connecté aux données de CARTHAGE MOBILIER SARL</small>
          </div>
          <div className="segmented mini">
            <button
              className={mode === "chat" ? "selected" : ""}
              onClick={() => setMode("chat")}
            >
              Assistant
            </button>
            <button
              className={mode === "access" ? "selected" : ""}
              onClick={() => setMode("access")}
            >
              Accès & confidentialité
            </button>
          </div>
        </div>
        {mode === "access" ? (
          <AccessState />
        ) : (
          <div className="conversation">
            {messages.length === 0 ? (
              <CopilotEmpty ask={ask} />
            ) : (
              <ChatAnswer
                question={messages[messages.length - 1]}
                loading={loading}
                answer={answer}
                error={error}
                ask={ask}
              />
            )}
            <div className="composer-wrap">
              <div className="composer">
                <textarea
                  aria-label="Question pour AI Copilot"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      ask(input)
                    }
                  }}
                  placeholder="Posez une question sur vos ventes, marges, stocks ou créances…"
                  disabled={loading}
                />
                <button
                  className="send-button"
                  onClick={() => ask(input)}
                  disabled={loading || !input.trim()}
                  aria-label="Envoyer la question"
                >
                  <Icon name="send" size={18} />
                </button>
              </div>
              <div className="composer-foot">
                <span>
                  <Icon name="spark" size={13} /> Réponse générée à partir de
                  vos données ERP
                </span>
                <span>Entrée pour envoyer · Maj+Entrée pour une ligne</span>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function CopilotEmpty({ ask }: { ask: (q: string) => void }) {
  const prompts = [
    "Pourquoi notre marge a-t-elle baissé en février ?",
    "Quels clients présentent un risque de paiement ?",
    "Quels articles sont dormants depuis plus de 180 jours ?",
    "Compare les performances des agences ce trimestre.",
  ]
  return (
    <div className="copilot-empty">
      <div className="copilot-mark">
        <Icon name="spark" size={26} />
      </div>
      <h1>Que souhaitez-vous analyser ?</h1>
      <p>
        Je peux explorer les ventes, achats, marges, stocks et créances
        accessibles dans votre ERP.
      </p>
      <div className="prompt-grid">
        {prompts.map((p, i) => (
          <button key={p} onClick={() => ask(p)}>
            <span className={`prompt-icon p${i + 1}`}>
              <Icon
                name={["chart", "sales", "stock", "grid"][i] as IconName}
                size={18}
              />
            </span>
            <span>{p}</span>
            <Icon name="arrow" size={15} />
          </button>
        ))}
      </div>
      <div className="sample-label">
        Questions suggérées · Données de démonstration
      </div>
    </div>
  )
}

function ChatAnswer({
  question,
  loading,
  answer,
  error,
  ask,
}: {
  question: string
  loading: boolean
  answer: any
  error: string
  ask: (q: string) => void
}) {
  if (loading)
    return (
      <div className="messages">
        <div className="user-message">
          {question}
          <div className="avatar small">SB</div>
        </div>
        <div className="assistant-message loading">
          <div className="assistant-avatar">
            <Icon name="spark" size={16} />
          </div>
          <div>
            <div className="thinking">
              <span />
              <span />
              <span />
            </div>
            <small>Analyse des écritures de ventes et des coûts…</small>
          </div>
        </div>
      </div>
    )
  const restricted = answer?.status === "denied"
  const unsupported = answer?.status === "unsupported"
  const rows = Array.isArray(answer?.table) ? answer.table : []
  const columns = rows.length && rows[0] && typeof rows[0] === "object"
    ? Object.keys(rows[0]).slice(0, 5)
    : []
  return (
    <div className="messages">
      <div className="user-message">
        {question}
        <div className="avatar small">SB</div>
      </div>
      {restricted ? (
        <div className="assistant-message">
          <div className="assistant-avatar">
            <Icon name="lock" size={16} />
          </div>
          <div className="answer-card restricted">
            <Badge tone="warning">Accès restreint</Badge>
            <h2>Demande refusée côté serveur</h2>
            <p>{answer.answer}</p>
          </div>
        </div>
      ) : (
        <div className="assistant-message">
          <div className="assistant-avatar">
            <Icon name="spark" size={16} />
          </div>
          <div className="answer-card">
            {unsupported && <Badge tone="warning">Question non prise en charge</Badge>}
            <p>{error || answer?.answer || "Aucune réponse disponible."}</p>
            {!error && columns.length > 0 && (
              <div className="answer-table-wrap">
                <table className="answer-table">
                  <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
                  <tbody>
                    {rows.slice(0, 10).map((row: Record<string, unknown>, index: number) => (
                      <tr key={index}>{columns.map((column) => <td key={column}>{String(row[column] ?? "—")}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!error && answer?.sources?.length > 0 && <div className="sources">
              <div className="source-title">
                <Icon name="file" size={15} /> Sources consultées{" "}
                <Badge>{answer?.sources?.length ?? 0} enregistrement(s)</Badge>
              </div>
              {answer.sources.slice(0, 4).map((source: string) => (
                <div className="source-row" key={source}>
                  <span>{source}</span>
                </div>
              ))}
            </div>}
            {!error && answer?.answer && <div className="answer-meta">
              <span>{answer?.metadata?.asOf ? `Données arrêtées au ${answer.metadata.asOf}` : "Réponse fondée sur les données ERP autorisées"}</span>
              <button type="button" onClick={() => navigator.clipboard?.writeText(answer.answer)}>Copier</button>
            </div>}
          </div>
        </div>
      )}
      <div className="followups">
        <span>Approfondir</span>
        {(restricted
          ? [
              "Quelles données puis-je consulter ?",
              "Afficher mes droits d’accès",
            ]
          : [
              "Afficher les factures concernées",
              "Comparer les agences",
              "Comment améliorer la marge ?",
            ]
        ).map((q) => (
          <button onClick={() => ask(q)} key={q}>
            {q}
            <Icon name="arrow" size={13} />
          </button>
        ))}
      </div>
    </div>
  )
}

function AccessState() {
  return (
    <div className="access-page">
      <div className="access-head">
        <div className="lock-illustration">
          <Icon name="lock" size={25} />
        </div>
        <div>
          <h1>Accès aux données & confidentialité</h1>
          <p>
            Copilot applique les autorisations de votre profil ERP à chaque
            réponse.
          </p>
        </div>
      </div>
      <section className="panel permissions">
        <div className="panel-head">
          <div>
            <h2>Vos périmètres autorisés</h2>
            <p>Profil : Administratrice commerciale</p>
          </div>
          <Badge tone="success">Profil actif</Badge>
        </div>
        <div className="permission-grid">
          <div>
            <Icon name="check" />
            <span>
              <strong>Ventes & clients</strong>
              <small>Toutes les agences</small>
            </span>
            <Badge tone="success">Autorisé</Badge>
          </div>
          <div>
            <Icon name="check" />
            <span>
              <strong>Achats & fournisseurs</strong>
              <small>Toutes les agences</small>
            </span>
            <Badge tone="success">Autorisé</Badge>
          </div>
          <div>
            <Icon name="check" />
            <span>
              <strong>Stocks & articles</strong>
              <small>Toutes les agences</small>
            </span>
            <Badge tone="success">Autorisé</Badge>
          </div>
          <div className="denied">
            <Icon name="lock" />
            <span>
              <strong>Paie & salaires</strong>
              <small>Données confidentielles</small>
            </span>
            <Badge tone="danger">Restreint</Badge>
          </div>
        </div>
      </section>
      <div className="privacy-note">
        <Icon name="lock" />
        <div>
          <strong>
            Vos données restent dans l’environnement de démonstration
          </strong>
          <p>
            Cette interface simule les contrôles d’accès. Aucune donnée réelle
            n’est transmise à un service externe.
          </p>
        </div>
      </div>
    </div>
  )
}

type ManagementModule = "sales" | "purchases" | "inventory" | "finance"

const managementMeta: Record<
  ManagementModule,
  { title: string; subtitle: string; action: string; icon: IconName }
> = {
  sales: {
    title: "Gestion des ventes",
    subtitle: "Factures clients, avoirs et règlements.",
    action: "Nouvelle facture",
    icon: "sales",
  },
  purchases: {
    title: "Gestion des achats",
    subtitle: "Commandes fournisseurs, réceptions et factures d’achat.",
    action: "Nouvelle commande",
    icon: "cart",
  },
  inventory: {
    title: "Gestion des stocks",
    subtitle: "Disponibilités, mouvements et besoins de réapprovisionnement.",
    action: "Nouveau mouvement",
    icon: "stock",
  },
  finance: {
    title: "Gestion financière",
    subtitle: "Encaissements clients et échéanciers.",
    action: "Nouveau règlement",
    icon: "finance",
  },
}

const dayOptions = [
  ["30", "30 derniers jours"],
  ["90", "90 derniers jours"],
  ["365", "12 derniers mois"],
  ["all", "Toutes les dates"],
] as const

const frDate = (iso: string) => iso.split("-").reverse().join("/")
function formatCell(value: string | number | null, type: PageData["columns"][number]["type"]) {
  if (value === null || value === "") return "—"
  if (typeof value === "string") return type === "date" ? frDate(value) : value
  if (type === "money") return `${fmt3.format(value)} DT`
  if (type === "signed") return `${value > 0 ? "+" : ""}${fmt3.format(value).replace(/,000$/, "")}`
  return fmtInt.format(value)
}
const statValue = (v: number, unit: string) =>
  unit === "DT" ? dt(v) : unit === "%" ? `${fmt1.format(v)} %` : unit === "j" ? `${fmt1.format(v)} j` : fmtInt.format(v)

function exportRows(module: ManagementModule, data: PageData) {
  const head = [...data.columns.map((c) => c.label), "Statut"]
  const lines = data.rows.map((r) => [...r.cells.map((c) => (c === null ? "" : String(c))), r.status.label])
  const csv = [head, ...lines].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(";")).join("\n")
  const link = document.createElement("a")
  link.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }))
  link.download = `${module}-${data.tab}-${data.asOf}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}

type Modal =
  | { kind: "create" }
  | { kind: "pay"; invoiceId: string }
  | { kind: "receive"; orderId: string; label: string }

function ManagementPage({ module }: { module: ManagementModule }) {
  const meta = managementMeta[module]
  const [tab, setTab] = useState("")
  const [days, setDays] = useState("30")
  const [search, setSearch] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [data, setData] = useState<PageData | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [modal, setModal] = useState<Modal | null>(null)
  const [notice, setNotice] = useState("")
  // Debounce typing so each keystroke does not hit the API.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search)
      setPage(1)
    }, 250)
    return () => clearTimeout(t)
  }, [search])
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .page(module, { tab, days, q: query, page })
      .then((result) => {
        if (cancelled) return
        setData(result)
        setError("")
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof TypeError ? "API injoignable : lancez npm run dev:api" : e.message)
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [module, tab, days, query, page, reload])

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const done = (message: string) => {
    setModal(null)
    setNotice(message)
    setReload((n) => n + 1)
  }
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>{meta.title}</h1>
          <p>{meta.subtitle}</p>
        </div>
        <div className="heading-actions">
          <Button
            variant="secondary"
            icon="download"
            disabled={!data?.rows.length}
            onClick={() => data && exportRows(module, data)}
          >
            Exporter
          </Button>
          <Button icon="plus" onClick={() => setModal({ kind: "create" })}>
            {meta.action}
          </Button>
        </div>
      </div>
      {error && (
        <div className="dashboard-error" role="alert">
          <span>
            <strong>Données indisponibles.</strong> {error}
          </span>
          <Button variant="ghost" onClick={() => setReload((n) => n + 1)}>
            Réessayer
          </Button>
        </div>
      )}
      {notice && (
        <div className="erp-notice" role="status">
          <Icon name="check" size={16} />
          <span>{notice}</span>
          <button onClick={() => setNotice("")} aria-label="Fermer">
            ×
          </button>
        </div>
      )}
      <section className={`stats-grid${loading ? " is-loading" : ""}`}>
        {(data?.stats ?? []).map((s) => (
          <StatCard
            key={s.label}
            label={s.label}
            value={statValue(s.value, s.unit)}
            delta={s.delta ?? ""}
            deltaTone={s.deltaTone}
            note={s.note}
            icon={s.icon as IconName}
            tone={s.tone}
          />
        ))}
      </section>
      <section className="panel management-panel">
        <div className="management-tabs">
          {(data?.tabs ?? []).map((item) => (
            <button
              key={item.id}
              className={data?.tab === item.id ? "active" : ""}
              onClick={() => {
                setTab(item.id)
                setPage(1)
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="table-toolbar">
          <div className="search-field">
            <Icon name="search" size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un document, un tiers ou un article"
            />
          </div>
          {!(module === "inventory" && data?.tab !== "movements") &&
            !(module === "finance" && data?.tab === "receivables") && (
              <label className="field compact toolbar-field">
                <select
                  value={days}
                  onChange={(e) => {
                    setDays(e.target.value)
                    setPage(1)
                  }}
                >
                  {dayOptions.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {(data?.columns ?? []).map((c) => (
                  <th key={c.label} className={c.type !== "text" && c.type !== "date" ? "number" : ""}>
                    {c.label}
                  </th>
                ))}
                {data && <th>Statut</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((row) => (
                <tr key={row.id}>
                  {row.cells.map((cell, i) => {
                    const type = data!.columns[i].type
                    return (
                      <td
                        key={i}
                        className={
                          type === "text" || type === "date"
                            ? ""
                            : `number${type === "signed" && typeof cell === "number" ? (cell < 0 ? " down" : " up") : ""}`
                        }
                      >
                        {i === 0 ? <strong>{formatCell(cell, type)}</strong> : formatCell(cell, type)}
                      </td>
                    )
                  })}
                  <td>
                    <Badge tone={row.status.tone}>{row.status.label}</Badge>
                  </td>
                  <td>
                    {row.action && (
                      <button
                        className="link-button"
                        onClick={() =>
                          setModal(
                            row.action!.id === "pay"
                              ? { kind: "pay", invoiceId: row.id }
                              : { kind: "receive", orderId: row.id, label: String(row.cells[0]) },
                          )
                        }
                      >
                        {row.action.label}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.rows.length === 0 && (
          <div className="table-empty">
            <Icon name={query ? "search" : "file"} size={24} />
            <strong>{query ? "Aucun résultat" : "Aucune donnée pour le moment"}</strong>
            <span>
              {query
                ? "Modifiez votre recherche ou la période."
                : `Utilisez « ${meta.action} » pour créer le premier enregistrement.`}
            </span>
          </div>
        )}
        <div className="table-footer">
          <span>
            {data
              ? `${fmtInt.format(data.total)} résultat${data.total > 1 ? "s" : ""} · page ${data.page} / ${pages}`
              : "Chargement…"}
          </span>
          <div>
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Précédent
            </button>
            <button className="active">{page}</button>
            <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Suivant
            </button>
          </div>
        </div>
      </section>
      {modal && (
        <ErpModal
          module={module}
          modal={modal}
          title={modal.kind === "create" ? meta.action : modal.kind === "pay" ? "Enregistrer un règlement" : `Réceptionner ${modal.label}`}
          icon={modal.kind === "receive" ? "stock" : modal.kind === "pay" ? "finance" : meta.icon}
          onCancel={() => setModal(null)}
          onDone={done}
        />
      )}
    </div>
  )
}

type LineDraft = { product: string; categoryId: string; quantity: string; price: string; discount: string; vat: string; cost: string }
const emptyLine: LineDraft = { product: "", categoryId: "", quantity: "1", price: "", discount: "0", vat: "", cost: "" }
const num = (s: string) => Number(s.replace(",", "."))
const productLabel = (p: Lookups["products"][number]) => `${p.sku} — ${p.name}`

function ErpModal({
  module,
  modal,
  title,
  icon,
  onCancel,
  onDone,
}: {
  module: ManagementModule
  modal: Modal
  title: string
  icon: IconName
  onCancel: () => void
  onDone: (message: string) => void
}) {
  const [lookups, setLookups] = useState<Lookups | null>(null)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [agency, setAgency] = useState("")
  const [party, setParty] = useState("")
  const [date, setDate] = useState("")
  const [dueDays, setDueDays] = useState("30")
  const [lines, setLines] = useState<LineDraft[]>([{ ...emptyLine }])
  const [received, setReceived] = useState(true)
  const [invoiceNumber, setInvoiceNumber] = useState("")
  const [moveType, setMoveType] = useState<"receipt" | "adjustment">("receipt")
  const [reorderPoint, setReorderPoint] = useState("")
  const [invoiceId, setInvoiceId] = useState(modal.kind === "pay" ? modal.invoiceId : "")
  const [amount, setAmount] = useState("")
  const [method, setMethod] = useState("virement")
  useEffect(() => {
    api
      .lookups()
      .then((l) => {
        setLookups(l)
        setAgency(l.agencies[0]?.name ?? "")
        setDate(l.asOf)
        const open = l.openInvoices.find((i) => i.id === (modal.kind === "pay" ? modal.invoiceId : ""))
        if (open) setAmount(String(open.outstanding))
      })
      .catch((e) => setError(e instanceof TypeError ? "API injoignable : lancez npm run dev:api" : e.message))
  }, [modal])

  const findProduct = (text: string) =>
    lookups?.products.find((p) => productLabel(p) === text || p.name.toLowerCase() === text.trim().toLowerCase())
  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((ls) =>
      ls.map((l, j) => {
        if (j !== i) return l
        const next = { ...l, ...patch }
        // Prefill price/cost/VAT when an existing product is picked.
        const p = patch.product !== undefined ? findProduct(patch.product) : undefined
        if (p) {
          if (!next.price && p.listPrice != null) next.price = String(p.listPrice)
          if (!next.cost && p.unitCost != null) next.cost = String(p.unitCost)
          if (!next.vat && p.vatRate != null) next.vat = String(p.vatRate)
        }
        return next
      }),
    )
  const lineRef = (l: LineDraft) => {
    const p = findProduct(l.product)
    return p ? { productId: p.id } : { productName: l.product.trim(), categoryId: l.categoryId }
  }
  const partyRef = (list: { id: string; name: string }[], idKey: string, nameKey: string) => {
    const match = list.find((x) => x.name.toLowerCase() === party.trim().toLowerCase())
    return match ? { [idKey]: match.id } : { [nameKey]: party.trim() }
  }
  const linesTotal = lines.reduce(
    (s, l) => s + (num(l.quantity) || 0) * (num(module === "sales" ? l.price : l.cost) || 0) * (1 - (num(l.discount) || 0) / 100),
    0,
  )

  const submit = async () => {
    setSaving(true)
    setError("")
    try {
      if (modal.kind === "pay" || (modal.kind === "create" && module === "finance")) {
        await api.createPayment({ salesInvoiceId: invoiceId, amount: num(amount), method, date })
        onDone("Règlement enregistré.")
      } else if (modal.kind === "receive") {
        const r = await api.receivePurchaseOrder(modal.orderId, { date, supplierInvoiceNumber: invoiceNumber || undefined })
        onDone(`Réception enregistrée : facture fournisseur ${r.number} créée et stock mis à jour.`)
      } else if (module === "sales") {
        const r = await api.createSalesInvoice({
          agency,
          ...partyRef(lookups!.customers, "customerId", "customerName"),
          date,
          dueDays: Number(dueDays),
          lines: lines.map((l) => ({
            ...lineRef(l),
            quantity: num(l.quantity),
            unitPrice: num(l.price),
            discountPct: num(l.discount) || 0,
            ...(l.vat ? { vatRate: Number(l.vat) } : {}),
            ...(l.cost ? { unitCost: num(l.cost) } : {}),
          })),
        })
        onDone(`Facture ${r.number} créée.`)
      } else if (module === "purchases") {
        const r = await api.createPurchaseOrder({
          agency,
          ...partyRef(lookups!.suppliers, "supplierId", "supplierName"),
          date,
          received,
          ...(received && invoiceNumber ? { supplierInvoiceNumber: invoiceNumber } : {}),
          lines: lines.map((l) => ({
            ...lineRef(l),
            quantity: num(l.quantity),
            unitCost: num(l.cost),
            ...(l.vat ? { vatRate: Number(l.vat) } : {}),
          })),
        })
        onDone(received ? `Commande ${r.id} reçue : facture fournisseur et stock mis à jour.` : `Commande ${r.id} créée.`)
      } else {
        const l = lines[0]
        const r = await api.createStockMovement({
          ...lineRef(l),
          agency,
          date,
          type: moveType,
          quantity: num(l.quantity),
          ...(l.cost ? { unitCost: num(l.cost) } : {}),
          ...(reorderPoint ? { reorderPoint: Number(reorderPoint) } : {}),
        })
        onDone(`Mouvement ${r.reference} enregistré.`)
      }
    } catch (e) {
      setError(e instanceof TypeError ? "API injoignable : lancez npm run dev:api" : (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const isPayment = modal.kind === "pay" || (modal.kind === "create" && module === "finance")
  const showLines = modal.kind === "create" && module !== "finance"
  const singleLine = module === "inventory"
  return (
    <div className="modal-backdrop">
      <div className="modal create-modal erp-modal">
        <div className="modal-icon module">
          <Icon name={icon} size={22} />
        </div>
        <h2>{title}</h2>
        {!lookups && !error && <p>Chargement…</p>}
        {lookups && (
          <div className="create-form">
            {modal.kind === "create" && module !== "finance" && (
              <label className="field">
                <span>Agence</span>
                <select value={agency} onChange={(e) => setAgency(e.target.value)}>
                  {lookups.agencies.map((a) => (
                    <option key={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              <span>Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            {modal.kind === "create" && (module === "sales" || module === "purchases") && (
              <label className="field span-2">
                <span>{module === "sales" ? "Client" : "Fournisseur"} (existant ou nouveau)</span>
                <input
                  list="erp-parties"
                  value={party}
                  onChange={(e) => setParty(e.target.value)}
                  placeholder={module === "sales" ? "Nom du client" : "Nom du fournisseur"}
                />
                <datalist id="erp-parties">
                  {(module === "sales" ? lookups.customers : lookups.suppliers).map((x) => (
                    <option key={x.id} value={x.name} />
                  ))}
                </datalist>
              </label>
            )}
            {modal.kind === "create" && module === "sales" && (
              <label className="field">
                <span>Délai de paiement (jours)</span>
                <input type="number" min="0" value={dueDays} onChange={(e) => setDueDays(e.target.value)} />
              </label>
            )}
            {modal.kind === "create" && module === "inventory" && (
              <label className="field">
                <span>Type de mouvement</span>
                <select value={moveType} onChange={(e) => setMoveType(e.target.value as "receipt" | "adjustment")}>
                  <option value="receipt">Réception (entrée)</option>
                  <option value="adjustment">Ajustement d’inventaire (+/−)</option>
                </select>
              </label>
            )}
            {(modal.kind === "receive" || (modal.kind === "create" && module === "purchases" && received)) && (
              <label className="field">
                <span>N° facture fournisseur (facultatif)</span>
                <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Généré si vide" />
              </label>
            )}
            {isPayment && (
              <>
                <label className="field span-2">
                  <span>Facture client</span>
                  <select
                    value={invoiceId}
                    onChange={(e) => {
                      setInvoiceId(e.target.value)
                      const open = lookups.openInvoices.find((i) => i.id === e.target.value)
                      setAmount(open ? String(open.outstanding) : "")
                    }}
                  >
                    <option value="">Sélectionner une facture non réglée…</option>
                    {lookups.openInvoices.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.number} · {i.customer} · reste {fmt3.format(i.outstanding)} DT
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Montant (DT)</span>
                  <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </label>
                <label className="field">
                  <span>Mode</span>
                  <select value={method} onChange={(e) => setMethod(e.target.value)}>
                    <option value="virement">Virement</option>
                    <option value="chèque">Chèque</option>
                    <option value="espèces">Espèces</option>
                    <option value="traite">Traite</option>
                  </select>
                </label>
                {lookups.openInvoices.length === 0 && (
                  <p className="span-2 erp-hint">Aucune facture client à régler. Créez d’abord une facture dans Ventes.</p>
                )}
              </>
            )}
            {showLines && (
              <div className="span-2 erp-lines">
                <datalist id="erp-products">
                  {lookups.products.map((p) => (
                    <option key={p.id} value={productLabel(p)} />
                  ))}
                </datalist>
                {lines.map((l, i) => {
                  const isNew = l.product.trim() !== "" && !findProduct(l.product)
                  return (
                    <div className="erp-line" key={i}>
                      <label className="field">
                        <span>Article {isNew && <em>(nouveau)</em>}</span>
                        <input
                          list="erp-products"
                          value={l.product}
                          onChange={(e) => setLine(i, { product: e.target.value })}
                          placeholder="Référence ou nom"
                        />
                      </label>
                      {isNew && (
                        <label className="field">
                          <span>Famille</span>
                          <select value={l.categoryId} onChange={(e) => setLine(i, { categoryId: e.target.value })}>
                            <option value="">Choisir…</option>
                            {lookups.categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <label className="field">
                        <span>{module === "inventory" && moveType === "adjustment" ? "Quantité (+/−)" : "Quantité"}</span>
                        <input inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                      </label>
                      {module === "sales" && (
                        <>
                          <label className="field">
                            <span>Prix unitaire HT</span>
                            <input inputMode="decimal" value={l.price} onChange={(e) => setLine(i, { price: e.target.value })} />
                          </label>
                          <label className="field">
                            <span>Remise %</span>
                            <input inputMode="decimal" value={l.discount} onChange={(e) => setLine(i, { discount: e.target.value })} />
                          </label>
                        </>
                      )}
                      {(module !== "sales" || isNew) && (
                        <label className="field">
                          <span>Coût unitaire HT</span>
                          <input inputMode="decimal" value={l.cost} onChange={(e) => setLine(i, { cost: e.target.value })} />
                        </label>
                      )}
                      {module !== "inventory" && (
                        <label className="field">
                          <span>TVA</span>
                          <select value={l.vat} onChange={(e) => setLine(i, { vat: e.target.value })}>
                            <option value="">Auto</option>
                            {[19, 13, 7, 0].map((v) => (
                              <option key={v} value={v}>
                                {v} %
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {!singleLine && lines.length > 1 && (
                        <button className="erp-remove" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Retirer la ligne">
                          ×
                        </button>
                      )}
                    </div>
                  )
                })}
                {!singleLine && (
                  <div className="erp-lines-foot">
                    <Button variant="ghost" icon="plus" onClick={() => setLines((ls) => [...ls, { ...emptyLine }])}>
                      Ajouter une ligne
                    </Button>
                    <span>Total HT : {fmt3.format(linesTotal)} DT</span>
                  </div>
                )}
              </div>
            )}
            {modal.kind === "create" && module === "inventory" && (
              <label className="field">
                <span>Seuil de réapprovisionnement (facultatif)</span>
                <input type="number" min="0" value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} />
              </label>
            )}
            {modal.kind === "create" && module === "purchases" && (
              <label className="erp-check span-2">
                <input type="checkbox" checked={received} onChange={(e) => setReceived(e.target.checked)} />
                Marchandise déjà reçue : créer la facture fournisseur et entrer en stock
              </label>
            )}
          </div>
        )}
        {error && <div className="erp-error">{error}</div>}
        <div className="modal-actions">
          <Button variant="secondary" onClick={onCancel}>
            Annuler
          </Button>
          <Button disabled={!lookups || saving} onClick={() => void submit()}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </div>
    </div>
  )
}

function SettingsPage() {
  const [section, setSection] = useState("Société")
  const sections = [
    ["Société", "Informations légales et fiscales", "settings"],
    ["Utilisateurs & rôles", "Accès, profils et autorisations", "lock"],
    ["Documents", "Numérotation et modèles", "file"],
    ["Taxes & comptabilité", "TVA, timbre et journaux", "finance"],
    ["Intégrations", "Connexions et synchronisation", "spark"],
  ] as const
  return (
    <div className="page settings-page">
      <div className="page-heading">
        <div>
          <h1>Paramètres</h1>
          <p>
            Configurez votre société, vos utilisateurs et les règles de gestion.
          </p>
        </div>
        <Button>Enregistrer les modifications</Button>
      </div>
      <div className="settings-layout">
        <aside className="panel settings-nav">
          {sections.map(([label, description, icon]) => (
            <button
              key={label}
              className={section === label ? "active" : ""}
              onClick={() => setSection(label)}
            >
              <Icon name={icon} size={17} />
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
              <Icon name="arrow" size={14} />
            </button>
          ))}
        </aside>
        <section className="panel settings-content">
          {section === "Société" ? (
            <>
              <div className="settings-head">
                <div>
                  <h2>Informations de la société</h2>
                  <p>
                    Ces informations apparaissent sur vos documents commerciaux.
                  </p>
                </div>
                <Badge tone="success">Dossier actif</Badge>
              </div>
              <div className="company-profile">
                <div className="company-big-logo">CM</div>
                <div>
                  <strong>CARTHAGE MOBILIER SARL</strong>
                  <span>Entreprise résidente · Tunisie</span>
                </div>
                <Button variant="secondary">Modifier le logo</Button>
              </div>
              <div className="settings-form">
                <label className="field span-2">
                  <span>Raison sociale</span>
                  <input defaultValue="CARTHAGE MOBILIER SARL" />
                </label>
                <label className="field">
                  <span>Matricule fiscal</span>
                  <input defaultValue="9876543/B/A/M/000" />
                </label>
                <label className="field">
                  <span>Registre national des entreprises</span>
                  <input defaultValue="B24185672019" />
                </label>
                <label className="field span-2">
                  <span>Adresse du siège</span>
                  <input defaultValue="52, Avenue de Carthage — 1000 Tunis" />
                </label>
                <label className="field">
                  <span>Téléphone</span>
                  <input defaultValue="+216 71 245 680" />
                </label>
                <label className="field">
                  <span>E-mail</span>
                  <input defaultValue="contact@carthage-mobilier.tn" />
                </label>
                <label className="field">
                  <span>Devise principale</span>
                  <select>
                    <option>Dinar tunisien (TND)</option>
                  </select>
                </label>
                <label className="field">
                  <span>Exercice en cours</span>
                  <select>
                    <option>2025</option>
                  </select>
                </label>
              </div>
            </>
          ) : (
            <div className="settings-placeholder">
              <div className="empty-icon">
                <Icon
                  name={
                    sections.find(([label]) => label === section)?.[2] ??
                    "settings"
                  }
                  size={25}
                />
              </div>
              <h2>{section}</h2>
              <p>
                Les réglages de cette rubrique sont disponibles dans
                l’environnement de démonstration.
              </p>
              <div className="setting-rows">
                <div>
                  <span>Configuration principale</span>
                  <Badge tone="success">Configurée</Badge>
                </div>
                <div>
                  <span>Règles et autorisations</span>
                  <button className="link-button">Gérer</button>
                </div>
                <div>
                  <span>Dernière modification</span>
                  <strong>28/02/2025 · Sonia Ben Amor</strong>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

export default function App() {
  const [module, setModule] = useState<Module>("dashboard")
  const content = useMemo(() => {
    if (
      module === "sales" ||
      module === "purchases" ||
      module === "inventory" ||
      module === "finance"
    )
      return <ManagementPage module={module} />
    if (module === "ocr") return <OCRModule />
    if (module === "bi") return <BIModule />
    if (module === "copilot") return <CopilotModule />
    if (module === "settings") return <SettingsPage />
    return <Dashboard navigate={setModule} />
  }, [module])
  return (
    <div className="app-shell">
      <Sidebar active={module} navigate={setModule} />
      <main className="main">
        <Topbar module={module} />
        {content}
      </main>
    </div>
  )
}
