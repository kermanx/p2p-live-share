import { defineService, useVscodeContext } from 'reactive-vscode'

export const useTunnelsTree = defineService(() => {
  useVscodeContext('p2p-live-share:supportsTunnels', false)
})
