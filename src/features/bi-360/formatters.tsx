import React from "react"

export const fmtDt = (n: number) =>
  new Intl.NumberFormat("fr-TN", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(n) + " DT"

export const fmtInt = (n: number) => new Intl.NumberFormat("fr-TN").format(Math.round(n))

export const fmtPct = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)} %`)

export const fmtPts = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)} pts`)

export function formatDtParts(n: number) {
  const isNeg = n < 0
  const abs = Math.abs(n)
  const integerPart = Math.floor(abs)
  const decPart = Math.round((abs - integerPart) * 1000)
    .toString()
    .padStart(3, "0")
  return {
    isNeg,
    formattedInt: new Intl.NumberFormat("fr-TN").format(integerPart),
    decPart,
    full: `${isNeg ? "-" : ""}${new Intl.NumberFormat("fr-TN", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }).format(abs)} DT`,
  }
}

interface MoneyDisplayProps {
  value: number
  size?: "lg" | "md" | "sm"
  color?: string
}

export const MoneyDisplay: React.FC<MoneyDisplayProps> = ({ value, size = "md", color }) => {
  const parts = formatDtParts(value)
  return (
    <span className={`bi-money bi-money--${size}`} style={color ? { color } : undefined}>
      {parts.isNeg && <span className="bi-money-sign">−</span>}
      <span className="bi-money-int">{parts.formattedInt}</span>
      <span className="bi-money-dec">,{parts.decPart}</span>
      <span className="bi-money-unit"> DT</span>
    </span>
  )
}
