import { defineConfig } from 'reactive-vscode'

export const configs = defineConfig<{
  userName: string
  terminal: {
    dimensionsSource: 'host' | 'creator' | 'minimum' | 'maximum'
  }
}>('p2p-live-share')
