<div align="center">

# Ferric

**A modern, cross-platform SSH / SFTP client built with Rust + Tauri**

_Rust · Tauri · React · TypeScript_

English · [简体中文](./README.zh-CN.md)

</div>

---

Ferric is a lightweight, fast, and modern desktop SSH client. The backend is
powered by a pure-Rust protocol stack —
[`russh`](https://github.com/Eugeny/russh) /
[`russh-sftp`](https://github.com/AspectUnk/russh-sftp) — so it does **not** shell
out to the system `ssh` binary. The frontend is built with React 19 + Tailwind CSS
and packaged as a native desktop app via Tauri.

> **About the name:** _Ferric_ means "containing iron / iron(III)", a pun on
> **Rust** — the entire protocol stack is driven by Rust.

## ✨ Features

- **Interactive terminal** — a full PTY terminal powered by xterm.js, with colors and auto-resizing.
- **Multiple concurrent connections** — each server keeps its own persistent session; switching tabs never disconnects an active session.
- **SFTP file management** — browse remote directories, upload / download files, **recursively download whole folders**, create directories, rename, and delete, all with a live progress bar.
- **Remote Docker management** — inspect the remote Docker server, list all containers, and start, stop, or restart them from the connection workspace.
- **Server organization** — groups, drag-and-drop reordering, moving across groups, and search filtering.
- **Password & key auth** — supports password login and private-key login (with optional passphrase).
- **Secure secret storage** — passwords are stored in the OS keychain (macOS Keychain / Windows Credential Manager / Linux Secret Service) and are **never written to disk in plaintext**.
- **Connection status indicator** — the sidebar shows a live green dot for connected servers.

## 🧱 Tech Stack

| Layer            | Technology                                                     |
| ---------------- | -------------------------------------------------------------- |
| Desktop shell    | [Tauri 2](https://tauri.app)                                   |
| Backend          | Rust 2021 · `russh` · `russh-sftp` · `tokio` · `keyring`       |
| Frontend         | React 19 · TypeScript · Vite                                   |
| Styling / UI     | Tailwind CSS 4 · shadcn-style components · `lucide-react` icons |
| Terminal         | `@xterm/xterm` + fit / web-links addons                        |

## 📂 Project Structure

```
Ferric/
├── src/                      # Frontend (React + TypeScript)
│   ├── App.tsx               # Top-level state: servers / groups / tabs / connection status
│   ├── types.ts              # Shared types (Server / ServerGroup / RemoteFile ...)
│   ├── components/           # UI components
│   │   ├── Sidebar.tsx       # Server list, groups, drag & drop, search, status dot
│   │   ├── MainPanel.tsx     # Per-server panel: connection mgmt + terminal / SFTP tabs
│   │   ├── TerminalView.tsx  # xterm.js terminal wrapper
│   │   ├── FileBrowser.tsx   # SFTP file browser + upload / download
│   │   ├── docker/DockerView.tsx # Remote Docker container management
│   │   ├── ServerFormModal.tsx # Create / edit server form
│   │   └── ui/               # Base UI components (button/input/tabs/...)
│   └── lib/                  # Frontend <-> backend IPC wrappers
│       ├── ssh.ts            # SSH commands & events
│       ├── sftp.ts           # SFTP commands & events
│       ├── docker.ts         # Remote Docker commands
│       ├── store.ts          # Config read / write
│       └── utils.ts          # cn() and other helpers
│
└── src-tauri/                # Backend (Rust)
    └── src/
        ├── lib.rs            # Tauri entry: registers State and all commands
        ├── main.rs           # Binary entry point
        ├── ssh.rs            # SSH sessions: connect, PTY, input / output, resize
        ├── sftp.rs           # SFTP sessions: list, upload / download, mutations
        ├── docker.rs         # Docker commands run over authenticated SSH
        └── store.rs          # Config persistence + keychain secret management
```

## 🧩 Backend Modules

### `ssh.rs` — interactive SSH terminal

- `SshManager` — keyed by session id, holds each active session's input channel (`mpsc::Sender`).
- `connect_and_auth()` — establishes the connection and performs password / public-key auth; shared by both SSH and SFTP.
- `run_loop()` — per-session event loop: forwards frontend input to the remote shell and streams shell output back via `ssh:data` events; emits `ssh:closed` when the session ends.

### `sftp.rs` — SFTP file transfer

- `SftpManager` — holds each SFTP session (a separate SSH connection from the terminal).
- Directory traversal uses an iterative stack walk; `sftp_download_dir` supports **recursively downloading an entire directory tree** with aggregated progress.
- Transfer progress is reported via `sftp:download-progress` events (throttled to ~100ms).

### `store.rs` — config & secrets

- `Config` = `servers[] + groups[]`, stored as JSON in the OS app-config directory (`config.json`).
- **Passwords are not written to the JSON**: on save they are stripped and written to the keychain (service name `com.ferric.ssh`), then re-hydrated on load.

### `docker.rs` — remote Docker management

- Uses the saved SSH credentials to run Docker CLI commands on the remote server.
- Lists both running and stopped containers, with Docker engine version and platform details.
- Supports start, stop, and restart actions. Container identifiers are validated before they are included in a remote shell command.

## 🔌 Backend API (Tauri Commands)

All commands are invoked from the frontend via `invoke('<command>', args)` and are
registered in `src-tauri/src/lib.rs`.

### SSH

| Command            | Params                                 | Returns     | Description                          |
| ------------------ | -------------------------------------- | ----------- | ------------------------------------ |
| `ssh_connect`      | `config: ConnectConfig`                | `String` id | Open an SSH connection with a PTY    |
| `ssh_send_input`   | `id: String, data: String`             | `()`        | Send keystrokes / input to the shell |
| `ssh_resize`       | `id: String, cols: u32, rows: u32`     | `()`        | Notify the remote PTY of a resize    |
| `ssh_disconnect`   | `id: String`                           | `()`        | Close the SSH session                |

**Events:** `ssh:data` (`{ id, data: number[] }`, shell output) · `ssh:closed` (`{ id }`, session ended)

### SFTP

| Command              | Params                                              | Returns           | Description                     |
| -------------------- | --------------------------------------------------- | ----------------- | ------------------------------- |
| `sftp_connect`       | `config: ConnectConfig`                             | `String` id       | Open a standalone SFTP session  |
| `sftp_home`          | `id`                                                | `String`          | Resolve the remote home dir     |
| `sftp_list`          | `id, path`                                          | `RemoteFile[]`    | List a directory (dirs first)   |
| `sftp_download`      | `id, remotePath, localPath`                         | `()`              | Download a single file (progress) |
| `sftp_download_dir`  | `id, remotePath, localPath` (local parent dir)      | `()`              | **Recursively download a folder** (progress) |
| `sftp_upload`        | `id, localPath, remotePath`                         | `()`              | Upload a local file             |
| `sftp_mkdir`         | `id, path`                                          | `()`              | Create a remote directory       |
| `sftp_remove`        | `id, path, isDir`                                   | `()`              | Remove a file / empty directory |
| `sftp_rename`        | `id, from, to`                                      | `()`              | Rename / move                   |
| `sftp_disconnect`    | `id`                                                | `()`              | Close the SFTP session          |

**Events:** `sftp:download-progress` (`{ id, transferred, total }`)

### Docker

| Command                       | Params                                      | Returns             | Description                              |
| ----------------------------- | ------------------------------------------- | ------------------- | ---------------------------------------- |
| `get_remote_docker_version`   | `config: ConnectConfig`                     | `DockerInfo`        | Docker engine version and platform       |
| `list_remote_containers`      | `config: ConnectConfig, all: Boolean`       | `DockerContainer[]` | List remote containers                   |
| `control_remote_container`    | `config, containerId, action`               | `()`                | Start, stop, or restart a container      |
| `create_remote_container`     | `config, input: { name?, image, command? }` | `()`                | Create and start a detached container    |
| `rename_remote_container`     | `config, containerId, name`                 | `()`                | Rename a container                       |

### Config / Secrets

| Command                 | Params            | Returns   | Description                              |
| ----------------------- | ----------------- | --------- | ---------------------------------------- |
| `load_config`           | —                 | `Config`  | Load config and re-hydrate passwords     |
| `save_config`           | `config: Config`  | `()`      | Save config; passwords go to the keychain |
| `delete_server_secret`  | `serverId`        | `()`      | Delete a server's password from keychain |

### `ConnectConfig` shape

```ts
interface ConnectConfig {
  host: string
  port: number
  username: string
  authType: 'password' | 'key'
  password?: string
  keyPath?: string
  keyPassphrase?: string
  cols?: number   // terminal only
  rows?: number   // terminal only
}
```

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) 1.77+
- Tauri system dependencies (see [Tauri prerequisites](https://tauri.app/start/prerequisites/))

### Install & Run

```bash
# Install frontend dependencies
npm install

# Start development (frontend + Tauri desktop window, with hot reload)
npm run tauri:dev

# Build a production installer
npm run tauri:build
```

### Other Scripts

```bash
npm run dev      # Frontend only via Vite (browser, no backend capabilities)
npm run build    # Type-check + frontend build
npm run lint     # ESLint
```

## 🔐 Security Notes

- Server passwords are stored in the **OS keychain**; `config.json` contains no plaintext passwords.
- For simplicity the current implementation **accepts any host key** in `Client::check_server_key`; production usage should verify `known_hosts`.

## 📝 License

Released under the [MIT License](./LICENSE).
