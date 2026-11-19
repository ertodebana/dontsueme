import type { ScanResult } from '../../server/types.ts'

// Turns the report into a prompt for Claude Code (or any coding agent).
export function fixPrompt(r: ScanResult): string {
  const open = r.checks.filter((c) => c.status !== 'pass')
  if (!open.length) return ''
  const items = open
    .map((c, i) => {
      const where = c.evidence.length ? `\n   Seen in: ${[...new Set(c.evidence.map((e) => e.where))].join(', ')}` : ''
      return `${i + 1}. [${c.status.toUpperCase()}] ${c.title} (${c.law.name})\n   ${c.summary}${where}\n   Fix: ${c.fix}`
    })
    .join('\n\n')
  return `A legal-risk scan of ${r.target} flagged these issues in my app:

${items}

Find where each one lives in this codebase and fix what you can in code.
Then give me a short list of what I must do myself outside the code (registrations, email provider settings, legal text), in order of risk.`
}
