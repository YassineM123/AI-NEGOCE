// Fails when the production bundle (dist/) contains development-authentication code, legacy
// token names, or the value of any server-side secret present in the environment.
// Usage: npm run build && npm run check:bundle
import fs from "node:fs"
import path from "node:path"

const dist = path.resolve("dist")
if (!fs.existsSync(dist)) throw new Error("dist/ absent: run `npm run build` first")

const files: string[] = []
const walk = (dir: string) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/\.(js|mjs|css|html|map|json|txt)$/.test(entry.name)) files.push(full)
  }
}
walk(dist)

const forbidden: { label: string; value: string }[] = [
  { label: "development session endpoint", value: "auth/dev-session" },
  { label: "development identity variable", value: "VITE_DEV_IDENTITY" },
  { label: "legacy development token", value: "dev-admin" },
  { label: "legacy development token", value: "dev-manager-sfax" },
  { label: "legacy development token", value: "dev-commercial-tunis" },
  { label: "legacy token variable", value: "VITE_DEV_TOKEN" },
  { label: "database URL scheme", value: "postgresql://" },
  { label: "database URL scheme", value: "postgres://" },
]
for (const key of ["DATABASE_URL", "POSTGRES_PASSWORD", "AUTH_DEV_SIGNING_KEY", "ERP_API_TOKEN", "OCR_API_KEY", "LLM_PROVIDER_API_KEY"]) {
  forbidden.push({ label: `${key} name`, value: key })
  const value = process.env[key]
  // Only check values long enough to be meaningful; never print them.
  if (value && value.length >= 8) forbidden.push({ label: `${key} value`, value })
}

const findings: string[] = []
for (const file of files) {
  const text = fs.readFileSync(file, "utf8")
  for (const f of forbidden)
    if (text.includes(f.value)) findings.push(`${path.relative(dist, file)}: ${f.label}`)
}
if (findings.length) {
  console.error(`Bundle check FAILED (${findings.length}):\n- ${findings.join("\n- ")}`)
  process.exit(1)
}
console.log(`Bundle check passed: ${files.length} file(s), ${forbidden.length} forbidden pattern(s) absent.`)
