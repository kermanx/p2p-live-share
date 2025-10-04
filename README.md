# P2P Live Share

[![Version](https://img.shields.io/visual-studio-marketplace/v/kermanx.p2p-live-share)](https://marketplace.visualstudio.com/items?itemName=kermanx.p2p-live-share) [![Installs](https://img.shields.io/visual-studio-marketplace/i/kermanx.p2p-live-share)](https://marketplace.visualstudio.com/items?itemName=kermanx.p2p-live-share) [![Reactive VSCode](https://img.shields.io/badge/made_with-reactive--vscode-%23007ACC?style=flat&labelColor=%23229863)](https://kermanx.com/reactive-vscode/)

A Peer-to-Peer and Open-Source alternative to [Live Share](https://visualstudio.microsoft.com/services/live-share/).

## Features

- Collaborative editing
- Workspace files sync
- Remote LSP & Diagnostics
- Shared terminal
- Chat

## VSCode Web

This extension also works in [VSCode Web](https://vscode.dev/). You can join a session on your browser after installing the extension, and enjoy the same collaborative editing features, terminals and language service provided by the host.

## Connectivity

### Secure Peer-to-Peer Connections

Powered by [trystero](https://github.com/dmotz/trystero), P2P Live Share establishes direct connections between peers using WebRTC.

### Self Hosting

Besides Peer-to-Peer connections, you can also self-host a WebSocket relay server to improve connectivity.

```bash
bunx p2p-live-share-ws-server@latest
# Supports --port and --hostname options
```

Or you can deploy the pre-built binary [ws-server](https://github.com/kermanx/p2p-live-share/releases/download/latest/ws-server).

#### 腾讯云 Serverless

- 新用户前三个月免费
- 假设每月调用30次，每次60分钟，流量共300M，则费用约为1元
- 实测单程延迟（client -> host）约为 35ms

**部署步骤：**

1. 打开腾讯云 Serverless 云函数（不是 Serverless Container）
2. 新建
   - "从头开始"
   - 函数类型：Web函数
   - 运行环境：Go 1
   - 函数代码："本地上传zip包"，上传 [serverless.zip](https://github.com/kermanx/p2p-live-share/releases/download/latest/serverless.zip)
   - 高级配置：
     - 内存：64MB
     - 请求多并发：自定义静态并发：100
     - WebSocket支持：启用，空闲时间 120秒
   - 函数URL配置：开启公网访问

3. 部署后，进入 "函数 URL" 栏目下，复制公网访问的 `wss://` 地址。在 VSCode 中点击 Share 后，填入该地址即可。
