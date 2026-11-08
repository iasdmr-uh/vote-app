import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Outcome, Position, RoundRecord } from '../../src/types'
import {
  actaKind,
  chainVoteNumber,
  actaMetaText,
  actaRows,
  actaSheetRows,
  actaSummary,
  approvalText,
  completedCommittee,
  connectedText,
  marksPerPersonText,
  countsOf,
  decisionTie,
  decisionVerdict,
  displayOrder,
  electedInVote,
  electedSoFar,
  formatNames,
  isTied,
  majorityText,
  notVotedOf,
  notVotedText,
  orgChart,
  outcomeTag,
  percentOf,
  rankedResults,
  rankOf,
  turnoutOf,
  voteCountOf,
  voteLabel,
  voteResultText,
  votedText,
  votesText,
} from '../../src/resultados'

type Row = [label: string, count: number]

function counted(rows: Row[]) {
  return {
    options: rows.map(([label]) => ({ id: label, label })),
    results: rows.map(([label, count]) => ({ optionId: label, label, count })),
  }
}

function outcome(threshold: number, elected: string[], runoff: string[] = [], seats = 1, base = 38): Outcome {
  return { seats, base, threshold, elected, runoff, openSeats: seats - elected.length }
}

function round(overrides: Partial<RoundRecord> = {}): RoundRecord {
  return { id: 'r1', title: 'Presidente', status: 'published', category: 'office', voteNumber: 1, participationCount: 36, eligibleCount: 38, options: [], ...overrides }
}

function committee(overrides: Partial<RoundRecord> = {}): RoundRecord {
  return round({ id: 'c1', title: 'Comisión de Finanzas', category: 'committee', memberCount: 3, ...overrides })
}

function decision(overrides: Partial<RoundRecord> = {}): RoundRecord {
  return round({
    id: 'd1',
    title: 'Presupuesto 2027',
    category: 'decision',
    decisionFormat: 'boolean',
    approvalRule: 'three_quarters',
    ...counted([['A favor', 30], ['En contra', 6]]),
    outcome: { ...outcome(29, []), rule: 'three_quarters', approved: true },
    ...overrides,
  })
}

function official(labels: string[]) {
  return { elected: labels.map((label) => ({ optionId: label, label })), note: null, declaredBy: 'shared_moderator_credential', declaredAt: '2026-11-03T15:00:00.000Z', publishedAt: null }
}

describe('chainVoteNumber', () => {
  const chain = [
    { id: 'p1', status: 'published' },
    { id: 'p2', status: 'annulled', committeeRootRoundId: 'p1' },
    { id: 'p3', status: 'published', committeeRootRoundId: 'p1' },
    { id: 'o1', status: 'published' },
    { id: 'p4', status: 'draft', committeeRootRoundId: 'p1' },
  ]

  test('counts the earlier votes of the same election and skips annulled ones', () => {
    assert.deepEqual(['p1', 'p2', 'p3', 'p4', 'o1'].map((id) => chainVoteNumber(chain.find((item) => item.id === id)!, chain)), [1, 2, 2, 3, 1])
  })

  test('uses the number the server sent when there is one', () => {
    assert.equal(chainVoteNumber({ id: 'p4', committeeRootRoundId: 'p1', voteNumber: 5 }, chain), 5)
  })
})

describe('rankOf', () => {
  test('rankOf: tied candidates still get consecutive places', () => {
    const results = [{ count: 4 }, { count: 4 }, { count: 2 }]

    const ranks = results.map((_, index) => rankOf(results, index))

    assert.deepEqual(ranks, ['1.', '2.', '3.'])
  })

  test('rankOf: a place past the list is empty', () => {
    assert.equal(rankOf([{ count: 4 }], 3), '')
  })
})

