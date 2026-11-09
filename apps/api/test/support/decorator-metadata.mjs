import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const compilerOptions = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
  inlineSourceMap: true,
  inlineSources: true,
}

registerHooks({
  load(url, context, nextLoad) {
    if (!url.startsWith('file:') || url.includes('/node_modules/') || !url.split('?')[0].endsWith('.ts')) return nextLoad(url, context)
    const fileName = fileURLToPath(url)
    const { outputText } = ts.transpileModule(readFileSync(fileName, 'utf8'), { fileName, compilerOptions })
    return { format: 'module', source: outputText, shortCircuit: true }
  },
})
