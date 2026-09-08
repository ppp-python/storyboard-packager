/**
 * Pure storyboard slot and export-name helpers.
 *
 * A project has one ordered list of storyboard slots. The episode value is a
 * naming prefix only; changing it must never create another arrangement or
 * move an assigned file. Video File objects deliberately stay outside this
 * model so it can be persisted and tested without serialising video contents.
 */

export const MAX_EPISODE = 9999;
export const MAX_NOTE_LENGTH = 64;

export function canonicalEpisode(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < 1 || number > MAX_EPISODE) {
    return null;
  }
  return String(number);
}

export function emptyScene() {
  return { mainId: null, supplementalIds: [] };
}

export function createArrangement() {
  // 公开镜头资产概念参考 ShotBase/ShotBuddy；槽位与命名逻辑为本项目独立实现。
  return { scenes: [emptyScene()] };
}

function normaliseScene(scene) {
  const mainId = typeof scene?.mainId === 'string' ? scene.mainId : null;
  const supplementalIds = [];
  const seen = new Set(mainId ? [mainId] : []);
  for (const value of Array.isArray(scene?.supplementalIds)
    ? scene.supplementalIds
    : []) {
    if (typeof value === 'string' && !seen.has(value)) {
      seen.add(value);
      supplementalIds.push(value);
    }
  }

  const noteSource = scene?.supplementalNotes;
  const supplementalNotes = {};
  for (const id of supplementalIds) {
    let value;
    if (Array.isArray(noteSource))
      value = noteSource[supplementalIds.indexOf(id)];
    else if (noteSource && typeof noteSource === 'object')
      value = noteSource[id];
    if (value != null && String(value).length > 0)
      supplementalNotes[id] = String(value);
  }

  const result = { mainId, supplementalIds };
  if (Object.keys(supplementalNotes).length > 0) {
    result.supplementalNotes = supplementalNotes;
  }
  return result;
}

export function normaliseScenes(input) {
  const scenes = Array.isArray(input) ? input.map(normaliseScene) : [];
  let lastUsedIndex = -1;
  scenes.forEach((scene, index) => {
    if (scene.mainId || scene.supplementalIds.length > 0) lastUsedIndex = index;
  });

  const usedPrefix =
    lastUsedIndex >= 0 ? scenes.slice(0, lastUsedIndex + 1) : [];
  return [...usedPrefix, emptyScene()];
}

function legacyEpisodeScenes(input) {
  return Object.entries(input?.episodes ?? {})
    .sort(([a], [b]) => Number(a) - Number(b))
    .flatMap(([, data]) => {
      const scenes = normaliseScenes(data?.scenes);
      return scenes.length > 1 ? scenes.slice(0, -1) : [];
    });
}

function rawScenes(input) {
  if (Array.isArray(input?.scenes)) return input.scenes;
  return legacyEpisodeScenes(input);
}

export function getScenes(arrangement) {
  return normaliseScenes(rawScenes(arrangement));
}

/** Backward-compatible alias for integrations written against the old model. */
export function getEpisodeScenes(arrangement) {
  return getScenes(arrangement);
}

/** Validate the prefix without creating a second arrangement. */
export function ensureEpisode(arrangement, episodeValue) {
  if (!canonicalEpisode(episodeValue)) {
    throw new Error('集号必须是 1–9999 的整数');
  }
  return sanitiseArrangement(arrangement);
}

function updateScenes(arrangement, updater) {
  const scenes = getScenes(arrangement).map(normaliseScene);
  const nextScenes = normaliseScenes(updater(scenes));
  return { scenes: nextScenes };
}

function parseSceneFileArgs(args) {
  if (args.length === 2) return { sceneIndex: args[0], fileId: args[1] };
  return { sceneIndex: args[1], fileId: args[2] };
}

function supplementNote(arrangement, fileId) {
  for (const scene of getScenes(arrangement)) {
    if (scene.supplementalIds.includes(fileId)) {
      return scene.supplementalNotes?.[fileId] ?? '';
    }
  }
  return '';
}

export function removeFileFromArrangement(arrangement, fileId) {
  return updateScenes(arrangement, (scenes) =>
    scenes.map((scene) => {
      const nextNotes = { ...scene.supplementalNotes };
      delete nextNotes[fileId];
      const next = {
        mainId: scene.mainId === fileId ? null : scene.mainId,
        supplementalIds: scene.supplementalIds.filter((id) => id !== fileId),
      };
      if (Object.keys(nextNotes).length > 0) next.supplementalNotes = nextNotes;
      return next;
    }),
  );
}

