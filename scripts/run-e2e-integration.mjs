import { spawn, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'

const root = process.cwd()
const containerName = `vote-app-e2e-${process.pid}-${randomUUID().slice(0, 8)}`
const password = `e2e-${randomUUID()}`
let containerStarted = false
let testProcess
let stopping = false
let localClusterDir
let localClusterStarted = false

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options })
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    const safeArgs = args.map((arg, index) => args[index - 1] === '--env' && arg.includes('=') ? `${arg.split('=', 1)[0]}=<redacted>` : arg)
    throw new Error(`${command} ${safeArgs.join(' ')} failed${details ? `:\n${details}` : ''}`)
  }
  return result.stdout.trim()
}

function start(command, args, options = {}) {
  return new Promise((resolveStart, rejectStart) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options })
    child.once('error', rejectStart)
    child.once('exit', (code, signal) => {
      if (stopping) return resolveStart(1)
      resolveStart(code ?? (signal ? 1 : 0))
    })
    testProcess = child
  })
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const check = spawnSync('docker', ['exec', containerName, 'pg_isready', '-U', 'asdmr_e2e', '-d', 'asdmr_e2e'], { encoding: 'utf8' })
    if (check.status === 0) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000))
  }
  throw new Error('PostgreSQL did not become ready within 60 seconds')
}

async function cleanup() {
  if (localClusterStarted) {
    spawnSync('pg_ctl', ['-D', join(localClusterDir, 'data'), '-m', 'fast', '-w', 'stop'], { cwd: root, stdio: 'ignore' })
    localClusterStarted = false
  }
  if (localClusterDir) {
    await rm(localClusterDir, { recursive: true, force: true })
    localClusterDir = undefined
  }
  if (containerStarted) {
    spawnSync('docker', ['rm', '--force', containerName], { cwd: root, stdio: 'ignore' })
    containerStarted = false
  }
}

function hasCommand(command) {
  return spawnSync('which', [command], { encoding: 'utf8' }).status === 0
}

async function unusedPort() {
  const server = createServer()
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not select a local PostgreSQL port')
  await new Promise((resolveClose) => server.close(resolveClose))
  return address.port
}

async function startLocalPostgres() {
  if (!['initdb', 'pg_ctl', 'createdb'].every(hasCommand)) {
    throw new Error('Docker is unavailable and local PostgreSQL tools (initdb, pg_ctl, createdb) are not installed')
  }
  localClusterDir = await mkdtemp(join(tmpdir(), 'vote-app-e2e-'))
  const dataDir = join(localClusterDir, 'data')
  const database = 'asdmr_e2e'
  const user = process.env.USER
  if (!user) throw new Error('Could not determine the local PostgreSQL user')
  const port = await unusedPort()
  run('initdb', ['-D', dataDir, '--username', user, '--auth-local=trust', '--auth-host=trust', '--no-instructions'])
  run('pg_ctl', ['-D', dataDir, '-l', join(localClusterDir, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'])
  localClusterStarted = true
  run('createdb', ['-h', '127.0.0.1', '-p', String(port), database])
  return `postgresql://${encodeURIComponent(user)}@127.0.0.1:${port}/${database}`
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    stopping = true
    testProcess?.kill(signal)
    void cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143))
  })
}

try {
  const commit = run('git', ['rev-parse', '--verify', 'HEAD'])
  const branch = run('git', ['branch', '--show-current'])
  const dirty = Boolean(run('git', ['status', '--porcelain']))
  const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '')
  const resultDir = resolve(root, 'test-results', `e2e-real-${commit.slice(0, 12)}${dirty ? '-dirty' : ''}-${stamp}`)
  await mkdir(resultDir, { recursive: true })
  await writeFile(resolve(resultDir, 'metadata.json'), `${JSON.stringify({
    suite: 'playwright-e2e-real-postgres',
    commit,
    branch,
    dirty,
    startedAt: new Date().toISOString(),
  }, null, 2)}\n`)

  let databaseUrl
  try {
    run('docker', ['run', '--detach', '--rm', '--name', containerName, '--env', 'POSTGRES_DB=asdmr_e2e', '--env', 'POSTGRES_USER=asdmr_e2e', '--env', `POSTGRES_PASSWORD=${password}`, '--publish', '127.0.0.1::5432', 'postgres:17-alpine'])
    containerStarted = true
    const mapping = run('docker', ['port', containerName, '5432/tcp'])
    const port = Number(mapping.slice(mapping.lastIndexOf(':') + 1))
    if (!Number.isInteger(port) || port < 1) throw new Error('Could not determine the temporary PostgreSQL port')
    databaseUrl = `postgresql://asdmr_e2e:${encodeURIComponent(password)}@127.0.0.1:${port}/asdmr_e2e`
    await waitForPostgres()
  } catch (dockerError) {
    if (containerStarted) {
      spawnSync('docker', ['rm', '--force', containerName], { cwd: root, stdio: 'ignore' })
      containerStarted = false
    }
    if (!['initdb', 'pg_ctl', 'createdb'].every(hasCommand)) throw dockerError
    console.log('Docker is unavailable; using a temporary local PostgreSQL cluster instead.')
    databaseUrl = await startLocalPostgres()
  }

  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    MODERATOR_ACCESS_TOKEN: 'e2e-only-moderator-token-32-characters-minimum',
    PLAYWRIGHT_JSON_OUTPUT_NAME: resolve(resultDir, 'results.json'),
    PLAYWRIGHT_OUTPUT_DIR: resolve(resultDir, 'artifacts'),
  }
  run('npm', ['run', 'db:generate', '--workspace', '@asdmr/api'], { env })
  run('npm', ['run', 'db:deploy', '--workspace', '@asdmr/api'], { env })

  console.log(`Running real API + PostgreSQL browser flow for ${commit.slice(0, 12)} (${branch || 'detached HEAD'}${dirty ? ', working tree dirty' : ''}).`)
  const code = await start('npx', ['playwright', 'test', '--config=playwright.integration.config.ts'], { env })
  if (code !== 0) process.exitCode = code
  console.log(`Integration evidence: ${resolve(resultDir, 'metadata.json')} and ${resolve(resultDir, 'results.json')}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await cleanup()
}
