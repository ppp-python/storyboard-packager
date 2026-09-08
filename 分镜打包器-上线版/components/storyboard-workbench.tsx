'use client';

import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  FileArchive,
  Film,
  FolderInput,
  FolderOpen,
  GripVertical,
  HardDriveDownload,
  History,
  Link2Off,
  ListFilter,
  LoaderCircle,
  MousePointer2,
  PackageCheck,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  type ChangeEvent,
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress, ProgressLabel } from '@/components/ui/progress';
import {
  arrangementCounts,
  assignMain,
  assignSupplement,
  buildPoolAssetView,
  buildExportEntries,
  canonicalEpisode,
  createArrangement,
  detectExportConflicts,
  describeAssignment,
  findAssetRelinkIndex,
  findAssignment,
  getScenes,
  makeExportName,
  removeFileFromArrangement,
  reorderSupplement,
  sanitiseFilePart,
  setSupplementNote,
  sanitiseArrangement,
} from '@/lib/storyboard.js';
import { rowsToCsv } from '@/lib/csv.js';
import {
  HISTORY_LIMIT,
  clearProjectHistory,
  comparableSnapshot,
  deleteProjectHistory,
  garbageCollectProjectFileCache,
  historyIndexedDbAvailable,
  listProjectHistory,
  loadCachedProjectFiles,
  makeProjectSnapshot,
  resolveStartupMode,
  saveProjectHistory,
  shouldAutosaveProject,
  snapshotForJson,
} from '@/lib/project-history.js';
import {
  IMPORT_MAX_DEPTH,
  IMPORT_MAX_FILES,
  IMPORT_MAX_TOTAL_BYTES,
  PROJECT_JSON_MAX_BYTES,
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_NOTE_MAX_LENGTH,
  parseProjectJson,
  validateImportPath,
  PROJECT_ID_MAX_LENGTH,
} from '@/lib/project-validation.js';

type Scene = {
  mainId: string | null;
  supplementalIds: string[];
  supplementalNotes?: Record<string, string>;
};
type Arrangement = {
  scenes: Scene[];
};
type IntakeCandidate = {
  file: File;
  relativePath: string;
  handle?: FileHandleLike;
};
type VideoAsset = {
  id: string;
  fingerprint: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  relativePath: string;
  duration: number | null;
  addedAt: number;
  file: File | null;
  url: string | null;
  handle?: FileHandleLike | null;
};
type ExportEntry = {
  fileId: string;
  originalName: string;
  exportName: string;
  path: string;
  kind: 'main' | 'supplement';
  episode: string;
  scene: number;
  supplementalIndex: number | null;
  note: string;
  sanitisedNote: string;
  size: number;
  relativePath: string;
};
type ExportMode = 'zip' | 'folder';
type ExportStatus =
  | 'idle'
  | 'preparing'
  | 'running'
  | 'success'
  | 'error'
  | 'cancelled';
type ExportState = {
  status: ExportStatus;
  mode: ExportMode | null;
  progress: number;
  label: string;
  message: string;
};
type Notice = { tone: 'info' | 'success' | 'warning'; message: string };
type HistoryAsset = Omit<VideoAsset, 'file' | 'url'> & {
  handle?: FileHandleLike | null;
  handleStatus?: 'saved' | 'none' | 'missing';
};
type ProjectHistoryRecord = {
  id: string;
  name: string;
  episode: string;
  sortBy?: 'lastModified' | 'lastModifiedDesc' | 'name' | 'size' | 'status';
  arrangement: Arrangement;
  assets: HistoryAsset[];
  createdAt: number;
  updatedAt: number;
  directoryHandle?: DirectoryHandleLike;
};
type ValidatedProject = {
  name: string;
  episode: string;
  sortBy: 'lastModified' | 'lastModifiedDesc' | 'name' | 'size' | 'status';
  arrangement: Arrangement;
  assets: HistoryAsset[];
};
type FileHandleLike = {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  queryPermission?: (descriptor?: {
    mode?: 'read' | 'readwrite';
  }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: {
    mode?: 'read' | 'readwrite';
  }) => Promise<PermissionState>;
};
type WritableLike = {
  write(data: Blob | ArrayBuffer | ArrayBufferView | string): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
};
type WritableFileHandleLike = FileHandleLike & {
  createWritable(): Promise<WritableLike>;
};
type DirectoryHandleLike = {
  kind: 'directory';
  name: string;
  values(): AsyncIterableIterator<FileHandleLike | DirectoryHandleLike>;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<DirectoryHandleLike>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<WritableFileHandleLike>;
  removeEntry?: (
    name: string,
    options?: { recursive?: boolean },
  ) => Promise<void>;
  queryPermission?: (descriptor?: {
    mode?: 'read' | 'readwrite';
  }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: {
    mode?: 'read' | 'readwrite';
  }) => Promise<PermissionState>;
};
type LegacyFileEntry = {
  isFile: true;
  isDirectory: false;
  name: string;
  file(
    success: (file: File) => void,
    error: (error: DOMException) => void,
  ): void;
};
type LegacyDirectoryEntry = {
  isFile: false;
  isDirectory: true;
  name: string;
  createReader(): {
    readEntries(
      success: (entries: LegacyEntry[]) => void,
      error: (error: DOMException) => void,
    ): void;
  };
};
type LegacyEntry = LegacyFileEntry | LegacyDirectoryEntry;
type DropItem = DataTransferItem & {
  getAsFileSystemHandle?: () => Promise<
    FileHandleLike | DirectoryHandleLike | null
  >;
  webkitGetAsEntry?: () => LegacyEntry | null;
};
type ImportBudget = {
  entries: number;
  files: number;
  totalBytes: number;
};

declare global {
  interface Window {
    showOpenFilePicker?: (options?: {
      multiple?: boolean;
      types?: Array<{
        description?: string;
        accept: Record<string, string[]>;
      }>;
      excludeAcceptAllOption?: boolean;
    }) => Promise<FileHandleLike[]>;
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: 'read' | 'readwrite';
      startIn?: DirectoryHandleLike;
    }) => Promise<DirectoryHandleLike>;
  }
}

const STORAGE_KEY = 'storyboard-packager:v1';
const DRAG_TYPE = 'application/x-storyboard-video-id';
const INCOMPLETE_MARKER_NAME = '.incomplete.json';
const MAX_OUTPUT_NAME_ATTEMPTS = 100;
const ZIP_WARNING_BYTES = 750 * 1024 * 1024;
const ZIP_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'mov',
  'm4v',
  'webm',
  'mkv',
  'avi',
  'mpeg',
  'mpg',
  'ts',
  'mts',
  'm2ts',
  'wmv',
  'flv',
  '3gp',
  'ogv',
]);

const initialExportState: ExportState = {
  status: 'idle',
  mode: null,
  progress: 0,
  label: '',
  message: '',
};

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  const amount = value / 1024 ** exponent;
  return `${amount >= 10 || exponent === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[exponent]}`;
}

function formatDuration(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return '读取时长…';
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const rest = rounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
}

function formatFileTime(timestamp: number) {
  if (!Number.isFinite(timestamp) || !Number.isFinite(new Date(timestamp).getTime())) return '文件时间未知';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
}

function fileFingerprint(file: File, relativePath: string) {
  return [
    file.name.normalize('NFC').toLocaleLowerCase('zh-CN'),
    file.size,
    file.lastModified,
    relativePath.normalize('NFC').toLocaleLowerCase('zh-CN'),
  ].join('|');
}

function isVideoFile(file: File) {
  const extension =
    file.name.split('.').pop()?.toLocaleLowerCase('en-US') ?? '';
  return file.type.startsWith('video/') || VIDEO_EXTENSIONS.has(extension);
}

