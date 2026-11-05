import { expect, test, type Page } from '@playwright/test'
import { mockCompletedAssembly } from './acta-fixture'

// Printed acta in the Agenda UH 2026 style (#47, Figma A1–A3).

async function openPrintedActa(page: Page) {
  await page.goto('/moderator')
  await page.getByRole('button', { name: 'Imprimir o guardar PDF' }).click()
  await page.emulateMedia({ media: 'print' })
  const acta = page.locator('.acta-print')
  await expect(acta).toBeVisible()
  return acta
}

test('el acta impresa lista cada votación en orden con su número, participación, mayoría y etiquetas (A1–A2)', async ({ page }) => {
  await mockCompletedAssembly(page)
  const acta = await openPrintedActa(page)

  await expect(acta.getByRole('img', { name: 'Con poder y gloria' }).first()).toBeVisible()
  await expect(acta.getByRole('img', { name: 'Unión Hondureña' })).toBeVisible()
  await expect(acta.getByRole('heading', { name: 'ACTA DE VOTACIONES' })).toBeVisible()
  await expect(acta.locator('.acta-history .acta-subtitle')).toHaveText('IV Asamblea Reorganizativa 2026 · 3 de noviembre de 2026')
  await expect(acta.locator('.acta-summary')).toHaveText('38 habilitados · 8 votaciones · 1 anulada')

  const rounds = acta.locator('.acta-round')
  await expect(rounds).toHaveCount(8)
  await expect(rounds.locator('h2')).toHaveText(['1. Presidente', '2. Presidente', '3. Vicepresidente', '4. Comisión de Finanzas', '5. Comisión de Finanzas', '6. Secretario', '7. Secretario', '8. Presupuesto 2027'])
  await expect(rounds.locator('.acta-kind')).toHaveText(['1.ª VOTACIÓN', 'DESEMPATE · 2.ª VOTACIÓN', '1.ª VOTACIÓN', '1.ª VOTACIÓN', 'DESEMPATE · 2.ª VOTACIÓN', 'ANULADA', '1.ª VOTACIÓN', 'DECISIÓN · APROBADA'])
  await expect(rounds.locator('.acta-meta')).toHaveText([
    '36 de 38 votaron · 2 no votaron · Mayoría: 20',
    '37 de 38 votaron · 1 no votó · Mayoría: 20',
    '36 de 38 votaron · 2 no votaron · Mayoría: 20',
    '3 integrantes · 36 de 38 votaron · 2 no votaron · Mayoría: 20',
    '2 puestos · 36 de 38 votaron · 2 no votaron · Mayoría: 20',
    'Error en la papeleta',
    '35 de 38 votaron · 3 no votaron · Mayoría: 20',
    'Se aprueba con 3/4 · 29 votos · 36 de 38 votaron · 2 no votaron',
  ])

  const first = rounds.nth(0).locator('.acta-results li')
  await expect(first).toHaveText(['1María LópezDesempate18 votos47 %', '2Carlos GómezDesempate12 votos32 %', '3Rosa Díaz6 votos16 %'])
  await expect(rounds.nth(1).locator('li.winner')).toHaveText('1María LópezElecto/a25 votos66 %')
  const committee = rounds.nth(3).locator('.acta-results li')
  await expect(committee.locator('.acta-tag')).toHaveText(['Electo/a', 'Desempate', 'Desempate', 'Desempate'])
  await expect(committee.nth(5)).toHaveText('6Luis Pérez11 votos29 %')
  await expect(rounds.nth(4).locator('li.winner .acta-name')).toHaveText(['Jorge BanegasElecto/a', 'Elena CastroElecto/a'])
  await expect(rounds.nth(5).locator('.acta-results')).toHaveCount(0)
  await expect(rounds.nth(7).locator('.acta-results li')).toHaveText(['1A favorAprobada30 votos79 %', '2En contra6 votos16 %'])

  // Committees, delegados and suplentes only appear in the history.
  await expect(acta.locator('.acta-org').getByText('Comisión de Finanzas')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Acta y borrado de datos' })).toBeHidden()
})

test('el organigrama muestra la Junta directiva y los Departamentos, con puestos sin votar en blanco y el departamento agregado (A3)', async ({ page }) => {
  await mockCompletedAssembly(page)
  const acta = await openPrintedActa(page)
  const org = acta.locator('.acta-org')
  await expect(org.getByRole('heading', { name: 'OFICIALES DE UNIÓN HONDUREÑA' })).toBeVisible()
  await expect(org.locator('.acta-subtitle')).toHaveText('2027–2029')

  const board = org.locator('.acta-board')
  await expect(board.getByRole('heading', { name: 'JUNTA DIRECTIVA' })).toBeVisible()
  await expect(board.locator('.acta-board-top .acta-puesto-label')).toHaveText(['Presidente', 'Vicepresidente'])
  await expect(board.locator('.acta-board-bottom .acta-puesto-label')).toHaveText(['Secretario', 'Tesorero', 'Vocal 1', 'Vocal 2', 'Vocal 3'])
  await expect(board.locator('.acta-board-top .acta-puesto-name')).toHaveText(['María López', 'Juan Mora'])
  await expect(board.locator('[data-position="Tesorero"] .acta-puesto-name')).toHaveText('')
  await expect(board.locator('.acta-line')).toHaveCount(3)

  const departments = org.locator('.acta-departments')
  await expect(departments.getByRole('heading', { name: 'DEPARTAMENTOS' })).toBeVisible()
  const rows = departments.locator('.acta-department-row')
  await expect(rows).toHaveCount(8)
  await expect(rows.nth(0).locator('.acta-puesto-label')).toHaveText(['Auditor', 'Escuela Sabática'])
  await expect(rows.nth(6).locator('.acta-puesto-label')).toHaveText(['Agricultura', 'Construcción'])
  await expect(departments.locator('[data-position="Auditor"] .acta-puesto-name')).toHaveText('Carlos Gómez')
  await expect(departments.locator('[data-position="Construcción"] .acta-puesto-name')).toHaveText('')
  await expect(rows.nth(7).locator('.acta-puesto')).toHaveText(['MayordomíaIris Medina'])
  await expect(rows.nth(7).locator('.acta-branch.half')).toHaveCount(1)

  // The org chart starts on its own page, and no puesto is clipped.
  await expect(org).toHaveCSS('break-before', 'page')
  for (const name of await org.locator('.acta-puesto-name').all()) {
    expect(await name.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  }
})

test('sin puestos no se imprime el organigrama', async ({ page }) => {
  await mockCompletedAssembly(page, {})
  const acta = await openPrintedActa(page)
  await expect(acta.locator('.acta-round')).toHaveCount(8)
  await expect(acta.locator('.acta-org')).toHaveCount(0)
  await expect(acta.getByText('OFICIALES DE UNIÓN HONDUREÑA')).toHaveCount(0)
})

test('el acta se imprime en tamaño carta sin cortar votaciones', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'PDF output is Chromium only')
  await mockCompletedAssembly(page)
  await openPrintedActa(page)
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
  const text = pdf.toString('latin1')
  const pages = text.match(/\/Type\s*\/Page[^s]/g) || []
  // A1 and A2 for the history, A3 for the org chart.
  expect(pages.length).toBe(3)
  expect(text).toMatch(/\/MediaBox\s*\[0 0 612 792\]/)
})
