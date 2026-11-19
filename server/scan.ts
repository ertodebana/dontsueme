import { runChecks } from './checks.ts'
import { ScanError, parseTarget } from './fetcher.ts'
import { takeSnapshot } from './snapshot.ts'
import type { ScanResult, Status } from './types.ts'

export async function scan(input: string): Promise<ScanResult> {
  const trimmed = input.trim()
  if (!trimmed || trimmed.length > 2048) throw new ScanError('invalid-url', 'Paste a URL under 2048 characters.')
  const raw = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const snap = await takeSnapshot(parseTarget(raw))
  const checks = runChecks(snap)
  const counts: Record<Status, number> = { pass: 0, warn: 0, fail: 0, manual: 0 }
  for (const c of checks) counts[c.status] += 1
  return {
    target: snap.origin,
    scannedAt: new Date().toISOString(),
    scanned: snap.docs.map((d) => d.path),
    notes: snap.notes,
    counts,
    checks,
  }
}
