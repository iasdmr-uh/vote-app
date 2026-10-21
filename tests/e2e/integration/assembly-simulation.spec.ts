import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'

/**
 * Simulates a whole Asamblea against the real API and PostgreSQL: nine delegate phones, the projector
 * and the mesa. Union Committee offices (with a tie, a repetition and an annulment) and two committees,
 * where each delegate marks from one up to the committee size among typed candidate names.
 * Screenshots and timing notes go to SIMULATION_OUTPUT_DIR for the moderator review.
 */
const moderatorToken = process.env.MODERATOR_ACCESS_TOKEN!
const api = 'http://127.0.0.1:3300/api/v1'
const outDir = process.env.SIMULATION_OUTPUT_DIR ?? 'test-results/assembly-simulation'
const delegateNames = ['María López', 'Carlos Gómez', 'Rosa Díaz', 'Juan Mora', 'Ana Ruiz', 'Luis Pérez', 'Elena Castro', 'Pedro Vargas', 'Sofía Méndez']
const notes: string[] = []
let shot = 0

type Delegate = { name: string; page: Page }

function note(message: string) {
  notes.push(`[${new Date().toISOString().slice(11, 19)}] ${message}`)
}

async function snap(page: Page, name: string) {
  shot += 1
  await page.screenshot({ path: join(outDir, `${String(shot).padStart(2, '0')}-${name}.png`), fullPage: true })
}

/** Waits for a realtime update; if it does not arrive, notes it and syncs by hand like a delegate would. */
async function arrives(page: Page, locator: Locator, what: string) {
  const started = Date.now()
  try {
    await expect(locator).toBeVisible({ timeout: 8_000 })
    const elapsed = Date.now() - started
    if (elapsed > 3_000) note(`Lento: "${what}" tardó ${elapsed} ms en llegar por tiempo real`)
  } catch {
    note(`Sin tiempo real: "${what}" no llegó en 8 s; se pulsó «Sincronizar estado»`)
    await page.getByRole('button', { name: 'Sincronizar estado' }).click()
    await expect(locator).toBeVisible({ timeout: 8_000 })
  }
}

async function confirm(moderator: Page, button: string, dialogButton = button) {
  await moderator.getByRole('button', { name: button, exact: true }).first().click()
  await moderator.getByRole('dialog').getByRole('button', { name: dialogButton, exact: true }).click()
  await expect(moderator.getByRole('dialog')).toHaveCount(0)
}

async function vote(delegate: Delegate, choices: string[]) {
  const { page } = delegate
  await arrives(page, page.getByRole('button', { name: 'Revisar y confirmar voto' }), `papeleta abierta en el teléfono de ${delegate.name}`)
  for (const choice of choices) await page.getByLabel(choice, { exact: true }).check()
  await page.getByRole('button', { name: 'Revisar y confirmar voto' }).click()
  await page.getByRole('button', { name: 'Confirmar voto' }).click()
  await expect(page.getByText('Tu participación está registrada')).toBeVisible()
}

async function prepareOffice(moderator: Page, title: string, candidates: string[]) {
  const another = moderator.getByRole('button', { name: 'Preparar otra papeleta' })
  if (await another.isVisible()) await another.click()
  await moderator.getByLabel('Nombre del cargo').fill(title)
  for (const candidate of candidates) {
    await moderator.getByLabel('Agregar candidato').fill(candidate)
    await moderator.getByLabel('Agregar candidato').press('Enter')
  }
  await confirm(moderator, 'Preparar papeleta')
  await expect(moderator.getByText('PAPELETA PREPARADA', { exact: true })).toBeVisible()
}

async function prepareCommittee(moderator: Page, title: string, members: number, candidates: string[]) {
  await moderator.getByRole('button', { name: 'Preparar otra papeleta' }).click()
  await moderator.getByRole('radio', { name: 'Una comisión' }).click()
  await moderator.getByLabel('Nombre de la comisión').fill(title)
  await moderator.getByLabel('¿Cuántos integrantes quedarán en la comisión?').fill(String(members))
  for (const candidate of candidates) {
    await moderator.getByLabel('Agregar candidato').fill(candidate)
    await moderator.getByLabel('Agregar candidato').press('Enter')
  }
  await expect(moderator.getByText(`Cada persona podrá marcar de 1 a ${members} candidatos.`, { exact: false })).toBeVisible()
}

async function declare(moderator: Page, elected: string[], observation: string) {
  await moderator.getByRole('button', { name: 'Declarar resultado oficial…' }).click()
  const dialog = moderator.getByRole('dialog')
  for (const name of elected) await dialog.getByLabel(name).check()
  await dialog.getByLabel('Observación (opcional)').fill(observation)
  await dialog.getByRole('button', { name: 'Declarar resultado oficial' }).click()
  await expect(moderator.getByText(/Resultado oficial declarado:/)).toBeVisible()
}

