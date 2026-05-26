import { defineConfig } from 'reactive-vscode'

export const configs = defineConfig<{
  userName: string
}>('p2p-live-share')
