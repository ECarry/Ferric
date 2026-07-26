<div align="center">

# Ferric

**一个基于 Rust + Tauri 的现代化跨平台 SSH / SFTP 客户端**

_Rust · Tauri · React · TypeScript_

[English](./README.md) · 简体中文

</div>

---

Ferric 是一款轻量、快速、界面现代的桌面 SSH 客户端。后端使用纯 Rust 实现的
[`russh`](https://github.com/Eugeny/russh) / [`russh-sftp`](https://github.com/AspectUnk/russh-sftp)
协议栈(无需系统自带的 `ssh` 二进制),前端使用 React 19 + Tailwind CSS 构建,
通过 Tauri 打包为原生桌面应用。

> **名字由来:** _Ferric_ 意为「含铁的 / 三价铁」,是对 **Rust(铁锈)** 的双关 —— 整个协议栈由 Rust 驱动。

## ✨ 功能特性

- **交互式终端** —— 基于 xterm.js 的完整 PTY 终端,支持颜色、自适应窗口大小。
- **多服务器并行连接** —— 每个服务器拥有独立、持久的会话,切换标签不会断开已有连接。
- **SFTP 文件管理** —— 浏览远程目录、上传/下载文件、**递归下载整个文件夹**、新建目录、重命名、删除,带实时进度条。
- **服务器分组管理** —— 分组、拖拽排序、跨组移动、搜索过滤。
- **密码 & 密钥认证** —— 支持密码登录与私钥登录(可带 passphrase)。
- **安全的密钥存储** —— 密码存入操作系统钥匙串(macOS Keychain / Windows Credential Manager / Linux Secret Service),**不以明文写入磁盘**。
- **连接状态指示** —— 侧边栏对已连接服务器实时显示绿色状态点。

## 🧱 技术栈

| 层            | 技术                                                              |
| ------------- | --------------------------------------------------------------- |
| 桌面框架       | [Tauri 2](https://tauri.app)                                   |
| 后端           | Rust 2021 · `russh` · `russh-sftp` · `tokio` · `keyring`       |
| 前端           | React 19 · TypeScript · Vite                                   |
| 样式 / UI      | Tailwind CSS 4 · shadcn 风格组件 · `lucide-react` 图标         |
| 终端           | `@xterm/xterm` + fit / web-links 插件                          |

## 📂 项目结构

```
Ferric/
├── src/                      # 前端 (React + TypeScript)
│   ├── App.tsx               # 顶层状态:服务器/分组/标签/连接状态
│   ├── types.ts              # 共享类型 (Server / ServerGroup / RemoteFile ...)
│   ├── components/           # UI 组件
│   │   ├── Sidebar.tsx       # 服务器列表、分组、拖拽、搜索、状态点
│   │   ├── MainPanel.tsx     # 单服务器面板:连接管理 + 终端/SFTP 标签
│   │   ├── TerminalView.tsx  # xterm.js 终端封装
│   │   ├── FileBrowser.tsx   # SFTP 文件浏览器 + 上传/下载
│   │   ├── ServerFormModal.tsx # 新建/编辑服务器表单
│   │   └── ui/               # 基础 UI 组件 (button/input/tabs/...)
│   └── lib/                  # 前端 <-> 后端的 IPC 封装
│       ├── ssh.ts            # SSH 命令 & 事件
│       ├── sftp.ts           # SFTP 命令 & 事件
│       ├── store.ts          # 配置读写
│       └── utils.ts          # cn() 等工具
│
└── src-tauri/                # 后端 (Rust)
    └── src/
        ├── lib.rs            # Tauri 入口:注册 State 与所有命令
        ├── main.rs           # 二进制入口
        ├── ssh.rs            # SSH 会话:连接、PTY、输入/输出、resize
        ├── sftp.rs           # SFTP 会话:列目录、上传/下载、增删改
        └── store.rs          # 配置持久化 + 钥匙串密码管理
```

## 🧩 后端模块说明

### `ssh.rs` — 交互式 SSH 终端

- `SshManager` —— 以会话 id 为键,保存每个活动会话的输入通道 (`mpsc::Sender`)。
- `connect_and_auth()` —— 建立连接并完成密码 / 公钥认证,是 SSH 与 SFTP 共用的底层。
- `run_loop()` —— 每个会话的事件循环:把前端输入转发给远程 shell,并把 shell 输出以 `ssh:data` 事件回传前端;会话结束时发出 `ssh:closed`。

### `sftp.rs` — SFTP 文件传输

- `SftpManager` —— 保存每个 SFTP 会话(独立于终端的一条 SSH 连接)。
- 目录遍历使用迭代式栈遍历,`sftp_download_dir` 支持**递归下载整个目录树**并汇总进度。
- 传输进度通过 `sftp:download-progress` 事件(约每 100ms 节流)回传。

### `store.rs` — 配置与密钥

- `Config` = `servers[] + groups[]`,以 JSON 存于系统应用配置目录 (`config.json`)。
- **密码不写入 JSON**:保存时剥离明文并写入钥匙串(服务名 `com.ferric.ssh`),加载时再回填。

## 🔌 后端 API(Tauri Commands)

所有命令通过前端 `invoke('<command>', args)` 调用,均在 `src-tauri/src/lib.rs` 注册。

### SSH

| 命令               | 参数                                   | 返回        | 说明                              |
| ------------------ | -------------------------------------- | ----------- | --------------------------------- |
| `ssh_connect`      | `config: ConnectConfig`                | `String` id | 建立 SSH 连接并打开交互式 PTY     |
| `ssh_send_input`   | `id: String, data: String`             | `()`        | 向远程 shell 发送按键 / 输入      |
| `ssh_resize`       | `id: String, cols: u32, rows: u32`     | `()`        | 通知远程 PTY 终端尺寸变化         |
| `ssh_disconnect`   | `id: String`                           | `()`        | 关闭 SSH 会话                     |

**事件:** `ssh:data`(`{ id, data: number[] }`,shell 输出) · `ssh:closed`(`{ id }`,会话结束)

### SFTP

| 命令                 | 参数                                                 | 返回              | 说明                        |
| -------------------- | --------------------------------------------------- | ----------------- | --------------------------- |
| `sftp_connect`       | `config: ConnectConfig`                             | `String` id       | 打开独立的 SFTP 会话        |
| `sftp_home`          | `id`                                                | `String`          | 解析远程主目录绝对路径      |
| `sftp_list`          | `id, path`                                          | `RemoteFile[]`    | 列出目录内容(目录优先排序) |
| `sftp_download`      | `id, remotePath, localPath`                         | `()`              | 下载单个文件(带进度)      |
| `sftp_download_dir`  | `id, remotePath, localPath`(本地父目录)            | `()`              | **递归下载文件夹**(带进度) |
| `sftp_upload`        | `id, localPath, remotePath`                         | `()`              | 上传本地文件                |
| `sftp_mkdir`         | `id, path`                                          | `()`              | 新建远程目录                |
| `sftp_remove`        | `id, path, isDir`                                   | `()`              | 删除文件 / 空目录           |
| `sftp_rename`        | `id, from, to`                                      | `()`              | 重命名 / 移动               |
| `sftp_disconnect`    | `id`                                                | `()`              | 关闭 SFTP 会话              |

**事件:** `sftp:download-progress`(`{ id, transferred, total }`)

### 配置 / 密钥

| 命令                    | 参数              | 返回      | 说明                             |
| ----------------------- | ----------------- | --------- | -------------------------------- |
| `load_config`           | —                 | `Config`  | 读取配置并从钥匙串回填密码       |
| `save_config`           | `config: Config`  | `()`      | 保存配置,密码写入钥匙串         |
| `delete_server_secret`  | `serverId`        | `()`      | 从钥匙串删除某服务器的密码       |

### `ConnectConfig` 结构

```ts
interface ConnectConfig {
  host: string
  port: number
  username: string
  authType: 'password' | 'key'
  password?: string
  keyPath?: string
  keyPassphrase?: string
  cols?: number   // 仅终端需要
  rows?: number   // 仅终端需要
}
```

## 🚀 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) 1.77+
- Tauri 系统依赖(见 [Tauri 前置条件](https://tauri.app/start/prerequisites/))

### 安装与运行

```bash
# 安装前端依赖
npm install

# 启动开发环境(前端 + Tauri 桌面窗口,支持热更新)
npm run tauri:dev

# 构建发布版安装包
npm run tauri:build
```

### 其他脚本

```bash
npm run dev      # 仅启动 Vite 前端(浏览器,无后端能力)
npm run build    # 类型检查 + 前端构建
npm run lint     # ESLint 检查
```

## 🔐 安全说明

- 服务器密码存储于**操作系统钥匙串**,配置文件 `config.json` 中不含明文密码。
- 当前实现出于简化在 `Client::check_server_key` 中**接受任意主机公钥**;生产环境应校验 `known_hosts`。

## 📝 许可

基于 [MIT 许可证](./LICENSE) 开源。
