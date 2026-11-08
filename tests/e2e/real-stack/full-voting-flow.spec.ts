import { expect, test } from '@playwright/test'
import { api, castVoteByApi, confirm, expectPhoneShowsNoResult, expectProjectorFinal, finishLiveAssembly, joinPhone, moderatorState, openMesa, openProjector, prepareBallot, vote } from './helpers'

test('flujo real de asamblea: ingreso, voto único, cierre y publicación', async ({ browser, request }) => {
  await finishLiveAssembly(request)
  const { mesa, joinCode, assemblyId } = await openMesa(browser, 'Asamblea E2E sintética')
  await expect(mesa.getByRole('heading', { name: 'Participantes' })).toBeVisible()

  const delegate = await joinPhone(browser, joinCode, 'Delegado E2E Sintético')
  await expect(mesa.locator('.mesa-person-list')).toContainText('Delegado E2E Sintético')

  await confirm(mesa, 'Cerrar ingreso')
  await expect(mesa.getByRole('button', { name: 'Reabrir ingreso' })).toBeVisible()
  await prepareBallot(mesa, { kind: 'office', title: 'Vocal 1', candidates: ['Opción Ámbar', 'Opción Índigo'] })
  await confirm(mesa, 'Abrir votación')
  await expect(mesa.getByRole('button', { name: 'Cerrar votación' })).toBeVisible()

  // Arrives through the realtime event, without a manual reload.
  await expect(delegate.page.getByRole('heading', { name: 'Vocal 1' })).toBeVisible()
  await vote(delegate, ['Opción Ámbar'])

  const persisted = await moderatorState(request, assemblyId)
  expect(persisted.rounds[0].participationCount).toBe(1)
  const duplicate = await castVoteByApi(request, delegate.token, persisted.rounds[0].id, [persisted.rounds[0].options[0].id])
  expect(duplicate.status()).toBe(409)
  expect((await moderatorState(request, assemblyId)).rounds[0].participationCount).toBe(1)

  const projector = await openProjector(browser, joinCode)
  await expect(projector.getByRole('heading', { name: 'Vocal 1' })).toBeVisible()
  await expect(mesa.getByText('CONTEO PUBLICADO', { exact: true })).toBeVisible()
  await expect(mesa.getByRole('button', { name: 'Cerrar votación' })).toHaveCount(0)
  await expect(projector.locator('.result-summary')).toContainText('Resultado final')
  await expect(projector.locator('.slide-office .office-name')).toHaveText('Opción Ámbar')
  await expect(projector.locator('.slide-office .office-votes')).toHaveText('1 de 1 votos · 100 %')
  await projector.getByRole('button', { name: 'Ver conteo' }).click()
  await expect(projector.locator('.pj-status')).toHaveText('Conteo publicado')
  await expect(projector.locator('.pj-results .pj-label')).toHaveText(['Opción Ámbar', 'Opción Índigo', 'No votaron'])
  await expectProjectorFinal(projector, 'Opción Ámbar')
  await expectPhoneShowsNoResult(delegate)
})
