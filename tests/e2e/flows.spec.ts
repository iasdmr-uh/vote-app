import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

const api = '**/api/v1/**'

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

test('delegado ingresa con datos sintéticos y confirma su participación', async ({ page }) => {
  let voteCount = 0
  let releaseVote: (() => void) | undefined
  let markVoteStarted: (() => void) | undefined
  const votePending = new Promise<void>((resolve) => { releaseVote = resolve })
  const voteStarted = new Promise<void>((resolve) => { markVoteStarted = resolve })
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'POST' && url.pathname.endsWith('/assemblies/DEMO-ROOM/join')) {
      await route.fulfill({ json: { participantSessionToken: 'synthetic-participant-token', ...participantState() } })
      return
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ json: participantState(voteCount ? 'recorded' : 'pending') })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/participant/rounds/synthetic-round/vote')) {
      voteCount += 1
      markVoteStarted?.()
      await votePending
      await route.fulfill({ status: 201, json: { status: 'recorded' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/')
  await expect(page.getByRole('navigation')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Moderación' })).toHaveCount(0)
  await page.getByLabel('Código de sala').fill('DEMO-ROOM')
  await page.getByLabel('Nombre').fill('Delegado')
  await page.getByLabel('Apellido').fill('Sintético')
  await page.getByRole('button', { name: 'Unirme a la sala' }).click()
  await expect(page.getByText('Tu teléfono queda en espera.')).toBeVisible()

  await page.getByLabel('Opción Alfa (prueba)').check()
  await page.getByRole('button', { name: 'Revisar y confirmar voto' }).click()
  await expect(page.getByRole('heading', { name: 'Confirma tu selección' })).toBeFocused()
  await expect(page.locator('.review-details').getByText('Elección de prueba', { exact: true })).toBeVisible()
  await expect(page.locator('.review-details').getByText('Opción Alfa (prueba)', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Volver a la papeleta' }).click()
  await expect(page.getByLabel('Opción Alfa (prueba)')).toBeChecked()
  expect(voteCount).toBe(0)

  await page.getByLabel('Opción Beta (prueba)').check()
  await page.getByRole('button', { name: 'Revisar y confirmar voto' }).click()
  await expect(page.locator('.review-details').getByText('Opción Beta (prueba)', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar voto' }).click()
  await voteStarted
  await expect(page.getByRole('button', { name: 'Enviando voto…' })).toBeDisabled()
  expect(voteCount).toBe(1)
  releaseVote?.()

  await expect(page.getByText('Tu participación fue registrada. Gracias.')).toBeVisible()
  await page.getByRole('button', { name: 'Sincronizar estado' }).click()
  await expect(page.getByText('Tu participación está registrada')).toBeVisible()
  expect(voteCount).toBe(1)
})

test('delegado vota en comisión con selección múltiple limitada a los cupos', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('participantSessionToken', 'committee-session'))
  let recorded = false
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ json: {
        assembly: { id: 'committee-assembly', name: 'Asamblea prueba', status: 'in_progress' },
        participationStatus: recorded ? 'recorded' : 'pending',
        currentRound: { id: 'committee-round', title: 'Comisión de Finanzas', status: 'open', format: 'multiple_choice', category: 'committee', committeeType: 'finance', memberCount: 2, options: [
          { id: 'candidate-a', label: 'Ana (prueba)' }, { id: 'candidate-b', label: 'Beto (prueba)' }, { id: 'candidate-c', label: 'Celia (prueba)' },
        ] },
      } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/participant/rounds/committee-round/vote')) {
      expect(request.postDataJSON()).toEqual({ optionIds: ['candidate-a', 'candidate-b'], confirmation: true })
      recorded = true
      await route.fulfill({ status: 201, json: { status: 'recorded' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for secret committee ballot test' } })
  })

  await page.goto('/')
  await expect(page.getByLabel('Ana (prueba)')).toBeVisible()
  await page.getByLabel('Ana (prueba)').check()
  await page.getByLabel('Beto (prueba)').check()
  await page.getByLabel('Celia (prueba)').check()
  await expect(page.getByRole('alert')).toContainText('máximo 2 integrantes')
  await page.getByLabel('Celia (prueba)').uncheck()
  await page.getByRole('button', { name: 'Revisar y confirmar voto' }).click()
  await expect(page.locator('.review-details')).toContainText('Ana (prueba), Beto (prueba)')
  await page.getByRole('button', { name: 'Confirmar voto' }).click()
  await expect(page.getByText('Tu participación está registrada')).toBeVisible()
})

test('el voto nulo reemplaza a las candidaturas elegidas y no se combina con ellas', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('participantSessionToken', 'null-vote-session'))
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ json: {
        assembly: { id: 'committee-assembly', name: 'Asamblea prueba', status: 'in_progress' },
        participationStatus: 'pending',
        openRound: { roundId: 'repeat-round', title: 'Comisión — nueva votación', status: 'open', format: 'multiple_choice', category: 'committee', memberCount: 5, electionSeats: 1, options: [
          { optionId: 'candidate-a', label: 'Ana (prueba)' }, { optionId: 'candidate-b', label: 'Beto (prueba)' }, { optionId: 'null-option', label: 'Voto nulo', isNullVote: true },
        ] },
      } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/participant/rounds/repeat-round/vote')) {
      expect(request.postDataJSON()).toEqual({ optionIds: ['null-option'], confirmation: true })
      await route.fulfill({ status: 201, json: { status: 'recorded' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for null vote test' } })
  })

  await page.goto('/')
  await expect(page.getByText('Selecciona hasta 1 integrantes')).toBeVisible()
  await page.getByLabel('Ana (prueba)').check()
  await page.getByLabel('Beto (prueba)').check()
  await expect(page.getByRole('alert')).toContainText('máximo 1 integrantes', { useInnerText: true })
  await page.getByLabel('Voto nulo').check()
  await expect(page.getByLabel('Ana (prueba)')).not.toBeChecked()
  await page.getByRole('button', { name: 'Revisar y confirmar voto' }).click()
  await expect(page.locator('.review-details')).toContainText('Voto nulo')
  await expect(page.locator('.review-details')).not.toContainText('Ana')
  await page.getByRole('button', { name: 'Confirmar voto' }).click()
})

test('moderador anula una papeleta con motivo y prepara una nueva votación con los más votados', async ({ page }) => {
  let annulled = false
  let repeated: Record<string, unknown> | null = null
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress',
        rounds: [
          { id: 'first', title: 'Presidencia', status: 'published', options: [{ id: 'a', label: 'Alfa' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gama' }, { id: 'n', label: 'Voto nulo', isNullVote: true }],
            results: [{ optionId: 'b', label: 'Beta', count: 4 }, { optionId: 'a', label: 'Alfa', count: 4 }, { optionId: 'c', label: 'Gama', count: 1 }, { optionId: 'n', label: 'Voto nulo', count: 2, isNullVote: true }], officialResult: null },
          { id: 'second', title: 'Secretaría', status: annulled ? 'annulled' : 'open', annulReason: annulled ? 'Nombre mal escrito' : null, options: [{ id: 'x', label: 'Rosa' }, { id: 'n2', label: 'Voto nulo', isNullVote: true }], officialResult: null },
        ],
      } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/rounds/second/annul')) {
      expect(request.postDataJSON()).toEqual({ reason: 'Nombre mal escrito' })
      annulled = true
      await route.fulfill({ status: 201, json: { roundId: 'second', status: 'annulled' } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/rounds/first/repeat')) {
      repeated = request.postDataJSON()
      await route.fulfill({ status: 201, json: { id: 'third' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for annul test' } })
  })

  await page.goto('/moderator')
  const ranking = page.locator('.official-round').first().locator('.results-list')
  await expect(ranking).toContainText('1. Beta')
  await expect(ranking).toContainText('2. Alfa')
  await expect(ranking.locator('div').last()).toHaveText(/^\s*Voto nulo\s*2$/)

  await page.getByRole('button', { name: 'Anular votación' }).click()
  const annulDialog = page.getByRole('dialog')
  await expect(annulDialog).toContainText('se eliminarán y nunca se contarán')
  await expect(annulDialog.getByRole('button', { name: 'Anular papeleta' })).toBeDisabled()
  await annulDialog.getByLabel('Motivo (obligatorio, queda en el registro)').fill('Nombre mal escrito')
  await annulDialog.getByRole('button', { name: 'Anular papeleta' }).click()
  await expect(page.getByText('Papeleta anulada: Nombre mal escrito.')).toBeVisible()

  const repeatForm = page.locator('.official-round').first().getByRole('group', { name: 'Nueva votación con las opciones seleccionadas' })
  await expect(repeatForm.getByLabel('Voto nulo')).toHaveCount(0)
  await repeatForm.getByLabel('Beta').check()
  await repeatForm.getByLabel('Alfa').check()
  await page.locator('.official-round').first().getByRole('button', { name: 'Preparar nueva votación' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Preparar nueva votación' }).click()
  await expect(page.getByText('Acción registrada.')).toBeVisible()
  expect(repeated).toEqual({ optionIds: ['b', 'a'] })
})

test('el teléfono muestra la declaración oficial aunque la última repetición esté cerrada sin publicar', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('participantSessionToken', 'declared-session'))
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ json: {
        assembly: { id: 'a', name: 'Asamblea prueba', status: 'in_progress' },
        participationStatus: 'recorded',
        openRound: { roundId: 'repeat', title: 'Presidencia — nueva votación', status: 'closed', format: 'single_choice', options: [] },
        officialResult: { elected: [{ optionId: 'm', label: 'María López' }], note: 'Electa por la Asamblea', declaredAt: '2026-10-14T10:00:00.000Z' },
      } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route' } })
  })

  await page.goto('/')
  await expect(page.getByText('RESULTADO OFICIAL DE LA MESA')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'María López' })).toBeVisible()
  await expect(page.getByText('RESULTADOS PUBLICADOS')).toHaveCount(0)
})

test('una comisión anulada en etapa de apoyos muestra el aviso y no el formulario', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('participantSessionToken', 'annulled-committee-session'))
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ json: {
        assembly: { id: 'a', name: 'Asamblea prueba', status: 'in_progress' },
        participationStatus: 'pending',
        openRound: { roundId: 'nomination', title: 'Comisión de Nombramiento', status: 'annulled', category: 'committee', committeeType: 'nomination', committeeStage: 'support', options: [] },
      } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route' } })
  })

  await page.goto('/')
  await expect(page.getByText('La mesa anuló esta votación')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Apoyar propuestas' })).toHaveCount(0)
})

test('delegado registra una propuesta y apoyo sin mostrar identidades de apoyo', async ({ page }) => {
  let stage: 'proposals' | 'support' = 'proposals'
  let supported = false
  const stateForDelegate = () => ({
    assembly: { id: 'committee-assembly', name: 'Asamblea prueba', status: 'in_progress' },
    participationStatus: 'pending',
    currentRound: { id: 'nomination-round', title: 'Comisión de Nombramiento', status: 'draft', format: 'multiple_choice', category: 'committee', committeeType: 'nomination', committeeStage: stage, options: [] },
    committeeCandidates: [{ id: 'candidate-1', firstName: 'Ana', lastName: 'Delegada' }],
    committeeProposals: [{ id: 'proposal-1', candidateName: 'Ana Delegada', supportCount: supported ? 1 : 0, supportedByMe: supported }],
  })
  await page.addInitScript(() => localStorage.setItem('participantSessionToken', 'committee-session'))
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ json: stateForDelegate() }); return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/committee/proposals')) {
      expect(request.postDataJSON()).toEqual({ candidateParticipantId: 'candidate-1' })
      await route.fulfill({ status: 201, json: { id: 'proposal-1' } }); return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/committee/proposals/proposal-1/support')) {
      supported = true
      await route.fulfill({ status: 201, json: { status: 'supported' } }); return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for committee proposal test' } })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Registrar propuesta' })).toBeVisible()
  await page.getByLabel('Candidatura').selectOption('candidate-1')
  await page.getByRole('button', { name: 'Registrar propuesta' }).click()
  stage = 'support'
  await page.getByRole('button', { name: 'Sincronizar estado' }).click()
  await expect(page.getByRole('heading', { name: 'Apoyar propuestas' })).toBeVisible()
  await expect(page.getByText('0 apoyos')).toBeVisible()
  await page.getByRole('button', { name: 'Apoyar' }).click()
  await expect(page.getByRole('button', { name: 'Apoyo registrado' })).toBeDisabled()
  await expect(page.getByText(/Solo se muestra el total, no quién apoyó/)).toBeVisible()
})

