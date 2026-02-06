import React, {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useState,
} from 'react';

import BigText from 'ink-big-text';
import Gradient from 'ink-gradient';
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
type DashboardFocus = 'volumes' | 'actions';
type ExplorerFocus = 'entries' | 'actions';
type ToastTone = 'success' | 'error' | 'info';

type DashboardActionId =
  | 'open'
  | 'create'
  | 'refresh'
  | 'delete'
  | 'help'
  | 'quit';

type ExplorerActionId =
  | 'open'
  | 'up'
  | 'create-folder'
  | 'import'
  | 'move'
  | 'delete'
  | 'preview'
  | 'refresh'
  | 'dashboard'
  | 'help';

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

interface ActionDefinition<TAction extends string> {
  id: TAction;
  label: string;
  description: string;
}

const DASHBOARD_ACTIONS: ActionDefinition<DashboardActionId>[] = [
  {
    id: 'open',
    label: 'Open volume',
    description: 'Open the highlighted virtual volume.',
  },
  {
    id: 'create',
    label: 'Create volume',
    description: 'Provision a new virtual space with its own quota.',
  },
  {
    id: 'refresh',
    label: 'Refresh',
    description: 'Reload manifests from disk.',
  },
  {
    id: 'delete',
    label: 'Delete volume',
    description: 'Remove the highlighted volume and its data.',
  },
  {
    id: 'help',
    label: 'Help',
    description: 'Show controls and workflow hints.',
  },
  {
    id: 'quit',
    label: 'Quit',
    description: 'Exit the terminal UI.',
  },
];

const EXPLORER_ACTIONS: ActionDefinition<ExplorerActionId>[] = [
  {
    id: 'open',
    label: 'Open / preview',
    description: 'Enter a directory or preview a file.',
  },
  {
    id: 'up',
    label: 'Go up',
    description: 'Move to the parent directory.',
  },
  {
    id: 'create-folder',
    label: 'Create folder',
    description: 'Add a new directory in the current path.',
  },
  {
    id: 'import',
    label: 'Import host paths',
    description: 'Import one or many files/folders from the host machine.',
  },
  {
    id: 'move',
    label: 'Move / rename',
    description: 'Move the highlighted entry or rename it.',
  },
  {
    id: 'delete',
    label: 'Delete',
    description: 'Delete the highlighted entry recursively.',
  },
  {
    id: 'preview',
    label: 'Preview file',
    description: 'Read a text preview of the highlighted file.',
  },
  {
    id: 'refresh',
    label: 'Refresh',
    description: 'Reload the current directory snapshot.',
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    description: 'Return to the volume dashboard.',
  },
  {
    id: 'help',
    label: 'Help',
    description: 'Show controls and workflow hints.',
  },
];

