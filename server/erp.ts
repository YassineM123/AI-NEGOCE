export type ErpInvoiceInput = {
  supplierId: string
  invoiceNumber: string
  invoiceDate: string
  currency: "TND"
  lines: {
    productId: string
    quantity: number
    unitPrice: number
    vatCode: string
  }[]
  idempotencyKey: string
}
export type ErpInvoiceResult = { id: string; status: "draft" }
export interface ErpAdapter {
  readonly name: string
  readonly production: boolean
  health(): Promise<boolean>
  createSupplierInvoice(input: ErpInvoiceInput): Promise<ErpInvoiceResult>
}
export class UnconfiguredErpAdapter implements ErpAdapter {
  readonly name = "unconfigured"
  readonly production = false
  async health() {
    return false
  }
  async createSupplierInvoice(): Promise<ErpInvoiceResult> {
    throw new Error("ERP adapter is not configured")
  }
}
export class TestErpAdapter implements ErpAdapter {
  readonly name = "test"
  readonly production = false
  private keys = new Map<string, ErpInvoiceResult>()
  async health() {
    return true
  }
  async createSupplierInvoice(input: ErpInvoiceInput) {
    const prior = this.keys.get(input.idempotencyKey)
    if (prior) return prior
    const result = {
      id: `TEST-${crypto.randomUUID()}`,
      status: "draft" as const,
    }
    this.keys.set(input.idempotencyKey, result)
    return result
  }
}
