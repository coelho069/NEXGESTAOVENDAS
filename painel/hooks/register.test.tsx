import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'painel',
  component: 'Pane',
  requestId: 'painel',
  props: {
    title: 'Painel de Agentes',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('the pane renders agent panel', async ($, on) => {
  on('command.register', () => ({ value: { command: 'painel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const row = await ui.find({ type: 'Text', text: /Painel/ })
  expect(row?.text).toBeDefined()
  await ui.unmount()
})