/** Supports both assignMain(arrangement, slotIndex, fileId) and the old
 * assignMain(arrangement, episode, slotIndex, fileId) call shape. */
export function assignMain(arrangement, ...args) {
  const { sceneIndex, fileId } = parseSceneFileArgs(args);
  if (!fileId) throw new Error('缺少视频标识');
  if (!Number.isInteger(sceneIndex) || sceneIndex < 0) {
    throw new Error('目标主分镜无效');
  }

  // Removing the incoming file first makes moving between any main or
  // supplemental slot atomic. Writing the target then replaces its previous
  // main file, which becomes unassigned and immediately returns to the pool.
  const stripped = removeFileFromArrangement(arrangement, fileId);
  return updateScenes(stripped, (scenes) => {
    while (scenes.length <= sceneIndex) scenes.push(emptyScene());
    scenes[sceneIndex] = { ...scenes[sceneIndex], mainId: fileId };
    return scenes;
  });
}

/** Supports both assignSupplement(arrangement, slotIndex, fileId) and the old
 * assignSupplement(arrangement, episode, slotIndex, fileId) call shape. */
export function assignSupplement(arrangement, ...args) {
  const { sceneIndex, fileId } = parseSceneFileArgs(args);
  if (!fileId) throw new Error('缺少视频标识');
  if (!Number.isInteger(sceneIndex) || sceneIndex < 0) {
    throw new Error('目标补镜头区域无效');
  }
  const note = supplementNote(arrangement, fileId);
  const stripped = removeFileFromArrangement(arrangement, fileId);
  return updateScenes(stripped, (scenes) => {
    while (scenes.length <= sceneIndex) scenes.push(emptyScene());
    const next = {
      ...scenes[sceneIndex],
      supplementalIds: [...scenes[sceneIndex].supplementalIds, fileId],
    };
    if (note)
      next.supplementalNotes = { ...next.supplementalNotes, [fileId]: note };
    scenes[sceneIndex] = next;
    return scenes;
  });
}

export function setSupplementNote(arrangement, sceneIndex, fileId, note) {
  if (!Number.isInteger(sceneIndex) || sceneIndex < 0 || !fileId) {
    throw new Error('补镜头备注目标无效');
  }
  return updateScenes(arrangement, (scenes) => {
    const scene = scenes[sceneIndex];
    if (!scene || !scene.supplementalIds.includes(fileId)) {
      throw new Error('补镜头备注目标无效');
    }
    const notes = { ...scene.supplementalNotes };
    if (String(note ?? '').length > 0) notes[fileId] = String(note);
    else delete notes[fileId];
    const next = { ...scene };
    if (Object.keys(notes).length > 0) next.supplementalNotes = notes;
    else delete next.supplementalNotes;
    scenes[sceneIndex] = next;
    return scenes;
  });
}

/** Supports both reorderSupplement(arrangement, slot, from, to) and the old
 * reorderSupplement(arrangement, episode, slot, from, to) call shape. */
export function reorderSupplement(arrangement, ...args) {
  const offset = args.length === 3 ? 0 : 1;
  const sceneIndex = args[offset];
  const fromIndex = args[offset + 1];
  const toIndex = args[offset + 2];
  if (!Number.isInteger(sceneIndex) || sceneIndex < 0) {
    throw new Error('目标补镜头区域无效');
  }
  return updateScenes(arrangement, (scenes) => {
    const scene = scenes[sceneIndex];
    if (!scene) throw new Error('目标补镜头区域无效');
    const ids = [...scene.supplementalIds];
    if (
      !Number.isInteger(fromIndex) ||
      !Number.isInteger(toIndex) ||
      fromIndex < 0 ||
      fromIndex >= ids.length ||
      toIndex < 0 ||
      toIndex >= ids.length
    ) {
      throw new Error('补镜头排序位置无效');
    }
    const [moved] = ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, moved);
    scenes[sceneIndex] = { ...scene, supplementalIds: ids };
    return scenes;
  });
}

export function findAssignment(arrangement, fileId, episodeValue = '1') {
  const episode = canonicalEpisode(episodeValue) ?? '1';
  const scenes = getScenes(arrangement);
  for (let index = 0; index < scenes.length; index += 1) {
    if (scenes[index].mainId === fileId) {
      return { kind: 'main', episode, scene: index + 1, index: 0 };
    }
    const supplementIndex = scenes[index].supplementalIds.indexOf(fileId);
    if (supplementIndex >= 0) {
      return {
        kind: 'supplement',
        episode,
        scene: index + 1,
        index: supplementIndex,
      };
    }
  }
  return null;
}

