import React, {
  startTransition,
  useEffect,
  useEffectEvent,
  useState,
} from 'react';

import { Box, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';

import type { AppRuntime } from '../bootstrap/create-runtime.js';
import { isVolumeError } from '../domain/errors.js';
import type {
  DirectoryListingItem,
  ExplorerSnapshot,
  FilePreview,
  VolumeManifest,
} from '../domain/types.js';
import { formatBytes, formatDateTime, truncate } from '../utils/formatters.js';
import { parseHostPathBatchInput } from '../utils/host-input.js';
import { getParentVirtualPath } from '../utils/virtual-paths.js';
import { Pane } from './components/pane.js';

type Screen = 'dashboard' | 'explorer';
type ToastTone = 'success' | 'error' | 'info';

type OverlayState =
  | { kind: 'create-volume' }
  | { kind: 'create-folder' }
  | { kind: 'import'; destinationPath: string }
  | {
      kind: 'move';
      sourcePath: string;
      initialDestinationPath: string;
      initialName: string;
    }
  | { kind: 'delete-entry'; targetPath: string; label: string }
  | { kind: 'delete-volume'; volumeId: string; volumeName: string }
  | { kind: 'preview'; preview: FilePreview }
  | { kind: 'help' };

interface ToastState {
  tone: ToastTone;
  message: string;
}

const clampIndex = (index: number, length: number): number => {
  if (length <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(index, length - 1));
};

const cycleSelection = <T extends string>(
  values: readonly T[],
  current: T,
  direction: 1 | -1,
): T => {
  const currentIndex = values.indexOf(current);
  if (currentIndex === -1) {
    return values[0] ?? current;
  }

  const nextIndex = (currentIndex + direction + values.length) % values.length;
  return values[nextIndex] ?? current;
};

const getErrorMessage = (error: unknown): string => {
  if (isVolumeError(error)) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unexpected error.';
};

const getToastColor = (tone: ToastTone): string => {
  switch (tone) {
    case 'success':
      return 'green';
    case 'error':
      return 'red';
    default:
      return 'cyan';
  }
};

const renderSelectableRow = (
  label: string,
  description: string,
  active: boolean,
): React.JSX.Element => (
  <Box flexDirection="column" marginBottom={1}>
    <Text color={active ? 'cyanBright' : 'white'}>
      {active ? '> ' : '  '}
      {label}
    </Text>
    <Text color="gray">{description}</Text>
  </Box>
);

interface FormFieldProps {
  label: string;
  active: boolean;
  children: React.ReactNode;
}

const FormField = ({ label, active, children }: FormFieldProps): React.JSX.Element => (
  <Box flexDirection="column" marginBottom={1}>
    <Text color={active ? 'cyanBright' : 'gray'}>{label}</Text>
    <Box>{children}</Box>
  </Box>
);

const CHOICE_BUTTON_WIDTH = 18;

const ChoiceButton = ({
  label,
  active,
}: {
  label: string;
  active: boolean;
}): React.JSX.Element => (
  <Box marginRight={1} minWidth={CHOICE_BUTTON_WIDTH}>
    <Text color={active ? 'black' : 'white'} backgroundColor={active ? 'cyan' : undefined}>
      {active ? ` ${label} ` : `  ${label}  `}
    </Text>
  </Box>
);

const ScrollableTextBlock = ({
  lines,
  offset,
  maxLines,
}: {
  lines: string[];
  offset: number;
  maxLines: number;
}): React.JSX.Element => (
  <Box flexDirection="column">
    {lines.slice(offset, offset + maxLines).map((line, index) => (
      <Text key={`${offset}-${index}-${line.slice(0, 16)}`}>{line}</Text>
    ))}
  </Box>
);

interface CreateVolumeOverlayProps {
  defaultQuotaBytes: number;
  onCancel: () => void;
  onSubmit: (payload: {
    name: string;
    quotaBytes?: number;
    description: string;
  }) => void;
}

const CreateVolumeOverlay = ({
  defaultQuotaBytes,
  onCancel,
  onSubmit,
}: CreateVolumeOverlayProps): React.JSX.Element => {
  const fieldOrder = ['name', 'quotaBytes', 'description'] as const;
  const [name, setName] = useState('');
  const [quotaBytes, setQuotaBytes] = useState(String(defaultQuotaBytes));
  const [description, setDescription] = useState('');
  const [activeField, setActiveField] =
    useState<(typeof fieldOrder)[number]>('name');

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow) {
      setActiveField((current) => cycleSelection(fieldOrder, current, -1));
      return;
    }

    if (key.downArrow || key.tab) {
      setActiveField((current) =>
        cycleSelection(fieldOrder, current, key.shift ? -1 : 1),
      );
    }
  });

  const submit = (): void => {
    const trimmedQuota = quotaBytes.trim();
    const numericQuota =
      trimmedQuota.length === 0 ? undefined : Number.parseInt(trimmedQuota, 10);

    if (numericQuota !== undefined && Number.isNaN(numericQuota)) {
      return;
    }

    onSubmit({
      name,
      quotaBytes: numericQuota,
      description,
    });
  };

  return (
    <Pane
      title="Create Volume"
      active
      footer="Up/Down switch field. Left/Right edit text. Enter advances. Esc cancels."
    >
      <Text color="gray">
        Define name, logical quota and an optional description for the new volume.
      </Text>
      <Box marginTop={1} flexDirection="column">
        <FormField label="Volume name" active={activeField === 'name'}>
          <TextInput
            focus={activeField === 'name'}
            value={name}
            placeholder="Project-X"
            onChange={setName}
            onSubmit={() => setActiveField('quotaBytes')}
          />
        </FormField>
        <FormField label="Quota bytes" active={activeField === 'quotaBytes'}>
          <TextInput
            focus={activeField === 'quotaBytes'}
            value={quotaBytes}
            placeholder="10995116277760"
            onChange={setQuotaBytes}
            onSubmit={() => setActiveField('description')}
          />
        </FormField>
        <FormField label="Description" active={activeField === 'description'}>
          <TextInput
            focus={activeField === 'description'}
            value={description}
            placeholder="Internal secure archive"
            onChange={setDescription}
            onSubmit={submit}
          />
        </FormField>
      </Box>
    </Pane>
  );
};

