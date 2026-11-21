# AI-NÉGOCE Copilot 2.0 — Enterprise User Guide

## Introduction

Welcome to **AI-NÉGOCE Copilot 2.0**, your enterprise conversational AI assistant directly connected to the Nexora ERP. Copilot allows company executives, financial directors, branch managers, and sales representatives to converse naturally with their corporate database, explore sales and profit margins, track unpaid receivables, and inspect stock alerts.

---

## 1. Getting Started

1. Click on **AI Copilot** in the left navigation sidebar.
2. The empty state offers starter suggestions in **Français**, **العربية التونسية (Derja / Arabizi)**, and **العربية الفصحى**.
3. Type your question in the bottom input bar or click one of the quick suggestions.
4. Your discussion is **automatically saved** in the sidebar history under "Aujourd'hui". You can rename or delete discussions at any time.

---

## 2. Natural Conversation & Politeness

Copilot acts as a polished enterprise assistant. You can chat casually before getting down to business:

| User Query | Language | Copilot Response Style | Sources Attached |
|---|---|---|---|
| `hi` / `bonjour` | French / English | Friendly enterprise introduction, capabilities overview | *None (clean greeting)* |
| `comme cv ?` / `ça va ?` | French | "Ça va très bien, merci ! Comment puis-je vous aider aujourd'hui ?" | *None* |
| `chnowa ahwelek ?` | Tunisian Arabizi | "Labes el hamdullah ! Kifesh n3awnek lyoum bikhsous el société mte3ek ?" | *None* |
| `عسلامة شنوة أحوالك` | Tunisian Arabic | "عسلامة! الحمد لله، كيفاش نقدر نعاونك اليوم بخصوص شركتك أو معطيات الـ ERP؟" | *None* |
| `merci` / `يعطيك الصحة` | French / Arabic | Polite acknowledgment, offers further assistance | *None* |

---

## 3. Business ERP Queries & Analysis

### Ventes & Chiffre d'affaires
- *Français* : `Quel est le chiffre d'affaires global ce mois ?`
- *Tunisien* : `9addech el ca mte3na ?` / `قداش بعنا الشهر هذا ؟`
- *Arabe* : `ما هو رقم المعاملات الإجمالي لهذا الشهر؟`

### Rentabilité & Marge brute
- *Français* : `Quelle est notre marge brute et pourquoi a-t-elle varié ?`
- *Tunisien* : `علاش طاحت المارج ؟` / `chbiha el marge tay7a ?`
- *Arabe* : `ما هي نسبة هامش الربح الإجمالي ولماذا تغيرت؟`

### Créances clients & Impayés
- *Français* : `Quels clients ont plus de 60 jours de retard de paiement ?`
- *Tunisien* : `chkon makhallasch fel kriyat ?` / `شكون ما خلصش مالكليونات ؟`
- *Arabe* : `ما هي الديون غير المستخلصة والتي تجاوزت 60 يوماً؟`

### Stocks & Approvisionnement
- *Français* : `Quels articles sont sous le seuil de réapprovisionnement ?`
- *Tunisien* : `chnowa el sel3a el ra9da fel stock ?` / `شنوة اللي ناقص في المخزون ؟`
- *Arabe* : `ما هي السلع الراكدة في المستودعات والمنتجات دون حد الطلب؟`

---

## 4. Multi-Turn Follow-Ups

Copilot remembers the context of the active conversation:
- **Turn 1**: `Quel est le chiffre d'affaires de Tunis Centre ?`
- **Turn 2**: `Et pour Sfax ?` *(Copilot understands you are asking for Sfax revenue)*
- **Turn 3**: `Compare les deux agences` *(Copilot generates an agency comparison card)*
- **Turn 4**: `Et en janvier ?` *(Copilot shifts the timeframe to January)*

---

## 5. Streaming Mode (SSE)

You can toggle **Streaming SSE** via the checkbox at the top right of the Copilot header. When enabled:
- Responses stream in progressively word-by-word with natural cadence.
- A status indicator shows the reasoning and ERP extraction state.
- You can stop generation at any time with the Stop button.

---

## 6. Access Control & Confidentiality

- **Agency Scope**: Branch managers only see data from their assigned agencies (e.g. Sfax manager cannot query Tunis Centre data).
- **HR & Payroll Guard**: Questions regarding executive salaries, payroll slips, or confidential staff compensation are immediately denied with an enterprise guard notice.
