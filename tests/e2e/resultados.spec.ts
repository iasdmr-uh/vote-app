import { expect, test } from '@playwright/test'
import { actaSheetRows, isTied, percentOf, rankedResults, rankOf, turnoutOf, votedText } from '../../apps/web/src/resultados'

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
        results: [{ optionId: 'a', label: 'Rosa', count: 1 }, { optionId: 'b', label: 'Pedro', count: 1 }],
        officialResult: { elected: [{ optionId: 'a', label: 'Rosa' }], note: null, declaredBy: 'x', declaredAt: '', publishedAt: null } },
      { id: 'r2', title: 'Secretaría', status: 'annulled', annulReason: 'Error', participationCount: 2, options: [] },
    ], { published: 'publicada', annulled: 'anulada' })
    expect(rows.slice(1)).toEqual([
      ['Presidencia', 'publicada', '3 de 4 votaron', 1, 'Rosa', 1, 25, 'sí', 'sí'],
      ['Presidencia', 'publicada', '3 de 4 votaron', 2, 'Pedro', 1, 25, 'sí', ''],
      ['Secretaría', 'anulada: Error', '2 votaron', '', '', '', '', '', ''],
    ])
  })
})
