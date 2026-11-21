# AI-NÉGOCE Copilot 2.0 — Architecture Document

## Overview

AI-NÉGOCE Copilot 2.0 is an enterprise conversational AI assistant built for PME and wholesale distribution (négoce) in Tunisia. It connects directly with ERP records (PostgreSQL / SQLite demo), extracts verified accounting figures, maintains persistent multi-turn conversations, supports multilingual input (French, Tunisian Arabic / Arabizi, and Classical Arabic), and streams answers token-by-token with zero figure fabrication.

---

## High-Level Architecture Diagram

```
                        ┌──────────────────────────────────────────────┐
                        │              Client UI (React 19)            │
                        │   - Verbatim user bubbles ("hi", "cv ?")    │
                        │   - Sidebar with history & auto-restore      │
                        │   - EventSource SSE Streaming Client        │
                        └──────────────────────┬───────────────────────┘
                                               │ HTTP / SSE
                                               ▼
                        ┌──────────────────────────────────────────────┐
                        │             Express 5 REST API               │
                        │   - JWT Bearer Authentication & Multi-Tenant │
                        │   - Agency RBAC Enforcement (scopedAgencies) │
                        │   - POST /api/v1/copilot/query               │
                        │   - POST /api/v1/copilot/query/stream (SSE)  │
                        │   - CRUD /api/v1/conversations               │
                        └──────────────┬───────────────────────────────┘
                                       │
                ┌──────────────────────┴──────────────────────┐
                ▼                                             ▼
┌───────────────────────────────┐             ┌───────────────────────────────┐
│     Store (Multi-Tenant)      │             │    Conversational Router      │
│  - PostgresStore (Production) │             │     (copilot-engine.ts)       │
│  - MemoryStore (Test / Dev)   │             └──────────────┬────────────────┘
│  - Auto-create on 1st turn    │                            │
│  - Message persistence        │             ┌──────────────┴──────────────┐
└───────────────────────────────┘             ▼                             ▼
                                ┌───────────────────────────┐ ┌───────────────────────────┐
                                │ Conversational Engine     │ │ Grounded Deterministic    │
                                │ (LLM Provider / Mock)     │ │ ERP Query Tools           │
                                │ - French, Derja, Arabic   │ │ - Sales, Margins, Debts   │
                                │ - Polite natural smalltalk│ │ - Stock & Suppliers       │
                                │ - sources: []             │ │ - Real DB figures         │
                                └───────────────────────────┘ └───────────────────────────┘
```

---

## Core Components

### 1. Multi-Tenant Conversation Persistence
- **Storage Layer**: Implemented in `server/store.ts` via `PostgresStore` (production PostgreSQL migration `007_copilot_persistence.sql`) and `MemoryStore` (fast test/dev execution).
- **Auto-Creation**: When a user submits their first query without an active conversation ID, the backend automatically calls `createConversation(principal.id, autoTitle)` and returns `conversationId`.
- **Sidebar Integration**: The UI updates `activeConversationId` and immediately triggers `loadConversations()`, rendering the discussion in "Aujourd'hui" without requiring manual page refresh.
- **Session Restoration**: The active conversation ID is saved to `localStorage("ai_negoce_active_conv_id")`. On page reload (F5) or server restart, the full conversation turns are fetched and restored.

### 2. Conversational Intent Routing & Language Engine
- **Multilingual Recognition**: Detects whether the user is typing in French, Tunisian Arabic in Arabizi (`chnowa ahwelek`, `9addech el ca`, `chkon makhallasch`), or Arabic script (`عسلامة شنوة أحوالك`, `ما هو رقم المعاملات`).
- **Greeting & Politeness Handling**: Quick-path handler for greetings ("hi", "bonjour", "salut"), small talk ("comme cv ?", "ça va ?", "chnowa ahwelek ?"), acknowledgments ("merci", "يعطيك الصحة"), and capabilities ("qui es-tu ?"). Returns natural, polite responses with `sources: []`.
- **Zero Fabrication**: No ERP connector metadata or fake sources are attached to general conversational queries. ERP sources are only attached when actual ERP database tools are executed.
- **Out-of-Domain Guard**: Non-ERP out-of-domain questions (e.g. "météo à Paris") are declined with `status: "unsupported"`, preserving 100% compliance with QA defects (BUG-006) and data audit tests.

### 3. Authorized ERP Business Tools
- **Tool Catalog**:
  1. `toolGetSalesSummary`: Total CA, transaction counts, branch breakdowns.
  2. `toolGetMarginAnalysis`: Gross margin percentage, product mix breakdown, discount impact.
  3. `toolGetCustomerReceivables`: Unpaid customer receivables, over-due buckets (>30d, >60d, >90d).
  4. `toolGetSupplierPurchases`: Major supplier spend, invoice breakdown, price impact.
  5. `toolGetSlowMovingInventory`: Dormant inventory, items with zero sales >90d, capital tied up.
  6. `toolGetProductStock`: Low stock alerts, reorder thresholds, inventory valuation.
  7. `toolCompareBranches`: Head-to-head multi-branch performance metrics.

### 4. Real-Time Progressive Streaming (SSE)
- **Endpoint**: `POST /api/v1/copilot/query/stream`
- **Events**:
  - `event: init`: Emits `conversationId` and title.
  - `event: status`: Emits thinking states ("Interrogation des écritures et règles ERP...").
  - `event: tool`: Emits tool name and execution status.
  - `event: delta`: Streams response chunks word-by-word.
  - `event: done`: Emits final payload with structured tables, sources, and follow-ups.
