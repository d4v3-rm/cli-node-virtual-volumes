# Virtual Volumes CLI

Virtual filesystem custom, persistente e utilizzabile solo tramite Node.js, con interfaccia TUI in terminale.

## Cosa fa

- Crea volumi virtuali con quota logica configurabile.
- Gestisce cartelle e file in uno storage custom non montato a livello OS.
- Importa file e directory dalla macchina host, anche in batch.
- Permette navigazione, preview, move/rename e delete direttamente da terminale.
- Espone anche una API Node.js per usare i volumi da codice.
- Scrive log dettagliati su filesystem con configurazione via `.env`.

## Stack

- Node.js 20+
- TypeScript
- Ink per la TUI
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
npm install -g ./virtual-volumes-cli-0.1.0.tgz
```

## Variabili ambiente

Guarda `.env.example`.

- `VOLUME_DATA_DIR`: root persistente dei volumi virtuali.
- `VOLUME_LOG_DIR`: directory dei log.
- `VOLUME_DEFAULT_QUOTA_BYTES`: quota logica di default per i nuovi volumi.
- `VOLUME_LOG_LEVEL`: `fatal|error|warn|info|debug|trace|silent`.
- `VOLUME_LOG_TO_STDOUT`: se `true`, duplica i log anche su stdout.
- `VOLUME_PREVIEW_BYTES`: bytes letti per la preview dei file.

## Controlli TUI

Dashboard:

- `Tab`: cambia pannello
- `Up/Down`: cambia selezione
- `Enter`: apri/esegui
- `N`: crea volume
- `O`: apri volume
- `R`: refresh
- `X`: elimina volume
- `?`: help

Explorer:

- `Tab`: cambia pannello
- `Up/Down`: cambia selezione
- `Enter`: entra in cartella o preview file
- `Backspace`: directory padre
- `C`: crea cartella
- `I`: importa path host
- `M`: move/rename
- `D`: delete
- `P`: preview
- `B`: ritorna alla dashboard

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

La suite copre il motore del filesystem virtuale, import batch, guardie sui move, delete ricorsivo e uno smoke test della TUI.
