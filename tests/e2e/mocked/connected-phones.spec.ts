import { expect, test, type Page, type WebSocketRoute } from '@playwright/test'

const api = '**/api/v1/**'
const socketPath = /\/socket\.io\//

function openVoteState(extra: Record<string, unknown> = {}) {
  return {
    assembly: { id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress', lobbyStatus: 'lobby_closed' },
    participationStatus: 'pending',
    currentRound: {
      id: 'synthetic-round', title: 'Presidencia', status: 'open',
      options: [{ id: 'isaias', label: 'Isaías' }, { id: 'jeremias', label: 'Jeremías' }],
    },
    ...extra,
  }
}

function openEngine(ws: WebSocketRoute) {
  ws.send(`0${JSON.stringify({ sid: 'synthetic-engine', upgrades: [], pingInterval: 25_000, pingTimeout: 20_000, maxPayload: 1_000_000 })}`)
}

async function acceptSocket(ws: WebSocketRoute) {
  openEngine(ws)
  ws.onMessage((message) => {
    if (String(message).startsWith('40/events')) ws.send('40/events,{"sid":"synthetic-socket"}')
  })
}

async function mockSocket(page: Page) {
  const link = { online: true, current: null as WebSocketRoute | null }
  await page.routeWebSocket(socketPath, async (ws) => {
    if (!link.online) { openEngine(ws); await ws.close(); return }
    link.current = ws
    await acceptSocket(ws)
  })
  return link
}

async function joinAsPhone(page: Page, state: () => Record<string, unknown>) {
  await page.addInitScript(() => localStorage.setItem('participantSessionToken', 'synthetic-phone'))
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/participant/me')) { await route.fulfill({ json: state() }); return }
    await route.fulfill({ status: 404, json: { message: 'No mock route for connected phones test' } })
  })
}

const notice = 'Conexión interrumpida'

test('el teléfono muestra «Conectado» durante la votación y no el aviso de conexión', async ({ page }) => {
  await mockSocket(page)
  await joinAsPhone(page, () => openVoteState({ connectionGraceMs: 3_000 }))
  await page.goto('/')
  await expect(page.getByText('Conectado', { exact: true })).toBeVisible()
  await expect(page.getByText(notice)).toHaveCount(0)
})

test('un corte breve no cambia lo que muestra el teléfono; uno largo muestra el aviso', async ({ page }) => {
  await page.clock.install()
  const link = await mockSocket(page)
  await joinAsPhone(page, () => openVoteState({ connectionGraceMs: 3_000 }))
  await page.goto('/')
  await expect(page.getByText('Conectado', { exact: true })).toBeVisible()

  link.online = false
  await link.current!.close()
  await page.clock.runFor(2_500)
  await expect(page.getByText('Conectado', { exact: true })).toBeVisible()
  await expect(page.getByText(notice)).toHaveCount(0)

  await page.clock.runFor(1_000)
  await expect(page.getByText(notice)).toBeVisible()
  await expect(page.getByText('Conectado', { exact: true })).toHaveCount(0)

  link.online = true
  await page.clock.runFor(12_000)
  await expect(page.getByText('Conectado', { exact: true })).toBeVisible()
  await expect(page.getByText(notice)).toHaveCount(0)
})

test('un corte que se recupera dentro del margen no muestra el aviso', async ({ page }) => {
  await page.clock.install()
  const link = await mockSocket(page)
  await joinAsPhone(page, () => openVoteState({ connectionGraceMs: 3_000 }))
  await page.goto('/')
  await expect(page.getByText('Conectado', { exact: true })).toBeVisible()

  await link.current!.close()
  await page.clock.runFor(2_000)
  await expect(page.getByText('Conectado', { exact: true })).toBeVisible()
  await page.clock.runFor(4_000)
  await expect(page.getByText('Conectado', { exact: true })).toBeVisible()
  await expect(page.getByText(notice)).toHaveCount(0)
})

