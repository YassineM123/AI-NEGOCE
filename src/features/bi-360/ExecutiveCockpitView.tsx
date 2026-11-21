import React from "react"
import type { ExecutiveCockpitResponse, CockpitKpiCard } from "./types"
import { MoneyDisplay, fmtDt, fmtInt, fmtPct } from "./formatters"

interface ExecutiveCockpitViewProps {
  data: ExecutiveCockpitResponse | null
  loading: boolean
  onDrillDownAgency?: (agency: string) => void
  onNavigateTab?: (tab: string) => void
  onCopilotAnalyze?: (subject: string, context: Record<string, unknown>) => void
}

export const ExecutiveCockpitView: React.FC<ExecutiveCockpitViewProps> = ({
  data,
  loading,
  onDrillDownAgency,
  onNavigateTab,
  onCopilotAnalyze,
}) => {
  if (loading && !data) {
    return (
      <div className="bi-container">
        <div className="bi-kpi-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bi-kpi-card bi-skeleton" style={{ height: "110px" }} />
          ))}
        </div>
      </div>
    )
  }

  if (!data) return null

  const k = data.kpis
  const commercialCards: CockpitKpiCard[] = [
    k.revenueHt,
    k.grossMargin,
    k.markupRate,
    k.marginRate,
    k.targetAchievementRate,
    k.purchasesHt,
  ]

  const treasuryCards: CockpitKpiCard[] = [
    k.receivablesTotal,
    k.receivablesOverdue,
    k.supplierPayables,
    k.cashInflow,
    k.inventoryValuation,
    k.dormantInventory,
  ]

  const maxRevenue = Math.max(1, ...data.monthlyTrend.map((m) => Math.max(m.revenue, m.purchases)))

  const renderCard = (card: CockpitKpiCard) => {
    const isNegative = (card.deltaPct ?? card.deltaPts ?? 0) < 0
    const deltaLabel =
      card.deltaPts !== undefined && card.deltaPts !== null
        ? `${card.deltaPts > 0 ? "+" : ""}${card.deltaPts} pts`
        : card.deltaPct !== null && card.deltaPct !== undefined
          ? fmtPct(card.deltaPct)
          : null

    return (
      <div key={card.id} className="bi-kpi-card">
        <div className="bi-kpi-card-header">
          <span className="bi-kpi-title">{card.label}</span>
          <span className="bi-kpi-formula-info" title={`${card.tooltip}\nFormule : ${card.formula}`}>
            ⓘ
          </span>
        </div>
        <div className="bi-kpi-value">
          {card.unit === "DT" ? (
            <MoneyDisplay value={card.value} />
          ) : card.unit === "%" ? (
            <span className="bi-money"><span className="bi-money-int">{card.value.toFixed(1)}</span><span className="bi-money-unit">%</span></span>
          ) : (
            <span className="bi-money"><span className="bi-money-int">{fmtInt(card.value)}</span><span className="bi-money-unit">{card.unit}</span></span>
          )}
        </div>
        <div className="bi-kpi-footer">
          {deltaLabel ? (
            <span className={`bi-delta-pill ${isNegative ? "negative" : "positive"}`}>
              {deltaLabel} vs N-1
            </span>
          ) : (
            <span className="bi-delta-pill neutral">Actuel</span>
          )}
          <span className="bi-kpi-subtitle">{card.subtitle}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="bi-container">
      {/* 1. Commercial & Margin Pillar */}
      <div>
        <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.55rem" }}>
          Performance Commerciale & Rentabilité
        </div>
        <div className="bi-kpi-grid">
          {commercialCards.map(renderCard)}
        </div>
      </div>

      {/* 2. Treasury, BFR & Stocks Pillar */}
      <div style={{ marginTop: "0.25rem" }}>
        <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.55rem" }}>
          Trésorerie, Créances & Actifs Circulants
        </div>
        <div className="bi-kpi-grid">
          {treasuryCards.map(renderCard)}
        </div>
      </div>

      {/* 3. Charts & Performance Row */}
      <div className="bi-section-grid" style={{ marginTop: "0.5rem" }}>
        {/* Monthly Trend Bar Chart */}
        <div className="bi-panel">
          <div className="bi-panel-header">
            <div>
              <h3 className="bi-panel-title">Évolution mensuelle consolidée (12 mois)</h3>
              <p className="bi-panel-desc">Chiffre d’affaires HT, Marge brute et Achats fournisseurs en milliers de DT</p>
            </div>
            <div style={{ display: "flex", gap: "0.85rem", fontSize: "0.78rem", alignItems: "center" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                <span style={{ width: 8, height: 8, background: "var(--blue, #2d6cdf)", borderRadius: 2 }} /> CA HT
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                <span style={{ width: 8, height: 8, background: "var(--green, #15956f)", borderRadius: 2 }} /> Marge
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                <span style={{ width: 8, height: 8, background: "var(--amber, #d88716)", borderRadius: 2 }} /> Achats
              </span>
              {onCopilotAnalyze && (
                <button
                  className="bi-btn bi-btn-copilot"
                  style={{ height: "30px", padding: "0 0.65rem", fontSize: "0.75rem" }}
                  onClick={() =>
                    onCopilotAnalyze("Analyse tendance mensuelle CA et marge", {
                      months: data.monthlyTrend,
                      period: data.period,
                    })
                  }
                >
                  ✨ Analyser avec Copilot
                </button>
              )}
            </div>
          </div>

          <div className="bi-chart-grid">
            {data.monthlyTrend.map((m) => {
              const revH = (m.revenue / maxRevenue) * 100
              const marH = (m.margin / maxRevenue) * 100
              const purH = (m.purchases / maxRevenue) * 100

              return (
                <div key={m.month} className="bi-bar-col" title={`${m.month} : CA ${fmtDt(m.revenue)} | Marge ${fmtDt(m.margin)} | Achats ${fmtDt(m.purchases)}`}>
                  <div className="bi-bar-stack">
                    <div className="bi-bar revenue" style={{ height: `${Math.max(3, revH)}%` }} />
                    <div className="bi-bar margin" style={{ height: `${Math.max(3, marH)}%` }} />
                    <div className="bi-bar purchases" style={{ height: `${Math.max(3, purH)}%` }} />
                  </div>
                  <span className="bi-bar-label">{m.month.slice(5)}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Stock Aging & Health Panel */}
        <div className="bi-panel">
          <div className="bi-panel-header">
            <div>
              <h3 className="bi-panel-title">Structure et santé du stock</h3>
              <p className="bi-panel-desc">Ancienneté depuis la dernière vente</p>
            </div>
            {onNavigateTab && (
              <button
                className="btn btn-ghost"
                style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
                onClick={() => onNavigateTab("inventory")}
              >
                Détail stocks →
              </button>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem", marginTop: "0.4rem" }}>
            {(() => {
              const tot = data.inventoryAgingSummary.active + data.inventoryAgingSummary.watch + data.inventoryAgingSummary.dormant || 1
              const actPct = Math.round((data.inventoryAgingSummary.active / tot) * 100)
              const watPct = Math.round((data.inventoryAgingSummary.watch / tot) * 100)
              const dorPct = Math.round((data.inventoryAgingSummary.dormant / tot) * 100)

              return (
                <>
                  <div style={{ height: "12px", display: "flex", borderRadius: "9999px", overflow: "hidden", background: "#e2e8f0" }}>
                    <div style={{ width: `${actPct}%`, background: "var(--green, #15956f)" }} title={`Actif (< 90 j) : ${fmtDt(data.inventoryAgingSummary.active)}`} />
                    <div style={{ width: `${watPct}%`, background: "var(--amber, #d88716)" }} title={`À surveiller (90-180 j) : ${fmtDt(data.inventoryAgingSummary.watch)}`} />
                    <div style={{ width: `${dorPct}%`, background: "var(--red, #d04444)" }} title={`Dormant (> 180 j) : ${fmtDt(data.inventoryAgingSummary.dormant)}`} />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem", fontSize: "0.8rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "var(--green, #15956f)", fontWeight: 600 }}>● Actif (&lt; 90 j)</span>
                      <span><strong>{fmtDt(data.inventoryAgingSummary.active)}</strong> <span style={{ color: "var(--muted)" }}>({actPct} %)</span></span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "var(--amber, #d88716)", fontWeight: 600 }}>● À surveiller (90–180 j)</span>
                      <span><strong>{fmtDt(data.inventoryAgingSummary.watch)}</strong> <span style={{ color: "var(--muted)" }}>({watPct} %)</span></span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "var(--red, #d04444)", fontWeight: 600 }}>● Dormant (&gt; 180 j)</span>
                      <span><strong>{fmtDt(data.inventoryAgingSummary.dormant)}</strong> <span style={{ color: "var(--muted)" }}>({dorPct} %)</span></span>
                    </div>
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      </div>

      {/* 4. Agency Performance Table */}
      <div className="bi-panel" style={{ marginTop: "0.5rem" }}>
        <div className="bi-panel-header">
          <div>
            <h3 className="bi-panel-title">Performance et rentabilité par agence</h3>
            <p className="bi-panel-desc">Contribution au chiffre d’affaires global et taux de marque</p>
          </div>
        </div>

        <div className="bi-table-wrap">
          <table className="bi-table">
            <thead>
              <tr>
                <th>Agence</th>
                <th style={{ textAlign: "right" }}>Chiffre d’affaires HT</th>
                <th style={{ textAlign: "right" }}>Marge brute</th>
                <th style={{ textAlign: "right" }}>Taux de marque</th>
                <th>Part du CA</th>
                <th style={{ textAlign: "right" }}>Croissance vs N-1</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.agenciesPerformance.map((a) => (
                <tr key={a.agency}>
                  <td style={{ fontWeight: 600 }}>{a.agency}</td>
                  <td style={{ textAlign: "right" }}>{fmtDt(a.revenue)}</td>
                  <td style={{ textAlign: "right", fontWeight: 600, color: a.margin > 0 ? "var(--green, #15956f)" : "var(--red, #d04444)" }}>
                    {fmtDt(a.margin)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <span className="bi-badge-pill success">
                      {a.markupRate !== null ? `${a.markupRate.toFixed(1)} %` : "—"}
                    </span>
                  </td>
                  <td style={{ minWidth: "120px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <div className="bi-progress-track" style={{ flex: 1, margin: 0 }}>
                        <div className="bi-progress-fill" style={{ width: `${Math.min(100, a.sharePct)}%` }} />
                      </div>
                      <span style={{ fontSize: "0.75rem", color: "var(--muted)", width: "40px" }}>{a.sharePct.toFixed(1)} %</span>
                    </div>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {a.growthPct !== null ? (
                      <span className={`bi-delta-pill ${a.growthPct >= 0 ? "positive" : "negative"}`}>
                        {fmtPct(a.growthPct)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {onDrillDownAgency && (
                      <button
                        className="bi-btn bi-btn-secondary"
                        style={{ height: "26px", padding: "0 0.5rem", fontSize: "0.72rem" }}
                        onClick={() => onDrillDownAgency(a.agency)}
                      >
                        Filtrer
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
export default ExecutiveCockpitView
