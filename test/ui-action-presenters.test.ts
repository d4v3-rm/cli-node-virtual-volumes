import { describe, expect, it } from 'vitest';

import type { FilePreview, VolumeManifest } from '../src/domain/types.js';
import {
  buildCreateFolderPrompt,
  buildCreateFolderSuccessMessage,
  buildCreateVolumePrompts,
  buildCreateVolumeSuccessMessage,
  buildEditVolumePrompts,
  buildEditVolumeSuccessMessage,
  buildDeleteEntryConfirmation,
  buildDeleteEntrySuccessMessage,
  buildDeleteVolumeConfirmation,
  buildDeleteVolumeSuccessMessage,
  buildExportSuccessNotification,
  buildExportTaskDetail,
  buildHelpOverlayOptions,
  buildImportEmptySelectionMessage,
  buildImportSuccessNotification,
  buildImportTaskDetail,
  buildMoveEntryPrompts,
  buildMoveEntrySuccessMessage,
  buildPreviewOverlayOptions,
  parseVolumeQuotaInput,
  VOLUME_QUOTA_UNITS,
} from '../src/ui/action-presenters.js';

describe('ui action presenters', () => {
  it('builds create volume prompts and parses quota input safely', () => {
    const prompts = buildCreateVolumePrompts(10 * 1024 ** 4);

    expect(prompts.name.description).toBe('Volume name');
    expect(prompts.quotaValue.initialValue).toBe('10');
    expect(prompts.quotaUnit.choices).toEqual([...VOLUME_QUOTA_UNITS]);
    expect(prompts.quotaUnit.initialIndex).toBe(3);
    expect(prompts.description.description).toBe('Optional description');

    expect(parseVolumeQuotaInput('', 'TB')).toEqual({
      error: null,
      quotaBytes: undefined,
    });
    expect(parseVolumeQuotaInput('1.5', 'GB')).toEqual({
      error: null,
      quotaBytes: 1610612736,
    });
    expect(parseVolumeQuotaInput('10,5', 'MB')).toEqual({
      error: null,
      quotaBytes: 11010048,
    });
    expect(parseVolumeQuotaInput('abc', 'TB')).toEqual({
      error: 'Quota value must be a valid number.',
      quotaBytes: undefined,
    });
    expect(parseVolumeQuotaInput('0', 'TB')).toEqual({
      error: 'Quota must be greater than zero.',
      quotaBytes: undefined,
    });
    expect(parseVolumeQuotaInput('1.1', 'BORK')).toEqual({
      error: 'Quota unit must be one of KB, MB, GB, TB.',
      quotaBytes: undefined,
    });
  });

  it('builds create, move, and delete action copy', () => {
    expect(buildCreateVolumeSuccessMessage('Finance')).toBe('Volume "Finance" created.');
    expect(
      buildEditVolumePrompts({
        name: 'Finance',
        description: 'Quarter close workspace',
      }),
    ).toEqual({
      name: {
        title: 'Edit Volume',
        description: 'Volume name',
        initialValue: 'Finance',
        footer: 'Enter saves. Esc cancels.',
      },
      description: {
        title: 'Edit Volume',
        description: 'Optional description',
        initialValue: 'Quarter close workspace',
        footer: 'Enter saves. Esc cancels.',
      },
    });
    expect(buildEditVolumeSuccessMessage('Finance 2026')).toBe(
      'Volume "Finance 2026" updated.',
    );
    expect(buildCreateFolderPrompt('/reports').description).toBe('New folder inside /reports');
    expect(buildCreateFolderSuccessMessage('archive')).toBe('Folder "archive" created.');

    const movePrompts = buildMoveEntryPrompts('report.txt', '/reports');
    expect(movePrompts.destination.initialValue).toBe('/reports');
    expect(movePrompts.rename.initialValue).toBe('report.txt');
    expect(buildMoveEntrySuccessMessage('/archive/report.txt')).toBe(
      'Entry moved to /archive/report.txt.',
    );

    expect(
      buildDeleteEntryConfirmation({
        name: 'report.txt',
        path: '/reports/report.txt',
      }),
    ).toEqual({
      title: 'Delete Entry',
      body: 'Delete "report.txt" and every nested node inside /reports/report.txt?',
      confirmLabel: 'Delete',
    });
    expect(buildDeleteEntrySuccessMessage(5)).toBe('Deleted 5 entry nodes.');

    const volume: Pick<VolumeManifest, 'name'> = { name: 'Finance' };
    expect(buildDeleteVolumeConfirmation(volume)).toEqual({
      title: 'Delete Volume',
      body: 'Delete volume "Finance" and all persisted blobs and metadata?',
      confirmLabel: 'Delete',
    });
    expect(buildDeleteVolumeSuccessMessage('Finance')).toBe('Volume "Finance" deleted.');
  });

  it('builds import and export notifications', () => {
    expect(buildImportEmptySelectionMessage()).toBe(
      'Select at least one host file or folder to import.',
    );
    expect(buildImportTaskDetail('/reports', 3)).toBe(
      'Destination /reports  3 host items queued.',
    );
    expect(
      buildImportSuccessNotification(
        {
          filesImported: 2,
          directoriesImported: 1,
          bytesImported: 4096,
          conflictsResolved: 0,
          integrityChecksPassed: 3,
        },
        '/reports',
      ),
    ).toEqual({
      message: 'Imported 2 files and 1 directories.',
      detail: 'Destination /reports  4.0 KB transferred  Conflicts 0  Integrity 3',
    });

    expect(buildExportTaskDetail('/reports/report.txt', '/exports')).toBe(
      'Source /reports/report.txt  Destination /exports',
    );
    expect(
      buildExportSuccessNotification(
        {
          filesExported: 4,
          directoriesExported: 2,
          bytesExported: 8192,
          conflictsResolved: 1,
          integrityChecksPassed: 6,
        },
        '/exports',
      ),
    ).toEqual({
      message: 'Exported 4 files and 2 directories.',
      detail: 'Destination /exports  8.0 KB transferred  Conflicts 1  Integrity 6',
    });
  });

  it('builds help and preview overlay content', () => {
    const preview: FilePreview = {
      path: '/reports/report.txt',
      size: 2048,
      kind: 'text',
      content: 'Quarterly report',
      truncated: false,
    };

    const help = buildHelpOverlayOptions();
    expect(help.title).toBe('Help');
    expect(help.content).toContain('M: edit selected volume name and description');
    expect(help.content).toContain('Host Import Modal');
    expect(help.content).toContain('Enter or E: export into the current host folder');

    const previewOverlay = buildPreviewOverlayOptions(preview);
    expect(previewOverlay.title).toBe('Preview  /reports/report.txt');
    expect(previewOverlay.content).toContain('Kind: TEXT');
    expect(previewOverlay.content).toContain('Size: 2.0 KB');
    expect(previewOverlay.content).toContain('Quarterly report');
  });
});
