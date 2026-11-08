import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { RoundRecord } from '../../src/types'
import { latestTabId, voteProgress } from '../../src/vote-progress'

const prophets = [{ id: 'i', label: 'Isaías' }, { id: 'j', label: 'Jeremías' }, { id: 'e', label: 'Ezequiel' }]

function vote(extra: Partial<RoundRecord> & { id: string }): RoundRecord {
  return { title: 'Presidencia', status: 'published', category: 'office', voteNumber: 1, runoff: false, eligibleCount: 6, participationCount: 6, options: prophets, ...extra } as RoundRecord
}

const tiedFirst = vote({
  id: 'p1',
  results: [{ optionId: 'i', label: 'Isaías', count: 3 }, { optionId: 'j', label: 'Jeremías', count: 3 }, { optionId: 'e', label: 'Ezequiel', count: 0 }],
  outcome: { seats: 1, base: 6, threshold: 4, elected: [], runoff: ['i', 'j'], openSeats: 1 },
})
const annulledSecond = vote({ id: 'p2', status: 'annulled', voteNumber: 2, runoff: true, committeeRootRoundId: 'p1', annulReason: 'Error en la papeleta', options: prophets.slice(0, 2) })
const electedSecond = vote({
  id: 'p3', voteNumber: 2, runoff: true, committeeRootRoundId: 'p1', options: prophets.slice(0, 2),
  results: [{ optionId: 'i', label: 'Isaías', count: 5 }, { optionId: 'j', label: 'Jeremías', count: 1 }],
  outcome: { seats: 1, base: 6, threshold: 4, elected: ['i'], runoff: [], openSeats: 0 },
})

