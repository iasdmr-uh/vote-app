import { expect, test } from '@playwright/test'
import { addToOfficials, closeAndShow, confirm, expectProjectorFinal, openRoom, prepareBallot, vote } from './helpers'

/** #48 on the real stack: the projector shows the elected office's slide, then follows the mesa's presentation over realtime. */
test('el proyector muestra el electo al publicar y sigue «Presentar oficiales» de la mesa', async ({ browser, request }) => {
  const room = await openRoom(browser, request, 'Asamblea E2E presentación', ['Ana Ruiz', 'Luis Pérez'])
  const { mesa, projector, phones } = room
  await prepareBallot(mesa, { kind: 'office', title: 'Presidente', candidates: ['María López', 'Carlos Gómez'] })
  await confirm(mesa, 'Abrir votación')
  for (const phone of phones) await vote(phone, ['María López'])
  await expect(mesa.getByText('CONTEO PUBLICADO', { exact: true })).toBeVisible()
  await expect(mesa.getByRole('button', { name: 'Cerrar votación' })).toHaveCount(0)
  const office = projector.locator('.slide-office')
  await expect(office.locator('.office-name')).toHaveText('María López')
  await expect(office.locator('.office-votes')).toHaveText('2 de 2 votos · 100 %')
  await projector.getByRole('button', { name: 'Ver conteo' }).click()
  await expect(projector.locator('.pj-results li:not(.pj-not-voted)')).toHaveCount(2)
  await addToOfficials(mesa)

  const bar = mesa.getByRole('region', { name: 'Presentar oficiales' })
  await bar.getByRole('button', { name: 'Presentar oficiales' }).click()
  await expect(projector.locator('.slide-cover h1')).toHaveText('OFICIALES DE UNIÓN HONDUREÑA')
  await expect(projector.locator('.cover-assembly')).toHaveText('Asamblea E2E presentación')
  await bar.getByRole('button', { name: 'Diapositiva siguiente' }).click()
  await expect(projector.locator('.slide-board .puesto')).toHaveCount(7)
  await bar.getByRole('button', { name: 'Diapositiva siguiente' }).click()
  await expect(projector.locator('.slide-departments')).toBeVisible()
  await bar.getByRole('button', { name: 'Terminar presentación' }).click()
  await expect(projector.locator('.slide-departments')).toHaveCount(0)
  await expect(projector.locator('.slide-cover, .slide-board')).toHaveCount(0)

  await prepareBallot(mesa, { kind: 'office', title: 'Vicepresidente', candidates: ['Juan Mora', 'Rosa Díaz'] })
  await confirm(mesa, 'Abrir votación')
  for (const phone of phones) await vote(phone, ['Juan Mora'])
  await closeAndShow(room)
  await expectProjectorFinal(projector, 'Juan Mora')
})
