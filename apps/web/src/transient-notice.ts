import type { Ref } from 'vue'

export const ACTION_NOTICE_MS = 5000

const generations = new WeakMap<Ref<string>, number>()

export function showTransientNotice(notice: Ref<string>, text: string, schedule: (run: () => void, ms: number) => void, ms = ACTION_NOTICE_MS) {
  const generation = (generations.get(notice) ?? 0) + 1
  generations.set(notice, generation)
  notice.value = text
  schedule(() => {
    if (generations.get(notice) === generation && notice.value === text) notice.value = ''
  }, ms)
}