describe('isTied', () => {
  test('isTied: candidates with the same count are tied', () => {
    const results = [{ count: 4 }, { count: 4 }, { count: 2 }]

    const tied = results.map((_, index) => isTied(results, index))

    assert.deepEqual(tied, [true, true, false])
  })

  test('isTied: candidates with zero votes are never tied', () => {
    const results = [{ count: 4 }, { count: 0 }, { count: 0 }]

    assert.equal(isTied(results, 1), false)
  })

  test('isTied: a single candidate is not tied', () => {
    assert.equal(isTied([{ count: 3 }], 0), false)
  })
})

describe('percentOf', () => {
  test('percentOf: the share of the eligible is rounded to a whole number', () => {
    assert.equal(percentOf(1, 3), 33)
    assert.equal(percentOf(2, 3), 67)
    assert.equal(percentOf(1, 8), 13)
  })

  test('percentOf: without eligible participants the share is zero', () => {
    assert.equal(percentOf(5, 0), 0)
    assert.equal(percentOf(5, undefined), 0)
  })
})

describe('turnout', () => {
  test('votedText: shows votes cast out of the eligible', () => {
    assert.equal(votedText(18, 20), '18 de 20 votaron')
  })

  test('votedText: one vote uses the singular', () => {
    assert.equal(votedText(1, 20), '1 de 20 votó')
  })

  test('votedText: without a base it shows only the votes cast', () => {
    assert.equal(votedText(3, 0), '3 votaron')
  })

  test('notVotedText: abstentions are counted as not voting', () => {
    assert.equal(notVotedText(36, 38), '2 no votaron')
  })

  test('notVotedText: one missing vote uses the singular', () => {
    assert.equal(notVotedText(37, 38), '1 no votó')
  })

  test('notVotedOf: with zero votes cast every eligible participant did not vote', () => {
    assert.equal(notVotedOf(0, 38), 38)
  })

  test('notVotedOf: is never negative', () => {
    assert.equal(notVotedOf(5, 4), 0)
  })

  test('turnoutOf: uses the participation count when there is no recorded count', () => {
    assert.deepEqual(turnoutOf({ participationCount: 7, eligibleCount: 9 }), { recorded: 7, eligible: 9 })
  })

  test('turnoutOf: prefers the recorded count over the participation count', () => {
    assert.deepEqual(turnoutOf({ recordedCount: 8, participationCount: 7, eligibleCount: 9 }), { recorded: 8, eligible: 9 })
  })

  test('turnoutOf: without a source both counts are zero', () => {
    assert.deepEqual(turnoutOf(null), { recorded: 0, eligible: 0 })
  })
})

describe('connectedText', () => {
  test('shows connected phones out of the base', () => {
    assert.equal(connectedText(47, 50), '47 de 50 conectados')
  })

  test('shows a full room', () => {
    assert.equal(connectedText(50, 50), '50 de 50 conectados')
  })

  test('shows an empty base', () => {
    assert.equal(connectedText(0, 0), '0 de 0 conectados')
  })
})

describe('marksPerPersonText', () => {
  test('asks each person for exactly the open seats', () => {
    assert.equal(marksPerPersonText(5), 'Cada persona marca exactamente 5')
  })

  test('asks for exactly one when one seat is open', () => {
    assert.equal(marksPerPersonText(1), 'Cada persona marca exactamente 1')
  })
})

