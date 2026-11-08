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
