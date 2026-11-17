import React, { useEffect, useRef, useState } from 'react';
import {
  OPEN_CREATE_RESOURCE_EVENT,
  takePendingCreateResourceModalOptions,
  type CreateResourceModalOptions,
  type CreateResourceType,
} from '../lib/createResourceEvents';
import { RESOURCE_TYPE_CATALOG, resolveResourceType } from '../lib/registry/resourceRegistry';
import { Modal, Button, Input, Flex, Stack, Tabs, ResourceTypeIcon } from './ui';
import { showToast } from './ui/Toast';
import { Sparkles, Check, Upload } from 'lucide-react';

export interface CreateResourceModalProps {
  currentUser?: string;
  defaultParentFolder?: string;
}

type ResourceTypeOption = {
  type: CreateResourceType;
  label: string;
  description: string;
  accent: string;
  group: 'create' | 'import';
};

const RESOURCE_TYPES: ResourceTypeOption[] = RESOURCE_TYPE_CATALOG.map((entry) => ({
  type: entry.type as CreateResourceType,
  label: entry.label,
  description: entry.description,
  accent: entry.accent,
  group: entry.mode,
}));

interface ContainerOption {
  id: string;
  type: 'folder' | 'space';
  title: string;
  isPersonalRoot?: boolean;
}

const SHEET_TEMPLATES = [
  { id: 'blank', label: 'Blank Grid' },
  { id: 'budget', label: 'Budget Template' },
  { id: 'task_matrix', label: 'Task Matrix' },
];

const DOC_TEMPLATES = [
  { id: 'blank', label: 'Blank Note' },
  { id: 'academic_paper', label: 'Academic Paper Scaffold' },
];

