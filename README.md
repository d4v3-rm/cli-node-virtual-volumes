# Virtual Volumes CLI

Virtual filesystem custom, persistente e utilizzabile solo tramite Node.js, con interfaccia TUI in terminale basata su `neo-blessed`.

## Cosa fa

- Crea volumi virtuali con quota logica configurabile.
- Gestisce cartelle e file in uno storage custom non montato a livello OS.
- Importa file e directory dalla macchina host, anche in batch.
- Esporta file e cartelle dal volume virtuale verso la macchina host.
- Permette navigazione, preview, move/rename e delete direttamente da terminale.
- Usa una shell CLI keyboard-first con frecce, shortcut e modali dedicati piu' stabili dei render React-style.
- Include icone testuali leggere, browser host fullscreen per l'import e selezione multipla con checkbox.
- Mostra una status bar a due righe con progress bar, esito operazioni, contesto e hint durante import, export e altri task lunghi.
- Espone anche una API Node.js per usare i volumi da codice.
- Scrive log dettagliati su filesystem con configurazione via `.env`.

## Stack

- Node.js 20+
- TypeScript
- `neo-blessed` + `blessed` per la TUI
- Vitest per i test
- Pino per il logging
- Zod + dotenv per configurazione e validazione env
- tsup per build e packaging npm

## Avvio locale

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Il binario generato e' `dist/index.js` ed e' esposto come comando globale `virtual-volumes`.

## Tarball npm

```bash
npm pack
```

Poi puoi installare il tarball in globale:

```bash
npm install -g ./virtual-volumes-cli-0.2.0.tgz
```

## Variabili ambiente

Guarda `.env.example`.

- `VOLUME_DATA_DIR`: root persistente dei volumi virtuali. Di default usa la directory corrente da cui lanci il comando.
- `VOLUME_LOG_DIR`: directory dei log.
- `VOLUME_DEFAULT_QUOTA_BYTES`: quota logica di default per i nuovi volumi.
- `VOLUME_LOG_LEVEL`: `fatal|error|warn|info|debug|trace|silent`.
- `VOLUME_LOG_TO_STDOUT`: se `true`, duplica i log anche sul terminale oltre che su file. Nella TUI fullscreen e' sconsigliato perche' puo' sporcare il render.
- `VOLUME_PREVIEW_BYTES`: bytes letti per la preview dei file.

## Controlli TUI

Dashboard:

- `Up/Down`: cambia selezione
- `PageUp/PageDown`: salta di pagina
- `Home/End`: primo o ultimo volume
- `Right`, `Enter` o `O`: apri il volume selezionato
- `N`: crea volume
- `R`: refresh
- `X`: elimina volume
- `?`: help
- `Q`: esci

Explorer:

- `Up/Down`: cambia selezione
- `PageUp/PageDown`: salta di pagina
- `Home/End`: primo o ultimo elemento
- `Right` o `Enter`: entra in cartella o preview file
- `Backspace`, `Left` o `B`: directory padre o dashboard
- `C`: crea cartella
- `I`: apre il browser del filesystem host
- `E`: apre il browser host per scegliere dove esportare l'elemento selezionato
- `M`: move/rename
- `D`: delete
- `P`: preview
- `?`: help

Import host modal:

- `Up/Down`: cambia selezione
- `Right`: entra nella cartella o drive selezionato
- `Left`: torna alla cartella padre
- `Space`: attiva o disattiva la checkbox su file e cartelle
- `Enter` o `I`: importa tutti gli elementi selezionati
- `A`: seleziona o deseleziona gli elementi visibili
- `Esc` o `Q`: chiude la modale

Export host modal:

- `Up/Down`: cambia selezione
- `Right`: entra nella cartella o drive selezionato
- `Left`: torna alla cartella padre
- `Enter` o `E`: esporta l'elemento selezionato nella cartella host corrente
- `Esc` o `Q`: chiude la modale

Le modali di input e conferma usano `Enter`, `Esc`, `Left/Right`, `Y/N` a seconda del contesto. Durante import ed export lunghi la status bar mostra progress bar reali, esito dell'operazione e contesto corrente, mentre il browser host evita di dover digitare i percorsi a mano.

## API Node.js

```ts
import { createRuntime } from 'virtual-volumes-cli';

const runtime = await createRuntime({
  dataDir: 'C:/virtual-volumes/data',
  logLevel: 'info',
});

const volume = await runtime.volumeService.createVolume({
  name: 'Secure Docs',
});

await runtime.volumeService.writeTextFile(volume.id, '/hello.txt', 'ciao');
const preview = await runtime.volumeService.previewFile(volume.id, '/hello.txt');
console.log(preview.content);
```

## Test

```bash
npm test
npm run lint
npm run typecheck
```

La suite copre il motore del filesystem virtuale, cleanup dei blob, snapshot coerenti tra runtime diversi, import batch, export verso host, progress di import/export, parsing env e la logica di navigazione della TUI.
