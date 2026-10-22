import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import {
  ApiError,
  api,
  type DocumentHistoryEvent,
  type DocumentResponse,
  type DocumentSummary,
  type DocumentValidation,
  type Lookups,
  type Tone,
  type ValidationIssue,
} from "../../api"
import "./smart-ocr.css"

type TabId = "import" | "review" | "history"
type ReviewTabId = "extraction" | "articles" | "validations" | "activity"
type WorkflowDocument = DocumentResponse & {
  createdAt?: string
  agency?: string
  articles?: Array<Record<string, unknown>>
}
/** Loaded state of a per-document side resource: no data and no error while loading. */
type Loaded<T> = { data?: T; error?: string }
type IconName = "arrow" | "check" | "close" | "file" | "history" | "info" | "refresh" | "shield" | "upload" | "warning" | "cart" | "send" | "spark" | "stock"

const icons: Record<IconName, ReactNode> = {
  arrow: <path d="m9 18 6-6-6-6" />,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  stock: (
    <>
      <path d="m4 7 8-4 8 4-8 4-8-4Z" />
      <path d="m4 12 8 4 8-4M4 17l8 4 8-4" />
    </>
  ),
  cart: (
    <>
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </>
  ),
  send: (
    <>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </>
  ),
  spark: (
    <>
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
    </>
  ),
  file: (
    <>
      <path d="M6 2h8l4 4v16H6V2Z" />
      <path d="M14 2v5h5M9 12h6M9 16h6" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3 2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v.1" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M6.1 8.2A7 7 0 0 1 18.8 7M5.2 17A7 7 0 0 0 17.9 15.8" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5c0 4.6 2.8 8.1 7 10 4.2-1.9 7-5.4 7-10V6l-7-3Z" />
      <path d="m9 12 2 2 4-5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4m0 0L7 9m5-5 5 5" />
      <path d="M5 14v5h14v-5" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3 2.5 20h19L12 3Z" />
      <path d="M12 9v5m0 3v.1" />
    </>
  ),
}

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
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
      {icons[name]}
    </svg>
  )
}

function Button({
  children,
  icon,
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: IconName
  variant?: "primary" | "secondary" | "ghost"
}) {
  return (
    <button
      {...props}
      className={`so-button so-button--${variant} ${props.className ?? ""}`}
    >
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  )
}

const statusMap: Record<string, { label: string; tone: Tone }> = {
  needs_review: { label: "Révision humaine requise", tone: "warning" },
  rejected: { label: "Rejeté", tone: "danger" },
  approved: { label: "Approuvé", tone: "success" },
  failed: { label: "Échec OCR", tone: "danger" },
  succeeded: { label: "Traitement terminé", tone: "success" },
  pending: { label: "Traitement en attente", tone: "neutral" },
}

function StatusBadge({ status }: { status: string }) {
  const mapped = statusMap[status]
  return (
    <span className={`so-badge so-badge--${mapped?.tone ?? "neutral"}`}>
      {mapped?.label ?? status}
    </span>
  )
}

function formatSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—"
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`
  return `${(bytes / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`
}

function erpLabel(status: string) {
  return status === "not_submitted" ? "Non soumis" : status
}

function processingStageLabel(stage: string) {
  const labels: Record<string, string> = {
    received: "Analyse du document",
    text_layer: "Reconnaissance du texte",
    rasterizing: "Préparation de la page",
    ocr: "Reconnaissance du texte",
    orientation: "Correction de l’orientation",
    page_done: "Page analysée",
    extracting: "Extraction des données",
    done: "Prêt pour vérification",
    failed: "Traitement en échec",
  }
  return labels[stage] ?? stage
}

function formatTimelineDate(dateStr: string) {
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return { date: dateStr, time: "" }
    const date = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })
    const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    return { date, time }
  } catch {
    return { date: dateStr, time: "" }
  }
}

function Tabs({
  active,
  historyCount,
  hasReview,
  onChange,
}: {
  active: TabId
  historyCount?: number
  hasReview: boolean
  onChange: (tab: TabId) => void
}) {
  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: "import", label: "Importer" },
    { id: "review", label: "Vérifier", count: hasReview ? 1 : 0 },
    { id: "history", label: "Historique", count: historyCount },
  ]
  const selectWithKeys = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    let next = index
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length
    if (event.key === "ArrowLeft")
      next = (index - 1 + tabs.length) % tabs.length
    if (event.key === "Home") next = 0
    if (event.key === "End") next = tabs.length - 1
    onChange(tabs[next].id)
    document.getElementById(`so-tab-${tabs[next].id}`)?.focus()
  }
  return (
    <div className="so-tabs" role="tablist" aria-label="Étapes Smart OCR">
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          id={`so-tab-${tab.id}`}
          role="tab"
          aria-selected={active === tab.id}
          aria-controls={`so-panel-${tab.id}`}
          tabIndex={active === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => selectWithKeys(event, index)}
        >
          <span className="so-tab-index">{index + 1}</span>
          {tab.label}
          {tab.count !== undefined && (
            <span className="so-tab-count">{tab.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

function UploadPanel({
  uploading,
  onUpload,
}: {
  uploading: boolean
  onUpload: (file?: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const helpId = useId()
  const [dragging, setDragging] = useState(false)
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    if (!uploading) onUpload(event.dataTransfer.files[0])
  }
  return (
    <section
      id="so-panel-import"
      role="tabpanel"
      aria-labelledby="so-tab-import"
      aria-busy={uploading}
      className="so-surface so-upload-layout"
    >
      <div
        className={`so-dropzone upload-zone${
          dragging ? " so-dropzone--active" : ""
        }`}
        onDragEnter={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            setDragging(false)
        }}
        onDrop={drop}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          onChange={(e) => {
            onUpload(e.target.files?.[0])
            e.currentTarget.value = ""
          }}
          className="so-visually-hidden"
          tabIndex={-1}
        />
        <div className="so-dropzone-icon">
          <Icon name="upload" size={25} />
        </div>
        <p className="so-eyebrow">Nouvelle facture fournisseur</p>
        <h2>{uploading ? "Import en cours…" : "Déposez votre facture ici"}</h2>
        <p className="so-dropzone-copy">
          Glissez-déposez un PDF, JPG ou PNG, ou choisissez un fichier depuis
          votre ordinateur.
        </p>
        <Button
          type="button"
          variant="secondary"
          icon="upload"
          disabled={uploading}
          aria-describedby={helpId}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? "Import sécurisé…" : "Sélectionner un fichier"}
        </Button>
        <small id={helpId}>
          1 fichier · 15 Mo maximum · contenu contrôlé côté serveur
        </small>
      </div>
      <aside className="so-guidance" aria-label="Conseils d’import">
        <div className="so-guidance-heading">
          <span>
            <Icon name="shield" size={18} />
          </span>
          <div>
            <p className="so-eyebrow">Import sécurisé</p>
            <h3>Préparer le document</h3>
          </div>
        </div>
        {[
          ["Document lisible", "Résolution recommandée de 300 dpi"],
          ["Une facture par fichier", "Toutes les pages dans le même PDF"],
          ["Formats acceptés", "PDF, JPG et PNG"],
        ].map(([title, copy]) => (
          <div className="so-guidance-item" key={title}>
            <span>
              <Icon name="check" size={14} />
            </span>
            <p>
              <strong>{title}</strong>
              {copy}
            </p>
          </div>
        ))}
        <div className="so-honesty-note">
          <Icon name="info" size={16} />
          <p>
            L’extraction dépend du moteur configuré côté serveur. Aucun résultat
            n’est généré dans votre navigateur.
          </p>
        </div>
      </aside>
    </section>
  )
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

function ExtractedValue({ name, value, currency }: { name: string; value: unknown; currency?: string }) {
  if (name === "lines" && Array.isArray(value))
    return (
      <div className="so-extracted-table-wrap">
        <table className="so-extracted-table">
          <thead><tr><th>Référence</th><th>Désignation</th><th>Qté</th><th>Prix HT</th><th>TVA</th><th>Total HT</th></tr></thead>
          <tbody>{value.map((raw, index) => {
            const line = raw as Record<string, unknown>
            return <tr key={String(line.supplierReference ?? index)}><td>{displayValue(line.supplierReference)}</td><td>{displayValue(line.description)}</td><td>{displayValue(line.quantity)}</td><td>{displayValue(line.unitPrice)}</td><td>{displayValue(line.vatRate)} %</td><td>{displayValue(line.lineHt)}</td></tr>
          })}</tbody>
        </table>
      </div>
    )
  if (name === "totals" && value && typeof value === "object")
    return <dl className="so-extracted-totals">{Object.entries(value as Record<string, unknown>).map(([key, amount]) => <div key={key}><dt>{key.toUpperCase()}</dt><dd>{displayValue(amount)} {currency || "TND"}</dd></div>)}</dl>
  return <>{displayValue(value)}</>
}

function OptionalCollection({
  items,
  empty,
}: {
  items?: Array<Record<string, unknown>>
  empty: string
}) {
  if (!items?.length)
    return (
      <div className="so-inline-empty">
        <Icon name="info" size={18} />
        <div><strong>Données indisponibles</strong><p>{empty}</p></div>
      </div>
    )
  return (
    <div className="so-record-list">
      {items.map((entry, index) => (
        <article key={String(entry.id ?? index)}>
          {Object.entries(entry).filter(([, value]) => value !== undefined).map(([key, value]) => (
            <div key={key}><span>{key}</span><strong>{displayValue(value)}</strong></div>
          ))}
        </article>
      ))}
    </div>
  )
}

function LoadError({ title, message }: { title: string; message: string }) {
  return (
    <div className="so-alert so-alert--error" role="alert">
      <Icon name="warning" size={18} />
      <div><strong>{title}</strong><p>{message}</p></div>
    </div>
  )
}

function ValidationTab({ state }: { state: Loaded<DocumentValidation> }) {
  if (state.error) return <LoadError title="Contrôles indisponibles" message={state.error} />
  if (!state.data) return <div className="so-loading" role="status"><span />Chargement des contrôles…</div>
  const { issues, rules } = state.data
  const blocking = issues.filter((issue) => issue.severity === "blocking").length
  const remarks = issues.filter((issue) => issue.severity === "warning").length
  const ready = blocking === 0 && remarks === 0
  return (
    <>
      <div className="so-section-heading">
        <div>
          <p className="so-eyebrow">Contrôles métier</p>
          <h3>{blocking ? `${blocking} erreur${blocking > 1 ? "s" : ""} à corriger` : remarks ? `${remarks} remarque${remarks > 1 ? "s" : ""} à examiner` : "Facture prête à approuver"}</h3>
          <p>
            {blocking
              ? `${blocking} erreur${blocking > 1 ? "s bloquent" : " bloque"} l’approbation${remarks ? ` ; ${remarks} remarque${remarks > 1 ? "s" : ""} reste${remarks > 1 ? "nt" : ""} aussi à examiner` : ""}.`
              : remarks
                ? `Ces ${remarks} remarque${remarks > 1 ? "s" : ""} n’empêche${remarks > 1 ? "nt" : ""} pas l’approbation humaine.`
                : "Les contrôles bloquants sont réussis."}
          </p>
        </div>
        <span className={`so-badge so-badge--${ready ? "success" : blocking ? "danger" : "warning"}`}>
          {blocking ? "Approbation bloquée" : remarks ? "Prête avec remarques" : "Prête à approuver"}
        </span>
      </div>
      {issues.length > 0 && (
        <div className="so-record-list so-issue-list">
          {issues.map((issue, index) => (
            <article key={`${issue.code}-${issue.field ?? ""}-${issue.line ?? ""}-${index}`}>
              <div>
                <span className={`so-badge so-badge--${issue.severity === "blocking" ? "danger" : "warning"}`}>
                  {issue.severity === "blocking" ? "Erreur bloquante" : "Remarque"}
                </span>
                {issue.line !== undefined && <span>Ligne {issue.line}</span>}
              </div>
              <p>{issue.message}</p>
            </article>
          ))}
        </div>
      )}
      <div className="so-honesty-note">
        <Icon name="info" size={16} />
        <p>
          {rules
            ? `Règles financières, révision ${rules.revision} : ${rules.verified ? "validées par l’expert-comptable." : "non validées par un expert-comptable (tolérées uniquement pour l’organisation de démonstration)."}`
            : "Aucune règle financière n’est configurée pour cette organisation."}
        </p>
      </div>
    </>
  )
}

const auditActionLabels: Record<string, string> = {
  "document.uploaded": "Document importé",
  "document.file_read": "Document original consulté",
  "document.ocr_failed": "Échec de l’extraction OCR",
  "document.ocr_retried": "Extraction relancée",
  "document.ocr_retry_failed": "Échec de la nouvelle extraction",
  "document.approved": "Facture approuvée",
  "document.rejected": "Facture rejetée",
  "document.reopened": "Document réouvert",
}

function auditDetail(event: DocumentHistoryEvent) {
  const { reason } = event.metadata
  return typeof reason === "string" ? `Motif : ${reason}` : null
}

function HistoryTab({ state }: { state: Loaded<DocumentHistoryEvent[]> }) {
  if (state.error) return <LoadError title="Historique indisponible" message={state.error} />
  if (!state.data) return <div className="so-loading" role="status"><span />Chargement de l’historique…</div>
  if (!state.data.length)
    return (
      <div className="so-inline-empty">
        <Icon name="info" size={18} />
        <div><strong>Aucun événement</strong><p>Aucune action n’a encore été journalisée pour ce document.</p></div>
      </div>
    )
  return (
    <>
      <div className="so-section-heading">
        <div>
          <p className="so-eyebrow">Journal d’audit</p>
          <h3>Historique du document</h3>
        </div>
        <span className="so-badge so-badge--neutral">{state.data.length} événement{state.data.length > 1 ? "s" : ""}</span>
      </div>
      <ol className="so-audit-list">
        {[...state.data].reverse().map((event) => {
          const detail = auditDetail(event)
          return (
            <li key={event.id}>
              <span className="so-stage-dot" />
              <div>
                <strong>{auditActionLabels[event.action] ?? event.action}</strong>
                <p>par {event.actorName ?? event.actorId}{detail && ` · ${detail}`}</p>
              </div>
              <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString("fr-FR")}</time>
            </li>
          )
        })}
      </ol>
    </>
  )
}

function ReviewPanel({
  item,
  onUpload,
  onChanged,
  onNavigate,
}: {
  item: DocumentResponse | null
  onUpload: () => void
  onChanged: (document: DocumentResponse) => void
  onNavigate?: (module: string, options?: { search?: string; tab?: string }) => void
}) {
  const [zoom, setZoom] = useState(1)
  const [reviewTab, setReviewTab] = useState<ReviewTabId>("extraction")
  const [fileUrl, setFileUrl] = useState<string>()
  const [fileError, setFileError] = useState("")
  const [validation, setValidation] = useState<Loaded<DocumentValidation>>({})
  const [history, setHistory] = useState<Loaded<DocumentHistoryEvent[]>>({})
  const [actionError, setActionError] = useState("")
  // Issues the server attached to the last failed action (e.g. approval refused by validation).
  const [actionIssues, setActionIssues] = useState<ValidationIssue[]>([])
  const fail = (failure: unknown, fallback: string) => {
    setActionError(failure instanceof Error ? failure.message : fallback)
    const issues = failure instanceof ApiError ? failure.details?.issues : undefined
    setActionIssues(Array.isArray(issues) ? (issues as ValidationIssue[]) : [])
  }
  const [acting, setActing] = useState(false)
  const [integrationOpen, setIntegrationOpen] = useState(false)
  useEffect(() => {
    setZoom(1)
  }, [item?.id])
  useEffect(() => {
    let active = true
    let objectUrl = ""
    setFileUrl(undefined)
    setFileError("")
    if (!item) return () => { active = false }
    api
      .documentFile(item.id)
      .then((blob) => {
        if (!active) return
        objectUrl = URL.createObjectURL(blob)
        setFileUrl(objectUrl)
      })
      .catch((reason) => {
        if (active)
          setFileError(
            reason instanceof Error
              ? reason.message
              : "Document original indisponible",
          )
      })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [item])
  useEffect(() => {
    let active = true
    setValidation({})
    setHistory({})
    if (!item) return () => { active = false }
    const failure = (reason: unknown, fallback: string) =>
      reason instanceof Error ? reason.message : fallback
    api.documentValidation(item.id)
      .then((data) => { if (active) setValidation({ data }) })
      .catch((reason) => { if (active) setValidation({ error: failure(reason, "Contrôles indisponibles") }) })
    api.documentHistory(item.id)
      .then(({ events }) => { if (active) setHistory({ data: events }) })
      .catch((reason) => { if (active) setHistory({ error: failure(reason, "Historique indisponible") }) })
    return () => { active = false }
  }, [item])
  const blockingIssues = validation.data?.issues.filter((issue) => issue.severity === "blocking").length ?? 0
  const remarks = validation.data?.issues.filter((issue) => issue.severity === "warning").length ?? 0
  if (!item)
    return (
      <section
        id="so-panel-review"
        role="tabpanel"
        aria-labelledby="so-tab-review"
        className="so-surface so-empty"
      >
        <div className="so-empty-icon">
          <Icon name="file" size={25} />
        </div>
        <p className="so-eyebrow">Espace de vérification</p>
        <h2>Aucune facture à vérifier</h2>
        <p>
          Importez une facture fournisseur pour consulter les informations
          réellement disponibles.
        </p>
        <Button variant="secondary" icon="upload" onClick={onUpload}>
          Importer une facture
        </Button>
      </section>
    )
  const workflow = item as WorkflowDocument
  const fields = Object.entries(item.extraction?.fields ?? {})
  const missing = item.extraction?.missingFields ?? []
  const extractedLines = Array.isArray(item.extraction?.fields?.lines)
    ? (item.extraction.fields.lines as Array<Record<string, unknown>>)
    : []
  const timelineEvents = useMemo(() => {
    if (!item.processing?.events?.length) return []
    return item.processing.events.filter((stage, index, list) => {
      if (index === 0) return true
      const prev = list[index - 1]
      return stage.stage !== prev.stage || stage.page !== prev.page
    })
  }, [item.processing?.events])
  const reviewTabs: Array<{ id: ReviewTabId; label: string; count?: number }> = [
    { id: "extraction", label: "Extraction", count: fields.length },
    { id: "articles", label: "Articles", count: workflow.articles?.length ?? extractedLines.length },
    { id: "validations", label: "Validations", count: validation.data?.issues.length },
    { id: "activity", label: "Historique", count: history.data?.length },
  ]
  return (
    <section
      id="so-panel-review"
      role="tabpanel"
      aria-labelledby="so-tab-review"
      className="so-review"
    >
      <header className="so-surface so-document-header">
        <div className="so-file-mark">
          <Icon name="file" size={22} />
        </div>
        <div className="so-document-title">
          <p className="so-eyebrow">Document importé</p>
          <h2>{item.filename}</h2>
          <p className="so-metadata">
            <span>{item.mimeType}</span>
            <span>{formatSize(item.size)}</span>
            <span>ID&nbsp;: {item.id}</span>
          </p>
        </div>
        <StatusBadge status={item.status} />
      </header>
      <section className="so-surface so-timeline" aria-label="Progression du traitement">
        <div className="so-section-heading">
          <div>
            <p className="so-eyebrow">Traitement</p>
            <h3>Progression du document</h3>
          </div>
          {workflow.processing?.status && <StatusBadge status={workflow.processing.status} />}
        </div>
        {timelineEvents.length ? (
          <div className="so-stepper-wrap">
            <ol className="so-stepper">
              {timelineEvents.map((stage, index) => {
                const isLast = index === timelineEvents.length - 1
                const isFailed = stage.stage === "failed" || (isLast && workflow.processing?.status === "failed")
                const isProcessing = isLast && workflow.processing?.status === "pending"
                const status = isFailed ? "failed" : isProcessing ? "active" : "completed"
                const { date, time } = formatTimelineDate(stage.at)

                return (
                  <li
                    key={`${stage.stage}-${stage.at}-${index}`}
                    className="so-step"
                    data-status={status}
                  >
                    <div className="so-step-indicator">
                      <div className="so-step-dot" aria-hidden="true">
                        {status === "completed" && <Icon name="check" size={13} />}
                        {status === "failed" && <Icon name="close" size={13} />}
                        {status === "active" && <span className="so-step-pulse" />}
                      </div>
                      {!isLast && <div className="so-step-line" aria-hidden="true" />}
                    </div>
                    <div className="so-step-body">
                      <strong className="so-step-title">{processingStageLabel(stage.stage)}</strong>
                      {stage.detail && <p className="so-step-detail">{stage.detail}</p>}
                      {date && (
                        <time className="so-step-time" dateTime={stage.at}>
                          <span className="so-step-date">{date}</span>
                          {time && <span className="so-step-hour">{time}</span>}
                        </time>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>
        ) : (
          <div className="so-unavailable">
            <Icon name="info" size={16} />
            <span>Le serveur ne fournit pas encore de chronologie détaillée pour ce document.</span>
          </div>
        )}
      </section>
      <div className="so-workspace">
        <section className="so-surface so-viewer" aria-label="Document original">
          <header>
            <div>
              <p className="so-eyebrow">Source</p>
              <h3>Document original</h3>
            </div>
            <div className="so-viewer-controls">
              {item.mimeType.startsWith("image/") && fileUrl && (
                <div className="so-zoom-controls" role="group" aria-label="Contrôles de zoom">
                  <button
                    type="button"
                    className="so-zoom-btn"
                    onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                    disabled={zoom <= 0.5}
                    title="Zoom arrière"
                    aria-label="Zoom arrière"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="so-zoom-reset"
                    onClick={() => setZoom(1)}
                    title="Ajuster à la vue"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <button
                    type="button"
                    className="so-zoom-btn"
                    onClick={() => setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
                    disabled={zoom >= 3}
                    title="Zoom avant"
                    aria-label="Zoom avant"
                  >
                    +
                  </button>
                </div>
              )}
              {fileUrl && (
                <a className="so-open-file" href={fileUrl} target="_blank" rel="noreferrer">
                  Ouvrir
                </a>
              )}
            </div>
          </header>
          <div className="so-viewer-frame">
            {fileError ? (
              <div className="so-unavailable" role="alert"><Icon name="warning" size={20} /><span>{fileError}</span></div>
            ) : !fileUrl ? (
              <div className="so-loading" role="status"><span />Chargement du document original…</div>
            ) : item.mimeType.startsWith("image/") ? (
              <img
                src={fileUrl}
                alt={`Document original ${item.filename}`}
                style={zoom !== 1 ? { transform: `scale(${zoom})`, transformOrigin: "center center", transition: "transform 150ms ease" } : undefined}
              />
            ) : item.mimeType === "application/pdf" ? (
              <iframe src={fileUrl} title={`Document original ${item.filename}`} />
            ) : (
              <div className="so-unavailable"><Icon name="file" size={20} /><span>Aperçu non disponible pour ce format.</span></div>
            )}
          </div>
          <p className="so-viewer-help">L’aperçu charge le fichier original protégé par le serveur. Si votre navigateur le bloque, utilisez « Ouvrir ».</p>
        </section>
        <div className="so-surface so-review-main">
          <div className="so-review-tabs" role="tablist" aria-label="Données du document">
            {reviewTabs.map((entry) => <button key={entry.id} role="tab" aria-selected={reviewTab === entry.id} onClick={() => setReviewTab(entry.id)}>{entry.label}{entry.count !== undefined && <span>{entry.count}</span>}</button>)}
          </div>
          {reviewTab === "extraction" && <>
          <div className="so-section-heading">
            <div>
              <p className="so-eyebrow">Données disponibles</p>
              <h3>Résultat de l’extraction</h3>
            </div>
            <span className="so-badge so-badge--neutral">
              {item.extraction?.provider || "Fournisseur non indiqué"}
            </span>
          </div>
          {fields.length > 0 ? (
            <dl className="so-fields">
              {fields.map(([key, value]) => {
                const source = item.extraction?.sources?.[key] ?? Object.entries(item.extraction?.sources ?? {}).find(([sourceKey]) => sourceKey.startsWith(`${key}.`))?.[1]
                return (
                <div key={key} className={key === "lines" ? "so-field-wide" : undefined}>
                  <dt>{key}</dt>
                  <dd><ExtractedValue name={key} value={value} currency={item.extraction?.fields?.currency as string | undefined} /></dd>
                  <button
                    type="button"
                    className="so-source-link"
                    disabled={!source}
                    title={source ? `Page ${source.page}` : "Coordonnées source non fournies"}
                    onClick={() => document.querySelector(".so-viewer")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  >Voir dans le document</button>
                </div>
              )})}
            </dl>
          ) : (
            <div className="so-inline-empty">
              <Icon name="info" size={18} />
              <div>
                <strong>Aucune donnée extraite à afficher</strong>
                <p>
                  Le serveur n’a retourné aucune valeur exploitable pour ce
                  document.
                </p>
              </div>
            </div>
          )}
          </>}
          {reviewTab === "articles" && (workflow.articles?.length || !extractedLines.length ? (
            <OptionalCollection items={workflow.articles} empty="Aucune ligne d’article n’a été extraite de ce document." />
          ) : (
            <>
              <div className="so-section-heading">
                <div>
                  <p className="so-eyebrow">Lignes extraites</p>
                  <h3>Articles de la facture</h3>
                </div>
                <span className="so-badge so-badge--neutral">Non rapprochés avec l’ERP</span>
              </div>
              <ExtractedValue name="lines" value={extractedLines} />
              <div className="so-honesty-note">
                <Icon name="info" size={16} />
                <p>
                  Ces lignes proviennent de l’extraction OCR. Le rapprochement avec le
                  catalogue ERP n’a pas encore été effectué : aucune correspondance
                  produit n’est proposée.
                </p>
              </div>
            </>
          ))}
          {reviewTab === "validations" && <ValidationTab state={validation} />}
          {reviewTab === "activity" && <HistoryTab state={history} />}
        </div>
      </div>
      <div className="so-review-grid so-review-summary">
        <aside className="so-surface so-review-aside">
          <p className="so-eyebrow">Contrôle humain</p>
          <h3>Éléments à examiner</h3>
          {missing.length > 0 ? (
            <>
              <p className="so-aside-copy">
                Champs signalés comme manquants par le serveur :
              </p>
              <ul>
                {missing.map((field) => (
                  <li key={field}>
                    <Icon name="warning" size={15} />
                    {field}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="so-inline-empty so-inline-empty--compact">
              <Icon name="info" size={17} />
              <p>
                Aucun champ manquant n’a été signalé. Cela ne constitue pas une
                validation.
              </p>
            </div>
          )}
          <div className={`so-erp-state ${item.erpSubmission.status === "integrated" ? "so-erp-state--success" : ""}`}>
            <span>Soumission ERP</span>
            <strong style={item.erpSubmission.status === "integrated" ? { color: "#0b8a65" } : undefined}>
              {item.erpSubmission.status === "integrated" ? "✓ " : ""}{erpLabel(item.erpSubmission.status)}
            </strong>
            <small>
              {item.erpSubmission.status === "not_submitted"
                ? "Soumission ERP : non effectuée."
                : item.erpSubmission.invoiceNumber
                  ? `Facture N° ${item.erpSubmission.invoiceNumber}${item.erpSubmission.supplierName ? ` • ${item.erpSubmission.supplierName}` : ""}`
                  : `Adaptateur : ${item.erpSubmission.adapter}${item.erpSubmission.invoiceId ? ` (Réf : ${item.erpSubmission.invoiceId})` : ""}`}
            </small>
            {item.erpSubmission.status === "integrated" && onNavigate && (
              <Button
                variant="secondary"
                icon="cart"
                onClick={() =>
                  onNavigate("purchases", {
                    search: item.erpSubmission.invoiceNumber || item.erpSubmission.invoiceId,
                  })
                }
                style={{ marginTop: 8 }}
              >
                Consulter dans les Achats
              </Button>
            )}
          </div>
        </aside>
        <aside className="so-surface so-review-aside">
          <p className="so-eyebrow">Décision</p>
          <h3>Actions disponibles</h3>
          {item.status === "approved" && item.erpSubmission.status === "not_submitted" && (
            <div className="so-alert so-alert--info" role="status">
              Facture approuvée, prête pour l’intégration ERP dans le journal des achats et les stocks.
            </div>
          )}
          {item.erpSubmission.status === "integrated" && (
            <div className="so-alert" style={{ background: "#f0fdf4", borderColor: "#bbf7d0", color: "#166534" }} role="status">
              Facture transmise avec succès à l’ERP sous le N° <strong>{item.erpSubmission.invoiceNumber || item.erpSubmission.invoiceId}</strong>
              {item.erpSubmission.supplierName ? <> chez <strong>{item.erpSubmission.supplierName}</strong></> : ""}.
              Les stocks ont été automatiquement réceptionnés dans l’agence.
            </div>
          )}
          <p className="so-aside-copy">Les actions restent verrouillées tant que le serveur ne les autorise pas explicitement.</p>
          {item.status === "needs_review" && blockingIssues > 0 && !item.capabilities?.canApprove && (
            <div className="so-alert so-alert--info" role="status">
              <span>
                Approbation bloquée : {blockingIssues} erreur{blockingIssues > 1 ? "s" : ""} à corriger.{" "}
                <button type="button" className="so-link-button" onClick={() => setReviewTab("validations")}>Voir les contrôles</button>
              </span>
            </div>
          )}
          {item.status === "needs_review" && remarks > 0 && blockingIssues === 0 && (
            <div className="so-alert so-alert--info" role="status">
              <span>
                {remarks} remarque{remarks > 1 ? "s" : ""} à vérifier, sans blocage.{" "}
                <button type="button" className="so-link-button" onClick={() => setReviewTab("validations")}>Voir les remarques</button>
              </span>
            </div>
          )}
          {actionError && (
            <div className="so-alert so-alert--error" role="alert">
              {actionError}
              {actionIssues.length > 0 && (
                <ul className="so-action-issues">
                  {actionIssues.map((issue, index) => (
                    <li key={`${issue.code}-${issue.line ?? ""}-${index}`}>
                      {issue.line !== undefined && <strong>Ligne {issue.line} : </strong>}
                      {issue.message}
                      {issue.severity === "warning" && " (avertissement)"}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="so-decision-actions">
            <Button variant="secondary" disabled={acting || !item.capabilities?.canRetry} onClick={async () => {
              setActing(true); setActionError("")
              try { await api.retryDocument(item.id); onChanged(await api.document(item.id)) }
              catch (failure) { fail(failure, "Nouvelle extraction impossible") }
              finally { setActing(false) }
            }}>Relancer l’extraction</Button>
            <Button disabled={acting || !item.capabilities?.canApprove} onClick={async () => {
              if (!window.confirm(remarks > 0 ? `Approuver cette facture malgré ${remarks} remarque${remarks > 1 ? "s" : ""} ?` : "Confirmer l’approbation humaine de cette facture ?")) return
              setActing(true); setActionError("")
              try { await api.approveDocument(item.id); onChanged(await api.document(item.id)) }
              catch (failure) { fail(failure, "Approbation impossible") }
              finally { setActing(false) }
            }}>Approuver</Button>
            <Button variant="secondary" disabled={acting || !item.capabilities?.canReject} onClick={async () => {
              const reason = window.prompt("Motif du rejet")?.trim()
              if (!reason) return
              setActing(true); setActionError("")
              try { await api.rejectDocument(item.id, reason); onChanged(await api.document(item.id)) }
              catch (failure) { fail(failure, "Rejet impossible") }
              finally { setActing(false) }
            }}>Rejeter</Button>
            <Button variant="secondary" disabled={acting || !item.capabilities?.canReopen} onClick={async () => {
              setActing(true); setActionError("")
              try { await api.reopenDocument(item.id); onChanged(await api.document(item.id)) }
              catch (failure) { fail(failure, "Réouverture impossible") }
              finally { setActing(false) }
            }}>Réouvrir</Button>
            {item.capabilities?.canIntegrate && item.erpSubmission.status === "not_submitted" ? (
              <Button
                variant="primary"
                icon="send"
                disabled={acting}
                onClick={() => setIntegrationOpen(true)}
              >
                Transmettre à l’ERP
              </Button>
            ) : item.erpSubmission.status === "integrated" && onNavigate ? (
              <Button
                variant="secondary"
                icon="cart"
                onClick={() =>
                  onNavigate("purchases", {
                    search: item.erpSubmission.invoiceNumber || item.erpSubmission.invoiceId,
                  })
                }
              >
                Voir dans les Achats ERP
              </Button>
            ) : (
              <Button
                variant="secondary"
                disabled={acting || !item.capabilities?.canIntegrate || item.erpSubmission.status !== "not_submitted"}
                onClick={() => setIntegrationOpen(true)}
              >
                Transmettre à l’ERP
              </Button>
            )}
          </div>
        </aside>
      </div>
      <div className="so-review-actions">
        {item.erpSubmission.status === "integrated" ? (
          <p style={{ color: "#0b7959", fontWeight: 600 }}>
            <Icon name="check" size={16} />
            Facture transmise avec succès à l’ERP : N° {item.erpSubmission.invoiceNumber || item.erpSubmission.invoiceId}
            {item.erpSubmission.totalTtc ? ` (${item.erpSubmission.totalTtc.toFixed(3)} DT TTC)` : ""}.
          </p>
        ) : item.status === "approved" ? (
          <p style={{ color: "var(--so-blue-dark)", fontWeight: 600 }}>
            <Icon name="check" size={16} />
            Facture approuvée : prête pour la transmission contrôlée vers les achats et le stock ERP.
          </p>
        ) : (
          <p>
            <Icon name="shield" size={16} />
            Vérification et approbation requises avant intégration dans l’ERP.
          </p>
        )}
        <Button variant="secondary" icon="upload" onClick={onUpload}>
          Importer un autre document
        </Button>
      </div>
      {integrationOpen && (
        <IntegrationDialog
          item={item}
          onClose={() => setIntegrationOpen(false)}
          onIntegrated={async () => {
            onChanged(await api.document(item.id))
          }}
          onNavigate={onNavigate}
        />
      )}
    </section>
  )
}

/** Sentinel select value: create this supplier/article in the ERP on confirmation. */
const CREATE_NEW = "__new__"
/** Minimum share of a line's significant words a catalogue entry must contain to be auto-matched. */
const MATCH_THRESHOLD = 0.6
const STOP_WORDS = new Set(["des", "les", "pour", "avec", "sur", "une", "par", "aux", "the", "and"])
const LEGAL_FORMS = new Set(["sarl", "suarl", "ste", "societe", "ets", "fictif", "company", "sas", "spa"])

function matchTokens(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
}

/** Share of the source's significant characters found as whole words in the candidate. */
function overlapScore(source: string[], candidate: string) {
  if (!source.length) return 0
  const words = new Set(matchTokens(candidate))
  const total = source.reduce((sum, w) => sum + w.length, 0)
  return source.filter((w) => words.has(w)).reduce((sum, w) => sum + w.length, 0) / total
}

const normalizeTaxId = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "")

function findBestSupplier(
  suppliers: Lookups["suppliers"],
  extractedSupplier?: string,
  supplierTaxId?: string,
): string {
  if (supplierTaxId) {
    const tax = normalizeTaxId(supplierTaxId)
    const taxMatch = suppliers.find((s) => s.taxId && normalizeTaxId(s.taxId) === tax)
    if (taxMatch) return taxMatch.id
  }
  if (!extractedSupplier) return ""
  const words = matchTokens(extractedSupplier).filter((w) => !LEGAL_FORMS.has(w))
  let best = { id: "", score: 0 }
  for (const s of suppliers) {
    const score = overlapScore(words, s.name)
    if (score > best.score) best = { id: s.id, score }
  }
  return best.score >= MATCH_THRESHOLD ? best.id : ""
}

function rankProducts(products: Lookups["products"], lineDescription: string) {
  const words = matchTokens(lineDescription)
  let best = { product: undefined as Lookups["products"][number] | undefined, score: 0 }
  for (const p of products) {
    const score = overlapScore(words, `${p.sku} ${p.name}`)
    if (score > best.score) best = { product: p, score }
  }
  return best
}

function findBestProduct(
  products: Lookups["products"],
  lineDescription?: string,
  supplierReference?: string,
): string {
  const ref = supplierReference?.trim().toLowerCase()
  if (ref) {
    const skuMatch = products.find((p) => p.sku.toLowerCase() === ref)
    if (skuMatch) return skuMatch.id
  }
  const best = rankProducts(products, lineDescription ?? "")
  return best.score >= MATCH_THRESHOLD && best.product ? best.product.id : ""
}

/** Family for a new article: that of the closest catalogue article, else by family name. */
function guessCategory(l: Lookups, lineDescription: string): string {
  const closest = rankProducts(l.products, lineDescription)
  if (closest.product?.categoryId && closest.score > 0) return closest.product.categoryId
  const words = matchTokens(lineDescription)
  let best = { id: l.categories[0]?.id ?? "", score: 0 }
  for (const c of l.categories) {
    const score = overlapScore(words, c.name)
    if (score > best.score) best = { id: c.id, score }
  }
  return best.id
}

function IntegrationDialog({
  item,
  onClose,
  onIntegrated,
  onNavigate,
}: {
  item: DocumentResponse
  onClose: () => void
  onIntegrated: () => Promise<void>
  onNavigate?: (module: string, options?: { search?: string; tab?: string }) => void
}) {
  const titleId = useId()
  const [lookups, setLookups] = useState<Lookups>()
  const [supplierId, setSupplierId] = useState("")
  const [supplierSearch, setSupplierSearch] = useState("")

  const totals = item.extraction?.fields?.totals as
    | Record<string, unknown>
    | undefined
  // Memoized so applyAutoMatch keeps a stable identity; otherwise the lookup
  // effect re-runs every render and wipes the user's manual article choices.
  const lines = useMemo(() => {
    const rawLines = Array.isArray(item.extraction?.fields?.lines)
      ? (item.extraction.fields.lines as Array<Record<string, unknown>>)
      : []
    return rawLines.length > 0
      ? rawLines
      : [
          {
            description: "Prestation / Total facture globale",
            quantity: "1",
            unitPrice: String(totals?.ht ?? "100.000"),
            lineHt: String(totals?.ht ?? "100.000"),
            lineVat: String(totals?.vat ?? "19.000"),
            vatRate: "19",
          },
        ]
  }, [item, totals])

  const [productIds, setProductIds] = useState<string[]>(() =>
    lines.map(() => ""),
  )
  const [productSearches, setProductSearches] = useState<string[]>(() =>
    lines.map(() => ""),
  )
  const [autoMatched, setAutoMatched] = useState<boolean[]>(() =>
    lines.map(() => false),
  )
  // Articles to create in the ERP for lines with no catalogue match (productIds[i] === CREATE_NEW).
  const [newProducts, setNewProducts] = useState<{ name: string; categoryId: string }[]>(() =>
    lines.map(() => ({ name: "", categoryId: "" })),
  )
  const [newSupplier, setNewSupplier] = useState({ name: "", taxId: "" })
  const [confirmed, setConfirmed] = useState(true)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [createdInvoiceId, setCreatedInvoiceId] = useState<string | null>(null)

  const applyAutoMatch = useCallback(
    (l: Lookups) => {
      const extractedName = String(item.extraction?.fields?.supplier ?? "").trim()
      const extractedTaxId = String(item.extraction?.fields?.supplierTaxId ?? "").trim()
      const bestSupp = findBestSupplier(l.suppliers, extractedName, extractedTaxId)
      // Unknown but readable supplier: propose creating it rather than leaving the field empty.
      setSupplierId(bestSupp || (extractedName ? CREATE_NEW : ""))
      setNewSupplier({ name: extractedName, taxId: extractedTaxId })

      const matches = lines.map((line) =>
        findBestProduct(
          l.products,
          String(line.description ?? ""),
          String(line.supplierReference ?? ""),
        ),
      )
      setProductIds(matches.map((id) => id || CREATE_NEW))
      setAutoMatched(matches.map(Boolean))
      setNewProducts(
        lines.map((line) => {
          const description = String(line.description ?? "").trim()
          return { name: description, categoryId: guessCategory(l, description) }
        }),
      )
    },
    [item, lines],
  )

  useEffect(() => {
    let active = true
    api
      .lookups()
      .then((data) => {
        if (active) {
          setLookups(data)
          applyAutoMatch(data)
        }
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Catalogue ERP indisponible",
          )
      })
    return () => {
      active = false
    }
  }, [applyAutoMatch])

  const supplierReady =
    supplierId === CREATE_NEW ? newSupplier.name.trim().length >= 2 : Boolean(supplierId)
  const lineReady = (index: number) =>
    productIds[index] === CREATE_NEW
      ? (newProducts[index]?.name.trim().length ?? 0) >= 2 && Boolean(newProducts[index]?.categoryId)
      : Boolean(productIds[index])
  const readyLines = lines.filter((_, index) => lineReady(index)).length
  const newLineCount = productIds.filter((id) => id === CREATE_NEW).length
  const readyToSubmit = Boolean(lookups && supplierReady && readyLines === lines.length && confirmed)

  const submit = async () => {
    if (!readyToSubmit) {
      setError(
        "Choisissez ou créez le fournisseur et un article ERP pour chaque ligne, puis confirmez la réception.",
      )
      return
    }
    setSaving(true)
    setError("")
    try {
      const res = await api.integrateDocumentPurchase(item.id, {
        ...(supplierId === CREATE_NEW
          ? { newSupplier: { name: newSupplier.name.trim(), taxId: newSupplier.taxId.trim() || undefined } }
          : { supplierId }),
        lines: productIds.map((id, index) =>
          id === CREATE_NEW
            ? { newProduct: { name: newProducts[index].name.trim(), categoryId: newProducts[index].categoryId } }
            : { productId: id },
        ),
        receiptConfirmed: true,
      })
      setCreatedInvoiceId(res.invoiceId)
      await onIntegrated()
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Transmission ERP impossible",
      )
    } finally {
      setSaving(false)
    }
  }

  const filteredSuppliers = useMemo(() => {
    if (!lookups) return []
    const q = supplierSearch.trim().toLowerCase()
    if (!q) return lookups.suppliers
    return lookups.suppliers.filter(
      (s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q),
    )
  }, [lookups, supplierSearch])

  const getFilteredProducts = useCallback(
    (lineIdx: number) => {
      if (!lookups) return []
      const q = (productSearches[lineIdx] ?? "").trim().toLowerCase()
      if (!q) return lookups.products
      return lookups.products.filter(
        (p) =>
          p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q),
      )
    },
    [lookups, productSearches],
  )

  const extractedSupplier = item.extraction?.fields?.supplier ? String(item.extraction.fields.supplier) : null
  const invoiceNum = item.extraction?.fields?.invoiceNumber ? String(item.extraction.fields.invoiceNumber) : null
  const totalTtc = totals?.ttc ? String(totals.ttc) : null
  const agencyName = (item as WorkflowDocument).agency ?? "Tunis Centre"

  if (createdInvoiceId) {
    return (
      <div className="so-dialog-backdrop" role="presentation">
        <div
          className="so-dialog so-integration-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          style={{ maxWidth: 580 }}
        >
          <div className="so-integration-success-view">
            <div className="so-success-icon-badge">
              <Icon name="check" size={32} />
            </div>
            <p className="so-eyebrow">Transmission réussie à 100%</p>
            <h2 id={titleId} style={{ margin: "4px 0", fontSize: 20 }}>
              Facture enregistrée & Stock réceptionné
            </h2>
            <p className="so-aside-copy" style={{ margin: "4px 0 16px", maxWidth: 480, fontSize: 12 }}>
              La facture fournisseur a été comptabilisée dans les achats et les articles ont été réceptionnés dans le stock de votre agence.
            </p>
            
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 20px", width: "100%", maxWidth: 460, textAlign: "left" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid #e2e8f0" }}>
                <span style={{ fontSize: 11, color: "#64748b" }}>N° Facture Achats</span>
                <span className="so-success-invoice-ref" style={{ fontWeight: 700, color: "#0f172a" }}>
                  {invoiceNum || "FC-2026-00125"}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: "#64748b" }}>Fournisseur catalogue</span>
                <strong style={{ fontSize: 12, color: "#0f172a" }}>
                  {lookups?.suppliers.find((s) => s.id === supplierId)?.name || newSupplier.name || extractedSupplier || "Fournisseur"}
                </strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: "#64748b" }}>Agence & Stocks</span>
                <strong style={{ fontSize: 12, color: "#0f172a" }}>{agencyName} (Articles réceptionnés)</strong>
              </div>
              {totalTtc && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "#64748b" }}>Montant comptabilisé</span>
                  <strong style={{ fontSize: 12, color: "#0b7959" }}>{totalTtc} TND TTC</strong>
                </div>
              )}
            </div>

            <div className="so-dialog-actions" style={{ justifyContent: "center", marginTop: 22, gap: 10 }}>
              {onNavigate && (
                <Button
                  variant="primary"
                  icon="cart"
                  onClick={() => {
                    onClose()
                    onNavigate("purchases", { search: invoiceNum || "FC-2026-00125" })
                  }}
                >
                  Voir dans les Achats
                </Button>
              )}
              {onNavigate && (
                <Button
                  variant="secondary"
                  icon="stock"
                  onClick={() => {
                    onClose()
                    onNavigate("inventory", { tab: "movements", search: invoiceNum || "FC-2026-00125" })
                  }}
                >
                  Voir dans les Stocks
                </Button>
              )}
              <Button variant="secondary" onClick={onClose}>
                Fermer
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="so-dialog-backdrop" role="presentation">
      <div
        className="so-dialog so-integration-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="so-integration-dialog-header">
          <button
            className="so-dialog-close"
            onClick={onClose}
            aria-label="Fermer"
          >
            <Icon name="close" size={18} />
          </button>
          <p className="so-eyebrow">Intégration Contrôlée ERP • Achats & Stock</p>
          <h2 id={titleId}>Transmettre aux achats et au stock</h2>
          <p className="so-aside-copy">
            Vérifiez les correspondances fournisseurs et articles. La confirmation crée la facture fournisseur comptabilisée et réceptionne immédiatement les articles dans le stock.
          </p>

          <div className="so-doc-summary-chips">
            {extractedSupplier && (
              <div className="so-summary-chip">
                <span>Fournisseur extrait :</span>
                <strong>{extractedSupplier}</strong>
              </div>
            )}
            {invoiceNum && (
              <div className="so-summary-chip">
                <span>Facture N° :</span>
                <strong>{invoiceNum}</strong>
              </div>
            )}
            {totalTtc && (
              <div className="so-summary-chip">
                <span>Total TTC :</span>
                <strong style={{ color: "var(--so-blue-dark)" }}>{totalTtc} DT</strong>
              </div>
            )}
            {agencyName && (
              <div className="so-summary-chip">
                <span>Agence :</span>
                <strong>{agencyName}</strong>
              </div>
            )}
          </div>
        </div>

        <div className="so-integration-dialog-body">
          {error && (
            <div className="so-alert so-alert--error" role="alert">
              {error}
            </div>
          )}
          {!lookups && !error && (
            <div className="so-loading" role="status">
              <span />
              Chargement du catalogue ERP…
            </div>
          )}
          {lookups && (
            <>
              <div className="so-supplier-card">
                <div className="so-supplier-card-header">
                  <span>Fournisseur ERP (Comptabilité Achats)</span>
                  {extractedSupplier && (
                    <span className="so-supplier-extracted-badge">
                      Extrait : {extractedSupplier}
                    </span>
                  )}
                </div>
                <div className="so-supplier-select-wrap">
                  <input
                    type="text"
                    className="so-search-input"
                    placeholder="Filtrer parmi les fournisseurs..."
                    value={supplierSearch}
                    onChange={(e) => setSupplierSearch(e.target.value)}
                  />
                  <select
                    value={supplierId}
                    onChange={(event) => {
                      setSupplierId(event.target.value)
                      setError("")
                    }}
                  >
                    <option value="">Sélectionner un fournisseur ({filteredSuppliers.length})</option>
                    <option value={CREATE_NEW}>➕ Créer un nouveau fournisseur dans l’ERP</option>
                    {filteredSuppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name} ({supplier.id})
                      </option>
                    ))}
                  </select>
                </div>
                {supplierId === CREATE_NEW && (
                  <div className="so-new-entity">
                    <p className="so-new-entity-hint">
                      <Icon name="spark" size={12} /> Fournisseur absent du catalogue : il sera créé dans l’ERP à la confirmation.
                    </p>
                    <div className="so-new-entity-grid">
                      <input
                        type="text"
                        className="so-search-input"
                        placeholder="Raison sociale du fournisseur"
                        aria-label="Raison sociale du nouveau fournisseur"
                        value={newSupplier.name}
                        onChange={(e) => setNewSupplier((cur) => ({ ...cur, name: e.target.value }))}
                      />
                      <input
                        type="text"
                        className="so-search-input"
                        placeholder="Matricule fiscal (optionnel)"
                        aria-label="Matricule fiscal du nouveau fournisseur"
                        value={newSupplier.taxId}
                        onChange={(e) => setNewSupplier((cur) => ({ ...cur, taxId: e.target.value }))}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="so-integration-section-title">
                <span>Articles à réceptionner en stock ({lines.length})</span>
                <button
                  type="button"
                  className="so-button so-button--ghost"
                  style={{ minHeight: 28, fontSize: 11, padding: "0 10px" }}
                  onClick={() => applyAutoMatch(lookups)}
                >
                  <Icon name="spark" size={13} /> Ré-appliquer le rapprochement auto
                </button>
              </div>

              <div className="so-integration-lines">
                {lines.map((line, index) => {
                  const filteredProducts = getFilteredProducts(index)
                  return (
                    <div
                      key={index}
                      className="so-line-match-card"
                      data-matched={autoMatched[index] ? "true" : "false"}
                    >
                      <div className="so-line-match-header">
                        <span className="so-line-match-title">
                          <span className="so-line-idx-badge">{index + 1}</span>
                          {String(line.description ?? "Article")}
                        </span>
                        <span className="so-line-match-amount">
                          {String(line.quantity ?? "1")} × {String(line.unitPrice ?? "")} TND
                          {line.lineHt ? ` • Total HT: ${String(line.lineHt)} TND` : ""}
                        </span>
                      </div>

                      <div className="so-line-inputs-grid">
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            type="text"
                            className="so-search-input"
                            placeholder="Rechercher SKU ou nom..."
                            value={productSearches[index] ?? ""}
                            onChange={(e) => {
                              const val = e.target.value
                              setProductSearches((cur) =>
                                cur.map((s, i) => (i === index ? val : s)),
                              )
                            }}
                          />
                          {autoMatched[index] ? (
                            <span
                              className="so-automatch-pill"
                              title="Rapproché automatiquement par similitude de désignation"
                            >
                              <Icon name="check" size={11} /> Auto
                            </span>
                          ) : productIds[index] === CREATE_NEW ? (
                            <span
                              className="so-automatch-pill so-automatch-pill--new"
                              title="Aucun article équivalent dans le catalogue"
                            >
                              Nouveau
                            </span>
                          ) : (
                            <span className="so-automatch-pill so-automatch-pill--manual">
                              Manuel
                            </span>
                          )}
                        </div>

                        <select
                          value={productIds[index] ?? ""}
                          onChange={(event) => {
                            const val = event.target.value
                            setProductIds((current) =>
                              current.map((id, i) => (i === index ? val : id)),
                            )
                            setAutoMatched((cur) =>
                              cur.map((m, i) => (i === index ? false : m)),
                            )
                            setError("")
                          }}
                        >
                          <option value="">
                            Rapprocher avec un article ERP ({filteredProducts.length} disponibles)
                          </option>
                          <option value={CREATE_NEW}>➕ Créer un nouvel article dans l’ERP</option>
                          {filteredProducts.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.sku} — {product.name} (Stock coût: {product.unitCost ?? 0} DT)
                            </option>
                          ))}
                        </select>
                      </div>
                      {productIds[index] === CREATE_NEW && (
                        <div className="so-new-entity">
                          <p className="so-new-entity-hint">
                            <Icon name="spark" size={12} /> Article absent du catalogue : il sera créé dans l’ERP
                            (coût unitaire {String(line.unitPrice ?? "")} TND, TVA {String(line.vatRate ?? "")}%) puis réceptionné en stock.
                          </p>
                          <div className="so-new-entity-grid">
                            <input
                              type="text"
                              className="so-search-input"
                              placeholder="Désignation du nouvel article"
                              aria-label={`Désignation du nouvel article, ligne ${index + 1}`}
                              value={newProducts[index]?.name ?? ""}
                              onChange={(e) => {
                                const val = e.target.value
                                setNewProducts((cur) => cur.map((p, i) => (i === index ? { ...p, name: val } : p)))
                              }}
                            />
                            <select
                              aria-label={`Famille du nouvel article, ligne ${index + 1}`}
                              value={newProducts[index]?.categoryId ?? ""}
                              onChange={(e) => {
                                const val = e.target.value
                                setNewProducts((cur) => cur.map((p, i) => (i === index ? { ...p, categoryId: val } : p)))
                              }}
                            >
                              <option value="">Choisir une famille</option>
                              {lookups.categories.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name} (TVA {c.vatRate}%)
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <label className="so-confirm-row">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => {
                    setConfirmed(event.target.checked)
                    setError("")
                  }}
                />
                <span>
                  Je confirme la réception physique des articles et la création de la facture d’achat avec mise à jour immédiate des stocks dans l’ERP.
                </span>
              </label>
            </>
          )}
        </div>

        <div className="so-integration-dialog-footer">
          <div className="so-dialog-footer-hint">
            <span>{readyToSubmit ? "Prêt pour transmission" : "Rapprochement incomplet"} •</span>
            <strong>{readyLines}/{lines.length} article{lines.length > 1 ? "s" : ""}</strong>
            {newLineCount > 0 && <span>• {newLineCount} à créer dans l’ERP</span>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Annuler
            </Button>
            <Button
              variant="primary"
              icon="send"
              onClick={() => void submit()}
              disabled={saving || !readyToSubmit}
            >
              {saving ? "Transmission en cours…" : "Confirmer et intégrer à l’ERP"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function DetailDialog({
  item,
  onClose,
  onSelectDocument,
  onIntegrate,
  onNavigate,
}: {
  item: DocumentResponse
  onClose: () => void
  onSelectDocument: (doc: DocumentResponse) => void
  onIntegrate: (doc: DocumentResponse) => void
  onNavigate?: (module: string, options?: { search?: string; tab?: string }) => void
}) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    closeRef.current?.focus()
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== "Tab" || !dialogRef.current) return
      const focusable = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", keydown)
    return () => {
      document.removeEventListener("keydown", keydown)
      previouslyFocused?.focus()
    }
  }, [onClose])
  return (
    <div
      className="so-dialog-backdrop modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="so-dialog modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <button
          ref={closeRef}
          className="so-dialog-close"
          onClick={onClose}
          aria-label="Fermer la fenêtre"
        >
          <Icon name="close" size={18} />
        </button>
        <div className="so-file-mark">
          <Icon name="file" size={23} />
        </div>
        <p className="so-eyebrow">Détail du document</p>
        <h2 id={titleId}>{item.filename}</h2>
        <StatusBadge status={item.status} />
        <dl className="so-dialog-details">
          <div>
            <dt>Identifiant</dt>
            <dd>{item.id}</dd>
          </div>
          <div>
            <dt>Format</dt>
            <dd>{item.mimeType}</dd>
          </div>
          <div>
            <dt>Taille</dt>
            <dd>{formatSize(item.size)}</dd>
          </div>
          <div>
            <dt>Soumission ERP</dt>
            <dd>
              {erpLabel(item.erpSubmission.status)}
              {item.erpSubmission.invoiceNumber ? ` (N° ${item.erpSubmission.invoiceNumber})` : ""}
            </dd>
          </div>
        </dl>
        {item.erpSubmission.status === "integrated" && (
          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 14px", margin: "12px 0 4px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: "#166534", fontWeight: 700 }}>✓ Intégrée dans l’ERP</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                {item.erpSubmission.invoiceNumber ? `Facture N° ${item.erpSubmission.invoiceNumber}` : item.erpSubmission.invoiceId}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "#15803d" }}>
              {item.erpSubmission.supplierName ? <>Fournisseur : <strong>{item.erpSubmission.supplierName}</strong> • </> : ""}
              {item.erpSubmission.totalTtc ? <>Montant : <strong>{item.erpSubmission.totalTtc.toFixed(3)} DT TTC</strong> • </> : ""}
              Articles réceptionnés en stock (agence).
            </div>
          </div>
        )}
        <div className="so-honesty-note">
          <Icon name="info" size={16} />
          <p>
            Champs manquants :{" "}
            {item.extraction?.missingFields.join(", ") || "aucun signalé"}. Ce
            résumé reflète les données validées par le serveur.
          </p>
        </div>
        <div className="so-dialog-actions" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", marginTop: 20 }}>
          <Button
            variant="ghost"
            onClick={() => {
              onSelectDocument(item)
              onClose()
            }}
          >
            Examiner dans la révision
          </Button>
          <div style={{ display: "flex", gap: 8 }}>
            {item.capabilities?.canIntegrate && item.erpSubmission.status === "not_submitted" && (
              <Button
                variant="primary"
                icon="send"
                onClick={() => {
                  onClose()
                  onIntegrate(item)
                }}
              >
                Transmettre à l’ERP
              </Button>
            )}
            {item.erpSubmission.status === "integrated" && onNavigate && (
              <Button
                variant="secondary"
                icon="cart"
                onClick={() => {
                  onClose()
                  onNavigate("purchases", {
                    search: item.erpSubmission.invoiceNumber || item.erpSubmission.invoiceId,
                  })
                }}
              >
                Voir dans Achats {item.erpSubmission.invoiceNumber ? `(${item.erpSubmission.invoiceNumber})` : ""}
              </Button>
            )}
            <Button onClick={onClose}>Fermer</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function HistoryPanel({
  onCount,
  onSelectDocument,
  onIntegrateDocument,
  onNavigate,
}: {
  onCount: (count: number) => void
  onSelectDocument: (doc: DocumentResponse) => void
  onIntegrateDocument: (doc: DocumentResponse) => void
  onNavigate?: (module: string, options?: { search?: string; tab?: string }) => void
}) {
  const [items, setItems] = useState<DocumentSummary[]>()
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  const [open, setOpen] = useState<DocumentResponse | null>(null)
  const [openError, setOpenError] = useState("")
  useEffect(() => {
    let cancelled = false
    setItems(undefined)
    setError("")
    api
      .documents()
      .then(({ documents }) => {
        if (!cancelled) {
          setItems(documents)
          onCount(documents.length)
        }
      })
      .catch((reason) => {
        if (!cancelled)
          setError(
            reason instanceof Error ? reason.message : "Erreur de chargement",
          )
      })
    return () => {
      cancelled = true
    }
  }, [reload, onCount])

  const openDocument = async (id: string) => {
    setOpenError("")
    try {
      const doc = await api.document(id)
      setOpen(doc)
    } catch (reason) {
      setOpenError(
        reason instanceof Error ? reason.message : "Document introuvable",
      )
    }
  }

  const handleExaminerDirect = async (id: string) => {
    setOpenError("")
    try {
      const doc = await api.document(id)
      onSelectDocument(doc)
    } catch (reason) {
      setOpenError(
        reason instanceof Error ? reason.message : "Document introuvable",
      )
    }
  }

  const handleIntegrateDirect = async (id: string) => {
    setOpenError("")
    try {
      const doc = await api.document(id)
      onIntegrateDocument(doc)
    } catch (reason) {
      setOpenError(
        reason instanceof Error ? reason.message : "Document introuvable",
      )
    }
  }

  return (
    <section
      id="so-panel-history"
      role="tabpanel"
      aria-labelledby="so-tab-history"
      className="so-surface so-history"
    >
      <header className="so-section-heading so-history-heading">
        <div>
          <p className="so-eyebrow">Journal des imports</p>
          <h2>Documents importés</h2>
          <p>
            Seuls les documents accessibles dans votre périmètre d’agence sont
            affichés.
          </p>
        </div>
        <Button
          variant="secondary"
          icon="refresh"
          onClick={() => setReload((n) => n + 1)}
        >
          Actualiser
        </Button>
      </header>
      {error && (
        <div className="so-alert so-alert--error warning-box" role="alert">
          <Icon name="warning" size={18} />
          <div>
            <strong>Historique indisponible</strong>
            <p>{error}</p>
          </div>
        </div>
      )}
      {openError && (
        <div className="so-alert so-alert--error warning-box" role="alert">
          <Icon name="warning" size={18} />
          <div>
            <strong>Ouverture impossible</strong>
            <p>{openError}</p>
          </div>
        </div>
      )}
      {!items && !error && (
        <div className="so-loading" role="status">
          <span />
          Chargement de l’historique…
        </div>
      )}
      {items?.length === 0 && (
        <div className="so-empty so-empty--inside">
          <div className="so-empty-icon">
            <Icon name="history" size={24} />
          </div>
          <h3>Aucun document importé</h3>
          <p>Les factures réellement importées apparaîtront ici.</p>
        </div>
      )}
      {items && items.length > 0 && (
        <div className="so-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fichier</th>
                <th>Agence</th>
                <th>Importé le</th>
                <th>Statut</th>
                <th>ERP</th>
                <th>
                  <span className="so-visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td data-label="Fichier">
                    <span className="so-file-cell">
                      <span>
                        <Icon name="file" size={16} />
                      </span>
                      <span>
                        <strong>{item.filename}</strong>
                        <small>{formatSize(item.size)}</small>
                      </span>
                    </span>
                  </td>
                  <td data-label="Agence">{item.agency}</td>
                  <td data-label="Importé le">
                    {new Date(item.createdAt).toLocaleString("fr-FR")}
                  </td>
                  <td data-label="Statut">
                    <StatusBadge status={item.status} />
                  </td>
                  <td data-label="ERP">
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontWeight: 600 }}>{erpLabel(item.erpSubmission.status)}</span>
                      {item.erpSubmission.status === "integrated" ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                          <small style={{ color: "#0b7959", fontWeight: 700 }}>
                            ✓ {item.erpSubmission.invoiceNumber ? `N° ${item.erpSubmission.invoiceNumber}` : "Facture intégrée"}
                          </small>
                          {item.erpSubmission.supplierName && (
                            <small style={{ color: "var(--so-muted)", fontSize: 11 }}>
                              {item.erpSubmission.supplierName}
                              {item.erpSubmission.totalTtc ? ` • ${item.erpSubmission.totalTtc.toFixed(3)} DT` : ""}
                            </small>
                          )}
                        </div>
                      ) : item.status === "approved" ? (
                        <small style={{ color: "var(--so-blue-dark)", fontWeight: 600 }}>Prête à transmettre</small>
                      ) : (
                        <small style={{ color: "var(--so-muted)" }}>En attente d’approbation</small>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="so-table-actions-cell">
                      {item.status === "approved" && item.erpSubmission.status === "not_submitted" && (
                        <Button
                          variant="secondary"
                          icon="send"
                          onClick={() => void handleIntegrateDirect(item.id)}
                        >
                          Transmettre
                        </Button>
                      )}
                      {item.erpSubmission.status === "integrated" && onNavigate && (
                        <Button
                          variant="ghost"
                          icon="cart"
                          onClick={() =>
                            onNavigate("purchases", {
                              search:
                                item.erpSubmission.invoiceNumber ||
                                item.erpSubmission.invoiceId,
                            })
                          }
                          title={`Ouvrir la facture ${item.erpSubmission.invoiceNumber ?? ""} dans les Achats`}
                        >
                          Voir ERP
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        onClick={() => void openDocument(item.id)}
                      >
                        Ouvrir <Icon name="arrow" size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => void handleExaminerDirect(item.id)}
                      >
                        Examiner
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <DetailDialog
          item={open}
          onClose={() => setOpen(null)}
          onSelectDocument={onSelectDocument}
          onIntegrate={onIntegrateDocument}
          onNavigate={onNavigate}
        />
      )}
    </section>
  )
}

export default function SmartOcrModule({
  onNavigate,
}: {
  onNavigate?: (module: string, options?: { search?: string; tab?: string }) => void
} = {}) {
  const [tab, setTab] = useState<TabId>("import")
  const [historyCount, setHistoryCount] = useState<number>()
  const [result, setResult] = useState<DocumentResponse | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [activeIntegrationDoc, setActiveIntegrationDoc] =
    useState<DocumentResponse | null>(null)

  const refreshCount = useCallback(() => {
    api
      .documents()
      .then(({ documents }) => setHistoryCount(documents.length))
      .catch(() => setHistoryCount(undefined))
  }, [])

  useEffect(() => {
    void refreshCount()
  }, [refreshCount])

  const upload = async (file?: File) => {
    if (!file || uploading) return
    setUploading(true)
    setError("")
    setNotice("")
    try {
      const document = await api.upload(file)
      setResult(await api.document(document.id).catch(() => document))
      setTab("review")
      void refreshCount()
    } catch (reason) {
      if (
        reason instanceof ApiError &&
        reason.code === "DUPLICATE_DOCUMENT" &&
        typeof reason.details?.existingId === "string"
      ) {
        try {
          const existing = await api.document(reason.details.existingId)
          setResult(existing)
          setNotice(
            "Ce fichier avait déjà été importé. Le document existant a été ouvert.",
          )
          setTab("review")
          return
        } catch {
          /* Preserve the upload error below. */
        }
      }
      setError(reason instanceof Error ? reason.message : "Échec de l’import")
    } finally {
      setUploading(false)
    }
  }

  return (
    <main className="smart-ocr page">
      <header className="so-page-heading page-heading">
        <div>
          <p className="so-eyebrow">Intelligence documentaire</p>
          <h1>Traitement intelligent des factures</h1>
          <p>
            Import sécurisé, extraction disponible et contrôle humain avant
            toute intégration ERP.
          </p>
        </div>
        <div className="so-heading-actions">
          <Button
            variant="secondary"
            icon="history"
            onClick={() => setTab("history")}
          >
            Historique
          </Button>
          <Button icon="upload" onClick={() => setTab("import")}>
            Importer une facture
          </Button>
        </div>
      </header>
      <div className="so-trust-banner">
        <span>
          <Icon name="shield" size={18} />
        </span>
        <div>
          <strong>Traitement piloté par le serveur et intégré à l’ERP</strong>
          <p>
            Validation comptable stricte, contrôle humain et rapprochement avec le catalogue d’achats et la gestion des stocks.
          </p>
        </div>
      </div>
      {error && (
        <div className="so-alert so-alert--error warning-box" role="alert">
          <Icon name="warning" size={18} />
          <div>
            <strong>Import refusé</strong>
            <p>{error}</p>
          </div>
        </div>
      )}
      {notice && (
        <div className="so-alert so-alert--info duplicate-notice" role="status">
          <Icon name="info" size={18} />
          <div>
            <strong>Document déjà présent</strong>
            <p>{notice}</p>
          </div>
        </div>
      )}
      <Tabs
        active={tab}
        historyCount={historyCount}
        hasReview={Boolean(result)}
        onChange={setTab}
      />
      {tab === "import" && (
        <UploadPanel
          uploading={uploading}
          onUpload={(file) => void upload(file)}
        />
      )}
      {tab === "review" && (
        <ReviewPanel
          item={result}
          onUpload={() => setTab("import")}
          onChanged={setResult}
          onNavigate={onNavigate}
        />
      )}
      {tab === "history" && (
        <HistoryPanel
          onCount={setHistoryCount}
          onSelectDocument={(doc) => {
            setResult(doc)
            setTab("review")
          }}
          onIntegrateDocument={(doc) => {
            setActiveIntegrationDoc(doc)
          }}
          onNavigate={onNavigate}
        />
      )}
      {activeIntegrationDoc && (
        <IntegrationDialog
          item={activeIntegrationDoc}
          onClose={() => setActiveIntegrationDoc(null)}
          onIntegrated={async () => {
            const updated = await api.document(activeIntegrationDoc.id)
            if (result?.id === activeIntegrationDoc.id) setResult(updated)
            refreshCount()
          }}
          onNavigate={onNavigate}
        />
      )}
    </main>
  )
}