describe('voteProgress', () => {
  test('gives each election and decision one tab, with its votes as columns in order', () => {
    const decision = vote({ id: 'd1', title: 'Presupuesto 2027', category: 'decision', decisionFormat: 'boolean', status: 'open', options: [{ id: 'f', label: 'A favor' }, { id: 'c', label: 'En contra' }] })
    const tabs = voteProgress([tiedFirst, annulledSecond, electedSecond, decision])
    assert.deepEqual(tabs.map((tab) => [tab.id, tab.title, tab.columns.map((column) => column.id)]), [
      ['p1', 'Presidencia', ['p1', 'p2', 'p3']],
      ['d1', 'Presupuesto 2027', ['d1']],
    ])
  })

  test('leaves out a prepared vote that has not opened, and an election with no vote yet', () => {
    const draft = vote({ id: 'p2', status: 'draft', voteNumber: 2, runoff: true, committeeRootRoundId: 'p1' })
    const unopened = vote({ id: 's1', title: 'Secretaría', status: 'draft' })
    const tabs = voteProgress([tiedFirst, draft, unopened])
    assert.deepEqual(tabs.map((tab) => tab.columns.map((column) => column.id)), [['p1']])
  })

  test('a counted vote shows its counts, votes needed, outcome and next step', () => {
    const [first, , second] = voteProgress([tiedFirst, annulledSecond, electedSecond])[0].columns
    assert.equal(first.heading, '1.ª VOTACIÓN')
    assert.equal(first.state, 'counted')
    assert.deepEqual(first.rows.map((row) => [row.label, row.count, row.tag]), [['Isaías', 3, 'Desempate'], ['Jeremías', 3, 'Desempate'], ['Ezequiel', 0, null]])
    assert.equal(first.needed, 'Mayoría: 4')
    assert.equal(first.outcome, 'Pasan a la siguiente votación: Isaías y Jeremías')
    assert.equal(first.nextStep, 'Corresponde desempate por 1 puesto')

    assert.equal(second.heading, 'DESEMPATE · 2.ª VOTACIÓN')
    assert.equal(second.outcome, 'Electo/a: Isaías')
    assert.equal(second.nextStep, 'Elección completa')
  })

  test('an open vote and a vote whose result is being prepared show only their options', () => {
    const open = voteProgress([vote({ id: 'p1', status: 'open' })])[0].columns[0]
    assert.deepEqual([open.state, open.stateText, open.options, open.rows, open.needed, open.outcome, open.nextStep], ['open', 'Votación abierta', ['Isaías', 'Jeremías', 'Ezequiel'], [], '', '', ''])
    const closed = voteProgress([vote({ id: 'p1', status: 'closed' })])[0].columns[0]
    assert.deepEqual([closed.state, closed.stateText, closed.rows, closed.outcome], ['counting', 'Preparando el resultado', [], ''])
  })

  test('a published vote without counts stays as being prepared', () => {
    const column = voteProgress([vote({ id: 'p1', outcome: tiedFirst.outcome })])[0].columns[0]
    assert.deepEqual([column.state, column.rows, column.outcome, column.nextStep], ['counting', [], '', ''])
  })

  test('an annulled vote shows «Anulada» and its reason with no counts', () => {
    const column = voteProgress([tiedFirst, { ...annulledSecond, results: tiedFirst.results }])[0].columns[1]
    assert.deepEqual([column.state, column.stateText, column.reason, column.rows, column.outcome, column.nextStep], ['annulled', 'Anulada', 'Error en la papeleta', [], '', ''])
  })

  test('a committee names everyone elected in the vote and the seats still open', () => {
    const committee = vote({
      id: 'c1', title: 'Comisión de Finanzas', category: 'committee', memberCount: 3, format: 'multiple_choice',
      results: [{ optionId: 'i', label: 'Isaías', count: 5 }, { optionId: 'j', label: 'Jeremías', count: 2 }, { optionId: 'e', label: 'Ezequiel', count: 2 }],
      outcome: { seats: 3, base: 6, threshold: 4, elected: ['i'], runoff: ['j', 'e'], openSeats: 2 },
    })
    const [column] = voteProgress([committee])[0].columns
    assert.equal(column.needed, '3 integrantes · Mayoría: 4')
    assert.equal(column.outcome, 'Electo/a: Isaías · Pasan a la siguiente votación: Jeremías y Ezequiel')
    assert.equal(column.nextStep, 'Corresponde desempate por 2 puestos')

    const settled = { ...committee, outcome: { ...committee.outcome!, elected: ['i', 'j', 'e'], runoff: [], openSeats: 0 } }
    assert.equal(voteProgress([settled])[0].columns[0].outcome, 'Electos: Isaías, Jeremías y Ezequiel')
  })

  test('an election with open seats and nobody to continue leaves the next step to the Presiding Board', () => {
    const column = voteProgress([vote({ id: 'p1', results: tiedFirst.results, outcome: { seats: 1, base: 6, threshold: 4, elected: [], runoff: [], openSeats: 1 } })])[0].columns[0]
    assert.equal(column.outcome, 'Sin electos')
    assert.equal(column.nextStep, 'La Mesa Directiva decide cómo continuar')
  })

  test('a decision shows its rule, its verdict and that it is decided', () => {
    const favor = [{ optionId: 'f', label: 'A favor', count: 2 }, { optionId: 'c', label: 'En contra', count: 4 }]
    const rejected = vote({
      id: 'd1', title: 'Presupuesto 2027', category: 'decision', decisionFormat: 'boolean', approvalRule: 'two_thirds', options: [{ id: 'f', label: 'A favor' }, { id: 'c', label: 'En contra' }], results: favor,
      outcome: { seats: 1, base: 6, threshold: 4, elected: [], runoff: [], openSeats: 0, rule: 'two_thirds', approved: false },
    })
    const [column] = voteProgress([rejected])[0].columns
    assert.equal(column.needed, 'Se aprueba con 2/3 · 4 votos')
    assert.equal(column.outcome, 'No aprobada')
    assert.equal(column.nextStep, 'Decisión tomada')
    assert.deepEqual(column.rows.map((row) => row.label), ['A favor', 'En contra'])
  })

  test('a decision with options names the approved option, or goes to a runoff on a tie', () => {
    const sites = [{ id: 't', label: 'Tegucigalpa' }, { id: 's', label: 'San Pedro Sula' }, { id: 'l', label: 'La Ceiba' }]
    const base = { title: 'Sede 2027', category: 'decision', decisionFormat: 'options', approvalRule: 'simple', options: sites } as const
    const tied = vote({ id: 'd1', ...base, results: [{ optionId: 't', label: 'Tegucigalpa', count: 3 }, { optionId: 's', label: 'San Pedro Sula', count: 3 }, { optionId: 'l', label: 'La Ceiba', count: 0 }], outcome: { seats: 1, base: 6, threshold: 4, elected: [], runoff: ['t', 's'], openSeats: 1, rule: 'simple' } })
    const approved = vote({ id: 'd2', ...base, committeeRootRoundId: 'd1', voteNumber: 2, runoff: true, results: [{ optionId: 't', label: 'Tegucigalpa', count: 5 }, { optionId: 's', label: 'San Pedro Sula', count: 1 }], outcome: { seats: 1, base: 6, threshold: 4, elected: ['t'], runoff: [], openSeats: 0, rule: 'simple' } })
    const [first, second] = voteProgress([tied, approved])[0].columns
    assert.equal(first.outcome, 'Pasan a la siguiente votación: Tegucigalpa y San Pedro Sula')
    assert.equal(first.nextStep, 'Corresponde desempate')
    assert.equal(second.outcome, 'Aprobada: Tegucigalpa')
    assert.equal(second.nextStep, 'Decisión tomada')
  })

  test('the wording never says eliminated, winner or lost, and shows no trophy', () => {
    const text = JSON.stringify(voteProgress([tiedFirst, annulledSecond, electedSecond]))
    assert.doesNotMatch(text, /elimina|gana|ganador|perd|trofeo/i)
    assert.doesNotMatch(text, /\p{Extended_Pictographic}/u)
  })

  test('the latest tab is the election or decision of the last vote that opened', () => {
    const decision = vote({ id: 'd1', title: 'Presupuesto 2027', category: 'decision', decisionFormat: 'boolean' })
    const draft = vote({ id: 'p4', status: 'draft', voteNumber: 3, runoff: true, committeeRootRoundId: 'p1' })
    assert.equal(latestTabId([tiedFirst, decision, electedSecond]), 'p1')
    assert.equal(latestTabId([tiedFirst, electedSecond, decision, draft]), 'd1')
    assert.equal(latestTabId([vote({ id: 's1', status: 'draft' })]), '')
  })
})
