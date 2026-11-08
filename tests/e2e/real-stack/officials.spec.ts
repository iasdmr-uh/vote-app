import { expect, test, type Locator } from '@playwright/test'
import { addToOfficials, confirm, openRoom, prepareBallot, runVote, voteAll } from './helpers'

const BLANK_BOARD = ['Vicepresidente', 'Secretario', 'Vocal 1', 'Vocal 2', 'Vocal 3']

function puesto(chart: Locator, label: string) {
  return chart.locator('.puesto').filter({ has: chart.page().getByRole('heading', { name: label, exact: true }) })
}

/**
 * #46 + #47 + #48 on the real stack: the puestos the mesa elects reach «Presentar oficiales» on the
 * projector (P4, P5) and the printed acta's org chart; committees only appear in the acta's history.
 */
test('los puestos electos llegan a «Presentar oficiales» y al organigrama del acta impresa', async ({ browser, request }) => {
  const room = await openRoom(browser, request, 'IV Asamblea Reorganizativa E2E', ['Ana Ruiz', 'Luis Pérez', 'Rosa Díaz'], '2027–2029')
  const { mesa, projector } = room

  // Presidente: 1 – 1 over 3 habilitados (majority 2) goes to a runoff, which elects María López.
  await prepareBallot(mesa, { kind: 'office', title: 'Presidente', candidates: ['María López', 'Carlos Gómez'] })
  await runVote(room, [['María López'], ['Carlos Gómez'], null])
  await confirm(mesa, 'Abrir desempate', 'Abrir votación')
  await expect(room.phones[0].page.locator('.phone-status-open')).toHaveText('VOTACIÓN ABIERTA')
  await voteAll(room.phones, [['María López'], ['María López'], ['Carlos Gómez']])
  await expect(mesa.locator('.vote-progress strong')).toHaveText('3')
  await confirm(mesa, 'Cerrar votación')
  await expect(projector.locator('.slide-office .office-name')).toHaveText('María López')

  await addToOfficials(mesa)
  // Tesorero, a custom departamento and a committee.
  await prepareBallot(mesa, { kind: 'office', title: 'Tesorero', candidates: ['Ana Ruiz', 'Juan Mora'] })
  await runVote(room, [['Ana Ruiz'], ['Ana Ruiz'], ['Juan Mora']])
  await addToOfficials(mesa)
  await prepareBallot(mesa, { kind: 'office', title: 'Educación', candidates: ['Elena Castro', 'Pedro Vargas'] })
  await runVote(room, [['Elena Castro'], ['Elena Castro'], ['Pedro Vargas']])
  await addToOfficials(mesa)
  await prepareBallot(mesa, { kind: 'committee', title: 'Comisión de Finanzas', seats: 2, candidates: ['Ana Ruiz', 'Luis Pérez', 'Rosa Díaz'] })
  await runVote(room, [['Ana Ruiz', 'Luis Pérez'], ['Ana Ruiz', 'Luis Pérez'], ['Ana Ruiz', 'Rosa Díaz']])
  await addToOfficials(mesa)

  // «Presentar oficiales»: cover, Junta directiva (P4) and Departamentos (P5) with the published puestos.
  const bar = mesa.getByRole('region', { name: 'Presentar oficiales' })
  await bar.getByRole('button', { name: 'Presentar oficiales' }).click()
  await expect(projector.locator('.cover-period')).toHaveText('2027–2029')
  await expect(projector.locator('.cover-assembly')).toHaveText('IV Asamblea Reorganizativa E2E')
  await bar.getByRole('button', { name: 'Diapositiva siguiente' }).click()
  const board = projector.locator('.slide-board')
  await expect(board.locator('.puesto')).toHaveCount(7)
  await expect(puesto(board, 'Presidente').locator('p')).toHaveText('María López')
  await expect(puesto(board, 'Tesorero').locator('p')).toHaveText('Ana Ruiz')
  for (const label of BLANK_BOARD) await expect(puesto(board, label)).toHaveClass(/puesto-blank/)
  await expect(board.locator('.puesto-blank')).toHaveCount(5)
  await bar.getByRole('button', { name: 'Diapositiva siguiente' }).click()
  const departments = projector.locator('.slide-departments')
  await expect(departments.locator('.puesto')).toHaveCount(15)
  await expect(puesto(departments, 'Educación').locator('p')).toHaveText('Elena Castro')
  await expect(departments.locator('.puesto-blank')).toHaveCount(14)
  await expect(departments).not.toContainText('Comisión de Finanzas')
  await bar.getByRole('button', { name: 'Terminar presentación' }).click()
  await expect(departments).toHaveCount(0)

  // The printed acta: the same org chart, and the committee only in the history.
  await confirm(mesa, 'Finalizar Asamblea…', 'Finalizar Asamblea')
  await expect(mesa.getByText('Asamblea finalizada', { exact: true })).toBeVisible()
  // Headless Chromium fires «afterprint» right away, which would take the acta down before it is read.
  await mesa.evaluate(() => { window.print = () => {} })
  await mesa.getByRole('button', { name: 'Imprimir o guardar PDF' }).click()
  await mesa.emulateMedia({ media: 'print' })
  const acta = mesa.locator('.acta-print')
  await expect(acta).toBeVisible()
  await expect(acta.locator('.acta-round h2')).toHaveText(['1. Presidente', '2. Presidente', '3. Tesorero', '4. Educación', '5. Comisión de Finanzas'])
  const org = acta.locator('.acta-org')
  await expect(org.locator('.acta-subtitle')).toHaveText('2027–2029')
  await expect(org.locator('[data-position="Presidente"] .acta-puesto-name')).toHaveText('María López')
  await expect(org.locator('[data-position="Tesorero"] .acta-puesto-name')).toHaveText('Ana Ruiz')
  for (const label of BLANK_BOARD) await expect(org.locator(`[data-position="${label}"] .acta-puesto-name`)).toHaveText('')
  await expect(org.locator('.acta-departments [data-position="Educación"] .acta-puesto-name')).toHaveText('Elena Castro')
  await expect(org.locator('.acta-departments .acta-puesto')).toHaveCount(15)
  await expect(org).not.toContainText('Comisión de Finanzas')
})
