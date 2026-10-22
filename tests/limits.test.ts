// Garde-fous d'exécution : sémaphore global, limite par hôte, isolement des circuits Tor.

import { createServer as createHttpServer, type Server } from 'node:http'
import { createServer as createTcpServer, type AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { Settings } from '@shared/types'
import { createFetch, hostLimiter, PER_HOST_LIMIT, resetDispatchers, torAuth } from '../src/main/engine/http'
import { HostLimiter, Semaphore } from '../src/main/engine/limits'
import { DEFAULT_SETTINGS } from '../src/main/settings'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('Semaphore', () => {
  it('ne dépasse jamais la capacité et sert les demandes dans l’ordre', async () => {
    const sem = new Semaphore(() => 2)
    let active = 0
    let max = 0
    const order: number[] = []
    await Promise.all(
      Array.from({ length: 7 }, async (_, i) => {
        const release = await sem.acquire()
        order.push(i)
        active++
        max = Math.max(max, active)
        await sleep(5)
        active--
        release()
      })
    )
    expect(max).toBe(2)
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(sem.idle).toBe(true)
  })

  it('interrompt une attente annulée sans perdre de place', async () => {
    const sem = new Semaphore(() => 1)
    const first = await sem.acquire()
    const controller = new AbortController()
    const waiting = sem.acquire(controller.signal)
    expect(sem.waiting).toBe(1)
    controller.abort()
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
    expect(sem.waiting).toBe(0)
    // Libérer deux fois ne crée pas de place fantôme.
    first()
    first()
    expect(sem.running).toBe(0)
    const again = await sem.acquire()
    expect(sem.running).toBe(1)
    again()
  })

  it('refuse tout de suite un signal déjà annulé', async () => {
    const sem = new Semaphore(() => 4)
    await expect(sem.acquire(AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' })
    expect(sem.running).toBe(0)
  })

  it('applique une hausse de capacité aux demandes en attente', async () => {
    let capacity = 1
    const sem = new Semaphore(() => capacity)
    const a = await sem.acquire()
    let granted = false
    const b = sem.acquire().then((r) => ((granted = true), r))
    await sleep(1)
    expect(granted).toBe(false)
    capacity = 2
    sem.drain()
    ;(await b)()
    expect(granted).toBe(true)
    a()
  })
})

describe('HostLimiter', () => {
  it('limite chaque hôte séparément et oublie les hôtes inactifs', async () => {
    const limiter = new HostLimiter(2, { 'dns.example': 5 })
    const a = await Promise.all([limiter.acquire('a.example'), limiter.acquire('A.example')])
    const b = await limiter.acquire('b.example')
    expect(limiter.running('a.example')).toBe(2)
    expect(limiter.running('b.example')).toBe(1)
    let third = false
    const pending = limiter.acquire('a.example').then((r) => ((third = true), r))
    await sleep(1)
    expect(third).toBe(false)
    a[0]()
    ;(await pending)()
    expect(third).toBe(true)
    a[1]()
    b()
    expect(limiter.running('a.example')).toBe(0)
    expect(limiter.limitFor('dns.example')).toBe(5)
  })
})

describe('createFetch : limite par hôte', () => {
  let server: Server | null = null
  afterEach(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()))
    server = null
  })

  const settings = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, proxy: { ...DEFAULT_SETTINGS.proxy, mode: 'none' }, ...patch })

  async function slowServer(delay: number): Promise<{ url: string; stats: { active: number; max: number; total: number } }> {
    const stats = { active: 0, max: 0, total: 0 }
    server = createHttpServer((_req, res) => {
      stats.active++
      stats.total++
      stats.max = Math.max(stats.max, stats.active)
      setTimeout(() => {
        stats.active--
        res.end('ok')
      }, delay)
    })
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, stats }
  }

  it(`n’envoie pas plus de ${PER_HOST_LIMIT} requêtes simultanées au même hôte`, async () => {
    const { url, stats } = await slowServer(60)
    const fetchFn = createFetch({ settings: settings() })
    const texts = await Promise.all(Array.from({ length: 9 }, (_, i) => fetchFn(`${url}?n=${i}`).then((r) => r.text())))
    expect(texts.every((t) => t === 'ok')).toBe(true)
    expect(stats.total).toBe(9)
    expect(stats.max).toBe(PER_HOST_LIMIT)
    expect(hostLimiter.running('127.0.0.1')).toBe(0)
  })

  it('ne compte pas l’attente dans le délai de la requête', async () => {
    const { url } = await slowServer(80)
    const fetchFn = createFetch({ settings: settings() })
    // 6 requêtes de 80 ms par paquets de 3 : 160 ms au total, chacune sous le délai de 150 ms.
    const res = await Promise.all(Array.from({ length: 6 }, () => fetchFn(url, { timeoutMs: 150 })))
    expect(res.every((r) => r.ok)).toBe(true)
  })

  it('abandonne une requête en attente dès l’annulation du module', async () => {
    const { url, stats } = await slowServer(150)
    const controller = new AbortController()
    const fetchFn = createFetch({ settings: settings(), signal: controller.signal })
    const all = Array.from({ length: 5 }, () => fetchFn(url).then(() => 'ok', (e: Error) => e.name))
    await sleep(20)
    const t0 = Date.now()
    controller.abort()
    const results = await Promise.all(all)
    expect(Date.now() - t0).toBeLessThan(100)
    expect(results.every((r) => r === 'AbortError')).toBe(true)
    // Les deux requêtes en attente ne sont jamais parties.
    expect(stats.total).toBe(PER_HOST_LIMIT)
    await sleep(160)
    expect(hostLimiter.running('127.0.0.1')).toBe(0)
  })
})