test('delegado conserva la sesión al recargar y puede salir limpiando el estado local', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('participantSessionToken', 'synthetic-session-token')
    localStorage.setItem('participantAssemblyId', 'assembly-a')
  })
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ json: { ...participantState(), assembly: { id: 'assembly-a', name: 'Asamblea A', status: 'in_progress' } } })
      return
    }
    if (route.request().method() === 'GET' && url.pathname.endsWith('/assemblies/CODE-A/public-state')) {
      await route.fulfill({ json: { assembly: { id: 'assembly-a', name: 'Asamblea A' } } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for participant session test' } })
  })

  await page.goto('/?join=CODE-A')
  await expect(page.getByText('Asamblea A')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Asamblea A')).toBeVisible()
  await page.getByRole('button', { name: 'Salir / cambiar de participante' }).click()
  await expect(page.getByRole('heading', { name: 'Bienvenido' })).toBeVisible()
  await expect(page.getByLabel('Código de sala')).toHaveValue('CODE-A')
  expect(await page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBeNull()
  expect(await page.evaluate(() => localStorage.getItem('participantAssemblyId'))).toBeNull()
})

test('un 401 Unauthorized limpia la sesión y devuelve al ingreso del delegado', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('participantSessionToken', 'revoked-session-token')
    localStorage.setItem('participantAssemblyId', 'assembly-a')
  })
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ status: 401, json: { message: 'Unauthorized' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'Not found' } })
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Bienvenido' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Vuelve a ingresar mientras el ingreso a la asamblea esté abierto')
  expect(await page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBeNull()
  expect(await page.evaluate(() => localStorage.getItem('participantAssemblyId'))).toBeNull()
})

