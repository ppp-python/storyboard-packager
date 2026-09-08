export const HISTORY_DB_NAME = 'storyboard-packager-history';
export const HISTORY_STORE_NAME = 'projects';
export const HISTORY_FILE_STORE_NAME = 'files';
export const HISTORY_LIMIT = 20;

export function resolveStartupMode(search) {
  return new URLSearchParams(String(search ?? '')).get('startup') === 'resume'
    ? 'resume'
    : 'new';
}

export function shouldAutosaveProject(isBoundToHistory, assetCount) {
  return Boolean(isBoundToHistory || Number(assetCount) > 0);
}

export function trimHistoryRecords(records, limit = HISTORY_LIMIT) {
  const sorted = [...records].sort(
    (a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0),
  );
  return {
    keep: sorted.slice(0, limit),
    remove: sorted.slice(limit),
  };
}

export function collectReferencedFingerprints(records) {
  return new Set(
    (records ?? []).flatMap((record) =>
      Array.isArray(record?.assets)
        ? record.assets.map((asset) => asset?.fingerprint).filter(Boolean)
        : [],
    ),
  );
}

/** Mirrors IndexedDB.put semantics for the in-memory history list. */
export function upsertHistoryRecords(
  records,
  snapshot,
  limit = HISTORY_LIMIT,
) {
  const withoutSameProject = (records ?? []).filter(
    (record) => record?.id !== snapshot?.id,
  );
  return trimHistoryRecords([snapshot, ...withoutSameProject], limit).keep;
}

function metadataOnlyAsset(asset) {
  const { file: _file, url: _url, handle: _handle, ...metadata } = asset ?? {};
  return metadata;
}

export function snapshotForJson(snapshot) {
  return {
    schemaVersion: 2,
    id: String(snapshot?.id ?? ''),
    name: String(snapshot?.name ?? '未命名编排'),
    episode: String(snapshot?.episode ?? '1'),
    sortBy: String(snapshot?.sortBy ?? 'lastModified'),
    arrangement: snapshot?.arrangement ?? {
      scenes: [{ mainId: null, supplementalIds: [] }],
    },
    assets: Array.isArray(snapshot?.assets)
      ? snapshot.assets.map(metadataOnlyAsset)
      : [],
    createdAt: Number(snapshot?.createdAt ?? Date.now()),
    updatedAt: Number(snapshot?.updatedAt ?? Date.now()),
  };
}

export function makeProjectSnapshot({
  id,
  name,
  episode,
  sortBy = 'lastModified',
  arrangement,
  assets,
  directoryHandle,
  createdAt = Date.now(),
  updatedAt = Date.now(),
}) {
  return {
    ...snapshotForJson({
      id,
      name,
      episode,
      sortBy,
      arrangement,
      assets,
      createdAt,
      updatedAt,
    }),
    directoryHandle: directoryHandle ?? undefined,
    assets: (assets ?? []).map((asset) => {
      const metadata = metadataOnlyAsset(asset);
      metadata.handleStatus = asset?.handle ? 'saved' : 'none';
      if (asset?.handle) metadata.handle = asset.handle;
      return metadata;
    }),
  };
}

export function comparableSnapshot(snapshot) {
  const clean = snapshotForJson(snapshot);
  return JSON.stringify({
    episode: clean.episode,
    sortBy: clean.sortBy,
    arrangement: clean.arrangement,
    assets: clean.assets,
  });
}

export function historyIndexedDbAvailable() {
  return typeof indexedDB !== 'undefined';
}

