export function connectedInBase(baseIds: readonly string[], onlineIds: Iterable<string>) {
  const base = new Set(baseIds)
  if (base.size !== baseIds.length) throw new Error('The base lists a person more than once')
  const online = new Set(onlineIds)
  let connected = 0
  for (const id of base) if (online.has(id)) connected += 1
  return { connected, base: base.size }
}
