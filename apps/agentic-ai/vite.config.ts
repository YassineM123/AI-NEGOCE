import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "node:path"

const root = path.resolve(import.meta.dirname)
export default defineConfig({
  root,
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 8444,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
  build: {
    outDir: path.resolve(root, "../../dist-agentic"),
    emptyOutDir: true,
    sourcemap: false,
  },
})
