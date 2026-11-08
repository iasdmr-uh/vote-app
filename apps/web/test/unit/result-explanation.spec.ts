import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Explanation, Outcome } from '../../src/types'
import { explanationText } from '../../src/resultados'

type Row = [label: string, count: number]

const rows = (list: Row[]) => list.map(([label, count]) => ({ optionId: label, label, count }))

function outcome(fields: Partial<Outcome>): Outcome {
  return { seats: 1, base: 38, threshold: 20, elected: [], runoff: [], openSeats: 0, ...fields }
}

function explanation(fields: Partial<Explanation>): Explanation {
  return { rule: 'simple', reasons: {}, baseDelegates: 38, baseIncludesSecretary: false, ...fields }
}

const office = { category: 'office' as const }
const committee = { category: 'committee' as const }
const booleanDecision = { category: 'decision' as const, decisionFormat: 'boolean' as const }
const optionsDecision = { category: 'decision' as const, decisionFormat: 'options' as const }

describe('explanationText', () => {
  test('a 3/4 decision that passes', () => {
    const text = explanationText(
      booleanDecision,
      outcome({ threshold: 29, rule: 'three_quarters', approved: true }),
      explanation({ rule: 'three_quarters' }),
      rows([['A favor', 29], ['En contra', 9]]),
    )
    assert.equal(text, '3/4 de 38 habilitados = 29 votos. A favor: 29. Aprobada.')
  })

  test('a decision that does not pass', () => {
    const text = explanationText(
      booleanDecision,
      outcome({ threshold: 26, rule: 'two_thirds', approved: false }),
      explanation({ rule: 'two_thirds' }),
      rows([['En contra', 13], ['A favor', 25]]),
    )
    assert.equal(text, '2/3 de 38 habilitados = 26 votos. A favor: 25. No aprobada.')
  })

  test('an office without a majority', () => {
    const text = explanationText(
      office,
      outcome({ runoff: ['Isaías', 'Jeremías'], openSeats: 1 }),
      explanation({ reasons: { Isaías: 'no_majority', Jeremías: 'added_for_choice', Ezequiel: 'out' } }),
      rows([['Isaías', 18], ['Jeremías', 12], ['Ezequiel', 8]]),
    )
    assert.equal(text, 'Mayoría simple de 38 habilitados = 20 votos. Sin mayoría: Isaías (18). Se agrega para que haya opción: Jeremías (12). Pasan a la siguiente votación.')
  })

  test('a committee with every reason', () => {
    const text = explanationText(
      committee,
      outcome({ seats: 3, elected: ['Isaías'], runoff: ['Jeremías', 'Ezequiel', 'Daniel'], openSeats: 2 }),
      explanation({ reasons: { Isaías: 'elected', Jeremías: 'no_majority', Ezequiel: 'tied_at_cut', Daniel: 'tied_at_cut', Oseas: 'out' } }),
      rows([['Isaías', 22], ['Jeremías', 12], ['Ezequiel', 8], ['Daniel', 8], ['Oseas', 0]]),
    )
    assert.equal(text, 'Mayoría simple de 38 habilitados = 20 votos. Electo/a: Isaías (22). Sin mayoría: Jeremías (12). Desempate en el último puesto: Ezequiel (8) y Daniel (8). Pasan a la siguiente votación.')
  })

  test('a base with the regional secretary', () => {
    const text = explanationText(
      office,
      outcome({ base: 29, threshold: 15, elected: ['Isaías'] }),
      explanation({ reasons: { Isaías: 'elected', Jeremías: 'out' }, baseDelegates: 28, baseIncludesSecretary: true }),
      rows([['Isaías', 16], ['Jeremías', 13]]),
    )
    assert.ok(text.startsWith('Mayoría simple de 29 habilitados (28 + secretaría regional) = 15 votos.'), text)
  })

  test('a committee that fills every seat', () => {
    const text = explanationText(
      committee,
      outcome({ seats: 2, elected: ['Isaías', 'Jeremías'] }),
      explanation({ reasons: { Isaías: 'elected', Jeremías: 'elected' } }),
      rows([['Isaías', 22], ['Jeremías', 21]]),
    )
    assert.equal(text, 'Mayoría simple de 38 habilitados = 20 votos. Electo/a: Isaías (22) y Jeremías (21).')
  })

  test('an Opciones decision names the approved option', () => {
    const text = explanationText(
      optionsDecision,
      outcome({ threshold: 26, rule: 'two_thirds', elected: ['Norte'] }),
      explanation({ rule: 'two_thirds', reasons: { Norte: 'elected', Sur: 'out' } }),
      rows([['Norte', 27], ['Sur', 11]]),
    )
    assert.equal(text, '2/3 de 38 habilitados = 26 votos. Aprobada: Norte (27).')
  })

  test('one vote needed reads in the singular', () => {
    const text = explanationText(
      office,
      outcome({ base: 0, threshold: 1 }),
      explanation({ reasons: { Isaías: 'out' }, baseDelegates: 0 }),
      rows([['Isaías', 0]]),
    )
    assert.equal(text, 'Mayoría simple de 0 habilitados = 1 voto.')
  })

  test('lists each group by votes and then in ballot order, whatever the row order', () => {
    const text = explanationText(
      committee,
      outcome({ seats: 2, elected: ['Jeremías', 'Isaías'] }),
      explanation({ reasons: { Isaías: 'elected', Jeremías: 'elected' } }),
      rows([['Isaías', 21], ['Jeremías', 22]]),
    )
    assert.equal(text, 'Mayoría simple de 38 habilitados = 20 votos. Electo/a: Jeremías (22) y Isaías (21).')
  })

  test('nothing without an outcome or an explanation', () => {
    assert.equal(explanationText(office, undefined, explanation({}), []), '')
    assert.equal(explanationText(office, outcome({}), undefined, []), '')
  })
})
