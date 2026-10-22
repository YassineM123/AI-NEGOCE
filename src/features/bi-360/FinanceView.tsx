import React from "react"
import type { FinanceResponse } from "./types"
import { MoneyDisplay, fmtDt, fmtInt } from "./formatters"

interface FinanceViewProps {
  data: FinanceResponse | null
  loading: boolean
  onDrillDownCustomer?: (id: string, name: string) => void
  onCopilotAnalyze?: (subject: string, context: Record<string, unknown>) => void
}

export const FinanceView: React.FC<FinanceViewProps> = ({
  data,
  loading,
  onDrillDownCustomer,
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

  return (
    <div className="bi-container">
      {/* 1. Finance & Receivables KPIs */}
      <div className="bi-kpi-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        <div className="bi-kpi-card">
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">Créances clients totales (TTC)</span>
            <span className="bi-kpi-formula-info" title="Solde non réglé de l'ensemble des factures de vente TTC émises">ⓘ</span>
          </div>
          <div className="bi-kpi-value">
            <MoneyDisplay value={k.totalReceivables} />
          </div>
          <div className="bi-kpi-footer">
            <span className="bi-delta-pill neutral">Toutes agences</span>
            <span className="bi-kpi-subtitle">Encours client total</span>
          </div>
        </div>

        <div className="bi-kpi-card">
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">Créances échues (En retard)</span>
            <span className="bi-kpi-formula-info" title="Créances dont la date d'échéance contractuelle est dépassée">ⓘ</span>
          </div>
          <div className="bi-kpi-value">
            <MoneyDisplay value={k.overdueReceivables} color="var(--red, #d04444)" />
          </div>
          <div className="bi-kpi-footer">
            <span className="bi-delta-pill negative">{k.overduePct.toFixed(1)} % échues</span>
            <span className="bi-kpi-subtitle">Risque d'impayé</span>
          </div>
        </div>

        <div className="bi-kpi-card">
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">DSO (Délai moyen recouvrement)</span>
            <span className="bi-kpi-formula-info" title="Days Sales Outstanding : (Créances TTC / CA TTC annuel) * 365">ⓘ</span>
          </div>
          <div className="bi-kpi-value">
            <span className="bi-money"><span className="bi-money-int">{Math.round(k.dsoDays)}</span><span className="bi-money-unit">jours</span></span>
          </div>
          <div className="bi-kpi-footer">
            <span className={`bi-delta-pill ${k.dsoDays > 90 ? "negative" : "neutral"}`}>
              {k.dsoDays > 90 ? "Élevé (> 90j)" : "Maîtrisé"}
            </span>
            <span className="bi-kpi-subtitle">Vitesse d'encaissement</span>
          </div>
        </div>

        <div className="bi-kpi-card">
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">Dettes fournisseurs (TTC)</span>
            <span className="bi-kpi-formula-info" title="Total des factures d'achat fournisseurs en attente de règlement">ⓘ</span>
          </div>
          <div className="bi-kpi-value">
            <MoneyDisplay value={k.totalSupplierPayables} />
          </div>
          <div className="bi-kpi-footer">
            <span className="bi-delta-pill neutral">Échéances d'achat</span>
            <span className="bi-kpi-subtitle">Engagements décaissables</span>
          </div>
        </div>
      </div>

      {/* 2. Aging Balance (Balance Âgée) */}
      <div className="bi-panel">
        <div className="bi-panel-header">
          <div>
            <h3 className="bi-panel-title">Balance âgée des créances clients</h3>
            <p className="bi-panel-desc">Ventilation des encours par ancienneté de dépassement d'échéance</p>
          </div>
          {onCopilotAnalyze && (
            <button
              className="bi-btn bi-btn-copilot"
              style={{ height: "30px", padding: "0 0.65rem", fontSize: "0.75rem" }}
              onClick={() =>
                onCopilotAnalyze("Analyse du risque de recouvrement et créances douteuses", {
                  aging: data.agingBuckets,
                  debtors: data.topDebtorCustomers,
                  kpis: data.kpis,
                })
              }
            >
              ✨ Analyser le recouvrement avec Copilot
            </button>
          )}
        </div>
        <div className="bi-aging-grid">
          {data.agingBuckets.map((bucket) => {
            const toneBorder =
              bucket.tone === "danger"
                ? "var(--red, #d04444)"
                : bucket.tone === "warning"
                  ? "var(--amber, #d88716)"
                  : bucket.tone === "info"
                    ? "var(--blue, #2d6cdf)"
                    : "var(--green, #15956f)"

            return (
              <div key={bucket.bucket} className="bi-aging-card" style={{ borderLeft: `4px solid ${toneBorder}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="bi-aging-label">{bucket.label}</span>
                  <span
                    className={`bi-badge-pill ${
                      bucket.tone === "danger"
                        ? "danger"
                        : bucket.tone === "warning"
                          ? "warning"
                          : bucket.tone === "info"
                            ? "info"
                            : "success"
                    }`}
                  >
                    {bucket.sharePct.toFixed(1)} %
                  </span>
                </div>
                <div className="bi-aging-amount">
                  <MoneyDisplay value={bucket.amount} />
                </div>
                <div className="bi-aging-count">{fmtInt(bucket.invoicesCount)} facture(s) en attente</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 3. Top Debtors & Inflow Projections */}
      <div className="bi-section-grid">
        {/* Top Debtors Table */}
        <div className="bi-panel">
          <div className="bi-panel-header">
            <div>
              <h3 className="bi-panel-title">Top 10 Clients débiteurs</h3>
              <p className="bi-panel-desc">Encours les plus volumineux et dépassements d'échéances</p>
            </div>
          </div>
          <div className="bi-table-wrap">
            <table className="bi-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Agence</th>
                  <th style={{ textAlign: "right" }}>Encours total</th>
                  <th style={{ textAlign: "right" }}>Dont échu</th>
                  <th style={{ textAlign: "right" }}>Retard max</th>
                  <th>Statut limite</th>
                </tr>
              </thead>
              <tbody>
                {data.topDebtorCustomers.map((d) => (
                  <tr
                    key={d.customerId}
                    style={{ cursor: onDrillDownCustomer ? "pointer" : "default" }}
                    onClick={() => onDrillDownCustomer && onDrillDownCustomer(d.customerId, d.name)}
                  >
                    <td style={{ fontWeight: 600 }}>{d.name}</td>
                    <td>{d.agency}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtDt(d.outstandingAmount)}</td>
                    <td style={{ textAlign: "right", color: d.overdueAmount > 0 ? "var(--red, #d04444)" : "inherit", fontWeight: d.overdueAmount > 0 ? 600 : 400 }}>
                      {fmtDt(d.overdueAmount)}
                    </td>
                    <td style={{ textAlign: "right", color: d.oldestDueDays > 60 ? "var(--red, #d04444)" : "var(--muted)" }}>
                      {d.oldestDueDays > 0 ? `${d.oldestDueDays} j` : "À jour"}
                    </td>
                    <td>
                      {d.isOverLimit ? (
                        <span className="bi-badge-pill danger">Dépassement crédit</span>
                      ) : (
                        <span className="bi-badge-pill success">Autorisé</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Short Term Cash Flow Forecast */}
        <div className="bi-panel">
          <div className="bi-panel-header">
            <div>
              <h3 className="bi-panel-title">Prévision d’entrées / sorties de trésorerie</h3>
              <p className="bi-panel-desc">Solde net projeté selon échéanciers clients et fournisseurs</p>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            {data.cashInflowForecast.map((c) => (
              <div
                key={c.periodLabel}
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: "8px",
                  padding: "0.85rem 1rem",
                  background: "#f8fafc",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: "0.85rem" }}>
                  <span>{c.periodLabel}</span>
                  <span
                    style={{
                      color: c.netProjectedBalance >= 0 ? "var(--green, #15956f)" : "var(--red, #d04444)",
                    }}
                  >
                    Solde net : {c.netProjectedBalance >= 0 ? "+" : ""}
                    {fmtDt(c.netProjectedBalance)}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "0.75rem",
                    color: "var(--muted)",
                    marginTop: "0.35rem",
                  }}
                >
                  <span>Encaissements prévus : +{fmtDt(c.expectedReceivables)}</span>
                  <span>Décaissements prévus : -{fmtDt(c.expectedPayables)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
export default FinanceView
