import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import path from "node:path"
import fs from "node:fs"
import { createReadStream } from "node:fs"
import { cpSync, mkdirSync } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import net from "node:net"
import { spawn, type ChildProcess } from "node:child_process"

const root = path.resolve(import.meta.dirname)
const repoRoot = path.resolve(root, "../..")
const target = path.resolve(repoRoot, "dist-agentic")
const localEnvFile = path.resolve(repoRoot, ".env")
if (fs.existsSync(localEnvFile)) process.loadEnvFile(localEnvFile)

const staticRoutes = [
  { prefix: "/platform/bi/", directory: path.resolve(repoRoot, "dashboards/data-analysis") },
  { prefix: "/platform/ds/", directory: path.resolve(repoRoot, "dashboards/data-science") },
  // Only the 100%-fictional "Maquettes" scenarios; real/pseudonymized extractions stay blocked.
  { prefix: "/platform/bi-demo/", directory: path.resolve(repoRoot, "Database/extractions/demonstration") },
] as const
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
}
function servePlatforms(): Plugin {
  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next()
    let pathname: string
    try { pathname = decodeURIComponent(new URL(req.url || "/", "http://127.0.0.1").pathname) }
    catch { res.statusCode = 400; res.end(); return }
    const mapping = staticRoutes.find((entry) => pathname.startsWith(entry.prefix))
    if (!mapping) return next()
    const relative = pathname.slice(mapping.prefix.length) || "index.html"
    if (relative.includes("\\") || relative.split("/").includes("..") || relative.startsWith("/")) {
      res.statusCode = 403
      res.end()
      return
    }
    const resolved = path.resolve(mapping.directory, relative)
    if (!resolved.startsWith(mapping.directory + path.sep)) {
      res.statusCode = 403
      res.end()
      return
    }
    fs.stat(resolved, (err, stat) => {
      if (err || !stat.isFile()) { res.statusCode = 404; res.end("Not found"); return }
      res.setHeader("Content-Type", contentTypes[path.extname(resolved)] || "application/octet-stream")
      res.setHeader("Cache-Control", "no-store")
      res.setHeader("X-Content-Type-Options", "nosniff")
      if (req.method === "HEAD") { res.end(); return }
      const stream = createReadStream(resolved)
      stream.on("error", () => { if (!res.headersSent) res.statusCode = 500; res.end() })
      stream.pipe(res)
    })
  }
  return {
    name: "ai-negoce-shared-platform-host",
    configureServer(server) { server.middlewares.use(handler) },
    configurePreviewServer(server) { server.middlewares.use(handler) },
    closeBundle() {
      for (const item of [
        { src: staticRoutes[0].directory, dest: "platform/bi" },
        { src: staticRoutes[1].directory, dest: "platform/ds" },
        { src: staticRoutes[2].directory, dest: "platform/bi-demo" },
      ]) {
        const dest = path.resolve(target, item.dest)
        mkdirSync(path.dirname(dest), { recursive: true })
        cpSync(item.src, dest, { recursive: true, force: true })
      }
    },
  }
}
function denyLegacyDataRoutes(): Plugin {
  const blocked = ["/data/extractions/", "/Database/extractions/"]
  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const pathname = new URL(req.url || "/", "http://127.0.0.1").pathname
    if (!blocked.some((prefix) => pathname.startsWith(prefix))) return next()
    res.statusCode = 404
    res.setHeader("Cache-Control", "no-store")
    res.end("Not found")
  }
  return {
    name: "deny-legacy-dashboard-data",
    configureServer(server) { server.middlewares.use(handler) },
    configurePreviewServer(server) { server.middlewares.use(handler) },
  }
}
function autoStartApi(): Plugin {
  let child: ChildProcess | null = null
  const port = Number.parseInt(process.env.API_PORT || "3001", 10)
  const portInUse = () => new Promise<boolean>((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" })
    socket.once("connect", () => { socket.destroy(); resolve(true) })
    socket.once("error", () => resolve(false))
  })
  const stop = () => {
    if (child && !child.killed) child.kill()
    child = null
  }
  return {
    name: "agentic-auto-start-api",
    apply: "serve",
    async configureServer(server) {
      if (process.env.AUTO_START_API === "false" || await portInUse()) return
      const cli = path.resolve(repoRoot, "node_modules/tsx/dist/cli.mjs")
      child = spawn(process.execPath, [cli, "watch", "--env-file-if-exists=.env", "server/index.ts"], {
        cwd: repoRoot,
        stdio: "inherit",
        env: { ...process.env, AUTH_MODE: process.env.AUTH_MODE || "local-dev" },
      })
      child.on("exit", (code) => {
        if (code) server.config.logger.error(`[api] exited with code ${code}`)
        child = null
      })
      server.httpServer?.once("close", stop)
    },
  }
}
export default defineConfig({
  root,
  plugins: [react(), denyLegacyDataRoutes(), servePlatforms(), autoStartApi()],
  server: {
    host: "127.0.0.1",
    port: 8444,
    strictPort: true,
    // Same port the auto-started API uses, so API_PORT=3002 moves both together.
    proxy: { "/api": `http://127.0.0.1:${Number.parseInt(process.env.API_PORT || "3001", 10)}` },
  },
  build: {
    outDir: target,
    emptyOutDir: true,
    sourcemap: false,
  },
})
