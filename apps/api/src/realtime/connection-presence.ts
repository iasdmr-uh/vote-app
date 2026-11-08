import { CONNECTION_GRACE_MS } from './connection-timing.js'

export type Schedule = (run: () => void, ms: number) => () => void

export const scheduleWithTimers: Schedule = (run, ms) => {
  const timer = setTimeout(run, ms)
  return () => clearTimeout(timer)
}

type Person = { sockets: number; cancelDrop?: () => void }

export class ConnectionPresence {
  private readonly assemblies = new Map<string, Map<string, Person>>()
  private readonly listeners: Array<(assemblyId: string) => void> = []

  constructor(private readonly schedule: Schedule) {}

  onChange(listener: (assemblyId: string) => void): void {
    this.listeners.push(listener)
  }

  online(assemblyId: string): string[] {
    return [...(this.assemblies.get(assemblyId)?.keys() ?? [])]
  }

  connect(assemblyId: string, participantId: string): void {
    const people = this.assemblies.get(assemblyId) ?? new Map<string, Person>()
    this.assemblies.set(assemblyId, people)
    const person = people.get(participantId)
    if (person) {
      person.sockets += 1
      person.cancelDrop?.()
      person.cancelDrop = undefined
      return
    }
    people.set(participantId, { sockets: 1 })
    this.notify(assemblyId)
  }

  disconnect(assemblyId: string, participantId: string): void {
    const people = this.assemblies.get(assemblyId)
    const person = people?.get(participantId)
    if (!people || !person || person.sockets === 0) return
    person.sockets -= 1
    if (person.sockets > 0) return
    person.cancelDrop = this.schedule(() => {
      people.delete(participantId)
      if (people.size === 0) this.assemblies.delete(assemblyId)
      this.notify(assemblyId)
    }, CONNECTION_GRACE_MS)
  }

  private notify(assemblyId: string): void {
    for (const listener of this.listeners) listener(assemblyId)
  }
}
