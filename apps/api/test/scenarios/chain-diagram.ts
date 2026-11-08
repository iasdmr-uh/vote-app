import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type ChainVote = {
  number: number
  base: number
  threshold: number
  tally: Array<{ label: string; count: number }>
  abstained: number
  elected: string[]
  continuing: string[]
  note?: string
  approved?: boolean
}

const ordinal = (number: number) => `${number}.ª votación`
const list = (labels: string[]) => (labels.length ? labels.join(', ') : 'nadie')

function nodeText(vote: ChainVote) {
  const counts = vote.tally.map(({ label, count }) => `${label} ${count}`).join(' · ')
  const lines = [ordinal(vote.number), counts, `base ${vote.base} · mayoría ${vote.threshold} · sin votar ${vote.abstained}`]
  if (vote.note) lines.splice(1, 0, vote.note)
  if (vote.approved !== undefined) lines.push(vote.approved ? 'aprobada' : 'no aprobada')
  else lines.push(`electos: ${list(vote.elected)}`)
  return lines.join('<br/>')
}

export function chainMermaid(title: string, votes: ChainVote[]) {
  const lines = ['flowchart LR', `  %% ${title}`]
  for (const vote of votes) lines.push(`  V${vote.number}["${nodeText(vote)}"]`)
  votes.forEach((vote, index) => {
    const following = votes[index + 1]
    if (following) lines.push(`  V${vote.number} -->|"sigue: ${list(vote.continuing)}"| V${following.number}`)
    else if (vote.continuing.length) lines.push(`  V${vote.number} -->|"sigue: ${list(vote.continuing)}"| NEXT(["próxima votación preparada"])`)
  })
  return `${lines.join('\n')}\n`
}

export function chainSummary(title: string, votes: ChainVote[]) {
  const rows = votes.map((vote) => {
    const counts = vote.tally.map(({ label, count }) => `${label} ${count}`).join(', ')
    const outcome = vote.approved !== undefined ? (vote.approved ? 'aprobada' : 'no aprobada') : `electos ${list(vote.elected)}`
    const next = vote.continuing.length ? ` -> sigue ${list(vote.continuing)}` : ''
    return `  ${ordinal(vote.number)} [base ${vote.base}, mayoría ${vote.threshold}] ${counts} | ${outcome}${next}`
  })
  return [title, ...rows].join('\n')
}

export function writeChain(directory: string, id: string, title: string, votes: ChainVote[]) {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, `${id}.mmd`), chainMermaid(title, votes))
  console.log(chainSummary(title, votes))
}
