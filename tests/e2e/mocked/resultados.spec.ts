import { expect, test } from '@playwright/test'
import type { Position, RoundRecord } from '../../../apps/web/src/types'
import { actaPositions, actaRounds } from './acta-fixture'
import { actaKind, actaMetaText, actaRows, actaSheetRows, actaSummary, isTied, orgChart, votesText, notVotedOf, notVotedText, percentOf, rankedResults, rankOf, turnoutOf, votedText } from '../../../apps/web/src/resultados'

test.describe('resultados', () => {
  const tiedFirst = [{ count: 4 }, { count: 4 }, { count: 2 }, { count: 0 }, { count: 0 }]

  test('numera 1, 2, 3 aunque haya empate', () => {
    expect(tiedFirst.map((_, index) => rankOf(tiedFirst, index))).toEqual(['1.', '2.', '3.', '4.', '5.'])
    expect(rankOf(tiedFirst, 9)).toBe('')
  })

  test('marca empate solo entre conteos iguales con votos', () => {
    expect(tiedFirst.map((_, index) => isTied(tiedFirst, index))).toEqual([true, true, false, false, false])
    expect(isTied([{ count: 3 }], 0)).toBe(false)
  })

  test('el % es sobre las personas registradas y se redondea', () => {
    expect(percentOf(1, 3)).toBe(33)
    expect(percentOf(2, 3)).toBe(67)
    expect(percentOf(1, 8)).toBe(13)
    expect(percentOf(5, 0)).toBe(0)
    expect(percentOf(5, undefined)).toBe(0)
  })

  test('texto de participación', () => {
    expect(votedText(18, 20)).toBe('18 de 20 votaron')
    expect(votedText(1, 20)).toBe('1 de 20 votó')
    expect(votedText(3, 0)).toBe('3 votaron')
    expect(notVotedText(36, 38)).toBe('2 no votaron')
    expect(notVotedText(37, 38)).toBe('1 no votó')
    expect(notVotedOf(5, 4)).toBe(0)
    expect(turnoutOf({ participationCount: 7, eligibleCount: 9 })).toEqual({ recorded: 7, eligible: 9 })
    expect(turnoutOf({ recordedCount: 8, participationCount: 7, eligibleCount: 9 })).toEqual({ recorded: 8, eligible: 9 })
  })

  test('cargos y comisiones usan la misma base', () => {
    const committee = rankedResults([{ label: 'B', count: 3 }, { label: 'A', count: 5 }, { label: 'C', count: 3 }], 10)
    expect(committee.map(({ label, rank, percent, tied }) => [rank, label, percent, tied])).toEqual([[1, 'A', 50, false], [2, 'B', 30, true], [3, 'C', 30, true]])
  })

  test('filas del acta en Excel', () => {
    const rows = actaSheetRows([
      { id: 'r1', title: 'Presidencia', status: 'published', participationCount: 3, eligibleCount: 4, options: [],
        results: [{ optionId: 'a', label: 'Rosa', count: 2 }, { optionId: 'b', label: 'Pedro', count: 1 }],
        outcome: { seats: 1, base: 4, threshold: 3, elected: ['a'], runoff: [], openSeats: 0 },
        officialResult: { elected: [{ optionId: 'a', label: 'Rosa' }], note: null, declaredBy: 'x', declaredAt: '', publishedAt: null } },
      { id: 'r2', title: 'Secretaría', status: 'annulled', annulReason: 'Error', participationCount: 2, options: [] },
    ], { published: 'publicada', annulled: 'anulada' })
    expect(rows[0]?.at(-1)).toBe('Resultado')
    expect(rows.slice(1)).toEqual([
      ['Presidencia', 'publicada', '3 de 4 votaron · 1 no votó', 1, 'Rosa', 2, 50, '', 'Electo/a'],
      ['Presidencia', 'publicada', '3 de 4 votaron · 1 no votó', 2, 'Pedro', 1, 25, '', 'No continúa'],
      ['Secretaría', 'anulada: Error', '2 votaron', '', '', '', '', '', ''],
    ])
  })

  test('cada fila del Excel dice lo que esa votación decidió, y la última lista la comisión en orden', () => {
    const root = {
      id: 'c1', title: 'Comisión', status: 'published', category: 'committee' as const, memberCount: 3, voteNumber: 1, participationCount: 10, eligibleCount: 10, options: [],
      results: [{ optionId: 'a', label: 'Ana', count: 7 }, { optionId: 'b', label: 'Bruno', count: 5 }, { optionId: 'c', label: 'Carla', count: 5 }, { optionId: 'd', label: 'Dora', count: 3 }],
      outcome: { seats: 3, base: 10, threshold: 6, elected: ['a'], runoff: ['b', 'c'], openSeats: 2 },
      officialResult: { elected: [{ optionId: 'a', label: 'Ana' }, { optionId: 'c2', label: 'Carla' }, { optionId: 'b2', label: 'Bruno' }], note: null, declaredBy: 'x', declaredAt: '', publishedAt: null },
    }
    const last = {
      id: 'c2', title: 'Comisión', status: 'published', category: 'committee' as const, memberCount: 3, electionSeats: 2, voteNumber: 2, runoff: true, committeeRootRoundId: 'c1', participationCount: 10, eligibleCount: 11, regionalSecretaryVotes: true, options: [],
      results: [{ optionId: 'c2', label: 'Carla', count: 7 }, { optionId: 'b2', label: 'Bruno', count: 6 }],
      outcome: { seats: 2, base: 11, threshold: 6, elected: ['c2', 'b2'], runoff: [], openSeats: 0 }, officialResult: null,
    }
    const rows = actaSheetRows([root, last], { published: 'publicada' }).slice(1)
    expect(rows.map((row) => [row[0], row[4], row[8]])).toEqual([
      ['Comisión', 'Ana', 'Electo/a'],
      ['Comisión', 'Bruno', 'Pasa'],
      ['Comisión', 'Carla', 'Pasa'],
      ['Comisión', 'Dora', 'No continúa'],
      ['Comisión · DESEMPATE · 2.ª VOTACIÓN', 'Carla', 'Electo/a'],
      ['Comisión · DESEMPATE · 2.ª VOTACIÓN', 'Bruno', 'Electo/a'],
    ])
    expect(rows[0]?.[1]).toBe('publicada')
    expect(rows[4]?.[1]).toBe('publicada · Comisión completa: Ana, Carla, Bruno')
    expect(rows[4]?.[2]).toBe('10 de 11 votaron · 1 no votó · Con la secretaría regional')
    expect(actaMetaText(last)).toContain('Con la secretaría regional')
  })

  test('una papeleta anulada no repite a los electos de otras votaciones', () => {
    const annulled = {
      id: 'c1', title: 'Comisión', status: 'annulled', annulReason: 'Error', options: [],
      officialResult: { elected: [{ optionId: 'z', label: 'Zoe' }], note: null, declaredBy: 'x', declaredAt: '', publishedAt: null },
    }
    expect(actaSheetRows([annulled], { annulled: 'anulada' })[1]?.at(-1)).toBe('')
  })
  const [first, runoff, , committee, committeeRunoff, annulled, , decision] = actaRounds as unknown as RoundRecord[]

  test('etiqueta de cada votación en el acta impresa', () => {
    expect(actaKind(first!).text).toBe('1.ª VOTACIÓN')
    expect(actaKind(runoff!)).toEqual({ text: 'DESEMPATE · 2.ª VOTACIÓN', tone: 'vote' })
    expect(actaKind(committee!, 1).text).toBe('1.ª VOTACIÓN')
    expect(actaKind(annulled!)).toEqual({ text: 'ANULADA', tone: 'annulled' })
    expect(actaKind(decision!)).toEqual({ text: 'DECISIÓN · APROBADA', tone: 'approved' })
    expect(actaKind({ ...decision!, outcome: { ...decision!.outcome!, approved: false } })).toEqual({ text: 'DECISIÓN · NO APROBADA', tone: 'rejected' })
    expect(actaKind({ ...decision!, outcome: undefined }).text).toBe('DECISIÓN')
    // An annulled vote is not counted: the vote that repeats it is still the first.
    expect(actaKind({ ...first!, voteNumber: 2 }).text).toBe('2.ª VOTACIÓN')
  })

  test('línea de participación y mayoría del acta impresa', () => {
    expect(actaMetaText(first!)).toBe('36 de 38 votaron · 2 no votaron · Mayoría: 20')
    expect(actaMetaText(runoff!)).toBe('37 de 38 votaron · 1 no votó · Mayoría: 20')
    expect(actaMetaText(committee!)).toBe('3 integrantes · 36 de 38 votaron · 2 no votaron · Mayoría: 20')
    expect(actaMetaText(committeeRunoff!)).toBe('2 puestos · 36 de 38 votaron · 2 no votaron · Mayoría: 20')
    expect(actaMetaText({ ...committeeRunoff!, outcome: undefined, electionSeats: 1 })).toBe('1 puesto · 36 de 38 votaron · 2 no votaron')
    expect(actaMetaText(decision!)).toBe('Se aprueba con 3/4 · 29 votos · 36 de 38 votaron · 2 no votaron')
    expect(actaMetaText(annulled!)).toBe('Error en la papeleta')
    expect(actaMetaText({ ...annulled!, annulReason: null })).toBe('')
  })

  test('filas del acta impresa con votos, % y etiqueta', () => {
    expect(actaRows(first!).map(({ rank, label, count, percent, tag, winner }) => [rank, label, count, percent, tag, winner])).toEqual([
      [1, 'María López', 18, 47, 'Desempate', false], [2, 'Carlos Gómez', 12, 32, 'Desempate', false], [3, 'Rosa Díaz', 6, 16, null, false],
    ])
    expect(actaRows(runoff!)[0]).toMatchObject({ label: 'María López', tag: 'Electo/a', winner: true })
    expect(actaRows(decision!).map(({ label, tag }) => [label, tag])).toEqual([['A favor', 'Aprobada'], ['En contra', null]])
    expect(actaRows({ ...decision!, outcome: { ...decision!.outcome!, approved: false } }).map(({ tag }) => tag)).toEqual([null, null])
    // Without a computed result, only a tie is marked; without a base there is no %.
    expect(actaRows({ id: 'x', title: 'X', status: 'published', options: [], results: [{ optionId: 'a', label: 'A', count: 2 }, { optionId: 'b', label: 'B', count: 2 }] })
      .map(({ tag, percent }) => [tag, percent])).toEqual([['Empate', null], ['Empate', null]])
    expect(votesText(1)).toBe('1 voto')
    expect(votesText(0)).toBe('0 votos')
  })

  test('resumen del acta impresa', () => {
    expect(actaSummary(actaRounds.slice(0, 8) as unknown as RoundRecord[], 38)).toBe('38 habilitados · 8 votaciones · 1 anulada')
    expect(actaSummary([first!], 1)).toBe('1 habilitado · 1 votación')
    expect(actaSummary([annulled!, annulled!], 5)).toBe('5 habilitados · 2 votaciones · 2 anuladas')
  })

  test('organigrama: Junta directiva arriba y abajo, departamentos de dos en dos', () => {
    const shuffled = [...actaPositions].reverse() as Position[]
    const chart = orgChart(shuffled)
    expect(chart.boardTop.map((position) => position.label)).toEqual(['Presidente', 'Vicepresidente'])
    expect(chart.boardBottom.map((position) => position.label)).toEqual(['Secretario', 'Tesorero', 'Vocal 1', 'Vocal 2', 'Vocal 3'])
    expect(chart.departmentRows).toHaveLength(8)
    expect(chart.departmentRows[0]!.map((position) => position.label)).toEqual(['Auditor', 'Escuela Sabática'])
    expect(chart.departmentRows[7]!.map((position) => position.label)).toEqual(['Mayordomía'])
    expect(orgChart([])).toEqual({ boardTop: [], boardBottom: [], departmentRows: [] })
  })
})
