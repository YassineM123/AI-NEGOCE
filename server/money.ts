// Exact decimal arithmetic for amounts, quantities, rates and conversion factors.
// A value is an integer number of units (BigInt) at a given scale: 12.345 = 12345 at scale 3.
// No binary floating point is ever used for a computation.

export type RoundingMode =
  /** ties away from zero (commercial rounding: 0.0005 -> 0.001, -0.0005 -> -0.001) */
  | "half_up"
  /** ties to the even neighbour (banker's rounding) */
  | "half_even"
  /** truncation toward zero */
  | "down"
  /** away from zero whenever something is discarded */
  | "up"

const DECIMAL = /^([+-])?(\d+)(?:\.(\d+))?$/
const MAX_SCALE = 18
const pow10 = (n: number) => 10n ** BigInt(n)

export class DecimalError extends Error {}

export class Decimal {
  private constructor(
    readonly units: bigint,
    readonly scale: number,
  ) {}

  static readonly ZERO = new Decimal(0n, 0)

  /**
   * Strict parser. Accepts "123", "-0.5", "1234.567"; numbers only when their shortest
   * representation is such a literal (so 9.5 is "9.5", while 1e-7 or NaN are refused).
   * Locale formats ("1 234,5") are a normalization concern and are refused here.
   */
  static parse(input: string | number | bigint): Decimal {
    if (typeof input === "bigint") return new Decimal(input, 0)
    const text = typeof input === "number" ? (Number.isFinite(input) ? String(input) : "") : input.trim()
    const m = DECIMAL.exec(text)
    if (!m) throw new DecimalError(`Valeur décimale invalide : ${JSON.stringify(input)}`)
    const fraction = m[3] ?? ""
    if (fraction.length > MAX_SCALE) throw new DecimalError(`Trop de décimales : ${text}`)
    const units = BigInt(m[2] + fraction) * (m[1] === "-" ? -1n : 1n)
    return new Decimal(units, fraction.length)
  }

  /** Parse, or undefined for null/undefined/empty or invalid input. */
  static tryParse(input: unknown): Decimal | undefined {
    if (input === null || input === undefined || input === "") return undefined
    if (typeof input !== "string" && typeof input !== "number" && typeof input !== "bigint") return undefined
    try {
      return Decimal.parse(input)
    } catch {
      return undefined
    }
  }

  private aligned(other: Decimal): [bigint, bigint, number] {
    const scale = Math.max(this.scale, other.scale)
    return [this.units * pow10(scale - this.scale), other.units * pow10(scale - other.scale), scale]
  }
  add(other: Decimal) {
    const [a, b, s] = this.aligned(other)
    return new Decimal(a + b, s)
  }
  sub(other: Decimal) {
    const [a, b, s] = this.aligned(other)
    return new Decimal(a - b, s)
  }
  mul(other: Decimal) {
    const scale = this.scale + other.scale
    if (scale > 2 * MAX_SCALE) throw new DecimalError("Échelle de calcul excessive")
    return new Decimal(this.units * other.units, scale)
  }
  /** this × rate / 100, exact (dividing by 100 only shifts the scale). */
  percent(rate: Decimal) {
    const p = this.mul(rate)
    return new Decimal(p.units, p.scale + 2)
  }
  /** Division rounded to `scale` decimals with `mode`. */
  div(other: Decimal, scale: number, mode: RoundingMode) {
    if (other.units === 0n) throw new DecimalError("Division par zéro")
    // (a / 10^sa) / (b / 10^sb) at scale + 1 guard digit is not enough for exact ties, so
    // compute the exact quotient and remainder at the target scale.
    const num = this.units * pow10(scale + other.scale)
    const den = other.units * pow10(this.scale)
    return Decimal.roundQuotient(num, den, scale, mode)
  }
  neg() {
    return new Decimal(-this.units, this.scale)
  }
  abs() {
    return this.units < 0n ? this.neg() : this
  }
  sign() {
    return this.units === 0n ? 0 : this.units < 0n ? -1 : 1
  }
  cmp(other: Decimal) {
    const [a, b] = this.aligned(other)
    return a === b ? 0 : a < b ? -1 : 1
  }
  eq(other: Decimal) {
    return this.cmp(other) === 0
  }
  isZero() {
    return this.units === 0n
  }

  /** Rounds to `scale` decimals (or extends the scale exactly when it is larger). */
  round(scale: number, mode: RoundingMode): Decimal {
    if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) throw new DecimalError(`Échelle invalide : ${scale}`)
    if (scale >= this.scale) return new Decimal(this.units * pow10(scale - this.scale), scale)
    return Decimal.roundQuotient(this.units, pow10(this.scale - scale), scale, mode)
  }

  private static roundQuotient(num: bigint, den: bigint, scale: number, mode: RoundingMode) {
    if (den < 0n) {
      num = -num
      den = -den
    }
    const q = num / den // truncates toward zero
    const r = num % den // same sign as num
    if (r === 0n) return new Decimal(q, scale)
    const sign = num < 0n ? -1n : 1n
    const twice = (r < 0n ? -r : r) * 2n
    let away: boolean
    switch (mode) {
      case "down":
        away = false
        break
      case "up":
        away = true
        break
      case "half_up":
        away = twice >= den
        break
      case "half_even":
        away = twice > den || (twice === den && (q < 0n ? -q : q) % 2n === 1n)
        break
    }
    return new Decimal(away ? q + sign : q, scale)
  }

  /** Fixed notation with exactly `this.scale` decimals ("12.300"). */
  toString() {
    const negative = this.units < 0n
    const digits = (negative ? -this.units : this.units).toString().padStart(this.scale + 1, "0")
    const int = digits.slice(0, digits.length - this.scale)
    const frac = this.scale ? `.${digits.slice(digits.length - this.scale)}` : ""
    return `${negative ? "-" : ""}${int}${frac}`
  }
  /** Fixed notation at `scale` decimals; requires the value to be representable exactly. */
  toFixed(scale: number) {
    const r = this.round(scale, "down")
    if (!r.eq(this)) throw new DecimalError(`${this.toString()} n'est pas exact à ${scale} décimales`)
    return r.toString()
  }
}

export const dec = (input: string | number | bigint) => Decimal.parse(input)
export const sum = (values: Decimal[]) => values.reduce((a, b) => a.add(b), Decimal.ZERO)
