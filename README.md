![P2P Live Share](https://raw.githubusercontent.com/kermanx/p2p-live-share/main/assets/internal/social-preview.png)

[![Version](https://img.shields.io/github/v/release/kermanx/p2p-live-share)](https://marketplace.visualstudio.com/items?itemName=kermanx.p2p-live-share) [![Installs](https://img.shields.io/visual-studio-marketplace/i/kermanx.p2p-live-share)](https://marketplace.visualstudio.com/items?itemName=kermanx.p2p-live-share) [![Reactive VSCode](https://img.shields.io/badge/made_with-reactive--vscode-%23007ACC?style=flat&labelColor=%23229863)](https://kermanx.com/reactive-vscode/)

A Peer-to-Peer and Open-Source alternative to [Live Share](https://visualstudio.microsoft.com/services/live-share/).

This VSCode extension enables real-time collaborative editing, and...

- Remote Language Service
- Terminal Sharing
- Port Forwarding
- Chat with Images
- Text Selection Sharing
- Workspace Files Sync

You can install this extension by searching "[**P2P Live Share**](https://marketplace.visualstudio.com/items?itemName=kermanx.p2p-live-share)" in the [extension panel](https://code.visualstudio.com/docs/getstarted/extensions#_browse-extensions) of VSCode or Cursor.

To start sharing, click the "Share" button in the P2P Live Share panel, which you can find on the [Activity Bar](https://code.visualstudio.com/docs/getstarted/userinterface#_basic-layout).

![Screenshot](https://raw.githubusercontent.com/kermanx/p2p-live-share/main/assets/internal/screenshot.png)

#### No Account Required

You won't need to sign in any account to use it. You can also improve it's security and connectivity by [self-hosting a relay server](#self-hosting). By default, it uses public signaling servers listed by [trystero](https://github.com/dmotz/trystero).

#### VSCode Web Support

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

Or you can run the pre-built binary [ws-server](https://github.com/kermanx/p2p-live-share/releases/latest/download/ws-server).

#### Tencent Cloud Serverless

对于中国用户，若需自行部署，目前作者找到的较好方案是腾讯云的 Serverless 云函数：

- 新用户前三个月免费
- 假设每月调用 30 次，每次 60 分钟，流量共 300M，则费用约为 1 元
- 实测单程延迟（client -> host）约为 35ms

<details>
<summary>腾讯云 Serverless 云函数部署步骤</summary>

**部署步骤：**

1. 打开腾讯云 Serverless 云函数（不是 Serverless Container）

2. 新建函数，选择以下配置：
  - 创建方式：从头开始
  - 函数类型：Web函数
  - 运行环境：Go 1
  - 函数代码：选择“本地上传 zip 包”，上传 [serverless.zip](https://github.com/kermanx/p2p-live-share/releases/latest/download/serverless.zip)
  - 高级配置：
    - 内存：64MB
    - 请求多并发：自定义静态并发，设置为 100
    - WebSocket 支持：启用，空闲时间设置为 120 秒
  - 函数 URL 配置：开启公网访问

3. 部署完成后，进入“函数 URL”栏目，复制公网访问的 `wss://` 地址。在 VSCode 中点击 Share 后，填入该地址即可。

</details>

## Disclaimer

This project is released under the MIT License. It is not affiliated with, endorsed by, or sponsored by Microsoft Corporation.

This project is not intended to replace Live Share, but to provide a free and open-source alternative for users who need it. As a official product, Live Share has access to [VSCode Proposed APIs](https://code.visualstudio.com/api/advanced-topics/using-proposed-api), which enables more advanced features such as sharing any opened terminals.

This project is not stable yet. Please make sure to only share non-sensitive files. The author is not responsible for any data loss or leakage.

Part of the code under the `src/terminal/pty` folder is adapted from VSCode.