describe('rankedResults', () => {
  test('rankedResults: orders by votes with place, share and tie', () => {
    const results = [{ label: 'Eliseo', count: 3 }, { label: 'Elías', count: 5 }, { label: 'Isaías', count: 3 }]

    const ranked = rankedResults(results, 10)

    assert.deepEqual(ranked.map(({ rank, label, percent, tied }) => [rank, label, percent, tied]), [
      [1, 'Elías', 50, false],
      [2, 'Eliseo', 30, true],
      [3, 'Isaías', 30, true],
    ])
  })

  test('rankedResults: when everyone is tied every candidate is marked tied', () => {
    const results = [{ label: 'Elías', count: 5 }, { label: 'Eliseo', count: 5 }, { label: 'Isaías', count: 5 }]

    const ranked = rankedResults(results, 15)

    assert.deepEqual(ranked.map(({ tied, percent }) => [tied, percent]), [[true, 33], [true, 33], [true, 33]])
  })

  test('rankedResults: with zero votes nobody is tied and every share is zero', () => {
    const results = [{ label: 'Elías', count: 0 }, { label: 'Eliseo', count: 0 }]

    const ranked = rankedResults(results, 38)

    assert.deepEqual(ranked.map(({ tied, percent }) => [tied, percent]), [[false, 0], [false, 0]])
  })

  test('rankedResults: abstentions stay in the base, so 18 of 30 votes cast among 38 eligible is 47 percent', () => {
    const results = [{ label: 'Elías', count: 18 }, { label: 'Eliseo', count: 12 }]

    const ranked = rankedResults(results, 38)

    assert.deepEqual(ranked.map(({ percent }) => percent), [47, 32])
  })

  test('rankedResults: places run from 1 to the number of candidates', () => {
    const results = [{ label: 'Elías', count: 2 }, { label: 'Eliseo', count: 2 }, { label: 'Isaías', count: 0 }, { label: 'Jeremías', count: 2 }]

    const ranked = rankedResults(results, 38)

    assert.deepEqual(ranked.map(({ rank }) => rank), [1, 2, 3, 4])
  })
})

describe('decisionTie', () => {
  test('decisionTie: a tie for an office names the tied candidates for first place', () => {
    const target = round(counted([['Elías', 12], ['Eliseo', 12], ['Isaías', 6]]))

    const tie = decisionTie(target)

    assert.equal(tie?.text, 'Empate en el primer lugar: Elías y Eliseo, 12 votos cada uno.')
    assert.equal(tie?.openSeats, 1)
  })

  test('decisionTie: a committee tie at the edge is for the last seat', () => {
    const target = committee(counted([['Elías', 20], ['Eliseo', 15], ['Isaías', 10], ['Jeremías', 10], ['Daniel', 5]]))

    const tie = decisionTie(target)

    assert.equal(tie?.text, 'Empate por el último cupo: Isaías y Jeremías, 10 votos cada uno.')
  })

  test('decisionTie: a committee tie across several seats names how many', () => {
    const target = committee(counted([['Elías', 20], ['Eliseo', 10], ['Isaías', 10], ['Jeremías', 10], ['Daniel', 5]]))

    const tie = decisionTie(target)

    assert.equal(tie?.text, 'Empate por los últimos 2 cupos: Eliseo, Isaías y Jeremías, 10 votos cada uno.')
    assert.equal(tie?.openSeats, 2)
  })

  test('decisionTie: there is no tie when one candidate leads', () => {
    assert.equal(decisionTie(round(counted([['Elías', 12], ['Eliseo', 6]]))), null)
  })

  test('decisionTie: zero votes for everyone is not a tie', () => {
    assert.equal(decisionTie(round(counted([['Elías', 0], ['Eliseo', 0]]))), null)
  })

  test('decisionTie: with more seats than candidates there is no tie', () => {
    assert.equal(decisionTie(committee(counted([['Elías', 5], ['Eliseo', 5]]))), null)
  })
})

describe('outcome badges', () => {
  const target = round({ ...counted([['Elías', 18], ['Eliseo', 12], ['Isaías', 6]]), outcome: outcome(20, ['Elías'], ['Eliseo']) })

  test('outcomeTag: marks the elected and those passing to the runoff', () => {
    assert.equal(outcomeTag(target.outcome, 'Elías'), 'elected')
    assert.equal(outcomeTag(target.outcome, 'Eliseo'), 'runoff')
    assert.equal(outcomeTag(target.outcome, 'Isaías'), null)
  })

  test('outcomeTag: without a computed result there is no badge', () => {
    assert.equal(outcomeTag(undefined, 'Elías'), null)
  })

  test('voteResultText: says what the vote decided for each candidate', () => {
    assert.equal(voteResultText(target, 'Elías'), 'Electo/a')
    assert.equal(voteResultText(target, 'Eliseo'), 'Pasa')
    assert.equal(voteResultText(target, 'Isaías'), 'No continúa')
  })

  test('voteResultText: a yes or no decision has no per-option text', () => {
    assert.equal(voteResultText(decision(), 'A favor'), '')
  })

  test('electedInVote: lists the elected by name', () => {
    assert.deepEqual(electedInVote(target), ['Elías'])
  })
})

