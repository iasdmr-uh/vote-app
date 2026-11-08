import { expect, test, type Page } from '@playwright/test'
import { mockCompletedAssembly } from './acta-fixture'

const logFile = '﻿"Hora","Tipo","Acción"\r\n"2026-11-08 14:15:30","Datos","Registro descargado"\r\n'

async function mockLog(page: Page, calls: Array<{ method: string; path: string; body: unknown }>, refuseDelete = false) {
  await page.route('**/api/v1/moderator/assemblies/synthetic-assembly/log', async (route) => {
    calls.push({ method: route.request().method(), path: 'log', body: route.request().postDataJSON() })
    await route.fulfill({
      status: 200, body: logFile,
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="registro-iv-asamblea.csv"' },
    })
  })
  await page.route('**/api/v1/moderator/assemblies/synthetic-assembly', async (route) => {
    if (route.request().method() !== 'DELETE') { await route.fallback(); return }
    calls.push({ method: 'DELETE', path: 'assembly', body: route.request().postDataJSON() })
    await route.fulfill(refuseDelete
      ? { status: 409, json: { message: 'Descarga el registro para «Borrar datos» antes de borrar los datos' } }
      : { json: { assemblyId: 'synthetic-assembly', deleted: true, vacuumed: true } })
  })
}

test('«Descargar registro» baja el archivo del registro', async ({ page }) => {
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  await mockCompletedAssembly(page)
  await mockLog(page, calls)
  await page.goto('/moderator')

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar registro' }).click()
  expect((await download).suggestedFilename()).toBe('registro-iv-asamblea-reorganizativa-2026.csv')
  expect(calls).toEqual([{ method: 'POST', path: 'log', body: { purpose: 'review' } }])
})

test('«Borrar datos» primero descarga el registro para borrar y luego pide confirmar', async ({ page }) => {
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  await mockCompletedAssembly(page)
  await mockLog(page, calls)
  await page.goto('/moderator')

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Borrar datos de la Asamblea' }).click()
  expect((await download).suggestedFilename()).toBe('registro-iv-asamblea-reorganizativa-2026.csv')
  expect(calls).toEqual([{ method: 'POST', path: 'log', body: { purpose: 'delete' } }])

  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('guardar el registro que se acaba de descargar')
  await dialog.getByRole('textbox').fill('BORRAR')
  await dialog.getByRole('button', { name: 'Borrar datos' }).click()
  await expect(page.getByText('Se borraron los datos de la Asamblea')).toBeVisible()
  expect(calls.map((call) => call.path)).toEqual(['log', 'assembly'])
})

test('si el servidor pide otra descarga, la mesa lo muestra', async ({ page }) => {
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  await mockCompletedAssembly(page)
  await mockLog(page, calls, true)
  await page.goto('/moderator')

  await page.getByRole('button', { name: 'Borrar datos de la Asamblea' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').fill('BORRAR')
  await dialog.getByRole('button', { name: 'Borrar datos' }).click()
  await expect(page.getByText('Descarga el registro para «Borrar datos» antes de borrar los datos')).toBeVisible()
})
