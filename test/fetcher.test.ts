import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { guardedLookup, isBlockedAddress, parseTarget, safeGet } from '../server/fetcher.ts'

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', '64:ff9b::a9fe:a9fe', 'not-an-ip',
  ])('blocks %s', (ip) => expect(isBlockedAddress(ip)).toBe(true))
  it.each(['8.8.8.8', '76.76.21.21', '2606:4700:4700::1111'])('allows %s', (ip) => expect(isBlockedAddress(ip)).toBe(false))
})

describe('parseTarget', () => {
  it.each([
    ['ftp://example.com', 'scheme'],
    ['file:///etc/passwd', 'scheme'],
    ['https://user:pw@example.com', 'credentials'],
    ['https://example.com:8443', 'port'],
    ['http://127.0.0.1', 'blocked-address'],
    ['http://[::1]/', 'blocked-address'],
    ['http://169.254.169.254/latest/meta-data', 'blocked-address'],
    ['http://2130706433/', 'blocked-address'], // decimal 127.0.0.1
    ['http://0x7f.1/', 'blocked-address'],
    ['not a url', 'invalid-url'],
  ])('rejects %s', (url, code) => expect(() => parseTarget(url)).toThrow(expect.objectContaining({ code })))
  it('accepts a normal https URL', () => expect(parseTarget('https://example.com/x').hostname).toBe('example.com'))
})

describe('guardedLookup', () => {
  it('refuses hostnames that resolve to loopback', async () => {
    const err = await new Promise((resolve) => guardedLookup('localhost', {}, (e) => resolve(e)))
    expect(err).toMatchObject({ code: 'blocked-address' })
  })
})

describe('safeGet against a local server', () => {
  let server: http.Server
  let port = ''
  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<p>secret</p>')
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    port = String((server.address() as AddressInfo).port)
  })
  afterAll(() => server.close())

  const opts = () => ({ deadline: Date.now() + 5000, maxBytes: 10_000, accept: /html/, ports: [port] })

  it('blocks localhost via DNS at connect time', async () => {
    await expect(safeGet(`http://localhost:${port}/`, opts())).rejects.toMatchObject({ code: 'blocked-address' })
  })
  it('blocks the IP literal', async () => {
    await expect(safeGet(`http://127.0.0.1:${port}/`, opts())).rejects.toMatchObject({ code: 'blocked-address' })
  })
  it('blocks a localtest.me-style name that resolves to 127.0.0.1', async () => {
    // localtest.me is public DNS pointing at 127.0.0.1; skip quietly if offline
    await expect(safeGet(`http://localtest.me:${port}/`, opts())).rejects.toMatchObject({
      code: expect.stringMatching(/blocked-address|dns/),
    })
  })
})