describe('Tor : un circuit par enquête', () => {
  afterEach(() => resetDispatchers())

  it('construit l’identifiant SOCKS de l’enquête', () => {
    expect(torAuth('abc', 's1')).toEqual({ userId: 'masint-abc', password: 's1' })
    expect(torAuth(undefined, '')).toEqual({ userId: 'masint', password: 'masint' })
  })

  /** Faux serveur SOCKS5 : note l'identifiant reçu puis refuse la connexion. */
  async function fakeSocks(): Promise<{ port: number; seen: string[]; close: () => Promise<void> }> {
    const seen: string[] = []
    const srv = createTcpServer((sock) => {
      let step = 0
      sock.on('data', (buf) => {
        if (step === 0) {
          // Méthodes proposées : on choisit nom d'utilisateur et mot de passe (0x02) s'il est offert.
          const methods = [...buf.subarray(2, 2 + buf[1])]
          step = methods.includes(2) ? 1 : 2
          sock.write(Buffer.from([5, methods.includes(2) ? 2 : 0]))
          if (step === 2) seen.push('(sans identifiant)')
        } else if (step === 1) {
          const ulen = buf[1]
          const user = buf.subarray(2, 2 + ulen).toString()
          const pass = buf.subarray(3 + ulen, 3 + ulen + buf[2 + ulen]).toString()
          seen.push(`${user}:${pass}`)
          step = 2
          sock.write(Buffer.from([1, 0]))
        } else {
          // CONNECT refusé : la requête échoue, seul l'identifiant nous intéresse.
          sock.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]))
        }
      })
      sock.on('error', () => undefined)
    })
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
    return { port: (srv.address() as AddressInfo).port, seen, close: () => new Promise((r) => srv.close(() => r())) }
  }

  it('envoie masint-<enquête> à Tor, avec le sel de la nouvelle identité', async () => {
    const socks = await fakeSocks()
    try {
      const tor = (salt: string): Settings => ({ ...DEFAULT_SETTINGS, proxy: { ...DEFAULT_SETTINGS.proxy, mode: 'tor', torPort: socks.port }, torSalt: salt })
      const attempt = (s: Settings, investigationId?: string): Promise<unknown> =>
        createFetch({ settings: s, investigationId })('http://exemple.invalid/', { timeoutMs: 3000 }).catch(() => null)
      await attempt(tor('sel1'), 'enquete-a')
      await attempt(tor('sel1'), 'enquete-b')
      await attempt(tor('sel2'), 'enquete-a')
      await attempt(tor('sel2'))
      expect(socks.seen).toEqual(['masint-enquete-a:sel1', 'masint-enquete-b:sel1', 'masint-enquete-a:sel2', 'masint:sel2'])
    } finally {
      await socks.close()
    }
  })

  it('n’ajoute pas d’identifiant à un proxy SOCKS ordinaire', async () => {
    const socks = await fakeSocks()
    try {
      const s: Settings = { ...DEFAULT_SETTINGS, proxy: { ...DEFAULT_SETTINGS.proxy, mode: 'socks5', url: `socks5://127.0.0.1:${socks.port}` } }
      await createFetch({ settings: s, investigationId: 'enquete-a' })('http://exemple.invalid/', { timeoutMs: 3000 }).catch(() => null)
      expect(socks.seen).toEqual(['(sans identifiant)'])
    } finally {
      await socks.close()
    }
  })
})