function openDatabase() {
  if (!historyIndexedDbAvailable())
    return Promise.reject(new Error('IndexedDB unavailable'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HISTORY_DB_NAME, 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(HISTORY_STORE_NAME)) {
        database.createObjectStore(HISTORY_STORE_NAME, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(HISTORY_FILE_STORE_NAME)) {
        database.createObjectStore(HISTORY_FILE_STORE_NAME, {
          keyPath: 'fingerprint',
        });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

export async function loadCachedProjectFiles(assets) {
  const fingerprints = [
    ...new Set(
      (assets ?? []).map((asset) => asset?.fingerprint).filter(Boolean),
    ),
  ];
  if (fingerprints.length === 0) return new Map();

  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const files = new Map();
      const transaction = database.transaction(
        HISTORY_FILE_STORE_NAME,
        'readonly',
      );
      const store = transaction.objectStore(HISTORY_FILE_STORE_NAME);
      for (const fingerprint of fingerprints) {
        const request = store.get(fingerprint);
        request.onsuccess = () => {
          if (request.result?.file) files.set(fingerprint, request.result.file);
        };
      }
      transaction.oncomplete = () => resolve(files);
      transaction.onerror = () =>
        reject(
          transaction.error ?? new Error('IndexedDB file cache read failed'),
        );
      transaction.onabort = () =>
        reject(
          transaction.error ?? new Error('IndexedDB file cache read aborted'),
        );
    });
  } finally {
    database.close();
  }
}

function readAll(database) {
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(HISTORY_STORE_NAME, 'readonly')
      .objectStore(HISTORY_STORE_NAME)
      .getAll();
    request.onsuccess = () => {
      const rows = Array.isArray(request.result) ? request.result : [];
      rows.sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0));
      resolve(rows);
    };
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB read failed'));
  });
}

/** Metadata and Blob changes share one transaction across both stores. */
function mutateHistory(database, mutation) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      [HISTORY_STORE_NAME, HISTORY_FILE_STORE_NAME], 'readwrite',
    );
    const projects = transaction.objectStore(HISTORY_STORE_NAME);
    const files = transaction.objectStore(HISTORY_FILE_STORE_NAME);
    let removed = 0;
    transaction.oncomplete = () => resolve(removed);
    transaction.onerror = () => reject(transaction.error ?? new Error('历史写入失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('历史写入已取消'));
    try {
      if (mutation.clear) {
        projects.clear();
        files.clear();
        return;
      }
      if (mutation.snapshot) projects.put(mutation.snapshot);
      if (mutation.deleteId != null) projects.delete(mutation.deleteId);
      for (const asset of mutation.assets ?? []) {
        if (!asset?.file || !asset.fingerprint) continue;
        const key = files.getKey(asset.fingerprint);
        key.onsuccess = () => {
          if (key.result === undefined) files.put({
            fingerprint: asset.fingerprint,
            file: asset.file,
            name: asset.name,
            size: asset.size,
            lastModified: asset.lastModified,
          });
        };
      }
      const request = projects.getAll();
      request.onsuccess = () => {
        const {keep, remove} = trimHistoryRecords(request.result);
        for (const row of remove) projects.delete(row.id);
        const referenced = collectReferencedFingerprints(keep);
        const cursorRequest = files.openKeyCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          if (!referenced.has(cursor.key)) {
            files.delete(cursor.key);
            removed += 1;
          }
          cursor.continue();
        };
      };
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}

export async function garbageCollectProjectFileCache() {
  const database = await openDatabase();
  try { return await mutateHistory(database, {}); }
  finally { database.close(); }
}

export async function listProjectHistory() {
  const database = await openDatabase();
  try { return (await readAll(database)).slice(0, HISTORY_LIMIT); }
  finally { database.close(); }
}

export async function saveProjectHistory(snapshot, assets = []) {
  const database = await openDatabase();
  try {
    try { await mutateHistory(database, {snapshot, assets}); }
    catch (error) {
      if (error?.name !== 'DataCloneError') throw error;
      await mutateHistory(database, {snapshot: snapshotForJson(snapshot), assets});
    }
  } finally { database.close(); }
}

export async function deleteProjectHistory(id) {
  const database = await openDatabase();
  try { await mutateHistory(database, {deleteId: id}); }
  finally { database.close(); }
}

export async function clearProjectHistory() {
  const database = await openDatabase();
  try { await mutateHistory(database, {clear: true}); }
  finally { database.close(); }
}
