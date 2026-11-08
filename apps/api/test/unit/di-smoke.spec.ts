import 'reflect-metadata'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { RequestMethod, type INestApplication, type Type } from '@nestjs/common'
import ts from 'typescript'

const apiRoot = fileURLToPath(new URL('../..', import.meta.url))
const sourceRoot = fileURLToPath(new URL('../../src', import.meta.url))

function compileWithDecoratorMetadata(outDir: string) {
  const configPath = fileURLToPath(new URL('../../tsconfig.json', import.meta.url))
  const config = ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, apiRoot)
  const program = ts.createProgram(config.fileNames.filter((file) => file.startsWith(sourceRoot)), {
    ...config.options,
    rootDir: sourceRoot,
    outDir,
    noEmit: false,
    declaration: false,
    sourceMap: false,
    incremental: false,
  })
  const result = program.emit()
  assert.deepEqual(result.diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n')), [])
}

type Provider = Type | { provide: unknown; useClass?: Type; useExisting?: Type }

function walkModules(root: Type) {
  const modules = new Set<Type>()
  const visit = (module: Type) => {
    if (modules.has(module)) return
    modules.add(module)
    for (const imported of Reflect.getMetadata('imports', module) ?? []) visit(imported)
  }
  visit(root)
  return [...modules]
}

function classesOf(modules: Type[]) {
  const classes = new Map<Type, boolean>()
  for (const module of modules) {
    for (const controller of Reflect.getMetadata('controllers', module) ?? []) classes.set(controller, true)
    for (const provider of (Reflect.getMetadata('providers', module) ?? []) as Provider[]) {
      if (typeof provider === 'function') classes.set(provider, true)
      else if (provider.useClass && !classes.has(provider.useClass)) classes.set(provider.useClass, false)
    }
  }
  return [...classes]
}

function routesOf(modules: Type[]) {
  const join = (...parts: string[]) => `/${parts.flatMap((part) => part.split('/')).filter(Boolean).join('/')}`
  return modules.flatMap((module) => (Reflect.getMetadata('controllers', module) ?? []).flatMap((controller: Type) => {
    const prefix = Reflect.getMetadata('path', controller) as string
    return Object.getOwnPropertyNames(controller.prototype).flatMap((name) => {
      const handler = controller.prototype[name]
      const method = Reflect.getMetadata('method', handler) as RequestMethod | undefined
      if (method === undefined) return []
      const path = Reflect.getMetadata('path', handler) as string
      return [`${RequestMethod[method]} ${join(prefix, path)}`]
    })
  })).sort()
}

test('the app module resolves every provider and controller and keeps its routes', async (t) => {
  const outDir = mkdtempSync(`${apiRoot}/node_modules/.cache-di-smoke-`)
  t.after(() => rmSync(outDir, { recursive: true, force: true }))
  compileWithDecoratorMetadata(outDir)
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost:1/unused'
  const { NestFactory } = await import('@nestjs/core')
  const { AppModule } = await import(pathToFileURL(`${outDir}/app.module.js`).href) as { AppModule: Type }
  const app: INestApplication = await NestFactory.create(AppModule, { logger: false, abortOnError: false })
  t.after(() => app.close())

  const modules = walkModules(AppModule)
  const classes = classesOf(modules)
  assert.ok(classes.length > 0)
  for (const [type, registeredByClass] of classes) {
    const parameters = (Reflect.getMetadata('design:paramtypes', type) ?? []) as unknown[]
    assert.ok(parameters.length >= type.length, `${type.name} has constructor metadata`)
    for (const parameter of parameters) assert.ok(parameter, `${type.name} has a resolvable dependency type`)
    if (registeredByClass) assert.ok(app.get(type, { strict: false }), `${type.name} resolves`)
  }

  assert.deepEqual(routesOf(modules), [
    'DELETE /moderator/assemblies/:assemblyId',
    'DELETE /moderator/rounds/:roundId/candidates/:optionId',
    'DELETE /moderator/rounds/:roundId/regional-secretary',
    'GET /assemblies/:assemblyCode/public-state',
    'GET /health',
    'GET /moderator/assemblies/:assemblyId',
    'GET /moderator/assemblies/active',
    'GET /moderator/session',
    'GET /participant/me',
    'PATCH /moderator/assemblies/:assemblyId/lobby',
    'PATCH /moderator/participants/:participantId',
    'POST /assemblies/:assemblyCode/join',
    'POST /assemblies/resume',
    'POST /moderator/assemblies',
    'POST /moderator/assemblies/:assemblyId/complete',
    'POST /moderator/assemblies/:assemblyId/join-code',
    'POST /moderator/assemblies/:assemblyId/log',
    'POST /moderator/assemblies/:assemblyId/rounds',
    'POST /moderator/assemblies/:assemblyId/secrecy-cleanup',
    'POST /moderator/participants/:participantId/disable-voting',
    'POST /moderator/participants/:participantId/enable-voting',
    'POST /moderator/participants/:participantId/resume-code',
    'POST /moderator/participants/:participantId/return',
    'POST /moderator/participants/:participantId/take-out',
    'POST /moderator/positions',
    'POST /moderator/presentation',
    'POST /moderator/rounds/:roundId/annul',
    'POST /moderator/rounds/:roundId/candidates',
    'POST /moderator/rounds/:roundId/close',
    'POST /moderator/rounds/:roundId/open',
    'POST /moderator/rounds/:roundId/publish',
    'POST /moderator/rounds/:roundId/regional-secretary',
    'POST /moderator/rounds/:roundId/repeat',
    'POST /participant/leave',
    'POST /participant/rounds/:roundId/vote',
  ])
})
