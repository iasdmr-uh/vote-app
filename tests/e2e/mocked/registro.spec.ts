import { expect, test, type MockApi } from './api-fixture'
import { actaPositions, mockCompletedAssembly } from './acta-fixture'

const logFile = '﻿"Hora","Tipo","Acción"\r\n"2026-11-08 14:15:30","Datos","Registro descargado"\r\n'

function mockLog(api: MockApi, calls: Array<{ method: string; path: string; body: unknown }>, refuseDelete = false) {
  api.any('/moderator/assemblies/synthetic-assembly/log', ({ method, json }) => {
    calls.push({ method, path: 'log', body: json() })
    return {
      status: 200, body: logFile,
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="registro-iv-asamblea.csv"' },
    }
  })
  api.delete('/moderator/assemblies/synthetic-assembly', ({ json }) => {
    calls.push({ method: 'DELETE', path: 'assembly', body: json() })
    return refuseDelete
      ? { status: 409, json: { message: 'Descarga el registro para «Borrar datos» antes de borrar los datos' } }
      : { json: { assemblyId: 'synthetic-assembly', deleted: true, vacuumed: true } }
  })
}

test('«Descargar registro» baja el archivo del registro', async ({ page, api }) => {
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  await mockCompletedAssembly(api)
  mockLog(api, calls)
  await page.goto('/moderator')

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar registro' }).click()
  expect((await download).suggestedFilename()).toBe('registro-iv-asamblea-reorganizativa-2026.csv')
  expect(calls).toEqual([{ method: 'POST', path: 'log', body: { purpose: 'review' } }])
})

test('el nombre del archivo no empieza ni termina con guion', async ({ page, api }) => {
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  await mockCompletedAssembly(api, { period: '2027–2029', positions: actaPositions, name: '¡Asamblea 2026!' })
  mockLog(api, calls)
  await page.goto('/moderator')

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar registro' }).click()
  expect((await download).suggestedFilename()).toBe('registro-asamblea-2026.csv')
})

test('«Borrar datos» primero descarga el registro para borrar y luego pide confirmar', async ({ page, api }) => {
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  await mockCompletedAssembly(api)
  mockLog(api, calls)
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

test('si el servidor pide otra descarga, la mesa lo muestra', async ({ page, api }) => {
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  await mockCompletedAssembly(api)
  mockLog(api, calls, true)
  await page.goto('/moderator')

  await page.getByRole('button', { name: 'Borrar datos de la Asamblea' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').fill('BORRAR')
  await dialog.getByRole('button', { name: 'Borrar datos' }).click()
  await expect(page.getByText('Descarga el registro para «Borrar datos» antes de borrar los datos')).toBeVisible()
})
