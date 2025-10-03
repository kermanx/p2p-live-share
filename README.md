# P2P Live Share

[![Version](https://img.shields.io/visual-studio-marketplace/v/kermanx.p2p-live-share)](https://marketplace.visualstudio.com/items?itemName=kermanx.p2p-live-share) [![Installs](https://img.shields.io/visual-studio-marketplace/i/kermanx.p2p-live-share)](https://marketplace.visualstudio.com/items?itemName=kermanx.p2p-live-share) [![Reactive VSCode](https://img.shields.io/badge/made_with-reactive--vscode-%23007ACC?style=flat&labelColor=%23229863)](https://kermanx.com/reactive-vscode/)

A Peer-to-Peer and Open-Source alternative to [Live Share](https://visualstudio.microsoft.com/services/live-share/).

## Features

- Collaborative editing
- Workspace files sync
- Remote LSP & Diagnostics
- Shared terminal
- Chat

## Connectivity

### Secure Peer-to-Peer Connections

Powered by [trystero](https://github.com/dmotz/trystero), P2P Live Share establishes direct connections between peers using WebRTC.

### Self Hosting

Besides Peer-to-Peer connections, you can also self-host a WebSocket relay server to improve connectivity.

```bash
bunx p2p-live-share-ws-server@latest
# Supports --port and --hostname options
```
