# 📦 CLI Node Virtual Volumes

<p align="center">
  <strong>Custom virtual volumes for Node.js, with a keyboard-first terminal file manager.</strong>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-0.3.0-0ea5e9.svg" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-22c55e.svg" />
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D20-111827.svg" />
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-5.x-3178c6.svg" />
  <img alt="Interface" src="https://img.shields.io/badge/interface-terminal-000000.svg" />
</p>

<p align="center">
  <img alt="Tags" src="https://img.shields.io/badge/tags-nodejs%2Ctypescript%2Ccli%2Ctui%2Cfilesystem%2Cvirtual--volume-111827.svg" />
</p>

<p align="center">
  <img alt="CLI Node Virtual Volumes TUI" src="./assets/screen.png" width="100%" />
</p>

> `cli-node-virtual-volumes` e' un file system virtuale custom, persistente e Node-only, progettato per creare volumi logici separati dalla macchina host e gestirli da una TUI ricca, veloce e orientata alle scorciatoie da tastiera.

## ✨ Perche' esiste

Questo progetto nasce per offrire un ambiente di storage virtuale che:

- non monta dischi reali a livello OS
- non espone un file system nativo accessibile da altri programmi
- vive all'interno di un runtime Node.js
- salva ogni volume in un singolo file SQLite
- permette import/export da e verso la macchina host
- offre una UX da terminale curata, con navigator, modali e progress feedback reali

In pratica ottieni volumi virtuali persistenti, con spazio logico configurabile, navigabili come un piccolo file manager in terminale.

## 🧭 Indice

