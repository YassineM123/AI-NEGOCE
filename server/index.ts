import { createApp, defaultDependencies } from "./app.js"
const deps = defaultDependencies()
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