async function moderatorState(request: import('@playwright/test').APIRequestContext, assemblyId: string) {
  const response = await request.get(`${api}/moderator/assemblies/${assemblyId}`, { headers: { Authorization: `Bearer ${moderatorToken}` } })
  expect(response.ok()).toBeTruthy()
  return response.json()
}

async function newPhone(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  return context.newPage()
}

test.describe.configure({ timeout: 600_000 })

test('simulación completa: Comité de la Unión y comisiones', async ({ browser, request }) => {
  mkdirSync(outDir, { recursive: true })
  const consoleErrors: string[] = []
  const moderatorContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const moderator = await moderatorContext.newPage()
  moderator.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(`mesa: ${message.text()}`) })

  // 1. La mesa entra y crea la Asamblea.
  await moderator.goto('/moderator')
  await moderator.getByLabel('Credencial de moderación').fill(moderatorToken)
  await moderator.getByRole('button', { name: 'Continuar' }).click()
  await moderator.getByLabel('Nombre', { exact: true }).fill('Asamblea Ordinaria Unión Hondureña 2026')
  await moderator.getByRole('button', { name: 'Crear Asamblea y generar código' }).click()
  const creationNotice = moderator.locator('.notice.success')
  await expect(creationNotice).toContainText('Código de ingreso:')
  const joinCode = (await creationNotice.innerText()).match(/Código de ingreso:\s*(\S+)/)![1]
  const assemblyId = (await moderator.evaluate(() => sessionStorage.getItem('assemblyId')))!
  await snap(moderator, 'mesa-asamblea-creada')

  const projector = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage()
  await projector.goto(`/projector?code=${encodeURIComponent(joinCode)}`)

  // 2. Nueve delegados se unen desde sus teléfonos.
  const delegates: Delegate[] = []
  for (const name of delegateNames) {
    const page = await newPhone(browser)
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(`${name}: ${message.text()}`) })
    await page.goto(`/?join=${encodeURIComponent(joinCode)}`)
    const [firstName, lastName] = name.split(' ')
    await page.getByLabel('Nombre').fill(firstName)
    await page.getByLabel('Apellido').fill(lastName)
    await page.getByRole('button', { name: 'Unirme a la sala' }).click()
    await expect(page.getByText('Tu teléfono queda en espera.')).toBeVisible()
    delegates.push({ name, page })
  }
  await arrives(moderator, moderator.locator('.participant-list').getByText('Sofía Méndez'), 'lista de participantes en la mesa')
  await snap(projector, 'proyector-ingreso')
  await confirm(moderator, 'Cerrar ingreso')
  await expect(moderator.locator('.metric').first()).toContainText('Ingreso cerrado')
  await snap(moderator, 'mesa-ingreso-cerrado')

  // 3. Comité de la Unión · Presidencia: empate, repetición y declaración.
  let started = Date.now()
  await prepareOffice(moderator, 'Presidencia', ['María López', 'Carlos Gómez', 'Rosa Díaz'])
  await snap(moderator, 'mesa-presidencia-preparada')
  await confirm(moderator, 'Abrir votación')
  for (const [index, delegate] of delegates.entries()) await vote(delegate, [index < 4 ? 'María López' : index < 8 ? 'Carlos Gómez' : 'Rosa Díaz'])
  await snap(delegates[0].page, 'telefono-voto-registrado')
  await arrives(moderator, moderator.getByText('9 / 9'), 'participación 9/9 en la mesa')
  await confirm(moderator, 'Cerrar votación')
  await expect(moderator.getByRole('region', { name: 'Conteo para revisión de la mesa' })).toBeVisible()
  await snap(moderator, 'mesa-presidencia-conteo-privado')
  await expect(projector.getByText('María López')).toHaveCount(0)
  await confirm(moderator, 'Publicar conteo')
  await expect(moderator.getByText('Empate en el primer lugar: María López y Carlos Gómez, 4 votos cada uno.')).toBeVisible()
  await snap(moderator, 'mesa-presidencia-empate-M07b')
  await arrives(projector, projector.getByRole('heading', { name: 'Resultados publicados' }), 'conteo publicado en el proyector')
  await snap(projector, 'proyector-presidencia-empate')

  await moderator.locator('.decision-card').getByRole('button', { name: 'Repetir votación…' }).click()
  const repeatDialog = moderator.getByRole('dialog')
  await expect(repeatDialog.getByLabel('María López')).toBeChecked()
  await expect(repeatDialog.getByLabel('Carlos Gómez')).toBeChecked()
  await expect(repeatDialog.getByLabel('Rosa Díaz')).not.toBeChecked()
  await snap(moderator, 'mesa-repetir-S05')
  await repeatDialog.getByRole('button', { name: 'Preparar 2.ª votación' }).click()
  await expect(moderator.getByText('2.ª VOTACIÓN', { exact: true })).toBeVisible()
  await expect(moderator.getByText('Se repite por empate en la 1.ª votación (4 – 4).')).toBeVisible()
  await snap(moderator, 'mesa-repeticion-preparada-M13')
  await confirm(moderator, 'Abrir votación')
  for (const [index, delegate] of delegates.entries()) await vote(delegate, [index < 6 ? 'María López' : 'Carlos Gómez'])
  await confirm(moderator, 'Cerrar votación')
  await confirm(moderator, 'Publicar conteo')
  await declare(moderator, ['María López'], 'Electa en la 2.ª votación')
  await arrives(projector, projector.getByText('RESULTADO DECLARADO POR LA MESA'), 'declaración en el proyector')
  await expect(projector.getByRole('heading', { name: 'María López' })).toBeVisible()
  await snap(projector, 'proyector-presidencia-declarada')
  await arrives(delegates[3].page, delegates[3].page.getByText('RESULTADO OFICIAL DE LA MESA'), 'declaración en el teléfono')
  await snap(delegates[3].page, 'telefono-presidencia-declarada')
  note(`Presidencia (2 votaciones + declaración): ${Math.round((Date.now() - started) / 1000)} s`)

  // 4. Comité de la Unión · Secretaría: anulación con motivo y repetición.
  started = Date.now()
  await prepareOffice(moderator, 'Secretaría', ['Ana Ruiz', 'Juan Mora'])
  await confirm(moderator, 'Abrir votación')
  await vote(delegates[0], ['Ana Ruiz'])
  await vote(delegates[1], ['Juan Mora'])
  await moderator.getByRole('button', { name: 'Anular votación' }).click()
  await moderator.getByRole('dialog').getByLabel('Motivo (obligatorio, queda en el registro)').fill('Faltó incluir a un candidato propuesto por la Asamblea')
  await moderator.getByRole('dialog').getByRole('button', { name: 'Anular papeleta' }).click()
  await expect(moderator.getByText('PAPELETA ANULADA', { exact: true })).toBeVisible()
  await arrives(delegates[5].page, delegates[5].page.getByText('La mesa anuló esta votación'), 'anulación en el teléfono')
  await snap(moderator, 'mesa-secretaria-anulada')
  await snap(projector, 'proyector-secretaria-anulada')
  // The Asamblea asks to add a third candidate, so the mesa prepares a new ballot instead of repeating.
  await prepareOffice(moderator, 'Secretaría', ['Ana Ruiz', 'Juan Mora', 'Elena Castro'])
  await confirm(moderator, 'Abrir votación')
  for (const [index, delegate] of delegates.entries()) await vote(delegate, [index < 5 ? 'Ana Ruiz' : index < 7 ? 'Elena Castro' : 'Juan Mora'])
  await confirm(moderator, 'Cerrar votación')
  await confirm(moderator, 'Publicar conteo')
  await declare(moderator, ['Ana Ruiz'], '')
  note(`Secretaría (anulada + nueva papeleta + declaración): ${Math.round((Date.now() - started) / 1000)} s`)

  // 5. Comisión de Nombramiento: 5 integrantes entre 7 nombres escritos; cada persona marca de 1 a 5.
  started = Date.now()
  const nominees = ['Elena Castro', 'Pedro Vargas', 'Sofía Méndez', 'Luis Pérez', 'Juan Mora', 'Rosa Díaz', 'Carlos Gómez']
  await prepareCommittee(moderator, 'Comisión de Nombramiento', 5, nominees)
  await snap(moderator, 'mesa-nombramiento-formulario-N01')
  await confirm(moderator, 'Preparar papeleta')
  await expect(moderator.getByText('PAPELETA PREPARADA', { exact: true })).toBeVisible()
  await expect(moderator.getByText('Cada persona marca de 1 a 5 candidatos.')).toBeVisible()
  await confirm(moderator, 'Abrir votación')
  await arrives(moderator, moderator.getByText('9 personas · 0 ya votaron · 9 faltan'), 'puntos amarillos al abrir la votación')
  for (const [index, delegate] of delegates.entries()) {
    // Not everyone marks five names: fewer is allowed, more is not.
    await vote(delegate, index < 4
      ? ['Elena Castro', 'Pedro Vargas', 'Sofía Méndez', 'Luis Pérez', 'Juan Mora']
      : index < 7 ? ['Elena Castro', 'Pedro Vargas', 'Rosa Díaz'] : ['Sofía Méndez'])
    if (index === 4) {
      await arrives(moderator, moderator.getByText('9 personas · 5 ya votaron · 4 faltan'), 'puntos verdes de quienes ya votaron')
      await expect(moderator.locator('.participant-list li', { hasText: 'Ana Ruiz' }).getByRole('img', { name: 'Ya votó' })).toBeVisible()
      await expect(moderator.locator('.participant-list li', { hasText: 'Luis Pérez' }).getByRole('img', { name: 'Falta votar' })).toBeVisible()
      await snap(moderator, 'mesa-quien-voto-N05')
    }
  }
  await snap(delegates[8].page, 'telefono-nombramiento-votado')
  await confirm(moderator, 'Cerrar votación')
  await expect(moderator.getByRole('img', { name: 'Ya votó' })).toHaveCount(9)
  await snap(moderator, 'mesa-nombramiento-cerrada-N06')
  await confirm(moderator, 'Publicar conteo')
  await arrives(projector, projector.getByText('se eligen 5 integrantes', { exact: false }), 'conteo de la comisión en el proyector')
  const projected = projector.locator('.projector-results > div')
  await expect(projected).toHaveCount(7)
  // Elena and Pedro got 7 of 9 voters: shares are over the people who voted.
  await expect(projected.first()).toContainText('Elena Castro')
  await expect(projected.first()).toContainText('78 %')
  await expect(projected.last()).toContainText('Carlos Gómez')
  await expect(projector.getByText('9 de 9 participantes votaron', { exact: false })).toBeVisible()
  await expect(projector.getByText(/voto nulo/i)).toHaveCount(0)
  await snap(projector, 'proyector-nombramiento-P10')
  await declare(moderator, ['Elena Castro', 'Pedro Vargas', 'Sofía Méndez', 'Luis Pérez', 'Juan Mora'], 'Integrantes electos de la Comisión de Nombramiento')
  await arrives(projector, projector.getByText('RESULTADO DECLARADO POR LA MESA'), 'declaración de la comisión en el proyector')
  await snap(projector, 'proyector-nombramiento-declarada')
  note(`Comisión de Nombramiento: ${Math.round((Date.now() - started) / 1000)} s`)

  // 6. Comisión de Finanzas: 3 integrantes entre 4 nombres escritos.
  started = Date.now()
  await prepareCommittee(moderator, 'Comisión de Finanzas', 3, ['Ana Ruiz', 'María López', 'Pedro Vargas', 'Rosa Díaz'])
  await confirm(moderator, 'Preparar papeleta')
  await expect(moderator.getByText('PAPELETA PREPARADA', { exact: true })).toBeVisible()
  await confirm(moderator, 'Abrir votación')
  for (const [index, delegate] of delegates.entries()) {
    await vote(delegate, index < 5 ? ['Ana Ruiz', 'María López', 'Pedro Vargas'] : ['Ana Ruiz', 'Rosa Díaz', 'María López'])
  }
  await confirm(moderator, 'Cerrar votación')
  await confirm(moderator, 'Publicar conteo')
  await declare(moderator, ['Ana Ruiz', 'María López', 'Pedro Vargas'], '')
  note(`Comisión de Finanzas: ${Math.round((Date.now() - started) / 1000)} s`)

  // 7. Cierre de la Asamblea y acta.
  await moderator.getByRole('button', { name: 'Finalizar Asamblea…' }).click()
  await moderator.getByRole('dialog').getByRole('button', { name: 'Finalizar Asamblea' }).click()
  await expect(moderator.getByText('Asamblea finalizada', { exact: true })).toBeVisible()
  await snap(moderator, 'mesa-asamblea-finalizada')
  await arrives(projector, projector.getByRole('heading', { name: 'Asamblea finalizada' }), 'cierre en el proyector')
  await snap(projector, 'proyector-finalizada')

  const final = await moderatorState(request, assemblyId)
  const declared = final.rounds.filter((round: { officialResult: unknown }) => round.officialResult)
  const summary = final.rounds.map((round: { title: string; status: string; officialResult?: { elected: Array<{ label: string }>; publishedAt: string | null } | null }) =>
    `${round.title} · ${round.status}${round.officialResult ? ` · electos: ${round.officialResult.elected.map((person) => person.label).join(', ')}${round.officialResult.publishedAt ? ' (publicado)' : ' (interno)'}` : ''}`)
  expect(declared).toHaveLength(4)
  expect(final.rounds.find((round: { title: string; officialResult?: unknown }) => round.title === 'Presidencia' && round.officialResult).officialResult.elected.map((person: { label: string }) => person.label)).toEqual(['María López'])

  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify({ joinCode, rounds: summary, notes, consoleErrors }, null, 2)}\n`)
})
