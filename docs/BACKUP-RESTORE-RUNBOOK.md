# Backup And Restore Runbook

This runbook describes the recommended operational flow for backing up, validating, and restoring virtual volumes.

## Goal

Every reliable backup should be:

- SQLite-consistent
- verifiable before restore
- compatible with the current runtime
- restorable with safe rollback if an overwrite fails

## Produced Artifacts

A standard backup produces two files:

- `<name>.sqlite`
- `<name>.sqlite.manifest.json`

The sidecar manifest contains:

- `formatVersion`
- `volumeId`
- `volumeName`
- `revision`
- `schemaVersion`
- `createdWithVersion`
- `bytesWritten`
- `checksumSha256`
- `createdAt`

Restore remains compatible with legacy backups that only contain the `.sqlite` file, but in that case manifest validation is skipped.

## Creating A Backup

Command:

```bash
virtual-volumes backup <volumeId> <destinationPath>
```

Example:

```bash
virtual-volumes backup vol_finance_01 ./backups/finance.sqlite
```

To overwrite an existing artifact:

```bash
virtual-volumes backup vol_finance_01 ./backups/finance.sqlite --force
```

The command fails if the destination path matches the live managed database for the volume.

## Pre-Restore Validation

Recommended command before any restore:

```bash
virtual-volumes inspect-backup <backupPath>
```

Example:

```bash
virtual-volumes inspect-backup ./backups/finance.sqlite
```

The preflight validates:

- SQLite backup readability
- SHA-256 checksum of the `.sqlite` file
- consistency between the sidecar manifest and the actual artifact
- `createdWithVersion` compatibility with the current runtime
- `schemaVersion` compatibility with the current runtime

If any of these checks fail, restore should not be executed.

For a safe and repeatable recovery-path test without touching the live data directory, also use:

```bash
virtual-volumes restore-drill <backupPath>
```

The drill:

1. runs `inspect-backup`
2. restores the backup into an isolated temporary data directory
3. runs `doctor` on the restored volume
4. removes the sandbox afterward unless `--keep-sandbox` is requested

## Standard Restore

Use the standard restore when the target volume no longer exists in the data directory:

```bash
virtual-volumes restore <backupPath>
```

Example:

```bash
virtual-volumes restore ./backups/finance.sqlite
```

## Overwrite Restore

Use `--force` only when you want to replace an existing volume with the state from the backup:

```bash
virtual-volumes restore <backupPath> --force
```

The runtime performs:

- a consistent snapshot of the existing target volume
- a swap to the restored database
- automatic rollback if the swap or final validation fails

## Explicitly Handled Failure Modes

- `manifest mismatch`
  The sidecar no longer matches the `.sqlite` file, and restore is blocked.
- `newer CLI major version`
  The backup was created by a newer runtime major line and is rejected.
- `newer schema version`
  The backup requires a schema version not supported by the current runtime and is rejected.
- `volume already exists`
  Standard restore never overwrites an existing volume without `--force`.

## Recommended Operational Procedure

For a routine backup:

1. Run `virtual-volumes backup`.
2. Immediately run `virtual-volumes inspect-backup`.
3. Run `virtual-volumes restore-drill` whenever you want to validate the recovery path without touching live data.
4. If you need an operational audit trail, add `--output <path>` to save the command's JSON artifact.
5. Keep `.sqlite` and `.manifest.json` together.

For routine maintenance of a volume's SQLite database:

1. Run `virtual-volumes doctor <volumeId>` to verify that the volume is healthy.
   The report also includes SQLite metrics, top compaction candidates ordered by reclaimable bytes, fleet-wide `repair-safe` posture, blob reference-count mismatches, and a `COMPACTION_RECOMMENDED` warning when the volume has enough free pages to justify maintenance.
2. Run `virtual-volumes compact <volumeId>` to force WAL checkpointing, `VACUUM`, and `PRAGMA optimize`.
3. If you want to track the maintenance action, add `--output <path>` and keep the compaction artifact.
4. Run `virtual-volumes doctor <volumeId>` again if you want to validate the volume after compaction.
   If blob reference-count mismatches are detected, `virtual-volumes doctor --fix` realigns them without touching file contents.

For batch maintenance of all managed volumes:

1. Run `virtual-volumes compact-recommended --dry-run` to see which volumes would be compacted.
   The dry run also shows detailed `planned`, `blocked`, `filtered`, and `deferred` volumes, with an explicit operational reason for each one.
   The report also quantifies reclaimable free bytes per bucket so you can estimate the expected batch impact immediately.