describe('completedCommittee', () => {
  const root = committee({
    ...counted([['Elías', 7], ['Eliseo', 5], ['Isaías', 5], ['Jeremías', 3]]),
    outcome: outcome(6, ['Elías'], ['Eliseo', 'Isaías'], 3),
    officialResult: official(['Elías', 'Isaías', 'Eliseo']),
  })
  const last = committee({
    id: 'c2',
    committeeRootRoundId: 'c1',
    runoff: true,
    electionSeats: 2,
    voteNumber: 2,
    ...counted([['Isaías', 7], ['Eliseo', 6]]),
    outcome: outcome(6, ['Isaías', 'Eliseo'], [], 2),
  })

  test('completedCommittee: the vote that elects the last member lists the committee in election order', () => {
    assert.deepEqual(completedCommittee(last, [root, last]), ['Elías', 'Isaías', 'Eliseo'])
  })

  test('completedCommittee: an earlier vote of the committee lists nobody', () => {
    assert.deepEqual(completedCommittee(root, [root, last]), [])
  })
})

describe('labels', () => {
  test('voteLabel: the first vote has no label', () => {
    assert.equal(voteLabel(round()), '')
  })

  test('voteLabel: a runoff shows its number', () => {
    assert.equal(voteLabel({ voteNumber: 2, runoff: true }), 'DESEMPATE · 2.ª VOTACIÓN')
  })

  test('voteLabel: a repeat after an annulled vote is numbered without runoff', () => {
    assert.equal(voteLabel({ voteNumber: 2 }), '2.ª VOTACIÓN')
  })

  test('majorityText: an office shows the majority', () => {
    assert.equal(majorityText(round(), outcome(20, [])), 'Mayoría: 20')
  })

  test('majorityText: a committee shows its members', () => {
    assert.equal(majorityText(committee(), outcome(20, [], [], 3)), '3 integrantes · Mayoría: 20')
  })

  test('majorityText: a committee runoff shows the seats left', () => {
    assert.equal(majorityText(committee({ runoff: true }), outcome(20, [], [], 2)), '2 puestos · Mayoría: 20')
  })

  test('approvalText: names the 3/4 rule and the votes it needs', () => {
    assert.equal(approvalText(decision(), decision().outcome), 'Se aprueba con 3/4 · 29 votos')
  })

  test('approvalText: names the 2/3 rule and the votes it needs', () => {
    const amendment = decision({ approvalRule: 'two_thirds', outcome: { ...outcome(19, []), rule: 'two_thirds', approved: false } })
    assert.equal(approvalText(amendment, amendment.outcome), 'Se aprueba con 2/3 · 19 votos')
  })

  test('majorityText: a closed 2/3 decision names its rule before the count is published', () => {
    const amendment = decision({ status: 'closed', approvalRule: 'two_thirds', outcome: { ...outcome(19, []), rule: 'two_thirds', approved: false } })
    assert.equal(majorityText(amendment, amendment.outcome), 'Se aprueba con 2/3 · 19 votos')
  })

  test('approvalText: names the simple majority and uses the singular for one vote', () => {
    assert.equal(approvalText(decision({ approvalRule: 'simple' }), { ...outcome(1, []), rule: undefined }), 'Se aprueba con mayoría simple · 1 voto')
  })

  test('formatNames: no names give an empty text', () => {
    assert.equal(formatNames([]), '')
  })

  test('formatNames: one name is shown alone', () => {
    assert.equal(formatNames(['Elías']), 'Elías')
  })

  test('formatNames: several names are joined with commas and a final y', () => {
    assert.equal(formatNames(['Elías', 'Eliseo', 'Isaías']), 'Elías, Eliseo y Isaías')
  })

  test('votesText: one vote uses the singular', () => {
    assert.equal(votesText(1), '1 voto')
  })

  test('votesText: zero votes use the plural', () => {
    assert.equal(votesText(0), '0 votos')
  })
})

