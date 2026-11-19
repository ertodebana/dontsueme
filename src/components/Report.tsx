import { useRef, useState } from 'react'
import type { CheckResult, ScanResult, Status } from '../../server/types.ts'
import { fixPrompt } from '../lib/prompt.ts'

const MARK: Record<Status, string> = { fail: '✖', warn: '▲', manual: '◌', pass: '✔' }
const LABEL: Record<Status, string> = { fail: 'red flag', warn: 'warning', manual: 'check by hand', pass: 'clear' }

export function Report({ result }: { result: ScanResult }) {
  const { counts } = result
  const prompt = fixPrompt(result)
  return (
    <section className="report" aria-label="Scan report">
      <p className="report-target">
        <span className="dim">scanned</span> {result.target}{' '}
        <span className="dim">· {plural(result.scanned.length, 'file')} · {new Date(result.scannedAt).toLocaleTimeString()}</span>
      </p>

      <p className="tally">
        {/* a zero shouldn't shout in alarm red */}
        <span className={counts.fail ? 's-fail' : 'dim'}>{plural(counts.fail, 'red flag')}</span> ·{' '}
        <span className={counts.warn ? 's-warn' : 'dim'}>{plural(counts.warn, 'warning')}</span> ·{' '}
        <span className={counts.manual ? 's-manual' : 'dim'}>{counts.manual} to check by hand</span> ·{' '}
        <span className={counts.pass ? 's-pass' : 'dim'}>{counts.pass} clear</span>
        <span className="dim"> · no guarantees, see notes</span>
      </p>

      <ol className="checks" role="list">
        {result.checks.map((c, i) => (
          <Check key={c.id} check={c} index={i} />
        ))}
      </ol>


      {prompt && <PromptBox prompt={prompt} />}

      <details className="notes">
        <summary>notes on this scan</summary>
        <ul>
          {result.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
          <li>Files read: {result.scanned.join(', ')}</li>
        </ul>
      </details>
    </section>
  )
}

function Check({ check: c, index }: { check: CheckResult; index: number }) {
  return (
    <li className={`check s-${c.status}`} style={{ animationDelay: `${index * 90}ms` }}>
      <div className="check-head">
        <span className="mark" aria-hidden>
          {MARK[c.status]}
        </span>
        <span className="sr-only">{LABEL[c.status]}:</span>
        <code className="rule">{c.id}</code>
        <span className="title">{c.title}</span>
      </div>
      <p className="summary">{c.summary}</p>
      {c.evidence.length > 0 && (
        <ul className="evidence">
          {c.evidence.map((e, i) => (
            <li key={i}>
              <span className="where">{e.where}</span> <span className="snippet">{e.snippet}</span>
            </li>
          ))}
        </ul>
      )}
      {c.status !== 'pass' && (
        <>
          <p className="fix">
            <span className="key">fix</span> {c.fix}
          </p>
          <p className="risk">
            <span className="key">risk</span> {c.law.name}: {c.law.exposure} <span className="dim">({c.law.asOf})</span>{' '}
            <a href={c.law.source.url} target="_blank" rel="noreferrer">
              source ↗
            </a>
          </p>
        </>
      )}
    </li>
  )
}

function PromptBox({ prompt }: { prompt: string }) {
  // One element is both the visible feedback and the live region, for success and failure.
  const [status, setStatus] = useState<{ text: string; failed: boolean }>({ text: '', failed: false })
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const copy = async () => {
    clearTimeout(timer.current)
    let next: { text: string; failed: boolean }
    try {
      await navigator.clipboard.writeText(prompt)
      next = { text: 'copied', failed: false }
    } catch {
      next = { text: 'copy failed, select the text below', failed: true } // clipboard blocked or insecure context
    }
    setStatus({ text: '', failed: false })
    requestAnimationFrame(() => setStatus(next)) // re-announce on repeat clicks
    timer.current = setTimeout(() => setStatus({ text: '', failed: false }), 2500)
  }
  return (
    <div className="prompt-box">
      <div className="prompt-head">
        <span>fix it with Claude Code: paste this into your repo session</span>
        <span className="copy-status" role="status" data-failed={status.failed || undefined}>
          {status.text}
        </span>
        <button type="button" onClick={copy}>
          copy prompt
        </button>
      </div>
      <pre tabIndex={0}>{prompt}</pre>
    </div>
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
