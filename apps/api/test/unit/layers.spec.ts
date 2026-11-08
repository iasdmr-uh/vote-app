import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

const sourceRoot = new URL('../../src/', import.meta.url)
const votingDir = new URL('voting/', sourceRoot)
const providerFile = /\.(service|controller|module|gateway)\.ts$/
const providerImport = /\.(service|controller|module|gateway)\.js$/

type Import = { names: string[]; typeOnly: boolean; from: string }

function importsOf(url: URL): Import[] {
  const source = readFileSync(url, 'utf8')
  return [...source.matchAll(/^import\s+(type\s+)?([\s\S]*?)\s+from\s+'([^']+)'/gm)].map((match) => ({
    typeOnly: Boolean(match[1]),
    names: match[2]!.replace(/[{}]/g, '').split(',').map((name) => name.trim().replace(/^type\s+/, '')).filter(Boolean),
    from: match[3]!,
  }))
}

const votingFiles = readdirSync(votingDir).filter((name) => name.endsWith('.ts'))
const freeModules = votingFiles.filter((name) => !providerFile.test(name) && name !== 'dtos.ts')

test('free-function voting modules import no Nest symbol except exceptions and no provider file', () => {
  assert.ok(freeModules.includes('round-rules.ts'))
  for (const file of freeModules) {
    for (const entry of importsOf(new URL(file, votingDir))) {
      assert.doesNotMatch(entry.from, providerImport, `${file} imports ${entry.from}`)
      if (!entry.from.startsWith('@nestjs/')) continue
      assert.equal(entry.from, '@nestjs/common', `${file} imports ${entry.from}`)
      for (const name of entry.names) assert.match(name, /Exception$/, `${file} imports ${name} from @nestjs/common`)
    }
  }
})

test('voting services import each other only along the known edges', () => {
  const edges = votingFiles
    .filter((file) => file.endsWith('.service.ts'))
    .flatMap((file) => importsOf(new URL(file, votingDir))
      .filter((entry) => /^\.\/[\w-]+\.service\.js$/.test(entry.from))
      .map((entry) => `${file} -> ${entry.from.slice(2, -3)}.ts`))
    .sort()
  assert.deepEqual(edges, [
    'connection-count.service.ts -> voting.service.ts',
    'room.service.ts -> voting.service.ts',
    'voting.service.ts -> operator-log.service.ts',
    'voting.service.ts -> presentation.service.ts',
  ])
})

test('no provider uses forwardRef', () => {
  const files = readdirSync(sourceRoot, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts') && !name.startsWith('generated'))
  assert.ok(files.length > 0)
  for (const file of files) assert.doesNotMatch(readFileSync(new URL(file, sourceRoot), 'utf8'), /forwardRef/, file)
})
