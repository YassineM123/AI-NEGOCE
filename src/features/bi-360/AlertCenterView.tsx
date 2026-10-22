import React, { useState } from "react"
import type { BusinessAlert, AlertSeverity } from "./types"

interface AlertCenterViewProps {
  alerts: BusinessAlert[]
  loading: boolean
  onAcknowledgeAlert: (id: string) => Promise<void>
  onNavigateTab?: (tab: string) => void
  onCopilotAnalyze?: (subject: string, context: Record<string, unknown>) => void
}

export const AlertCenterView: React.FC<AlertCenterViewProps> = ({
  alerts,
  loading,
  onAcknowledgeAlert,
  onNavigateTab,
  onCopilotAnalyze,
}) => {
  const [filterSeverity, setFilterSeverity] = useState<string>("all")
  const [filterCategory, setFilterCategory] = useState<string>("all")
  const [search, setSearch] = useState<string>("")
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null)

  const filtered = alerts.filter((a) => {
    if (filterSeverity !== "all" && a.severity !== filterSeverity) return false
    if (filterCategory !== "all" && a.category !== filterCategory) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      return (
        a.title.toLowerCase().includes(q) ||
        a.subject.toLowerCase().includes(q) ||
        a.detail.toLowerCase().includes(q)
      )
    }
    return true
  })

  const criticalCount = alerts.filter((a) => a.severity === "critical" && !a.acknowledged).length
  const warningCount = alerts.filter((a) => a.severity === "warning" && !a.acknowledged).length

  const handleAck = async (id: string) => {
    setAcknowledgingId(id)
    try {
      await onAcknowledgeAlert(id)
    } finally {
      setAcknowledgingId(null)
    }
  }

  return (
    <div className="bi-container">
      {/* 1. Header & Summary Stats */}
      <div className="bi-kpi-grid">
        <div className="bi-kpi-card" style={{ borderLeft: "4px solid #dc2626" }}>
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">Alertes critiques non acquittées</span>
          </div>
          <div className="bi-kpi-value" style={{ color: criticalCount > 0 ? "#dc2626" : "inherit" }}>
            {criticalCount}
          </div>
          <div className="bi-kpi-footer">
            <span className="bi-kpi-subtitle">Action immédiate requise</span>
          </div>
        </div>

        <div className="bi-kpi-card" style={{ borderLeft: "4px solid #f59e0b" }}>
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">Alertes vigilance</span>
          </div>
          <div className="bi-kpi-value" style={{ color: warningCount > 0 ? "#f59e0b" : "inherit" }}>
            {warningCount}
          </div>
          <div className="bi-kpi-footer">
            <span className="bi-kpi-subtitle">À surveiller dans la semaine</span>
          </div>
        </div>

        <div className="bi-kpi-card">
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">Total alertes actives</span>
          </div>
          <div className="bi-kpi-value">{alerts.length}</div>
          <div className="bi-kpi-footer">
            <span className="bi-kpi-subtitle">Détectées sur données ERP</span>
          </div>
        </div>
      </div>

      {/* 2. Filter Toolbar */}
      <div className="bi-filter-toolbar">
        <div className="bi-filter-group">
          <label className="bi-filter-label">Sévérité :</label>
          <select
            className="bi-select"
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
          >
            <option value="all">Toutes les sévérités</option>
            <option value="critical">Critique</option>
            <option value="warning">Vigilance</option>
            <option value="info">Information</option>
          </select>
        </div>

        <div className="bi-filter-group">
          <label className="bi-filter-label">Catégorie :</label>
          <select
            className="bi-select"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
          >
            <option value="all">Toutes les catégories</option>
            <option value="margin">Rentabilité & Marge</option>
            <option value="receivables">Recouvrement & Créances</option>
            <option value="stock">Stocks & Ruptures</option>
            <option value="purchases">Achats & Fournisseurs</option>
            <option value="customer">Clients & Ventes</option>
          </select>
        </div>

        <div className="bi-filter-group" style={{ flex: 1, minWidth: "200px" }}>
          <input
            type="text"
            className="bi-input"
            style={{ width: "100%" }}
            placeholder="Rechercher une alerte, un tiers ou un produit..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* 3. Alerts List */}
      <div className="bi-panel">
        <div className="bi-panel-header">
          <div>
            <h3 className="bi-panel-title">Journal opérationnel des alertes de gestion</h3>
            <p className="bi-panel-desc">
              Détection automatique d'anomalies financières, de ruptures de stock et de dérives commerciales
            </p>
          </div>
        </div>

        {loading && alerts.length === 0 ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
            Chargement des alertes...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "3rem", textAlign: "center", color: "var(--muted)" }}>
            Aucune alerte correspondant aux filtres sélectionnés.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {filtered.map((alert) => (
              <div
                key={alert.id}
                className="bi-alert-item"
                style={{
                  opacity: alert.acknowledged ? 0.6 : 1,
                  background: alert.acknowledged ? "var(--bg)" : "var(--surface)",
                }}
              >
                <span
                  className={`bi-badge-pill ${
                    alert.severity === "critical"
                      ? "danger"
                      : alert.severity === "warning"
                        ? "warning"
                        : "info"
                  }`}
                  style={{ alignSelf: "flex-start", marginTop: "0.15rem" }}
                >
                  {alert.severity === "critical"
                    ? "Critique"
                    : alert.severity === "warning"
                      ? "Vigilance"
                      : "Info"}
                </span>

                <div className="bi-alert-body">
                  <div className="bi-alert-title">
                    {alert.title}
                    <span
                      style={{
                        fontSize: "0.72rem",
                        color: "var(--muted)",
                        fontWeight: 400,
                        marginLeft: "0.5rem",
                      }}
                    >
                      {alert.detectedAt}
                    </span>
                  </div>
                  <div className="bi-alert-subject">Sujet : {alert.subject}</div>
                  <div className="bi-alert-desc">{alert.detail}</div>
                  <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                    📐 Règle : {alert.threshold}
                  </div>
                </div>

                <div className="bi-alert-actions">
                  {alert.linkAction && onNavigateTab && (
                    <button
                      className="bi-tab-btn"
                      style={{ border: "1px solid var(--line)", padding: "0.35rem 0.65rem" }}
                      onClick={() => onNavigateTab(alert.linkAction!.tab)}
                    >
                      Explorer le module
                    </button>
                  )}

                  {onCopilotAnalyze && (
                    <button
                      className="bi-copilot-btn"
                      onClick={() =>
                        onCopilotAnalyze(`Résolution d'alerte : ${alert.title}`, {
                          alert,
                        })
                      }
                    >
                      ✨ Analyser avec Copilot
                    </button>
                  )}

                  {!alert.acknowledged ? (
                    <button
                      className="bi-tab-btn"
                      style={{
                        background: "#10b981",
                        color: "#ffffff",
                        padding: "0.35rem 0.65rem",
                      }}
                      disabled={acknowledgingId === alert.id}
                      onClick={() => handleAck(alert.id)}
                    >
                      {acknowledgingId === alert.id ? "Acquittement..." : "Acquitter"}
                    </button>
                  ) : (
                    <span className="bi-badge-pill success">Acquittée</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
export default AlertCenterView