export function extensionOf(fileName) {
  const base =
    String(fileName ?? '')
      .split(/[\\/]/)
      .pop() ?? '';
  const index = base.lastIndexOf('.');
  return index > 0 && index < base.length - 1 ? base.slice(index) : '';
}

/** Make a Windows/macOS-safe note segment for an exported file name. */
export function sanitiseFilePart(value, maxLength = MAX_NOTE_LENGTH) {
  const text = String(value ?? '')
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, '_')
    .trim()
    .replace(/[. ]+$/g, '');
  if (!text) return '';
  const limited = text.slice(0, Math.max(1, maxLength)).replace(/[. ]+$/g, '');
  return limited;
}

export function makeExportName({
  episode,
  scene,
  kind,
  supplementalIndex = 0,
  originalName,
  note = '',
}) {
  const extension = extensionOf(originalName);
  const stem = `${episode}-${scene}`;
  if (kind === 'main') return `${stem}${extension}`;
  const cleanNote = sanitiseFilePart(note);
  const noteSuffix = cleanNote ? `_${cleanNote}` : '';
  return `${stem}_补镜头_${String(supplementalIndex + 1).padStart(2, '0')}${noteSuffix}${extension}`;
}

export function buildExportEntries(arrangement, assets, episodeValue = '1') {
  const episode = canonicalEpisode(episodeValue);
  if (!episode) throw new Error('集号必须是 1–9999 的整数');
  const assetMap =
    assets instanceof Map
      ? assets
      : new Map(assets.map((asset) => [asset.id, asset]));
  const result = [];
  const scenes = getScenes(arrangement);

  scenes.forEach((scene, sceneIndex) => {
    if (scene.mainId) {
      const asset = assetMap.get(scene.mainId);
      if (asset) {
        const exportName = makeExportName({
          episode,
          scene: sceneIndex + 1,
          kind: 'main',
          originalName: asset.name,
        });
        result.push({
          fileId: scene.mainId,
          originalName: asset.name,
          exportName,
          path: exportName,
          kind: 'main',
          episode,
          scene: sceneIndex + 1,
          supplementalIndex: null,
          note: '',
          sanitisedNote: '',
          size: asset.size,
          relativePath: asset.relativePath ?? '',
        });
      }
    }

    scene.supplementalIds.forEach((fileId, supplementalIndex) => {
      const asset = assetMap.get(fileId);
      if (!asset) return;
      const note = scene.supplementalNotes?.[fileId] ?? '';
      const sanitisedNote = sanitiseFilePart(note);
      const exportName = makeExportName({
        episode,
        scene: sceneIndex + 1,
        kind: 'supplement',
        supplementalIndex,
        originalName: asset.name,
        note,
      });
      result.push({
        fileId,
        originalName: asset.name,
        exportName,
        path: exportName,
        kind: 'supplement',
        episode,
        scene: sceneIndex + 1,
        supplementalIndex: supplementalIndex + 1,
        note,
        sanitisedNote,
        size: asset.size,
        relativePath: asset.relativePath ?? '',
      });
    });
  });
  return result;
}

export function detectExportConflicts(entries) {
  const byPath = new Map();
  const conflicts = [];
  for (const entry of entries) {
    const key = entry.path.normalize('NFC').toLocaleLowerCase('zh-CN');
    const previous = byPath.get(key);
    if (previous) conflicts.push([previous, entry]);
    else byPath.set(key, entry);
  }
  return conflicts;
}

export function sanitiseArrangement(input) {
  const source = rawScenes(input);
  const globallyUsed = new Set();
  const scenes = normaliseScenes(source).map((scene) => {
    let mainId = scene.mainId;
    if (mainId && globallyUsed.has(mainId)) mainId = null;
    if (mainId) globallyUsed.add(mainId);
    const supplementalIds = scene.supplementalIds.filter((id) => {
      if (globallyUsed.has(id)) return false;
      globallyUsed.add(id);
      return true;
    });
    const supplementalNotes = {};
    for (const id of supplementalIds) {
      const note = scene.supplementalNotes?.[id];
      if (note) supplementalNotes[id] = note;
    }
    const next = { mainId, supplementalIds };
    if (Object.keys(supplementalNotes).length > 0)
      next.supplementalNotes = supplementalNotes;
    return next;
  });
  return { scenes: normaliseScenes(scenes) };
}

export function arrangementCounts(arrangement, assets = []) {
  let main = 0;
  let supplement = 0;
  for (const scene of getScenes(arrangement)) {
    if (scene.mainId) main += 1;
    supplement += scene.supplementalIds.length;
  }
  const assigned = main + supplement;
  return {
    main,
    supplement,
    assigned,
    total: assets.length,
    unassigned: Math.max(0, assets.length - assigned),
  };
}

