# CLI Node Virtual Volumes

<p align="center">
  <strong>Custom virtual volumes for Node.js, with a keyboard-first terminal file manager.</strong>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-1.1.0-0ea5e9.svg" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-22c55e.svg" />
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D20-111827.svg" />
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-5.x-3178c6.svg" />
  <img alt="Interface" src="https://img.shields.io/badge/interface-terminal-000000.svg" />
</p>

<p align="center">
  <img alt="CLI Node Virtual Volumes TUI" src="./assets/screen.png" width="100%" />
</p>

`cli-node-virtual-volumes` is a persistent, Node-only virtual filesystem designed to keep logical volumes isolated from the host OS while exposing a rich TUI and a programmable TypeScript API.

## Index

1. [Overview](#overview)
2. [Features](#features)
3. [Architecture](#architecture)
4. [Installation](#installation)
5. [Quick Start](#quick-start)
6. [Configuration](#configuration)
7. [TUI Controls](#tui-controls)
8. [Import And Export](#import-and-export)
9. [Backup, Inspect And Restore](#backup-inspect-and-restore)
10. [Node.js API](#nodejs-api)
11. [Development](#development)
12. [Packaging And Release](#packaging-and-release)
13. [Troubleshooting](#troubleshooting)
14. [Roadmap](#roadmap)
15. [License](#license)

## Overview

This project provides:

- persistent virtual volumes stored as single SQLite files
- a keyboard-first terminal file manager
- host import and export flows with integrity checks
- a Node.js API for automation and embedding
- operational commands for doctor, repair, backup, inspect, and restore

## Features

### Core Storage

- Create and delete virtual volumes.
- Configure a logical quota per volume.
- Manage folders and files in a custom virtual filesystem.
- Preview text files directly from the virtual volume.
- Persist metadata and file content in a single `.sqlite` file per volume.
- Store large file payloads in chunked SQLite blobs.
- Protect writes with revisions and transactional mutations.

### Terminal Experience

- Volume dashboard.
- Explorer for volume contents.
- Host filesystem browser for import and export.
- Prompt, confirm, preview, and help overlays.
- Inspector and status panel with progress feedback.
- Keyboard-first workflows end to end.

### Operational Tooling

- `.env`-driven configuration.
- Structured file logging.
- `doctor` and safe `repair` flows.
- Consistent `backup`, `inspect-backup`, and `restore` commands.
- TypeScript build with `tsup`.
- Test suite with `vitest`.
- Cross-platform CI and release packaging.

## Architecture

The codebase is organized by responsibility:

```text
src/
  application/   -> use-case orchestration
  config/        -> runtime metadata and env validation
  domain/        -> types, DTOs, and primitives
  logging/       -> logger setup
  storage/       -> repository, blob store, sqlite integration
  ui/            -> TUI runtime and presenters
  utils/         -> general helpers
```

Main modules:

- `VolumeService`: application flows for volumes, files, import, export, and recovery.
- `VolumeRepository`: metadata persistence, transactional mutations, doctor, repair, backup, restore.
- `BlobStore`: blob persistence and integrity verification inside SQLite.
- `TerminalApp`: TUI runtime.

## Installation

Requirements:

- Node.js `>= 20`
- npm
- a terminal with TUI support

Local install:

```bash
npm install
```

Build and run:

```bash
npm run build
npm start
```

Create a tarball:

```bash
npm pack
npm install -g ./cli-node-virtual-volumes-1.1.0.tgz
```

## Quick Start

Development mode:

```bash
npm run dev
```

Basic flow:

1. Start the TUI with `virtual-volumes`.
2. Create a volume.
3. Enter the volume with `Enter` or `Right`.
4. Import files or folders from the host.
5. Navigate, preview, move, or delete entries.
6. Export data back to the host when needed.

## Configuration

The runtime reads configuration from `.env`, CLI flags, and internal defaults. A template is available in [.env.example](./.env.example).

Main variables:

| Variable | Description |
| --- | --- |
| `VOLUME_DATA_DIR` | Persistent root for virtual volumes |
| `VOLUME_LOG_DIR` | Runtime log directory |
| `VOLUME_DEFAULT_QUOTA_BYTES` | Default quota for new volumes |
| `VOLUME_LOG_LEVEL` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |
| `VOLUME_LOG_TO_STDOUT` | Mirrors logs to stdout |
| `VOLUME_PREVIEW_BYTES` | Max preview size for file previews |

Operational notes:

- If `VOLUME_DATA_DIR` is not set, the runtime uses the current working directory.
- Volumes are persisted under `VOLUME_DATA_DIR/volumes`.
- Large file contents stay inside the same SQLite database as chunked blobs.
- File logging is recommended while using the fullscreen TUI.

## TUI Controls

### Dashboard

| Key | Action |
| --- | --- |
| `Up / Down` | Change selection |
| `PageUp / PageDown` | Scroll faster |
| `Home / End` | First / last volume |
| `Right`, `Enter`, `O` | Open selected volume |
| `N` | Create volume |
| `X` | Delete selected volume |
| `R` | Refresh |
| `?` | Help |
| `Q` | Quit |

### Explorer

| Key | Action |
| --- | --- |
| `Up / Down` | Change selection |
| `PageUp / PageDown` | Page navigation |
| `Home / End` | First / last entry |
| `Right`, `Enter` | Enter folder or preview file |
| `Left`, `Backspace`, `B` | Go back |
| `C` | Create folder |
| `I` | Open import browser |
| `E` | Open export browser |
| `M` | Move / rename |
| `D` | Delete |
| `P` | Preview |
| `R` | Refresh |
| `?` | Help |

### Host Browser

| Key | Action |
| --- | --- |
| `Up / Down` | Change selection |
| `Right` | Enter folder or drive |
| `Left` | Go to parent |
| `Space` | Toggle selection in import mode |
| `A` | Toggle visible selections in import mode |
| `Enter` | Confirm import or export |
| `Esc`, `Q` | Close overlay |

## Import And Export

Import flow:

- open the import overlay with `I`
- navigate the host filesystem
- select files or folders with `Space`
- confirm with `Enter`

Export flow:

- select a file or folder in the virtual volume
- press `E`
- pick the destination host folder
- confirm the export

Both flows expose progress feedback and integrity verification.

## Backup, Inspect And Restore

The CLI exposes a full recovery workflow:

| Command | Purpose |
| --- | --- |
| `virtual-volumes backup <volumeId> <destinationPath>` | Create a consistent SQLite snapshot |
| `virtual-volumes inspect-backup <backupPath>` | Validate the backup artifact before restore |
| `virtual-volumes restore <backupPath>` | Restore a volume from backup |
| `virtual-volumes restore <backupPath> --force` | Replace an existing volume with rollback protection |
| `virtual-volumes doctor [volumeId]` | Run consistency checks after restore |

Recommended flow:

```bash
virtual-volumes backup vol_finance_01 ./backups/finance.sqlite
virtual-volumes inspect-backup ./backups/finance.sqlite
virtual-volumes restore ./backups/finance.sqlite
virtual-volumes doctor vol_finance_01
```

Each standard backup produces:

- a `.sqlite` file
- a `.sqlite.manifest.json` sidecar

`inspect-backup` validates:

- artifact readability
- SHA-256 checksum
- sidecar consistency
- `createdWithVersion` compatibility
- `schemaVersion` compatibility

For the full operational procedure, drills, and audit checklist, see [docs/BACKUP-RESTORE-RUNBOOK.md](./docs/BACKUP-RESTORE-RUNBOOK.md).

## Node.js API

The same runtime is available programmatically:

```ts
import { createRuntime } from 'cli-node-virtual-volumes';

const runtime = await createRuntime({
  dataDir: 'C:/cli-node-virtual-volumes/data',
  logLevel: 'info',
});

const volume = await runtime.volumeService.createVolume({
  name: 'Secure Docs',
});

await runtime.volumeService.writeTextFile(
  volume.id,
  '/hello.txt',
  'hello from the virtual filesystem',
);

const preview = await runtime.volumeService.previewFile(volume.id, '/hello.txt');
console.log(preview.content);
```

Useful API methods:

- `runtime.volumeService.backupVolume(...)`
- `runtime.volumeService.inspectVolumeBackup(...)`
- `runtime.volumeService.restoreVolumeBackup(...)`
- `runtime.volumeService.runDoctor(...)`
- `runtime.volumeService.runRepair(...)`

## Development

Available scripts:

| Script | Description |
| --- | --- |
| `npm run dev` | Start the CLI in development |
| `npm run build` | Build the project |
| `npm start` | Run the compiled build |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript with no emit |
| `npm run test` | Run tests with coverage |
| `npm run verify` | Run full verification and build |
| `npm run pack:local` | Build and generate a local tarball |

The current quality bar includes:

- strict TypeScript
- layered modules by responsibility
- recovery, integrity, and rollback tests
- packaging aligned with the shipped artifact

## Packaging And Release

Generate a local package:

```bash
npm run pack:local
```

Typical release assets:

- `dist/`
- `.tgz` package artifact
- `CHANGELOG.md`
- GitHub Actions build outputs

Additional planning and maturity work is tracked in [docs/ENTERPRISE-ROADMAP.md](./docs/ENTERPRISE-ROADMAP.md).

## Troubleshooting

### The TUI flickers or gets noisy

- avoid `VOLUME_LOG_TO_STDOUT=true` while using the fullscreen UI
- use a terminal with solid escape-sequence support
- make sure you are on Node.js 20 or newer

### Import or export feels slow

- large files still need time even with progress feedback
- host disk performance has a direct impact on transfer speed

### You cannot find the volumes

- check `VOLUME_DATA_DIR`
- if it is not configured, the runtime uses the current working directory

### Restore is rejected

- run `virtual-volumes inspect-backup <backupPath>` first
- verify that the backup was not created by a newer CLI major version
- verify that `schemaVersion` and `createdWithVersion` are compatible with the current runtime
- use `--force` only when you intentionally want to overwrite an existing volume

## Roadmap

Current direction:

- continue hardening storage recovery and consistency
- keep reducing TUI monolith complexity
- improve enterprise operability and release safety
- extend automated test coverage around real failure modes

## Author

Created and maintained by **Salvatore Scarano**.

## License

This project is distributed under the [MIT](./LICENSE) license.
