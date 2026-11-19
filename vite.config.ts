import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// `npm run dev` serves /api/scan too, so you don't need the Vercel CLI locally.
// In production Vercel runs api/scan.ts instead.
const devApi: Plugin = {
  name: 'dontsueme-dev-api',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/api/scan', async (req, res) => {
      const { scan } = await import('./server/scan.ts')
      const { ScanError } = await import('./server/fetcher.ts')
      let raw = ''
      for await (const chunk of req) raw += chunk
      res.setHeader('content-type', 'application/json')
      try {
        res.end(JSON.stringify(await scan(String(JSON.parse(raw || '{}').url ?? ''))))
      } catch (err) {
        res.statusCode = err instanceof ScanError ? 422 : 500
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'scan failed' }))
      }
    })
  },
}

export default defineConfig({
  plugins: [react(), devApi],
})