describe('decisions', () => {
  test('decisionVerdict: an approved yes or no decision is Aprobada', () => {
    assert.equal(decisionVerdict(decision(), decision().outcome), 'Aprobada')
  })

  test('decisionVerdict: a rejected yes or no decision is No aprobada', () => {
    const rejected = decision({ outcome: { ...outcome(29, []), approved: false } })

    assert.equal(decisionVerdict(rejected, rejected.outcome), 'No aprobada')
  })

  test('decisionVerdict: an options decision names the winning option', () => {
    const target = decision({ decisionFormat: 'options', ...counted([['Sede norte', 25], ['Sede sur', 11]]), outcome: outcome(20, ['Sede norte']) })

    assert.equal(decisionVerdict(target, target.outcome, target.results), 'Sede norte')
  })

  test('decisionVerdict: an options decision without a winner has no verdict', () => {
    const target = decision({ decisionFormat: 'options', outcome: outcome(20, [], ['Sede norte', 'Sede sur']) })

    assert.equal(decisionVerdict(target, target.outcome, target.results), '')
  })

  test('displayOrder: a yes or no decision keeps A favor first', () => {
    const results = [{ label: 'En contra', count: 30 }, { label: 'A favor', count: 6 }]

    assert.deepEqual(displayOrder(decision(), results).map(({ label }) => label), ['A favor', 'En contra'])
  })

  test('displayOrder: an election orders by votes', () => {
    const results = [{ label: 'Eliseo', count: 6 }, { label: 'Elías', count: 30 }]

    assert.deepEqual(displayOrder(round(), results).map(({ label }) => label), ['Elías', 'Eliseo'])
  })
})

describe('counts', () => {
  test('countsOf: a vote whose result is still being prepared has no counts', () => {
    assert.deepEqual(countsOf(round({ status: 'closed' })), [])
  })

  test('voteCountOf: finds an option by id', () => {
    assert.equal(voteCountOf(round(counted([['Elías', 3]])), { id: 'Elías', label: 'Elías' }), 3)
  })

  test('voteCountOf: falls back to the label when the id does not match', () => {
    assert.equal(voteCountOf(round(counted([['Elías', 3]])), { id: 'other-id', label: 'Elías' }), 3)
  })

  test('voteCountOf: an option without votes counts zero', () => {
    assert.equal(voteCountOf(round(counted([['Elías', 3]])), { id: 'Eliseo', label: 'Eliseo' }), 0)
  })
})