2. If you want to reduce blast radius, add `--limit <n>` to process only the top N volumes ordered by reclaimable free bytes.
3. If you want to cap the batch by size, add `--max-reclaimable-bytes <bytes>` to stay within the cumulative reclaimable-byte budget.
4. If you want to narrow the batch even further, add `--min-free-bytes <bytes>` and/or `--min-free-ratio <ratio>` to include only volumes above explicit minimum thresholds.
5. By default, the batch blocks volumes that also have issues other than `COMPACTION_RECOMMENDED`; use `--include-unsafe` only when you explicitly want to force compaction on volumes that are still diagnostically unhealthy.
6. Run `virtual-volumes compact-recommended` to compact only the volumes currently marked with `COMPACTION_RECOMMENDED`.
   If you want to use the batch in automation, add `--strict-plan` so it fails when `blocked`, `filtered`, `deferred`, or `failed` volumes remain.
7. If you want structured auditing, add `--output <path>` to the batch command as well.
8. Run `virtual-volumes doctor` again if you want to confirm that the recommended fragmentation has been absorbed.

For fleet-wide batch remediation of safe drifts:

1. Run `virtual-volumes repair-safe --dry-run` to see which volumes have only auto-repairable drifts.
2. If you want stricter payload validation, add `--verify-blobs`.
3. If you want to limit the operational batch, add `--limit <n>`.
4. `blocked` volumes also have non-safe findings and are not auto-repaired by the batch.
5. Run `virtual-volumes repair-safe` to apply only the planned safe repairs.
6. If you use the batch in automation, add `--strict-plan` so it fails when `blocked`, `deferred`, or `failed` volumes remain.
7. Run `virtual-volumes doctor --verify-blobs` again if you want deep validation after remediation.

For an emergency restore:

1. Run `virtual-volumes inspect-backup`.
2. Run `virtual-volumes doctor` on the current system if the volume still exists.
3. Run `virtual-volumes restore` or `virtual-volumes restore --force`.
4. If you need to track the operation, use `--output <path>` on the executed commands.
5. Run `virtual-volumes doctor <volumeId>` after restore.
6. Open the volume and validate at least one known file or key directory.

For escalation or handoff to technical support:

1. Run `virtual-volumes support-bundle <destinationPath> [volumeId]`.
2. If you want the embedded report to use deep payload scrubbing, add `--verify-blobs`.
3. If you are working on a suspicious backup or restore, add `--backup-path <backupPath>`.
4. If the bundle needs to be easier to share, use `--no-logs` to exclude app and audit snapshots.
5. Run `virtual-volumes inspect-support-bundle <destinationPath>` to verify bundle integrity and checksums.
6. If the bundle must leave the organization or you want a high-confidence handoff, use `virtual-volumes inspect-support-bundle <destinationPath> --require-sharing external-shareable --require-integrity-depth deep`.
7. If the handoff remains internal, you can still enforce `--require-sharing internal-only --require-integrity-depth metadata` to block bundles without valid guidance or with insufficient verification depth.
8. Share the generated folder, which includes `manifest.json`, `checksums.json`, `doctor-report.json`, `handoff-report.md`, optional `backup-inspection.json`, an optional copy of the backup manifest, and, unless excluded, tail snapshots of the current logs.
9. If you use `VOLUME_REDACT_SENSITIVE_DETAILS=true`, the internal JSON reports in the bundle are also redacted before sharing.
10. Check the bundle `contentProfile` or the `inspect-support-bundle` output to determine whether the artifact is `external-shareable` or `internal-only`.
11. Follow `recommendedRetentionDays` and the bundle `disposalNotes` to avoid leaving diagnostic artifacts around longer than necessary.
12. Use `handoff-report.md` and `action-plan.json` as the operational starting point: they now include integrity depth, compaction/repair-safe fleet posture, and suggested next actions.
13. If `inspect-support-bundle` reports that the retention window has been exceeded, regenerate the bundle before the handoff instead of sharing a stale artifact.

## Periodic Restore Drill

To raise operational readiness, schedule a regular drill:

1. create a backup of a real volume
2. validate the backup with `inspect-backup`
3. run `restore-drill`
4. if the drill must remain inspectable, repeat it with `restore-drill --keep-sandbox`
5. validate contents, revision, and key files

## What To Keep For Audit

For every backup and restore, keep at least:

- operation timestamp
- executed command
- CLI version that generated the report
- `volumeId`
- `revision`
- `schemaVersion`
- `createdWithVersion`
- `checksumSha256`
- `inspect-backup` result
- post-restore `doctor` result
