import React from "react"
import type { ForecastingResponse } from "./types"

interface ForecastingViewProps {
  data: ForecastingResponse | null
  loading: boolean
  onCopilotAnalyze?: (subject: string, context: Record<string, unknown>) => void
}

const fmtDt = (n: number) =>
  new Intl.NumberFormat("fr-TN", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(n) + " DT"
const fmtPct = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)} %`)

export const ForecastingView: React.FC<ForecastingViewProps> = ({ data, loading, onCopilotAnalyze }) => {
  if (loading && !data) {
    return (
      <div className="bi-container">
        <div className="bi-panel bi-skeleton" style={{ height: "300px" }} />
      </div>
    )
  }

  if (!data) return null

  const maxVal = Math.max(
    1,
    ...data.salesForecast.map((f) =>
      Math.max(f.historicalActual || 0, f.forecastValue || 0, f.upperConfidenceBound || 0)
    )
  )

  return (
    <div className="bi-container">
      {/* 1. Forecast Accuracy & Methodology Header */}
      <div className="bi-kpi-grid">
        <div className="bi-kpi-card">
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">Modèle prévisionnel</span>
            <span className="bi-kpi-formula-info" title="Régression linéaire multivariée avec indices de saisonnalité mensuelle">ⓘ</span>
          </div>
          <div className="bi-kpi-value" style={{ fontSize: "1.2rem" }}>
            {data.accuracyMetrics.method}
          </div>
          <div className="bi-kpi-footer">
            <span className="bi-kpi-subtitle">Horizon : +{data.forecastHorizonMonths} mois</span>
          </div>
        </div>

        <div className="bi-kpi-card">
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">Précision du backtest (MAPE)</span>
            <span className="bi-kpi-formula-info" title="Mean Absolute Percentage Error mesuré sur la fenêtre de validation historique">ⓘ</span>
          </div>
          <div className="bi-kpi-value">{data.accuracyMetrics.mape.toFixed(1)} %</div>
          <div className="bi-kpi-footer">
            <span
              className={`bi-delta-pill ${
                data.accuracyMetrics.mape < 15 ? "positive" : "warning"
              }`}
            >
              {data.accuracyMetrics.mape < 15 ? "Excellente robustesse" : "Acceptable"}
            </span>
            <span className="bi-kpi-subtitle">Erreur moyenne</span>
          </div>
        </div>

        <div className="bi-kpi-card">
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">Erreur type (RMSE)</span>
            <span className="bi-kpi-formula-info" title="Root Mean Squared Error en DT sur les prédictions passées">ⓘ</span>
          </div>
          <div className="bi-kpi-value">{fmtDt(data.accuracyMetrics.rmse)}</div>
          <div className="bi-kpi-footer">
            <span className="bi-kpi-subtitle">{data.accuracyMetrics.backtestWindow}</span>
          </div>
        </div>
      </div>

      {/* 2. Sales Forecast Chart with 95% Confidence Interval */}
      <div className="bi-panel">
        <div className="bi-panel-header">
          <div>
            <h3 className="bi-panel-title">Prévisions des ventes & Intervalle de confiance à 95%</h3>
            <p className="bi-panel-desc">
              Historique réel (bleu) et projections statistiques avec borne haute et basse
            </p>
          </div>
          {onCopilotAnalyze && (
            <button
              className="bi-copilot-btn"
              onClick={() =>
                onCopilotAnalyze("Simulation budgétaire et analyse de prévision des ventes", {
                  forecast: data.salesForecast,
                  simulations: data.simulations,
                  accuracy: data.accuracyMetrics,
                })
              }
            >
              ✨ Évaluer le scénario avec Copilot
            </button>
          )}
        </div>

        <div className="bi-chart-grid" style={{ minHeight: "180px" }}>
          {data.salesForecast.map((item) => {
            const isHistorical = item.historicalActual !== null
            const mainVal = isHistorical ? item.historicalActual! : item.forecastValue!
            const h = (mainVal / maxVal) * 100

            return (
              <div key={item.month} className="bi-bar-col">
                <div className="bi-bar-stack">
                  <div
                    className={`bi-bar ${isHistorical ? "revenue" : "forecast"}`}
                    style={{
                      height: `${Math.max(6, h)}%`,
                      background: isHistorical
                        ? "#2563eb"
                        : "repeating-linear-gradient(45deg, #3b82f6, #3b82f6 5px, #60a5fa 5px, #60a5fa 10px)",
                    }}
                    title={
                      isHistorical
                        ? `Réel : ${fmtDt(item.historicalActual!)}`
                        : `Prévision : ${fmtDt(item.forecastValue!)}\nIntervalle : [${fmtDt(
                            item.lowerConfidenceBound!
                          )} - ${fmtDt(item.upperConfidenceBound!)}]`
                    }
                  >
                    <span className="bi-bar-val">{Math.round(mainVal / 1000)}k</span>
                  </div>
                </div>
                <span className="bi-bar-label">{item.month.slice(5)}</span>
                <span style={{ fontSize: "0.65rem", color: isHistorical ? "var(--muted)" : "#2563eb" }}>
                  {isHistorical ? "Réel" : "Prévu"}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* 3. What-If Simulations (Price & Cost Sensitivities) */}
      <div className="bi-section-grid">
        {/* Price Sensitivity Table */}
        <div className="bi-panel">
          <div className="bi-panel-header">
            <div>
              <h3 className="bi-panel-title">Simulation d’élasticité : Ajustement tarifaire</h3>
              <p className="bi-panel-desc">Impact d'une hausse ou baisse de prix sur la marge brute</p>
            </div>
          </div>
          <div className="bi-table-wrap">
            <table className="bi-table">
              <thead>
                <tr>
                  <th>Scénario Prix</th>
                  <th style={{ textAlign: "right" }}>CA Simulé HT</th>
                  <th style={{ textAlign: "right" }}>Marge Simulée</th>
                  <th style={{ textAlign: "right" }}>Impact Marge (DT)</th>
                </tr>
              </thead>
              <tbody>
                {data.simulations.priceSensitivity.map((s) => (
                  <tr key={s.priceAdjustmentPct}>
                    <td style={{ fontWeight: 600 }}>
                      <span
                        className={`bi-badge-pill ${
                          s.priceAdjustmentPct > 0
                            ? "success"
                            : s.priceAdjustmentPct < 0
                              ? "danger"
                              : "info"
                        }`}
                      >
                        {s.priceAdjustmentPct > 0 ? "+" : ""}
                        {s.priceAdjustmentPct} % Prix
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>{fmtDt(s.simulatedRevenue)}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtDt(s.simulatedGrossMargin)}</td>
                    <td
                      style={{
                        textAlign: "right",
                        fontWeight: 700,
                        color: s.deltaMarginDt < 0 ? "#dc2626" : s.deltaMarginDt > 0 ? "#10b981" : "inherit",
                      }}
                    >
                      {s.deltaMarginDt > 0 ? "+" : ""}
                      {fmtDt(s.deltaMarginDt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Cost Inflation Sensitivity Table */}
        <div className="bi-panel">
          <div className="bi-panel-header">
            <div>
              <h3 className="bi-panel-title">Simulation de choc : Inflation des coûts fournisseurs</h3>
              <p className="bi-panel-desc">Résilience de la marge brute face aux hausses de coûts d'achat</p>
            </div>
          </div>
          <div className="bi-table-wrap">
            <table className="bi-table">
              <thead>
                <tr>
                  <th>Hausse Coûts</th>
                  <th style={{ textAlign: "right" }}>Marge Résiduelle</th>
                  <th style={{ textAlign: "right" }}>Érosion Marge (DT)</th>
                  <th style={{ textAlign: "right" }}>Taux de marque</th>
                </tr>
              </thead>
              <tbody>
                {data.simulations.costInflationSensitivity.map((s) => (
                  <tr key={s.costAdjustmentPct}>
                    <td style={{ fontWeight: 600 }}>
                      <span className="bi-badge-pill warning">+{s.costAdjustmentPct} % Achat</span>
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtDt(s.simulatedGrossMargin)}</td>
                    <td style={{ textAlign: "right", color: "#dc2626", fontWeight: 700 }}>
                      {fmtDt(s.deltaMarginDt)}
                    </td>
                    <td style={{ textAlign: "right" }}>{s.markupRatePct.toFixed(1)} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
export default ForecastingView