describe('actaSheetRows', () => {
  const statuses = { published: 'publicada', annulled: 'anulada', closed: 'cerrada' }

  test('actaSheetRows: starts with the header', () => {
    assert.equal(actaSheetRows([])[0]?.at(-1), 'Resultado')
  })

  test('actaSheetRows: one row per candidate with place, votes, share and result', () => {
    const target = round({ participationCount: 3, eligibleCount: 4, ...counted([['Elías', 2], ['Eliseo', 1]]), outcome: outcome(3, ['Elías'], [], 1, 4), officialResult: official(['Elías']) })

    const rows = actaSheetRows([target], statuses).slice(1)

    assert.deepEqual(rows, [
      ['Presidente', 'publicada', '3 de 4 votaron · 1 no votó', 1, 'Elías', 2, 50, '', 'Electo/a'],
      ['Presidente', 'publicada', '3 de 4 votaron · 1 no votó', 2, 'Eliseo', 1, 25, '', 'No continúa'],
    ])
  })

  test('actaSheetRows: an annulled vote shows its reason in one row', () => {
    const target = round({ title: 'Secretario', status: 'annulled', annulReason: 'Error', participationCount: 2, eligibleCount: undefined })

    assert.deepEqual(actaSheetRows([target], statuses)[1], ['Secretario', 'anulada: Error', '2 votaron', '', '', '', '', '', ''])
  })

  test('actaSheetRows: a vote without published counts says so', () => {
    const target = round({ status: 'closed' })

    assert.deepEqual(actaSheetRows([target], statuses)[1], ['Presidente', 'cerrada (conteo no publicado)', '36 de 38 votaron · 2 no votaron', '', '', '', '', '', ''])
  })

  test('actaSheetRows: an annulled vote does not repeat the elected of other votes', () => {
    const target = round({ status: 'annulled', annulReason: 'Error', officialResult: official(['Elías']) })

    assert.equal(actaSheetRows([target], statuses)[1]?.at(-1), '')
  })

  describe('a committee decided over two votes', () => {
    const root = committee({
      participationCount: 10,
      eligibleCount: 10,
      ...counted([['Elías', 7], ['Eliseo', 5], ['Isaías', 5], ['Jeremías', 3]]),
      outcome: outcome(6, ['Elías'], ['Eliseo', 'Isaías'], 3, 10),
      officialResult: official(['Elías', 'Isaías', 'Eliseo']),
    })
    const last = committee({
      id: 'c2',
      committeeRootRoundId: 'c1',
      runoff: true,
      electionSeats: 2,
      voteNumber: 2,
      participationCount: 10,
      eligibleCount: 11,
      regionalSecretaryVotes: true,
      ...counted([['Isaías', 7], ['Eliseo', 6]]),
      outcome: outcome(6, ['Isaías', 'Eliseo'], [], 2, 11),
    })

    test('actaSheetRows: each row says what its own vote decided', () => {
      const rows = actaSheetRows([root, last], statuses).slice(1)

      assert.deepEqual(rows.map((row) => [row[0], row[4], row[8]]), [
        ['Comisión de Finanzas', 'Elías', 'Electo/a'],
        ['Comisión de Finanzas', 'Eliseo', 'Pasa'],
        ['Comisión de Finanzas', 'Isaías', 'Pasa'],
        ['Comisión de Finanzas', 'Jeremías', 'No continúa'],
        ['Comisión de Finanzas · DESEMPATE · 2.ª VOTACIÓN', 'Isaías', 'Electo/a'],
        ['Comisión de Finanzas · DESEMPATE · 2.ª VOTACIÓN', 'Eliseo', 'Electo/a'],
      ])
    })

    test('actaSheetRows: only the last vote lists the completed committee', () => {
      const rows = actaSheetRows([root, last], statuses).slice(1)

      assert.equal(rows[0]?.[1], 'publicada')
      assert.equal(rows[4]?.[1], 'publicada · Comisión completa: Elías, Isaías, Eliseo')
    })

    test('actaSheetRows: participation notes the regional secretary', () => {
      const rows = actaSheetRows([root, last], statuses).slice(1)

      assert.equal(rows[4]?.[2], '10 de 11 votaron · 1 no votó · Con la secretaría regional')
    })
  })
})

describe('actaKind', () => {
  test('actaKind: the first vote is numbered 1', () => {
    assert.deepEqual(actaKind(round()), { text: '1.ª VOTACIÓN', tone: 'vote' })
  })

  test('actaKind: a runoff is labeled as such', () => {
    assert.deepEqual(actaKind(round({ voteNumber: 2, runoff: true })), { text: 'DESEMPATE · 2.ª VOTACIÓN', tone: 'vote' })
  })

  test('actaKind: a repeat after an annulled vote is numbered without the runoff label', () => {
    assert.equal(actaKind(round({ voteNumber: 2 })).text, '2.ª VOTACIÓN')
  })

  test('actaKind: the vote number can be passed in', () => {
    assert.equal(actaKind(committee({ voteNumber: 3 }), 1).text, '1.ª VOTACIÓN')
  })

  test('actaKind: an annulled vote is marked annulled', () => {
    assert.deepEqual(actaKind(round({ status: 'annulled' })), { text: 'ANULADA', tone: 'annulled' })
  })

  test('actaKind: an approved decision is marked approved', () => {
    assert.deepEqual(actaKind(decision()), { text: 'DECISIÓN · APROBADA', tone: 'approved' })
  })

  test('actaKind: a rejected decision is marked rejected', () => {
    assert.deepEqual(actaKind(decision({ outcome: { ...outcome(29, []), approved: false } })), { text: 'DECISIÓN · NO APROBADA', tone: 'rejected' })
  })

  test('actaKind: a decision without a result shows only DECISIÓN', () => {
    assert.equal(actaKind(decision({ outcome: undefined })).text, 'DECISIÓN')
  })
})