function uniqueId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `video-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function candidateFromFile(
  file: File,
  relativePath?: string,
  handle?: FileHandleLike,
): IntakeCandidate {
  return {
    file,
    relativePath:
      relativePath ||
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
      file.name,
    handle,
  };
}

/** Keep separate dropped project roots separate even when their folder names match. */
function uniqueDroppedRootName(
  name: string | undefined,
  usedRoots: Set<string>,
  fallbackIndex: number,
) {
  const base =
    String(name ?? '')
      .replace(/[\\/]/g, '_')
      .trim() || `项目${fallbackIndex + 1}`;
  let candidate = base;
  let suffix = 2;
  const keyOf = (value: string) =>
    value.normalize('NFC').toLocaleLowerCase('zh-CN');
  while (usedRoots.has(keyOf(candidate))) {
    candidate = `${base} (${suffix})`;
    suffix += 1;
  }
  usedRoots.add(keyOf(candidate));
  return candidate;
}

function candidateLooseKey(file: File) {
  return [
    file.name.normalize('NFC').toLocaleLowerCase('zh-CN'),
    file.size,
    file.lastModified,
  ].join('|');
}

/** Merge browser FileList fallbacks without duplicating files already read via handles. */
function mergeDataTransferFiles(
  output: IntakeCandidate[],
  files: FileList | File[],
) {
  const exact = new Set(
    output.map((candidate) =>
      fileFingerprint(candidate.file, candidate.relativePath),
    ),
  );
  const looseCounts = new Map<string, number>();
  for (const candidate of output) {
    const path = candidate.relativePath.replace(/\\/g, '/');
    if (path === candidate.file.name) {
      const key = candidateLooseKey(candidate.file);
      looseCounts.set(key, (looseCounts.get(key) ?? 0) + 1);
    }
  }
  for (const file of Array.from(files)) {
    const candidate = candidateFromFile(file);
    const key = fileFingerprint(candidate.file, candidate.relativePath);
    if (exact.has(key)) continue;
    const looseKey = candidateLooseKey(file);
    if (
      candidate.relativePath === file.name &&
      (looseCounts.get(looseKey) ?? 0) > 0
    ) {
      looseCounts.set(looseKey, (looseCounts.get(looseKey) ?? 1) - 1);
      continue;
    }
    exact.add(key);
    output.push(candidate);
  }
}

class ImportLimitError extends Error {}

function createImportBudget(): ImportBudget {
  return { files: 0, totalBytes: 0, entries: 0 };
}

function accountImportedFile(file: File, budget: ImportBudget) {
  budget.files += 1;
  budget.totalBytes += Math.max(0, file.size);
  if (budget.files > IMPORT_MAX_FILES) {
    throw new ImportLimitError(`单次导入最多读取 ${IMPORT_MAX_FILES} 个文件`);
  }
  if (budget.totalBytes > IMPORT_MAX_TOTAL_BYTES) {
    throw new ImportLimitError('单次导入文件总大小超过 100 GB');
  }
}

function accountImportDepth(depth: number) {
  if (depth > IMPORT_MAX_DEPTH) {
    throw new Error(`文件夹层级超过 ${IMPORT_MAX_DEPTH} 层，已停止读取`);
  }
}

async function walkHandle(
  handle: FileHandleLike | DirectoryHandleLike,
  prefix: string,
  output: IntakeCandidate[],
  budget: ImportBudget,
  depth = 0,
  rootName = handle.name,
) {
  if (++budget.entries > IMPORT_MAX_FILES * 2) throw new ImportLimitError('文件夹条目过多，已停止读取');
  accountImportDepth(depth);
  const path = prefix ? `${prefix}/${handle.name}` : rootName;
  validateImportPath(path);
  if (handle.kind === 'file') {
    if (budget.files >= IMPORT_MAX_FILES) throw new ImportLimitError('单次导入文件数量超限');
    const file = await handle.getFile();
    accountImportedFile(file, budget);
    output.push(candidateFromFile(file, path, handle));
    return;
  }
  for await (const child of handle.values()) {
    await walkHandle(child, path, output, budget, depth + 1, rootName);
  }
}

async function readLegacyEntries(directory: LegacyDirectoryEntry) {
  const reader = directory.createReader();
  const result: LegacyEntry[] = [];
  while (true) {
    const batch = await new Promise<LegacyEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) break;
    if (result.length + batch.length > IMPORT_MAX_FILES) throw new ImportLimitError("文件夹条目数量超限");
    result.push(...batch);
  }
  return result;
}

async function walkLegacyEntry(
  entry: LegacyEntry,
  prefix: string,
  output: IntakeCandidate[],
  budget: ImportBudget,
  depth = 0,
  rootName = entry.name,
) {
  if (++budget.entries > IMPORT_MAX_FILES * 2) throw new ImportLimitError('文件夹条目过多，已停止读取');
  accountImportDepth(depth);
  const path = prefix ? `${prefix}/${entry.name}` : rootName;
  validateImportPath(path);
  if (entry.isFile) {
    if (budget.files >= IMPORT_MAX_FILES) throw new ImportLimitError('单次导入文件数量超限');
    const file = await new Promise<File>((resolve, reject) => {
      entry.file(resolve, reject);
    });
    accountImportedFile(file, budget);
    output.push(candidateFromFile(file, path));
    return;
  }
  const children = await readLegacyEntries(entry);
  for (const child of children) {
    await walkLegacyEntry(child, path, output, budget, depth + 1, rootName);
  }
}

async function filesFromDataTransfer(dataTransfer: DataTransfer) {
  const items = Array.from(dataTransfer.items ?? []).filter(item => item.kind === 'file') as DropItem[];
  // Capture every handle and File while the browser still permits drag-data access.
  const fallbacks = Array.from(dataTransfer.files ?? []);
  const captured = items.slice(0, IMPORT_MAX_FILES + 1).map(item => {
    let entry: LegacyEntry | null = null;
    let file: File | null = null;
    try { entry = (item.webkitGetAsEntry?.() as LegacyEntry | null | undefined) ?? null; } catch { /* unreadable entry */ }
    try { file = item.getAsFile(); } catch { /* unreadable file */ }
    const handle = Promise.resolve(null as FileHandleLike | DirectoryHandleLike | null);
    // The modern API must be invoked synchronously, before awaiting another item.
    let modern = handle;
    try { modern = item.getAsFileSystemHandle?.().catch(() => null) ?? handle; } catch { /* legacy fallback */ }
    return {entry, file, modern};
  });
  if (items.length > IMPORT_MAX_FILES || fallbacks.length > IMPORT_MAX_FILES) throw new ImportLimitError('单次导入文件数量超限');
  const output: IntakeCandidate[] = [];
  const budget = createImportBudget();
  const usedRoots = new Set<string>();
  let lastError: unknown = null;
  for (const [index, item] of captured.entries()) {
    const part: IntakeCandidate[] = [];
    try {
      const handle = await item.modern;
      if (handle) await walkHandle(handle, '', part, budget, 0,
        handle.kind === 'directory' ? uniqueDroppedRootName(handle.name, usedRoots, index) : handle.name);
      else if (item.entry) await walkLegacyEntry(item.entry, '', part, budget, 0,
        item.entry.isDirectory ? uniqueDroppedRootName(item.entry.name, usedRoots, index) : item.entry.name);
      else if (item.file) {
        const candidate = candidateFromFile(item.file);
        validateImportPath(candidate.relativePath);
        accountImportedFile(item.file, budget);
        part.push(candidate);
      }
      output.push(...part);
    } catch (error) {
      if (error instanceof ImportLimitError) throw error;
      lastError = error;
    }
  }
  const beforeMerge = output.length;
  mergeDataTransferFiles(output, fallbacks);
  for (const candidate of output.slice(beforeMerge)) {
    validateImportPath(candidate.relativePath);
    accountImportedFile(candidate.file, budget);
  }
  if (!output.length && lastError) throw lastError;
  const seen = new Set<string>();
  return output.filter(candidate => {
    const key = fileFingerprint(candidate.file, candidate.relativePath);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function manifestPayload(episode: string, entries: ExportEntry[]) {
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    episode: Number(episode),
    privacy: '所有视频均在浏览器本地读取与导出，未上传到服务器。',
    files: entries.map((entry) => ({
      originalFileName: entry.originalName,
      exportFileName: entry.exportName,
      role: entry.kind === 'main' ? 'main' : 'supplement',
      episode: Number(entry.episode),
      scene: entry.scene,
      supplementalIndex: entry.supplementalIndex,
      note: entry.note,
      sanitisedNote: entry.sanitisedNote,
      size: entry.size,
      sourceRelativePath: entry.relativePath,
    })),
  };
}

function manifestCsv(entries: ExportEntry[]) {
  const rows = [
    [
      'original_filename',
      'export_filename',
      'role',
      'episode',
      'scene',
      'supplemental_index',
      'note',
      'sanitised_note',
      'size_bytes',
      'source_relative_path',
    ],
    ...entries.map((entry) => [
      entry.originalName,
      entry.exportName,
      entry.kind,
      entry.episode,
      entry.scene,
      entry.supplementalIndex ?? '',
      entry.note,
      entry.sanitisedNote,
      entry.size,
      entry.relativePath,
    ]),
  ];
  return rowsToCsv(rows);
}

function packageFolderName() {
  const now = new Date();
  const part = (value: number) => String(value).padStart(2, '0');
  const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
  const suffix =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `分镜打包_${now.getFullYear()}${part(now.getMonth() + 1)}${part(now.getDate())}-${part(now.getHours())}${part(now.getMinutes())}${part(now.getSeconds())}${milliseconds}_${suffix}`;
}

async function directoryExists(
  parent: DirectoryHandleLike,
  name: string,
): Promise<boolean> {
  try {
    await parent.getDirectoryHandle(name, { create: false });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return false;
    throw error;
  }
}

async function createUniqueOutputDirectory(parent: DirectoryHandleLike) {
  const baseName = packageFolderName();
  for (let attempt = 0; attempt < MAX_OUTPUT_NAME_ATTEMPTS; attempt += 1) {
    const name =
      attempt === 0
        ? baseName
        : `${baseName}_${String(attempt + 1).padStart(2, '0')}`;
    if (await directoryExists(parent, name)) continue;
    const directory = await parent.getDirectoryHandle(name, { create: true });
    return { name, directory };
  }
  throw new Error('无法为本次导出创建唯一文件夹，请更换输出位置。');
}

async function createOutputFile(directory: DirectoryHandleLike, name: string) {
  try {
    await directory.getFileHandle(name, { create: false });
    throw new Error(`导出文件已存在，已停止以避免覆盖：${name}`);
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error;
  }
  return directory.getFileHandle(name, { create: true });
}

async function writeOutputText(handle: WritableFileHandleLike, text: string) {
  const writable = await handle.createWritable();
  try { await writable.write(text); await writable.close(); }
  catch (error) { await writable.abort(error).catch(() => undefined); throw error; }
}

async function writeIncompleteMarker(
  directory: DirectoryHandleLike,
  reason: string,
) {
  try {
    const marker = await directory.getFileHandle(INCOMPLETE_MARKER_NAME, {
      create: true,
    });
    await writeOutputText(marker, JSON.stringify({
      status: 'incomplete', reason: reason.slice(0, 500), createdAt: new Date().toISOString(),
    }));
  } catch {
    // A marker is best effort; cleanup below still attempts each file.
  }
}

async function removeOutputEntry(
  directory: DirectoryHandleLike | null,
  name: string,
) {
  if (!directory?.removeEntry) return false;
  try {
    await directory.removeEntry(name);
    return true;
  } catch {
    return false;
  }
}

async function cleanupOutputDirectory(
  parent: DirectoryHandleLike | null,
  directory: DirectoryHandleLike | null,
  directoryName: string | null,
  createdFiles: string[],
  reason: string,
) {
  if (!directory) return;
  let allRemoved = true;
  for (const name of [...createdFiles].reverse()) {
    if (!(await removeOutputEntry(directory, name))) allRemoved = false;
  }
  if (allRemoved && parent?.removeEntry && directoryName) {
    try {
      await parent.removeEntry(directoryName);
      return;
    } catch {
      // Fall through to an explicit marker when the directory cannot be removed.
    }
  }
  await writeIncompleteMarker(directory, reason);
}

function zipFileName(episodes: string[]) {
  if (episodes.length === 1) return `分镜打包_第${episodes[0]}集.zip`;
  return `分镜打包_${episodes[0]}-${episodes.at(-1)}集.zip`;
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function isAbort(error: unknown, signal: AbortSignal) {
  return (
    signal.aborted ||
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function sameDragSurface(event: DragEvent<HTMLElement>) {
  const next = event.relatedTarget;
  return next instanceof Node && event.currentTarget.contains(next);
}

let activePreviewVideo: HTMLVideoElement | null = null;

function stopPreview(video: HTMLVideoElement | null) {
  if (!video) return;
  video.pause();
  try {
    video.currentTime = 0;
  } catch {
    // The browser may not have loaded metadata yet.
  }
  if (activePreviewVideo === video) activePreviewVideo = null;
}

function HoverPreviewVideo({
  asset,
  onDuration,
  className,
  label,
}: {
  asset: VideoAsset;
  onDuration: (id: string, duration: number) => void;
  className: string;
  label: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const drawFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (
      !video ||
      !canvas ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      return;
    }
    if (
      canvas.width !== video.videoWidth ||
      canvas.height !== video.videoHeight
    ) {
      canvas.width = Math.max(1, video.videoWidth);
      canvas.height = Math.max(1, video.videoHeight);
    }
    canvas
      .getContext('2d')
      ?.drawImage(video, 0, 0, canvas.width, canvas.height);
  };

  const stopFrameLoop = () => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  };

  const drawWhilePlaying = () => {
    const video = videoRef.current;
    drawFrame();
    if (video && !video.paused && !video.ended) {
      animationFrameRef.current =
        window.requestAnimationFrame(drawWhilePlaying);
    } else {
      animationFrameRef.current = null;
    }
  };

  useEffect(
    () => () => {
      stopFrameLoop();
      stopPreview(videoRef.current);
    },
    [],
  );

  if (!asset.url) {
    return (
      <div
        className={`${className} flex items-center justify-center bg-slate-100 text-slate-400`}
      >
        <Link2Off aria-hidden="true" className="size-5" />
        <span className="sr-only">{label}，需重新关联文件</span>
      </div>
    );
  }

  const playPreview = () => {
    const video = videoRef.current;
    if (!video) return;
    if (activePreviewVideo && activePreviewVideo !== video) {
      stopPreview(activePreviewVideo);
    }
    activePreviewVideo = video;
    video.muted = true;
    stopFrameLoop();
    void video
      .play()
      .then(drawWhilePlaying)
      .catch(() => undefined);
  };
  const pausePreview = () => {
    stopFrameLoop();
    stopPreview(videoRef.current);
  };
  const togglePreview = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) playPreview();
    else pausePreview();
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        className={className}
        tabIndex={0}
        aria-label={label}
        onMouseEnter={playPreview}
        onMouseLeave={pausePreview}
        onFocus={playPreview}
        onBlur={pausePreview}
        onClick={togglePreview}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            togglePreview();
          }
        }}
      />
      <video
        ref={videoRef}
        className="hidden"
        muted
        loop
        playsInline
        preload="metadata"
        src={asset.url}
        aria-hidden="true"
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          const duration = video.duration;
          if (Number.isFinite(duration)) {
            onDuration(asset.id, duration);
            if (duration > 0) video.currentTime = Math.min(0.15, duration / 3);
          }
        }}
        onLoadedData={drawFrame}
        onSeeked={drawFrame}
        onError={pausePreview}
      />
    </>
  );
}

async function resolveHandleFile(
  handle: FileHandleLike | null | undefined,
  requestPermission: boolean,
) {
  if (!handle) return null;
  try {
    let permission = await handle.queryPermission?.({ mode: 'read' });
    if (permission !== 'granted' && requestPermission) {
      permission = await handle.requestPermission?.({ mode: 'read' });
    }
    if (permission && permission !== 'granted') return null;
    return await handle.getFile();
  } catch {
    return null;
  }
}

function fileMatchesAsset(file: File | null | undefined, asset: HistoryAsset) {
  return Boolean(
    file &&
    file.name === asset.name &&
    file.size === asset.size &&
    file.lastModified === asset.lastModified,
  );
}

async function restoreAssetFile(
  asset: HistoryAsset,
  cachedFiles: Map<string, File>,
  requestPermission: boolean,
) {
  const cached = cachedFiles.get(asset.fingerprint);
  if (fileMatchesAsset(cached, asset)) return cached ?? null;
  const fromHandle = await resolveHandleFile(asset.handle, requestPermission);
  return fileMatchesAsset(fromHandle, asset) ? fromHandle : null;
}

export function StoryboardWorkbench() {
  const [assets, setAssets] = useState<VideoAsset[]>([]);
  const [arrangement, setArrangement] = useState<Arrangement>(() =>
    createArrangement(),
  );
  const [currentEpisode, setCurrentEpisode] = useState('1');
  const [episodeDraft, setEpisodeDraft] = useState('1');
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showAssignedAssets, setShowAssignedAssets] = useState(false);
  const [sortBy, setSortBy] = useState<
    'lastModified' | 'lastModifiedDesc' | 'name' | 'size' | 'status'
  >('lastModified');
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [historyRecords, setHistoryRecords] = useState<ProjectHistoryRecord[]>(
    [],
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [projectId, setProjectId] = useState(() => uniqueId());
  const [projectName, setProjectName] = useState('我的分镜编排');
  const [exportState, setExportState] =
    useState<ExportState>(initialExportState);

  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const directoryInputRef = useRef<HTMLInputElement | null>(null);
  const projectImportRef = useRef<HTMLInputElement | null>(null);
  const abortExportRef = useRef<AbortController | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const assetsRef = useRef(assets);
  const arrangementRef = useRef(arrangement);
  const currentEpisodeRef = useRef(currentEpisode);
  const directoryHandleRef = useRef<DirectoryHandleLike | null>(null);
  const projectIdRef = useRef(projectId);
  const projectNameRef = useRef(projectName);
  const [initialCreatedAt] = useState(() => Date.now());
  const projectCreatedAtRef = useRef(initialCreatedAt);
  const historyLoadedRef = useRef(false);
  const historyBoundRef = useRef(false);
  const startupModeRef = useRef<'new' | 'resume'>('new');
  const historySaveTimerRef = useRef<number | null>(null);
  const sceneListRef = useRef<HTMLDivElement | null>(null);
  const pendingSceneScrollRef = useRef<number | null>(null);

  const notify = useCallback(
    (message: string, tone: Notice['tone'] = 'info') => {
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
      setNotice({ message, tone });
      noticeTimerRef.current = window.setTimeout(() => setNotice(null), 5200);
    },
    [],
  );

  useEffect(() => {
    const blockNativeFileNavigation = (event: globalThis.DragEvent) => {
      if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) {
        event.preventDefault();
      }
    };
    window.addEventListener('dragover', blockNativeFileNavigation);
    window.addEventListener('drop', blockNativeFileNavigation);
    return () => {
      window.removeEventListener('dragover', blockNativeFileNavigation);
      window.removeEventListener('drop', blockNativeFileNavigation);
    };
  }, []);

  useEffect(() => {
    if (
      window.location.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost'].includes(window.location.hostname)
    ) {
      return;
    }

    const clientId = window.crypto.randomUUID();
    const endpoint = (action: 'open' | 'heartbeat' | 'closed') =>
      `/__client-${action}?id=${encodeURIComponent(clientId)}`;
    const markOpen = () => {
      void window
        .fetch(endpoint('open'), { cache: 'no-store' })
        .catch(() => undefined);
    };
    const markHeartbeat = () => {
      void window
        .fetch(endpoint('heartbeat'), { cache: 'no-store' })
        .catch(() => undefined);
    };
    const markClosed = () => {
      const url = endpoint('closed');
      if (!window.navigator.sendBeacon(url)) {
        void window
          .fetch(url, { method: 'POST', keepalive: true })
          .catch(() => undefined);
      }
    };

    markOpen();
    const heartbeatTimer = window.setInterval(markHeartbeat, 30_000);
    window.addEventListener('pageshow', markOpen);
    window.addEventListener('pagehide', markClosed);
    window.addEventListener('beforeunload', markClosed);
    return () => {
      window.clearInterval(heartbeatTimer);
      window.removeEventListener('pageshow', markOpen);
      window.removeEventListener('pagehide', markClosed);
      window.removeEventListener('beforeunload', markClosed);
    };
  }, []);

  const replaceAssetCollection = useCallback((next: VideoAsset[]) => {
    const nextUrls = new Set(next.map((asset) => asset.url).filter(Boolean));
    for (const asset of assetsRef.current) {
      if (asset.url && !nextUrls.has(asset.url)) URL.revokeObjectURL(asset.url);
    }
    assetsRef.current = next;
    setAssets(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const restoreStartup = async () => {
      await Promise.resolve();
      if (cancelled) return;
    const startupMode = resolveStartupMode(window.location.search);
    startupModeRef.current = startupMode;
    if (window.location.search) {
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.hash}`,
      );
    }
    if (startupMode !== 'resume') {
      setHydrated(true);
      return;
    }
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          arrangement?: Arrangement;
          currentEpisode?: string;
          episode?: string;
          projectId?: string;
          projectName?: string;
          sortBy?:
            | 'lastModified'
            | 'lastModifiedDesc'
            | 'name'
            | 'size'
            | 'status';
          assets?: Array<Omit<VideoAsset, 'file' | 'url'>>;
        };
        if (typeof parsed.projectId === 'string' && parsed.projectId) {
          setProjectId(parsed.projectId);
          projectIdRef.current = parsed.projectId;
          historyBoundRef.current = true;
        }
        if (typeof parsed.projectName === 'string' && parsed.projectName) {
          const boundedProjectName = parsed.projectName.slice(
            0,
            PROJECT_NAME_MAX_LENGTH,
          );
          setProjectName(boundedProjectName);
          projectNameRef.current = boundedProjectName;
        }
        const restoredAssets = Array.isArray(parsed.assets)
          ? parsed.assets
              .filter(
                (asset) =>
                  asset &&
                  typeof asset.id === 'string' &&
                  typeof asset.name === 'string' &&
                  typeof asset.fingerprint === 'string',
              )
              .map((asset) => ({ ...asset, file: null, url: null }))
          : [];
        const restoredEpisode =
          canonicalEpisode(parsed.currentEpisode ?? parsed.episode) ?? '1';
        // v1 stored separate episode maps. sanitiseArrangement flattens them
        // into this single slot list so changing the prefix cannot discard a
        // previously assigned file.
        const restoredArrangement = sanitiseArrangement(parsed.arrangement);
        replaceAssetCollection(restoredAssets);
        setArrangement(restoredArrangement);
        setCurrentEpisode(restoredEpisode);
        setEpisodeDraft(restoredEpisode);
        if (parsed.sortBy) setSortBy(parsed.sortBy);
        if (restoredAssets.length > 0) {
          window.setTimeout(
            () =>
              notify(
                `已恢复编排结构；${restoredAssets.length} 个视频需重新选择后才能导出。`,
                'warning',
              ),
            0,
          );
        }
      }
    } catch {
      window.setTimeout(
        () => notify('本地编排记录无法读取，已从空编排开始。', 'warning'),
        0,
      );
    } finally {
      setHydrated(true);
    }
    };
    void restoreStartup();
    return () => { cancelled = true; };
  }, [notify, replaceAssetCollection]);

  useEffect(() => {
    if (!hydrated) return;
    if (!shouldAutosaveProject(historyBoundRef.current, assets.length)) return;
    const metadata = assets.map(
      ({ file: _file, url: _url, handle: _handle, ...asset }) => asset,
    );
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 1,
          projectId,
          projectName,
          sortBy,
          currentEpisode,
          arrangement,
          assets: metadata,
        }),
      );
    } catch {
      window.queueMicrotask(() => notify('浏览器未能保存编排元数据；本次页面仍可继续使用。', 'warning'));
    }
  }, [
    arrangement,
    assets,
    currentEpisode,
    hydrated,
    notify,
    projectId,
    projectName,
    sortBy,
  ]);

  const currentSnapshot = useCallback(
    (
      id = projectIdRef.current,
      name = projectNameRef.current,
      createdAt = projectCreatedAtRef.current,
    ) =>
      makeProjectSnapshot({
        id,
        name,
        episode: currentEpisodeRef.current,
        sortBy,
        arrangement: arrangementRef.current,
        assets: assetsRef.current,
        directoryHandle: directoryHandleRef.current ?? undefined,
        createdAt,
        updatedAt: Date.now(),
      }),
    [sortBy],
  );

  useEffect(() => {
    if (!hydrated || historyLoadedRef.current) return;
    historyLoadedRef.current = true;
    let cancelled = false;
    const loadHistory = async () => {
      if (!historyIndexedDbAvailable()) {
        setHistoryReady(true);
        return;
      }
      try {
        const rows = (await listProjectHistory()) as ProjectHistoryRecord[];
        if (cancelled) return;
        setHistoryRecords(rows);
        if (startupModeRef.current !== 'resume') return;
        const latest = rows[0];
        if (!latest) return;
        const restoredEpisode = canonicalEpisode(latest.episode) ?? '1';
        const restoredArrangement = sanitiseArrangement(latest.arrangement);
        const restoredAssets = (
          Array.isArray(latest.assets) ? latest.assets : []
        )
          .slice(0, IMPORT_MAX_FILES)
          .map((asset) => ({
            ...asset,
            file: null,
            url: null,
            handle: asset.handle ?? null,
          })) as VideoAsset[];
        setProjectId(latest.id);
        projectIdRef.current = latest.id;
        projectCreatedAtRef.current = Number(latest.createdAt) || Date.now();
        historyBoundRef.current = true;
        const latestProjectName = (
          typeof latest.name === 'string' && latest.name
            ? latest.name
            : '我的分镜编排'
        ).slice(0, PROJECT_NAME_MAX_LENGTH);
        setProjectName(latestProjectName);
        projectNameRef.current = latestProjectName;
        setCurrentEpisode(restoredEpisode);
        setEpisodeDraft(restoredEpisode);
        if (latest.sortBy) setSortBy(latest.sortBy);
        setArrangement(restoredArrangement);
        const cachedFiles = (await loadCachedProjectFiles(restoredAssets).catch(
          () => new Map(),
        )) as Map<string, File>;
        const resolved = await Promise.all(
          restoredAssets.map(async (asset) => {
            const file = await restoreAssetFile(asset, cachedFiles, false);
            if (!file) return asset;
            return { ...asset, file, url: URL.createObjectURL(file) };
          }),
        );
        if (cancelled) return;
        replaceAssetCollection(resolved);
        const missing = resolved.filter((asset) => !asset.file).length;
        notify(
          missing
            ? `已恢复最近编排与备注；${missing} 个素材待重新授权或关联。`
            : '已恢复最近编排与备注，素材也已重新连接。',
          missing ? 'warning' : 'success',
        );
      } catch {
        // localStorage remains the metadata-only fallback.
      } finally {
        if (!cancelled) setHistoryReady(true);
      }
    };
    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [hydrated, notify, replaceAssetCollection]);

  useEffect(() => {
    if (!hydrated || !historyReady) return;
    if (!shouldAutosaveProject(historyBoundRef.current, assets.length)) return;
    historyBoundRef.current = true;
    if (historySaveTimerRef.current)
      window.clearTimeout(historySaveTimerRef.current);
    historySaveTimerRef.current = window.setTimeout(() => {
      const snapshot = currentSnapshot();
      if (!historyIndexedDbAvailable()) return;
      void saveProjectHistory(snapshot, assetsRef.current)
        .then(async () =>
          setHistoryRecords(
            (await listProjectHistory()) as ProjectHistoryRecord[],
          ),
        )
        .catch(() => undefined);
    }, 900);
    return () => {
      if (historySaveTimerRef.current)
        window.clearTimeout(historySaveTimerRef.current);
    };
  }, [
    arrangement,
    assets,
    currentEpisode,
    currentSnapshot,
    hydrated,
    historyReady,
    projectName,
  ]);

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  useEffect(() => {
    arrangementRef.current = arrangement;
  }, [arrangement]);

  useEffect(() => {
    currentEpisodeRef.current = currentEpisode;
  }, [currentEpisode]);

  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  useEffect(() => {
    projectNameRef.current = projectName;
  }, [projectName]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
      abortExportRef.current?.abort();
      for (const asset of assetsRef.current) {
        if (asset.url) URL.revokeObjectURL(asset.url);
      }
    };
  }, []);

  const assetById = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset])),
    [assets],
  );
  const poolAssetView = useMemo(
    () =>
      buildPoolAssetView(arrangement, assets, {
        episode: currentEpisode,
        query,
        showAssigned: showAssignedAssets,
        sortBy,
      }),
    [arrangement, assets, currentEpisode, query, showAssignedAssets, sortBy],
  );
  const assignmentById = poolAssetView.assignmentById as Map<
    string,
    ReturnType<typeof findAssignment>
  >;
  const counts = useMemo(
    () => arrangementCounts(arrangement, assets),
    [arrangement, assets],
  );
  const scenes = useMemo(
    () => getScenes(arrangement) as Scene[],
    [arrangement],
  );
  useEffect(() => {
    const targetIndex = pendingSceneScrollRef.current;
    if (targetIndex === null || targetIndex >= scenes.length) return;
    pendingSceneScrollRef.current = null;

    const frame = window.requestAnimationFrame(() => {
      const container = sceneListRef.current;
      const target = container?.querySelector<HTMLElement>(
        `[data-scene-index="${targetIndex}"]`,
      );
      if (!container || !target) return;

      if (container.scrollHeight > container.clientHeight) {
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        container.scrollTo({
          top: Math.max(
            0,
            container.scrollTop + targetRect.top - containerRect.top - 12,
          ),
          behavior: 'smooth',
        });
      } else {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [scenes.length]);
  const selectedAsset = selectedFileId ? assetById.get(selectedFileId) : null;
  const missingCount = assets.filter((asset) => !asset.file).length;
  const assignedAssetCount = poolAssetView.assignedCount;
  const filteredAssets = poolAssetView.assets as VideoAsset[];
  const supportsFolderExport =
    hydrated &&
    typeof window !== 'undefined' &&
    typeof window.showDirectoryPicker === 'function';

  const addCandidates = useCallback(
    (candidates: IntakeCandidate[]) => {
      const accepted: IntakeCandidate[] = [];
      const rejected: string[] = [];
      let importedFiles = 0;
      let importedBytes = 0;
      let importLimitHit = false;
      for (const candidate of candidates) {
        importedFiles += 1;
        importedBytes += Math.max(0, candidate.file.size);
        if (
          importedFiles > IMPORT_MAX_FILES ||
          importedBytes > IMPORT_MAX_TOTAL_BYTES
        ) {
          importLimitHit = true;
          continue;
        }
        try { validateImportPath(candidate.relativePath); }
        catch { rejected.push(candidate.relativePath || candidate.file.name); continue; }
        if (isVideoFile(candidate.file)) accepted.push(candidate);
        else rejected.push(candidate.relativePath || candidate.file.name);
      }

      const next = [...assetsRef.current];
      let added = 0;
      let relinked = 0;
      let duplicates = 0;
      const filesToCache: VideoAsset[] = [];

      for (const candidate of accepted) {
        const fingerprint = fileFingerprint(
          candidate.file,
          candidate.relativePath,
        );
        let existingIndex = next.findIndex(
          (asset) => asset.fingerprint === fingerprint,
        );
        if (existingIndex < 0) {
          existingIndex = findAssetRelinkIndex(next, {
            name: candidate.file.name,
            size: candidate.file.size,
            lastModified: candidate.file.lastModified,
            relativePath: candidate.relativePath,
          });
        }
        if (existingIndex >= 0) {
          const existing = next[existingIndex];
          if (!existing.file) {
            const relinkedAsset = {
              ...existing,
              file: candidate.file,
              url: URL.createObjectURL(candidate.file),
              handle: candidate.handle ?? existing.handle ?? null,
              type: candidate.file.type,
            };
            next[existingIndex] = relinkedAsset;
            filesToCache.push(relinkedAsset);
            relinked += 1;
          } else {
            duplicates += 1;
          }
          continue;
        }

        if (next.length >= IMPORT_MAX_FILES) { importLimitHit = true; continue; }
        const newAsset = {
          id: uniqueId(),
          fingerprint,
          name: candidate.file.name,
          size: candidate.file.size,
          type: candidate.file.type,
          lastModified: candidate.file.lastModified,
          relativePath: candidate.relativePath,
          duration: null,
          addedAt: Date.now() + added,
          file: candidate.file,
          url: URL.createObjectURL(candidate.file),
          handle: candidate.handle ?? null,
        };
        next.push(newAsset);
        filesToCache.push(newAsset);
        added += 1;
      }

      replaceAssetCollection(next);
      if (filesToCache.length > 0 && historyIndexedDbAvailable()) {
        void saveProjectHistory(currentSnapshot(), next).catch(() =>
          notify(
            '浏览器空间不足，部分视频未写入历史缓存；当前编排仍可继续使用。',
            'warning',
          ),
        );
      }
      if (rejected.length > 0) {
        const sample = rejected.slice(0, 2).join('、');
        notify(
          `已跳过 ${rejected.length} 个非视频文件${sample ? `：${sample}` : ''}。`,
          'warning',
        );
      } else if (importLimitHit) {
        notify(
          `单次导入最多 ${IMPORT_MAX_FILES} 个文件、总大小 100 GB，超出部分已跳过。`,
          'warning',
        );
      } else if (relinked > 0 || added > 0) {
        notify(
          [
            added ? `加入 ${added} 个视频` : '',
            relinked ? `重新关联 ${relinked} 个` : '',
          ]
            .filter(Boolean)
            .join('，'),
          'success',
        );
      } else if (duplicates > 0) {
        notify(`已忽略 ${duplicates} 个重复视频。`, 'info');
      }
    },
    [currentSnapshot, notify, replaceAssetCollection],
  );

  const handleInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      addCandidates(files.map((file) => candidateFromFile(file)));
      event.target.value = '';
    },
    [addCandidates],
  );

  const handleSelectVideos = useCallback(async () => {
    if (typeof window.showOpenFilePicker !== 'function') {
      filesInputRef.current?.click();
      return;
    }
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        excludeAcceptAllOption: false,
        types: [
          {
            description: '视频文件',
            accept: {
              'video/*': [
                '.mp4',
                '.mov',
                '.m4v',
                '.webm',
                '.mkv',
                '.avi',
                '.mts',
                '.m2ts',
                '.wmv',
                '.flv',
              ],
            },
          },
        ],
      });
      const candidates: IntakeCandidate[] = [];
      for (const handle of handles) {
        candidates.push(
          candidateFromFile(await handle.getFile(), handle.name, handle),
        );
      }
      addCandidates(candidates);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      notify(
        error instanceof Error
          ? `选择视频失败：${error.message}`
          : '选择视频失败。',
        'warning',
      );
    }
  }, [addCandidates, notify]);

  const handleSelectFolder = useCallback(async () => {
    if (typeof window.showDirectoryPicker !== 'function') {
      directoryInputRef.current?.click();
      return;
    }
    try {
      const directory = await window.showDirectoryPicker({
        id: 'storyboard-packager-import',
        mode: 'read',
        startIn: directoryHandleRef.current ?? undefined,
      });
      directoryHandleRef.current = directory;
      const candidates: IntakeCandidate[] = [];
      await walkHandle(directory, '', candidates, createImportBudget());
      addCandidates(candidates);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      notify(
        error instanceof Error
          ? `读取文件夹失败：${error.message}`
          : '读取文件夹失败。',
        'warning',
      );
    }
  }, [addCandidates, notify]);

  const restoreAssetHandles = useCallback(
    async (requestPermission: boolean) => {
      const current = assetsRef.current;
      let restored = 0;
      const next = await Promise.all(
        current.map(async (asset) => {
          const file = await resolveHandleFile(asset.handle, requestPermission);
          if (
            !file ||
            file.name !== asset.name ||
            file.size !== asset.size ||
            file.lastModified !== asset.lastModified
          )
            return asset;
          restored += 1;
          if (asset.url) URL.revokeObjectURL(asset.url);
          return { ...asset, file, url: URL.createObjectURL(file) };
        }),
      );
      replaceAssetCollection(next);
      if (restored > 0)
        notify(`已恢复 ${restored} 个素材，可继续导出。`, 'success');
      else
        notify('没有获得可用的素材授权；请重新选择原文件或文件夹。', 'warning');
    },
    [notify, replaceAssetCollection],
  );

  const restoreHistoryRecord = useCallback(
    async (record: ProjectHistoryRecord) => {
      const current = currentSnapshot();
      if (comparableSnapshot(current) !== comparableSnapshot(record)) {
        const confirmed = window.confirm(
          `恢复“${record.name}”会覆盖当前编排、槽位和备注，是否继续？`,
        );
        if (!confirmed) return;
      }
      const restoredEpisode = canonicalEpisode(record.episode) ?? '1';
      const restoredArrangement = sanitiseArrangement(record.arrangement);
      const metadata = (record.assets ?? []).map((asset) => ({
        ...asset,
        file: null,
        url: null,
        handle: asset.handle ?? null,
      })) as VideoAsset[];
      // Keep editing the selected record. IndexedDB.put then updates this same
      // id instead of cloning another history item on every restore.
      setProjectId(record.id);
      projectIdRef.current = record.id;
      projectCreatedAtRef.current = Number(record.createdAt) || Date.now();
      historyBoundRef.current = true;
      const restoredProjectName = (
        typeof record.name === 'string' && record.name
          ? record.name
          : '我的分镜编排'
      ).slice(0, PROJECT_NAME_MAX_LENGTH);
      setProjectName(restoredProjectName);
      projectNameRef.current = restoredProjectName;
      currentEpisodeRef.current = restoredEpisode;
      setCurrentEpisode(restoredEpisode);
      setEpisodeDraft(restoredEpisode);
      if (record.sortBy) setSortBy(record.sortBy);
      arrangementRef.current = restoredArrangement;
      setArrangement(restoredArrangement);
      directoryHandleRef.current = record.directoryHandle ?? null;
      const handleRequests = new Map<string, Promise<File | null>>(
        metadata
          .filter((asset) => asset.handle)
          .map(
            (asset) =>
              [
                asset.fingerprint,
                // Restoring a history record must not trigger permission prompts.
                // The explicit “恢复素材授权” action is the only place that asks.
                resolveHandleFile(asset.handle, false),
              ] as const,
          ),
      );
      const cachedFiles = (await loadCachedProjectFiles(metadata).catch(
        () => new Map(),
      )) as Map<string, File>;
      const resolved = await Promise.all(
        metadata.map(async (asset) => {
          const cached = cachedFiles.get(asset.fingerprint);
          const fromHandle = cached
            ? null
            : await handleRequests.get(asset.fingerprint);
          const file = fileMatchesAsset(cached, asset)
            ? cached
            : fileMatchesAsset(fromHandle, asset)
              ? fromHandle
              : null;
          if (!file) return asset;
          return { ...asset, file, url: URL.createObjectURL(file) };
        }),
      );
      replaceAssetCollection(resolved);
      const recoveredFiles = resolved.filter((asset) => asset.file);
      if (recoveredFiles.length > 0) {
        void saveProjectHistory(currentSnapshot(), resolved).catch(() => undefined);
      }
      setHistoryOpen(false);
      const missing = resolved.filter((asset) => !asset.file).length;
      notify(
        missing
          ? `已恢复编排与备注；${missing} 个素材没有可用缓存，请重新选择原视频或文件夹，系统会自动匹配原槽位。`
          : '已恢复完整编排、备注和全部视频。',
        missing ? 'warning' : 'success',
      );
    },
    [currentSnapshot, notify, replaceAssetCollection],
  );

  const saveVersion = useCallback(async () => {
    if (!historyIndexedDbAvailable()) {
      notify(
        '当前浏览器没有 IndexedDB，已继续使用 localStorage 元数据保存。',
        'warning',
      );
      return;
    }
    const alreadyBound = historyBoundRef.current;
    const now = Date.now();
    const id = alreadyBound ? uniqueId() : projectIdRef.current;
    const name = alreadyBound
      ? `${projectNameRef.current} · ${new Date(now).toLocaleString()}`.slice(
          0,
          PROJECT_NAME_MAX_LENGTH,
        )
      : projectNameRef.current.slice(0, PROJECT_NAME_MAX_LENGTH);
    const snapshot = currentSnapshot(
      id,
      name,
      alreadyBound ? now : projectCreatedAtRef.current,
    );
    try {
      await saveProjectHistory(snapshot, assetsRef.current);
      if (!alreadyBound) historyBoundRef.current = true;
      setHistoryRecords((await listProjectHistory()) as ProjectHistoryRecord[]);
      notify('已保存一个新的历史版本。', 'success');
    } catch {
      notify('历史版本保存失败；当前编排仍可继续使用。', 'warning');
    }
  }, [currentSnapshot, notify]);

  const removeHistoryRecord = useCallback(
    async (record: ProjectHistoryRecord) => {
      if (!window.confirm(`确认删除历史记录“${record.name}”？此操作不可撤销。`))
        return;
      try {
        await deleteProjectHistory(record.id);
        setHistoryRecords((current) =>
          current.filter((item) => item.id !== record.id),
        );
        if (record.id === projectIdRef.current) {
          const nextId = uniqueId();
          setProjectId(nextId);
          projectIdRef.current = nextId;
          projectCreatedAtRef.current = Date.now();
          historyBoundRef.current = false;
        }
      } catch {
        notify('历史记录删除失败。', 'warning');
      }
    },
    [notify],
  );

  const clearLocalHistory = useCallback(async () => {
    if (
      !window.confirm(
        '确认清空本地缓存/历史？这会删除当前浏览器中的工程记录、视频缓存和当前编辑内容，且无法恢复。',
      )
    )
      return;
    try {
      if (historyIndexedDbAvailable()) {
        if (historySaveTimerRef.current) window.clearTimeout(historySaveTimerRef.current);
        await clearProjectHistory();
      }
      window.localStorage.removeItem(STORAGE_KEY);
      replaceAssetCollection([]);
      setArrangement(createArrangement() as Arrangement);
      setCurrentEpisode('1');
      setEpisodeDraft('1');
      setSelectedFileId(null);
      setProjectName('我的分镜编排');
      projectNameRef.current = '我的分镜编排';
      const nextId = uniqueId();
      setProjectId(nextId);
      projectIdRef.current = nextId;
      projectCreatedAtRef.current = Date.now();
      historyBoundRef.current = false;
      directoryHandleRef.current = null;
      setHistoryRecords([]);
      notify('本地缓存、历史和当前编辑内容已清空。', 'success');
    } catch {
      notify('本地缓存/历史清空失败；未完成的记录仍会保留。', 'warning');
    }
  }, [notify, replaceAssetCollection]);

  const exportProjectJson = useCallback(() => {
    const payload = snapshotForJson(currentSnapshot());
    triggerDownload(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      }),
      `${sanitiseFilePart(projectNameRef.current) || '分镜编排'}.json`,
    );
  }, [currentSnapshot]);

  const importProjectJson = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      try {
        if (file.size > PROJECT_JSON_MAX_BYTES) {
          throw new Error(
            `工程 JSON 不能超过 ${PROJECT_JSON_MAX_BYTES / 1024 / 1024} MB`,
          );
        }
        const parsed = parseProjectJson(await file.text()) as ValidatedProject;
        const importedId = uniqueId();
        const importedName = parsed.name || '导入的分镜编排';
        const importedEpisode = parsed.episode;
        const importedArrangement = parsed.arrangement as Arrangement;
        const importedAssets = parsed.assets.map((asset) => ({
          ...asset,
          file: null,
          url: null,
          handle: null,
        })) as VideoAsset[];
        setProjectId(importedId);
        projectIdRef.current = importedId;
        projectCreatedAtRef.current = Date.now();
        historyBoundRef.current = false;
        setProjectName(importedName);
        projectNameRef.current = importedName;
        setCurrentEpisode(importedEpisode);
        setEpisodeDraft(importedEpisode);
        if (parsed.sortBy) setSortBy(parsed.sortBy);
        arrangementRef.current = importedArrangement;
        setArrangement(importedArrangement);
        replaceAssetCollection(importedAssets);
        directoryHandleRef.current = null;
        setHistoryOpen(false);
        notify(
          `工程已导入；${importedAssets.length} 个素材需要重新选择或授权。`,
          'success',
        );
      } catch {
        notify('工程 JSON 无法读取，请选择本工具导出的文件。', 'warning');
      }
    },
    [notify, replaceAssetCollection],
  );

  const reopenHistoryDirectory = useCallback(
    async (record: ProjectHistoryRecord) => {
      if (!window.showDirectoryPicker) {
        notify('当前浏览器不支持目录授权，请改用“选择文件夹”。', 'warning');
        return;
      }
      try {
        const directory = await window.showDirectoryPicker({
          id: 'storyboard-packager-history-import',
          mode: 'read',
          startIn: record.directoryHandle,
        });
        directoryHandleRef.current = directory;
        const candidates: IntakeCandidate[] = [];
        await walkHandle(directory, '', candidates, createImportBudget());
        addCandidates(candidates);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError')
          return;
        notify(
          error instanceof Error
            ? `重新打开素材目录失败：${error.message}`
            : '重新打开素材目录失败。',
          'warning',
        );
      }
    },
    [addCandidates, notify],
  );

  const handleExternalDrop = useCallback(
    async (event: DragEvent<HTMLElement>) => {
      try {
        const candidates = await filesFromDataTransfer(event.dataTransfer);
        if (candidates.length === 0) {
          notify('没有从拖放内容中找到可读取的文件。', 'warning');
          return;
        }
        addCandidates(candidates);
      } catch (error) {
        notify(
          error instanceof Error
            ? `读取拖放文件失败：${error.message}`
            : '读取拖放文件失败。',
          'warning',
        );
      }
    },
    [addCandidates, notify],
  );

  const commitEpisode = useCallback(
    (value = episodeDraft) => {
      const episode = canonicalEpisode(value);
      if (!episode) {
        setEpisodeDraft(currentEpisodeRef.current);
        notify('当前集号必须是 1–9999 的整数。', 'warning');
        return false;
      }
      currentEpisodeRef.current = episode;
      setCurrentEpisode(episode);
      setEpisodeDraft(episode);
      return true;
    },
    [episodeDraft, notify],
  );

  const updateDuration = useCallback((id: string, duration: number) => {
    setAssets((current) =>
      current.map((asset) =>
        asset.id === id && asset.duration !== duration
          ? { ...asset, duration }
          : asset,
      ),
    );
  }, []);

  const assignToMain = useCallback(
    (sceneIndex: number, fileId = selectedFileId) => {
      if (!fileId) {
        notify('请先在总池中选中一个视频。', 'warning');
        return;
      }
      if (typeof fileId !== 'string' || fileId.length > PROJECT_ID_MAX_LENGTH ||
          !assetsRef.current.some(asset => asset.id === fileId)) {
        notify('该素材不属于当前总池，请先导入原视频。', 'warning');
        return;
      }
      try {
        const previousSceneCount = getScenes(arrangementRef.current).length;
        const next = assignMain(
          arrangementRef.current,
          sceneIndex,
          fileId,
        ) as Arrangement;
        const nextSceneCount = getScenes(next).length;
        if (nextSceneCount > previousSceneCount) {
          pendingSceneScrollRef.current = nextSceneCount - 1;
        }
        arrangementRef.current = next;
        setArrangement(next);
        setSelectedFileId(null);
      } catch (error) {
        notify(
          error instanceof Error ? error.message : '无法分配主镜头。',
          'warning',
        );
      }
    },
    [notify, selectedFileId],
  );

  const assignToSupplement = useCallback(
    (sceneIndex: number, fileId = selectedFileId) => {
      if (!fileId) {
        notify('请先在总池中选中一个视频。', 'warning');
        return;
      }
      if (typeof fileId !== 'string' || fileId.length > PROJECT_ID_MAX_LENGTH ||
          !assetsRef.current.some(asset => asset.id === fileId)) {
        notify('该素材不属于当前总池，请先导入原视频。', 'warning');
        return;
      }
      try {
        const next = assignSupplement(
          arrangementRef.current,
          sceneIndex,
          fileId,
        ) as Arrangement;
        arrangementRef.current = next;
        setArrangement(next);
        setSelectedFileId(null);
      } catch (error) {
        notify(
          error instanceof Error ? error.message : '无法加入补镜头。',
          'warning',
        );
      }
    },
    [notify, selectedFileId],
  );

  const updateSupplementNote = useCallback(
    (sceneIndex: number, fileId: string, note: string) => {
      try {
        const boundedNote = note.slice(0, PROJECT_NOTE_MAX_LENGTH);
        setArrangement((current) =>
          setSupplementNote(current, sceneIndex, fileId, boundedNote),
        );
      } catch (error) {
        notify(
          error instanceof Error ? error.message : '无法保存补镜头备注。',
          'warning',
        );
      }
    },
    [notify],
  );

  const unassign = useCallback(
    (fileId: string) => {
      if (typeof fileId !== 'string' || fileId.length > PROJECT_ID_MAX_LENGTH ||
          !assetsRef.current.some(asset => asset.id === fileId)) {
        notify('该素材不属于当前总池，请先导入原视频。', 'warning');
        return;
      }
      const next = removeFileFromArrangement(
        arrangementRef.current,
        fileId,
      ) as Arrangement;
      arrangementRef.current = next;
      setArrangement(next);
      notify('视频已移回总池。', 'info');
    },
    [notify],
  );

  const handleInternalDrop = useCallback(
    (
      event: DragEvent<HTMLElement>,
      kind: 'main' | 'supplement',
      sceneIndex: number,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      setDropTarget(null);
      const fileId = event.dataTransfer.getData(DRAG_TYPE);
      if (!fileId) {
        if (event.dataTransfer.types.includes('Files')) {
          notify('请先将新视频拖入左侧总池，再放入分镜槽。', 'warning');
        }
        return false;
      }
      if (kind === 'main') assignToMain(sceneIndex, fileId);
      else assignToSupplement(sceneIndex, fileId);
      return true;
    },
    [assignToMain, assignToSupplement, notify],
  );

  const removeAsset = useCallback(
    (fileId: string) => {
      const asset = assetsRef.current.find((item) => item.id === fileId);
      if (!asset) return;
      const assignment = findAssignment(
        arrangementRef.current,
        fileId,
        currentEpisodeRef.current,
      );
      if (asset?.url) URL.revokeObjectURL(asset.url);
      const nextAssets = assetsRef.current.filter((item) => item.id !== fileId);
      assetsRef.current = nextAssets;
      setAssets(nextAssets);
      if (assignment) {
        const nextArrangement = removeFileFromArrangement(
          arrangementRef.current,
          fileId,
        );
        arrangementRef.current = nextArrangement;
        setArrangement(nextArrangement);
      }
      if (selectedFileId === fileId) setSelectedFileId(null);
      if (historyIndexedDbAvailable()) {
        void garbageCollectProjectFileCache().catch(() => undefined);
      }
      notify(
        assignment
          ? `已从 ${assignment.episode}-${assignment.scene} 和总池移除该素材；不会删除原文件。`
          : '已从总池移除该素材；不会删除原文件。',
        'info',
      );
    },
    [notify, selectedFileId],
  );

  const clearAssetPool = useCallback(() => {
    if (assetsRef.current.length === 0) return;
    const nextArrangement = createArrangement() as Arrangement;
    pendingSceneScrollRef.current = null;
    arrangementRef.current = nextArrangement;
    setArrangement(nextArrangement);
    replaceAssetCollection([]);
    setSelectedFileId(null);
    setShowAssignedAssets(false);
    setQuery('');
    setDropTarget(null);
    notify('总池和当前编排已清空；不会删除电脑中的原视频。', 'info');
  }, [notify, replaceAssetCollection]);

  const validateExport = useCallback(() => {
    const entries = buildExportEntries(
      arrangementRef.current,
      assetsRef.current,
      currentEpisodeRef.current,
    ) as ExportEntry[];
    if (entries.length === 0) {
      notify('至少分配一个主镜头或补镜头后才能导出。', 'warning');
      return null;
    }
    const conflicts = detectExportConflicts(entries);
    if (conflicts.length > 0) {
      notify(
        `发现 ${conflicts.length} 组导出命名冲突，已阻止导出。`,
        'warning',
      );
      return null;
    }
    const missing = entries.filter(
      (entry) => !assetById.get(entry.fileId)?.file,
    );
    if (missing.length > 0) {
      notify(
        `${missing.length} 个已分配视频需要重新关联原文件，当前不能导出。`,
        'warning',
      );
      return null;
    }
    return entries;
  }, [assetById, notify]);

  const groupedEntries = useCallback((entries: ExportEntry[]) => {
    const result = new Map<string, ExportEntry[]>();
    for (const entry of entries) {
      const group = result.get(entry.episode) ?? [];
      group.push(entry);
      result.set(entry.episode, group);
    }
    return result;
  }, []);

  const exportZip = useCallback(async () => {
    if (exportState.status === 'running' || exportState.status === 'preparing')
      return;
    const entries = validateExport();
    if (!entries) return;
    const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
    if (totalBytes > ZIP_LIMIT_BYTES) {
      notify(
        'ZIP 方案为保护浏览器内存限制在 2 GB；请使用 Chromium 的“导出到文件夹”。',
        'warning',
      );
      return;
    }
    if (
      totalBytes >= ZIP_WARNING_BYTES &&
      !window.confirm(
        `将生成约 ${formatBytes(totalBytes)} 的 ZIP，浏览器可能需要接近同等内存。继续吗？`,
      )
    ) {
      return;
    }

    const controller = new AbortController();
    abortExportRef.current = controller;
    setExportState({
      status: 'preparing',
      mode: 'zip',
      progress: 1,
      label: '准备 ZIP',
      message: '正在加载本地打包模块…',
    });

    try {
      const { BlobReader, BlobWriter, TextReader, ZipWriter } =
        await import('@zip.js/zip.js');
      const blobWriter = new BlobWriter('application/zip');
      const zipWriter = new ZipWriter(blobWriter, {
        keepOrder: true,
        useWebWorkers: false,
      });
      let completedBytes = 0;

      setExportState((current) => ({
        ...current,
        status: 'running',
        message: '视频仅从当前浏览器读取，不会上传。',
      }));

      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        const asset = assetById.get(entry.fileId);
        if (!asset?.file) throw new Error(`无法读取 ${entry.originalName}`);
        await zipWriter.add(entry.path, new BlobReader(asset.file), {
          level: 0,
          signal: controller.signal,
          lastModDate: new Date(asset.lastModified),
          onprogress(progress) {
            const ratio = totalBytes
              ? (completedBytes + progress) / totalBytes
              : (index + 1) / entries.length;
            setExportState((current) => ({
              ...current,
              progress: Math.min(94, Math.max(2, Math.round(ratio * 94))),
              label: `正在写入 ${entry.exportName}`,
            }));
          },
        });
        completedBytes += entry.size;
      }

      const groups = groupedEntries(entries);
      let manifestIndex = 0;
      for (const [episode, episodeEntries] of groups) {
        const manifest = JSON.stringify(
          manifestPayload(episode, episodeEntries),
          null,
          2,
        );
        await zipWriter.add('manifest.json', new TextReader(manifest), {
          signal: controller.signal,
          level: 0,
        });
        await zipWriter.add(
          'manifest.csv',
          new TextReader(manifestCsv(episodeEntries)),
          {
            signal: controller.signal,
            level: 0,
          },
        );
        manifestIndex += 1;
        setExportState((current) => ({
          ...current,
          progress: 94 + Math.round((manifestIndex / groups.size) * 4),
          label: `正在生成 ${episode} 前缀清单`,
        }));
      }

      const blob = await zipWriter.close();
      if (controller.signal.aborted)
        throw new DOMException('Aborted', 'AbortError');
      triggerDownload(blob, zipFileName([...groups.keys()]));
      setExportState({
        status: 'success',
        mode: 'zip',
        progress: 100,
        label: 'ZIP 已生成',
        message: `已打包 ${entries.length} 个视频；${counts.unassigned} 个未分配视频未导出。`,
      });
    } catch (error) {
      setExportState({
        status: isAbort(error, controller.signal) ? 'cancelled' : 'error',
        mode: 'zip',
        progress: 0,
        label: isAbort(error, controller.signal) ? '已取消' : 'ZIP 导出失败',
        message: isAbort(error, controller.signal)
          ? '编排未改变，可随时重新导出。'
          : error instanceof Error
            ? error.message
            : '未知错误，请重试或改用文件夹导出。',
      });
    } finally {
      abortExportRef.current = null;
    }
  }, [
    assetById,
    counts.unassigned,
    exportState.status,
    groupedEntries,
    notify,
    validateExport,
  ]);

  const exportFolder = useCallback(async () => {
    if (exportState.status === 'running' || exportState.status === 'preparing')
      return;
    const entries = validateExport();
    if (!entries) return;
    if (!window.showDirectoryPicker) {
      notify('当前浏览器不支持直接写入文件夹，请改用 ZIP 下载。', 'warning');
      return;
    }

    const controller = new AbortController();
    abortExportRef.current = controller;
    setExportState({
      status: 'preparing',
      mode: 'folder',
      progress: 1,
      label: '选择输出位置',
      message: '将在所选目录中新建一个带时间戳的打包文件夹。',
    });

    let selectedDirectory: DirectoryHandleLike | null = null;
    let packageDirectory: DirectoryHandleLike | null = null;
    let packageDirectoryName: string | null = null;
    const createdFiles: string[] = [];
    try {
      selectedDirectory = await window.showDirectoryPicker({
        id: 'storyboard-packager-export',
        mode: 'readwrite',
      });
      const createdDirectory =
        await createUniqueOutputDirectory(selectedDirectory);
      packageDirectoryName = createdDirectory.name;
      packageDirectory = createdDirectory.directory;
      const outputDirectory = createdDirectory.directory;
      await writeIncompleteMarker(outputDirectory, '导出进行中');
      createdFiles.push(INCOMPLETE_MARKER_NAME);
      const groups = groupedEntries(entries);
      const totalBytes = Math.max(
        1,
        entries.reduce((sum, entry) => sum + entry.size, 0),
      );
      let writtenBytes = 0;

      setExportState((current) => ({
        ...current,
        status: 'running',
        message: '逐文件复制，适合大视频；原文件不会被改名或移动。',
      }));

      for (const [episode, episodeEntries] of groups) {
        for (const entry of episodeEntries) {
          if (controller.signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }
          const asset = assetById.get(entry.fileId);
          if (!asset?.file) throw new Error(`无法读取 ${entry.originalName}`);
          const fileHandle = await createOutputFile(
            outputDirectory,
            entry.exportName,
          );
          createdFiles.push(entry.exportName);
          const writable = await fileHandle.createWritable();
          const reader = asset.file.stream().getReader();
          try {
            while (true) {
              if (controller.signal.aborted) {
                throw new DOMException('Aborted', 'AbortError');
              }
              const { value, done } = await reader.read();
              if (done) break;
              await writable.write(value);
              writtenBytes += value.byteLength;
              setExportState((current) => ({
                ...current,
                progress: Math.min(
                  96,
                  Math.round((writtenBytes / totalBytes) * 96),
                ),
                label: `正在复制 ${entry.exportName}`,
              }));
            }
            await writable.close();
          } catch (error) {
            await reader.cancel().catch(() => undefined);
            await writable.abort(error).catch(() => undefined);
            throw error;
          } finally {
            reader.releaseLock();
          }
        }

        const jsonHandle = await createOutputFile(
          outputDirectory,
          'manifest.json',
        );
        createdFiles.push('manifest.json');
        await writeOutputText(jsonHandle,
          JSON.stringify(manifestPayload(episode, episodeEntries), null, 2));

        const csvHandle = await createOutputFile(
          outputDirectory,
          'manifest.csv',
        );
        createdFiles.push('manifest.csv');
        await writeOutputText(csvHandle, manifestCsv(episodeEntries));
      }

      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!(await removeOutputEntry(outputDirectory, INCOMPLETE_MARKER_NAME))) {
        throw new Error('无法移除导出临时标记，未将结果标记为完整。');
      }
      const markerIndex = createdFiles.indexOf(INCOMPLETE_MARKER_NAME);
      if (markerIndex >= 0) createdFiles.splice(markerIndex, 1);

      setExportState({
        status: 'success',
        mode: 'folder',
        progress: 100,
        label: '文件夹导出完成',
        message: `已复制 ${entries.length} 个视频；${counts.unassigned} 个未分配视频未导出。`,
      });
    } catch (error) {
      await cleanupOutputDirectory(
        selectedDirectory,
        packageDirectory,
        packageDirectoryName,
        createdFiles,
        error instanceof Error ? error.message : '导出中断',
      );
      setExportState({
        status: isAbort(error, controller.signal) ? 'cancelled' : 'error',
        mode: 'folder',
        progress: 0,
        label: isAbort(error, controller.signal) ? '已取消' : '文件夹导出失败',
        message: isAbort(error, controller.signal)
          ? '未完成的临时写入已中止；编排未改变。'
          : error instanceof Error
            ? error.message
            : '浏览器未能写入所选文件夹，请重试或改用 ZIP。',
      });
    } finally {
      abortExportRef.current = null;
    }
  }, [
    assetById,
    counts.unassigned,
    exportState.status,
    groupedEntries,
    notify,
    validateExport,
  ]);

  const onPoolDrop = useCallback(
    async (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setDropTarget(null);
      const fileId = event.dataTransfer.getData(DRAG_TYPE);
      if (fileId) {
        unassign(fileId);
        return;
      }
      await handleExternalDrop(event);
    },
    [handleExternalDrop, unassign],
  );

  const exportEntries = useMemo(
    () =>
      buildExportEntries(arrangement, assets, currentEpisode) as ExportEntry[],
    [arrangement, assets, currentEpisode],
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <input
        ref={filesInputRef}
        className="sr-only"
        type="file"
        accept="video/*,.mkv,.avi,.mts,.m2ts,.wmv,.flv"
        multiple
        onChange={handleInput}
      />
      <input
        ref={(node) => {
          directoryInputRef.current = node;
          if (node) {
            node.setAttribute('webkitdirectory', '');
            node.setAttribute('directory', '');
          }
        }}
        className="sr-only"
        type="file"
        multiple
        onChange={handleInput}
      />
      <input
        ref={projectImportRef}
        className="sr-only"
        type="file"
        accept="application/json,.json"
        onChange={importProjectJson}
      />

      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-[#101a2b]/96 text-white shadow-[0_8px_28px_rgb(15_23_42/14%)] backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-[1720px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/8 text-amber-300 shadow-inner">
              <Film aria-hidden="true" className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">
                  分镜命名打包器
                </h1>
                <Badge className="hidden border-emerald-300/20 bg-emerald-300/10 text-emerald-200 sm:inline-flex">
                  <ShieldCheck data-icon="inline-start" /> 本地处理
                </Badge>
              </div>
              <p className="truncate text-xs text-slate-400">
                拖入素材，编排主镜头与补镜头，按规则复制导出
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              className="border-white/15 bg-white/5 text-white hover:bg-white/10"
              variant="outline"
              size="lg"
              onClick={() => setHistoryOpen((open) => !open)}
            >
              <History data-icon="inline-start" /> 历史
            </Button>
            <Button
              className="hidden border-white/15 bg-white/5 text-white hover:bg-white/10 md:inline-flex"
              variant="outline"
              size="lg"
              disabled={
                !supportsFolderExport || exportState.status === 'running'
              }
              onClick={exportFolder}
              title={
                supportsFolderExport
                  ? '逐文件写入新建的输出文件夹'
                  : '当前浏览器不支持 File System Access API'
              }
            >
              <FolderOpen data-icon="inline-start" /> 导出到文件夹
            </Button>
            <Button
              className="bg-amber-300 text-slate-950 hover:bg-amber-200"
              size="lg"
              disabled={exportState.status === 'running'}
              onClick={exportZip}
            >
              <FileArchive data-icon="inline-start" /> 下载 ZIP
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1720px] px-3 py-4 sm:px-6 sm:py-6">
        <section className="mb-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <MousePointer2
                aria-hidden="true"
                className="size-4 text-teal-700"
              />
              {selectedAsset ? (
                <>
                  已选：
                  <span className="max-w-64 truncate text-slate-950">
                    {selectedAsset.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="取消选择"
                    onClick={() => setSelectedFileId(null)}
                  >
                    <X />
                  </Button>
                </>
              ) : (
                <span>可先选素材，再用每个槽位的按钮分配</span>
              )}
            </div>
            <span className="hidden h-4 w-px bg-slate-200 sm:block" />
            <p className="text-xs text-slate-500">
              {counts.assigned} 已分配 · {counts.unassigned}{' '}
              未分配（默认不导出）
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 md:hidden">
            <Button
              variant="outline"
              disabled={
                !supportsFolderExport || exportState.status === 'running'
              }
              onClick={exportFolder}
            >
              <FolderOpen /> 文件夹
            </Button>
            <Button
              disabled={exportState.status === 'running'}
              onClick={exportZip}
            >
              <FileArchive /> ZIP
            </Button>
          </div>
        </section>

        {historyOpen && (
          <section className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-950">
                  编排历史
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  启动时由你选择新建或恢复上一次；恢复后继续编辑只更新同一条记录，只有“保存版本”才新建。最多保留{' '}
                  {HISTORY_LIMIT}{' '}
                  条；视频优先从浏览器缓存恢复，也会尝试已保存的文件授权。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Input
                  className="h-8 w-44 bg-white text-xs"
                  value={projectName}
                  maxLength={PROJECT_NAME_MAX_LENGTH}
                  aria-label="当前编排名称"
                  onChange={(event) =>
                    setProjectName(
                      event.target.value.slice(0, PROJECT_NAME_MAX_LENGTH),
                    )
                  }
                />
                <Button size="sm" variant="outline" onClick={saveVersion}>
                  <Plus /> 保存版本
                </Button>
                <Button size="sm" variant="outline" onClick={exportProjectJson}>
                  <HardDriveDownload /> 导出工程 JSON
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => projectImportRef.current?.click()}
                >
                  <FolderInput /> 导入工程 JSON
                </Button>
                {assets.some((asset) => asset.handle && !asset.file) && (
                  <Button size="sm" onClick={() => restoreAssetHandles(true)}>
                    <Link2Off /> 恢复素材授权
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={clearLocalHistory}
                >
                  <Trash2 /> 清空本地缓存/历史
                </Button>
              </div>
            </div>
            {historyIndexedDbAvailable() && historyRecords.length > 0 ? (
              <div className="divide-y divide-slate-100">
                {historyRecords.map((record) => {
                  const recordCounts = arrangementCounts(
                    record.arrangement,
                    record.assets,
                  );
                  const missingHandles = record.assets.filter(
                    (asset) => !asset.handle,
                  ).length;
                  return (
                    <div
                      key={record.id}
                      className="flex flex-wrap items-center gap-3 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {record.name}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          保存于 {new Date(record.updatedAt).toLocaleString()} ·
                          前缀 {record.episode} · {recordCounts.main} 主 /{' '}
                          {recordCounts.supplement} 补 ·{' '}
                          {missingHandles === 0
                            ? '已保存文件授权'
                            : `${missingHandles} 个将尝试视频缓存`}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="xs"
                          onClick={() => restoreHistoryRecord(record)}
                        >
                          恢复编排和视频
                        </Button>
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => reopenHistoryDirectory(record)}
                          disabled={!record.directoryHandle}
                        >
                          重新打开素材目录
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => removeHistoryRecord(record)}
                        >
                          <Trash2 /> 删除
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="px-4 py-5 text-sm text-slate-500">
                {historyIndexedDbAvailable()
                  ? '还没有历史版本；新建空白页不会留记录，拖入素材后才开始自动保存。'
                  : '当前浏览器没有 IndexedDB，历史面板仅保留 localStorage 的当前编排。'}
              </p>
            )}
          </section>
        )}

        {missingCount > 0 && (
          <section className="mb-4 flex items-start gap-3 rounded-xl border border-amber-300/80 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <Link2Off aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{missingCount} 个视频需要重新关联</p>
              <p className="mt-0.5 text-xs text-amber-800">
                这些视频没有可用缓存或文件授权。重新选择原视频即可按文件名、大小和文件时间准确匹配回原槽位。
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" onClick={handleSelectVideos}>
                  <Plus /> 重新关联视频
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSelectFolder}
                >
                  <FolderInput /> 重新关联文件夹
                </Button>
              </div>
            </div>
          </section>
        )}

        <div className="grid gap-4 xl:h-[calc(100dvh-11rem)] xl:min-h-[620px] xl:grid-cols-2 xl:items-stretch">
          <aside
            className={`flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-white shadow-[0_16px_45px_rgb(15_23_42/7%)] transition ${
              dropTarget === 'pool'
                ? 'border-teal-500 ring-4 ring-teal-500/10'
                : 'border-slate-200'
            }`}
            onDragEnter={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDropTarget('pool');
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = event.dataTransfer.types.includes(
                DRAG_TYPE,
              )
                ? 'move'
                : 'copy';
            }}
            onDragLeave={(event) => {
              event.stopPropagation();
              if (!sameDragSurface(event)) setDropTarget(null);
            }}
            onDrop={onPoolDrop}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-slate-950">
                    视频总池
                  </h2>
                  <Badge variant="secondary">{assets.length}</Badge>
                  <Badge variant="outline">{assignedAssetCount} 已编排</Badge>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  默认只显示未编排素材；需要检查已放入槽位的素材时再打开显示
                </p>
              </div>
              <div className="flex items-center gap-2">
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button
                        size="xs"
                        variant="destructive"
                        disabled={assets.length === 0}
                      >
                        <Trash2 /> 清空总池
                      </Button>
                    }
                  />
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogMedia className="bg-rose-50 text-rose-700">
                        <CircleAlert />
                      </AlertDialogMedia>
                      <AlertDialogTitle>确认清空视频总池？</AlertDialogTitle>
                      <AlertDialogDescription>
                        网页中的全部素材和当前编排都会清空，但不会删除电脑中的原视频。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogCancel
                        variant="destructive"
                        onClick={clearAssetPool}
                      >
                        确认清空
                      </AlertDialogCancel>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <Button
                  size="xs"
                  variant={showAssignedAssets ? 'secondary' : 'outline'}
                  aria-pressed={showAssignedAssets}
                  onClick={() => setShowAssignedAssets((current) => !current)}
                >
                  {showAssignedAssets ? '隐藏已编排素材' : '显示已编排素材'}
                  <Badge
                    variant={showAssignedAssets ? 'outline' : 'secondary'}
                    className="ml-0.5 px-1.5 py-0 text-[10px]"
                  >
                    {assignedAssetCount}
                  </Badge>
                </Button>
                <HardDriveDownload
                  aria-hidden="true"
                  className="hidden size-5 text-slate-400 sm:block"
                />
              </div>
            </div>

            <div className="shrink-0 p-4 sm:p-5 xl:pb-4">
              <div
                className={`group grid min-h-28 place-items-center rounded-xl border border-dashed px-4 py-4 text-center transition ${
                  dropTarget === 'pool'
                    ? 'border-teal-500 bg-teal-50'
                    : 'border-slate-300 bg-slate-50 hover:border-slate-400 hover:bg-slate-100/70'
                }`}
              >
                <Upload
                  aria-hidden="true"
                  className="mx-auto size-6 text-teal-700"
                />
                <p className="mt-2 text-sm font-semibold text-slate-800">
                  拖入多个视频或整个文件夹
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  移回总池时，把已分配的视频拖到这里
                </p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <Button size="sm" onClick={handleSelectVideos}>
                    <Plus /> 选择视频
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSelectFolder}
                  >
                    <FolderInput /> 选择文件夹
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid gap-2 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div className="relative">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                  />
                  <Input
                    className="pl-8"
                    value={query}
                    placeholder="搜索文件名"
                    aria-label="搜索总池视频"
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
                <label className="relative">
                  <ListFilter
                    aria-hidden="true"
                    className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-slate-500"
                  />
                  <select
                    className="h-8 w-full appearance-none rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-xs font-medium text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                    value={sortBy}
                    aria-label="总池排序"
                    onChange={(event) =>
                      setSortBy(
                        event.target.value as
                          | 'lastModified'
                          | 'lastModifiedDesc'
                          | 'name'
                          | 'size'
                          | 'status',
                      )
                    }
                  >
                    <option value="lastModified">文件时间（旧→新）</option>
                    <option value="lastModifiedDesc">文件时间（新→旧）</option>
                    <option value="name">文件名</option>
                    <option value="size">文件大小</option>
                    <option value="status">分配状态</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="max-h-[560px] min-h-40 flex-1 overflow-y-auto overscroll-auto border-t border-slate-100 p-4 xl:max-h-none">
              {filteredAssets.length === 0 ? (
                <div className="grid min-h-36 place-items-center rounded-xl border border-slate-100 bg-slate-50/70 px-6 text-center">
                  <div>
                    <Film
                      aria-hidden="true"
                      className="mx-auto size-7 text-slate-300"
                    />
                    <p className="mt-2 text-sm font-medium text-slate-600">
                      {assets.length === 0
                        ? '总池还是空的'
                        : !showAssignedAssets &&
                            assignedAssetCount === assets.length
                          ? '素材都已编排'
                          : '没有匹配的视频'}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {assets.length === 0
                        ? '拖入文件即可开始，不需要上传'
                        : !showAssignedAssets &&
                            assignedAssetCount === assets.length
                          ? '点击“显示已编排素材”可查看并重新调整槽位'
                          : '试试更短的搜索词'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {filteredAssets.map((asset) => {
                    const assignment = assignmentById.get(asset.id) ?? null;
                    const selected = selectedFileId === asset.id;
                    return (
                      <article
                        key={asset.id}
                        className={`group relative flex min-w-0 cursor-grab flex-col gap-2 rounded-xl border p-2 transition active:cursor-grabbing ${
                          selected
                            ? 'border-teal-500 bg-teal-50/70 ring-2 ring-teal-500/10'
                            : assignment && showAssignedAssets
                              ? 'border-slate-200 bg-slate-100/80 opacity-70 grayscale-[0.18] hover:border-slate-300 hover:opacity-100 hover:grayscale-0 hover:shadow-sm'
                              : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                        }`}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData(DRAG_TYPE, asset.id);
                          event.dataTransfer.effectAllowed = 'move';
                        }}
                      >
                        <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-950">
                          <HoverPreviewVideo
                            asset={asset}
                            onDuration={updateDuration}
                            className="h-full w-full bg-slate-950 object-cover"
                            label={`${asset.name} 视频预览`}
                          />
                          <span className="absolute bottom-1 right-1 rounded bg-slate-950/75 px-1.5 py-0.5 font-mono text-[10px] text-white">
                            {formatDuration(asset.duration)}
                          </span>
                          <Badge
                            variant={
                              asset.file
                                ? assignment
                                  ? 'outline'
                                  : 'secondary'
                                : 'destructive'
                            }
                            className="absolute bottom-1 left-1 max-w-[calc(100%-3rem)] truncate border-white/60 bg-white/90 px-1.5 py-0 text-[9px] shadow-sm"
                          >
                            {asset.file
                              ? describeAssignment(assignment)
                              : '需重新关联'}
                          </Badge>
                          <span
                            className="absolute left-1 top-1 grid size-6 place-items-center rounded-md bg-slate-950/65 text-white opacity-80"
                            aria-hidden="true"
                          >
                            <GripVertical className="size-3.5" />
                          </span>
                          <Button
                            className="absolute right-1 top-1 bg-white/90 text-slate-600 shadow-sm hover:bg-white hover:text-rose-700"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`从总池移除 ${asset.name}`}
                            onClick={() => removeAsset(asset.id)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-slate-800">
                            {asset.name}
                          </p>
                          <p className="mt-0.5 truncate text-[10px] text-slate-500">
                            {formatBytes(asset.size)} ·{' '}
                            {formatFileTime(asset.lastModified)}
                          </p>
                        </div>
                        <Button
                          className="mt-auto w-full"
                          variant={selected ? 'default' : 'outline'}
                          size="xs"
                          onClick={() =>
                            setSelectedFileId(selected ? null : asset.id)
                          }
                        >
                          {selected ? <Check /> : <MousePointer2 />}
                          {selected ? '已选中' : '选中素材'}
                        </Button>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_45px_rgb(15_23_42/7%)]">
            <div className="shrink-0 border-b border-slate-200 bg-[linear-gradient(120deg,#eef6ff_0%,#f8fbff_45%,#fff9eb_100%)] px-4 py-4 sm:px-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-700">
                    命名前缀（集号）
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <Input
                      className="h-11 w-24 border-blue-300 bg-white text-center font-mono text-xl font-bold text-slate-950 shadow-sm"
                      type="number"
                      min={1}
                      max={9999}
                      inputMode="numeric"
                      value={episodeDraft}
                      aria-label="命名前缀集号"
                      onChange={(event) => setEpisodeDraft(event.target.value)}
                      onBlur={() => commitEpisode()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          commitEpisode();
                          event.currentTarget.blur();
                        }
                      }}
                    />
                    <div>
                      <p className="text-base font-semibold text-slate-950">
                        当前编排：{currentEpisode}-1、{currentEpisode}-2…
                      </p>
                      <p className="text-xs text-slate-500">
                        只改命名前缀，不会新增或切换另一套编排
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <div className="rounded-lg border border-white/90 bg-white/75 px-3 py-2 text-right shadow-sm">
                    <p className="text-[11px] text-slate-500">分镜槽位</p>
                    <p className="font-mono text-sm font-semibold text-slate-900">
                      {Math.max(0, scenes.length - 1)} 已用 + 1 空槽
                    </p>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button variant="destructive" size="sm">
                          <RotateCcw /> 清空编排
                        </Button>
                      }
                    />
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogMedia className="bg-rose-50 text-rose-700">
                          <CircleAlert />
                        </AlertDialogMedia>
                        <AlertDialogTitle>确认清空全部编排？</AlertDialogTitle>
                        <AlertDialogDescription>
                          当前编排的主镜头与补镜头分配都会清除。视频仍保留在总池，可重新编排。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogCancel
                          variant="destructive"
                          onClick={() => {
                            const next = createArrangement() as Arrangement;
                            arrangementRef.current = next;
                            setArrangement(next);
                            setSelectedFileId(null);
                            notify('全部编排已清空，视频仍在总池。', 'info');
                          }}
                        >
                          确认清空
                        </AlertDialogCancel>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>

              <p className="mt-3 text-xs text-slate-500">
                分镜槽会在填入最后一个槽位后自动增加；最终视频严格按槽位命名，例如
                <span className="ml-1 font-mono font-semibold text-slate-800">
                  {currentEpisode}-1.mp4
                </span>
                。
              </p>
            </div>

            <div
              ref={sceneListRef}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-auto bg-slate-50/65 p-3 sm:p-4"
            >
              {scenes.map((scene, sceneIndex) => {
                const mainAsset = scene.mainId
                  ? assetById.get(scene.mainId)
                  : null;
                const mainTarget = `main-${currentEpisode}-${sceneIndex}`;
                const supplementTarget = `supp-${currentEpisode}-${sceneIndex}`;
                return (
                  <article
                    key={`${currentEpisode}-${sceneIndex}`}
                    data-scene-index={sceneIndex}
                    className="grid overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm xl:grid-cols-2"
                  >
                    <header className="flex items-center justify-between gap-3 border-b border-slate-700 bg-slate-800 px-4 py-2.5 text-white xl:col-span-2">
                      <div className="flex items-center gap-2.5">
                        <span className="grid size-8 place-items-center rounded-lg bg-white/10 font-mono text-sm font-bold text-white">
                          {sceneIndex + 1}
                        </span>
                        <div>
                          <h3 className="font-mono text-sm font-bold">
                            分镜 {currentEpisode}-{sceneIndex + 1}
                          </h3>
                          <p className="text-xs text-slate-300">
                            左侧主镜头 · 右侧补充材料
                          </p>
                        </div>
                      </div>
                      <Badge className="border-white/20 bg-white/10 text-white">
                        {mainAsset
                          ? '主镜头已就位'
                          : sceneIndex === scenes.length - 1
                            ? '下一个空分镜'
                            : '主镜头待填'}
                      </Badge>
                    </header>
                    <section
                      className={`min-h-44 border-b border-blue-200 bg-blue-50/70 p-4 transition xl:border-b-0 xl:border-r ${
                        dropTarget === mainTarget
                          ? 'border-blue-500 bg-blue-100 ring-4 ring-inset ring-blue-500/15'
                          : ''
                      }`}
                      aria-label={`${currentEpisode}-${sceneIndex + 1} 主分镜投放区`}
                      onDragEnter={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (event.dataTransfer.types.includes(DRAG_TYPE)) {
                          setDropTarget(mainTarget);
                        }
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (event.dataTransfer.types.includes(DRAG_TYPE)) {
                          event.dataTransfer.dropEffect = 'move';
                        } else {
                          event.dataTransfer.dropEffect = 'none';
                        }
                      }}
                      onDragLeave={(event) => {
                        event.stopPropagation();
                        if (!sameDragSurface(event)) setDropTarget(null);
                      }}
                      onDrop={(event) =>
                        handleInternalDrop(event, 'main', sceneIndex)
                      }
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="grid size-8 place-items-center rounded-lg bg-blue-700 text-sm font-bold text-white">
                            主
                          </span>
                          <div>
                            <h3 className="text-sm font-bold text-blue-950">
                              主镜头槽
                            </h3>
                            <p className="text-xs text-blue-700">
                              {currentEpisode}-{sceneIndex + 1} 的正式镜头
                            </p>
                          </div>
                        </div>
                      </div>

                      {mainAsset ? (
                        <div
                          className="mt-4 rounded-xl border border-blue-200 bg-white/90 p-3 shadow-sm"
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData(DRAG_TYPE, mainAsset.id);
                            event.dataTransfer.effectAllowed = 'move';
                          }}
                        >
                          <div className="flex items-start gap-3">
                            <div className="size-16 shrink-0 overflow-hidden rounded-lg border border-blue-200 bg-slate-950">
                              <HoverPreviewVideo
                                asset={mainAsset}
                                onDuration={updateDuration}
                                className="h-full w-full object-cover"
                                label={`${mainAsset.name} 主镜头预览`}
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p
                                className="truncate text-sm font-semibold text-slate-900"
                                title={mainAsset.name}
                              >
                                {mainAsset.name}
                              </p>
                              <p className="mt-0.5 truncate font-mono text-xs font-semibold text-blue-800">
                                →{' '}
                                {makeExportName({
                                  episode: currentEpisode,
                                  scene: sceneIndex + 1,
                                  kind: 'main',
                                  originalName: mainAsset.name,
                                })}
                              </p>
                              <p
                                className="mt-1 truncate text-[10px] text-slate-500"
                                title="浏览器可读取的文件最后修改时间"
                              >
                                文件时间：
                                {formatFileTime(mainAsset.lastModified)}
                              </p>
                              {!mainAsset.file && (
                                <p className="mt-1 text-xs font-medium text-rose-700">
                                  需重新关联原文件
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-2">
                            <span className="text-xs text-slate-500">
                              {formatBytes(mainAsset.size)} · 拖回左侧可取消
                            </span>
                            <Button
                              variant="outline"
                              size="xs"
                              onClick={() => unassign(mainAsset.id)}
                            >
                              <ChevronRight /> 移回总池
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-4 grid min-h-24 place-items-center rounded-xl border border-dashed border-blue-300 bg-white/75 px-4 py-4 text-center">
                          <div>
                            <p className="text-sm font-medium text-slate-700">
                              拖入一个视频作为主镜头
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              填入后只会在尾部保留一个新的空分镜槽
                            </p>
                            <Button
                              className="mt-3"
                              variant="outline"
                              size="sm"
                              disabled={!selectedFileId}
                              onClick={() => assignToMain(sceneIndex)}
                            >
                              <MousePointer2 /> 设为主镜头
                            </Button>
                          </div>
                        </div>
                      )}
                    </section>

                    <section
                      className={`min-h-44 bg-emerald-50/70 p-4 transition ${
                        dropTarget === supplementTarget
                          ? 'bg-emerald-100 ring-4 ring-inset ring-emerald-500/15'
                          : ''
                      }`}
                      aria-label={`${currentEpisode}-${sceneIndex + 1} 补镜头投放区`}
                      onDragEnter={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (event.dataTransfer.types.includes(DRAG_TYPE)) {
                          setDropTarget(supplementTarget);
                        }
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (event.dataTransfer.types.includes(DRAG_TYPE)) {
                          event.dataTransfer.dropEffect = 'move';
                        } else {
                          event.dataTransfer.dropEffect = 'none';
                        }
                      }}
                      onDragLeave={(event) => {
                        event.stopPropagation();
                        if (!sameDragSurface(event)) setDropTarget(null);
                      }}
                      onDrop={(event) =>
                        handleInternalDrop(event, 'supplement', sceneIndex)
                      }
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="grid size-8 place-items-center rounded-lg bg-emerald-700 text-sm font-bold text-white">
                            补
                          </span>
                          <div>
                            <h3 className="text-sm font-bold text-emerald-950">
                              补充材料槽
                            </h3>
                            <p className="text-xs text-emerald-700">
                              归属于 {currentEpisode}-{sceneIndex + 1}，可放多个
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={!selectedFileId}
                          onClick={() => assignToSupplement(sceneIndex)}
                        >
                          <Plus /> 加入已选
                        </Button>
                      </div>

                      {scene.supplementalIds.length === 0 ? (
                        <div className="mt-4 grid min-h-24 place-items-center rounded-xl border border-dashed border-emerald-300 bg-white/75 px-4 text-center">
                          <div>
                            <p className="text-sm font-medium text-slate-700">
                              拖入补充材料或补拍镜头
                            </p>
                            <p className="mt-1 font-mono text-xs text-emerald-800">
                              {currentEpisode}-{sceneIndex + 1}_补镜头_01.ext
                            </p>
                          </div>
                        </div>
                      ) : (
                        <ol className="mt-3 space-y-2">
                          {scene.supplementalIds.map(
                            (fileId, supplementIndex) => {
                              const asset = assetById.get(fileId);
                              if (!asset) return null;
                              return (
                                <li
                                  key={fileId}
                                  className="grid grid-cols-[auto_3.5rem_minmax(0,1fr)] items-start gap-2 rounded-lg border border-emerald-200 bg-white/90 p-2 shadow-sm"
                                  draggable
                                  onDragStart={(event) => {
                                    event.dataTransfer.setData(
                                      DRAG_TYPE,
                                      fileId,
                                    );
                                    event.dataTransfer.effectAllowed = 'move';
                                  }}
                                >
                                  <div className="flex flex-col items-center gap-1">
                                    <GripVertical className="size-4 text-emerald-500" />
                                    <span className="grid size-7 place-items-center rounded-md bg-emerald-700 font-mono text-xs font-bold text-white">
                                      {String(supplementIndex + 1).padStart(
                                        2,
                                        '0',
                                      )}
                                    </span>
                                  </div>
                                  <div className="size-14 overflow-hidden rounded-md border border-emerald-200 bg-slate-950">
                                    <HoverPreviewVideo
                                      asset={asset}
                                      onDuration={updateDuration}
                                      className="h-full w-full object-cover"
                                      label={`${asset.name} 补镜头预览`}
                                    />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1">
                                      <p
                                        className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-900"
                                        title={asset.name}
                                      >
                                        {asset.name}
                                      </p>
                                      {!asset.file && (
                                        <CircleAlert className="size-4 shrink-0 text-rose-600" />
                                      )}
                                    </div>
                                    <Input
                                      className="mt-1 h-7 w-full min-w-0 bg-white text-xs"
                                      maxLength={PROJECT_NOTE_MAX_LENGTH}
                                      value={
                                        scene.supplementalNotes?.[fileId] ?? ''
                                      }
                                      placeholder="备注：需要哪个镜头/内容"
                                      aria-label={`${asset.name} 补镜头备注`}
                                      onChange={(event) =>
                                        updateSupplementNote(
                                          sceneIndex,
                                          fileId,
                                          event.target.value,
                                        )
                                      }
                                      onClick={(event) =>
                                        event.stopPropagation()
                                      }
                                    />
                                    <p
                                      className="truncate font-mono text-[11px] text-emerald-800"
                                      title="备注已清洗后的最终导出名"
                                    >
                                      清洗后：
                                      {makeExportName({
                                        episode: currentEpisode,
                                        scene: sceneIndex + 1,
                                        kind: 'supplement',
                                        supplementalIndex: supplementIndex,
                                        originalName: asset.name,
                                        note:
                                          scene.supplementalNotes?.[fileId] ??
                                          '',
                                      })}
                                    </p>
                                    <p
                                      className="mt-0.5 truncate text-[11px] text-slate-500"
                                      title="浏览器可读取的文件最后修改时间"
                                    >
                                      文件时间：
                                      {formatFileTime(asset.lastModified)}
                                    </p>
                                  </div>
                                  <div className="col-span-3 flex items-center justify-end gap-0.5 border-t border-emerald-100 pt-1">
                                    <Button
                                      variant="ghost"
                                      size="icon-xs"
                                      aria-label={`将 ${asset.name} 上移`}
                                      disabled={supplementIndex === 0}
                                      onClick={() =>
                                        setArrangement((current) =>
                                          reorderSupplement(
                                            current,
                                            sceneIndex,
                                            supplementIndex,
                                            supplementIndex - 1,
                                          ),
                                        )
                                      }
                                    >
                                      <ArrowUp />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon-xs"
                                      aria-label={`将 ${asset.name} 下移`}
                                      disabled={
                                        supplementIndex ===
                                        scene.supplementalIds.length - 1
                                      }
                                      onClick={() =>
                                        setArrangement((current) =>
                                          reorderSupplement(
                                            current,
                                            sceneIndex,
                                            supplementIndex,
                                            supplementIndex + 1,
                                          ),
                                        )
                                      }
                                    >
                                      <ArrowDown />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon-xs"
                                      aria-label={`将 ${asset.name} 移回总池`}
                                      onClick={() => unassign(fileId)}
                                    >
                                      <X />
                                    </Button>
                                  </div>
                                </li>
                              );
                            },
                          )}
                        </ol>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-emerald-300 bg-white/70 px-3 py-2">
                        <span className="text-xs text-emerald-900">
                          还要加入补镜头？继续拖入此区域，或先在总池选中素材。
                        </span>
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={!selectedFileId}
                          onClick={() => assignToSupplement(sceneIndex)}
                        >
                          <Plus /> 继续加入
                        </Button>
                      </div>
                    </section>
                  </article>
                );
              })}
            </div>
          </section>
        </div>

        <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="flex min-w-0 items-start gap-3">
              <div
                className={`grid size-10 shrink-0 place-items-center rounded-xl ${
                  exportState.status === 'success'
                    ? 'bg-emerald-100 text-emerald-700'
                    : exportState.status === 'error'
                      ? 'bg-rose-100 text-rose-700'
                      : 'bg-slate-100 text-slate-600'
                }`}
              >
                {exportState.status === 'running' ||
                exportState.status === 'preparing' ? (
                  <LoaderCircle className="size-5 animate-spin" />
                ) : exportState.status === 'success' ? (
                  <CheckCircle2 className="size-5" />
                ) : (
                  <PackageCheck className="size-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h2 className="text-sm font-semibold text-slate-950">
                    {exportState.status === 'idle'
                      ? '准备导出'
                      : exportState.label}
                  </h2>
                  <span className="text-xs text-slate-500">
                    {counts.main} 主镜头 · {counts.supplement} 补镜头 ·{' '}
                    {formatBytes(
                      exportEntries.reduce((sum, entry) => sum + entry.size, 0),
                    )}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {exportState.status === 'idle'
                    ? '导出根目录包含按分镜槽命名的视频，以及 manifest.json 与 manifest.csv；未分配素材不会导出。'
                    : exportState.message}
                </p>
                {exportState.status !== 'idle' && (
                  <Progress
                    className="mt-3 max-w-2xl"
                    value={exportState.progress}
                  >
                    <ProgressLabel className="sr-only">导出进度</ProgressLabel>
                    <span className="ml-auto text-sm tabular-nums text-slate-500">
                      {Math.round(exportState.progress)}%
                    </span>
                  </Progress>
                )}
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              {(exportState.status === 'running' ||
                exportState.status === 'preparing') && (
                <Button
                  variant="destructive"
                  onClick={() => abortExportRef.current?.abort()}
                >
                  <X /> 取消导出
                </Button>
              )}
              <Button
                variant="outline"
                disabled={
                  !supportsFolderExport || exportState.status === 'running'
                }
                onClick={exportFolder}
              >
                <FolderOpen />
                {supportsFolderExport ? '逐文件导出' : '文件夹导出不受支持'}
              </Button>
              <Button
                disabled={exportState.status === 'running'}
                onClick={exportZip}
              >
                <FileArchive /> ZIP 下载
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-[11px] text-slate-500">
            <span>
              ZIP 超过 {formatBytes(ZIP_WARNING_BYTES)} 会提示，超过{' '}
              {formatBytes(ZIP_LIMIT_BYTES)} 将阻止并建议逐文件导出
            </span>
            <span>版本 0.1 · 作者 sk0l · MIT</span>
          </div>
        </section>
      </div>

      {notice && (
        <output
          className={`fixed bottom-5 left-1/2 z-50 flex w-[min(92vw,520px)] -translate-x-1/2 items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-[0_18px_55px_rgb(15_23_42/22%)] ${
            notice.tone === 'success'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
              : notice.tone === 'warning'
                ? 'border-amber-300 bg-amber-50 text-amber-950'
                : 'border-slate-300 bg-white text-slate-800'
          }`}
          aria-live="polite"
          aria-atomic="true"
        >
          {notice.tone === 'success' ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          ) : notice.tone === 'warning' ? (
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
          ) : (
            <Check className="mt-0.5 size-4 shrink-0" />
          )}
          <span className="flex-1">{notice.message}</span>
          <button
            type="button"
            className="rounded p-0.5 opacity-60 hover:opacity-100 focus-visible:outline focus-visible:outline-2"
            aria-label="关闭提示"
            onClick={() => setNotice(null)}
          >
            <X className="size-4" />
          </button>
        </output>
      )}
    </main>
  );
}
