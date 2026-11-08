import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { baseSumText, marksCheckText, marksPerBallot, notVotedRow, resultRows } from '../../src/resultados'

type Row = [label: string, count: number]

const results = (list: Row[]) => list.map(([label, count]) => ({ optionId: label, label, count }))

describe('resultRows', () => {
  test('lists rows by votes, most first, with the share of the base', () => {
    const rows = resultRows(results([['Amós', 3], ['Oseas', 9], ['Joel', 5]]), 20)
    assert.deepEqual(rows.map((row) => [row.label, row.count, row.percent]), [['Oseas', 9, 45], ['Joel', 5, 25], ['Amós', 3, 15]])
  })

  test('rows with equal votes keep ballot order', () => {
    const rows = resultRows(results([['Amós', 4], ['Oseas', 6], ['Joel', 4], ['Miqueas', 4]]), 20)
    assert.deepEqual(rows.map((row) => row.label), ['Oseas', 'Amós', 'Joel', 'Miqueas'])
  })

  test('a decision follows the same order, so En contra leads when it has more votes', () => {
    const rows = resultRows(results([['A favor', 10], ['En contra', 20]]), 32)
    assert.deepEqual(rows.map((row) => row.label), ['En contra', 'A favor'])
  })

  test('zero votes give zero shares', () => {
    const rows = resultRows(results([['Amós', 0], ['Oseas', 0]]), 38)
    assert.deepEqual(rows.map((row) => [row.count, row.percent]), [[0, 0], [0, 0]])
  })

  test('no candidates give no rows', () => {
    assert.deepEqual(resultRows([], 38), [])
  })

  test('a base of zero gives zero shares', () => {
    assert.deepEqual(resultRows(results([['Amós', 0]]), 0).map((row) => row.percent), [0])
  })

  test('keys rows by option id', () => {
    const rows = resultRows([{ optionId: 'o1', label: 'Amós', count: 1 }], 2)
    assert.equal(rows[0].key, 'o1')
  })
})

describe('notVotedRow', () => {
  test('counts everyone in the base who did not cast a ballot, with the share of the base', () => {
    assert.deepEqual(notVotedRow(36, 40), { key: 'not-voted', label: 'No votaron', count: 4, percent: 10 })
  })

  test('is zero when everyone voted', () => {
    assert.equal(notVotedRow(38, 38).count, 0)
  })

  test('is the whole base when nobody voted', () => {
    assert.deepEqual(notVotedRow(0, 38), { key: 'not-voted', label: 'No votaron', count: 38, percent: 100 })
  })

  test('the people who voted plus «No votaron» equal the base', () => {
    for (const [recorded, base] of [[0, 0], [0, 5], [3, 5], [5, 5], [36, 38]]) {
      assert.equal(recorded + notVotedRow(recorded, base).count, base)
    }
  })
})

describe('baseSumText', () => {
  test('shows that the people who voted plus «No votaron» equal the base', () => {
    assert.equal(baseSumText(36, 38), '36 votaron + 2 no votaron = 38')
  })

  test('uses the singular for one person', () => {
    assert.equal(baseSumText(1, 2), '1 votó + 1 no votó = 2')
  })

  test('shows zero when everyone voted', () => {
    assert.equal(baseSumText(38, 38), '38 votaron + 0 no votaron = 38')
  })
})

describe('marksPerBallot', () => {
  test('a committee vote marks as many names as the seats it fills', () => {
    assert.equal(marksPerBallot({ category: 'committee', electionSeats: 3, memberCount: 5 }), 3)
  })

  test('a committee vote without election seats marks its member count', () => {
    assert.equal(marksPerBallot({ category: 'committee', electionSeats: null, memberCount: 5 }), 5)
  })

  test('a decision marks one option', () => {
    assert.equal(marksPerBallot({ category: 'decision', electionSeats: null, memberCount: null }), 1)
  })

  test('an office vote marks one name', () => {
    assert.equal(marksPerBallot({ category: 'office', electionSeats: null, memberCount: null }), 1)
  })
})

describe('marksCheckText', () => {
  test('shows how many names each ballot marks and the total the rows add up to', () => {
    assert.equal(marksCheckText(3, 36), 'Cada papeleta marca 3 nombres · 3 × 36 = 108 votos')
  })

  test('is empty when each ballot marks one name', () => {
    assert.equal(marksCheckText(1, 36), '')
  })

  test('works when nobody voted', () => {
    assert.equal(marksCheckText(2, 0), 'Cada papeleta marca 2 nombres · 2 × 0 = 0 votos')
  })
})
