import React, { useState, useEffect, useCallback } from "react"
import { api } from "../../api"
import type {
  BiUniversalFilters,
  BiUniversalPeriod,
  ExecutiveCockpitResponse,
  SalesIntelligenceResponse,
  ProfitabilityResponse,
  PurchasesResponse,
  InventoryResponse,
  FinanceResponse,
  DiagnosticsResponse,
  BusinessAlert,
  ForecastingResponse,
} from "./types"

import { ExecutiveCockpitView } from "./ExecutiveCockpitView"
import { SalesIntelligenceView } from "./SalesIntelligenceView"
import { ProfitabilityView } from "./ProfitabilityView"
import { PurchasesView } from "./PurchasesView"
import { InventoryView } from "./InventoryView"
import { FinanceView } from "./FinanceView"
import { DiagnosticsView } from "./DiagnosticsView"
import { AlertCenterView } from "./AlertCenterView"
import { ForecastingView } from "./ForecastingView"

import "./bi-360.css"

interface Bi360ModuleProps {
  onNavigateCopilot?: (prompt: string) => void
  userAgencies?: string[]
}

type BiTab =
  | "cockpit"
  | "sales"
  | "profitability"
  | "purchases"
  | "inventory"
  | "finance"
  | "diagnostics"
  | "alerts"
  | "forecasting"

