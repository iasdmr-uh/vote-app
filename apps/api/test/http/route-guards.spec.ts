import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js'
import { ModulesContainer } from '@nestjs/core'
import { type Api, startApi } from '../support/api.js'

const publicRoutes = [
  'GET /health',
  'POST /assemblies/resume',
  'POST /assemblies/:assemblyCode/join',
  'GET /assemblies/:assemblyCode/public-state',
]

let api: Api

before(async () => {
  api = await startApi()
})

after(async () => {
  await api?.stop()
})

function joinPath(...parts: string[]) {
  return `/${parts.flatMap((part) => part.split('/')).filter(Boolean).join('/')}`
}

function listRoutes() {
  const routes: { method: string; path: string }[] = []
  for (const module of api.app.get(ModulesContainer).values()) {
    for (const { metatype } of module.controllers.values()) {
      if (!metatype) continue
      const controllerPath: string = Reflect.getMetadata(PATH_METADATA, metatype) ?? ''
      const prototype = metatype.prototype
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name]
        const methodPath: string | undefined = Reflect.getMetadata(PATH_METADATA, handler)
        if (name === 'constructor' || methodPath === undefined) continue
        routes.push({ method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod], path: joinPath(controllerPath, methodPath) })
      }
    }
  }
  return routes
}

test('route guards: every route outside the public list answers 401 without credentials', async () => {
  const routes = listRoutes()

  const open: string[] = []
  for (const { method, path } of routes) {
    const response = await api.request(method, path.replace(/:\w+/g, () => randomUUID()))
    if (response.status !== 401) open.push(`${method} ${path}`)
  }

  assert.ok(routes.length > publicRoutes.length, 'the app lists its moderator and participant routes')
  assert.deepEqual(open.sort(), [...publicRoutes].sort())
})
