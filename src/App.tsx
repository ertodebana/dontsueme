import { useState, type FormEvent } from 'react'
import type { ScanResult } from '../server/types.ts'
import { Report } from './components/Report.tsx'

const RULES = [
  ['coppa/age-gate', 'accounts with no age question', 'COPPA'],
  ['gdpr/google-fonts', 'fonts fetched from Google', 'GDPR'],
  ['cipa/session-replay', 'recording visitors without consent', 'CIPA'],
  ['canspam/marketing-email', 'no unsubscribe or postal address', 'CAN-SPAM'],
  ['ca-arl/renewal-terms', 'renewal terms away from the button', 'CA ARL'],
  ['dmca/agent', 'user content, no DMCA agent', 'DMCA'],
] as const

type State = { kind: 'idle' } | { kind: 'busy'; url: string } | { kind: 'error'; message: string } | { kind: 'done'; result: ScanResult }

export default function App() {
  const [url, setUrl] = useState('')
  const [state, setState] = useState<State>({ kind: 'idle' })

  async function run(e: FormEvent) {
    e.preventDefault()
    if (!url.trim() || state.kind === 'busy') return
    setState({ kind: 'busy', url: url.trim() })
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json().catch(() => ({ error: `The scanner answered HTTP ${res.status}.` }))
      setState(res.ok ? { kind: 'done', result: data as ScanResult } : { kind: 'error', message: data.error ?? 'Scan failed.' })
    } catch {
      setState({ kind: 'error', message: 'Could not reach the scanner. Check your connection and try again.' })
    }
  }

  return (
    <div className="page">
      <header className="masthead">
        <span className="wordmark">dontsueme</span>
        <span className="dim">a linter for lawsuits</span>
      </header>

      <main>
        <h1>
          Your weekend app might already break <mark>six laws</mark>. Paste the URL and find out which.
        </h1>

        <form className="prompt" onSubmit={run}>
          <label htmlFor="url" className="ps1">
            $ dontsueme<span className="sr-only"> (website URL to scan)</span>
          </label>
          <input
            id="url"
            name="url"
            enterKeyHint="go"
            autoCorrect="off"
            type="text" // not type=url: "example.com" without a scheme is fine, the API adds https://
            inputMode="url"
            autoComplete="url"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="your-app.vercel.app"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          <button type="submit" disabled={state.kind === 'busy'}>
            {state.kind === 'busy' ? 'scanning…' : 'run'}
          </button>
        </form>

        {state.kind === 'idle' && (
          <section className="rules" aria-label="What gets checked">
            <p className="dim">rules</p>
            {/* role=list: Safari drops list semantics when list-style is none */}
            <ol role="list">
              {RULES.map(([id, what, law]) => (
                <li key={id}>
                  <code className="rule">{id}</code>
                  <span>{what}</span>
                  <span className="law">{law}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {state.kind === 'busy' && (
          <div className="busy">
            <p>→ fetching {state.url}</p>
            <p>→ reading HTML, stylesheets and scripts</p>
            <p>→ running 6 rules<span className="cursor">▍</span></p>
          </div>
        )}

        {state.kind === 'error' && (
          <p className="error" role="alert">
            <span className="mark">✖</span> {state.message}
          </p>
        )}

        {state.kind === 'done' && <Report result={state.result} />}

        {/* One short announcement instead of reading the whole report aloud */}
        <p className="sr-only" role="status">
          {state.kind === 'busy' && 'Scanning…'}
          {state.kind === 'done' &&
            `Scan finished: ${state.result.counts.fail} red flags, ${state.result.counts.warn} warnings, ${state.result.counts.manual} to check by hand.`}
        </p>
      </main>

      <footer>
        <p>
          Not legal advice. A static scan only sees what your site sends to a browser, so a clean report is not a clean bill of health.
        </p>
        <details className="notes">
          <summary>privacy &amp; fair use</summary>
          <ul>
            <li>
              No accounts, no cookies, no session replay. Fonts are served from this domain. We do not store the URLs you scan or
              the results.
            </li>
            <li>
              We count page views with{' '}
              <a href="https://www.goatcounter.com/help/privacy" target="_blank" rel="noreferrer">
                GoatCounter
              </a>
              . It sets no cookies, stores nothing on your device and keeps no profile of you. It records the page, referrer, browser,
              screen size and country, not your IP address.
            </li>
            <li>
              The site runs on Vercel. Like any host, Vercel processes your IP address and request metadata to deliver the page and
              protect it from abuse, under its own{' '}
              <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noreferrer">
                privacy policy
              </a>
              .
            </li>
            <li>
              The scanner fetches public pages the way a browser would, once per request, identifying itself as DontSueMe-scanner.
              Scan sites you own or work on. Results are automated signals, not findings about anyone's legal compliance.
            </li>
            <li>Company and product names are used only to describe what the scanner looks for. No affiliation implied.</li>
          </ul>
        </details>
        <p className="dim">
          <a href="https://github.com/ertodebana/dontsueme">source on GitHub</a> (MIT) · idea from{' '}
          <a href="https://x.com/Voxyz_ai">@Voxyz_ai</a>
        </p>
      </footer>
    </div>
  )
}
