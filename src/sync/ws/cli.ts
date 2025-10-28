#!/usr/bin/env node

import process from 'node:process'
import { parseArgs } from 'node:util'
import { createServer } from './server'

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    port: { type: 'string', short: 'p' },
    hostname: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
    manualDelay: { type: 'string' },
    dualStack: { type: 'boolean', default: true },
  },
  strict: true,
  allowPositionals: false,
})

if (values.help) {
  // Minimal aligned usage info
  console.log(`p2p-live-share WebSocket signaling server\n\n`
    + `Usage:\n  npx p2p-live-share-ws-server@latest [options]\n\n`
    + `Options:\n`
    + `  -p, --port <number>       Port to listen on (default: 8080)\n`
    + `      --hostname <host>     Hostname / interface to bind (default: :: for dual-stack)\n`
    + `      --dualStack          Enable dual-stack (IPv4 + IPv6) mode (default: true)\n`
    + `      --manualDelay <ms>   Add artificial delay to message forwarding (for testing)\n`
    + `  -h, --help               Show this help message and exit\n\n`
    + `Examples:\n`
    + `  npx p2p-live-share-ws-server@latest\n`
    + `  npx p2p-live-share-ws-server@latest -p 9000\n`
    + `  npx p2p-live-share-ws-server@latest --port 9000 --hostname 0.0.0.0  # IPv4 only\n`
    + `  npx p2p-live-share-ws-server@latest --port 9000 --hostname ::       # Dual-stack\n`)
  process.exit(0)
}

let port: number = 8080
if (values.port) {
  const parsed = Number.parseInt(values.port, 10)
  if (Number.isNaN(parsed) || parsed <= 0 || parsed > 65535) {
    console.error(`Invalid --port value: ${values.port}. Expected an integer 1-65535.`)
    process.exit(1)
  }
  port = parsed
}

const hostname = values.hostname || '::'
const manualDelay = values.manualDelay ? Number.parseInt(values.manualDelay, 10) : 0

// Format hostname for display in URL (wrap IPv6 addresses in brackets)
const displayHost = hostname.includes(':') ? `[${hostname}]` : hostname

const server = createServer({
  port,
  hostname,
  manualDelay,
  onServerStart: ({ port, hostname }) => {
    console.info('Starting WebSocket server with Node.js...')
    console.info(`Listening on ws://${displayHost}:${port}/`)
    if (values.dualStack !== false && hostname === '::') {
      console.info('Dual-stack mode enabled: accepting both IPv4 and IPv6 connections')
    }
  },
  onError: (error: Error) => {
    console.error('Server error:', error)
  },
  onPeerJoin: (peerId, roomId) => {
    console.info(`Peer ${peerId} joined room ${roomId}`)
  },
  onPeerLeave: (peerId, roomId) => {
    console.info(`Peer ${peerId} left room ${roomId}`)
  },
  onRoomEmpty: (roomId) => {
    console.info(`Room ${roomId} is now empty and has been removed.`)
  },
})

server.start()

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.info('\nShutting down server...')
  server.stop()
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.info('\nShutting down server...')
  server.stop()
  process.exit(0)
})
