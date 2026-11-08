import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, test } from 'node:test'
import { es } from '../../src/locale/es'

const srcDir = join(import.meta.dirname, '..', '..', 'src')
const localeDir = join(srcDir, 'locale')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (path === localeDir) return []
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|vue)$/.test(name) ? [path] : []
  })
}

function keyPaths(node: unknown, prefix: string[] = []): string[] {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return [prefix.join('.')]
  return Object.entries(node).flatMap(([key, value]) => keyPaths(value, [...prefix, key]))
}

const files = sourceFiles(srcDir).map((path) => ({ path: relative(srcDir, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }))
const allText = files.map((file) => file.text).join('\n')

function isReferenced(path: string) {
  const segments = path.split('.')
  for (let length = segments.length; length >= 2; length -= 1) {
    const prefix = segments.slice(0, length).join('\\.')
    const closing = length === segments.length ? '(?![\\w$])' : '(?![\\w$.])'
    if (new RegExp(`\\bes\\.${prefix}${closing}`).test(allText)) return true
  }
  return false
}

describe('es locale', () => {
  test('keyPaths: flattens nested groups to dotted paths and keeps functions as leaves', () => {
    const sample = { a: { b: 'x', c: (count: number) => `${count}` }, d: ['x'] }

    const paths = keyPaths(sample)

    assert.deepEqual(paths, ['a.b', 'a.c', 'd'])
  })

  test('es: every key is read as es.<path> somewhere in apps/web/src outside the locale', () => {
    const paths = keyPaths(es)

    const unused = paths.filter((path) => !isReferenced(path))

    assert.deepEqual(unused, [])
  })
})
