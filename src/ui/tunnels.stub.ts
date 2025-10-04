import { createSingletonComposable, useVscodeContext } from 'reactive-vscode'

export const useTunnelsTree = createSingletonComposable(() => {
  useVscodeContext('p2p-live-share:supportsTunnels', false)
})