export const Bi360Module: React.FC<Bi360ModuleProps> = ({ onNavigateCopilot, userAgencies = [] }) => {
  const [activeTab, setActiveTab] = useState<BiTab>("cockpit")

  // Universal Filter State
  const [period, setPeriod] = useState<BiUniversalPeriod>("year")
  const [from, setFrom] = useState<string>("2026-01-01")
  const [to, setTo] = useState<string>("2026-10-15")
  const [agency, setAgency] = useState<string>("all")
  const [availableAgencies, setAvailableAgencies] = useState<string[]>([])

  // Data cache
  const [cockpitData, setCockpitData] = useState<ExecutiveCockpitResponse | null>(null)
  const [salesData, setSalesData] = useState<SalesIntelligenceResponse | null>(null)
  const [profitabilityData, setProfitabilityData] = useState<ProfitabilityResponse | null>(null)
  const [purchasesData, setPurchasesData] = useState<PurchasesResponse | null>(null)
  const [inventoryData, setInventoryData] = useState<InventoryResponse | null>(null)
  const [financeData, setFinanceData] = useState<FinanceResponse | null>(null)
  const [diagnosticsData, setDiagnosticsData] = useState<DiagnosticsResponse | null>(null)
  const [alertsList, setAlertsList] = useState<BusinessAlert[]>([])
  const [forecastingData, setForecastingData] = useState<ForecastingResponse | null>(null)

  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  // Drilldown modal state
  const [drillDownTarget, setDrillDownTarget] = useState<{
    type: "agency" | "customer" | "product" | "category" | "supplier"
    id?: string
    name: string
  } | null>(null)

  // Fetch Lookups / Agencies
  useEffect(() => {
    api
      .lookups()
      .then((l) => {
        if (l.agencies && l.agencies.length > 0) {
          setAvailableAgencies(l.agencies.map((a) => (typeof a === "string" ? a : a.name)))
        } else if (userAgencies.length > 0) {
          setAvailableAgencies(userAgencies)
        }
      })
      .catch(() => {
        if (userAgencies.length > 0) {
          setAvailableAgencies(userAgencies)
        }
      })
  }, [userAgencies])

  const currentFilters: BiUniversalFilters = {
    period,
    from: period === "custom" ? from : undefined,
    to: period === "custom" ? to : undefined,
    agency,
  }

  // Load Active Tab Data
  const loadActiveTabData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      if (activeTab === "cockpit") {
        const res = await api.biCockpit(currentFilters)
        setCockpitData(res)
      } else if (activeTab === "sales") {
        const res = await api.biSales(currentFilters)
        setSalesData(res)
      } else if (activeTab === "profitability") {
        const res = await api.biProfitability(currentFilters)
        setProfitabilityData(res)
      } else if (activeTab === "purchases") {
        const res = await api.biPurchases(currentFilters)
        setPurchasesData(res)
      } else if (activeTab === "inventory") {
        const res = await api.biInventory(currentFilters)
        setInventoryData(res)
      } else if (activeTab === "finance") {
        const res = await api.biFinance(currentFilters)
        setFinanceData(res)
      } else if (activeTab === "diagnostics") {
        const res = await api.biDiagnostics(currentFilters)
        setDiagnosticsData(res)
      } else if (activeTab === "alerts") {
        const res = await api.biAlerts(true)
        setAlertsList(res.alerts)
      } else if (activeTab === "forecasting") {
        const res = await api.biForecasting(currentFilters)
        setForecastingData(res)
      }
    } catch (err: unknown) {
      console.error("Erreur chargement BI 360 :", err)
      setError(err instanceof Error ? err.message : "Erreur de chargement des données BI")
    } finally {
      setLoading(false)
    }
  }, [activeTab, period, from, to, agency])

  useEffect(() => {
    loadActiveTabData()
  }, [loadActiveTabData])

  // Periodic check or initial load for alerts count badge
  useEffect(() => {
    api
      .biAlerts(false)
      .then((res) => setAlertsList(res.alerts))
      .catch(() => {})
  }, [])

  const handleAcknowledgeAlert = async (id: string) => {
    await api.biAcknowledgeAlert(id)
    setAlertsList((prev) =>
      prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a))
    )
  }

  const handleCopilotAnalyze = (subject: string, context: Record<string, unknown>) => {
    if (onNavigateCopilot) {
      const prompt = `Peux-tu analyser en détail ce sujet BI 360 : "${subject}" avec les données suivantes : ${JSON.stringify(
        context
      )} et me donner les recommandations d'action concrètes ?`
      onNavigateCopilot(prompt)
    }
  }

  const handleResetFilters = () => {
    setPeriod("year")
    setFrom("2026-01-01")
    setTo("2026-10-15")
    setAgency("all")
  }

  const unackAlertCount = alertsList.filter((a) => !a.acknowledged).length

  return (
    <div className="bi-container" style={{ padding: "1.25rem 1.75rem" }}>
      {/* 1. Header with Freshness & Export */}
      <div className="bi-header">
        <div className="bi-header-title">
          <h1>
            <span>BI 360 Enterprise</span>
            <span className="bi-badge-pill success">
              <span className="bi-pulse-dot" /> Temps Réel ERP
            </span>
          </h1>
          <p className="bi-header-subtitle">
            Pilotage financier, commercial et logistique certifié — Données consolidées au 15/10/2026
          </p>
        </div>

        <div className="bi-header-actions">
          <a
            href={api.biExportUrl(activeTab, "csv", currentFilters)}
            download={`bi360_${activeTab}_${period}.csv`}
            className="bi-btn bi-btn-secondary"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export CSV
          </a>

          <a
            href={api.biExportUrl(activeTab, "json", currentFilters)}
            download={`bi360_${activeTab}_${period}.json`}
            className="bi-btn bi-btn-secondary"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            JSON
          </a>

          {onNavigateCopilot && (
            <button
              className="bi-btn bi-btn-copilot"
              onClick={() =>
                handleCopilotAnalyze("Revue globale de performance BI 360", {
                  activeTab,
                  filters: currentFilters,
                })
              }
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m12 3 1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3Z" />
              </svg>
              Assistant Copilot
            </button>
          )}
        </div>
      </div>

      {/* 2. Universal Filter Toolbar */}
      <div className="bi-filter-toolbar">
        <div className="bi-filter-group">
          <label className="bi-filter-label">Période :</label>
          <select
            className="bi-select"
            value={period}
            onChange={(e) => setPeriod(e.target.value as BiUniversalPeriod)}
          >
            <option value="month">Mois en cours (Octobre 2026)</option>
            <option value="quarter">Trimestre en cours (Q4 2026)</option>
            <option value="year">Année en cours (YTD 2026)</option>
            <option value="custom">Plage personnalisée</option>
            <option value="all">Tout l'historique disponible</option>
          </select>
        </div>

        {period === "custom" && (
          <div className="bi-filter-dates">
            <input
              type="date"
              className="bi-input"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>à</span>
            <input
              type="date"
              className="bi-input"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        )}

        <div className="bi-filter-group">
          <label className="bi-filter-label">Agence :</label>
          <select
            className="bi-select"
            value={agency}
            onChange={(e) => setAgency(e.target.value)}
          >
            <option value="all">Toutes les agences</option>
            {availableAgencies.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        <button
          className="bi-btn-reset"
          onClick={handleResetFilters}
          title="Réinitialiser les filtres"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          Réinitialiser
        </button>
      </div>

      {/* 3. Navigation Tabs (9 Modules with refined SVG Icons) */}
      <div className="bi-nav-tabs">
        <button
          className={`bi-tab-btn ${activeTab === "cockpit" ? "active" : ""}`}
          onClick={() => setActiveTab("cockpit")}
        >
          <svg className="bi-tab-icon" viewBox="0 0 24 24">
            <rect x="3" y="3" width="7" height="9" rx="1" />
            <rect x="14" y="3" width="7" height="5" rx="1" />
            <rect x="14" y="12" width="7" height="9" rx="1" />
            <rect x="3" y="16" width="7" height="5" rx="1" />
          </svg>
          Cockpit Direction
        </button>

        <button
          className={`bi-tab-btn ${activeTab === "sales" ? "active" : ""}`}
          onClick={() => setActiveTab("sales")}
        >
          <svg className="bi-tab-icon" viewBox="0 0 24 24">
            <path d="M3 3v18h18" />
            <path d="m19 9-5 5-4-4-3 3" />
          </svg>
          Ventes & Clients
        </button>

        <button
          className={`bi-tab-btn ${activeTab === "profitability" ? "active" : ""}`}
          onClick={() => setActiveTab("profitability")}
        >
          <svg className="bi-tab-icon" viewBox="0 0 24 24">
            <line x1="12" y1="1" x2="12" y2="23" />
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
          Rentabilité & Marges
        </button>

        <button
          className={`bi-tab-btn ${activeTab === "purchases" ? "active" : ""}`}
          onClick={() => setActiveTab("purchases")}
        >
          <svg className="bi-tab-icon" viewBox="0 0 24 24">
            <circle cx="8" cy="21" r="1" />
            <circle cx="19" cy="21" r="1" />
            <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
          </svg>
          Achats & Fournisseurs
        </button>

        <button
          className={`bi-tab-btn ${activeTab === "inventory" ? "active" : ""}`}
          onClick={() => setActiveTab("inventory")}
        >
          <svg className="bi-tab-icon" viewBox="0 0 24 24">
            <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
            <path d="m3.3 7 8.7 5 8.7-5" />
            <path d="M12 22V12" />
          </svg>
          Stocks & Appro
        </button>

        <button
          className={`bi-tab-btn ${activeTab === "finance" ? "active" : ""}`}
          onClick={() => setActiveTab("finance")}
        >
          <svg className="bi-tab-icon" viewBox="0 0 24 24">
            <rect width="20" height="14" x="2" y="5" rx="2" />
            <line x1="2" x2="22" y1="10" y2="10" />
          </svg>
          Finances & Créances
        </button>

        <button
          className={`bi-tab-btn ${activeTab === "diagnostics" ? "active" : ""}`}
          onClick={() => setActiveTab("diagnostics")}
        >
          <svg className="bi-tab-icon" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
            <path d="M11 8v6M8 11h6" />
          </svg>
          Diagnostics Causes
        </button>

        <button
          className={`bi-tab-btn ${activeTab === "alerts" ? "active" : ""}`}
          onClick={() => setActiveTab("alerts")}
        >
          <svg className="bi-tab-icon" viewBox="0 0 24 24">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
          Centre d'Alertes
          {unackAlertCount > 0 && (
            <span className="bi-tab-badge">{unackAlertCount}</span>
          )}
        </button>

        <button
          className={`bi-tab-btn ${activeTab === "forecasting" ? "active" : ""}`}
          onClick={() => setActiveTab("forecasting")}
        >
          <svg className="bi-tab-icon" viewBox="0 0 24 24">
            <path d="m12 3 1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3Z" />
          </svg>
          Prévisions & Simulations
        </button>
      </div>

      {/* Error Banner */}
      {error && (
        <div
          style={{
            background: "rgba(208, 68, 68, 0.08)",
            border: "1px solid var(--red, #d04444)",
            borderRadius: "6px",
            padding: "0.75rem 1rem",
            color: "var(--red, #d04444)",
            fontSize: "0.85rem",
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* 4. Active Tab Content View */}
      {activeTab === "cockpit" && (
        <ExecutiveCockpitView
          data={cockpitData}
          loading={loading}
          onDrillDownAgency={(ag) => {
            setAgency(ag)
            setActiveTab("sales")
          }}
          onNavigateTab={(t) => setActiveTab(t as BiTab)}
          onCopilotAnalyze={handleCopilotAnalyze}
        />
      )}

      {activeTab === "sales" && (
        <SalesIntelligenceView
          data={salesData}
          loading={loading}
          onDrillDownCustomer={(id, name) => setDrillDownTarget({ type: "customer", id, name })}
          onDrillDownProduct={(id, name) => setDrillDownTarget({ type: "product", id, name })}
          onCopilotAnalyze={handleCopilotAnalyze}
        />
      )}

      {activeTab === "profitability" && (
        <ProfitabilityView
          data={profitabilityData}
          loading={loading}
          onDrillDownCategory={(id, name) => setDrillDownTarget({ type: "category", id, name })}
          onCopilotAnalyze={handleCopilotAnalyze}
        />
      )}

      {activeTab === "purchases" && (
        <PurchasesView
          data={purchasesData}
          loading={loading}
          onDrillDownSupplier={(id, name) => setDrillDownTarget({ type: "supplier", id, name })}
          onCopilotAnalyze={handleCopilotAnalyze}
        />
      )}

      {activeTab === "inventory" && (
        <InventoryView
          data={inventoryData}
          loading={loading}
          onDrillDownProduct={(id, name) => setDrillDownTarget({ type: "product", id, name })}
          onCopilotAnalyze={handleCopilotAnalyze}
        />
      )}

      {activeTab === "finance" && (
        <FinanceView
          data={financeData}
          loading={loading}
          onDrillDownCustomer={(id, name) => setDrillDownTarget({ type: "customer", id, name })}
          onCopilotAnalyze={handleCopilotAnalyze}
        />
      )}

      {activeTab === "diagnostics" && (
        <DiagnosticsView
          data={diagnosticsData}
          loading={loading}
          onCopilotAnalyze={handleCopilotAnalyze}
        />
      )}

      {activeTab === "alerts" && (
        <AlertCenterView
          alerts={alertsList}
          loading={loading}
          onAcknowledgeAlert={handleAcknowledgeAlert}
          onNavigateTab={(t) => setActiveTab(t as BiTab)}
          onCopilotAnalyze={handleCopilotAnalyze}
        />
      )}

      {activeTab === "forecasting" && (
        <ForecastingView
          data={forecastingData}
          loading={loading}
          onCopilotAnalyze={handleCopilotAnalyze}
        />
      )}

      {/* 5. Drill Down Context Modal */}
      {drillDownTarget && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(16, 26, 46, 0.45)",
            backdropFilter: "blur(2px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setDrillDownTarget(null)}
        >
          <div
            style={{
              background: "var(--surface)",
              borderRadius: "10px",
              padding: "1.5rem",
              width: "480px",
              maxWidth: "90vw",
              boxShadow: "0 20px 25px -5px rgba(21, 34, 54, 0.2)",
              border: "1px solid var(--line)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>
                Focus : {drillDownTarget.name}
              </h3>
              <button
                style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer", color: "var(--muted)" }}
                onClick={() => setDrillDownTarget(null)}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "1.2rem" }}>
              Type d'entité : <strong>{drillDownTarget.type.toUpperCase()}</strong>
              {drillDownTarget.id ? ` (ID: ${drillDownTarget.id})` : ""}
            </p>

            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              <button
                className="bi-btn bi-btn-secondary"
                onClick={() => setDrillDownTarget(null)}
              >
                Fermer
              </button>

              {onNavigateCopilot && (
                <button
                  className="bi-btn bi-btn-copilot"
                  onClick={() => {
                    handleCopilotAnalyze(`Analyse approfondie de l'entité ${drillDownTarget.name}`, {
                      drillDown: drillDownTarget,
                      currentFilters,
                    })
                    setDrillDownTarget(null)
                  }}
                >
                  ✨ Analyser avec Copilot
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
export default Bi360Module