test('un error temporal al cargar la sesión conserva la credencial del delegado', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('participantSessionToken', 'valid-session-token'))
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ status: 503, json: { message: 'Servicio temporalmente no disponible' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'Not found' } })
  })

  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Servicio temporalmente no disponible')
  expect(await page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBe('valid-session-token')
})

test('delegado debe confirmar el cambio cuando abre un QR de otra Asamblea', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('participantSessionToken', 'old-session-token')
    localStorage.setItem('participantAssemblyId', 'assembly-a')
  })
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      const assemblyId = request.headers()['authorization'] === 'Bearer new-session-token' ? 'assembly-b' : 'assembly-a'
      await route.fulfill({ json: { ...participantState(), assembly: { id: assemblyId, name: `Asamblea ${assemblyId === 'assembly-a' ? 'A' : 'B'}`, status: 'in_progress' } } })
      return
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/assemblies/CODE-B/public-state')) {
      await route.fulfill({ json: { assembly: { id: 'assembly-b', name: 'Asamblea B' } } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/assemblies/CODE-B/join')) {
      await route.fulfill({ json: { participantSessionToken: 'new-session-token', ...participantState(), assembly: { id: 'assembly-b', name: 'Asamblea B', status: 'in_progress' } } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for QR switch test' } })
  })

  await page.goto('/?join=CODE-B')
  await expect(page.getByRole('alert')).toContainText('Este QR corresponde a otra Asamblea')
  await expect(page.getByText('Asamblea A')).toHaveCount(0)
  await page.getByRole('button', { name: 'Cerrar sesión y cambiar a la Asamblea del QR' }).click()
  await expect(page.getByRole('heading', { name: 'Bienvenido' })).toBeVisible()
  await expect(page.getByLabel('Código de sala')).toHaveValue('CODE-B')
  expect(await page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBeNull()

  await page.getByLabel('Nombre').fill('Nuevo')
  await page.getByLabel('Apellido').fill('Delegado')
  await page.getByRole('button', { name: 'Unirme a la sala' }).click()
  await expect(page.getByText('Te uniste a la sala. Tu teléfono queda en espera.')).toBeVisible()
  await expect(page.getByText('Asamblea B')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBe('new-session-token')
})

test('un error de red conserva la selección y permite revisar y reintentar', async ({ page }) => {
  let voteCount = 0
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'POST' && url.pathname.endsWith('/assemblies/DEMO-ROOM/join')) {
      await route.fulfill({ json: { participantSessionToken: 'synthetic-participant-token', ...participantState() } })
      return
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ json: participantState(voteCount ? 'recorded' : 'pending') })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/participant/rounds/synthetic-round/vote')) {
      voteCount += 1
      if (voteCount === 1) {
        await route.fulfill({ status: 503, json: { message: 'Conexión temporalmente no disponible' } })
      } else {
        await route.fulfill({ status: 201, json: { status: 'recorded' } })
      }
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/')
  await page.getByLabel('Código de sala').fill('DEMO-ROOM')
  await page.getByLabel('Nombre').fill('Delegado')
  await page.getByLabel('Apellido').fill('Sintético')
  await page.getByRole('button', { name: 'Unirme a la sala' }).click()
  await page.getByLabel('Opción Beta (prueba)').check()
  await page.getByRole('button', { name: 'Revisar y confirmar voto' }).click()
  await page.getByRole('button', { name: 'Confirmar voto' }).click()

  await expect(page.getByRole('alert')).toContainText('Conexión temporalmente no disponible')
  await expect(page.locator('.review-details').getByText('Opción Beta (prueba)', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Volver a la papeleta' }).click()
  await expect(page.getByLabel('Opción Beta (prueba)')).toBeChecked()
  await page.getByRole('button', { name: 'Revisar y confirmar voto' }).click()
  await expect(page.locator('.review-details').getByText('Elección de prueba', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar voto' }).click()

  await expect(page.getByText('Tu participación fue registrada. Gracias.')).toBeVisible()
  expect(voteCount).toBe(2)
})

test('moderador ejecuta el cierre de una papeleta mediante acción confirmada', async ({ page }) => {
  let closed = false
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: {
        assembly: { id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress', lobbyStatus: 'lobby_closed' },
        participants: [{ id: 'synthetic-person', firstName: 'Delegado', lastName: 'Sintético' }],
        participantCount: 1,
        eligibleCount: 1,
        currentRound: { id: 'synthetic-round', title: 'Elección de prueba', status: closed ? 'closed' : 'open', options: [{ id: 'a', label: 'Opción Alfa (prueba)' }, { id: 'b', label: 'Opción Beta (prueba)' }] },
      } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/rounds/synthetic-round/close')) {
      closed = true
      await route.fulfill({ status: 201, json: { status: 'closed' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/moderator')
  await expect(page.getByRole('heading', { name: 'Control de Asamblea' })).toBeVisible()
  await expect(page.getByText('Delegado Sintético')).toBeVisible()
  await page.getByRole('button', { name: 'Cerrar votación' }).click()
  await expect(page.getByRole('dialog')).toContainText('Los resultados seguirán ocultos')
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar votación' }).click()
  await expect(page.getByText('Acción registrada.')).toBeVisible()
  await page.getByRole('button', { name: 'Sincronizar estado' }).click()
  await expect(page.getByText('La papeleta está cerrada.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publicar resultados' })).toBeVisible()
})

test('moderador declara el resultado oficial por separado y lo publica explícitamente', async ({ page }) => {
  let officialResult: Record<string, unknown> | null = null
  let publishCount = 0
  let withdrawCount = 0
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress',
        rounds: [{
          id: 'synthetic-round', title: 'Elección de prueba', status: 'published',
          options: [{ id: 'a', label: 'Candidata Alfa' }, { id: 'b', label: 'Candidato Beta' }],
          results: [{ optionId: 'a', label: 'Candidata Alfa', count: 2 }, { optionId: 'b', label: 'Candidato Beta', count: 1 }],
          officialResult,
        }],
      } })
      return
    }
    if (request.method() === 'PUT' && url.pathname.endsWith('/moderator/rounds/synthetic-round/official-result')) {
      expect(request.postDataJSON()).toEqual({ optionIds: ['b'], note: 'Decisión de la Asamblea' })
      officialResult = {
        elected: [{ optionId: 'b', label: 'Candidato Beta' }], note: 'Decisión de la Asamblea',
        declaredBy: 'shared_moderator_credential', declaredAt: '2026-10-13T10:00:00.000Z', publishedAt: null,
      }
      await route.fulfill({ status: 200, json: officialResult })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/rounds/synthetic-round/official-result/publish')) {
      publishCount += 1
      officialResult = { ...officialResult, publishedAt: '2026-10-13T10:05:00.000Z' }
      await route.fulfill({ status: 200, json: officialResult })
      return
    }
    if (request.method() === 'DELETE' && url.pathname.endsWith('/moderator/rounds/synthetic-round/official-result')) {
      withdrawCount += 1
      officialResult = null
      await route.fulfill({ status: 200, json: { roundId: 'synthetic-round', withdrawn: true } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for official result test' } })
  })

  await page.goto('/moderator')
  await expect(page.getByRole('heading', { name: 'Declaraciones oficiales de la mesa' })).toBeVisible()
  await expect(page.getByText('La mesa aún no ha registrado una declaración oficial.')).toBeVisible()
  await page.getByRole('group', { name: 'Persona(s) declarada(s) electa(s)' }).getByLabel('Candidato Beta').check()
  await page.getByLabel('Observación o motivo (opcional)').fill('Decisión de la Asamblea')
  await page.getByRole('button', { name: 'Registrar resultado oficial' }).click()
  await expect(page.getByRole('dialog')).toContainText('¿Guardar los cambios?')
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(page.getByText('Declaración interna')).toBeVisible()
  await expect(page.getByText('Decisión de la Asamblea')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publicar declaración' })).toBeVisible()
  expect(publishCount).toBe(0)

  await page.getByRole('button', { name: 'Publicar declaración' }).click()
  await expect(page.getByRole('dialog')).toContainText('¿Publicar resultados?')
  await page.getByRole('dialog').getByRole('button', { name: 'Publicar resultados' }).click()
  await expect(page.getByText('Visible al público')).toBeVisible()
  expect(publishCount).toBe(1)

  await page.getByRole('button', { name: 'Retirar declaración' }).click()
  await expect(page.getByRole('dialog')).toContainText('¿Retirar la declaración oficial?')
  await page.getByRole('dialog').getByRole('button', { name: 'Retirar declaración' }).click()
  await expect(page.getByText('La mesa aún no ha registrado una declaración oficial.')).toBeVisible()
  expect(withdrawCount).toBe(1)
})

test('moderador finaliza la Asamblea explícitamente y el panel queda en modo de consulta', async ({ page }) => {
  let roundClosed = false
  let assemblyCompleted = false
  const completedAt = '2026-10-02T18:30:00.000Z'
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: {
        id: 'synthetic-assembly',
        name: 'Asamblea de prueba',
        status: assemblyCompleted ? 'completed' : 'in_progress',
        completedAt: assemblyCompleted ? completedAt : null,
        participants: [{ id: 'synthetic-person', firstName: 'Delegado', lastName: 'Sintético' }],
        participantCount: 1,
        eligibleCount: 1,
        rounds: [{ id: 'synthetic-round', title: 'Elección de prueba', status: roundClosed ? 'closed' : 'open', options: [{ id: 'a', label: 'Opción Alfa (prueba)' }] }],
      } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/rounds/synthetic-round/close')) {
      roundClosed = true
      await route.fulfill({ status: 201, json: { status: 'closed' } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly/complete')) {
      expect(request.postDataJSON()).toEqual({ confirmation: true })
      assemblyCompleted = true
      await route.fulfill({ status: 201, json: { status: 'completed', completedAt } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/moderator')
  await expect(page.getByRole('heading', { name: 'Control de Asamblea' })).toBeVisible()
  await expect(page.getByText('Cierra la papeleta abierta antes de finalizar la Asamblea.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Finalizar Asamblea' })).toBeDisabled()

  await page.getByRole('button', { name: 'Cerrar votación' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar votación' }).click()
  await expect(page.getByText('Acción registrada.')).toBeVisible()
  await page.getByRole('button', { name: 'Sincronizar estado' }).click()
  await expect(page.getByRole('button', { name: 'Finalizar Asamblea' })).toBeEnabled()

  await page.getByRole('button', { name: 'Finalizar Asamblea' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Finalizar Asamblea' }).click()
  await expect(page.getByText('La Asamblea quedó finalizada. Imprime o guarda el acta antes de borrar los datos.')).toBeVisible()
  await expect(page.getByText('Asamblea finalizada', { exact: true })).toBeVisible()
  await expect(page.getByText(/Se registró/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Finalizar Asamblea' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Preparar papeleta' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Publicar resultados' })).toHaveCount(0)
})

test('después de finalizar, la mesa imprime el acta, descarga el CSV y borra los datos', async ({ page }) => {
  let deleted = false
  let deleteBody: unknown
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
    // The print dialog would block the test; the acta stays rendered as it does while the dialog is open.
    window.print = () => { (window as unknown as { printed: number }).printed = ((window as unknown as { printed?: number }).printed ?? 0) + 1 }
  })
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly') && !deleted) {
      await route.fulfill({ json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'completed', completedAt: '2026-10-02T18:30:00.000Z',
        participants: [{ id: 'p1', firstName: 'Delegado', lastName: 'Sintético', assemblyRole: 'Delegado' }], participantCount: 1,
        rounds: [
          { id: 'r1', title: 'Presidencia', status: 'published', participationCount: 3, options: [{ id: 'a', label: 'Rosa' }, { id: 'b', label: 'Pedro' }, { id: 'n', label: 'Voto nulo', isNullVote: true }],
            results: [{ optionId: 'a', label: 'Rosa', count: 2 }, { optionId: 'b', label: 'Pedro', count: 0 }, { optionId: 'n', label: 'Voto nulo', count: 1, isNullVote: true }],
            officialResult: { elected: [{ optionId: 'a', label: 'Rosa' }], note: null, declaredBy: 'shared_moderator_credential', declaredAt: '2026-10-02T18:00:00.000Z', publishedAt: '2026-10-02T18:01:00.000Z' } },
          { id: 'r2', title: 'Secretaría', status: 'annulled', annulReason: 'Nombre mal escrito', participationCount: 1, options: [{ id: 'c', label: 'Juan' }] },
        ],
      } })
      return
    }
    if (request.method() === 'DELETE' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      deleteBody = request.postDataJSON()
      deleted = true
      await route.fulfill({ json: { assemblyId: 'synthetic-assembly', deleted: true, vacuumed: true } })
      return
    }
    if (url.pathname.endsWith('/moderator/session')) { await route.fulfill({ json: { authenticated: true } }); return }
    if (url.pathname.endsWith('/moderator/assemblies/active')) { await route.fulfill({ json: { assembly: null } }); return }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/moderator')
  await expect(page.getByRole('heading', { name: 'Acta y borrado de datos' })).toBeVisible()

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar CSV' }).click()
  const csv = await readFile(await (await download).path(), 'utf8')
  expect((await download).suggestedFilename()).toBe('acta-asamblea-de-prueba.csv')
  expect(csv).toContain('Presidencia,publicada,3,1,Rosa,2,sí')
  expect(csv).toContain('Presidencia,publicada,3,,Voto nulo,1,')
  expect(csv).toContain('Secretaría,anulada: Nombre mal escrito,1')

  const acta = page.locator('.acta-print')
  await expect(acta).toHaveCount(0)
  await page.getByRole('button', { name: 'Imprimir o guardar PDF' }).click()
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1)
  await expect(acta).toBeHidden()
  await page.emulateMedia({ media: 'print' })
  await expect(acta).toBeVisible()
  await expect(acta.getByRole('heading', { name: 'Acta de resultados' })).toBeVisible()
  await expect(acta.getByText('Declarado electo por la mesa:')).toBeVisible()
  await expect(acta.getByText('Anulada por la mesa: Nombre mal escrito. Sus votos no se contaron.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Acta y borrado de datos' })).toBeHidden()
  await page.emulateMedia({ media: 'screen' })
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await expect(acta).toHaveCount(0)

  await page.getByRole('button', { name: 'Borrar datos de la Asamblea' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Borrar datos' })).toBeDisabled()
  await dialog.getByLabel('Escribe BORRAR para confirmar').fill('borrar')
  await expect(dialog.getByRole('button', { name: 'Borrar datos' })).toBeDisabled()
  await dialog.getByLabel('Escribe BORRAR para confirmar').fill('BORRAR')
  await dialog.getByRole('button', { name: 'Borrar datos' }).click()
  await expect(page.getByText('Se borraron los datos de la Asamblea. Al apagar, sigue el cierre de la guía del técnico.')).toBeVisible()
  expect(deleteBody).toEqual({ confirmation: true })
  await expect(page.getByRole('button', { name: 'Crear Asamblea' })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('assemblyId'))).toBeNull()
})

test('el proyector muestra la dirección de la red que da el servidor, no la de la laptop', async ({ page }) => {
  const joinUrl = 'http://192.168.1.50/?join=DEMO-ROOM'
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
      await route.fulfill({ json: { assembly: { name: 'Asamblea de prueba', status: 'lobby_open' }, joinUrl, participantCount: 0, participants: [] } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/projector?code=DEMO-ROOM')
  await expect(page.locator('img.projector-qr')).toBeVisible()
  await expect(page.getByText('Sin QR: abre 192.168.1.50 en el navegador e ingresa el código.')).toBeVisible()
})

test('delegado y proyector ven que la Asamblea concluyó y conservan resultados publicados', async ({ page }) => {
  const completedAt = '2026-10-02T18:30:00.000Z'
  await page.addInitScript(() => {
    localStorage.setItem('participantSessionToken', 'synthetic-participant-token')
    localStorage.setItem('assemblyJoinCode', 'DEMO-ROOM')
  })
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ json: {
        assemblyStatus: 'completed',
        assemblyCompletedAt: completedAt,
        lobbyStatus: 'closed',
        openRound: { roundId: 'synthetic-round', title: 'Elección publicada', status: 'published', options: [] },
        participationStatus: 'recorded',
        results: [{ label: 'Opción declarada', count: 1 }],
      } })
      return
    }
    if (url.pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
      await route.fulfill({ json: {
        assembly: { name: 'Asamblea de prueba', status: 'completed', completedAt, lobbyStatus: 'lobby_closed' },
        participantCount: 1,
        currentRound: { id: 'synthetic-round', title: 'Elección publicada', status: 'published' },
        results: [{ label: 'Opción declarada', count: 1 }],
      } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Asamblea finalizada' })).toBeVisible()
  await expect(page.getByText('La sesión concluyó')).toBeVisible()
  await expect(page.getByText('Tu participación está registrada')).toBeVisible()

  await page.goto('/projector?code=DEMO-ROOM')
  await expect(page.getByRole('heading', { name: 'Asamblea finalizada' })).toBeVisible()
  await expect(page.getByText('Opción declarada')).toBeVisible()
})

test('moderador con credencial caducada vuelve a mostrar acceso y elimina el token guardado', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'stale-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  await page.route(api, async (route) => {
    await route.fulfill({ status: 401, json: { message: 'Unauthorized' } })
  })

  await page.goto('/moderator')
  await expect(page.getByLabel('Credencial de moderación')).toBeVisible()
  await expect(page.getByText('La credencial guardada ya no es válida. Ingresa de nuevo la clave de moderación.')).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('moderatorToken'))).toBeNull()
})

test('abrir /moderator sin credencial solo muestra el formulario de acceso', async ({ page }) => {
  let moderatorRequests = 0
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.includes('/moderator/')) moderatorRequests += 1
    await route.fulfill({ status: 401, json: { message: 'Unauthorized' } })
  })

  await page.goto('/moderator')
  await expect(page.getByRole('heading', { name: 'Moderación' })).toBeVisible()
  await expect(page.getByLabel('Credencial de moderación')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Control de Asamblea' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Crear Asamblea y generar código' })).toHaveCount(0)
  expect(moderatorRequests).toBe(0)
})

test('moderador valida la credencial antes de mostrar el panel cuando aún no hay Asamblea', async ({ page }) => {
  let authorization = ''
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/session')) {
      authorization = request.headers().authorization || ''
      await route.fulfill({ json: { authenticated: true } })
      return
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/active')) {
      await route.fulfill({ json: { assembly: null } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/moderator')
  await page.getByLabel('Credencial de moderación').fill('synthetic-moderator-token')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByRole('heading', { name: 'Control de Asamblea' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Crear Asamblea' })).toBeVisible()
  expect(authorization).toBe('Bearer synthetic-moderator-token')
})

test('moderador recupera la Asamblea activa en una pestaña nueva y puede reabrir el ingreso', async ({ page }) => {
  let lobbyPatch: unknown
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith('/moderator/session')) {
      await route.fulfill({ json: { authenticated: true } })
      return
    }
    if (url.pathname.endsWith('/moderator/assemblies/active')) {
      await route.fulfill({ json: { assembly: { id: 'synthetic-assembly', name: 'Asamblea recuperada', status: 'lobby_closed' } } })
      return
    }
    if (request.method() === 'PATCH' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly/lobby')) {
      lobbyPatch = request.postDataJSON()
      await route.fulfill({ json: { id: 'synthetic-assembly', status: 'lobby_open' } })
      return
    }
    if (url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: {
        id: 'synthetic-assembly', name: 'Asamblea recuperada', status: 'lobby_closed', completedAt: null,
        participants: [{ id: 'synthetic-person', firstName: 'Delegado', lastName: 'Sintético', status: 'active', assemblyRole: null, committeeEligible: false }],
        participantCount: 1, rounds: [],
      } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/moderator')
  await page.getByLabel('Credencial de moderación').fill('synthetic-moderator-token')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByText('Se recuperó la Asamblea activa: Asamblea recuperada.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Crear Asamblea' })).toHaveCount(0)
  await expect(page.getByText('El código de ingreso no está disponible en este dispositivo.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reconectar dispositivo' })).toBeVisible()
  await page.getByRole('button', { name: 'Reabrir ingreso' }).click()
  await expect(page.getByRole('heading', { name: '¿Reabrir el ingreso?' })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Reabrir ingreso' }).click()
  await expect.poll(() => lobbyPatch).toEqual({ status: 'lobby_open' })
})

test('error temporal al validar conserva la credencial guardada y permite reintentar', async ({ page }) => {
  let validationAttempts = 0
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'saved-moderator-token')
  })
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/moderator/session')) {
      validationAttempts += 1
      if (validationAttempts === 1) {
        await route.fulfill({ status: 503, json: { message: 'Servicio temporalmente no disponible' } })
      } else {
        await route.fulfill({ json: { authenticated: true } })
      }
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/moderator')
  await expect(page.getByRole('heading', { name: 'No se pudo validar el acceso' })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('moderatorToken'))).toBe('saved-moderator-token')
  await page.getByRole('button', { name: 'Reintentar validación' }).click()
  await expect(page.getByRole('heading', { name: 'Control de Asamblea' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(validationAttempts).toBe(2)
  expect(await page.evaluate(() => sessionStorage.getItem('moderatorToken'))).toBe('saved-moderator-token')
})

test('proyector presenta estado y progreso sintético sin nombres ni opciones', async ({ page }) => {
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
      await route.fulfill({ json: {
        assembly: { name: 'Asamblea de prueba', status: 'in_progress', lobbyStatus: 'lobby_closed' },
        participantCount: 42,
        currentRound: { id: 'synthetic-round', title: 'Elección de prueba', status: 'open' },
      } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/projector?code=DEMO-ROOM')
  await expect(page.getByRole('heading', { name: 'Elección de prueba' })).toBeVisible()
  await expect(page.getByText('Votación abierta')).toBeVisible()
  await expect(page.getByText('de 42 votos recibidos')).toBeVisible()
  await expect(page.getByText('Delegado Sintético')).toHaveCount(0)
  await expect(page.getByText('Opción Alfa (prueba)')).toHaveCount(0)
})

test('delegado reconecta su sesión en un dispositivo nuevo con el QR de la mesa', async ({ page }) => {
  let resumeBody: unknown
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'POST' && url.pathname.endsWith('/assemblies/resume')) {
      resumeBody = request.postDataJSON()
      await route.fulfill({ json: { participantSessionToken: 'synthetic-resumed-token', ...participantState('recorded') } })
      return
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      expect(request.headers().authorization).toBe('Bearer synthetic-resumed-token')
      await route.fulfill({ json: participantState('recorded') })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/?resume=synthetic-resume-code-0123456789')
  await expect(page.getByText('Tu sesión se reconectó en este dispositivo.')).toBeVisible()
  await expect(page.getByText('Tu participación está registrada')).toBeVisible()
  expect(resumeBody).toEqual({ resumeCode: 'synthetic-resume-code-0123456789' })
  await expect(page).toHaveURL(/\/$/)
  expect(await page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBe('synthetic-resumed-token')
})

test('delegado con un QR ya rotado conserva su sesión sin errores', async ({ page }) => {
  let publicStateCalls = 0
  await page.addInitScript(() => {
    localStorage.setItem('participantSessionToken', 'synthetic-participant-token')
    localStorage.setItem('participantAssemblyId', 'synthetic-assembly')
  })
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ json: participantState() })
      return
    }
    if (url.pathname.endsWith('/assemblies/ROTATED-CODE/public-state')) {
      publicStateCalls += 1
      await route.fulfill({ status: 404, json: { message: 'Asamblea no encontrada' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/?join=ROTATED-CODE')
  await expect(page.getByRole('heading', { name: 'Elección de prueba' })).toBeVisible()
  await page.getByRole('button', { name: 'Sincronizar estado' }).click()
  await page.getByRole('button', { name: 'Sincronizar estado' }).click()
  await expect(page.getByRole('heading', { name: 'Elección de prueba' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(publicStateCalls).toBe(1)
})

test('moderador ve la limpieza pendiente aunque se actualice el estado y puede reintentarla', async ({ page }) => {
  let cleanupDone = false
  let cleanupRequests = 0
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly/secrecy-cleanup')) {
      cleanupRequests += 1
      cleanupDone = true
      await route.fulfill({ json: { assemblyId: 'synthetic-assembly', secrecyCleanupPending: false } })
      return
    }
    if (url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress', completedAt: null, participants: [], participantCount: 0,
        rounds: [{ id: 'synthetic-round', title: 'Presidencia', status: 'closed', options: [{ id: 'a', label: 'A' }], participationCount: 1, secrecyCleanupPending: !cleanupDone }],
      } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/moderator')
  const panel = page.getByRole('alert').filter({ hasText: 'Limpieza del secreto del voto pendiente' })
  await expect(panel).toBeVisible()
  await page.getByRole('button', { name: 'Sincronizar estado' }).click()
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'Reintentar limpieza' }).click()
  await expect(page.getByText('Limpieza completada. Ya se pueden publicar resultados.')).toBeVisible()
  await expect(panel).toHaveCount(0)
  expect(cleanupRequests).toBe(1)
})
