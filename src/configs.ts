import { defineConfig } from 'reactive-vscode'

export const configs = defineConfig<{
  servers: string[]
  userName: string
  trystero: object
  terminal: {
    dimensionsSource: 'host' | 'creator' | 'minimum' | 'maximum'
  }
}>('p2p-live-share')
