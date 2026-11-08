import type { Ref } from 'vue'

export const ACTION_NOTICE_MS = 5000

export function showTransientNotice(notice: Ref<string>, text: string, schedule: (run: () => void, ms: number) => void, ms = ACTION_NOTICE_MS) {
  notice.value = text
  schedule(() => {
    if (notice.value === text) notice.value = ''
  }, ms)
}
