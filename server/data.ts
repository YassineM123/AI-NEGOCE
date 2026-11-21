/** One BI fact row per document line. Credit-note lines carry negative revenue/cost. */
export type Sale = {
  id: string
  invoiceId: string
  date: string
  agency: string
  customer: string
  /** stable ERP ids; names are display labels and are not unique */
  customerId?: string
  productId?: string
  product: string
  family: string
  representative: string
  revenue: number
  /** null = cost unknown: excluded from margin, never read as 0 */
  cost: number | null
  kind?: "invoice" | "credit_note"
  status?: "posted" | "cancelled"
}

/** Open balance (TTC) per posted invoice, as of the dataset date. */
export type Receivable = {
  invoiceId: string
  agency: string
  customer: string
  date: string
  dueDate: string
  outstanding: number
}

export type InventoryItem = {
  reference: string
  product: string
  agency: string
  quantity: number
  reorderPoint: number
  unitCost: number
}

export const sales: Sale[] = [
  {
    id: "FV-2502-0482",
    invoiceId: "FV-2502-0482",
    date: "2025-02-28",
    agency: "Tunis Centre",
    customer: "SOTUVER SA",
    product: "Bureau Atlas",
    family: "Bureaux",
    representative: "Amel Trabelsi",
    revenue: 7495.798,
    cost: 5380,
  },
  {
    id: "FV-2502-0471",
    invoiceId: "FV-2502-0471",
    date: "2025-02-25",
    agency: "Sfax",
    customer: "AMS INDUSTRIE",
    product: "Siège Ergo Pro",
    family: "Sièges Bureau",
    representative: "Yassine Khelifi",
    revenue: 10285.714,
    cost: 8230,
  },
  {
    id: "FV-2502-0448",
    invoiceId: "FV-2502-0448",
    date: "2025-02-19",
    agency: "Sousse",
    customer: "MEDIKA PLUS",
    product: "Armoire Nova",
    family: "Rangement",
    representative: "Ines Mansour",
    revenue: 6840,
    cost: 4550,
  },
  {
    id: "FV-2501-0391",
    invoiceId: "FV-2501-0391",
    date: "2025-01-30",
    agency: "Tunis Centre",
    customer: "SOTUVER SA",
    product: "Siège Ergo Pro",
    family: "Sièges Bureau",
    representative: "Amel Trabelsi",
    revenue: 12400,
    cost: 8650,
  },
  {
    id: "FV-2501-0377",
    invoiceId: "FV-2501-0377",
    date: "2025-01-21",
    agency: "Sfax",
    customer: "STE EL AMEN",
    product: "Bureau Atlas",
    family: "Bureaux",
    representative: "Yassine Khelifi",
    revenue: 9100,
    cost: 7020,
  },
  {
    id: "FV-2412-0312",
    invoiceId: "FV-2412-0312",
    date: "2024-12-18",
    agency: "Sousse",
    customer: "MEDIKA PLUS",
    product: "Table Réunion 12P",
    family: "Tables",
    representative: "Ines Mansour",
    revenue: 15800,
    cost: 10600,
  },
]

export const inventory: InventoryItem[] = [
  {
    reference: "SIE-ERGO-PRO",
    product: "Siège Ergo Pro",
    agency: "Sfax",
    quantity: 4,
    reorderPoint: 10,
    unitCost: 685,
  },
  {
    reference: "BUR-ATLAS",
    product: "Bureau Atlas",
    agency: "Tunis Centre",
    quantity: 18,
    reorderPoint: 8,
    unitCost: 940,
  },
  {
    reference: "ARM-NOVA",
    product: "Armoire Nova",
    agency: "Sousse",
    quantity: 7,
    reorderPoint: 6,
    unitCost: 650,
  },
]

// The fixture has no VAT detail: the open balance equals the HT amount of the unpaid invoices.
export const receivables: Receivable[] = [
  { invoiceId: "FV-2502-0471", agency: "Sfax", customer: "AMS INDUSTRIE", date: "2025-02-25", dueDate: "2025-03-27", outstanding: 10285.714 },
  { invoiceId: "FV-2501-0391", agency: "Tunis Centre", customer: "SOTUVER SA", date: "2025-01-30", dueDate: "2025-03-01", outstanding: 12400 },
  { invoiceId: "FV-2501-0377", agency: "Sfax", customer: "STE EL AMEN", date: "2025-01-21", dueDate: "2025-02-20", outstanding: 9100 },
]

export const datasetMetadata = {
  adapter: "test" as const,
  source: "Jeu de données local explicitement fictif",
  currency: "TND",
  lastUpdated: "2026-10-15T00:00:00.000Z",
  asOf: "2026-10-15",
}
