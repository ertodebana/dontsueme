// Our own site must pass its own rules. Runs against the production build.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runChecks } from '../server/checks.ts'
import type { Doc } from '../server/types.ts'

const dist = join(import.meta.dirname, '..', 'dist')

describe.skipIf(!existsSync(dist))('dogfood: dist/ passes its own scan', () => {
  it('has no red flags, warnings, or stray signals', () => {
    const assets = readdirSync(join(dist, 'assets')).filter((f) => /\.(css|js)$/.test(f))
    const docs: Doc[] = [
      { path: '/', kind: 'html', text: readFileSync(join(dist, 'index.html'), 'utf8'), truncated: false },
      ...assets.map((f) => ({
        path: `/assets/${f}`,
        kind: (f.endsWith('.css') ? 'css' : 'js') as Doc['kind'],
        text: readFileSync(join(dist, 'assets', f), 'utf8'),
        truncated: false,
      })),
    ]
    // Stricter than "no red flags": our own copy must not even look like a signal,
    // or a pass could be right for the wrong reason.
    const flagged = runChecks({ origin: 'https://dontsueme.vercel.app', docs, notes: [] })
      .filter((c) => c.status !== 'manual' && (c.status !== 'pass' || c.evidence.length > 0))
      .map((c) => `${c.id}: ${c.evidence.map((e) => e.snippet).join(' | ')}`)
    expect(flagged).toEqual([])
  })
})
