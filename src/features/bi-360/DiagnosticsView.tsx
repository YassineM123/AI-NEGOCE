import React, { useState } from "react"
import type { DiagnosticsResponse } from "./types"

interface DiagnosticsViewProps {
  data: DiagnosticsResponse | null
  loading: boolean
  onCopilotAnalyze?: (subject: string, context: Record<string, unknown>) => void
}

const fmtDt = (n: number) =>
  new Intl.NumberFormat("fr-TN", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(n) + " DT"
const fmtPct = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)} %`)

export const DiagnosticsView: React.FC<DiagnosticsViewProps> = ({ data, loading, onCopilotAnalyze }) => {
  const [selectedIdx, setSelectedIdx] = useState(0)

  if (loading && !data) {
    return (
      <div className="bi-container">
        <div className="bi-panel bi-skeleton" style={{ height: "300px" }} />
      </div>
    )
  }

  if (!data || data.diagnostics.length === 0) {
    return (
      <div className="bi-container">
        <div className="bi-panel" style={{ textAlign: "center", padding: "3rem" }}>
          <p style={{ color: "var(--muted)" }}>Aucun diagnostic calculé sur cette période.</p>
        </div>
      </div>
    )
  }

  const current = data.diagnostics[selectedIdx] || data.diagnostics[0]

  return (
    <div className="bi-container">
      {/* 1. Diagnostic Selection Tabs */}
      <div className="bi-panel" style={{ padding: "0.75rem 1rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {data.diagnostics.map((d, idx) => (
            <button
              key={d.id}
              onClick={() => setSelectedIdx(idx)}
              className={`bi-tab-btn ${selectedIdx === idx ? "active" : ""}`}
              style={{ fontSize: "0.85rem" }}
            >
              🔍 {d.question}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Executive Summary Card */}
      <div className="bi-panel" style={{ borderLeft: "4px solid #2563eb" }}>
        <div className="bi-panel-header">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span className="bi-badge-pill success">Analyse Déterministe 100% vérifiée</span>
              <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                Période : {data.range.from} au {data.range.to} vs {data.previousRange.from} au {data.previousRange.to}
              </span>
            </div>
            <h2 style={{ fontSize: "1.2rem", fontWeight: 700, margin: "0.5rem 0" }}>{current.question}</h2>
          </div>
          {onCopilotAnalyze && (
            <button
              className="bi-copilot-btn"
              onClick={() =>
                onCopilotAnalyze(`Diagnostic approfondi : ${current.question}`, {
                  diagnostic: current,
                })
              }
            >
              ✨ Approfondir avec Copilot
            </button>
          )}
        </div>

        <div
          style={{
            background: "var(--bg)",
            padding: "1rem",
            borderRadius: "6px",
            fontSize: "0.9rem",
            lineHeight: 1.5,
            border: "1px solid var(--line)",
            marginBottom: "1rem",
          }}
        >
          <strong>Synthèse exécutive : </strong>
          {current.executiveSummary}
        </div>

        {/* Variation Metrics */}
        <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", padding: "0.5rem 0" }}>
          <div>
            <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Valeur Période Précédente</span>
            <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>{fmtDt(current.initialValue)}</div>
          </div>
          <div>
            <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Valeur Période Actuelle</span>
            <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>{fmtDt(current.finalValue)}</div>
          </div>
          <div>
            <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Écart Constaté</span>
            <div
              style={{
                fontSize: "1.1rem",
                fontWeight: 700,
                color: current.variation < 0 ? "#dc2626" : "#10b981",
              }}
            >
              {current.variation > 0 ? "+" : ""}
              {fmtDt(current.variation)} ({fmtPct(current.variationPct)})
            </div>
          </div>
        </div>
      </div>

      {/* 3. Contributors Table */}
      <div className="bi-panel">
        <div className="bi-panel-header">
          <div>
            <h3 className="bi-panel-title">Facteurs explicatifs et contributions</h3>
            <p className="bi-panel-desc">
              Poids relatif de chaque dimension contributrice dans la variation totale constatée
            </p>
          </div>
        </div>

        <div className="bi-table-wrap">
          <table className="bi-table">
            <thead>
              <tr>
                <th>Dimension</th>
                <th>Composante / Réf</th>
                <th style={{ textAlign: "right" }}>Impact direct</th>
                <th style={{ textAlign: "right" }}>Part de l'écart</th>
                <th>Explication causale</th>
              </tr>
            </thead>
            <tbody>
              {current.contributors.map((c, idx) => (
                <tr key={`${c.dimension}-${idx}`}>
                  <td>
                    <span className="bi-badge-pill info">{c.dimension}</span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td
                    style={{
                      textAlign: "right",
                      fontWeight: 600,
                      color: c.contribution < 0 ? "#dc2626" : "#10b981",
                    }}
                  >
                    {c.contribution > 0 ? "+" : ""}
                    {fmtDt(c.contribution)}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 500 }}>
                    {c.pctOfTotalVariation.toFixed(1)} %
                  </td>
                  <td style={{ fontSize: "0.82rem", color: "var(--muted)" }}>{c.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: "1rem", fontSize: "0.75rem", color: "var(--muted)", fontStyle: "italic" }}>
          📐 {current.methodology}
        </div>
      </div>
    </div>
  )
}
export default DiagnosticsView
