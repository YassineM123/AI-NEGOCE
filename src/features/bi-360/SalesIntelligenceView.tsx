import React from "react"
import type { SalesIntelligenceResponse } from "./types"
import { MoneyDisplay, fmtDt, fmtInt, fmtPct } from "./formatters"

interface SalesIntelligenceViewProps {
  data: SalesIntelligenceResponse | null
  loading: boolean
  onDrillDownCustomer?: (id: string, name: string) => void
  onDrillDownProduct?: (id: string, name: string) => void
  onCopilotAnalyze?: (subject: string, context: Record<string, unknown>) => void
}

export const SalesIntelligenceView: React.FC<SalesIntelligenceViewProps> = ({
  data,
  loading,
  onDrillDownCustomer,
  onDrillDownProduct,
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
  const maxMonthlyRevenue = Math.max(1, ...data.monthlyTrend.map((m) => m.revenue))

  return (
    <div className="bi-container">
      {/* 1. KPIs Grid */}
      <div className="bi-kpi-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        <div className="bi-kpi-card">
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">Chiffre d’affaires HT</span>
            <span className="bi-kpi-formula-info" title="Somme des factures de vente HT nettes de remises">ⓘ</span>
          </div>
          <div className="bi-kpi-value">
            <MoneyDisplay value={k.totalSalesHt} />
          </div>
          <div className="bi-kpi-footer">
            {k.salesGrowthPct !== null && (
              <span className={`bi-delta-pill ${k.salesGrowthPct < 0 ? "negative" : "positive"}`}>
                {fmtPct(k.salesGrowthPct)} vs N-1
              </span>
            )}
            <span className="bi-kpi-subtitle">Ventes nettes HT</span>
          </div>
        </div>

        <div className="bi-kpi-card">
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">Panier moyen</span>
            <span className="bi-kpi-formula-info" title="Total Ventes HT / Nombre de factures émises">ⓘ</span>
          </div>
          <div className="bi-kpi-value">
            <MoneyDisplay value={k.averageOrderValue} />
          </div>
          <div className="bi-kpi-footer">
            <span className="bi-delta-pill neutral">{fmtInt(k.totalInvoices)} factures</span>
            <span className="bi-kpi-subtitle">Moyenne / commande</span>
          </div>
        </div>

        <div className="bi-kpi-card">
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">Clients actifs</span>
            <span className="bi-kpi-formula-info" title="Nombre de clients distincts ayant acheté sur la période">ⓘ</span>
          </div>
          <div className="bi-kpi-value">
            <span className="bi-money"><span className="bi-money-int">{fmtInt(k.activeCustomersCount)}</span><span className="bi-money-unit">clients</span></span>
          </div>
          <div className="bi-kpi-footer">
            <span className="bi-delta-pill positive">+{fmtInt(k.newCustomersCount)} nouv.</span>
            <span className="bi-kpi-subtitle">Portefeuille acheteur</span>
          </div>
        </div>

        <div className="bi-kpi-card">
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">Remises accordées</span>
            <span className="bi-kpi-formula-info" title="Total des remises commerciales consenties en DT et taux moyen">ⓘ</span>
          </div>
          <div className="bi-kpi-value">
            <MoneyDisplay value={k.totalDiscountsGranted} />
          </div>
          <div className="bi-kpi-footer">
            <span className="bi-delta-pill neutral">{k.averageDiscountPct.toFixed(1)} % moy.</span>
            <span className="bi-kpi-subtitle">Impact commercial</span>
          </div>
        </div>
      </div>

      {/* 2. Monthly Sales Trend + Customer Segments */}
      <div className="bi-section-grid">
        <div className="bi-panel">
          <div className="bi-panel-header">
            <div>
              <h3 className="bi-panel-title">Tendance des ventes et volume de factures</h3>
              <p className="bi-panel-desc">Ventes mensuelles HT et nombre de commandes sur 12 mois</p>
            </div>
            {onCopilotAnalyze && (
              <button
                className="bi-btn bi-btn-copilot"
                style={{ height: "30px", padding: "0 0.65rem", fontSize: "0.75rem" }}
                onClick={() =>
                  onCopilotAnalyze("Analyse de la dynamique des ventes et saisonnalité", {
                    monthlySales: data.monthlyTrend,
                    kpis: data.kpis,
                  })
                }
              >
                ✨ Analyser avec Copilot
              </button>
            )}
          </div>
          <div className="bi-chart-grid">
            {data.monthlyTrend.map((m) => {
              const h = (m.revenue / maxMonthlyRevenue) * 100
              return (
                <div key={m.month} className="bi-bar-col" title={`Mois ${m.month} : CA ${fmtDt(m.revenue)} | ${m.ordersCount} factures`}>
                  <div className="bi-bar-stack">
                    <div className="bi-bar revenue" style={{ height: `${Math.max(4, h)}%`, width: "16px" }} />
                  </div>
                  <span className="bi-bar-label">{m.month.slice(5)}</span>
                  <span style={{ fontSize: "0.68rem", color: "var(--muted)" }}>{m.ordersCount} fct</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Customer Segments Card */}
        <div className="bi-panel">
          <div className="bi-panel-header">
            <div>
              <h3 className="bi-panel-title">Segmentation du portefeuille</h3>
              <p className="bi-panel-desc">Répartition du chiffre d’affaires par catégorie de client</p>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.95rem" }}>
            {data.customerSegments.map((seg) => (
              <div key={seg.segment} style={{ background: "#f8fafc", padding: "0.75rem 0.95rem", borderRadius: "8px", border: "1px solid var(--line)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.82rem" }}>
                  <span style={{ fontWeight: 600 }}>{seg.segment} <span style={{ color: "var(--muted)", fontWeight: 500 }}>({seg.customersCount} clients)</span></span>
                  <span style={{ fontWeight: 700 }}>{fmtDt(seg.revenue)} <span style={{ color: "var(--muted)", fontWeight: 500 }}>({seg.sharePct.toFixed(1)}%)</span></span>
                </div>
                <div className="bi-progress-track">
                  <div className="bi-progress-fill" style={{ width: `${seg.sharePct}%`, background: "var(--blue, #2d6cdf)" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 3. Pareto 80/20 Curve & Top Customers */}
      <div className="bi-panel">
        <div className="bi-panel-header">
          <div>
            <h3 className="bi-panel-title">Analyse Pareto 80/20 — Concentration des clients</h3>
            <p className="bi-panel-desc">
              Classe A : ~80% du CA (stratégiques) • Classe B : ~15% du CA (intermédiaires) • Classe C : ~5% du CA (occasionnels)
            </p>
          </div>
        </div>
        <div className="bi-table-wrap">
          <table className="bi-table">
            <thead>
              <tr>
                <th style={{ width: "50px" }}>Rang</th>
                <th>Client</th>
                <th>Classe</th>
                <th style={{ textAlign: "right" }}>CA HT</th>
                <th style={{ textAlign: "right" }}>Part cumulée</th>
                <th>Progression Pareto</th>
              </tr>
            </thead>
            <tbody>
              {data.paretoCustomers.slice(0, 15).map((c) => (
                <tr
                  key={c.rank}
                  style={{ cursor: onDrillDownCustomer ? "pointer" : "default" }}
                  onClick={() => onDrillDownCustomer && onDrillDownCustomer(c.name, c.name)}
                >
                  <td style={{ fontWeight: 600, color: "var(--muted)" }}>#{c.rank}</td>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td>
                    <span
                      className={`bi-badge-pill ${
                        c.segment === "A" ? "success" : c.segment === "B" ? "warning" : "info"
                      }`}
                    >
                      Classe {c.segment}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtDt(c.revenue)}</td>
                  <td style={{ textAlign: "right", color: "var(--muted)" }}>{c.cumulativeSharePct.toFixed(1)} %</td>
                  <td style={{ width: "160px" }}>
                    <div className="bi-progress-track" style={{ margin: 0 }}>
                      <div
                        className="bi-progress-fill"
                        style={{
                          width: `${Math.min(100, c.cumulativeSharePct)}%`,
                          background: c.segment === "A" ? "var(--green, #15956f)" : c.segment === "B" ? "var(--amber, #d88716)" : "#64748b",
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. Top Products & Reps Performance */}
      <div className="bi-section-grid">
        {/* Top Products Table */}
        <div className="bi-panel">
          <div className="bi-panel-header">
            <div>
              <h3 className="bi-panel-title">Top 10 Produits par chiffre d’affaires</h3>
              <p className="bi-panel-desc">Volumes vendus, CA réalisé et taux de marge commerciale</p>
            </div>
          </div>
          <div className="bi-table-wrap">
            <table className="bi-table">
              <thead>
                <tr>
                  <th>SKU / Produit</th>
                  <th>Famille</th>
                  <th style={{ textAlign: "right" }}>Qté</th>
                  <th style={{ textAlign: "right" }}>CA HT</th>
                  <th style={{ textAlign: "right" }}>Marge %</th>
                </tr>
              </thead>
              <tbody>
                {data.topProducts.map((p) => (
                  <tr
                    key={p.id}
                    style={{ cursor: onDrillDownProduct ? "pointer" : "default" }}
                    onClick={() => onDrillDownProduct && onDrillDownProduct(p.id, p.name)}
                  >
                    <td>
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{p.sku}</div>
                    </td>
                    <td><span className="bi-badge-pill info">{p.category}</span></td>
                    <td style={{ textAlign: "right" }}>{fmtInt(p.quantitySold)}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtDt(p.revenue)}</td>
                    <td style={{ textAlign: "right" }}>
                      <span className={`bi-badge-pill ${(p.marginPct ?? 0) < 15 ? "danger" : "success"}`}>
                        {p.marginPct !== null ? `${p.marginPct.toFixed(1)}%` : "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Commercial Representatives Performance */}
        <div className="bi-panel">
          <div className="bi-panel-header">
            <div>
              <h3 className="bi-panel-title">Performance de la force de vente</h3>
              <p className="bi-panel-desc">Activité par commercial et rentabilité apportée</p>
            </div>
          </div>
          <div className="bi-table-wrap">
            <table className="bi-table">
              <thead>
                <tr>
                  <th>Commercial</th>
                  <th>Agence</th>
                  <th style={{ textAlign: "right" }}>Factures</th>
                  <th style={{ textAlign: "right" }}>CA HT</th>
                  <th style={{ textAlign: "right" }}>Marge %</th>
                </tr>
              </thead>
              <tbody>
                {data.salesByRep.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td>{r.agency}</td>
                    <td style={{ textAlign: "right" }}>{r.invoicesCount}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtDt(r.revenue)}</td>
                    <td style={{ textAlign: "right" }}>
                      <span className="bi-badge-pill success">
                        {r.marginPct !== null ? `${r.marginPct.toFixed(1)}%` : "—"}
                      </span>
                    </td>
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
export default SalesIntelligenceView
