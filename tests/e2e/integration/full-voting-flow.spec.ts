import { expect, test } from '@playwright/test'
import { api, castVoteByApi, confirm, finishLiveAssembly, joinPhone, moderatorState, openMesa, openProjector, prepareBallot, vote } from './helpers'

test('flujo real de asamblea: ingreso, voto único, cierre y publicación', async ({ browser, request }) => {
  await finishLiveAssembly(request)
  const { mesa, joinCode, assemblyId } = await openMesa(browser, 'Asamblea E2E sintética')
  await expect(mesa.getByRole('heading', { name: 'Participantes' })).toBeVisible()

  const delegate = await joinPhone(browser, joinCode, 'Delegado E2E Sintético')
  await expect(mesa.locator('.mesa-person-list')).toContainText('Delegado E2E Sintético')

  await confirm(mesa, 'Cerrar ingreso')
  await expect(mesa.getByRole('button', { name: 'Reabrir ingreso' })).toBeVisible()
  await prepareBallot(mesa, { kind: 'office', title: 'Votación E2E', candidates: ['Opción Ámbar', 'Opción Índigo'] })
  await confirm(mesa, 'Abrir votación')
  await expect(mesa.getByRole('button', { name: 'Cerrar votación' })).toBeVisible()

  // Arrives through the realtime event, without a manual reload.
  await expect(delegate.page.getByRole('heading', { name: 'Votación E2E' })).toBeVisible()
  await vote(delegate, ['Opción Ámbar'])

  const persisted = await moderatorState(request, assemblyId)
  expect(persisted.rounds[0].participationCount).toBe(1)
  const duplicate = await castVoteByApi(request, delegate.token, persisted.rounds[0].id, [persisted.rounds[0].options[0].id])
  expect(duplicate.status()).toBe(409)
  expect((await moderatorState(request, assemblyId)).rounds[0].participationCount).toBe(1)

  await confirm(mesa, 'Cerrar votación')
  await expect(mesa.getByText('VOTACIÓN CERRADA', { exact: true })).toBeVisible()
  await expect(mesa.locator('.badge-private')).toHaveText('Solo la mesa')
  const hidden = await request.get(`${api}/assemblies/${encodeURIComponent(joinCode)}/public-state`)
  expect(hidden.ok()).toBeTruthy()
  expect(await hidden.json()).not.toHaveProperty('results')

  const projector = await openProjector(browser, joinCode)
  await expect(projector.getByRole('heading', { name: 'Votación E2E' })).toBeVisible()
  await expect(projector.locator('.pj-status')).toHaveText('Votación cerrada')
  await expect(projector.getByText('Opción Ámbar')).toHaveCount(0)

  await confirm(mesa, 'Publicar conteo')
  // The elected office opens on its slide (P2, #48); the detailed count is behind «Ver conteo».
  await expect(projector.locator('.slide-office .office-name')).toHaveText('Opción Ámbar')
  await expect(projector.locator('.slide-office .office-votes')).toHaveText('1 de 1 votos · 100 %')
  await projector.getByRole('button', { name: 'Ver conteo' }).click()
  await expect(projector.locator('.pj-status')).toHaveText('Conteo publicado')
  await expect(projector.locator('.pj-results .pj-label')).toHaveText(['Opción Ámbar', 'Opción Índigo'])
  // One vote of one habilitado is a majority: elected on the projector and on the phone.
  await expect(projector.locator('.pj-elected h2')).toHaveText('✓ Opción Ámbar')
  await expect(delegate.page.locator('.official-card strong')).toHaveText('Opción Ámbar')
})
