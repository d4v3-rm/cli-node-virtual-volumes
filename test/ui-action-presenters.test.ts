import { describe, expect, it } from 'vitest';

import type { FilePreview, VolumeManifest } from '../src/domain/types.js';
import {
  buildCreateFolderPrompt,
  buildCreateFolderSuccessMessage,
  buildCreateVolumePrompts,
  buildCreateVolumeSuccessMessage,
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
} from '../src/ui/action-presenters.js';

describe('ui action presenters', () => {
  it('builds create volume prompts and parses quota input safely', () => {
    const prompts = buildCreateVolumePrompts(8192);

    expect(prompts.name.description).toBe('Volume name');
    expect(prompts.quota.initialValue).toBe('8192');
    expect(prompts.description.description).toBe('Optional description');

    expect(parseVolumeQuotaInput('')).toEqual({
      error: null,
      quotaBytes: undefined,
    });
    expect(parseVolumeQuotaInput('4096')).toEqual({
      error: null,
      quotaBytes: 4096,
    });
    expect(parseVolumeQuotaInput('abc')).toEqual({
      error: 'Quota bytes must be a valid integer.',
      quotaBytes: undefined,
    });
  });

  it('builds create, move, and delete action copy', () => {
    expect(buildCreateVolumeSuccessMessage('Finance')).toBe('Volume "Finance" created.');
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
    expect(help.content).toContain('Host Import Modal');
    expect(help.content).toContain('Enter or E: export into the current host folder');

    const previewOverlay = buildPreviewOverlayOptions(preview);
    expect(previewOverlay.title).toBe('Preview  /reports/report.txt');
    expect(previewOverlay.content).toContain('Kind: TEXT');
    expect(previewOverlay.content).toContain('Size: 2.0 KB');
    expect(previewOverlay.content).toContain('Quarterly report');
  });
});