/**
 * Human-readable location shown on an assigned card in the pool.
 * Keeping this here makes the wording consistent and independently testable.
 */
export function describeAssignment(assignment) {
  if (!assignment) return '未编排';
  const slot = `${assignment.episode}-${assignment.scene}`;
  return assignment.kind === 'main'
    ? `已放入 ${slot} 主镜头`
    : `已放入 ${slot} 补镜头 ${String(assignment.index + 1).padStart(2, '0')}`;
}

/**
 * Build the visible pool without mutating the asset collection. Assigned
 * assets remain available to history/export and reappear immediately when
 * removed from a slot; they are only hidden from the default pool view.
 */
export function buildPoolAssetView(
  arrangement,
  assets = [],
  {
    episode = '1',
    query = '',
    showAssigned = false,
    sortBy = 'lastModified',
  } = {},
) {
  const assignmentById = new Map(
    assets.map((asset) => [
      asset.id,
      findAssignment(arrangement, asset.id, episode),
    ]),
  );
  const assignedCount = assets.reduce(
    (total, asset) => total + (assignmentById.get(asset.id) ? 1 : 0),
    0,
  );
  const needle = String(query).trim().toLocaleLowerCase('zh-CN');
  const visibleAssets = assets.filter((asset) => {
    if (!showAssigned && assignmentById.get(asset.id)) return false;
    return `${asset.name ?? ''} ${asset.relativePath ?? ''}`
      .toLocaleLowerCase('zh-CN')
      .includes(needle);
  });

  visibleAssets.sort((a, b) => {
    if (sortBy === 'name') {
      return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'zh-CN');
    }
    if (sortBy === 'size') return Number(b.size ?? 0) - Number(a.size ?? 0);
    if (sortBy === 'status') {
      const aStatus = assignmentById.get(a.id) ? 1 : 0;
      const bStatus = assignmentById.get(b.id) ? 1 : 0;
      return (
        aStatus - bStatus ||
        Number(a.lastModified ?? 0) - Number(b.lastModified ?? 0) ||
        Number(a.addedAt ?? 0) - Number(b.addedAt ?? 0)
      );
    }
    const multiplier = sortBy === 'lastModifiedDesc' ? -1 : 1;
    return (
      multiplier *
        (Number(a.lastModified ?? 0) - Number(b.lastModified ?? 0)) ||
      multiplier * (Number(a.addedAt ?? 0) - Number(b.addedAt ?? 0)) ||
      String(a.name ?? '').localeCompare(String(b.name ?? ''), 'zh-CN')
    );
  });

  return {
    assets: visibleAssets,
    assignmentById,
    assignedCount,
    unassignedCount: Math.max(0, assets.length - assignedCount),
  };
}

export function sortAssetsByLastModified(assets, direction = 'asc') {
  const multiplier = direction === 'desc' ? -1 : 1;
  return [...assets].sort(
    (a, b) =>
      multiplier *
        (Number(a.lastModified ?? 0) - Number(b.lastModified ?? 0)) ||
      multiplier * (Number(a.addedAt ?? 0) - Number(b.addedAt ?? 0)) ||
      String(a.name ?? '').localeCompare(String(b.name ?? ''), 'zh-CN'),
  );
}

function normaliseRelinkPath(value) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .normalize('NFC')
    .toLocaleLowerCase('zh-CN');
}

/**
 * Find the one missing historical asset represented by a newly selected file.
 * Prefer an exact path match. If a browser only returns the base file name,
 * fall back to name + size + lastModified only when that identity is unique.
 */
export function findAssetRelinkIndex(assets, candidate) {
  const candidateName = String(candidate?.name ?? '')
    .normalize('NFC')
    .toLocaleLowerCase('zh-CN');
  const candidatePath = normaliseRelinkPath(candidate?.relativePath);
  const candidateSize = Number(candidate?.size ?? -1);
  const candidateModified = Number(candidate?.lastModified ?? -1);

  const matches = assets
    .map((asset, index) => ({ asset, index }))
    .filter(({ asset }) => {
      if (asset?.file) return false;
      return (
        String(asset?.name ?? '')
          .normalize('NFC')
          .toLocaleLowerCase('zh-CN') === candidateName &&
        Number(asset?.size ?? -2) === candidateSize &&
        Number(asset?.lastModified ?? -2) === candidateModified
      );
    });

  const exactPath = matches.find(
    ({ asset }) => normaliseRelinkPath(asset.relativePath) === candidatePath,
  );
  if (exactPath) return exactPath.index;
  return matches.length === 1 ? matches[0].index : -1;
}
