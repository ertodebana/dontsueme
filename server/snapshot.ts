import { load } from 'cheerio'
import { ScanError, safeGet, type Fetched } from './fetcher.ts'
import type { Doc, Snapshot } from './types.ts'

const MAX_BYTES = 2_000_000
const MAX_ASSETS = 8
const MAX_PAGES = 3
const BUDGET_MS = 12_000
const HTML_TYPE = /^(?:text\/html|application\/xhtml\+xml)\b/i
const ASSET_TYPE = /^(?:text\/(?:css|javascript|plain)|application\/(?:javascript|x-javascript|ecmascript))\b/i
const LEGAL_LINK = /privacy|terms|dmca|copyright|refund|cancel|billing|pricing|legal|policy|imprint|impressum/i

export const SCOPE_NOTE =
  `Static scan: the page HTML, up to ${MAX_ASSETS} same-site CSS/JS files and up to ${MAX_PAGES} linked legal pages. ` +
  'Code that only loads after a click, a login, or from another domain was not read.'

export async function takeSnapshot(start: URL): Promise<Snapshot> {
  const deadline = Date.now() + BUDGET_MS
  const home = await safeGet(start, { deadline, maxBytes: MAX_BYTES, accept: HTML_TYPE })
  if (home.status < 200 || home.status >= 300) {
    throw new ScanError(`http-${home.status}`, `The site answered HTTP ${home.status}, so there was no page to check.`)
  }
  if (!HTML_TYPE.test(home.contentType)) {
    throw new ScanError('not-html', `That URL returned ${home.contentType || 'no content type'}, not a web page.`)
  }

  const $ = load(home.body)
  const assets = sameOrigin(
    [
      ...$('link[rel~="stylesheet"][href]').toArray().map((el) => $(el).attr('href')),
      ...$('script[src]').toArray().map((el) => $(el).attr('src')),
    ],
    home.url,
  ).slice(0, MAX_ASSETS)
  const pages = sameOrigin(
    $('a[href]')
      .toArray()
      .filter((el) => LEGAL_LINK.test(`${$(el).attr('href')} ${$(el).text()}`))
      .map((el) => $(el).attr('href')),
    home.url,
  )
    .filter((u) => u.pathname !== home.url.pathname)
    .slice(0, MAX_PAGES)

  const notes = [SCOPE_NOTE]
  const fetched = await Promise.all([
    ...assets.map((u) => attempt(u, deadline, ASSET_TYPE, notes)),
    ...pages.map((u) => attempt(u, deadline, HTML_TYPE, notes)),
  ])
  const docs: Doc[] = [toDoc(home, 'html'), ...fetched.filter((d): d is Doc => d !== null)]
  const cut = docs.filter((d) => d.truncated).map((d) => d.path)
  if (cut.length) notes.push(`Only the first 2 MB of ${cut.join(', ')} was read.`)
  return { origin: home.url.origin, docs, notes }
}

async function attempt(u: URL, deadline: number, accept: RegExp, notes: string[]): Promise<Doc | null> {
  try {
    const r = await safeGet(u, { deadline, maxBytes: MAX_BYTES, accept })
    if (r.status < 200 || r.status >= 300) throw new ScanError('skipped', `HTTP ${r.status}`)
    if (!accept.test(r.contentType)) throw new ScanError('skipped', `unexpected ${r.contentType || 'content'}`)
    const kind = accept === HTML_TYPE ? 'legal' : /css/i.test(r.contentType) || u.pathname.endsWith('.css') ? 'css' : 'js'
    return toDoc(r, kind)
  } catch (err) {
    notes.push(`Skipped ${u.pathname}: ${err instanceof Error ? err.message : 'unknown error'}`)
    return null
  }
}

function toDoc(r: Fetched, kind: Doc['kind']): Doc {
  return { path: r.url.pathname || '/', kind, text: r.body, truncated: r.truncated }
}

function sameOrigin(hrefs: (string | undefined)[], base: URL): URL[] {
  const out = new Map<string, URL>()
  for (const href of hrefs) {
    if (!href) continue
    let u: URL
    try {
      u = new URL(href, base)
    } catch {
      continue
    }
    if (u.origin !== base.origin) continue
    u.hash = ''
    out.set(u.toString(), u)
  }
  return [...out.values()]
}