1. [Panoramica](#-panoramica)
2. [Funzionalita'](#-funzionalita)
3. [Architettura](#-architettura)
4. [Installazione](#-installazione)
5. [Avvio rapido](#-avvio-rapido)
6. [Configurazione](#-configurazione)
7. [Controlli TUI](#-controlli-tui)
8. [Import ed export](#-import-ed-export)
9. [API Node.js](#-api-nodejs)
10. [Sviluppo](#-sviluppo)
11. [Packaging e release](#-packaging-e-release)
12. [Troubleshooting](#-troubleshooting)
13. [Roadmap](#-roadmap)
14. [Licenza](#-licenza)

## 🚀 Panoramica

| Area | Cosa offre |
| --- | --- |
| Storage virtuale | Volumi persistenti con struttura file/cartelle custom |
| UX terminale | TUI keyboard-first con frecce, modali, status e progress |
| Integrazione host | Import massivo da host e export verso host |
| Runtime Node-only | Utilizzabile via CLI e via API JavaScript/TypeScript |
| Enterprise quality | Configurazione validata, logging su file, test automatici, packaging npm |

## 🧩 Funzionalita'

### Core storage

- Creazione e rimozione di volumi virtuali.
- Quota logica configurabile per ogni volume.
- Gestione di cartelle e file in un file system virtuale custom.
- Supporto a move, rename, delete e navigazione gerarchica.
- Preview rapida dei file di testo.
- Persistenza dei contenuti e dei metadata.
- Un file `.sqlite` dedicato per ogni volume virtuale.

### Terminal experience

- Dashboard dei volumi.
- Explorer del contenuto del volume.
- Browser del file system host per import ed export.
- Modali dedicate per input, conferma e selezione.
- Inspector contestuale.
- Sidebar con shortcut leggibili e verticali.
- Barra di stato con spinner, progress bar, esito operazioni e contesto.

### Operazioni host ↔ volume

- Import di singoli file.
- Import di cartelle complete.
- Import massivo con selezione multipla via checkbox.
- Export di file dal volume alla macchina host.
- Export ricorsivo di directory.
- Feedback di avanzamento durante transfer lunghi.
- Transfer di file grandi tramite chunk persistiti in SQLite.
- Verifica di integrita' automatica su import ed export.

### Tooling

- Configurazione via `.env`.
- Logging strutturato su file.
- Build TypeScript con `tsup`.
- Test con `vitest`.
- Linting con `eslint`.
- Packaging installabile globalmente con npm.

## 🏗️ Architettura

Il progetto e' organizzato per responsabilita', con separazione chiara tra dominio, application layer, storage e UI:

```text
src/
  application/   -> orchestration dei casi d'uso
  config/        -> env, defaults e validazione config
  domain/        -> tipi, DTO e primitive del virtual filesystem
  logging/       -> logger Pino e gestione output
  storage/       -> repository, blob store e persistenza
  ui/            -> terminal shell, browser host, status helpers
  utils/         -> helper generici
```

### Componenti principali

| Modulo | Ruolo |
| --- | --- |
| `VolumeService` | Regola i flussi applicativi di volumi, file, import ed export |
| `VolumeRepository` | Gestisce metadata e stato dei volumi nel file SQLite del volume |
| `BlobStore` | Conserva il contenuto reale dei file virtuali nello stesso SQLite del volume |
| `TerminalApp` | Costruisce la TUI e orchestra la UX runtime |
| `env` config | Traduce `.env`, flag CLI e default applicativi |
| `logger` | Registra eventi, errori e trace su file system |

## 📥 Installazione

### Requisiti

- Node.js `>= 20`
- npm
- terminale con supporto TUI

### Installazione locale

```bash
npm install
```

### Installazione globale da tarball

```bash
npm pack
npm install -g ./cli-node-virtual-volumes-0.3.0.tgz
```

Dopo l'installazione globale il comando disponibile e':

```bash
virtual-volumes
```

## ⚡ Avvio rapido

### Modalita' sviluppo

```bash
npm run dev
```

### Build di produzione

```bash
npm run build
npm start
```

### Flusso base

1. Avvia la TUI.
2. Crea un volume.
3. Entra nel volume con `Enter` o `Right`.
4. Importa file/cartelle dal file system host.
5. Naviga con le frecce.
6. Esporta verso host quando serve.

## ⚙️ Configurazione

Il progetto legge la configurazione da `.env`, flag CLI e default interni. E' disponibile un template in [.env.example](./.env.example).

### Variabili principali

| Variabile | Descrizione |
| --- | --- |
| `VOLUME_DATA_DIR` | Root persistente dei volumi virtuali |
| `VOLUME_LOG_DIR` | Directory dei log runtime |
| `VOLUME_DEFAULT_QUOTA_BYTES` | Quota di default per i nuovi volumi |
| `VOLUME_LOG_LEVEL` | Livello log: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |
| `VOLUME_LOG_TO_STDOUT` | Duplica i log anche sul terminale |
| `VOLUME_PREVIEW_BYTES` | Dimensione massima preview file |

### Note operative

- Di default i volumi vengono salvati nella directory corrente da cui lanci il programma, a meno che tu non sovrascriva il path via config.
- Dentro `VOLUME_DATA_DIR/volumes` ogni volume viene persistito come file singolo `.sqlite`.
- I contenuti file grandi vengono salvati a chunk all'interno dello stesso database SQLite del volume.
- I log sono pensati per stare su file; l'output su terminale e' utile in debug, ma puo' interferire con la TUI fullscreen.

## ⌨️ Controlli TUI

La UI e' pensata per essere usata quasi completamente da tastiera.

### Dashboard

| Tasto | Azione |
| --- | --- |
| `Up / Down` | Cambia selezione |
| `PageUp / PageDown` | Scorre velocemente |
| `Home / End` | Primo / ultimo volume |
| `Right`, `Enter`, `O` | Apre il volume selezionato |
| `N` | Crea un nuovo volume |
| `X` | Elimina il volume selezionato |
| `R` | Refresh |
| `?` | Help |
| `Q` | Esce |

### Explorer

| Tasto | Azione |
| --- | --- |
| `Up / Down` | Cambia selezione |
| `PageUp / PageDown` | Scorre di pagina |
| `Home / End` | Primo / ultimo elemento |
| `Right`, `Enter` | Entra in cartella o apre preview file |
| `Left`, `Backspace`, `B` | Torna indietro |
| `C` | Crea cartella |
| `I` | Apre il browser host per l'import |
| `E` | Apre il browser host per l'export |
| `M` | Move / rename |
| `D` | Delete |
| `P` | Preview |
| `R` | Refresh |
| `?` | Help |

### Browser host per import

| Tasto | Azione |
| --- | --- |
| `Up / Down` | Cambia selezione |
| `Right` | Entra in cartella o drive |
| `Left` | Risale alla cartella padre |
| `Space` | Seleziona o deseleziona checkbox |
| `A` | Seleziona o deseleziona gli elementi visibili |
| `Enter`, `I` | Conferma l'import |
| `Esc`, `Q` | Chiude la modale |

### Browser host per export

| Tasto | Azione |
| --- | --- |
| `Up / Down` | Cambia selezione |
| `Right` | Entra in cartella o drive |
| `Left` | Risale alla cartella padre |
| `Enter`, `E` | Esporta nella cartella corrente |
| `Esc`, `Q` | Chiude la modale |

## 🔄 Import ed export

### Import

L'import non richiede di digitare manualmente un path host:

- apri la modale import con `I`
- navighi il file system host con le frecce
- selezioni piu' file o directory con `Space`
- confermi con `Enter` o `I`

Durante l'operazione la status area mostra:

- operazione attiva
- spinner
- progress bar
- messaggio contestuale
- esito finale `SUCCESS` o `ERROR`
- verifica di integrita' sui file importati

### Export

L'export funziona in modo speculare:

- selezioni il file o la cartella nel volume virtuale
- premi `E`
- scegli la destinazione host
- confermi l'operazione

L'export supporta sia file singoli sia directory ricorsive.
Al termine dell'export viene eseguita anche una verifica di integrita' del file scritto sulla macchina host.

## 🧠 API Node.js

Oltre alla TUI, il progetto espone una API utilizzabile da codice:

```ts
import { createRuntime } from 'cli-node-virtual-volumes';

const runtime = await createRuntime({
  dataDir: 'C:/cli-node-virtual-volumes/data',
  logLevel: 'info'
});

const volume = await runtime.volumeService.createVolume({
  name: 'Secure Docs'
});

await runtime.volumeService.writeTextFile(
  volume.id,
  '/hello.txt',
  'ciao dal filesystem virtuale'
);

const preview = await runtime.volumeService.previewFile(volume.id, '/hello.txt');

console.log(preview.content);
```

## 🛠️ Sviluppo

### Script disponibili

| Script | Descrizione |
| --- | --- |
| `npm run dev` | Avvia la CLI in sviluppo |
| `npm run build` | Compila il progetto |
| `npm run start` | Esegue la build compilata |
| `npm run lint` | Esegue ESLint |
| `npm run typecheck` | Esegue TypeScript in modalita' no emit |
| `npm run test` | Esegue i test con coverage |
| `npm run verify` | Esegue verifiche complete |
| `npm run pack:local` | Genera il tarball npm locale |

### Qualita'

La codebase punta a una struttura pulita e mantenibile:

- TypeScript tipizzato end-to-end
- moduli separati per responsabilita'
- test su casi core e regressioni
- tooling npm allineato al packaging reale

## 📦 Packaging e release

Il pacchetto e' pensato per essere distribuito via npm o come tarball:

```bash
npm run pack:local
```

Output atteso:

- file `.tgz` del pacchetto
- build `dist/`
- metadata completi per installazione globale

Le release locali possono essere accompagnate da:

- `CHANGELOG.md`
- commit in stile Conventional Commits
- workflow GitHub Actions per build e publish artefatti

## 🧪 Test e verifica

```bash
npm run lint
npm run typecheck
npm run test
npm run verify
```

La suite copre:

- virtual filesystem core
- import massivo e export
- progress callback
- parsing env
- logica di navigazione TUI
- regressioni su modali e workflow principali

## 🩺 Troubleshooting

### La TUI si sporca o lampeggia

- evita `VOLUME_LOG_TO_STDOUT=true` durante l'uso fullscreen
- usa un terminale con supporto completo alle escape sequence
- verifica di essere su Node.js 20 o superiore

### Import/export lenti

- file molto grandi mostrano progress avanzato, ma possono comunque richiedere tempo
- verifica la velocita' del disco host e la dimensione dei transfer

### Non trovi i volumi

- controlla `VOLUME_DATA_DIR`
- se non impostato, usa la directory corrente da cui hai lanciato il comando

## 🗺️ Roadmap

- miglioramento continuo della shell TUI
- ulteriore riduzione dei crash e delle condizioni di freeze
- affinamento delle release automation
- evoluzione del backend di persistenza per scenari ancora piu' grandi

## 👤 Autore

Creato e mantenuto da **Salvatore Scarano**.

## 📄 Licenza

Questo progetto e' distribuito con licenza [MIT](./LICENSE).
