import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ref } from 'vue'
import { ACTION_NOTICE_MS, showTransientNotice } from '../../src/transient-notice'

function fakeTimer() {
  const pending: Array<{ run: () => void; ms: number }> = []
  return { pending, schedule: (run: () => void, ms: number) => { pending.push({ run, ms }) } }
}

describe('showTransientNotice', () => {
  test('shows the notice right away', () => {
    const notice = ref('')
    const timer = fakeTimer()
    showTransientNotice(notice, 'Acción registrada.', timer.schedule)
    assert.equal(notice.value, 'Acción registrada.')
  })

  test('clears the notice after the action notice time', () => {
    const notice = ref('')
    const timer = fakeTimer()
    showTransientNotice(notice, 'Acción registrada.', timer.schedule)
    assert.equal(timer.pending[0]!.ms, ACTION_NOTICE_MS)
    timer.pending[0]!.run()
    assert.equal(notice.value, '')
  })

  test('keeps a newer notice when the time runs out', () => {
    const notice = ref('')
    const timer = fakeTimer()
    showTransientNotice(notice, 'Acción registrada.', timer.schedule)
    notice.value = 'La Asamblea quedó finalizada.'
    timer.pending[0]!.run()
    assert.equal(notice.value, 'La Asamblea quedó finalizada.')
  })

  test('keeps a repeated notice until its own time runs out', () => {
    const notice = ref('')
    const timer = fakeTimer()
    showTransientNotice(notice, 'Acción registrada.', timer.schedule)
    showTransientNotice(notice, 'Acción registrada.', timer.schedule)
    timer.pending[0]!.run()
    assert.equal(notice.value, 'Acción registrada.')
    timer.pending[1]!.run()
    assert.equal(notice.value, '')
  })
})
