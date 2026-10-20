import { createApp, defaultDependencies, type Dependencies } from "./app.js"
let deps: Dependencies
try {
  deps = defaultDependencies()
} catch (error) {
  // Invalid or incomplete configuration: refuse to start (fail closed).
  console.error(`[config] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
if (!deps.config.DATABASE_URL)
  console.warn(
    "[store] DATABASE_URL absent: in-memory store. Documents, extractions and audit logs are lost on restart (files stay in UPLOAD_DIR). Run `npm run db:dev:up` and `npm run migrate` for persistent storage.",
  )
if (deps.config.AUTH_MODE === "local-dev")
  console.warn(
    `[auth] AUTH_MODE=local-dev: development identities active, reachable only from this machine (${deps.config.HOST}). Never use this mode on a shared or exposed server.`,
  )
const app = createApp(deps)
const server = app.listen(deps.config.API_PORT, deps.config.HOST, (error?: Error) => {
  // Express 5 reports bind failures here as well as through the 'error' event.
  if (error) return
  const address = server.address()
  const bound = typeof address === "object" && address ? `${address.address}:${address.port}` : String(address)
  console.log(`AI-NEGOCE API listening on ${bound} (auth: ${deps.config.AUTH_MODE})`)
})
// A port already in use (or a forbidden address) must stop the process, not leave it half-started.
server.on("error", (error) => {
  console.error(`[server] cannot listen on ${deps.config.HOST}:${deps.config.API_PORT}: ${error.message}`)
  process.exit(1)
})
async function shutdown() {
  server.close(async () => {
    await deps.store.close()
    deps.erpDb?.close()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