const clampIndex = (index: number, length: number): number => {
  if (length <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(index, length - 1));
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
  const [name, setName] = useState('');
  const [quotaBytes, setQuotaBytes] = useState(String(defaultQuotaBytes));
  const [description, setDescription] = useState('');
  const [activeField, setActiveField] = useState<'name' | 'quotaBytes' | 'description'>(
    'name',
  );

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.tab) {
      setActiveField((current) => {
        if (key.shift) {
          if (current === 'description') {
            return 'quotaBytes';
          }

          if (current === 'quotaBytes') {
            return 'name';
          }

          return 'description';
        }

        if (current === 'name') {
          return 'quotaBytes';
        }

        if (current === 'quotaBytes') {
          return 'description';
        }

        return 'name';
      });
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
      footer="Tab switches field. Enter advances. Esc cancels."
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
  const [hostPathsInput, setHostPathsInput] = useState('');
  const [targetPath, setTargetPath] = useState(destinationPath);
  const [activeField, setActiveField] = useState<'hostPaths' | 'destinationPath'>(
    'hostPaths',
  );

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.tab) {
      setActiveField((current) =>
        current === 'hostPaths' ? 'destinationPath' : 'hostPaths',
      );
    }
  });

  return (
    <Pane
      title="Import Host Paths"
      active
      footer="Paste files or folders separated by ';' or newline. Esc cancels."
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
  const [destinationPath, setDestinationPath] = useState(initialDestinationPath);
  const [newName, setNewName] = useState(initialName);
  const [activeField, setActiveField] = useState<'destinationPath' | 'newName'>(
    'destinationPath',
  );

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.tab) {
      setActiveField((current) =>
        current === 'destinationPath' ? 'newName' : 'destinationPath',
      );
    }
  });

  return (
    <Pane
      title="Move / Rename"
      active
      footer="Tab switches field. Enter submits from the last field. Esc cancels."
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
  useInput((input, key) => {
    if (key.escape || input.toLowerCase() === 'n') {
      onCancel();
      return;
    }

    if (input.toLowerCase() === 'y' || key.return) {
      onConfirm();
    }
  });

  return (
    <Pane
      title={title}
      active
      footer={`Press Y or Enter to ${confirmLabel.toLowerCase()}. N or Esc cancels.`}
    >
      <Text>{body}</Text>
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
  useInput((input, key) => {
    if (key.escape || key.return || input.toLowerCase() === 'q') {
      onClose();
    }
  });

  return (
    <Pane
      title="File Preview"
      active
      footer="Enter, Q or Esc closes the preview."
    >
      <Text color="gray">
        {preview.path}
        {'  '}
        {formatBytes(preview.size)}
        {'  '}
        {preview.kind.toUpperCase()}
        {preview.truncated ? '  TRUNCATED' : ''}
      </Text>
      <Box marginTop={1}>
        <Text>{preview.content}</Text>
      </Box>
    </Pane>
  );
};

const HelpOverlay = ({ onClose }: { onClose: () => void }): React.JSX.Element => {
  useInput((input, key) => {
    if (key.escape || key.return || input.toLowerCase() === 'q') {
      onClose();
    }
  });

  return (
    <Pane title="Help" active footer="Enter, Q or Esc closes this help panel.">
      <Text>Dashboard keys:</Text>
      <Text color="gray">Tab switches pane, Up/Down moves selection, Enter executes.</Text>
      <Text color="gray">Shortcuts: O open, N create, R refresh, X delete, Q quit.</Text>
      <Box marginTop={1} />
      <Text>Explorer keys:</Text>
      <Text color="gray">Tab switches pane, Enter opens, Backspace goes up.</Text>
      <Text color="gray">
        Shortcuts: C create folder, I import, M move, D delete, P preview, B
        dashboard, R refresh.
      </Text>
    </Pane>
  );
};

export const App = ({ runtime }: { runtime: AppRuntime }): React.JSX.Element => {
  const { exit } = useApp();

  const [screen, setScreen] = useState<Screen>('dashboard');
  const [dashboardFocus, setDashboardFocus] = useState<DashboardFocus>('volumes');
  const [explorerFocus, setExplorerFocus] = useState<ExplorerFocus>('entries');
  const [volumes, setVolumes] = useState<VolumeManifest[]>([]);
  const [selectedVolumeIndex, setSelectedVolumeIndex] = useState(0);
  const [selectedDashboardActionIndex, setSelectedDashboardActionIndex] = useState(0);
  const [currentVolumeId, setCurrentVolumeId] = useState<string | null>(null);
  const [currentSnapshot, setCurrentSnapshot] = useState<ExplorerSnapshot | null>(null);
  const [selectedEntryIndex, setSelectedEntryIndex] = useState(0);
  const [selectedExplorerActionIndex, setSelectedExplorerActionIndex] = useState(0);
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>('Loading volumes');

  const deferredEntries = useDeferredValue(currentSnapshot?.entries ?? []);
  const selectedVolume = volumes[selectedVolumeIndex] ?? null;
  const selectedEntry = deferredEntries[selectedEntryIndex] ?? null;
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
      setExplorerFocus('entries');
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

  const handleDashboardAction = async (actionId: DashboardActionId): Promise<void> => {
    switch (actionId) {
      case 'open':
        if (selectedVolume) {
          await openVolume(selectedVolume.id);
        } else {
          notify('info', 'Create a volume first.');
        }
        break;
      case 'create':
        setOverlay({ kind: 'create-volume' });
        break;
      case 'refresh':
        await loadVolumes();
        break;
      case 'delete':
        if (selectedVolume) {
          setOverlay({
            kind: 'delete-volume',
            volumeId: selectedVolume.id,
            volumeName: selectedVolume.name,
          });
        } else {
          notify('info', 'No volume selected.');
        }
        break;
      case 'help':
        setOverlay({ kind: 'help' });
        break;
      case 'quit':
        exit();
        break;
    }
  };

  const handleExplorerAction = async (actionId: ExplorerActionId): Promise<void> => {
    if (!currentVolumeId || !currentSnapshot) {
      return;
    }

    switch (actionId) {
      case 'open':
        if (!selectedEntry) {
          notify('info', 'Select an entry first.');
          return;
        }

        if (selectedEntry.kind === 'directory') {
          await openVolume(currentVolumeId, selectedEntry.path);
          return;
        }

        await previewSelectedEntry();
        return;
      case 'up':
        await openVolume(
          currentVolumeId,
          getParentVirtualPath(currentSnapshot.currentPath),
        );
        return;
      case 'create-folder':
        setOverlay({ kind: 'create-folder' });
        return;
      case 'import':
        setOverlay({ kind: 'import', destinationPath: currentSnapshot.currentPath });
        return;
      case 'move':
        if (!selectedEntry) {
          notify('info', 'Select an entry first.');
          return;
        }

        setOverlay({
          kind: 'move',
          sourcePath: selectedEntry.path,
          initialDestinationPath: currentSnapshot.currentPath,
          initialName: selectedEntry.name,
        });
        return;
      case 'delete':
        if (!selectedEntry) {
          notify('info', 'Select an entry first.');
          return;
        }

        setOverlay({
          kind: 'delete-entry',
          targetPath: selectedEntry.path,
          label: selectedEntry.name,
        });
        return;
      case 'preview':
        await previewSelectedEntry();
        return;
      case 'refresh':
        await openVolume(currentVolumeId, currentSnapshot.currentPath);
        return;
      case 'dashboard':
        setScreen('dashboard');
        setCurrentVolumeId(null);
        setCurrentSnapshot(null);
        await loadVolumes();
        return;
      case 'help':
        setOverlay({ kind: 'help' });
        return;
    }
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

      if (input.toLowerCase() === 'q') {
        if (screen === 'dashboard') {
          exit();
        }

        return;
      }

      if (screen === 'dashboard') {
        if (key.tab || key.leftArrow || key.rightArrow) {
          setDashboardFocus((current) =>
            current === 'volumes' ? 'actions' : 'volumes',
          );
          return;
        }

        if (input.toLowerCase() === '?') {
          setOverlay({ kind: 'help' });
          return;
        }

        if (input.toLowerCase() === 'n') {
          setOverlay({ kind: 'create-volume' });
          return;
        }

        if (input.toLowerCase() === 'o' && selectedVolume) {
          void openVolume(selectedVolume.id);
          return;
        }

        if (input.toLowerCase() === 'r') {
          void loadVolumes();
          return;
        }

        if (input.toLowerCase() === 'x' && selectedVolume) {
          setOverlay({
            kind: 'delete-volume',
            volumeId: selectedVolume.id,
            volumeName: selectedVolume.name,
          });
          return;
        }

        if (dashboardFocus === 'volumes') {
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

          if (key.return && selectedVolume) {
            void openVolume(selectedVolume.id);
          }

          return;
        }

        if (key.upArrow) {
          setSelectedDashboardActionIndex((current) =>
            clampIndex(current - 1, DASHBOARD_ACTIONS.length),
          );
          return;
        }

        if (key.downArrow) {
          setSelectedDashboardActionIndex((current) =>
            clampIndex(current + 1, DASHBOARD_ACTIONS.length),
          );
          return;
        }

        if (key.return) {
          void handleDashboardAction(
            DASHBOARD_ACTIONS[selectedDashboardActionIndex]?.id ?? 'open',
          );
        }

        return;
      }

      if (key.tab || key.leftArrow || key.rightArrow) {
        setExplorerFocus((current) => (current === 'entries' ? 'actions' : 'entries'));
        return;
      }

      if (key.backspace || key.delete) {
        void handleExplorerAction('up');
        return;
      }

      if (input.toLowerCase() === '?') {
        setOverlay({ kind: 'help' });
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

      if (input.toLowerCase() === 'm' && selectedEntry && currentSnapshot) {
        setOverlay({
          kind: 'move',
          sourcePath: selectedEntry.path,
          initialDestinationPath: currentSnapshot.currentPath,
          initialName: selectedEntry.name,
        });
        return;
      }

      if (input.toLowerCase() === 'd' && selectedEntry) {
        setOverlay({
          kind: 'delete-entry',
          targetPath: selectedEntry.path,
          label: selectedEntry.name,
        });
        return;
      }

      if (input.toLowerCase() === 'p') {
        void handleExplorerAction('preview');
        return;
      }

      if (input.toLowerCase() === 'b') {
        setScreen('dashboard');
        setCurrentVolumeId(null);
        setCurrentSnapshot(null);
        void loadVolumes();
        return;
      }

      if (input.toLowerCase() === 'r') {
        void handleExplorerAction('refresh');
        return;
      }

      if (explorerFocus === 'entries') {
        if (key.upArrow) {
          setSelectedEntryIndex((current) =>
            clampIndex(current - 1, deferredEntries.length),
          );
          return;
        }

        if (key.downArrow) {
          setSelectedEntryIndex((current) =>
            clampIndex(current + 1, deferredEntries.length),
          );
          return;
        }

        if (key.return) {
          void handleExplorerAction('open');
        }

        return;
      }

      if (key.upArrow) {
        setSelectedExplorerActionIndex((current) =>
          clampIndex(current - 1, EXPLORER_ACTIONS.length),
        );
        return;
      }

      if (key.downArrow) {
        setSelectedExplorerActionIndex((current) =>
          clampIndex(current + 1, EXPLORER_ACTIONS.length),
        );
        return;
      }

      if (key.return) {
        void handleExplorerAction(
          EXPLORER_ACTIONS[selectedExplorerActionIndex]?.id ?? 'open',
        );
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

  const renderDashboard = (): React.JSX.Element => (
    <Box flexDirection="column">
      {(process.stdout.columns ?? 120) >= 90 ? (
        <Gradient name="atlas">
          <BigText text="Volumes" />
        </Gradient>
      ) : (
        <Text color="cyanBright">Virtual Volumes</Text>
      )}
      <Text color="gray">
        Node-only custom filesystem, host import, logical quotas and detailed file
        logging.
      </Text>
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
          <Pane
            title="Volumes"
            active={dashboardFocus === 'volumes'}
            footer="Up/Down selects. Enter opens. O opens. N creates."
          >
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
                    dashboardFocus === 'volumes' && index === selectedVolumeIndex,
                  )}
                </React.Fragment>
              ))
            )}
          </Pane>
        </Box>
        <Box flexGrow={2}>
          <Pane
            title="Inspector & Actions"
            active={dashboardFocus === 'actions'}
            footer="Tab switches pane. Enter runs selected action."
          >
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

            {DASHBOARD_ACTIONS.map((action, index) => (
              <React.Fragment key={action.id}>
                {renderSelectableRow(
                  action.label,
                  action.description,
                  dashboardFocus === 'actions' &&
                    index === selectedDashboardActionIndex,
                )}
              </React.Fragment>
            ))}
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
            <Pane
              title="Entries"
              active={explorerFocus === 'entries'}
              footer="Up/Down select. Enter opens. Backspace goes up."
            >
              {deferredEntries.length === 0 ? (
                <Text color="gray">This directory is empty.</Text>
              ) : (
                deferredEntries.map((entry, index) => (
                  <React.Fragment key={entry.id}>
                    {renderSelectableRow(
                      `${entry.kind === 'directory' ? '[DIR]' : '[FILE]'} ${truncate(entry.name, 48)}`,
                      `${truncate(entry.path, 60)}  ${entry.kind === 'file' ? formatBytes(entry.size) : 'directory'}  ${formatDateTime(entry.updatedAt)}`,
                      explorerFocus === 'entries' && index === selectedEntryIndex,
                    )}
                  </React.Fragment>
                ))
              )}
            </Pane>
          </Box>
          <Box flexGrow={2}>
            <Pane
              title="Inspector & Actions"
              active={explorerFocus === 'actions'}
              footer="Tab switches pane. C creates, I imports, M moves, D deletes."
            >
              {renderEntryInspector(currentSnapshot, selectedEntry)}
              <Box marginTop={1} flexDirection="column">
                {EXPLORER_ACTIONS.map((action, index) => (
                  <React.Fragment key={action.id}>
                    {renderSelectableRow(
                      action.label,
                      action.description,
                      explorerFocus === 'actions' &&
                        index === selectedExplorerActionIndex,
                    )}
                  </React.Fragment>
                ))}
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
              Tab switches pane. Help is always available with ?.
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
