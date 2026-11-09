import { test as base, type Page, type Request, type Route } from '@playwright/test'

export type Reply = { status?: number; json?: unknown; body?: string; contentType?: string; headers?: Record<string, string> }

export interface ApiCall {
  request: Request
  method: string
  url: URL
  path: string
  json: () => any
}

export type Handler = (call: ApiCall) => Reply | undefined | void | Promise<Reply | undefined | void>
type Answer = Reply | Handler
type PathMatch = string | RegExp

const defaults: Handler[] = [
  ({ path }) => path.endsWith('/moderator/session') ? { json: { authenticated: true } } : undefined,
  ({ path }) => path.endsWith('/moderator/assemblies/active') ? { json: { assembly: null } } : undefined,
]

export class MockApi {
  private handlers: Handler[] = []

  constructor(readonly page: Page) {}

  on(handler: Handler) {
    this.handlers.unshift(handler)
    return this
  }

  route(method: string, path: PathMatch, answer: Answer) {
    return this.on((call) => {
      if (method !== '*' && call.method !== method) return undefined
      if (typeof path === 'string' ? !call.path.endsWith(path) : !path.test(call.path)) return undefined
      return typeof answer === 'function' ? answer(call) : answer
    })
  }

  get(path: PathMatch, answer: Answer) { return this.route('GET', path, answer) }
  post(path: PathMatch, answer: Answer) { return this.route('POST', path, answer) }
  patch(path: PathMatch, answer: Answer) { return this.route('PATCH', path, answer) }
  delete(path: PathMatch, answer: Answer) { return this.route('DELETE', path, answer) }
  any(path: PathMatch, answer: Answer) { return this.route('*', path, answer) }

  reset() {
    this.handlers = []
  }

  async attach() {
    await this.page.route('**/api/v1/**', (route) => this.handle(route))
  }

  private async handle(route: Route) {
    const request = route.request()
    const url = new URL(request.url())
    const call: ApiCall = { request, method: request.method(), url, path: url.pathname.replace(/^.*?\/api\/v1/, ''), json: () => request.postDataJSON() }
    for (const handler of [...this.handlers, ...defaults]) {
      const reply = await handler(call)
      if (reply) {
        await route.fulfill(reply)
        return
      }
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route' } })
  }
}

export const test = base.extend<{ api: MockApi }>({
  api: async ({ page }, use) => {
    const api = new MockApi(page)
    await api.attach()
    await use(api)
  },
})

export { expect } from '@playwright/test'