export const CreateResourceModal: React.FC<CreateResourceModalProps> = ({ currentUser, defaultParentFolder }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<'create' | 'import'>('create');
  const [selectedType, setSelectedType] = useState<ResourceTypeOption | null>(null);
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState('blank');
  const [parentFolder, setParentFolder] = useState<string>(defaultParentFolder || '');
  const [spaceId, setSpaceId] = useState<string | undefined>(undefined);
  const [containers, setContainers] = useState<ContainerOption[]>([]);
  const [locationsState, setLocationsState] = useState<'loading' | 'ready' | 'error'>('ready');
  const [locationsAttempt, setLocationsAttempt] = useState(0);
  const [isPublic, setIsPublic] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [googleSource, setGoogleSource] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const submissionInFlight = useRef(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const googleSourceRef = useRef<HTMLInputElement | null>(null);
  const typePickerRef = useRef<HTMLButtonElement | null>(null);
  const fileDropzoneRef = useRef<HTMLButtonElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const generatedFileTitle = useRef<string | null>(null);

  // Open via global event 'open-create-resource-modal'
  useEffect(() => {
    const applyOpen = (opts: CreateResourceModalOptions = {}) => {
      if (submissionInFlight.current) return;
      setMode(opts.mode || 'create');
      setSelectedType(
        RESOURCE_TYPES.find((t) => t.type === opts.type && t.group === (opts.mode || 'create')) ||
          RESOURCE_TYPES.find((t) => t.type === opts.type) ||
          null
      );
      setParentFolder(opts.parentFolder || defaultParentFolder || '');
      setSpaceId(opts.spaceId);
      setTitle(opts.title || '');
      generatedFileTitle.current = null;
      setTemplate('blank');
      setIsPublic(false);
      setFile(null);
      setGoogleSource('');
      setErrorMsg(null);
      setIsOpen(true);
      if (opts.type === 'pdf' || opts.type === 'image') {
        setMode('import');
      }
    };
    const handleOpen = (e: Event) => {
      applyOpen(takePendingCreateResourceModalOptions() || (e as CustomEvent<CreateResourceModalOptions>).detail || {});
    };
    window.addEventListener(OPEN_CREATE_RESOURCE_EVENT as any, handleOpen);
    const pending = takePendingCreateResourceModalOptions();
    if (pending) applyOpen(pending);
    return () => window.removeEventListener(OPEN_CREATE_RESOURCE_EVENT as any, handleOpen);
  }, [defaultParentFolder]);

  // Load candidate container folders for the location picker
  useEffect(() => {
    if (!isOpen || !currentUser || currentUser === 'user:anonymous') return;
    const controller = new AbortController();
    setLocationsState('loading');
    fetch('/api/v1/resources/folders?include_roots=true', { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('Could not load save locations.');
        return res.json();
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(data.containers)) throw new Error('Invalid save locations.');
        setContainers(data.containers);
        setParentFolder((selected) => {
          if (selected) return selected;
          const personal = data.containers.find((c: ContainerOption) => c.isPersonalRoot);
          const firstSpace = data.containers.find((c: ContainerOption) => c.type === 'space');
          return (personal || firstSpace || data.containers[0])?.id || '';
        });
        setLocationsState('ready');
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setLocationsState('error');
        showToast('Could not load save locations.', { tone: 'danger' });
      });
    return () => controller.abort();
  }, [isOpen, currentUser, locationsAttempt]);

  const selectType = (t: ResourceTypeOption) => {
    setSelectedType(t);
    setMode(t.group);
    setTemplate('blank');
    generatedFileTitle.current = null;
    setFile(null);
    setGoogleSource('');
    setErrorMsg(null);
  };

  const handleFileChosen = (f: File | null) => {
    const canReplaceGeneratedTitle = !title || title === generatedFileTitle.current;
    const clearGeneratedTitle = () => {
      if (title && title === generatedFileTitle.current) setTitle('');
      generatedFileTitle.current = null;
    };

    if (f && f.size === 0) {
      setFile(null);
      clearGeneratedTitle();
      setErrorMsg('This file is empty. Choose a file with content.');
      return;
    }

    if (f && selectedType && (selectedType.type === 'pdf' || selectedType.type === 'image')) {
      const supportedExtensions = resolveResourceType({ type: selectedType.type }).fileExtensions ?? [];
      const extension = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
      if (!supportedExtensions.includes(extension)) {
        setFile(null);
        clearGeneratedTitle();
        setErrorMsg(`Unsupported file type. Choose ${supportedExtensions.join(', ')}.`);
        return;
      }
    }

    setFile(f);
    setErrorMsg(null);
    if (f) {
      const nextFileTitle = f.name.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ');
      generatedFileTitle.current = canReplaceGeneratedTitle ? nextFileTitle : null;
      if (canReplaceGeneratedTitle) setTitle(nextFileTitle);
    } else {
      clearGeneratedTitle();
    }
  };

  const readFileAsBase64 = (f: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(f);
    });

  const buildImportSource = async () => {
    if (selectedType?.type === 'pdf' || selectedType?.type === 'image') {
      if (!file) return { fileName: undefined, mimeType: undefined, data: undefined };
      return {
        fileName: file.name,
        mimeType: file.type || undefined,
        data: await readFileAsBase64(file),
      };
    }
    if (selectedType?.type === 'google_sheet' || selectedType?.type === 'google_doc') {
      const source = googleSource.trim();
      return /^https?:\/\//i.test(source)
        ? { url: source }
        : { googleFileId: source || undefined };
    }
    return {};
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submissionInFlight.current) return;
    if (locationsState !== 'ready' && !parentFolder) {
      setErrorMsg('Load save locations before continuing.');
      return;
    }
    if (!selectedType) {
      setErrorMsg('Select a resource type to continue.');
      return;
    }
    if ((selectedType.type === 'pdf' || selectedType.type === 'image') && !file) {
      setErrorMsg(`Choose a ${selectedType.type === 'pdf' ? 'PDF' : 'image'} file to import.`);
      return;
    }

    if (
      (selectedType.type === 'google_doc' || selectedType.type === 'google_sheet') &&
      !googleSource.trim()
    ) {
      setErrorMsg('Paste a Google link or enter its file ID to continue.');
      return;
    }

    const finalTitle = title.trim() || (file ? file.name.replace(/\.[^/.]+$/, '') : '');
    if (!finalTitle) {
      setErrorMsg('Title is required.');
      return;
    }

    submissionInFlight.current = true;
    setLoading(true);
    setErrorMsg(null);
    try {
      const importSource = await buildImportSource();
      const res = await fetch('/api/v1/resources/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: finalTitle,
          type: selectedType.type,
          parent_folder: parentFolder || undefined,
          space_id: spaceId || undefined,
          template: selectedType.type === 'sheet' || selectedType.type === 'document' ? template : undefined,
          import_source: importSource,
          is_public: isPublic,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        const action = selectedType.group === 'import' ? 'import' : 'create';
        throw new Error(json.error || `Failed to ${action} ${selectedType.label}`);
      }

      setIsOpen(false);
      if (json.route) {
        const destination = new URL(json.route, window.location.origin);
        if (selectedType.type === 'document') destination.searchParams.set('edit', 'true');
        window.location.href = `${destination.pathname}${destination.search}${destination.hash}`;
      }
    } catch (err: any) {
      const action = selectedType.group === 'import' ? 'import' : 'create';
      setErrorMsg(err?.message || `Failed to ${action} resource`);
    } finally {
      submissionInFlight.current = false;
      setLoading(false);
    }
  };

  const createTypes = RESOURCE_TYPES.filter((t) => t.group === 'create');
  const importTypes = RESOURCE_TYPES.filter((t) => t.group === 'import');
  const supportedFileExtensions = selectedType && (selectedType.type === 'pdf' || selectedType.type === 'image')
    ? resolveResourceType({ type: selectedType.type }).fileExtensions ?? []
    : [];
  const isFileImport = selectedType?.type === 'pdf' || selectedType?.type === 'image';
  const isGoogleImport = selectedType?.type === 'google_doc' || selectedType?.type === 'google_sheet';
  const initialFocusRef = !selectedType
    ? typePickerRef
    : isFileImport
      ? fileDropzoneRef
      : isGoogleImport
        ? googleSourceRef
        : titleInputRef;

  return (
    <Modal
      open={isOpen}
      onClose={() => {
        if (submissionInFlight.current) {
          showToast('Please wait for the current request to finish.', { tone: 'info' });
          return;
        }
        setIsOpen(false);
      }}
      size="md"
      title={
        <div className="ui-row ui-gap-2">
          <Sparkles size={18} className="ui-shrink0 ui-icon-accent" />
          <div>
            <div className="create-resource-modal__title">
              {selectedType ? (mode === 'import' ? 'Import resource' : 'Create resource') : 'New resource'}
            </div>
            <div className="ui-field__hint">
              {selectedType ? 'Configure the details before saving' : 'Choose what you want to add'}
            </div>
          </div>
        </div>
      }
      initialFocusRef={initialFocusRef}
      footer={
        selectedType ? (
          <div className="create-resource-modal__footer">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="create-resource-modal__back"
              disabled={loading}
              onClick={() => setSelectedType(null)}
            >
              ← Choose different type
            </Button>
            <div className="create-resource-modal__actions">
              <Button type="button" variant="secondary" disabled={loading} onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="create-resource-form"
                variant="primary"
                loading={loading}
                disabled={locationsState !== 'ready' && !parentFolder}
                data-testid="create-resource-submit"
              >
                {loading
                  ? selectedType.group === 'import' ? 'Importing…' : 'Creating…'
                  : selectedType.group === 'import' ? 'Import' : 'Create'}
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="secondary" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
        )
      }
    >
      <Stack gap={4}>
        {!selectedType ? (
          /* Step 1: Type / Import Selection View */
          <Stack gap={3}>
            <div className="ui-row ui-justify-between ui-align-center">
              <Tabs
                value={mode}
                onChange={(val) => {
                  setMode(val as 'create' | 'import');
                  requestAnimationFrame(() => typePickerRef.current?.focus());
                }}
                items={[
                  { value: 'create', label: 'Create New' },
                  { value: 'import', label: 'Import / Upload' },
                ]}
              />
              <span className="ui-field__hint">
                {mode === 'create' ? `${createTypes.length} types` : `${importTypes.length} sources`}
              </span>
            </div>

            <div
              className="ui-resource-grid"
              role="group"
              aria-label={mode === 'create' ? 'Resource types' : 'Import sources'}
            >
              {(mode === 'create' ? createTypes : importTypes).map((t) => (
                <button
                  key={t.type}
                  type="button"
                  ref={t.type === (mode === 'create' ? createTypes[0]?.type : importTypes[0]?.type)
                    ? typePickerRef
                    : undefined}
                  onClick={() => selectType(t)}
                  className="ui-resource-card"
                >
                  <div className="ui-resource-card__icon"><ResourceTypeIcon type={t.type} size={24} /></div>
                  <div className="ui-resource-card__body">
                    <span className="ui-resource-card__title">{t.label}</span>
                    <span className="ui-resource-card__desc">{t.description}</span>
                  </div>
                </button>
              ))}
            </div>
          </Stack>
        ) : (
          /* Step 2: Progressive Details Form */
          <form id="create-resource-form" onSubmit={handleSubmit} aria-busy={loading} className="ui-col ui-gap-4">
            <fieldset disabled={loading} className="create-resource-modal__fields">
            {locationsState === 'loading' && <p role="status" className="ui-field__hint">Loading save locations…</p>}
            {locationsState === 'error' && (
              <div role="alert" className="ui-col ui-gap-2">
                <p>Could not load save locations. {parentFolder ? 'Your selected location is preserved.' : 'Retry to choose where to save.'}</p>
                <Button type="button" variant="secondary" onClick={() => setLocationsAttempt((attempt) => attempt + 1)}>Retry locations</Button>
              </div>
            )}
            {/* Selected type pill banner */}
            <div
              className="ui-row ui-justify-between ui-align-center create-resource-modal__resource-summary"
            >
              <div className="ui-row ui-gap-2">
                <ResourceTypeIcon type={selectedType.type} size={18} />
                <div className="ui-col">
                  <span className="create-resource-modal__resource-name">
                    {selectedType.label}
                  </span>
                  <span className="ui-field__hint create-resource-modal__resource-description">{selectedType.description}</span>
                </div>
              </div>
            </div>

            {/* Location selector */}
            {currentUser && currentUser !== 'user:anonymous' && containers.length > 0 && (
              <div className="ui-col ui-gap-1">
                <label htmlFor="create-location" className="ui-field__label">
                  Save to
                </label>
                <select
                  id="create-location"
                  value={parentFolder}
                  onChange={(e) => setParentFolder(e.target.value)}
                  className="ui-select"
                >
                  {containers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.type === 'space' ? 'Space: ' : 'Folder: '}
                      {c.title}
                      {c.isPersonalRoot ? ' (Personal Root)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Title */}
            <div className="ui-col ui-gap-1">
              <label htmlFor="create-title" className="ui-field__label">
                {selectedType.type === 'folder' ? 'Folder Name' : 'Resource Title'}
              </label>
              <input
                ref={titleInputRef}
                id="create-title"
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  generatedFileTitle.current = null;
                  setErrorMsg(null);
                }}
                placeholder={selectedType.type === 'folder' ? 'e.g. Research Notes' : 'e.g. Q3 Research Synthesis'}
                data-testid="create-resource-title"
                className="ui-input"
              />
            </div>

            {/* Template picker for sheet / document */}
            {(selectedType.type === 'sheet' || selectedType.type === 'document') && (
              <div className="ui-col ui-gap-2" role="group" aria-label="Starting template">
                <span className="ui-field__label">Starting template</span>
                <Flex wrap gap={2}>
                  {(selectedType.type === 'sheet' ? SHEET_TEMPLATES : DOC_TEMPLATES).map((t) => (
                    <Button
                      key={t.id}
                      type="button"
                      size="sm"
                      variant={template === t.id ? 'primary' : 'secondary'}
                      aria-pressed={template === t.id}
                      onClick={() => setTemplate(t.id)}
                    >
                      {t.label}
                    </Button>
                  ))}
                </Flex>
              </div>
            )}

            {/* File upload for pdf / image */}
            {(selectedType.type === 'pdf' || selectedType.type === 'image') && (
              <div className="ui-col ui-gap-2">
                <label className="ui-field__label">Upload File</label>
                <button
                  ref={fileDropzoneRef}
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleFileChosen(e.dataTransfer.files?.[0] || null);
                  }}
                  className={`ui-dropzone ${file ? 'ui-dropzone--has-file' : ''}`}
                >
                  {file ? (
                    <div className="ui-row ui-gap-2 ui-align-center">
                      <Check size={16} />
                      <span className="create-resource-modal__file-name">{file.name}</span>
                      <span className="ui-field__hint">({(file.size / 1024).toFixed(1)} KB)</span>
                    </div>
                  ) : (
                    <>
                      <Upload size={20} className="create-resource-modal__upload-icon" />
                      <span className="create-resource-modal__upload-prompt">
                        {selectedType.type === 'pdf' ? 'Choose a PDF or drop it here' : 'Choose an image or drop it here'}
                      </span>
                    </>
                  )}
                </button>
                {!file && (
                  <span className="ui-field__hint">Supported formats: {supportedFileExtensions.join(', ')}</span>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={supportedFileExtensions.join(',')}
                  className="ui-sr-only"
                  onChange={(e) => handleFileChosen(e.target.files?.[0] || null)}
                />
              </div>
            )}

            {/* Google link import */}
            {(selectedType.type === 'google_sheet' || selectedType.type === 'google_doc') && (
              <Input
                ref={googleSourceRef}
                label="Google Docs or Sheets link or file ID"
                hint="Paste a sharing link or the file ID."
                type="text"
                value={googleSource}
                onChange={(e) => {
                  setGoogleSource(e.target.value);
                  setErrorMsg(null);
                }}
                placeholder="Paste a Google link or file ID"
              />
            )}

            {/* Visibility toggle */}
            <label
              className="ui-row ui-gap-2 create-resource-modal__visibility"
            >
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="create-resource-modal__visibility-checkbox"
              />
              Make this resource publicly accessible without sign-in
            </label>

            {errorMsg && (
              <div className="create-resource-modal__error" role="alert">
                {errorMsg}
              </div>
            )}
            </fieldset>
          </form>
        )}
      </Stack>
    </Modal>
  );
};
