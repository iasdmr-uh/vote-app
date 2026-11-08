import { join } from 'node:path'
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { writeChain, type ChainVote } from '../../../apps/api/test/fixtures/chain-diagram.js'
import { candidatesOf, expandBallots, seatsOf, seededShuffle, sorted } from '../../../apps/api/test/fixtures/session-tools.js'
import { fixtures, type Fixture, type Vote } from '../../../apps/api/test/fixtures/tie-sessions.js'
import { api, castVoteByApi, closeAndPublish, confirm, expectBadge, finishLiveAssembly, mesaRow, moderatorState, openMesa, openProjector, prepareBallot, projectorRow } from './helpers'

const slowMo = Number(process.env.E2E_SLOWMO ?? 0)
const seed = Number(process.env.TIE_FIXTURES_SEED ?? 29)
const outputDirectory = join(process.env.TIE_FIXTURES_OUT ?? join(process.cwd(), 'test-results', 'tie-fixtures'), 'browser')

test.describe.configure({ timeout: slowMo ? 3_600_000 : 300_000 })

type Option = { id: string; label: string }
type MesaRound = {
  id: string
  status: string
  options: Option[]
  eligibleCount: number
  participationCount: number
  privateResults?: Array<{ label: string; count: number }>
  results?: Array<{ label: string; count: number }>
  outcome?: { threshold: number; elected: string[]; runoff: string[] }
}

const labelsOf = (options: Option[], ids: string[]) => ids.map((id) => options.find((option) => option.id === id)!.label)

async function joinDelegates(request: APIRequestContext, joinCode: string, count: number) {
  const tokens: string[] = []
  for (let number = 1; number <= count; number += 1) {
    const response = await request.post(`${api}/assemblies/${encodeURIComponent(joinCode)}/join`, { data: { firstName: 'Delegado', lastName: String(number).padStart(2, '0') } })
    expect(response.ok(), await response.text()).toBeTruthy()
    tokens.push((await response.json()).participantSessionToken)
  }
  return tokens
}

async function addRegionalSecretary(browser: Browser, mesa: Page, person: { firstName: string; lastName: string }, total: number) {
  const ballot = mesa.locator('.ballot-card')
  await ballot.getByRole('textbox', { name: 'Nombre de la secretaría regional' }).fill(person.firstName)
  await ballot.getByRole('textbox', { name: 'Apellido de la secretaría regional' }).fill(person.lastName)
  const added = mesa.waitForResponse((response) => response.url().endsWith('/regional-secretary') && response.request().method() === 'POST')
  await ballot.getByRole('button', { name: 'Agregar a la secretaría regional' }).click()
  const { resumeUrl } = await (await added).json()
  await expect(ballot.locator('.regional-secretary')).toContainText(`Votan ${total} en total`)
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage()
  await page.goto(resumeUrl)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBeTruthy()
  return (await page.evaluate(() => localStorage.getItem('participantSessionToken')))!
}

async function addCandidate(mesa: Page, label: string) {
  const input = mesa.getByLabel('Nombre del candidato')
  await expect(input).toBeVisible()
  await input.fill(label)
  await mesa.getByRole('button', { name: '+ Agregar' }).click()
  await expect(mesa.locator('.ballot-card .runoff-candidates li').filter({ hasText: label }).locator('.badge')).toHaveText('Nuevo')
}

async function prepareFirstBallot(mesa: Page, fixture: Fixture) {
  const candidates = candidatesOf(fixture, 0)
  if (fixture.kind === 'committee') return prepareBallot(mesa, { kind: 'committee', title: fixture.office, seats: fixture.seats, candidates })
  if (fixture.kind === 'decision') return prepareBallot(mesa, { kind: 'decision', title: fixture.office, format: 'boolean', rule: 'simple' })
  return prepareBallot(mesa, { kind: 'office', title: fixture.office, candidates })
}

async function playVote(args: { browser: Browser; request: APIRequestContext; mesa: Page; assemblyId: string; tokens: string[]; fixture: Fixture; vote: Vote; index: number; secretaryToken: string | null }) {
  const { browser, request, mesa, assemblyId, tokens, fixture, vote, index } = args
  let secretaryToken = args.secretaryToken

  if (index > 0) {
    await mesa.getByRole('button', { name: /^Abrir desempate/ }).click()
    if (index === 1) {
      await mesa.getByRole('dialog').getByRole('button', { name: 'Abrir votación', exact: true }).click()
      await expect(mesa.locator('.confirmation-dialog')).toHaveCount(0)
    } else {
      if (vote.before && 'addCandidate' in vote.before) await addCandidate(mesa, vote.before.addCandidate)
      if (vote.before && 'addRegionalSecretary' in vote.before) secretaryToken = await addRegionalSecretary(browser, mesa, vote.before.addRegionalSecretary, fixture.delegates + 1)
      await confirm(mesa, 'Abrir votación')
    }
  } else {
    await confirm(mesa, 'Abrir votación')
  }
  await expect(mesa.getByText('VOTACIÓN ABIERTA', { exact: true })).toBeVisible()

  const open = (await moderatorState(request, assemblyId)).rounds.find((round: MesaRound) => round.status === 'open') as MesaRound
  const idsOf = (labels: string[]) => labels.map((label) => open.options.find((option) => option.label === label)!.id)
  const ballots = seededShuffle(expandBallots(vote.ballots, fixture.delegates), seed + index)
  let cast = 0
  for (const { delegate, marks } of ballots) {
    if (!marks.length) continue
    const response = await castVoteByApi(request, tokens[delegate - 1]!, open.id, idsOf(marks))
    expect(response.ok(), await response.text()).toBeTruthy()
    cast += 1
  }
  if (vote.secretaryMarks) {
    const response = await castVoteByApi(request, secretaryToken!, open.id, idsOf(vote.secretaryMarks))
    expect(response.ok(), await response.text()).toBeTruthy()
    cast += 1
  }
  await expect(mesa.locator('.vote-progress strong')).toHaveText(String(cast))
  return { secretaryToken, roundId: open.id }
}