interface CreateFolderOverlayProps {
  onCancel: () => void;
  onSubmit: (payload: { name: string }) => void;
}

const CreateFolderOverlay = ({
  onCancel,
  onSubmit,
}: CreateFolderOverlayProps): React.JSX.Element => {
  const [name, setName] = useState('');

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  return (
    <Pane
      title="Create Folder"
      active
      footer="Type the folder name and press Enter. Esc cancels."
    >
      <FormField label="Folder name" active>
        <TextInput
          focus
          value={name}
          placeholder="assets"
          onChange={setName}
          onSubmit={() => onSubmit({ name })}
        />
      </FormField>
    </Pane>
  );
};

interface ImportOverlayProps {
  destinationPath: string;
  onCancel: () => void;
  onSubmit: (payload: { hostPathsInput: string; destinationPath: string }) => void;
}

const ImportOverlay = ({
  destinationPath,
  onCancel,
  onSubmit,
}: ImportOverlayProps): React.JSX.Element => {
  const fieldOrder = ['hostPaths', 'destinationPath'] as const;
  const [hostPathsInput, setHostPathsInput] = useState('');
  const [targetPath, setTargetPath] = useState(destinationPath);
  const [activeField, setActiveField] =
    useState<(typeof fieldOrder)[number]>('hostPaths');

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow) {
      setActiveField((current) => cycleSelection(fieldOrder, current, -1));
      return;
    }

    if (key.downArrow || key.tab) {
      setActiveField((current) =>
        cycleSelection(fieldOrder, current, key.shift ? -1 : 1),
      );
    }
  });

  return (
    <Pane
      title="Import Host Paths"
      active
      footer="Up/Down switch field. Left/Right edit text. Enter advances. Esc cancels."
    >
      <Text color="gray">
        Example:
        {' '}
        C:\Data\images;C:\Data\report.pdf
      </Text>
      <Box marginTop={1} flexDirection="column">
        <FormField label="Host paths" active={activeField === 'hostPaths'}>
          <TextInput
            focus={activeField === 'hostPaths'}
            value={hostPathsInput}
            placeholder="C:\\Data\\images;C:\\Data\\report.pdf"
            onChange={setHostPathsInput}
            onSubmit={() => setActiveField('destinationPath')}
          />
        </FormField>
        <FormField label="Destination" active={activeField === 'destinationPath'}>
          <TextInput
            focus={activeField === 'destinationPath'}
            value={targetPath}
            placeholder="/"
            onChange={setTargetPath}
            onSubmit={() =>
              onSubmit({ hostPathsInput, destinationPath: targetPath })
            }
          />
        </FormField>
      </Box>
    </Pane>
  );
};

