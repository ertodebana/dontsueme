import type { VercelRequest, VercelResponse } from '@vercel/node'
import { ScanError } from '../server/fetcher.ts'
import { scan } from '../server/scan.ts'

// We don't store scanned URLs or results.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('cache-control', 'no-store')
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST')
    return res.status(405).json({ error: 'Use POST with {"url": "..."}.' })
  }
  const url = (req.body as { url?: unknown } | undefined)?.url
  if (typeof url !== 'string') return res.status(400).json({ error: 'Send JSON like {"url": "https://example.com"}.' })

  try {
    return res.status(200).json(await scan(url))
  } catch (err) {
    if (err instanceof ScanError) {
      const status = ['invalid-url', 'scheme', 'credentials', 'port', 'blocked-address'].includes(err.code) ? 400 : 422
      return res.status(status).json({ error: err.message, code: err.code })
    }
    console.error('scan failed', err)
    return res.status(500).json({ error: 'Something broke on our side. Try again.' })
  }
}
