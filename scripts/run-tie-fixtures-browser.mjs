const args = process.argv.slice(2)
const headed = args.includes('--headed')
const rest = args.filter((arg) => arg !== '--headed')

process.env.E2E_API_PORT ??= '3342'
process.env.E2E_WEB_PORT ??= '4142'
if (headed) process.env.E2E_SLOWMO ??= '350'

process.argv = [process.argv[0], process.argv[1], 'tie-sessions', ...(headed ? ['--headed'] : []), ...rest]

await import('./run-e2e-integration.mjs')