interface MoveOverlayProps {
  sourcePath: string;
  initialDestinationPath: string;
  initialName: string;
  onCancel: () => void;
  onSubmit: (payload: { destinationPath: string; newName: string }) => void;
}

const MoveOverlay = ({
  sourcePath,
  initialDestinationPath,
  initialName,
  onCancel,
  onSubmit,
}: MoveOverlayProps): React.JSX.Element => {
  const fieldOrder = ['destinationPath', 'newName'] as const;
  const [destinationPath, setDestinationPath] = useState(initialDestinationPath);
  const [newName, setNewName] = useState(initialName);
  const [activeField, setActiveField] =
    useState<(typeof fieldOrder)[number]>('destinationPath');

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow) {
      setActiveField((current) => cycleSelection(fieldOrder, current, -1));
      return;
    }

    if (key.downArrow || key.tab) {
      setActiveField((current) =>
        cycleSelection(fieldOrder, current, key.shift ? -1 : 1),
      );
    }
  });

  return (
    <Pane
      title="Move / Rename"
      active
      footer="Up/Down switch field. Left/Right edit text. Enter advances. Esc cancels."
    >
      <Text color="gray">Source: {sourcePath}</Text>
      <Box marginTop={1} flexDirection="column">
        <FormField label="Destination path" active={activeField === 'destinationPath'}>
          <TextInput
            focus={activeField === 'destinationPath'}
            value={destinationPath}
            placeholder="/"
            onChange={setDestinationPath}
            onSubmit={() => setActiveField('newName')}
          />
        </FormField>
        <FormField label="New name" active={activeField === 'newName'}>
          <TextInput
            focus={activeField === 'newName'}
            value={newName}
            placeholder="renamed-entry"
            onChange={setNewName}
            onSubmit={() => onSubmit({ destinationPath, newName })}
          />
        </FormField>
      </Box>
    </Pane>
  );
};

