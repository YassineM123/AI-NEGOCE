import {
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
  type Tone,
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
type IconName = "arrow" | "check" | "close" | "file" | "history" | "info" | "refresh" | "shield" | "upload" | "warning"

const icons: Record<IconName, ReactNode> = {
  arrow: <path d="m9 18 6-6-6-6" />,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
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

function ExtractedValue({ name, value }: { name: string; value: unknown }) {
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
    return <dl className="so-extracted-totals">{Object.entries(value as Record<string, unknown>).map(([key, amount]) => <div key={key}><dt>{key.toUpperCase()}</dt><dd>{displayValue(amount)} TND</dd></div>)}</dl>
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
  const { ready, issues, rules } = state.data
  const blocking = issues.filter((issue) => issue.severity === "blocking").length
  return (
    <>
      <div className="so-section-heading">
        <div>
          <p className="so-eyebrow">Contrôles métier</p>
          <h3>{ready ? "Aucune anomalie détectée" : `${issues.length} point${issues.length > 1 ? "s" : ""} à corriger`}</h3>
          <p>
            {ready
              ? "Les champs requis et les totaux sont cohérents avec les règles financières de l’organisation."
              : blocking
                ? `${blocking} anomalie${blocking > 1 ? "s bloquent" : " bloque"} l’approbation.`
                : "Des avertissements sont à examiner avant l’approbation."}
          </p>
        </div>
        <span className={`so-badge so-badge--${ready ? "success" : blocking ? "danger" : "warning"}`}>
          {ready ? "Contrôles réussis" : blocking ? "Approbation bloquée" : "À examiner"}
        </span>
      </div>
      {issues.length > 0 && (
        <div className="so-record-list so-issue-list">
          {issues.map((issue, index) => (
            <article key={`${issue.code}-${issue.field ?? ""}-${issue.line ?? ""}-${index}`}>
              <div>
                <span className={`so-badge so-badge--${issue.severity === "blocking" ? "danger" : "warning"}`}>
                  {issue.severity === "blocking" ? "Bloquant" : "Avertissement"}
                </span>
                {issue.line !== undefined && <span>Ligne {issue.line + 1}</span>}
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
}: {
  item: DocumentResponse | null
  onUpload: () => void
  onChanged: (document: DocumentResponse) => void
}) {
  const [zoom, setZoom] = useState(1)
  const [reviewTab, setReviewTab] = useState<ReviewTabId>("extraction")
  const [fileUrl, setFileUrl] = useState<string>()
  const [fileError, setFileError] = useState("")
  const [validation, setValidation] = useState<Loaded<DocumentValidation>>({})
  const [history, setHistory] = useState<Loaded<DocumentHistoryEvent[]>>({})
  const [actionError, setActionError] = useState("")
  const [acting, setActing] = useState(false)
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
          <div><p className="so-eyebrow">Traitement</p><h3>Progression du document</h3></div>
          {workflow.processing?.status && <StatusBadge status={workflow.processing.status} />}
        </div>
        {timelineEvents.length ? (
          <ol>
            {timelineEvents.map((stage, index) => (
              <li key={`${stage.stage}-${stage.at}-${index}`} data-status="completed">
                <span className="so-stage-dot" />
                <div><strong>{processingStageLabel(stage.stage)}</strong>{stage.detail && <p>{stage.detail}</p>}</div>
                <time>{new Date(stage.at).toLocaleString("fr-FR")}</time>
              </li>
            ))}
          </ol>
        ) : <div className="so-unavailable"><Icon name="info" size={16} /><span>Le serveur ne fournit pas encore de chronologie détaillée pour ce document.</span></div>}
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
                  <dd><ExtractedValue name={key} value={value} /></dd>
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
          <div className="so-erp-state">
            <span>Soumission ERP</span>
            <strong>{erpLabel(item.erpSubmission.status)}</strong>
            <small>
              {item.erpSubmission.status === "not_submitted"
                ? "Soumission ERP : non effectuée."
                : `Adaptateur : ${item.erpSubmission.adapter}`}
            </small>
          </div>
        </aside>
        <aside className="so-surface so-review-aside">
          <p className="so-eyebrow">Décision</p>
          <h3>Actions disponibles</h3>
          {item.status === "approved" && item.erpSubmission.status === "not_submitted" && (
            <div className="so-alert" role="status">
              Facture approuvée, mais non intégrée. Aucune donnée n’a été ajoutée aux achats ou au stock.
              {item.erpSubmission.adapter === "unconfigured" && " Le connecteur ERP n’est pas configuré."}
            </div>
          )}
          <p className="so-aside-copy">Les actions restent verrouillées tant que le serveur ne les autorise pas explicitement.</p>
          {actionError && <div className="so-alert so-alert--error" role="alert">{actionError}</div>}
          <div className="so-decision-actions">
            <Button variant="secondary" disabled={acting || !item.capabilities?.canRetry} onClick={async () => {
              setActing(true); setActionError("")
              try { await api.retryDocument(item.id); onChanged(await api.document(item.id)) }
              catch (failure) { setActionError(failure instanceof Error ? failure.message : "Nouvelle extraction impossible") }
              finally { setActing(false) }
            }}>Relancer l’extraction</Button>
            <Button disabled={acting || !item.capabilities?.canApprove} onClick={async () => {
              if (!window.confirm("Confirmer l’approbation humaine de cette facture ?")) return
              setActing(true); setActionError("")
              try { await api.approveDocument(item.id); onChanged(await api.document(item.id)) }
              catch (failure) { setActionError(failure instanceof Error ? failure.message : "Approbation impossible") }
              finally { setActing(false) }
            }}>Approuver</Button>
            <Button variant="secondary" disabled={acting || !item.capabilities?.canReject} onClick={async () => {
              const reason = window.prompt("Motif du rejet")?.trim()
              if (!reason) return
              setActing(true); setActionError("")
              try { await api.rejectDocument(item.id, reason); onChanged(await api.document(item.id)) }
              catch (failure) { setActionError(failure instanceof Error ? failure.message : "Rejet impossible") }
              finally { setActing(false) }
            }}>Rejeter</Button>
            <Button variant="secondary" disabled={acting || !item.capabilities?.canReopen} onClick={async () => {
              setActing(true); setActionError("")
              try { await api.reopenDocument(item.id); onChanged(await api.document(item.id)) }
              catch (failure) { setActionError(failure instanceof Error ? failure.message : "Réouverture impossible") }
              finally { setActing(false) }
            }}>Réouvrir</Button>
            <Button variant="secondary" disabled title="Aucun endpoint d’intégration ERP n’est configuré">Transmettre à l’ERP</Button>
          </div>
        </aside>
      </div>
      <div className="so-review-actions">
        <p>
          <Icon name="shield" size={16} />
          Aucune intégration ERP n’est déclenchée depuis cet écran.
        </p>
        <Button variant="secondary" icon="upload" onClick={onUpload}>
          Importer un autre document
        </Button>
      </div>
    </section>
  )
}

function DetailDialog({
  item,
  onClose,
}: {
  item: DocumentResponse
  onClose: () => void
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
            <dd>{erpLabel(item.erpSubmission.status)}</dd>
          </div>
        </dl>
        <div className="so-honesty-note">
          <Icon name="info" size={16} />
          <p>
            Champs manquants :{" "}
            {item.extraction?.missingFields.join(", ") || "aucun signalé"}. Ce
            résumé reflète uniquement la réponse actuelle du serveur.
          </p>
        </div>
        <div className="so-dialog-actions">
          <Button onClick={onClose}>Fermer</Button>
        </div>
      </div>
    </div>
  )
}

function HistoryPanel({ onCount }: { onCount: (count: number) => void }) {
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
      setOpen(await api.document(id))
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
                    {erpLabel(item.erpSubmission.status)}
                    {item.status === "approved" && item.erpSubmission.status === "not_submitted" && (
                      <small style={{ display: "block" }}>Aucune donnée ajoutée à l’ERP</small>
                    )}
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      onClick={() => void openDocument(item.id)}
                    >
                      Ouvrir <Icon name="arrow" size={14} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <DetailDialog item={open} onClose={() => setOpen(null)} />}
    </section>
  )
}

export default function SmartOcrModule() {
  const [tab, setTab] = useState<TabId>("import")
  const [historyCount, setHistoryCount] = useState<number>()
  const [result, setResult] = useState<DocumentResponse | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const refreshCount = () =>
    api
      .documents()
      .then(({ documents }) => setHistoryCount(documents.length))
      .catch(() => setHistoryCount(undefined))
  useEffect(() => {
    void refreshCount()
  }, [])
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
            toute intégration.
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
          <strong>Traitement piloté par le serveur</strong>
          <p>
            Le document est validé et stocké par l’API. Les résultats affichés
            proviennent exclusivement du backend.
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
        <ReviewPanel item={result} onUpload={() => setTab("import")} onChanged={setResult} />
      )}
      {tab === "history" && <HistoryPanel onCount={setHistoryCount} />}
    </main>
  )
}
