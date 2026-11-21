import { describe, expect, it } from "vitest"
import { normalizeProduct } from "./index"

describe("evidence-preserving normalization", () => {
  it("keeps original and expands configured abbreviations", () => {
    const r = normalizeProduct("CBL ÉLEC 2.5", { abbreviations: { cbl: "cable", elec: "electrique" } })
    expect(r.original).toBe("CBL ÉLEC 2.5")
    expect(r.normalized).toBe("cable electrique 2.5")
    expect(r.attributes.section).toBeUndefined()
  })
  it("recognizes explicit section without inventing section from MM", () => {
    expect(normalizeProduct("CABLE ELECTRIQUE 2,5 MM²").attributes.section).toBe("2.5:mm2")
    const r = normalizeProduct("CABLE 2.5MM ROULEAU 100M")
    expect(r.attributes.section).toBeUndefined()
    expect(r.attributes.length).toBe("100:m")
    expect(r.ambiguities).toContain("dimension_mm_without_role")
    expect(r.attributes.packaging).toBe("rouleau")
  })
  it("folds Arabic forms, marks and digits while retaining evidence", () => {
    const r = normalizeProduct("كَـابِل كهربائي ٢٫٥ مم²")
    expect(r.normalized).toContain("كابل")
    expect(r.attributes.section).toBe("2.5:mm2")
    expect(normalizeProduct("ＡＢＣ   ÉLECTRIQUE").normalized).toBe("abc electrique")
  })
  it("extracts only configured brands and explicit measurements", () => {
    const r = normalizeProduct("ACME câble rouge cuivre 230V 2kW 500g", { brands: ["ACME"] })
    expect(r.attributes).toMatchObject({ brand: "acme", voltage: "230:v", power: "2000:w", weight: "0.5:kg", color: "rouge", material: "cuivre" })
    expect(r.attributes.model).toBeUndefined()
  })
})
