import { createApp, defaultDependencies } from "./app.js"
const deps = defaultDependencies()
if (!deps.config.DATABASE_URL)
  console.warn(
    "[store] DATABASE_URL absent: in-memory store. Documents, extractions and audit logs are lost on restart (files stay in UPLOAD_DIR). Run `npm run db:dev:up` and `npm run migrate` for persistent storage.",
  )
const app = createApp(deps)
const server = app.listen(deps.config.API_PORT, () =>
  console.log(
    `AI-NEGOCE API listening on http://localhost:${deps.config.API_PORT}`,
  ),
)
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