interface ConfirmOverlayProps {
  title: string;
  body: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

const ConfirmOverlay = ({
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm,
}: ConfirmOverlayProps): React.JSX.Element => {
  const [selectedAction, setSelectedAction] = useState<'confirm' | 'cancel'>('confirm');

  useInput((input, key) => {
    if (key.escape || input.toLowerCase() === 'n') {
      onCancel();
      return;
    }

    if (key.leftArrow || key.upArrow) {
      setSelectedAction('cancel');
      return;
    }

    if (key.rightArrow || key.downArrow) {
      setSelectedAction('confirm');
      return;
    }

    if (input.toLowerCase() === 'y' || key.return) {
      if (selectedAction === 'confirm') {
        onConfirm();
      } else {
        onCancel();
      }
    }
  });

  return (
    <Pane
      title={title}
      active
      footer={`Left/Right choose. Enter confirms. Y/N still work. Esc cancels.`}
    >
      <Text>{body}</Text>
      <Box marginTop={1}>
        <ChoiceButton label={confirmLabel} active={selectedAction === 'confirm'} />
        <ChoiceButton label="Cancel" active={selectedAction === 'cancel'} />
      </Box>
    </Pane>
  );
};

interface PreviewOverlayProps {
  preview: FilePreview;
  onClose: () => void;
}

const PreviewOverlay = ({
  preview,
  onClose,
}: PreviewOverlayProps): React.JSX.Element => {
  const lines = preview.content.split('\n');
  const maxLines = 12;
  const [offset, setOffset] = useState(0);

  useInput((input, key) => {
    if (key.escape || key.return || input.toLowerCase() === 'q') {
      onClose();
      return;
    }

    if (key.upArrow) {
      setOffset((current) => clampIndex(current - 1, lines.length));
      return;
    }

    if (key.downArrow) {
      setOffset((current) =>
        clampIndex(current + 1, Math.max(1, lines.length - maxLines + 1)),
      );
    }
  });

  return (
    <Pane
      title="File Preview"
      active
      footer="Up/Down scroll preview. Enter, Q or Esc closes it."
    >
      <Text color="gray">
        {preview.path}
        {'  '}
        {formatBytes(preview.size)}
        {'  '}
        {preview.kind.toUpperCase()}
        {preview.truncated ? '  TRUNCATED' : ''}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <ScrollableTextBlock lines={lines} offset={offset} maxLines={maxLines} />
        {lines.length > maxLines ? (
          <Text color="gray">
            lines {offset + 1}-{Math.min(offset + maxLines, lines.length)} of {lines.length}
          </Text>
        ) : null}
      </Box>
    </Pane>
  );
};

const HelpOverlay = ({ onClose }: { onClose: () => void }): React.JSX.Element => {
  const helpLines = [
    'Dashboard keys:',
    'Up/Down moves selection, Enter opens the selected volume.',
    'Shortcuts: O open, N create, R refresh, X delete, Q quit.',
    '',
    'Explorer keys:',
    'Up/Down moves selection, Enter opens, Backspace goes up.',
    'Shortcuts: C create folder, I import, M move, D delete, P preview, B dashboard, R refresh.',
    '',
    'Modal keys:',
    'Up/Down switches fields inside forms.',
    'Left/Right edits text or chooses confirm/cancel when available.',
    'Enter confirms, Esc closes the current modal.',
  ];
  const maxLines = 10;
  const [offset, setOffset] = useState(0);

  useInput((input, key) => {
    if (key.escape || key.return || input.toLowerCase() === 'q') {
      onClose();
      return;
    }

    if (key.upArrow) {
      setOffset((current) => clampIndex(current - 1, helpLines.length));
      return;
    }

    if (key.downArrow) {
      setOffset((current) =>
        clampIndex(current + 1, Math.max(1, helpLines.length - maxLines + 1)),
      );
    }
  });

  return (
    <Pane title="Help" active footer="Up/Down scroll help. Enter, Q or Esc closes.">
      <ScrollableTextBlock lines={helpLines} offset={offset} maxLines={maxLines} />
    </Pane>
  );
};

export const App = ({ runtime }: { runtime: AppRuntime }): React.JSX.Element => {
  const { exit } = useApp();

  const [screen, setScreen] = useState<Screen>('dashboard');
  const [volumes, setVolumes] = useState<VolumeManifest[]>([]);
  const [selectedVolumeIndex, setSelectedVolumeIndex] = useState(0);
  const [currentVolumeId, setCurrentVolumeId] = useState<string | null>(null);
  const [currentSnapshot, setCurrentSnapshot] = useState<ExplorerSnapshot | null>(null);
  const [selectedEntryIndex, setSelectedEntryIndex] = useState(0);
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>('Loading volumes');

  const currentEntries = currentSnapshot?.entries ?? [];
  const selectedVolume = volumes[selectedVolumeIndex] ?? null;
  const selectedEntry = currentEntries[selectedEntryIndex] ?? null;
  const busy = busyLabel !== null;

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timeoutHandle = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timeoutHandle);
  }, [toast]);

  const notify = (tone: ToastTone, message: string): void => {
    setToast({ tone, message });
  };

  const withTask = async <T,>(
    label: string,
    operation: () => Promise<T>,
  ): Promise<T | null> => {
    setBusyLabel(label);

    try {
      return await operation();
    } catch (error) {
      const message = getErrorMessage(error);
      runtime.logger.error({ error, label }, 'TUI operation failed.');
      notify('error', message);
      return null;
    } finally {
      setBusyLabel(null);
    }
  };

  const loadVolumes = useEffectEvent(async () => {
    const nextVolumes = await withTask('Loading volumes', () =>
      runtime.volumeService.listVolumes(),
    );

    if (!nextVolumes) {
      return;
    }

    startTransition(() => {
      setVolumes(nextVolumes);
      setSelectedVolumeIndex((current) => clampIndex(current, nextVolumes.length));
    });
  });

  const openVolume = useEffectEvent(async (volumeId: string, targetPath = '/') => {
    const snapshot = await withTask('Opening volume', () =>
      runtime.volumeService.getExplorerSnapshot(volumeId, targetPath),
    );

    if (!snapshot) {
      return;
    }

    startTransition(() => {
      setCurrentVolumeId(volumeId);
      setCurrentSnapshot(snapshot);
      setScreen('explorer');
      setSelectedEntryIndex(0);
    });
  });

  useEffect(() => {
    void loadVolumes();
  }, []);

  const previewSelectedEntry = async (): Promise<void> => {
    if (!currentVolumeId || !selectedEntry) {
      return;
    }

    if (selectedEntry.kind !== 'file') {
      notify('info', 'Preview is available for files only.');
      return;
    }

    const preview = await withTask('Loading preview', () =>
      runtime.volumeService.previewFile(currentVolumeId, selectedEntry.path),
    );

    if (preview) {
      setOverlay({ kind: 'preview', preview });
    }
  };

  const openSelectedVolume = async (): Promise<void> => {
    if (!selectedVolume) {
      notify('info', 'Create a volume first.');
      return;
    }

    await openVolume(selectedVolume.id);
  };

  const queueDeleteSelectedVolume = (): void => {
    if (!selectedVolume) {
      notify('info', 'No volume selected.');
      return;
    }

    setOverlay({
      kind: 'delete-volume',
      volumeId: selectedVolume.id,
      volumeName: selectedVolume.name,
    });
  };

  const goToDashboard = async (): Promise<void> => {
    setScreen('dashboard');
    setCurrentVolumeId(null);
    setCurrentSnapshot(null);
    await loadVolumes();
  };

  const openSelectedEntry = async (): Promise<void> => {
    if (!currentVolumeId) {
      return;
    }

    if (!selectedEntry) {
      notify('info', 'Select an entry first.');
      return;
    }

    if (selectedEntry.kind === 'directory') {
      await openVolume(currentVolumeId, selectedEntry.path);
      return;
    }

    await previewSelectedEntry();
  };

  const goUpDirectory = async (): Promise<void> => {
    if (!currentVolumeId || !currentSnapshot) {
      return;
    }

    await openVolume(
      currentVolumeId,
      getParentVirtualPath(currentSnapshot.currentPath),
    );
  };

  const queueMoveSelectedEntry = (): void => {
    if (!selectedEntry || !currentSnapshot) {
      notify('info', 'Select an entry first.');
      return;
    }

    setOverlay({
      kind: 'move',
      sourcePath: selectedEntry.path,
      initialDestinationPath: currentSnapshot.currentPath,
      initialName: selectedEntry.name,
    });
  };

  const queueDeleteSelectedEntry = (): void => {
    if (!selectedEntry) {
      notify('info', 'Select an entry first.');
      return;
    }

    setOverlay({
      kind: 'delete-entry',
      targetPath: selectedEntry.path,
      label: selectedEntry.name,
    });
  };

  const performCreateVolume = async (payload: {
    name: string;
    quotaBytes?: number;
    description: string;
  }): Promise<void> => {
    const createdVolume = await withTask('Creating volume', () =>
      runtime.volumeService.createVolume(payload),
    );

    if (!createdVolume) {
      return;
    }

    setOverlay(null);
    notify('success', `Volume "${createdVolume.name}" created.`);
    await loadVolumes();
    await openVolume(createdVolume.id);
  };

  const performCreateFolder = async (payload: { name: string }): Promise<void> => {
    if (!currentVolumeId || !currentSnapshot) {
      return;
    }

    const createdDirectory = await withTask('Creating folder', () =>
      runtime.volumeService.createDirectory(
        currentVolumeId,
        currentSnapshot.currentPath,
        payload.name,
      ),
    );

    if (!createdDirectory) {
      return;
    }

    setOverlay(null);
    notify('success', `Folder "${createdDirectory.name}" created.`);
    await openVolume(currentVolumeId, currentSnapshot.currentPath);
  };

  const performImport = async (payload: {
    hostPathsInput: string;
    destinationPath: string;
  }): Promise<void> => {
    if (!currentVolumeId) {
      return;
    }

    const hostPaths = parseHostPathBatchInput(payload.hostPathsInput);
    if (hostPaths.length === 0) {
      notify('info', 'Paste at least one host path to import.');
      return;
    }

    const summary = await withTask('Importing host paths', () =>
      runtime.volumeService.importHostPaths(currentVolumeId, {
        hostPaths,
        destinationPath: payload.destinationPath,
      }),
    );

    if (!summary) {
      return;
    }

    setOverlay(null);
    notify(
      'success',
      `Imported ${summary.filesImported} files and ${summary.directoriesImported} directories.`,
    );
    await openVolume(currentVolumeId, payload.destinationPath);
  };

  const performMove = async (payload: {
    destinationPath: string;
    newName: string;
  }): Promise<void> => {
    if (!currentVolumeId || !currentSnapshot || overlay?.kind !== 'move') {
      return;
    }

    const updatedPath = await withTask('Moving entry', () =>
      runtime.volumeService.moveEntry(currentVolumeId, {
        sourcePath: overlay.sourcePath,
        destinationDirectoryPath: payload.destinationPath,
        newName: payload.newName,
      }),
    );

    if (!updatedPath) {
      return;
    }

    setOverlay(null);
    notify('success', `Entry moved to ${updatedPath}.`);
    await openVolume(currentVolumeId, currentSnapshot.currentPath);
  };

  const performDeleteEntry = async (): Promise<void> => {
    if (!currentVolumeId || !currentSnapshot || overlay?.kind !== 'delete-entry') {
      return;
    }

    const deletedCount = await withTask('Deleting entry', () =>
      runtime.volumeService.deleteEntry(currentVolumeId, overlay.targetPath),
    );

    if (deletedCount === null) {
      return;
    }

    setOverlay(null);
    notify('success', `Deleted ${deletedCount} entry nodes.`);
    await openVolume(currentVolumeId, currentSnapshot.currentPath);
  };

  const performDeleteVolume = async (): Promise<void> => {
    if (overlay?.kind !== 'delete-volume') {
      return;
    }

    const deleted = await withTask('Deleting volume', async () => {
      await runtime.volumeService.deleteVolume(overlay.volumeId);
      return true;
    });

    if (!deleted) {
      return;
    }

    setOverlay(null);
    notify('success', `Volume "${overlay.volumeName}" deleted.`);
    setCurrentVolumeId(null);
    setCurrentSnapshot(null);
    setScreen('dashboard');
    await loadVolumes();
  };

  useInput(
    (input, key) => {
      if (key.ctrl && input.toLowerCase() === 'c') {
        exit();
        return;
      }

      if (screen === 'dashboard') {
        if (input.toLowerCase() === '?') {
          setOverlay({ kind: 'help' });
          return;
        }

        if (input.toLowerCase() === 'q') {
          exit();
          return;
        }

        if (input.toLowerCase() === 'n') {
          setOverlay({ kind: 'create-volume' });
          return;
        }

        if (input.toLowerCase() === 'o' || key.return) {
          void openSelectedVolume();
          return;
        }

        if (input.toLowerCase() === 'r') {
          void loadVolumes();
          return;
        }

        if (input.toLowerCase() === 'x') {
          queueDeleteSelectedVolume();
          return;
        }

        if (key.upArrow) {
          setSelectedVolumeIndex((current) =>
            clampIndex(current - 1, volumes.length),
          );
          return;
        }

        if (key.downArrow) {
          setSelectedVolumeIndex((current) =>
            clampIndex(current + 1, volumes.length),
          );
          return;
        }

        return;
      }

      if (input.toLowerCase() === '?') {
        setOverlay({ kind: 'help' });
        return;
      }

      if (input.toLowerCase() === 'q' || input.toLowerCase() === 'b') {
        void goToDashboard();
        return;
      }

      if (key.backspace) {
        void goUpDirectory();
        return;
      }

      if (input.toLowerCase() === 'c') {
        setOverlay({ kind: 'create-folder' });
        return;
      }

      if (input.toLowerCase() === 'i' && currentSnapshot) {
        setOverlay({ kind: 'import', destinationPath: currentSnapshot.currentPath });
        return;
      }

      if (input.toLowerCase() === 'm') {
        queueMoveSelectedEntry();
        return;
      }

      if (input.toLowerCase() === 'd') {
        queueDeleteSelectedEntry();
        return;
      }

      if (input.toLowerCase() === 'p') {
        void previewSelectedEntry();
        return;
      }

      if (input.toLowerCase() === 'r') {
        if (currentVolumeId && currentSnapshot) {
          void openVolume(currentVolumeId, currentSnapshot.currentPath);
        }
        return;
      }

      if (key.upArrow) {
        setSelectedEntryIndex((current) =>
          clampIndex(current - 1, currentEntries.length),
        );
        return;
      }

      if (key.downArrow) {
        setSelectedEntryIndex((current) =>
          clampIndex(current + 1, currentEntries.length),
        );
        return;
      }

      if (key.return) {
        void openSelectedEntry();
        return;
      }
    },
    { isActive: overlay === null && !busy },
  );

  const renderOverlay = (): React.JSX.Element | null => {
    if (!overlay) {
      return null;
    }

    switch (overlay.kind) {
      case 'create-volume':
        return (
          <CreateVolumeOverlay
            defaultQuotaBytes={runtime.config.defaultQuotaBytes}
            onCancel={() => setOverlay(null)}
            onSubmit={(payload) => void performCreateVolume(payload)}
          />
        );
      case 'create-folder':
        return (
          <CreateFolderOverlay
            onCancel={() => setOverlay(null)}
            onSubmit={(payload) => void performCreateFolder(payload)}
          />
        );
      case 'import':
        return (
          <ImportOverlay
            destinationPath={overlay.destinationPath}
            onCancel={() => setOverlay(null)}
            onSubmit={(payload) => void performImport(payload)}
          />
        );
      case 'move':
        return (
          <MoveOverlay
            sourcePath={overlay.sourcePath}
            initialDestinationPath={overlay.initialDestinationPath}
            initialName={overlay.initialName}
            onCancel={() => setOverlay(null)}
            onSubmit={(payload) => void performMove(payload)}
          />
        );
      case 'delete-entry':
        return (
          <ConfirmOverlay
            title="Delete Entry"
            body={`Delete "${overlay.label}" and every nested item inside ${overlay.targetPath}?`}
            confirmLabel="Delete"
            onCancel={() => setOverlay(null)}
            onConfirm={() => void performDeleteEntry()}
          />
        );
      case 'delete-volume':
        return (
          <ConfirmOverlay
            title="Delete Volume"
            body={`Delete volume "${overlay.volumeName}" and all persisted blobs, metadata and directories?`}
            confirmLabel="Delete"
            onCancel={() => setOverlay(null)}
            onConfirm={() => void performDeleteVolume()}
          />
        );
      case 'preview':
        return (
          <PreviewOverlay
            preview={overlay.preview}
            onClose={() => setOverlay(null)}
          />
        );
      case 'help':
        return <HelpOverlay onClose={() => setOverlay(null)} />;
    }
  };

  const renderShortcutRow = (items: string[]): React.JSX.Element => (
    <Box flexWrap="wrap">
      {items.map((item) => (
        <Box key={item} marginRight={2}>
          <Text color="gray">{item}</Text>
        </Box>
      ))}
    </Box>
  );

  const renderDashboard = (): React.JSX.Element => (
    <Box flexDirection="column">
      <Text color="cyanBright">Virtual Volumes</Text>
      <Text color="gray">Keyboard-first virtual filesystem manager for Node.js.</Text>
      <Box marginTop={1}>
        <Text color="cyan">
          Data dir:
          {' '}
          {runtime.config.dataDir}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">
          {volumes.length}
          {' '}
          volumes detected.
        </Text>
      </Box>
      <Box marginTop={1}>
        <Box flexGrow={3} marginRight={1}>
          <Pane title="Volumes" active footer="Up/Down selects. Enter opens.">
            {volumes.length === 0 ? (
              <Text color="gray">
                No virtual volumes yet. Use Create Volume to start.
              </Text>
            ) : (
              volumes.map((volume, index) => (
                <React.Fragment key={volume.id}>
                  {renderSelectableRow(
                    `${volume.name}  ${formatBytes(volume.logicalUsedBytes)} / ${formatBytes(volume.quotaBytes)}`,
                    truncate(volume.description || 'No description.', 72),
                    index === selectedVolumeIndex,
                  )}
                </React.Fragment>
              ))
            )}
          </Pane>
        </Box>
        <Box flexGrow={2}>
          <Pane title="Inspector" active footer="Actions are direct keyboard shortcuts.">
            {selectedVolume ? (
              <Box flexDirection="column" marginBottom={1}>
                <Text color="cyanBright">{selectedVolume.name}</Text>
                <Text color="gray">Id: {selectedVolume.id}</Text>
                <Text color="gray">
                  Used:
                  {' '}
                  {formatBytes(selectedVolume.logicalUsedBytes)}
                  {' / '}
                  {formatBytes(selectedVolume.quotaBytes)}
                </Text>
                <Text color="gray">
                  Updated:
                  {' '}
                  {formatDateTime(selectedVolume.updatedAt)}
                </Text>
              </Box>
            ) : (
              <Text color="gray">No volume selected.</Text>
            )}
            <Box marginTop={1} flexDirection="column">
              <Text color="white">Shortcuts</Text>
              {renderShortcutRow([
                'Enter/O open',
                'N create',
                'X delete',
                'R refresh',
                '? help',
                'Q quit',
              ])}
            </Box>
          </Pane>
        </Box>
      </Box>
    </Box>
  );

  const renderEntryInspector = (
    snapshot: ExplorerSnapshot,
    entry: DirectoryListingItem | null,
  ): React.JSX.Element => (
    <Box flexDirection="column">
      <Text color="cyanBright">
        {snapshot.volume.name}
        {'  '}
        <Text color="gray">{snapshot.currentPath}</Text>
      </Text>
      <Text color="gray">
        Used:
        {' '}
        {formatBytes(snapshot.usageBytes)}
        {' / '}
        {formatBytes(snapshot.volume.quotaBytes)}
        {'  '}
        Remaining:
        {' '}
        {formatBytes(snapshot.remainingBytes)}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text color="gray">
          Breadcrumbs:
          {' '}
          {snapshot.breadcrumbs.join(' / ')}
        </Text>
        <Text color="gray">
          Entries in current dir:
          {' '}
          {snapshot.entries.length}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color="white">Selected entry</Text>
        {entry ? (
          <>
            <Text color="cyanBright">{entry.name}</Text>
            <Text color="gray">
              {entry.kind.toUpperCase()}
              {entry.kind === 'file' ? `  ${formatBytes(entry.size)}` : ''}
            </Text>
            <Text color="gray">{truncate(entry.path, 84)}</Text>
            <Text color="gray">{formatDateTime(entry.updatedAt)}</Text>
          </>
        ) : (
          <Text color="gray">Current directory is empty.</Text>
        )}
      </Box>
    </Box>
  );

  const renderExplorer = (): React.JSX.Element => {
    if (!currentSnapshot) {
      return (
        <Pane title="Explorer" active>
          <Text color="gray">No volume opened.</Text>
        </Pane>
      );
    }

    return (
      <Box flexDirection="column">
        <Text color="cyanBright">
          {currentSnapshot.volume.name}
          {'  '}
          <Text color="gray">{currentSnapshot.currentPath}</Text>
        </Text>
        <Text color="gray">
          Node-only storage rooted in
          {' '}
          {runtime.config.dataDir}
        </Text>
        <Box marginTop={1}>
          <Box flexGrow={3} marginRight={1}>
            <Pane title="Entries" active footer="Up/Down select. Enter opens. Backspace goes up.">
              {currentEntries.length === 0 ? (
                <Text color="gray">This directory is empty.</Text>
              ) : (
                currentEntries.map((entry, index) => (
                  <React.Fragment key={entry.id}>
                    {renderSelectableRow(
                      `${entry.kind === 'directory' ? '[DIR]' : '[FILE]'} ${truncate(entry.name, 48)}`,
                      `${truncate(entry.path, 60)}  ${entry.kind === 'file' ? formatBytes(entry.size) : 'directory'}  ${formatDateTime(entry.updatedAt)}`,
                      index === selectedEntryIndex,
                    )}
                  </React.Fragment>
                ))
              )}
            </Pane>
          </Box>
          <Box flexGrow={2}>
            <Pane title="Inspector" active footer="Everything here runs via shortcut.">
              {renderEntryInspector(currentSnapshot, selectedEntry)}
              <Box marginTop={1} flexDirection="column">
                <Text color="white">Shortcuts</Text>
                {renderShortcutRow([
                  'Enter open',
                  'Backspace up',
                  'C folder',
                  'I import',
                  'M move',
                  'D delete',
                  'P preview',
                  'R refresh',
                  'B/Q dashboard',
                  '? help',
                ])}
              </Box>
            </Pane>
          </Box>
        </Box>
      </Box>
    );
  };

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {screen === 'dashboard' ? renderDashboard() : renderExplorer()}

      {overlay ? <Box marginTop={1}>{renderOverlay()}</Box> : null}

      <Box marginTop={1}>
        <Pane title="Status" active={busy || toast?.tone === 'error'}>
          {busy && busyLabel ? (
            <Box>
              <Text color="cyan">
                <Spinner type="dots" />
                {' '}
                {busyLabel}
              </Text>
            </Box>
          ) : null}
          {toast ? (
            <Text color={getToastColor(toast.tone)}>{toast.message}</Text>
          ) : (
            <Text color="gray">
              Keyboard-first mode enabled. Help is always available with ?.
            </Text>
          )}
          <Text color="gray">
            Logs:
            {' '}
            {runtime.config.logDir}
          </Text>
        </Pane>
      </Box>
    </Box>
  );
};
