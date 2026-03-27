# Backup And Restore Runbook

Questo runbook descrive il flusso operativo consigliato per backup, verifica e restore dei volumi virtuali.

## Obiettivo

Ogni backup enterprise-grade deve essere:

- consistente a livello SQLite
- verificabile prima del restore
- compatibile con il runtime corrente
- ripristinabile con rollback sicuro in caso di overwrite failure

## Artefatti prodotti

Un backup standard genera due file:

- `<name>.sqlite`
- `<name>.sqlite.manifest.json`

Il manifest sidecar contiene:

- `formatVersion`
- `volumeId`
- `volumeName`
- `revision`
- `schemaVersion`
- `createdWithVersion`
- `bytesWritten`
- `checksumSha256`
- `createdAt`

Il restore resta compatibile con backup legacy che hanno solo il file `.sqlite`, ma in quel caso la validazione del manifest viene saltata.

## Creazione backup

Comando:

```bash
virtual-volumes backup <volumeId> <destinationPath>
```

Esempio:

```bash
virtual-volumes backup vol_finance_01 ./backups/finance.sqlite
```

Per sovrascrivere un artefatto gia' esistente:

```bash
virtual-volumes backup vol_finance_01 ./backups/finance.sqlite --force
```

Il comando fallisce se il path di destinazione coincide con il database live del volume.

## Verifica pre-restore

Comando consigliato prima di ogni restore:

```bash
virtual-volumes inspect-backup <backupPath>
```

Esempio:

```bash
virtual-volumes inspect-backup ./backups/finance.sqlite
```

La preflight valida:

- leggibilita' del backup SQLite
- checksum SHA-256 del file `.sqlite`
- coerenza tra manifest sidecar e artefatto reale
- compatibilita' del `createdWithVersion` con il runtime corrente
- compatibilita' della `schemaVersion` con il runtime corrente

Se uno di questi controlli fallisce, il restore non va eseguito.

Per una prova sicura e ripetibile del recovery path senza toccare il data dir live, usa anche:

```bash
virtual-volumes restore-drill <backupPath>
```

Il drill:

1. esegue `inspect-backup`
2. ripristina il backup in un data dir temporaneo isolato
3. esegue `doctor` sul volume ripristinato
4. rimuove il sandbox al termine, a meno che non venga richiesto `--keep-sandbox`

## Restore standard

Usa il restore standard quando il volume target non esiste piu' nel data directory:

```bash
virtual-volumes restore <backupPath>
```

Esempio:

```bash
virtual-volumes restore ./backups/finance.sqlite
```

## Restore con overwrite

Usa `--force` solo quando vuoi sostituire un volume gia' esistente con lo stato del backup:

```bash
virtual-volumes restore <backupPath> --force
```

Il runtime esegue:

- snapshot consistente del volume target esistente
- swap del database ripristinato
- rollback automatico se lo swap o la validazione finale falliscono

## Failure modes gestiti esplicitamente

- `manifest mismatch`
  Il sidecar non corrisponde piu' al file `.sqlite` e il restore viene bloccato.
- `newer CLI major version`
  Il backup e' stato creato da una linea runtime piu' nuova della corrente e viene rifiutato.
- `newer schema version`
  Il backup richiede una schema version non supportata dal runtime corrente e viene rifiutato.
- `volume already exists`
  Il restore standard non sovrascrive mai un volume esistente senza `--force`.

## Procedura operativa consigliata

Per un backup di routine:

1. Esegui `virtual-volumes backup`.
2. Esegui subito `virtual-volumes inspect-backup`.
3. Esegui `virtual-volumes restore-drill` quando vuoi verificare il recovery path senza toccare i dati live.
4. Se serve audit operativo, aggiungi `--output <path>` per salvare l'artifact JSON del comando.
5. Conserva insieme `.sqlite` e `.manifest.json`.

Per manutenzione ordinaria del database SQLite di un volume gia' in esercizio:

1. Esegui `virtual-volumes doctor <volumeId>` per verificare che il volume sia integro.
   Il report include anche metriche SQLite, i top candidate di compattazione ordinati per reclaimable bytes, mismatch sui `blob reference count`, e un warning `COMPACTION_RECOMMENDED` quando il volume ha abbastanza free pages da giustificare la manutenzione.
2. Esegui `virtual-volumes compact <volumeId>` per forzare checkpoint WAL, `VACUUM` e `PRAGMA optimize`.
3. Se vuoi tracciare l'intervento, aggiungi `--output <path>` e conserva l'artifact del compattamento.
4. Riesegui `virtual-volumes doctor <volumeId>` se vuoi validare il volume anche dopo la compattazione.
   Se emergono mismatch sui `blob reference count`, `virtual-volumes doctor --fix` li riallinea senza toccare il contenuto dei file.

