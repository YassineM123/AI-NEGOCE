import React from "react"
import type { InventoryResponse } from "./types"
import { MoneyDisplay, fmtDt, fmtInt } from "./formatters"

interface InventoryViewProps {
  data: InventoryResponse | null
  loading: boolean
  onDrillDownProduct?: (id: string, name: string) => void
  onCopilotAnalyze?: (subject: string, context: Record<string, unknown>) => void
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  data,
  loading,
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

  return (
    <div className="bi-container">
      {/* 1. Inventory KPIs Grid */}
      <div className="bi-kpi-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        <div className="bi-kpi-card">
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">Valorisation du stock</span>
            <span className="bi-kpi-formula-info" title="Somme (Quantité physique en stock * Prix Moyen Pondéré PMP)">ⓘ</span>
          </div>
          <div className="bi-kpi-value">
            <MoneyDisplay value={k.totalValuation} />
          </div>
          <div className="bi-kpi-footer">
            <span className="bi-delta-pill neutral">PMP Certifié</span>
            <span className="bi-kpi-subtitle">Actif circulant immobilisé</span>
          </div>
        </div>

        <div className="bi-kpi-card">
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">Stock dormant / à risque</span>
            <span className="bi-kpi-formula-info" title="Valorisation des articles sans aucun mouvement de vente depuis > 90 jours">ⓘ</span>
          </div>
          <div className="bi-kpi-value">
            <MoneyDisplay value={k.dormantValuation} color={k.dormantPct > 15 ? "var(--red, #d04444)" : undefined} />
          </div>
          <div className="bi-kpi-footer">
            <span className={`bi-delta-pill ${k.dormantPct > 15 ? "negative" : "neutral"}`}>
              {k.dormantPct.toFixed(1)} % du total
            </span>
            <span className="bi-kpi-subtitle">Trésorerie gelée (&gt; 90j)</span>
          </div>
        </div>

        <div className="bi-kpi-card">
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">Alertes réapprovisionnement</span>
            <span className="bi-kpi-formula-info" title="Articles dont le stock actuel est inférieur ou égal au point de commande">ⓘ</span>
          </div>
          <div className="bi-kpi-value" style={{ color: k.reorderAlertCount > 0 ? "var(--amber, #d88716)" : undefined }}>
            <span className="bi-money"><span className="bi-money-int">{fmtInt(k.reorderAlertCount)}</span><span className="bi-money-unit">réf.</span></span>
          </div>
          <div className="bi-kpi-footer">
            <span className={`bi-delta-pill ${k.reorderAlertCount > 0 ? "warning" : "positive"}`}>
              {k.reorderAlertCount > 0 ? "Ruptures imminentes" : "Stocks sécurisés"}
            </span>
            <span className="bi-kpi-subtitle">À commander d'urgence</span>
          </div>
        </div>

        <div className="bi-kpi-card">
          <div className="bi-kpi-card-header">
            <span className="bi-kpi-title">Rotation & Couverture</span>
            <span className="bi-kpi-formula-info" title="Couverture moyenne en jours de vente basée sur les sorties récentes">ⓘ</span>
          </div>
          <div className="bi-kpi-value">
            <span className="bi-money"><span className="bi-money-int">{Math.round(k.estimatedCoverageDays)}</span><span className="bi-money-unit">jours</span></span>
          </div>
          <div className="bi-kpi-footer">
            <span className="bi-delta-pill neutral">{k.averageTurnoverRatio.toFixed(1)}x rotation</span>
            <span className="bi-kpi-subtitle">Autonomie opérationnelle</span>
          </div>
        </div>
      </div>

      {/* 2. ABC & XYZ Matrices */}
      <div className="bi-section-grid">
        {/* ABC Classification */}
        <div className="bi-panel">
          <div className="bi-panel-header">
            <div>
              <h3 className="bi-panel-title">Classification ABC (Valeur financière du stock)</h3>
              <p className="bi-panel-desc">
                Classe A : 80% de la valeur • Classe B : 15% • Classe C : 5%
              </p>
            </div>
            {onCopilotAnalyze && (
              <button
                className="bi-btn bi-btn-copilot"
                style={{ height: "30px", padding: "0 0.65rem", fontSize: "0.75rem" }}
                onClick={() =>
                  onCopilotAnalyze("Optimisation des stocks et analyse ABC / XYZ", {
                    abc: data.abcClassification,
                    xyz: data.xyzDemandAnalysis,
                    kpis: data.kpis,
                  })
                }
              >
                ✨ Analyser avec Copilot
              </button>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.95rem" }}>
            {data.abcClassification.map((abc) => (
              <div key={abc.class} style={{ background: "#f8fafc", padding: "0.75rem 0.95rem", borderRadius: "8px", border: "1px solid var(--line)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.82rem" }}>
                  <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span
                      className={`bi-badge-pill ${
                        abc.class === "A" ? "success" : abc.class === "B" ? "warning" : "info"
                      }`}
                    >
                      Classe {abc.class}
                    </span>
                    <span>{abc.label}</span>
                    <span style={{ color: "var(--muted)", fontWeight: 500 }}>({fmtInt(abc.itemsCount)} réf.)</span>
                  </span>
                  <span style={{ fontWeight: 700 }}>
                    {fmtDt(abc.valuation)} <span style={{ color: "var(--muted)", fontWeight: 500 }}>({abc.sharePct.toFixed(1)}%)</span>
                  </span>
                </div>
                <div className="bi-progress-track">
                  <div
                    className="bi-progress-fill"
                    style={{
                      width: `${abc.sharePct}%`,
                      background: abc.class === "A" ? "var(--green, #15956f)" : abc.class === "B" ? "var(--amber, #d88716)" : "#64748b",
                    }}
                  />
                </div>
                <div style={{ fontSize: "0.74rem", color: "var(--muted)", marginTop: "0.15rem" }}>
                  {abc.description}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* XYZ Demand Stability */}
        <div className="bi-panel">
          <div className="bi-panel-header">
            <div>
              <h3 className="bi-panel-title">Classification XYZ (Stabilité de la demande)</h3>
              <p className="bi-panel-desc">
                X : Consommation régulière • Y : Saisonnière / Fluctuante • Z : Aléatoire
              </p>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.95rem" }}>
            {data.xyzDemandAnalysis.map((xyz) => (
              <div key={xyz.variability} style={{ background: "#f8fafc", padding: "0.75rem 0.95rem", borderRadius: "8px", border: "1px solid var(--line)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.82rem" }}>
                  <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span className="bi-badge-pill info">
                      Groupe {xyz.variability}
                    </span>
                    <span>{xyz.label}</span>
                  </span>
                  <span style={{ fontWeight: 700 }}>{fmtInt(xyz.itemsCount)} articles</span>
                </div>
                <div style={{ fontSize: "0.74rem", color: "var(--muted)", marginTop: "0.35rem" }}>
                  {xyz.description}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 3. Reorder Recommendations Table */}
      {data.reorderRecommendations.length > 0 && (
        <div className="bi-panel">
          <div className="bi-panel-header">
            <div>
              <h3 className="bi-panel-title">⚡ Recommandations de réapprovisionnement</h3>
              <p className="bi-panel-desc">
                Quantités suggérées pour éviter les ruptures basées sur les seuils de sécurité
              </p>
            </div>
          </div>
          <div className="bi-table-wrap">
            <table className="bi-table">
              <thead>
                <tr>
                  <th>Article</th>
                  <th>Agence</th>
                  <th style={{ textAlign: "right" }}>Stock actuel</th>
                  <th style={{ textAlign: "right" }}>Seuil d'alerte</th>
                  <th style={{ textAlign: "right" }}>Quantité suggérée</th>
                  <th style={{ textAlign: "right" }}>Coût estimé</th>
                  <th style={{ textAlign: "right" }}>Niveau de risque</th>
                </tr>
              </thead>
              <tbody>
                {data.reorderRecommendations.map((r, idx) => (
                  <tr
                    key={`${r.productId}-${r.agency}-${idx}`}
                    style={{ cursor: onDrillDownProduct ? "pointer" : "default" }}
                    onClick={() => onDrillDownProduct && onDrillDownProduct(r.productId, r.productName)}
                  >
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.productName}</div>
                      <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{r.sku}</div>
                    </td>
                    <td>{r.agency}</td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: "var(--red, #d04444)" }}>
                      {fmtInt(r.currentQuantity)}
                    </td>
                    <td style={{ textAlign: "right", color: "var(--muted)" }}>{fmtInt(r.reorderPoint)}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtInt(r.suggestedReorderQuantity)}</td>
                    <td style={{ textAlign: "right" }}>{fmtDt(r.suggestedReorderQuantity * r.unitCost)}</td>
                    <td style={{ textAlign: "right" }}>
                      <span className={`bi-badge-pill ${r.stockoutRisk === "high" ? "danger" : "warning"}`}>
                        {r.stockoutRisk === "high" ? "Rupture Imminente" : "Vigilance"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. Dormant Inventory Table */}
      {data.dormantItems.length > 0 && (
        <div className="bi-panel">
          <div className="bi-panel-header">
            <div>
              <h3 className="bi-panel-title">Articles dormants (&gt; 90 jours sans vente)</h3>
              <p className="bi-panel-desc">
                Opportunités de déstockage, promotions ou retour fournisseur pour libérer du BFR
              </p>
            </div>
          </div>
          <div className="bi-table-wrap">
            <table className="bi-table">
              <thead>
                <tr>
                  <th>Article</th>
                  <th>Agence</th>
                  <th style={{ textAlign: "right" }}>Quantité</th>
                  <th style={{ textAlign: "right" }}>Coût unit.</th>
                  <th style={{ textAlign: "right" }}>Immobilisation</th>
                  <th style={{ textAlign: "right" }}>Inactivité</th>
                </tr>
              </thead>
              <tbody>
                {data.dormantItems.slice(0, 10).map((d, idx) => (
                  <tr key={`${d.productId}-${idx}`}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{d.productName}</div>
                      <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{d.sku}</div>
                    </td>
                    <td>{d.agency}</td>
                    <td style={{ textAlign: "right" }}>{fmtInt(d.quantity)}</td>
                    <td style={{ textAlign: "right", color: "var(--muted)" }}>{fmtDt(d.unitCost)}</td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: "var(--red, #d04444)" }}>{fmtDt(d.valuation)}</td>
                    <td style={{ textAlign: "right" }}>
                      <span className="bi-badge-pill warning">
                        {d.daysSinceLastSale ? `> ${d.daysSinceLastSale} j` : "Jamais vendu"}
                      </span>
                    </td>
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
export default InventoryView
