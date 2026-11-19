import { describe, expect, it } from 'vitest'
import { runChecks } from '../server/checks.ts'
import type { Snapshot, Status } from '../server/types.ts'

const snap = (html: string, js = ''): Snapshot => ({
  origin: 'https://app.test',
  notes: [],
  docs: [
    { path: '/', kind: 'html', text: html, truncated: false },
    ...(js ? [{ path: '/assets/app.js', kind: 'js' as const, text: js, truncated: false }] : []),
  ],
})
const status = (s: Snapshot, id: string): Status => runChecks(s).find((c) => c.id === id)!.status

describe('coppa/age-gate', () => {
  it('passes with no signup', () => expect(status(snap('<h1>Hello</h1>'), 'coppa/age-gate')).toBe('pass'))
  it('warns on signup without age question', () =>
    expect(status(snap('<form><input type="password"><button>Sign up</button></form>'), 'coppa/age-gate')).toBe('warn'))
  it('passes when a DOB field is present', () =>
    expect(status(snap('<button>Sign up</button><label>Date of birth</label>'), 'coppa/age-gate')).toBe('pass'))
  it('ignores CSS [type=password] selectors', () =>
    expect(status(snap('<p>hi</p>', '[type=password],[type=email]{border:0}'), 'coppa/age-gate')).toBe('pass'))
  it('does not read `18+x` in minified JS as an age gate', () =>
    expect(status(snap('<button>Sign up</button>', 'var a=18+b;'), 'coppa/age-gate')).toBe('warn'))
  it('finds signup and age signals inside JS bundles', () =>
    expect(status(snap('<div id="root"></div>', 'h("button",null,"Create account");h("p",null,"You must be at least 13")'), 'coppa/age-gate')).toBe('pass'))
})

describe('gdpr/google-fonts', () => {
  it('fails on a googleapis link', () =>
    expect(status(snap('<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">'), 'gdpr/google-fonts')).toBe('fail'))
  it('fails on gstatic in CSS/JS', () => expect(status(snap('', 'url(https://fonts.gstatic.com/s/inter.woff2)'), 'gdpr/google-fonts')).toBe('fail'))
  it('passes on the words "Google Fonts"', () => expect(status(snap('<p>We self-host Google Fonts</p>'), 'gdpr/google-fonts')).toBe('pass'))
})

describe('cipa/session-replay', () => {
  it('fails on Hotjar without a CMP', () =>
    expect(status(snap('<script src="https://static.hotjar.com/c/hotjar-1.js"></script>'), 'cipa/session-replay')).toBe('fail'))
  it('warns on Clarity with Cookiebot', () =>
    expect(status(snap('<script src="https://consent.cookiebot.com/uc.js"></script><script src="https://www.clarity.ms/tag/x"></script>'), 'cipa/session-replay')).toBe('warn'))
  it('only warns on an SDK that may have recording off', () =>
    expect(status(snap('', 'posthog.init(k,{disable_session_recording:!1})'), 'cipa/session-replay')).toBe('warn'))
  it('fails when a definite recorder ships without consent', () =>
    expect(status(snap('', 'LogRocket.init("a/b");Sentry.init({integrations:[replayIntegration()]})'), 'cipa/session-replay')).toBe('fail'))
  it('passes on a clean page', () => expect(status(snap('<p>clarity matters</p>'), 'cipa/session-replay')).toBe('pass'))
})

describe('canspam/marketing-email', () => {
  it('is always manual', () => expect(status(snap('<p>Join our newsletter</p>'), 'canspam/marketing-email')).toBe('manual'))
})

describe('ca-arl/renewal-terms', () => {
  it('passes with no recurring billing', () => expect(status(snap('<p>One-time $49</p>'), 'ca-arl/renewal-terms')).toBe('pass'))
  it('warns on monthly pricing', () => expect(status(snap('<p>$9/mo</p><button>Subscribe</button>'), 'ca-arl/renewal-terms')).toBe('warn'))
  it('ignores paths like /mock', () => expect(status(snap('<a href="/mock">x</a>'), 'ca-arl/renewal-terms')).toBe('pass'))
})

describe('dmca/agent', () => {
  it('passes with no user content', () => expect(status(snap('<p>Docs</p>'), 'dmca/agent')).toBe('pass'))
  it('fails on a file input with no DMCA notice', () => expect(status(snap('<input type="file" name="photo">'), 'dmca/agent')).toBe('fail'))
  it('warns on a file input with DMCA notice', () =>
    expect(status(snap('<input type="file"><a href="/dmca">DMCA</a>'), 'dmca/agent')).toBe('warn'))
  it('warns on a weak "upload" mention', () => expect(status(snap('<p>Upload your CSV</p>'), 'dmca/agent')).toBe('warn'))
  it('ignores user-content wording that only appears in a privacy policy', () => {
    const s = snap('<p>Docs</p>')
    s.docs.push({ path: '/privacy', kind: 'legal', text: 'If you post a comment or upload a file…', truncated: false })
    expect(status(s, 'dmca/agent')).toBe('pass')
  })
  it('ignores "upload" inside CDN URLs and slugs', () =>
    expect(status(snap('<img src="https://cdn.x.com/image/upload/a.png"><a href="/blog/user-generated-content">x</a>'), 'dmca/agent')).toBe('pass'))
})
