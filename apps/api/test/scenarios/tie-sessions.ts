export type Group = { delegates: [number, number]; marks: string[] }

export type MesaAction =
  | { addCandidate: string }
  | { addRegionalSecretary: { firstName: string; lastName: string } }

export type Expectation = {
  base: number
  threshold: number
  tally: Record<string, number>
  abstained: number
  elected: string[]
  continuing: string[]
  openSeats: number
  next: boolean
  approved?: boolean
}

export type Vote = {
  before?: MesaAction
  annulledAttempt?: { reason: string; ballots: Group[] }
  ballots: Group[]
  secretaryMarks?: string[]
  expect: Expectation
}

export type Fixture = {
  id: string
  office: string
  kind: 'office' | 'committee' | 'decision'
  seats: number
  delegates: number
  candidates: string[]
  setupRejected?: boolean
  votes: Vote[]
}

const secretary = { firstName: 'Sofonías', lastName: 'Regional' }

export const fixtures: Fixture[] = [
  {
    id: '01-presidente-clear-majority',
    office: 'Presidente',
    kind: 'office',
    seats: 1,
    delegates: 38,
    candidates: ['Elías', 'Eliseo', 'Isaías'],
    votes: [
      {
        ballots: [
          { delegates: [1, 25], marks: ['Elías'] },
          { delegates: [26, 33], marks: ['Eliseo'] },
          { delegates: [34, 38], marks: ['Isaías'] },
        ],
        expect: { base: 38, threshold: 20, tally: { 'Elías': 25, 'Eliseo': 8, 'Isaías': 5 }, abstained: 0, elected: ['Elías'], continuing: [], openSeats: 0, next: false },
      },
    ],
  },
  {
    id: '02-vicepresidente-four-way-tie',
    office: 'Vicepresidente',
    kind: 'office',
    seats: 1,
    delegates: 38,
    candidates: ['Isaías', 'Jeremías', 'Daniel', 'Oseas', 'Joel'],
    votes: [
      {
        ballots: [
          { delegates: [1, 14], marks: ['Isaías'] },
          { delegates: [15, 20], marks: ['Jeremías'] },
          { delegates: [21, 26], marks: ['Daniel'] },
          { delegates: [27, 32], marks: ['Oseas'] },
          { delegates: [33, 38], marks: ['Joel'] },
        ],
        expect: { base: 38, threshold: 20, tally: { 'Isaías': 14, 'Jeremías': 6, 'Daniel': 6, 'Oseas': 6, 'Joel': 6 }, abstained: 0, elected: [], continuing: ['Isaías', 'Jeremías', 'Daniel', 'Oseas', 'Joel'], openSeats: 1, next: true },
      },
      {
        ballots: [
          { delegates: [1, 16], marks: ['Isaías'] },
          { delegates: [17, 24], marks: ['Jeremías'] },
          { delegates: [25, 32], marks: ['Daniel'] },
          { delegates: [33, 35], marks: ['Oseas'] },
          { delegates: [36, 38], marks: ['Joel'] },
        ],
        expect: { base: 38, threshold: 20, tally: { 'Isaías': 16, 'Jeremías': 8, 'Daniel': 8, 'Oseas': 3, 'Joel': 3 }, abstained: 0, elected: [], continuing: ['Isaías', 'Jeremías', 'Daniel'], openSeats: 1, next: true },
      },
      {
        ballots: [
          { delegates: [1, 16], marks: ['Isaías'] },
          { delegates: [17, 27], marks: ['Jeremías'] },
          { delegates: [28, 38], marks: ['Daniel'] },
        ],
        expect: { base: 38, threshold: 20, tally: { 'Isaías': 16, 'Jeremías': 11, 'Daniel': 11 }, abstained: 0, elected: [], continuing: ['Isaías', 'Jeremías', 'Daniel'], openSeats: 1, next: true },
      },
      {
        ballots: [
          { delegates: [1, 19], marks: ['Isaías'] },
          { delegates: [20, 29], marks: ['Jeremías'] },
          { delegates: [30, 38], marks: ['Daniel'] },
        ],
        expect: { base: 38, threshold: 20, tally: { 'Isaías': 19, 'Jeremías': 10, 'Daniel': 9 }, abstained: 0, elected: [], continuing: ['Isaías', 'Jeremías'], openSeats: 1, next: true },
      },
      {
        ballots: [
          { delegates: [1, 20], marks: ['Isaías'] },
          { delegates: [21, 38], marks: ['Jeremías'] },
        ],
        expect: { base: 38, threshold: 20, tally: { 'Isaías': 20, 'Jeremías': 18 }, abstained: 0, elected: ['Isaías'], continuing: [], openSeats: 0, next: false },
      },
    ],
  },
  {
    id: '03-secretario-regional-secretary-decides',
    office: 'Secretario',
    kind: 'office',
    seats: 1,
    delegates: 38,
    candidates: ['Elías', 'Eliseo'],
    votes: [
      {
        ballots: [
          { delegates: [1, 19], marks: ['Elías'] },
          { delegates: [20, 38], marks: ['Eliseo'] },
        ],
        expect: { base: 38, threshold: 20, tally: { 'Elías': 19, 'Eliseo': 19 }, abstained: 0, elected: [], continuing: ['Elías', 'Eliseo'], openSeats: 1, next: true },
      },
      {
        ballots: [
          { delegates: [1, 19], marks: ['Eliseo'] },
          { delegates: [20, 38], marks: ['Elías'] },
        ],
        expect: { base: 38, threshold: 20, tally: { 'Elías': 19, 'Eliseo': 19 }, abstained: 0, elected: [], continuing: ['Elías', 'Eliseo'], openSeats: 1, next: true },
      },
      {
        ballots: [
          { delegates: [1, 19], marks: ['Elías'] },
          { delegates: [20, 38], marks: ['Eliseo'] },
        ],
        expect: { base: 38, threshold: 20, tally: { 'Elías': 19, 'Eliseo': 19 }, abstained: 0, elected: [], continuing: ['Elías', 'Eliseo'], openSeats: 1, next: true },
      },
      {
        before: { addRegionalSecretary: secretary },
        ballots: [
          { delegates: [1, 19], marks: ['Elías'] },
          { delegates: [20, 38], marks: ['Eliseo'] },
        ],
        secretaryMarks: ['Eliseo'],
        expect: { base: 39, threshold: 20, tally: { 'Elías': 19, 'Eliseo': 20 }, abstained: 0, elected: ['Eliseo'], continuing: [], openSeats: 0, next: false },
      },
    ],
  },
  {
    id: '04-tesorero-secretary-still-short',
    office: 'Tesorero',
    kind: 'office',
    seats: 1,
    delegates: 38,
    candidates: ['Elías', 'Eliseo'],
    votes: [
      {
        ballots: [
          { delegates: [1, 18], marks: ['Elías'] },
          { delegates: [19, 36], marks: ['Eliseo'] },
          { delegates: [37, 38], marks: [] },
        ],
        expect: { base: 38, threshold: 20, tally: { 'Elías': 18, 'Eliseo': 18 }, abstained: 2, elected: [], continuing: ['Elías', 'Eliseo'], openSeats: 1, next: true },
      },
      {
        ballots: [
          { delegates: [1, 18], marks: ['Eliseo'] },
          { delegates: [19, 36], marks: ['Elías'] },
          { delegates: [37, 38], marks: [] },
        ],
        expect: { base: 38, threshold: 20, tally: { 'Elías': 18, 'Eliseo': 18 }, abstained: 2, elected: [], continuing: ['Elías', 'Eliseo'], openSeats: 1, next: true },
      },
      {
        ballots: [
          { delegates: [1, 18], marks: ['Elías'] },
          { delegates: [19, 36], marks: ['Eliseo'] },
          { delegates: [37, 38], marks: [] },
        ],
        expect: { base: 38, threshold: 20, tally: { 'Elías': 18, 'Eliseo': 18 }, abstained: 2, elected: [], continuing: ['Elías', 'Eliseo'], openSeats: 1, next: true },
      },
      {
        before: { addRegionalSecretary: secretary },
        ballots: [
          { delegates: [1, 18], marks: ['Elías'] },
          { delegates: [19, 36], marks: ['Eliseo'] },
          { delegates: [37, 38], marks: [] },
        ],
        secretaryMarks: ['Elías'],
        expect: { base: 39, threshold: 20, tally: { 'Elías': 19, 'Eliseo': 18 }, abstained: 2, elected: [], continuing: ['Elías', 'Eliseo'], openSeats: 1, next: true },
      },
      {
        ballots: [
          { delegates: [1, 19], marks: ['Elías'] },
          { delegates: [20, 38], marks: ['Eliseo'] },
        ],
        secretaryMarks: ['Elías'],
        expect: { base: 39, threshold: 20, tally: { 'Elías': 20, 'Eliseo': 19 }, abstained: 0, elected: ['Elías'], continuing: [], openSeats: 0, next: false },
      },
    ],
  },
  {
    id: '05-vocales-tie-at-the-cut',
    office: 'Vocales',
    kind: 'committee',
    seats: 3,
    delegates: 38,
    candidates: ['Elías', 'Eliseo', 'Isaías', 'Jeremías', 'Daniel', 'Oseas'],
    votes: [
      {
        ballots: [
          { delegates: [1, 12], marks: ['Elías', 'Eliseo', 'Jeremías'] },
          { delegates: [13, 18], marks: ['Elías', 'Eliseo', 'Daniel'] },
          { delegates: [19, 25], marks: ['Elías', 'Isaías', 'Daniel'] },
          { delegates: [26, 30], marks: ['Elías', 'Isaías', 'Oseas'] },
          { delegates: [31, 34], marks: ['Eliseo', 'Isaías', 'Oseas'] },
          { delegates: [35, 38], marks: ['Eliseo', 'Jeremías', 'Oseas'] },
        ],
        expect: { base: 38, threshold: 20, tally: { 'Elías': 30, 'Eliseo': 26, 'Isaías': 16, 'Jeremías': 16, 'Daniel': 13, 'Oseas': 13 }, abstained: 0, elected: ['Elías', 'Eliseo'], continuing: ['Isaías', 'Jeremías'], openSeats: 1, next: true },
      },
      {
        ballots: [
          { delegates: [1, 19], marks: ['Isaías'] },
          { delegates: [20, 38], marks: ['Jeremías'] },
        ],
        expect: { base: 38, threshold: 20, tally: { 'Isaías': 19, 'Jeremías': 19 }, abstained: 0, elected: [], continuing: ['Isaías', 'Jeremías'], openSeats: 1, next: true },
      },
      {
        ballots: [
          { delegates: [1, 18], marks: ['Isaías'] },
          { delegates: [19, 38], marks: ['Jeremías'] },
        ],
        expect: { base: 38, threshold: 20, tally: { 'Isaías': 18, 'Jeremías': 20 }, abstained: 0, elected: ['Jeremías'], continuing: [], openSeats: 0, next: false },
      },
    ],
  },
  {
    id: '06-jovenes-candidate-added-at-vote-3',
    office: 'Jóvenes',
    kind: 'office',
    seats: 1,
    delegates: 38,
    candidates: ['Débora', 'Samuel', 'Natán'],
    votes: [
      {
        ballots: [
          { delegates: [1, 15], marks: ['Débora'] },
          { delegates: [16, 28], marks: ['Samuel'] },
          { delegates: [29, 38], marks: ['Natán'] },
        ],
        expect: { base: 38, threshold: 20, tally: { 'Débora': 15, 'Samuel': 13, 'Natán': 10 }, abstained: 0, elected: [], continuing: ['Débora', 'Samuel'], openSeats: 1, next: true },
      },
      {
        ballots: [
          { delegates: [1, 19], marks: ['Débora'] },
          { delegates: [20, 38], marks: ['Samuel'] },
        ],
        expect: { base: 38, threshold: 20, tally: { 'Débora': 19, 'Samuel': 19 }, abstained: 0, elected: [], continuing: ['Débora', 'Samuel'], openSeats: 1, next: true },
      },
      {
        before: { addCandidate: 'Habacuc' },
        ballots: [
          { delegates: [1, 9], marks: ['Débora'] },
          { delegates: [10, 17], marks: ['Samuel'] },
          { delegates: [18, 38], marks: ['Habacuc'] },
        ],
        expect: { base: 38, threshold: 20, tally: { 'Débora': 9, 'Samuel': 8, 'Habacuc': 21 }, abstained: 0, elected: ['Habacuc'], continuing: [], openSeats: 0, next: false },
      },
    ],
  },
  {
    id: '07-musica-abstentions-block-majority',
    office: 'Música',
    kind: 'office',
    seats: 1,
    delegates: 38,
    candidates: ['Joel', 'Amós', 'Jonás'],
    votes: [
      {
        ballots: [
          { delegates: [1, 12], marks: ['Joel'] },
          { delegates: [13, 19], marks: ['Amós'] },
          { delegates: [20, 24], marks: ['Jonás'] },
          { delegates: [25, 38], marks: [] },
        ],
        expect: { base: 38, threshold: 20, tally: { 'Joel': 12, 'Amós': 7, 'Jonás': 5 }, abstained: 14, elected: [], continuing: ['Joel', 'Amós'], openSeats: 1, next: true },
      },
      {
        ballots: [
          { delegates: [1, 21], marks: ['Joel'] },
          { delegates: [22, 32], marks: ['Amós'] },
          { delegates: [33, 38], marks: [] },
        ],
        expect: { base: 38, threshold: 20, tally: { 'Joel': 21, 'Amós': 11 }, abstained: 6, elected: ['Joel'], continuing: [], openSeats: 0, next: false },
      },
    ],
  },
  {
    id: '08-salud-annulled-then-repeated',
    office: 'Salud',
    kind: 'office',
    seats: 1,
    delegates: 38,
    candidates: ['Natán', 'Samuel', 'Débora'],
    votes: [
      {
        annulledAttempt: {
          reason: 'Papeleta con un nombre mal escrito',
          ballots: [
            { delegates: [1, 25], marks: ['Natán'] },
            { delegates: [26, 38], marks: ['Samuel'] },
          ],
        },
        ballots: [
          { delegates: [1, 15], marks: ['Natán'] },
          { delegates: [16, 28], marks: ['Samuel'] },
          { delegates: [29, 38], marks: ['Débora'] },
        ],
        expect: { base: 38, threshold: 20, tally: { 'Natán': 15, 'Samuel': 13, 'Débora': 10 }, abstained: 0, elected: [], continuing: ['Natán', 'Samuel'], openSeats: 1, next: true },
      },
      {
        ballots: [
          { delegates: [1, 21], marks: ['Natán'] },
          { delegates: [22, 38], marks: ['Samuel'] },
        ],
        expect: { base: 38, threshold: 20, tally: { 'Natán': 21, 'Samuel': 17 }, abstained: 0, elected: ['Natán'], continuing: [], openSeats: 0, next: false },
      },
    ],
  },
  {
    id: '09-decision-tie-is-not-approved',
    office: 'Presupuesto 2027',
    kind: 'decision',
    seats: 1,
    delegates: 38,
    candidates: ['A favor', 'En contra'],
    votes: [
      {
        ballots: [
          { delegates: [1, 19], marks: ['A favor'] },
          { delegates: [20, 38], marks: ['En contra'] },
        ],
        expect: { base: 38, threshold: 20, tally: { 'A favor': 19, 'En contra': 19 }, abstained: 0, elected: [], continuing: [], openSeats: 0, next: false, approved: false },
      },
    ],
  },
  {
    id: '10-edge-zero-votes',
    office: 'Auditor',
    kind: 'office',
    seats: 1,
    delegates: 38,
    candidates: ['Elías', 'Eliseo', 'Isaías'],
    votes: [
      {
        ballots: [{ delegates: [1, 38], marks: [] }],
        expect: { base: 38, threshold: 20, tally: { 'Elías': 0, 'Eliseo': 0, 'Isaías': 0 }, abstained: 38, elected: [], continuing: ['Elías', 'Eliseo', 'Isaías'], openSeats: 1, next: true },
      },
    ],
  },
  {
    id: '11-edge-everyone-tied',
    office: 'Niños',
    kind: 'office',
    seats: 1,
    delegates: 38,
    candidates: ['Elías', 'Eliseo', 'Isaías'],
    votes: [
      {
        ballots: [
          { delegates: [1, 12], marks: ['Elías'] },
          { delegates: [13, 24], marks: ['Eliseo'] },
          { delegates: [25, 36], marks: ['Isaías'] },
          { delegates: [37, 38], marks: [] },
        ],
        expect: { base: 38, threshold: 20, tally: { 'Elías': 12, 'Eliseo': 12, 'Isaías': 12 }, abstained: 2, elected: [], continuing: ['Elías', 'Eliseo', 'Isaías'], openSeats: 1, next: true },
      },
    ],
  },
  {
    id: '12-edge-more-seats-than-candidates',
    office: 'Vocales',
    kind: 'committee',
    seats: 3,
    delegates: 38,
    candidates: ['Elías', 'Eliseo'],
    setupRejected: true,
    votes: [
      {
        ballots: [
          { delegates: [1, 30], marks: ['Elías', 'Eliseo'] },
          { delegates: [31, 38], marks: [] },
        ],
        expect: { base: 38, threshold: 20, tally: { 'Elías': 30, 'Eliseo': 30 }, abstained: 8, elected: ['Elías', 'Eliseo'], continuing: [], openSeats: 1, next: false },
      },
    ],
  },
]
