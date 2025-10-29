import type { ConfigType } from 'reactive-vscode'
import { defineConfigObject } from 'reactive-vscode'

export const configs = defineConfigObject('p2p-live-share', {
  servers: Object as ConfigType<string[]>,
  userName: String,
  trysteroConfig: Object,
})

export const terminalConfigs = defineConfigObject('p2p-live-share.terminal', {
  dimensionsSource: Object as ConfigType<'host' | 'creator' | 'minimum' | 'maximum'>,
})
