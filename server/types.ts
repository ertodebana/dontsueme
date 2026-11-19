export type Status = 'pass' | 'warn' | 'fail' | 'manual'

export interface Evidence {
  where: string // page or asset path, e.g. "/" or "/assets/index-3f2a.js"
  snippet: string
}

export interface LawInfo {
  id: string
  name: string
  exposure: string
  asOf: string
  source: { label: string; url: string }
}

export interface CheckResult {
  id: string
  title: string
  law: LawInfo
  status: Status
  summary: string
  evidence: Evidence[]
  fix: string
}

export interface ScanResult {
  target: string
  scannedAt: string
  scanned: string[]
  notes: string[]
  counts: Record<Status, number>
  checks: CheckResult[]
}

export interface Doc {
  path: string
  kind: 'html' | 'css' | 'js' | 'legal' // legal = linked terms/privacy/pricing pages
  text: string
  truncated: boolean
}

export interface Snapshot {
  origin: string
  docs: Doc[]
  notes: string[]
}