describe('actaMetaText', () => {
  test('actaMetaText: an office shows participation and majority', () => {
    assert.equal(actaMetaText(round({ outcome: outcome(20, []) })), '36 de 38 votaron · 2 no votaron · Mayoría: 20')
  })

  test('actaMetaText: a committee starts with its members', () => {
    assert.equal(actaMetaText(committee({ outcome: outcome(20, [], [], 3) })), '3 integrantes · 36 de 38 votaron · 2 no votaron · Mayoría: 20')
  })

  test('actaMetaText: a committee runoff starts with the seats left', () => {
    assert.equal(actaMetaText(committee({ runoff: true, outcome: outcome(20, [], [], 2) })), '2 puestos · 36 de 38 votaron · 2 no votaron · Mayoría: 20')
  })

  test('actaMetaText: a committee runoff without a result uses its election seats', () => {
    assert.equal(actaMetaText(committee({ runoff: true, electionSeats: 1 })), '1 puesto · 36 de 38 votaron · 2 no votaron')
  })

  test('actaMetaText: a decision starts with its approval rule', () => {
    assert.equal(actaMetaText(decision()), 'Se aprueba con 3/4 · 29 votos · 36 de 38 votaron · 2 no votaron')
  })

  test('actaMetaText: an annulled vote shows only its reason', () => {
    assert.equal(actaMetaText(round({ status: 'annulled', annulReason: 'Error en la papeleta' })), 'Error en la papeleta')
  })

  test('actaMetaText: an annulled vote without a reason shows nothing', () => {
    assert.equal(actaMetaText(round({ status: 'annulled', annulReason: null })), '')
  })

  test('actaMetaText: notes the regional secretary', () => {
    assert.match(actaMetaText(round({ regionalSecretaryVotes: true })), /Con la secretaría regional/)
  })
})

describe('actaRows', () => {
  test('actaRows: a first vote marks the candidates going to the runoff', () => {
    const target = round({ ...counted([['Elías', 18], ['Eliseo', 12], ['Isaías', 6]]), outcome: outcome(20, [], ['Elías', 'Eliseo']) })

    const rows = actaRows(target)

    assert.deepEqual(rows.map(({ rank, label, count, percent, tag, winner }) => [rank, label, count, percent, tag, winner]), [
      [1, 'Elías', 18, 47, 'Desempate', false],
      [2, 'Eliseo', 12, 32, 'Desempate', false],
      [3, 'Isaías', 6, 16, null, false],
    ])
  })

  test('actaRows: the elected candidate is the winner', () => {
    const target = round({ ...counted([['Elías', 25], ['Eliseo', 12]]), outcome: outcome(20, ['Elías']) })

    assert.deepEqual(actaRows(target)[0], { key: 'Elías', rank: 1, label: 'Elías', count: 25, percent: 66, tag: 'Electo/a', winner: true })
  })

  test('actaRows: an approved decision tags A favor', () => {
    assert.deepEqual(actaRows(decision()).map(({ label, tag }) => [label, tag]), [['A favor', 'Aprobada'], ['En contra', null]])
  })

  test('actaRows: a rejected decision has no tags', () => {
    const target = decision({ outcome: { ...outcome(29, []), approved: false } })

    assert.deepEqual(actaRows(target).map(({ tag }) => tag), [null, null])
  })

  test('actaRows: without a computed result only a tie is marked, and without a base there is no share', () => {
    const target = round({ eligibleCount: undefined, ...counted([['Elías', 2], ['Eliseo', 2]]) })

    assert.deepEqual(actaRows(target).map(({ tag, percent }) => [tag, percent]), [['Desempate', null], ['Desempate', null]])
  })
})

