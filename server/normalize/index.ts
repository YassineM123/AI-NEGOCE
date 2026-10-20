export interface NormalizationConfig { abbreviations?: Record<string, string>; brands?: string[] }
export interface NormalizedProduct { original: string; normalized: string; attributes: Record<string, string>; ambiguities: string[] }

/** Comparison representation only. Never replace the observation's original text. */
export function foldText(text: string): string {
  return text.replace(/[²]/g, "2").normalize("NFKC").normalize("NFD").replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x6f0))
    .replace(/٫/g, ".").replace(/(\d),(?=\d)/g, "$1.").toLowerCase().replace(/\s+/g, " ").trim()
}

export function normalizeProduct(original: string, config: NormalizationConfig = {}): NormalizedProduct {
  let normalized = foldText(original)
  const dictionary = Object.fromEntries(Object.entries(config.abbreviations ?? {}).map(([k,v]) => [foldText(k), foldText(v)]))
  normalized = normalized.split(" ").map(token => dictionary[token] ?? token).join(" ")
  const attributes: Record<string, string> = {}
  const ambiguities: string[] = []
  const measures = [...normalized.matchAll(/(\d+(?:\.\d+)?)\s*(mm2|مم2|mm|cm|km|ml|kw|kg|m|g|l|a|v|w)(?![a-z0-9])/g)]
  const put = (key: string, value: string) => { if (attributes[key] && attributes[key] !== value) ambiguities.push(`multiple_${key}`); else attributes[key] = value }
  for (const match of measures) {
    const value = Number(match[1]); const unit = match[2]
    if (unit === "mm2" || unit === "مم2") put("section", `${value}:mm2`)
    else if (unit === "mm") {
      if (/(?:diametre|diameter|ø|⌀)\s*$/.test(normalized.slice(0,match.index))) put("diameter", `${value}:mm`)
      else ambiguities.push("dimension_mm_without_role")
    } else if (["m", "cm", "km"].includes(unit)) put("length", `${value * (unit === "cm" ? 0.01 : unit === "km" ? 1000 : 1)}:m`)
    else if (["kg", "g"].includes(unit)) put("weight", `${value / (unit === "g" ? 1000 : 1)}:kg`)
    else if (["l", "ml"].includes(unit)) put("capacity", `${value / (unit === "ml" ? 1000 : 1)}:l`)
    else if (["kw", "w"].includes(unit)) put("power", `${value * (unit === "kw" ? 1000 : 1)}:w`)
    else put(unit === "a" ? "amperage" : "voltage", `${value}:${unit}`)
  }
  for (const [key, choices] of Object.entries({ packaging: ["rouleau", "carton", "paquet", "boite", "lot"], color: ["rouge", "bleu", "vert", "noir", "blanc", "jaune"], material: ["cuivre", "aluminium", "acier", "pvc"] })) {
    for (const word of choices) if (normalized.split(/\s+/).includes(word)) put(key, word)
  }
  for (const brand of config.brands ?? []) if (` ${normalized} `.includes(` ${foldText(brand)} `)) put("brand", foldText(brand))
  const model = normalized.match(/(?:modele|model)\s*[:=]?\s*([a-z0-9][a-z0-9._-]*)/)
  if (model) put("model", model[1])
  return { original, normalized, attributes, ambiguities: [...new Set(ambiguities)] }
}
