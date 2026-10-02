import { expect, test } from '@playwright/test'

const moderatorToken = process.env.MODERATOR_ACCESS_TOKEN!
const api = 'http://127.0.0.1:3300/api/v1'

test('flujo real de asamblea: ingreso, voto único, cierre y publicación', async ({ browser, request }) => {
  const context = await browser.newContext()
  const moderator = await context.newPage()
  moderator.on('dialog', (dialog) => dialog.accept())

  await moderator.goto('/moderator')
  await moderator.getByLabel('Credencial de moderación').fill(moderatorToken)
  await moderator.getByRole('button', { name: 'Continuar' }).click()
  await expect(moderator.getByRole('heading', { name: 'Control de Asamblea' })).toBeVisible()
  await moderator.getByLabel('Nombre', { exact: true }).fill('Asamblea E2E sintética')
  await moderator.getByRole('button', { name: 'Crear Asamblea y generar código' }).click()

  const creationNotice = moderator.getByRole('status')
  await expect(creationNotice).toContainText('Código de ingreso:')
  const joinCode = (await creationNotice.innerText()).match(/Código de ingreso:\s*(\S+)/)?.[1]
  expect(joinCode, 'the real API should return the generated join code to the moderator view').toBeTruthy()
  const assemblyId = await moderator.evaluate(() => sessionStorage.getItem('assemblyId'))
  expect(assemblyId).toBeTruthy()

  const delegate = await context.newPage()
  delegate.on('dialog', (dialog) => dialog.accept())
  await delegate.goto(`/?join=${encodeURIComponent(joinCode!)}`)
  await delegate.getByLabel('Nombre').fill('Delegado')
  await delegate.getByLabel('Apellido').fill('E2E Sintético')
  await delegate.getByRole('button', { name: 'Unirme a la sala' }).click()
  await expect(delegate.getByText('Tu teléfono queda en espera.')).toBeVisible()

  await moderator.getByRole('button', { name: 'Cerrar ingreso' }).click()
  await expect(moderator.getByText('El ingreso está cerrado.')).toBeVisible()
  await moderator.getByLabel('Título o cargo').fill('Votación E2E')
  await moderator.getByLabel(/Opciones o candidatos/).fill('Opción Ámbar\nOpción Índigo')
  await moderator.getByRole('button', { name: 'Preparar papeleta' }).click()
  await expect(moderator.getByText('Papeleta preparada. Revisa las opciones antes de abrir.')).toBeVisible()
  await moderator.getByRole('button', { name: 'Abrir papeleta' }).click()
  await expect(moderator.getByRole('button', { name: 'Cerrar papeleta' })).toBeVisible()

  await expect(delegate.getByRole('heading', { name: 'Votación E2E' })).toBeVisible()
  await delegate.getByLabel('Opción Ámbar').check()
  await delegate.getByRole('button', { name: 'Revisar y confirmar voto' }).click()
  await expect(delegate.getByText('Tu participación fue registrada. Gracias.')).toBeVisible()
  await expect(delegate.getByText('Tu participación está registrada')).toBeVisible()

  const moderatorState = await request.get(`${api}/moderator/assemblies/${assemblyId}`, {
    headers: { Authorization: `Bearer ${moderatorToken}` },
  })
  expect(moderatorState.ok()).toBeTruthy()
  const persistedState = await moderatorState.json()
  expect(persistedState.rounds[0].participationCount).toBe(1)
  const participantToken = await delegate.evaluate(() => localStorage.getItem('participantSessionToken'))
  expect(participantToken).toBeTruthy()
  const duplicateVote = await request.post(`${api}/participant/rounds/${persistedState.rounds[0].id}/vote`, {
    headers: { Authorization: `Bearer ${participantToken}` },
    data: { optionId: persistedState.rounds[0].options[0].id, confirmation: true },
  })
  expect(duplicateVote.status()).toBe(409)
  const afterDuplicate = await request.get(`${api}/moderator/assemblies/${assemblyId}`, {
    headers: { Authorization: `Bearer ${moderatorToken}` },
  })
  expect((await afterDuplicate.json()).rounds[0].participationCount).toBe(1)

  await moderator.getByRole('button', { name: 'Cerrar papeleta' }).click()
  await expect(moderator.getByText('La papeleta está cerrada. Los resultados siguen ocultos hasta publicarlos.')).toBeVisible()
  const hiddenResults = await request.get(`${api}/assemblies/${joinCode}/public-state`)
  expect(hiddenResults.ok()).toBeTruthy()
  expect(await hiddenResults.json()).not.toHaveProperty('results')

  const projector = await context.newPage()
  await projector.goto(`/projector?code=${encodeURIComponent(joinCode!)}`)
  await expect(projector.getByRole('heading', { name: 'Sala de Asamblea' })).toBeVisible()
  await expect(projector.getByText('Resultados publicados')).toHaveCount(0)
  await expect(projector.getByText('Opción Ámbar')).toHaveCount(0)

  await moderator.getByRole('button', { name: 'Publicar resultados' }).click()
  await expect(projector.getByRole('heading', { name: 'Resultados publicados' })).toBeVisible({ timeout: 12_000 })
  await expect(projector.getByText('Opción Ámbar')).toBeVisible()

  await context.close()
})