test('sin votación abierta el teléfono no muestra «Conectado»', async ({ page }) => {
  await mockSocket(page)
  await joinAsPhone(page, () => ({ ...openVoteState({ connectionGraceMs: 3_000 }), currentRound: undefined }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sala de espera' })).toBeVisible()
  await expect(page.getByText('Conectado', { exact: true })).toHaveCount(0)
})

function projectorState(round: Record<string, unknown>, connection?: Record<string, unknown>) {
  return {
    assembly: { id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress' }, lobbyStatus: 'lobby_closed',
    participantCount: 50, recordedCount: 12, eligibleCount: 50,
    round: { category: 'office', voteNumber: 1, ...round },
    ...(connection ? { connection } : {}),
  }
}

const connectedCount = /\d+ de \d+ conectados/

test('el proyector muestra cuántos teléfonos de la base están conectados y sigue los cambios', async ({ page }) => {
  const link = await mockSocket(page)
  await page.route(api, (route) => route.fulfill({ json: projectorState({ id: 'v1', title: 'Presidencia', status: 'open' }, { roundId: 'v1', connected: 47, base: 50 }) }))
  await page.goto('/projector?code=synthetic')
  await expect(page.getByText('47 de 50 conectados')).toBeVisible()
  await expect(page.locator('.pj-progress')).toContainText('de 50 ya votaron')

  link.current!.send('42/events,["connection.count",{"roundId":"v1","connected":48,"base":50}]')
  await expect(page.getByText('48 de 50 conectados')).toBeVisible()
})

test('el proyector oculta el conteo de conectados al cerrar la votación', async ({ page }) => {
  let status = 'open'
  const link = await mockSocket(page)
  await page.route(api, (route) => route.fulfill({ json: status === 'open'
    ? projectorState({ id: 'v1', title: 'Presidencia', status }, { roundId: 'v1', connected: 47, base: 50 })
    : projectorState({ id: 'v1', title: 'Presidencia', status, annulReason: status === 'annulled' ? 'Error' : null }) }))
  await page.goto('/projector?code=synthetic')
  await expect(page.getByText('47 de 50 conectados')).toBeVisible()

  status = 'closed'
  link.current!.send('42/events,["round.state",{"roundId":"v1","status":"closed"}]')
  await expect(page.getByText(connectedCount)).toHaveCount(0)

  link.current!.send('42/events,["connection.count",{"roundId":"v1","connected":46,"base":50}]')
  await page.waitForTimeout(300)
  await expect(page.getByText(connectedCount)).toHaveCount(0)
})

test('el proyector no muestra el conteo de una votación anulada', async ({ page }) => {
  await mockSocket(page)
  await page.route(api, (route) => route.fulfill({ json: projectorState({ id: 'v1', title: 'Presidencia', status: 'annulled', annulReason: 'Error' }) }))
  await page.goto('/projector?code=synthetic')
  await expect(page.locator('.pj-status-annulled')).toBeVisible()
  await expect(page.getByText(connectedCount)).toHaveCount(0)
})

test('la mesa muestra solo el conteo de conectados, sin marcar a nadie', async ({ page }) => {
  await mockSocket(page)
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress', eligibleCount: 3, recordedCount: 1,
        participants: [
          { id: 'p1', firstName: 'Isaías', lastName: 'Delegado 1', voted: true },
          { id: 'p2', firstName: 'Jeremías', lastName: 'Delegado 2', voted: false },
          { id: 'p3', firstName: 'Ester', lastName: 'Delegada 3', voted: false },
        ],
        rounds: [{ id: 'v1', title: 'Presidencia', status: 'open', options: [{ id: 'a', label: 'Daniel' }, { id: 'b', label: 'Ezequiel' }], officialResult: null }],
        connection: { roundId: 'v1', connected: 2, base: 3 },
      } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for connected phones test' } })
  })
  await page.goto('/moderator')
  await expect(page.locator('.ballot-card').getByText('2 de 3 conectados')).toBeVisible()
  await expect(page.getByText(/conectad/i)).toHaveCount(1)
})

test('el proyector recupera el conteo actual al reconectarse, sin esperar otro cambio', async ({ page }) => {
  let connected = 47
  const link = await mockSocket(page)
  await page.route(api, (route) => route.fulfill({ json: projectorState({ id: 'v1', title: 'Presidencia', status: 'open' }, { roundId: 'v1', connected, base: 50 }) }))
  await page.goto('/projector?code=synthetic')
  await expect(page.getByText('47 de 50 conectados')).toBeVisible()

  connected = 45
  await link.current!.close()
  await expect(page.getByText('45 de 50 conectados')).toBeVisible({ timeout: 5_000 })
})

test('un corte cuyo primer reintento falla se recupera dentro del margen sin aviso', async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0.999 })
  let attempts = 0
  let first: WebSocketRoute | null = null
  await page.routeWebSocket(socketPath, async (ws) => {
    attempts += 1
    if (attempts === 2) { ws.send('x'); return }
    if (attempts === 1) first = ws
    await acceptSocket(ws)
  })
  await joinAsPhone(page, () => openVoteState({ connectionGraceMs: 3_000 }))
  await page.goto('/')
  await expect(page.getByText('Conectado', { exact: true })).toBeVisible()
  await page.evaluate((text) => {
    const seen = document.createElement('meta')
    seen.id = 'notice-seen'
    document.head.append(seen)
    new MutationObserver(() => { if (document.body.innerText.includes(text)) seen.setAttribute('content', 'yes') })
      .observe(document.body, { childList: true, subtree: true, characterData: true })
  }, notice)

  await first!.close()
  await expect.poll(() => attempts, { timeout: 6_000 }).toBe(3)
  await page.waitForTimeout(3_500)
  await expect(page.getByText('Conectado', { exact: true })).toBeVisible()
  await expect(page.locator('#notice-seen')).not.toHaveAttribute('content', 'yes')
})