function chainOf(state: { rounds: MesaRound[] }, fixture: Fixture) {
  const settled = state.rounds.filter((round) => round.status === 'published' && round.outcome)
  return settled.map((round, index): ChainVote => {
    const counts = round.results ?? round.privateResults ?? []
    return {
      number: index + 1,
      base: round.eligibleCount,
      threshold: round.outcome!.threshold,
      tally: counts.map((row) => ({ label: row.label, count: row.count })),
      abstained: round.eligibleCount - round.participationCount,
      elected: labelsOf(round.options, round.outcome!.elected),
      continuing: labelsOf(round.options, round.outcome!.runoff),
      note: fixture.votes[index]?.before ? ('addCandidate' in fixture.votes[index]!.before! ? `candidato nuevo: ${fixture.votes[index]!.before!.addCandidate}` : 'con la secretaría regional') : undefined,
    }
  })
}

const sessions = ['02-', '03-', '04-', '05-', '06-', '07-'].map((prefix) => fixtures.find((fixture) => fixture.id.startsWith(prefix))!)

for (const fixture of sessions) {
  test(`${fixture.id}: the mesa drives the whole chain on the real stack`, async ({ browser, request }) => {
    await finishLiveAssembly(request)
    const { mesa, joinCode, assemblyId } = await openMesa(browser, `Fixture ${fixture.office}`)
    const projector = await openProjector(browser, joinCode)
    const tokens = await joinDelegates(request, joinCode, fixture.delegates)
    await expect(mesa.locator('.mesa-participants .count-pill')).toHaveText(String(fixture.delegates))
    await confirm(mesa, 'Cerrar ingreso')
    await expect(mesa.getByRole('button', { name: 'Reabrir ingreso' })).toBeVisible()
    const room = { mesa, projector, phones: [], joinCode, assemblyId }

    await prepareFirstBallot(mesa, fixture)

    let secretaryToken: string | null = null
    const electedBefore: string[] = []
    for (const [index, vote] of fixture.votes.entries()) {
      const played = await playVote({ browser, request, mesa, assemblyId, tokens, fixture, vote, index, secretaryToken })
      secretaryToken = played.secretaryToken
      await closeAndPublish(room)

      const state = await moderatorState(request, assemblyId)
      const round = state.rounds.find((item: MesaRound) => item.id === played.roundId) as MesaRound
      const elected = labelsOf(round.options, round.outcome!.elected)
      const continuing = labelsOf(round.options, round.outcome!.runoff)
      expect(sorted(elected), `vote ${index + 1} elected`).toEqual(sorted(vote.expect.elected))
      expect(sorted(continuing), `vote ${index + 1} continuing`).toEqual(sorted(vote.expect.continuing))
      expect(round.eligibleCount, `vote ${index + 1} base`).toBe(vote.expect.base)
      expect(round.outcome!.threshold, `vote ${index + 1} threshold`).toBe(vote.expect.threshold)
      expect(Object.fromEntries((round.results ?? []).map((row) => [row.label, row.count]))).toEqual(vote.expect.tally)
      expect(elected.length, 'elected never exceed the seats').toBeLessThanOrEqual(seatsOf(fixture, index))
      expect(elected.filter((label) => continuing.includes(label) || electedBefore.includes(label)), 'nobody is elected and continuing').toEqual([])
      electedBefore.push(...elected)

      for (const label of vote.expect.elected) {
        await expectBadge(mesaRow(mesa, label), 'Electo/a')
        await expectBadge(projectorRow(projector, label), '✓ Electo/a')
      }
      for (const label of vote.expect.continuing) await expectBadge(mesaRow(mesa, label), 'Desempate')

      const drafts = state.rounds.filter((item: MesaRound) => item.status === 'draft')
      expect(drafts.length, `vote ${index + 1} prepares the next vote`).toBe(vote.expect.next ? 1 : 0)
      if (vote.expect.next) await expect(mesa.getByRole('button', { name: /^Abrir desempate/ })).toBeVisible()
      else await expect(mesa.getByRole('button', { name: /^Abrir desempate/ })).toHaveCount(0)
    }

    expect(sorted(electedBefore)).toEqual(sorted(fixture.votes.flatMap((vote) => vote.expect.elected)))
    writeChain(outputDirectory, fixture.id, `${fixture.office} (navegador)`, chainOf(await moderatorState(request, assemblyId), fixture))
  })
}