describe('actaSummary', () => {
  test('actaSummary: counts the eligible, the votes and the annulled', () => {
    const rounds = [round(), round({ status: 'annulled' }), decision()]

    assert.equal(actaSummary(rounds, 38), '38 habilitados · 3 votaciones · 1 anulada')
  })

  test('actaSummary: uses the singular for one', () => {
    assert.equal(actaSummary([round()], 1), '1 habilitado · 1 votación')
  })

  test('actaSummary: uses the plural for several annulled', () => {
    const annulled = round({ status: 'annulled' })

    assert.equal(actaSummary([annulled, annulled], 5), '5 habilitados · 2 votaciones · 2 anuladas')
  })
})

describe('orgChart', () => {
  function position(group: Position['group'], label: string, sortOrder: number): Position {
    return { id: label, group, label, sortOrder, custom: false, elected: null }
  }

  const positions = [
    position('board', 'Presidente', 0),
    position('board', 'Vicepresidente', 1),
    position('board', 'Secretario', 2),
    position('board', 'Tesorero', 3),
    position('department', 'Escuela Sabática', 100),
    position('department', 'Jóvenes', 101),
    position('department', 'Mayordomía', 102),
  ]

  test('orgChart: the first two board positions go on top', () => {
    const chart = orgChart([...positions].reverse())

    assert.deepEqual(chart.boardTop.map(({ label }) => label), ['Presidente', 'Vicepresidente'])
    assert.deepEqual(chart.boardBottom.map(({ label }) => label), ['Secretario', 'Tesorero'])
  })

  test('orgChart: departments go in rows of two', () => {
    const chart = orgChart([...positions].reverse())

    assert.deepEqual(chart.departmentRows.map((row) => row.map(({ label }) => label)), [['Escuela Sabática', 'Jóvenes'], ['Mayordomía']])
  })

  test('orgChart: no positions give an empty chart', () => {
    assert.deepEqual(orgChart([]), { boardTop: [], boardBottom: [], departmentRows: [] })
  })
})

describe('electedSoFar', () => {
  const committee = { category: 'committee' as const, memberCount: 5 }
  const three = [{ label: 'Isaías' }, { label: 'Jeremías' }, { label: 'Ezequiel' }]
  const five = [...three, { label: 'Daniel' }, { label: 'Oseas' }]

  test('electedSoFar: a committee of five with three elected lists them with the seat count', () => {
    assert.deepEqual(electedSoFar(committee, three, null), { title: 'Electos hasta ahora · 3 de 5', names: 'Isaías · Jeremías · Ezequiel' })
  })

  test('electedSoFar: the wording never says final or official while seats are open', () => {
    assert.doesNotMatch(electedSoFar(committee, three, null)!.title, /final|oficial/i)
  })

  test('electedSoFar: a complete election has no preliminary block', () => {
    assert.equal(electedSoFar(committee, five, null), null)
    assert.equal(electedSoFar(committee, five, { elected: five, approved: null }), null)
  })

  test('electedSoFar: nobody elected yet shows nothing', () => {
    assert.equal(electedSoFar(committee, [], null), null)
    assert.equal(electedSoFar(committee, undefined, null), null)
  })

  test('electedSoFar: an office or decision is never partial', () => {
    assert.equal(electedSoFar({ category: 'office', memberCount: null }, [{ label: 'Isaías' }], null), null)
    assert.equal(electedSoFar({ category: 'decision', memberCount: null }, [{ label: 'Sí' }], null), null)
    assert.equal(electedSoFar(undefined, three, null), null)
  })
})