Per manutenzione batch di tutti i volumi gestiti:

1. Esegui `virtual-volumes compact-recommended --dry-run` per vedere quali volumi verrebbero compattati.
   Il dry-run espone anche il dettaglio dei volumi `planned`, `blocked`, `filtered` e `deferred`, con il motivo operativo di ciascuno.
   Il report quantifica anche i free bytes reclaimable per bucket, cosi' puoi stimare subito l'impatto atteso del batch.
2. Se vuoi limitare il blast radius, aggiungi `--limit <n>` per processare solo i primi N volumi ordinati per free bytes reclaimable.
3. Se vuoi mettere un tetto al batch per dimensione, aggiungi `--max-reclaimable-bytes <bytes>` per non superare il budget cumulativo di reclaimable bytes pianificati.
4. Se vuoi restringere ulteriormente il batch, aggiungi `--min-free-bytes <bytes>` e/o `--min-free-ratio <ratio>` per includere solo i volumi che superano soglie minime esplicite.
5. Per default il batch blocca i volumi che hanno anche issue diverse da `COMPACTION_RECOMMENDED`; usa `--include-unsafe` solo quando vuoi forzare esplicitamente la compattazione su volumi ancora diagnostically unhealthy.
6. Esegui `virtual-volumes compact-recommended` per compattare solo i volumi oggi marcati con `COMPACTION_RECOMMENDED`.
   Se vuoi usare il batch in automazione, aggiungi `--strict-plan` per fallire quando restano volumi `blocked`, `filtered`, `deferred` o `failed`.
7. Se vuoi audit strutturato, aggiungi `--output <path>` anche al batch.
8. Riesegui `virtual-volumes doctor` se vuoi confermare che la frammentazione raccomandata sia stata assorbita.

Per un restore di emergenza:

1. Esegui `virtual-volumes inspect-backup`.
2. Esegui `virtual-volumes doctor` sul sistema corrente se il volume esiste ancora.
3. Esegui `virtual-volumes restore` oppure `virtual-volumes restore --force`.
4. Se devi tracciare l'operazione, usa `--output <path>` sui comandi eseguiti.
5. Esegui `virtual-volumes doctor <volumeId>` dopo il ripristino.
6. Apri il volume e valida almeno un file noto o una directory chiave.

Per escalation o handoff verso supporto tecnico:

1. Esegui `virtual-volumes support-bundle <destinationPath> [volumeId]`.
2. Se stai lavorando su un restore o un backup sospetto, aggiungi `--backup-path <backupPath>`.
3. Se il bundle deve essere piu' facile da condividere, usa `--no-logs` per escludere gli snapshot app e audit.
4. Esegui `virtual-volumes inspect-support-bundle <destinationPath>` per verificare integrita' e checksum del bundle.
5. Se il bundle deve uscire dall'organizzazione, usa `virtual-volumes inspect-support-bundle <destinationPath> --require-sharing external-shareable`.
6. Se l'handoff resta interno, puoi comunque imporre `--require-sharing internal-only` per bloccare bundle senza guidance valida.
7. Condividi la cartella generata, che include `manifest.json`, `checksums.json`, `doctor-report.json`, `handoff-report.md`, eventuale `backup-inspection.json`, eventuale copia del manifest del backup e, se non esclusi, tail snapshot del log corrente.
8. Se usi `VOLUME_REDACT_SENSITIVE_DETAILS=true`, anche i report JSON interni del bundle vengono redatti prima della condivisione.
9. Controlla il `contentProfile` del bundle o l'output di `inspect-support-bundle` per capire se l'artifact e' `external-shareable` oppure `internal-only`.
10. Segui anche `recommendedRetentionDays` e le `disposalNotes` del bundle per evitare che artifact diagnostici restino in giro oltre il necessario.
11. Se `inspect-support-bundle` segnala che la retention e' stata superata, rigenera il bundle prima dell'handoff invece di condividere un artifact stantio.

## Restore drill periodico

Per alzare davvero la readiness operativa, pianifica un drill regolare:

1. crea un backup di un volume reale
2. verifica il backup con `inspect-backup`
3. esegui `restore-drill`
4. se il drill deve essere investigabile, ripeti con `restore-drill --keep-sandbox`
5. verifica contenuti, revision e file chiave

## Cosa conservare in audit

Per ogni backup e restore conserva almeno:

- timestamp operazione
- comando eseguito
- versione CLI che ha generato il report
- `volumeId`
- `revision`
- `schemaVersion`
- `createdWithVersion`
- `checksumSha256`
- esito di `inspect-backup`
- esito di `doctor` post-restore
