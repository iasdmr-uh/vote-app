import { execFileSync } from 'node:child_process'
import type { Page } from '@playwright/test'
import { expect, test } from './api-fixture'
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

test('el acta impresa lista cada votación en orden con su número, participación, mayoría y etiquetas (A1–A2)', async ({ page, api }) => {
  await mockCompletedAssembly(api)
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

test('el organigrama muestra la Junta directiva y los Departamentos, con puestos sin votar en blanco y el departamento agregado (A3)', async ({ page, api }) => {
  await mockCompletedAssembly(api)
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

test('sin puestos no se imprime el organigrama', async ({ page, api }) => {
  await mockCompletedAssembly(api, {})
  const acta = await openPrintedActa(page)
  await expect(acta.locator('.acta-round')).toHaveCount(8)
  await expect(acta.locator('.acta-org')).toHaveCount(0)
  await expect(acta.getByText('OFICIALES DE UNIÓN HONDUREÑA')).toHaveCount(0)
})

test('el acta se imprime en tamaño carta sin cortar votaciones', async ({ page, api, browserName }) => {
  test.skip(browserName !== 'chromium', 'PDF output is Chromium only')
  await mockCompletedAssembly(api)
  await openPrintedActa(page)
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
  const text = pdf.toString('latin1')
  const pages = text.match(/\/Type\s*\/Page[^s]/g) || []
  // A1 and A2 for the history, A3 for the org chart.
  expect(pages.length).toBe(3)
  expect(text).toMatch(/\/MediaBox\s*\[0 0 612 792\]/)
})

function sheetRows(xml: string) {
  const unescape = (text: string) => text.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  return [...xml.matchAll(/<row [^>]*>(.*?)<\/row>/g)].map(([, row]) => [...row!.matchAll(/<c [^>]*?(t="inlineStr")?>(.*?)<\/c>/g)]
    .map(([, inline, body]) => inline ? unescape(body!.replace(/^<is><t xml:space="preserve">|<\/t><\/is>$/g, '')) : Number(body!.replace(/<\/?v>/g, ''))))
}

test('después de finalizar, la mesa imprime el acta, descarga la hoja de cálculo y borra los datos', async ({ page, api }) => {
  let deleted = false
  let deleteBody: unknown
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
    window.print = () => { (window as unknown as { printed: number }).printed = ((window as unknown as { printed?: number }).printed ?? 0) + 1 }
  })
  api.on(({ request, url }) => {
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly') && !deleted) {
      return { json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'completed', completedAt: '2026-10-02T18:30:00.000Z',
        participants: [{ id: 'p1', firstName: 'Delegado', lastName: 'Sintético' }], participantCount: 1,
        rounds: [
          { id: 'r1', title: 'Presidencia', status: 'published', participationCount: 4, eligibleCount: 5, options: [{ id: 'a', label: 'Rosa' }, { id: 'b', label: 'Pedro' }],
            results: [{ optionId: 'a', label: 'Rosa', count: 3 }, { optionId: 'b', label: 'Pedro', count: 1 }],
            outcome: { seats: 1, base: 5, threshold: 3, elected: ['a'], runoff: [], openSeats: 0 },
            officialResult: { elected: [{ optionId: 'a', label: 'Rosa' }], note: null, declaredBy: 'shared_moderator_credential', declaredAt: '2026-10-02T18:00:00.000Z', publishedAt: '2026-10-02T18:01:00.000Z' } },
          { id: 'r2', title: 'Secretaría', status: 'annulled', annulReason: 'Nombre mal escrito', participationCount: 1, options: [{ id: 'c', label: 'Juan' }] },
          { id: 'r3', title: 'Tesorería', status: 'published', participationCount: 1, options: [{ id: 'f', label: '=HYPERLINK("http://x","y")' }],
            results: [{ optionId: 'f', label: '=HYPERLINK("http://x","y")', count: 1 }] },
        ],
      } }
    }
    if (request.method() === 'DELETE' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      deleteBody = request.postDataJSON()
      deleted = true
      return { json: { assemblyId: 'synthetic-assembly', deleted: true, vacuumed: true } }
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly/log')) {
      return { status: 200, contentType: 'text/csv; charset=utf-8', body: '﻿"Hora","Tipo","Acción"\r\n' }
    }
  })

  await page.goto('/moderator')
  await expect(page.getByRole('heading', { name: 'Acta y borrado de datos' })).toBeVisible()

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar hoja de cálculo' }).click()
  expect((await download).suggestedFilename()).toBe('acta-asamblea-de-prueba.xlsx')
  const sheet = execFileSync('unzip', ['-p', await (await download).path() as string, 'xl/worksheets/sheet1.xml'], { encoding: 'utf8' })
  expect(sheetRows(sheet)).toContainEqual(['Presidencia', 'publicada', '4 de 5 votaron · 1 no votó', 1, 'Rosa', 3, 60, '', 'Electo/a'])
  expect(sheetRows(sheet)).toContainEqual(['Presidencia', 'publicada', '4 de 5 votaron · 1 no votó', 2, 'Pedro', 1, 20, '', 'No continúa'])
  expect(sheetRows(sheet)).toContainEqual(['Secretaría', 'anulada: Nombre mal escrito', '1 votó', '', '', '', '', '', ''])
  expect(sheetRows(sheet)).toContainEqual(['Tesorería', 'publicada', '1 votó', 1, '=HYPERLINK("http://x","y")', 1, '', '', ''])
  expect(sheet).not.toContain('<f>')

  const acta = page.locator('.acta-print')
  await expect(acta).toHaveCount(0)
  await page.getByRole('button', { name: 'Imprimir o guardar PDF' }).click()
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1)
  await expect(acta).toBeHidden()
  await page.emulateMedia({ media: 'print' })
  await expect(acta).toBeVisible()
  await expect(acta.getByRole('heading', { name: 'ACTA DE VOTACIONES' })).toBeVisible()
  await expect(acta.locator('.acta-round').nth(0).locator('.acta-meta')).toHaveText('4 de 5 votaron · 1 no votó · Mayoría: 3')
  await expect(acta.locator('.acta-round').nth(1)).toContainText('ANULADA')
  await expect(acta.locator('.acta-round').nth(1).locator('.acta-meta')).toHaveText('Nombre mal escrito')
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

test('sin una votación contada, los habilitados del acta incluyen a quienes salieron', async ({ page, api }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
    window.print = () => {}
  })
  api.on(({ request, url }) => {
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      return { json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'completed', completedAt: '2026-10-02T18:30:00.000Z',
        participants: [{ id: 'p1', firstName: 'Ana', lastName: 'Reyes' }], leftParticipants: [{ id: 'p2', firstName: 'Pedro', lastName: 'Vargas' }], participantCount: 1,
        rounds: [{ id: 'r1', title: 'Presidencia', status: 'annulled', annulReason: 'Error', participationCount: 2, eligibleCount: 2, options: [{ id: 'a', label: 'Alfa' }], officialResult: null }],
      } }
    }
  })

  await page.goto('/moderator')
  await page.getByRole('button', { name: 'Imprimir o guardar PDF' }).click()
  const acta = page.locator('.acta-print')
  await expect(acta.locator('.acta-summary')).toHaveText('2 habilitados · 1 votación · 1 anulada')
})
