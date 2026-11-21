import React from "react"
import type { ProfitabilityResponse } from "./types"
import { MoneyDisplay, fmtDt, fmtPct, fmtPts } from "./formatters"

interface ProfitabilityViewProps {
  data: ProfitabilityResponse | null
  loading: boolean
  onDrillDownCategory?: (id: string, name: string) => void
  onCopilotAnalyze?: (subject: string, context: Record<string, unknown>) => void
}

export const ProfitabilityView: React.FC<ProfitabilityViewProps> = ({
  data,
  loading,
  onDrillDownCategory,
  onCopilotAnalyze,
}) => {
  if (loading && !data) {
    return (
      <div className="bi-container">
        <div className="bi-kpi-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bi-kpi-card bi-skeleton" style={{ height: "105px" }} />
          ))}
        </div>
      </div>
    )
  }

  if (!data) return null

  const k = data.kpis
  const bridge = data.waterfallBridge

  // Find max value in waterfall for scaling
  const maxWaterfallVal = Math.max(
    1,
    bridge.previousMargin,
    bridge.currentMargin,
    ...bridge.factors.map((f) => Math.abs(f.impact))
  )

  return (
    <div className="bi-container">
      {/* 1. Profitability KPIs */}
      <div className="bi-kpi-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        <div className="bi-kpi-card">
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">Marge brute totale</span>
            <span className="bi-kpi-formula-info" title="Chiffre d’affaires HT net - Coût d’achat HT (PMP)">ⓘ</span>
          </div>
          <div className="bi-kpi-value">
            <MoneyDisplay value={k.grossMargin} />
          </div>
          <div className="bi-kpi-footer">
            {k.marginGrowthPts !== null && (
              <span className={`bi-delta-pill ${k.marginGrowthPts < 0 ? "negative" : "positive"}`}>
                {fmtPts(k.marginGrowthPts)} vs N-1
              </span>
            )}
            <span className="bi-kpi-subtitle">Gain net d'exploitation</span>
          </div>
        </div>

        <div className="bi-kpi-card">
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">Taux de marque (Commercial)</span>
            <span className="bi-kpi-formula-info" title="Marge brute / Chiffre d’affaires HT * 100">ⓘ</span>
          </div>
          <div className="bi-kpi-value">
            <span className="bi-money"><span className="bi-money-int">{k.markupRate !== null ? k.markupRate.toFixed(1) : "—"}</span><span className="bi-money-unit">%</span></span>
          </div>
          <div className="bi-kpi-footer">
            <span className="bi-delta-pill neutral">Sur ventes</span>
            <span className="bi-kpi-subtitle">Part de marge / 100 DT CA</span>
          </div>
        </div>

        <div className="bi-kpi-card">
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">Taux de marge (Achat)</span>
            <span className="bi-kpi-formula-info" title="Marge brute / Coût d'achat HT * 100 (Coefficient multiplicateur)">ⓘ</span>
          </div>
          <div className="bi-kpi-value">
            <span className="bi-money"><span className="bi-money-int">{k.marginRate !== null ? k.marginRate.toFixed(1) : "—"}</span><span className="bi-money-unit">%</span></span>
          </div>
          <div className="bi-kpi-footer">
            <span className="bi-delta-pill neutral">Sur coût</span>
            <span className="bi-kpi-subtitle">Coefficient appliqué au PMP</span>
          </div>
        </div>

        <div className="bi-kpi-card">
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">Ventes à marge négative</span>
            <span className="bi-kpi-formula-info" title="Lignes de vente où Prix de vente HT < Coût unitaire d'achat">ⓘ</span>
          </div>
          <div className="bi-kpi-value">
            <MoneyDisplay value={k.negativeMarginLoss} color={k.negativeMarginCount > 0 ? "var(--red, #d04444)" : undefined} />
          </div>
          <div className="bi-kpi-footer">
            <span className={`bi-delta-pill ${k.negativeMarginCount > 0 ? "negative" : "positive"}`}>
              {k.negativeMarginCount} ligne(s) critique(s)
            </span>
            <span className="bi-kpi-subtitle">Perte brute générée</span>
          </div>
        </div>
      </div>

      {/* 2. Waterfall Margin Bridge */}
      <div className="bi-panel">
        <div className="bi-panel-header">
          <div>
            <h3 className="bi-panel-title">Pont de marge déterministe (Waterfall Bridge)</h3>
            <p className="bi-panel-desc">
              Décomposition mathématique de l'écart de marge vs N-1 en 4 facteurs : Effet Volume/Mix, Effet Prix, Effet Coûts d'achat et Effet Remises
            </p>
          </div>
          {onCopilotAnalyze && (
            <button
              className="bi-btn bi-btn-copilot"
              style={{ height: "30px", padding: "0 0.65rem", fontSize: "0.75rem" }}
              onClick={() =>
                onCopilotAnalyze("Explication des leviers de marge et facteurs du pont waterfall", {
                  bridge: data.waterfallBridge,
                  kpis: data.kpis,
                })
              }
            >
              ✨ Expliquer l’écart avec Copilot
            </button>
          )}
        </div>

        <div className="bi-waterfall-container">
          {/* Previous Margin */}
          <div className="bi-waterfall-step">
            <div className="bi-waterfall-bar-wrap">
              <div
                className="bi-waterfall-bar base"
                style={{ height: `${Math.max(12, (bridge.previousMargin / maxWaterfallVal) * 100)}%` }}
              >
                <span className="bi-waterfall-val">{Math.round(bridge.previousMargin / 1000)}k</span>
              </div>
            </div>
            <span className="bi-waterfall-label">Marge N-1</span>
          </div>

          {/* 4 Deterministic Factors */}
          {bridge.factors.map((factor) => {
            const isPositive = factor.impact >= 0
            const h = Math.max(10, (Math.abs(factor.impact) / maxWaterfallVal) * 100)
            return (
              <div key={factor.id} className="bi-waterfall-step">
                <div className="bi-waterfall-bar-wrap">
                  <div
                    className={`bi-waterfall-bar ${isPositive ? "positive" : "negative"}`}
                    style={{ height: `${h}%` }}
                    title={`${factor.description}\nImpact : ${fmtDt(factor.impact)}`}
                  >
                    <span className="bi-waterfall-val">
                      {isPositive ? "+" : ""}
                      {Math.round(factor.impact / 1000)}k
                    </span>
                  </div>
                </div>
                <span className="bi-waterfall-label">{factor.label}</span>
              </div>
            )
          })}

          {/* Current Margin */}
          <div className="bi-waterfall-step">
            <div className="bi-waterfall-bar-wrap">
              <div
                className="bi-waterfall-bar current"
                style={{ height: `${Math.max(12, (bridge.currentMargin / maxWaterfallVal) * 100)}%` }}
              >
                <span className="bi-waterfall-val">{Math.round(bridge.currentMargin / 1000)}k</span>
              </div>
            </div>
            <span className="bi-waterfall-label">Marge Actuelle</span>
          </div>
        </div>

        <div style={{ marginTop: "1rem", fontSize: "0.8rem", color: "var(--muted)", background: "#f8fafc", padding: "0.75rem 1rem", borderRadius: "6px", border: "1px solid var(--line)" }}>
          <strong>Lecture d'aide à la décision : </strong>
          L'écart total de marge est de <strong>{fmtDt(bridge.gap)}</strong> ({fmtPct(bridge.previousMargin > 0 ? (bridge.gap / bridge.previousMargin) * 100 : null)}).
          {bridge.factors.map((f) => (
            <span key={f.id} style={{ marginLeft: "0.85rem" }}>
              • {f.label} : <strong>{fmtDt(f.impact)}</strong>
            </span>
          ))}
        </div>
      </div>

      {/* 3. Margins by Category Table */}
      <div className="bi-panel">
        <div className="bi-panel-header">
          <div>
            <h3 className="bi-panel-title">Rentabilité par famille de produits</h3>
            <p className="bi-panel-desc">Ventes, coûts d’achat, marges générées et évolution du taux de marque</p>
          </div>
        </div>
        <div className="bi-table-wrap">
          <table className="bi-table">
            <thead>
              <tr>
                <th>Famille</th>
                <th style={{ textAlign: "right" }}>Chiffre d’affaires HT</th>
                <th style={{ textAlign: "right" }}>Coût d’achat HT</th>
                <th style={{ textAlign: "right" }}>Marge brute HT</th>
                <th style={{ textAlign: "right" }}>Taux de marque</th>
                <th style={{ textAlign: "right" }}>Évolution vs N-1</th>
              </tr>
            </thead>
            <tbody>
              {data.marginByCategory.map((c) => (
                <tr
                  key={c.id}
                  style={{ cursor: onDrillDownCategory ? "pointer" : "default" }}
                  onClick={() => onDrillDownCategory && onDrillDownCategory(c.id, c.name)}
                >
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td style={{ textAlign: "right" }}>{fmtDt(c.revenue)}</td>
                  <td style={{ textAlign: "right", color: "var(--muted)" }}>{fmtDt(c.cost)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: c.margin > 0 ? "var(--green, #15956f)" : "var(--red, #d04444)" }}>{fmtDt(c.margin)}</td>
                  <td style={{ textAlign: "right" }}>
                    <span className={`bi-badge-pill ${(c.markupRate ?? 0) < 15 ? "danger" : "success"}`}>
                      {c.markupRate !== null ? `${c.markupRate.toFixed(1)}%` : "—"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {c.deltaPts !== null ? (
                      <span className={`bi-delta-pill ${c.deltaPts < 0 ? "negative" : "positive"}`}>
                        {fmtPts(c.deltaPts)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. Negative Margin Sales (Actionable Red Flags) */}
      {data.negativeMarginSales.length > 0 && (
        <div className="bi-panel" style={{ borderLeft: "4px solid var(--red, #d04444)" }}>
          <div className="bi-panel-header">
            <div>
              <h3 className="bi-panel-title" style={{ color: "var(--red, #d04444)" }}>
                ⚠️ Anomalies critiques : Ventes à marge négative détectées
              </h3>
              <p className="bi-panel-desc">
                Ces transactions ont été conclues à un prix inférieur au coût d'achat unitaire (PMP)
              </p>
            </div>
          </div>
          <div className="bi-table-wrap">
            <table className="bi-table">
              <thead>
                <tr>
                  <th>Facture</th>
                  <th>Date</th>
                  <th>Client</th>
                  <th>Article</th>
                  <th style={{ textAlign: "right" }}>Qté</th>
                  <th style={{ textAlign: "right" }}>Prix Vente HT</th>
                  <th style={{ textAlign: "right" }}>Coût Achat HT</th>
                  <th style={{ textAlign: "right" }}>Perte brute</th>
                </tr>
              </thead>
              <tbody>
                {data.negativeMarginSales.map((s, idx) => (
                  <tr key={`${s.invoiceNumber}-${idx}`}>
                    <td style={{ fontWeight: 600 }}>{s.invoiceNumber}</td>
                    <td>{s.date}</td>
                    <td>{s.customer}</td>
                    <td style={{ fontWeight: 500 }}>{s.product}</td>
                    <td style={{ textAlign: "right" }}>{s.quantity}</td>
                    <td style={{ textAlign: "right", color: "var(--red, #d04444)", fontWeight: 600 }}>{fmtDt(s.unitPrice)}</td>
                    <td style={{ textAlign: "right", color: "var(--muted)" }}>{fmtDt(s.unitCost)}</td>
                    <td style={{ textAlign: "right", color: "var(--red, #d04444)", fontWeight: 700 }}>{fmtDt(s.lossAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
export default ProfitabilityView
