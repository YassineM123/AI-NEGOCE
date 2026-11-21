import React from "react"
import type { PurchasesResponse } from "./types"
import { MoneyDisplay, fmtDt, fmtInt, fmtPct } from "./formatters"

interface PurchasesViewProps {
  data: PurchasesResponse | null
  loading: boolean
  onDrillDownSupplier?: (id: string, name: string) => void
  onCopilotAnalyze?: (subject: string, context: Record<string, unknown>) => void
}

export const PurchasesView: React.FC<PurchasesViewProps> = ({
  data,
  loading,
  onDrillDownSupplier,
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
  const maxMonthlyPurchases = Math.max(1, ...data.monthlyPurchases.map((m) => m.purchasesHt))

  return (
    <div className="bi-container">
      {/* 1. Purchases KPIs Grid */}
      <div className="bi-kpi-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        <div className="bi-kpi-card">
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">Achats nets HT</span>
            <span className="bi-kpi-formula-info" title="Total des factures d'achat fournisseurs HT validées">ⓘ</span>
          </div>
          <div className="bi-kpi-value">
            <MoneyDisplay value={k.totalPurchasesHt} />
          </div>
          <div className="bi-kpi-footer">
            {k.purchasesGrowthPct !== null && (
              <span className={`bi-delta-pill ${k.purchasesGrowthPct > 0 ? "warning" : "positive"}`}>
                {fmtPct(k.purchasesGrowthPct)} vs N-1
              </span>
            )}
            <span className="bi-kpi-subtitle">Volume approvisionné</span>
          </div>
        </div>

        <div className="bi-kpi-card">
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">Fournisseurs actifs</span>
            <span className="bi-kpi-formula-info" title="Nombre de fournisseurs auprès desquels des achats ont été facturés">ⓘ</span>
          </div>
          <div className="bi-kpi-value">
            <span className="bi-money"><span className="bi-money-int">{fmtInt(k.activeSuppliersCount)}</span><span className="bi-money-unit">tiers</span></span>
          </div>
          <div className="bi-kpi-footer">
            <span className="bi-delta-pill neutral">Panel actif</span>
            <span className="bi-kpi-subtitle">Comptes mouvementés</span>
          </div>
        </div>

        <div className="bi-kpi-card">
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">Concentration Top 3</span>
            <span className="bi-kpi-formula-info" title="Part des achats réalisée auprès des 3 premiers fournisseurs">ⓘ</span>
          </div>
          <div className="bi-kpi-value">
            <span className="bi-money"><span className="bi-money-int">{k.supplierConcentrationTop3Pct.toFixed(1)}</span><span className="bi-money-unit">%</span></span>
          </div>
          <div className="bi-kpi-footer">
            <span
              className={`bi-delta-pill ${
                k.supplierConcentrationTop3Pct > 60 ? "warning" : "positive"
              }`}
            >
              {k.supplierConcentrationTop3Pct > 60 ? "Dépendance forte" : "Diversifié"}
            </span>
            <span className="bi-kpi-subtitle">Risque appro</span>
          </div>
        </div>

        <div className="bi-kpi-card">
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">Commandes en cours (Engagées)</span>
            <span className="bi-kpi-formula-info" title="Montant des bons de commande fournisseurs en attente de réception">ⓘ</span>
          </div>
          <div className="bi-kpi-value">
            <MoneyDisplay value={k.openOrdersValue} />
          </div>
          <div className="bi-kpi-footer">
            <span className="bi-delta-pill neutral">{fmtInt(k.totalPurchaseOrders)} commandes</span>
            <span className="bi-kpi-subtitle">Engagements d'achat</span>
          </div>
        </div>
      </div>

      {/* 2. Monthly Trend + Top Suppliers */}
      <div className="bi-section-grid">
        <div className="bi-panel">
          <div className="bi-panel-header">
            <div>
              <h3 className="bi-panel-title">Tendance des approvisionnements (12 mois)</h3>
              <p className="bi-panel-desc">Achats mensuels HT et fréquence de commandes</p>
            </div>
            {onCopilotAnalyze && (
              <button
                className="bi-btn bi-btn-copilot"
                style={{ height: "30px", padding: "0 0.65rem", fontSize: "0.75rem" }}
                onClick={() =>
                  onCopilotAnalyze("Analyse des approvisionnements et inflation fournisseurs", {
                    monthlyPurchases: data.monthlyPurchases,
                    kpis: data.kpis,
                  })
                }
              >
                ✨ Analyser avec Copilot
              </button>
            )}
          </div>
          <div className="bi-chart-grid">
            {data.monthlyPurchases.map((m) => {
              const h = (m.purchasesHt / maxMonthlyPurchases) * 100
              return (
                <div key={m.month} className="bi-bar-col" title={`Mois ${m.month} : Achats ${fmtDt(m.purchasesHt)} | ${m.ordersCount} commandes`}>
                  <div className="bi-bar-stack">
                    <div
                      className="bi-bar purchases"
                      style={{ height: `${Math.max(4, h)}%`, width: "16px" }}
                    />
                  </div>
                  <span className="bi-bar-label">{m.month.slice(5)}</span>
                  <span style={{ fontSize: "0.68rem", color: "var(--muted)" }}>{m.ordersCount} cmd</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Top Suppliers Table */}
        <div className="bi-panel">
          <div className="bi-panel-header">
            <div>
              <h3 className="bi-panel-title">Principaux fournisseurs</h3>
              <p className="bi-panel-desc">Volume d'affaires et conditions de paiement négociées</p>
            </div>
          </div>
          <div className="bi-table-wrap">
            <table className="bi-table">
              <thead>
                <tr>
                  <th>Fournisseur</th>
                  <th>Ville</th>
                  <th style={{ textAlign: "right" }}>Achats HT</th>
                  <th style={{ textAlign: "right" }}>Part</th>
                  <th style={{ textAlign: "right" }}>Délai nég.</th>
                </tr>
              </thead>
              <tbody>
                {data.topSuppliers.map((s) => (
                  <tr
                    key={s.id}
                    style={{ cursor: onDrillDownSupplier ? "pointer" : "default" }}
                    onClick={() => onDrillDownSupplier && onDrillDownSupplier(s.id, s.name)}
                  >
                    <td style={{ fontWeight: 600 }}>{s.name}</td>
                    <td>{s.city}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtDt(s.totalPurchasesHt)}</td>
                    <td style={{ textAlign: "right" }}>{s.sharePct.toFixed(1)} %</td>
                    <td style={{ textAlign: "right", color: "var(--muted)" }}>{s.paymentTermsDays} j</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 3. Price Evolution / Inflation Alerts */}
      {data.priceEvolutionAlerts.length > 0 && (
        <div className="bi-panel">
          <div className="bi-panel-header">
            <div>
              <h3 className="bi-panel-title">⚡ Alertes hausses de tarifs fournisseurs (Inflation matières)</h3>
              <p className="bi-panel-desc">
                Articles ayant subi une augmentation de coût unitaire d’achat &gt; 5% sur la période
              </p>
            </div>
          </div>
          <div className="bi-table-wrap">
            <table className="bi-table">
              <thead>
                <tr>
                  <th>Article</th>
                  <th>Fournisseur</th>
                  <th style={{ textAlign: "right" }}>Coût initial HT</th>
                  <th style={{ textAlign: "right" }}>Dernier coût HT</th>
                  <th style={{ textAlign: "right" }}>Inflation %</th>
                  <th style={{ textAlign: "right" }}>Surcoût total estimé</th>
                </tr>
              </thead>
              <tbody>
                {data.priceEvolutionAlerts.map((a, idx) => (
                  <tr key={`${a.productId}-${idx}`}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{a.productName}</div>
                      <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{a.sku}</div>
                    </td>
                    <td>{a.supplierName}</td>
                    <td style={{ textAlign: "right", color: "var(--muted)" }}>{fmtDt(a.initialUnitCost)}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtDt(a.latestUnitCost)}</td>
                    <td style={{ textAlign: "right" }}>
                      <span className="bi-badge-pill danger">+{a.inflationPct.toFixed(1)} %</span>
                    </td>
                    <td style={{ textAlign: "right", color: "var(--red, #d04444)", fontWeight: 700 }}>+{fmtDt(a.impactDt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. Recent Purchase Orders */}
      <div className="bi-panel">
        <div className="bi-panel-header">
          <div>
            <h3 className="bi-panel-title">Dernières commandes fournisseurs émises</h3>
            <p className="bi-panel-desc">Suivi des réceptions et montants engagés</p>
          </div>
        </div>
        <div className="bi-table-wrap">
          <table className="bi-table">
            <thead>
              <tr>
                <th>N° Commande</th>
                <th>Date</th>
                <th>Fournisseur</th>
                <th>Agence</th>
                <th>Statut</th>
                <th style={{ textAlign: "right" }}>Montant HT</th>
              </tr>
            </thead>
            <tbody>
              {data.recentPurchaseOrders.map((po) => (
                <tr key={po.id}>
                  <td style={{ fontWeight: 600 }}>{po.id}</td>
                  <td>{po.date}</td>
                  <td style={{ fontWeight: 500 }}>{po.supplier}</td>
                  <td>{po.agency}</td>
                  <td>
                    <span
                      className={`bi-badge-pill ${
                        po.status === "received" ? "success" : po.status === "cancelled" ? "danger" : "warning"
                      }`}
                    >
                      {po.status === "received" ? "Reçu" : po.status === "pending" ? "En attente" : po.status}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtDt(po.totalHt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
export default PurchasesView
