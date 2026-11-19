// SSRF-safe GET. The API fetches user-supplied URLs, so every hop is checked:
// scheme, port, credentials, IP literals up front, and resolved addresses at
// connect time (the same lookup the socket uses, so DNS rebinding can't slip in).
import dns from 'node:dns'
import http, { type IncomingMessage } from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { pipeline, type Readable } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'

const USER_AGENT = 'DontSueMe-scanner/1.0 (+https://github.com/ertodebana/dontsueme)'
const ACCEPT = 'text/html,application/xhtml+xml,text/css,application/javascript;q=0.9,*/*;q=0.5'
const DEFAULT_PORTS = ['80', '443']
const MAX_REDIRECTS = 4
const PER_REQUEST_MS = 8_000
const REDIRECTS = new Set([301, 302, 303, 307, 308])

export class ScanError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ScanError'
    this.code = code
  }
}

// Two lists on purpose: BlockList matches IPv4 addresses against IPv6 rules as
// IPv4-mapped, so a ::ffff:0:0/96 rule in a shared list would block every IPv4.
const BLOCKED_V4 = new net.BlockList()
const BLOCKED_V6 = new net.BlockList()
for (const [addr, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
] as const) BLOCKED_V4.addSubnet(addr, prefix, 'ipv4')
for (const [addr, prefix] of [
  ['::', 96], // unspecified, loopback, IPv4-compatible
  ['::ffff:0:0', 96], // IPv4-mapped
  ['64:ff9b::', 96], // NAT64
  ['100::', 64], // discard
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) BLOCKED_V6.addSubnet(addr, prefix, 'ipv6')

export function isBlockedAddress(address: string): boolean {
  if (net.isIPv4(address)) return BLOCKED_V4.check(address, 'ipv4')
  if (net.isIPv6(address)) return BLOCKED_V6.check(address, 'ipv6')
  return true // not a plain IP: refuse rather than guess
}

export function parseTarget(raw: string, ports: readonly string[] = DEFAULT_PORTS): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ScanError('invalid-url', 'That does not look like a URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ScanError('scheme', 'Only http:// and https:// sites can be scanned.')
  }
  if (url.username || url.password) {
    throw new ScanError('credentials', 'URLs with a username or password are not accepted.')
  }
  const port = url.port || (url.protocol === 'https:' ? '443' : '80')
  if (!ports.includes(port)) {
    throw new ScanError('port', `Port ${port} is not allowed. Only sites on 80 or 443 can be scanned.`)
  }
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1')
  if (!host) throw new ScanError('invalid-url', 'That URL has no host.')
  if (net.isIP(host) && isBlockedAddress(host)) {
    throw new ScanError('blocked-address', 'That address is on a private or internal network.')
  }
  return url
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void

export function guardedLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback): void {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, '')
    if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
      return callback(new ScanError('blocked-address', `${hostname} resolves to a private or internal address.`), '')
    }
    if (options.all) return callback(null, addresses)
    callback(null, addresses[0].address, addresses[0].family)
  })
}

export interface FetchOptions {
  deadline: number // epoch ms; the whole scan shares one budget
  maxBytes: number // decoded bytes; longer bodies are truncated, not rejected
  accept: RegExp // content types worth reading; others come back with an empty body
  ports?: readonly string[] // tests only
}

export interface Fetched {
  url: URL
  status: number
  contentType: string
  body: string
  truncated: boolean
}

export async function safeGet(start: URL | string, opts: FetchOptions): Promise<Fetched> {
  let url = parseTarget(String(start), opts.ports)
  for (let hop = 0; ; hop += 1) {
    const res = await requestOnce(url, opts)
    if (!REDIRECTS.has(res.status) || !res.location) return { url, ...res }
    if (hop >= MAX_REDIRECTS) throw new ScanError('redirects', 'The site redirected too many times.')
    let next: string
    try {
      next = new URL(res.location, url).toString()
    } catch {
      throw new ScanError('redirects', 'The site sent a broken redirect.')
    }
    url = parseTarget(next, opts.ports)
  }
}

interface Raw {
  status: number
  location?: string
  contentType: string
  body: string
  truncated: boolean
}

function requestOnce(url: URL, opts: FetchOptions): Promise<Raw> {
  const remaining = opts.deadline - Date.now()
  if (remaining <= 0) return Promise.reject(new ScanError('timeout', 'The scan ran out of time.'))
  const transport = url.protocol === 'https:' ? https : http

  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: 'GET',
        lookup: guardedLookup,
        headers: { 'user-agent': USER_AGENT, accept: ACCEPT, 'accept-encoding': 'gzip, deflate, br' },
      },
      (res) => {
        const status = res.statusCode ?? 0
        const contentType = res.headers['content-type'] ?? ''
        if (REDIRECTS.has(status) || !opts.accept.test(contentType)) {
          res.resume()
          return finish({ status, location: res.headers.location, contentType, body: '', truncated: false })
        }
        readBody(res, opts.maxBytes).then((b) => finish({ status, contentType, ...b }), fail)
      },
    )
    const timer = setTimeout(
      () => req.destroy(new ScanError('timeout', `${url.host} did not respond in time.`)),
      Math.min(PER_REQUEST_MS, remaining),
    )
    const finish = (r: Raw) => {
      clearTimeout(timer)
      resolve(r)
    }
    const fail = (err: unknown) => {
      clearTimeout(timer)
      reject(toScanError(err, url))
    }
    req.on('error', fail)
    req.end()
  })
}

async function readBody(res: IncomingMessage, maxBytes: number): Promise<{ body: string; truncated: boolean }> {
  const source = decode(res)
  const chunks: Buffer[] = []
  let size = 0
  let truncated = false
  for await (const chunk of source) {
    const buf = chunk as Buffer
    if (size + buf.length > maxBytes) {
      chunks.push(buf.subarray(0, maxBytes - size)) // cap on decoded bytes also stops zip bombs
      truncated = true
      break
    }
    chunks.push(buf)
    size += buf.length
  }
  return { body: Buffer.concat(chunks).toString('utf8'), truncated }
}

function decode(res: IncomingMessage): Readable {
  const enc = (res.headers['content-encoding'] ?? '').trim().toLowerCase()
  if (enc === '' || enc === 'identity') return res
  const decoder =
    enc === 'gzip' || enc === 'x-gzip'
      ? createGunzip()
      : enc === 'deflate'
        ? createInflate()
        : enc === 'br'
          ? createBrotliDecompress()
          : null
  if (!decoder) throw new ScanError('encoding', `Unsupported content-encoding: ${enc}`)
  pipeline(res, decoder, () => {}) // errors surface through the decoder's iterator
  return decoder
}

function toScanError(err: unknown, url: URL): ScanError {
  if (err instanceof ScanError) return err
  const code = (err as NodeJS.ErrnoException | undefined)?.code ?? ''
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new ScanError('dns', `Could not find a server for ${url.hostname}.`)
  }
  if (code.startsWith('ERR_TLS') || code.includes('CERT')) {
    return new ScanError('tls', `${url.host} has a TLS certificate problem.`)
  }
  if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ETIMEDOUT', 'ENETUNREACH'].includes(code)) {
    return new ScanError('unreachable', `Could not connect to ${url.host}.`)
  }
  return new ScanError('network', `The request to ${url.host} failed.`)
}
