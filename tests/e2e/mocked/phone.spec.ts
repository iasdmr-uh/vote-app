import type { Page } from '@playwright/test'
import { expect, test } from './api-fixture'

async function refreshByPolling(page: Page) {
  const request = page.waitForRequest((req) => req.url().includes('/api/v1/'))
  await page.clock.runFor(8_000)
  await request
}

function participantState(participationStatus: 'pending' | 'recorded' = 'pending') {
  return {
    assembly: { id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress', lobbyStatus: 'lobby_closed' },
    participationStatus,
    currentRound: {
      id: 'synthetic-round',
      title: 'Elección de prueba',
      status: 'open',
      options: [
        { id: 'synthetic-option-a', label: 'Opción Alfa (prueba)' },
        { id: 'synthetic-option-b', label: 'Opción Beta (prueba)' },
      ],
    },
  }
}

test('delegado ingresa con datos sintéticos y confirma su participación', async ({ page, api }) => {
  let voteCount = 0
  let releaseVote: (() => void) | undefined
  let markVoteStarted: (() => void) | undefined
  const votePending = new Promise<void>((resolve) => { releaseVote = resolve })
  const voteStarted = new Promise<void>((resolve) => { markVoteStarted = resolve })
  api.on(async ({ request, url }) => {
    if (request.method() === 'POST' && url.pathname.endsWith('/assemblies/DEMO-ROOM/join')) {
      return { json: { participantSessionToken: 'synthetic-participant-token', ...participantState() } }
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      return { json: participantState(voteCount ? 'recorded' : 'pending') }
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/participant/rounds/synthetic-round/vote')) {
      voteCount += 1
      markVoteStarted?.()
      await votePending
      return { status: 201, json: { status: 'recorded' } }
    }
  })

  await page.goto('/')
  await expect(page.getByRole('navigation')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Moderación' })).toHaveCount(0)
  await page.getByLabel('Código de sala').fill('DEMO-ROOM')
  await page.getByLabel('Nombre').fill('Delegado')
  await page.getByLabel('Apellido').fill('Sintético')
  await page.getByRole('button', { name: 'Entrar a la sala' }).click()
  await expect(page.getByRole('heading', { name: 'Elección de prueba' })).toBeVisible()

  await page.getByLabel('Opción Alfa (prueba)').check()
  await page.getByRole('button', { name: 'Revisar mi voto' }).click()
  await expect(page.getByRole('heading', { name: 'Confirma tu voto' })).toBeFocused()
  await expect(page.locator('.review-details').getByText('Elección de prueba', { exact: true })).toBeVisible()
  await expect(page.locator('.review-details').getByText('Opción Alfa (prueba)', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Volver', exact: true }).click()
  await expect(page.getByLabel('Opción Alfa (prueba)')).toBeChecked()
  expect(voteCount).toBe(0)

  await page.getByLabel('Opción Beta (prueba)').check()
  await page.getByRole('button', { name: 'Revisar mi voto' }).click()
  await expect(page.locator('.review-details').getByText('Opción Beta (prueba)', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar voto' }).click()
  await voteStarted
  await expect(page.getByRole('button', { name: 'Enviando…' })).toBeDisabled()
  expect(voteCount).toBe(1)
  releaseVote?.()

  await expect(page.getByText('Tu voto quedó registrado')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Tu voto quedó registrado')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Revisar mi voto' })).toHaveCount(0)
  expect(voteCount).toBe(1)
})

test('delegado vota en comisión marcando exactamente los cupos', async ({ page, api }) => {
  await page.addInitScript(() => localStorage.setItem('participantSessionToken', 'committee-session'))
  let recorded = false
  api.on(({ request, url }) => {
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      return { json: {
        assembly: { id: 'committee-assembly', name: 'Asamblea prueba', status: 'in_progress' },
        participationStatus: recorded ? 'recorded' : 'pending',
        currentRound: { id: 'committee-round', title: 'Comisión de Finanzas', status: 'open', format: 'multiple_choice', category: 'committee', memberCount: 2, electionSeats: 2, options: [
          { id: 'candidate-a', label: 'Ana (prueba)' }, { id: 'candidate-b', label: 'Beto (prueba)' }, { id: 'candidate-c', label: 'Celia (prueba)' },
        ] },
      } }
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/participant/rounds/committee-round/vote')) {
      expect(request.postDataJSON()).toEqual({ optionIds: ['candidate-a', 'candidate-b'], confirmation: true })
      recorded = true
      return { status: 201, json: { status: 'recorded' } }
    }
  })

  await page.goto('/')
  await expect(page.locator('.phone-status-open')).toHaveText('VOTACIÓN ABIERTA')
  await expect(page.getByRole('group', { name: '0 de 2' })).toBeVisible()
  await expect(page.getByText('0 de 2', { exact: true })).toBeVisible()
  const review = page.getByRole('button', { name: 'Revisar mi voto' })
  await expect(review).toBeDisabled()
  await page.getByLabel('Ana (prueba)').check()
  await expect(review).toBeDisabled()
  await page.getByLabel('Beto (prueba)').check()
  await expect(page.getByRole('group', { name: '2 de 2' })).toBeVisible()
  await expect(review).toBeEnabled()
  await page.getByLabel('Celia (prueba)').click()
  await expect(page.getByLabel('Celia (prueba)')).not.toBeChecked()
  await expect(page.getByRole('group', { name: '2 de 2' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: 'Revisar mi voto' }).click()
  await expect(page.locator('.review-details')).toContainText('Ana (prueba), Beto (prueba)')
  await page.getByRole('button', { name: 'Confirmar voto' }).click()
  await expect(page.getByText('Tu voto quedó registrado')).toBeVisible()
})

test('en un desempate se marcan exactamente los puestos que faltan y la papeleta no ofrece voto nulo', async ({ page, api }) => {
  await page.addInitScript(() => localStorage.setItem('participantSessionToken', 'runoff-session'))
  let voted: unknown
  api.on(({ request, url }) => {
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      return { json: {
        assembly: { id: 'committee-assembly', name: 'Asamblea prueba', status: 'in_progress' },
        participationStatus: voted ? 'recorded' : 'pending',
        openRound: { roundId: 'finance-runoff', title: 'Comisión de Finanzas', status: 'open', format: 'multiple_choice', category: 'committee', memberCount: 3, electionSeats: 2, voteNumber: 2, runoff: true, options: [
          { optionId: 'candidate-b', label: 'Beto (prueba)' }, { optionId: 'candidate-c', label: 'Celia (prueba)' }, { optionId: 'candidate-d', label: 'Dora (prueba)' },
        ] },
      } }
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/participant/rounds/finance-runoff/vote')) {
      voted = request.postDataJSON()
      return { status: 201, json: { status: 'recorded' } }
    }
  })

  await page.goto('/')
  await expect(page.locator('.phone-status-open')).toHaveText('VOTACIÓN ABIERTA')
  await expect(page.getByRole('group', { name: '0 de 2' })).toBeVisible()
  await expect(page.getByText(/voto nulo/i)).toHaveCount(0)
  const review = page.getByRole('button', { name: 'Revisar mi voto' })
  await expect(review).toBeDisabled()
  await expect(review).toHaveCSS('opacity', '0.4')
  await page.getByLabel('Beto (prueba)').check()
  await expect(page.getByRole('group', { name: '1 de 2' })).toBeVisible()
  await expect(review).toBeDisabled()
  await page.getByLabel('Dora (prueba)').check()
  await page.getByLabel('Celia (prueba)').click()
  await expect(page.getByLabel('Celia (prueba)')).not.toBeChecked()
  await expect(review).toBeEnabled()
  await page.getByLabel('Dora (prueba)').uncheck()
  await expect(review).toBeDisabled()
  await page.getByLabel('Celia (prueba)').check()
  await review.click()
  await page.getByRole('button', { name: 'Confirmar voto' }).click()
  await expect(page.getByText('Tu voto quedó registrado')).toBeVisible()
  expect(voted).toEqual({ optionIds: ['candidate-b', 'candidate-c'], confirmation: true })
})

test('el teléfono no muestra la declaración oficial aunque la última repetición esté cerrada sin publicar', async ({ page, api }) => {
  await page.addInitScript(() => localStorage.setItem('participantSessionToken', 'declared-session'))
  api.on(({ url }) => {
    if (url.pathname.endsWith('/participant/me')) {
      return { json: {
        assembly: { id: 'a', name: 'Asamblea prueba', status: 'in_progress' },
        participationStatus: 'recorded',
        openRound: { roundId: 'repeat', title: 'Presidencia, nueva votación', status: 'closed', format: 'single_choice', options: [] },
        officialResult: { elected: [{ optionId: 'e', label: 'Ezequiel' }], note: 'Electo por la Asamblea', declaredAt: '2026-10-14T10:00:00.000Z' },
        final: { elected: [{ optionId: 'e', label: 'Ezequiel' }], approved: null },
      } }
    }
  })

  await page.goto('/')
  await expect(page.locator('.phone-screen[data-round-status="closed"]')).toBeVisible()
  await expect(page.locator('.result-summary, .ranked-rows')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(/Ezequiel|Electo|resultado/i)
})

test('delegado conserva la sesión al recargar y no tiene botón Salir', async ({ page, api }) => {
  await page.addInitScript(() => {
    localStorage.setItem('participantSessionToken', 'synthetic-session-token')
    localStorage.setItem('participantAssemblyId', 'assembly-a')
  })
  api.on(({ request, url }) => {
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      return { json: { ...participantState(), assembly: { id: 'assembly-a', name: 'Asamblea A', status: 'in_progress' } } }
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/assemblies/CODE-A/public-state')) {
      return { json: { assembly: { id: 'assembly-a', name: 'Asamblea A' } } }
    }
  })

  await page.goto('/?join=CODE-A')
  await expect(page.getByRole('heading', { name: 'Elección de prueba' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Elección de prueba' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Salir' })).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBe('synthetic-session-token')
})

test('un 401 Unauthorized limpia la sesión y devuelve al ingreso del delegado', async ({ page, api }) => {
  await page.addInitScript(() => {
    localStorage.setItem('participantSessionToken', 'revoked-session-token')
    localStorage.setItem('participantAssemblyId', 'assembly-a')
  })
  api.on(({ url }) => {
    if (url.pathname.endsWith('/participant/me')) {
      return { status: 401, json: { message: 'Unauthorized' } }
    }
    return { status: 404, json: { message: 'Not found' } }
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Bienvenido' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Vuelve a ingresar mientras el ingreso a la asamblea esté abierto')
  expect(await page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBeNull()
  expect(await page.evaluate(() => localStorage.getItem('participantAssemblyId'))).toBeNull()
})

test('un error temporal al cargar la sesión conserva la credencial del delegado', async ({ page, api }) => {
  await page.addInitScript(() => localStorage.setItem('participantSessionToken', 'valid-session-token'))
  api.on(({ url }) => {
    if (url.pathname.endsWith('/participant/me')) {
      return { status: 503, json: { message: 'Servicio temporalmente no disponible' } }
    }
    return { status: 404, json: { message: 'Not found' } }
  })

  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Servicio temporalmente no disponible')
  expect(await page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBe('valid-session-token')
})

test('delegado debe confirmar el cambio cuando abre un QR de otra Asamblea', async ({ page, api }) => {
  await page.addInitScript(() => {
    localStorage.setItem('participantSessionToken', 'old-session-token')
    localStorage.setItem('participantAssemblyId', 'assembly-a')
  })
  api.on(({ request, url }) => {
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      const assemblyId = request.headers()['authorization'] === 'Bearer new-session-token' ? 'assembly-b' : 'assembly-a'
      return { json: { ...participantState(), assembly: { id: assemblyId, name: `Asamblea ${assemblyId === 'assembly-a' ? 'A' : 'B'}`, status: 'in_progress' } } }
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/assemblies/CODE-B/public-state')) {
      return { json: { assembly: { id: 'assembly-b', name: 'Asamblea B' } } }
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/assemblies/CODE-B/join')) {
      return { json: { participantSessionToken: 'new-session-token', ...participantState(), assembly: { id: 'assembly-b', name: 'Asamblea B', status: 'in_progress' } } }
    }
  })

  await page.goto('/?join=CODE-B')
  await expect(page.getByRole('alert')).toContainText('Este QR corresponde a otra Asamblea')
  await expect(page.getByRole('heading', { name: 'Elección de prueba' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Cerrar sesión y cambiar a la Asamblea del QR' }).click()
  await expect(page.getByRole('heading', { name: 'Bienvenido' })).toBeVisible()
  await expect(page.getByLabel('Código de sala')).toHaveValue('CODE-B')
  expect(await page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBeNull()

  await page.getByLabel('Nombre').fill('Nuevo')
  await page.getByLabel('Apellido').fill('Delegado')
  await page.getByRole('button', { name: 'Entrar a la sala' }).click()
  await expect(page.getByRole('heading', { name: 'Elección de prueba' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBe('new-session-token')
})

test('el teléfono pide esperar si alguien intenta ingresar durante una votación abierta', async ({ page, api }) => {
  api.on(({ request, url }) => {
    if (request.method() === 'POST' && url.pathname.endsWith('/assemblies/DEMO-ROOM/join')) {
      return { status: 409, json: { message: 'Hay una votación en curso. Espera a que termine para ingresar.' } }
    }
  })

  await page.goto('/')
  await page.getByLabel('Código de sala').fill('DEMO-ROOM')
  await page.getByLabel('Nombre').fill('Delegado')
  await page.getByLabel('Apellido').fill('Tardío')
  await page.getByRole('button', { name: 'Entrar a la sala' }).click()
  await expect(page.getByRole('alert')).toContainText('Hay una votación en curso. Espera a que termine para ingresar.')
  await expect(page.getByRole('heading', { name: 'Bienvenido' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBeNull()
})

test('un error de red conserva la selección y permite revisar y reintentar', async ({ page, api }) => {
  let voteCount = 0
  api.on(({ request, url }) => {
    if (request.method() === 'POST' && url.pathname.endsWith('/assemblies/DEMO-ROOM/join')) {
      return { json: { participantSessionToken: 'synthetic-participant-token', ...participantState() } }
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      return { json: participantState(voteCount ? 'recorded' : 'pending') }
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/participant/rounds/synthetic-round/vote')) {
      voteCount += 1
      if (voteCount === 1) {
        return { status: 503, json: { message: 'Conexión temporalmente no disponible' } }
      } else {
        return { status: 201, json: { status: 'recorded' } }
      }
    }
  })

  await page.goto('/')
  await page.getByLabel('Código de sala').fill('DEMO-ROOM')
  await page.getByLabel('Nombre').fill('Delegado')
  await page.getByLabel('Apellido').fill('Sintético')
  await page.getByRole('button', { name: 'Entrar a la sala' }).click()
  await page.getByLabel('Opción Beta (prueba)').check()
  await page.getByRole('button', { name: 'Revisar mi voto' }).click()
  await page.getByRole('button', { name: 'Confirmar voto' }).click()

  await expect(page.getByRole('alert')).toContainText('Conexión temporalmente no disponible')
  await expect(page.locator('.review-details').getByText('Opción Beta (prueba)', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Volver', exact: true }).click()
  await expect(page.getByLabel('Opción Beta (prueba)')).toBeChecked()
  await page.getByRole('button', { name: 'Revisar mi voto' }).click()
  await expect(page.locator('.review-details').getByText('Elección de prueba', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar voto' }).click()

  await expect(page.getByText('Tu voto quedó registrado')).toBeVisible()
  expect(voteCount).toBe(2)
})

test('delegado reconecta su sesión en un dispositivo nuevo con el QR de la mesa', async ({ page, api }) => {
  let resumeBody: unknown
  api.on(({ request, url }) => {
    if (request.method() === 'POST' && url.pathname.endsWith('/assemblies/resume')) {
      resumeBody = request.postDataJSON()
      return { json: { participantSessionToken: 'synthetic-resumed-token', ...participantState('recorded') } }
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      expect(request.headers().authorization).toBe('Bearer synthetic-resumed-token')
      return { json: participantState('recorded') }
    }
  })

  await page.goto('/?resume=synthetic-resume-code-0123456789')
  await expect(page.getByText('Tu sesión se reconectó en este dispositivo.')).toBeVisible()
  await expect(page.getByText('Tu voto quedó registrado')).toBeVisible()
  expect(resumeBody).toEqual({ resumeCode: 'synthetic-resume-code-0123456789' })
  await expect(page).toHaveURL(/\/$/)
  expect(await page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBe('synthetic-resumed-token')
})

test('un QR de reconexión escaneado durante una votación abierta pide volver a escanearlo al terminar', async ({ page, api }) => {
  api.on(({ request, url }) => {
    if (request.method() === 'POST' && url.pathname.endsWith('/assemblies/resume')) {
      return { status: 409, json: { message: 'Hay una votación en curso. Vuelve a escanear este código cuando termine.' } }
    }
  })

  await page.goto('/?resume=synthetic-resume-code-0123456789')
  await expect(page.getByRole('alert')).toContainText('Hay una votación en curso. Vuelve a escanear este código cuando termine.')
  await expect(page).toHaveURL(/\/$/)
  expect(await page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBeNull()
})

test('delegado con un QR ya rotado conserva su sesión sin errores', async ({ page, api }) => {
  let publicStateCalls = 0
  await page.addInitScript(() => {
    localStorage.setItem('participantSessionToken', 'synthetic-participant-token')
    localStorage.setItem('participantAssemblyId', 'synthetic-assembly')
  })
  api.on(({ url }) => {
    if (url.pathname.endsWith('/participant/me')) {
      return { json: participantState() }
    }
    if (url.pathname.endsWith('/assemblies/ROTATED-CODE/public-state')) {
      publicStateCalls += 1
      return { status: 404, json: { message: 'Asamblea no encontrada' } }
    }
  })

  await page.clock.install()
  await page.goto('/?join=ROTATED-CODE')
  await expect(page.getByRole('heading', { name: 'Elección de prueba' })).toBeVisible()
  await refreshByPolling(page)
  await refreshByPolling(page)
  await expect(page.getByRole('heading', { name: 'Elección de prueba' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(publicStateCalls).toBe(1)
})

test('el teléfono del delegado no ofrece Salir ni avisa al servidor', async ({ page, api }) => {
  await page.addInitScript(() => {
    localStorage.setItem('participantSessionToken', 'session-token')
    localStorage.setItem('participantAssemblyId', 'synthetic-assembly')
  })
  const leaveCalls: string[] = []
  api.on(({ request, url }) => {
    if (url.pathname.endsWith('/participant/leave')) {
      leaveCalls.push(request.method())
      return { status: 403, json: { message: 'Solo la mesa puede retirar a una persona de la sala' } }
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      return { json: participantState() }
    }
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Elección de prueba' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Salir' })).toHaveCount(0)
  await expect(page.getByText('Salir', { exact: true })).toHaveCount(0)
  expect(leaveCalls).toEqual([])
})

test('el teléfono de un delegado inhabilitado muestra «Voto inhabilitado» sin opciones ni botón', async ({ page, api }) => {
  await page.addInitScript(() => {
    localStorage.setItem('participantSessionToken', 'synthetic-session-token')
    localStorage.setItem('participantAssemblyId', 'synthetic-assembly')
  })
  let votingDisabled = true
  await page.clock.install()
  api.on(({ request, url }) => {
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      const state = participantState()
      return { json: { ...state, votingDisabled, currentRound: { ...state.currentRound, options: votingDisabled ? [] : state.currentRound.options } } }
    }
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Voto inhabilitado' })).toBeVisible()
  await expect(page.locator('.phone-status-disabled')).toContainText('VOTACIÓN ABIERTA')
  await expect(page.locator('.phone-status-disabled')).toContainText('Elección de prueba')
  await expect(page.getByRole('button', { name: 'Revisar mi voto' })).toHaveCount(0)
  await expect(page.getByRole('radio')).toHaveCount(0)

  votingDisabled = false
  await refreshByPolling(page)
  await expect(page.getByRole('button', { name: 'Revisar mi voto' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Voto inhabilitado' })).toHaveCount(0)
})

test('un delegado inhabilitado en un desempate ve el rótulo de votación abierta sin el número de votación', async ({ page, api }) => {
  await page.addInitScript(() => {
    localStorage.setItem('participantSessionToken', 'synthetic-session-token')
    localStorage.setItem('participantAssemblyId', 'synthetic-assembly')
  })
  api.on(({ request, url }) => {
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      const state = participantState()
      return { json: { ...state, votingDisabled: true, currentRound: { ...state.currentRound, voteNumber: 2, runoff: true, options: [] } } }
    }
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Voto inhabilitado' })).toBeVisible()
  await expect(page.locator('.phone-status-disabled')).toHaveText('Elección de prueba · VOTACIÓN ABIERTA')
})
