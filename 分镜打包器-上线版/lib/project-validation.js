import { canonicalEpisode, sanitiseArrangement } from './storyboard.js';

export const PROJECT_JSON_MAX_BYTES = 4 * 1024 * 1024;
export const PROJECT_JSON_MAX_DEPTH = 32;
const MAX_DATE_VALUE = 8_640_000_000_000_000;
export const PROJECT_NAME_MAX_LENGTH = 120;
export const PROJECT_NOTE_MAX_LENGTH = 200;
export const PROJECT_ASSET_MAX_COUNT = 5000;
export const PROJECT_SCENE_MAX_COUNT = 5000;
export const PROJECT_PATH_MAX_LENGTH = 2048;
export const PROJECT_ID_MAX_LENGTH = 160;
export const IMPORT_MAX_FILES = 5000;
export const IMPORT_MAX_DEPTH = 16;
export const IMPORT_MAX_TOTAL_BYTES = 100 * 1024 * 1024 * 1024;

const SORT_VALUES = new Set([
  'lastModified',
  'lastModifiedDesc',
  'name',
  'size',
  'status',
]);

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function boundedString(value, label, maxLength, { required = true } = {}) {
  if (typeof value !== 'string') {
    if (!required && (value == null || value === '')) return '';
    throw new Error(`${label}必须是文本`);
  }
  if (required && value.length === 0) throw new Error(`${label}不能为空`);
  if (value.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符`);
  return value;
}

function finiteInteger(value, label, { max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new Error(`${label}不是有效的非负整数`);
  }
  return value;
}

function validateAsset(raw, index) {
  if (!isRecord(raw)) throw new Error(`第 ${index + 1} 个素材字段无效`);
  const id = boundedString(raw.id, `第 ${index + 1} 个素材 ID`, PROJECT_ID_MAX_LENGTH);
  const name = boundedString(raw.name, `素材 ${id} 文件名`, 255);
  const fingerprint = boundedString(
    raw.fingerprint,
    `素材 ${id} 指纹`,
    PROJECT_PATH_MAX_LENGTH,
  );
  const type = boundedString(raw.type, `素材 ${id} 类型`, 128, {
    required: false,
  });
  const relativePath = boundedString(
    raw.relativePath,
    `素材 ${id} 相对路径`,
    PROJECT_PATH_MAX_LENGTH,
    { required: false },
  );
  const size = finiteInteger(raw.size, `素材 ${id} 大小`);
  const lastModified = finiteInteger(raw.lastModified, `素材 ${id} 文件时间`, {max: MAX_DATE_VALUE});
  const addedAt = finiteInteger(raw.addedAt, `素材 ${id} 加入时间`, {max: MAX_DATE_VALUE});
  if (relativePath) validateImportPath(relativePath);
  const duration =
    raw.duration == null
      ? null
      : typeof raw.duration === 'number' &&
          Number.isFinite(raw.duration) &&
          raw.duration >= 0
        ? raw.duration
        : (() => {
            throw new Error(`素材 ${id} 时长无效`);
          })();
  return {
    id,
    fingerprint,
    name,
    size,
    type,
    lastModified,
    relativePath,
    duration,
    addedAt,
  };
}

function validateArrangement(raw, assetIds) {
  if (!isRecord(raw) || !Array.isArray(raw.scenes)) {
    throw new Error('工程分镜槽字段无效');
  }
  if (raw.scenes.length < 1 || raw.scenes.length > PROJECT_SCENE_MAX_COUNT) {
    throw new Error(`分镜槽数量必须在 1–${PROJECT_SCENE_MAX_COUNT} 之间`);
  }
  const assigned = new Set();
  const scenes = raw.scenes.map((scene, sceneIndex) => {
    if (!isRecord(scene)) throw new Error(`第 ${sceneIndex + 1} 个分镜槽无效`);
    const mainId = scene.mainId == null ? null : scene.mainId;
    if (mainId !== null && typeof mainId !== 'string') {
      throw new Error(`分镜 ${sceneIndex + 1} 主素材 ID 无效`);
    }
    if (mainId) {
      if (!assetIds.has(mainId)) throw new Error(`分镜 ${sceneIndex + 1} 引用了不存在的素材`);
      if (assigned.has(mainId)) throw new Error(`素材 ${mainId} 被重复分配`);
      assigned.add(mainId);
    }
    if (!Array.isArray(scene.supplementalIds)) {
      throw new Error(`分镜 ${sceneIndex + 1} 补镜头列表无效`);
    }
    if (scene.supplementalIds.length > PROJECT_ASSET_MAX_COUNT) {
      throw new Error(`分镜 ${sceneIndex + 1} 补镜头数量超限`);
    }
    const supplementalIds = scene.supplementalIds.map((id) => {
      boundedString(id, `分镜 ${sceneIndex + 1} 补镜头 ID`, PROJECT_ID_MAX_LENGTH);
      if (!assetIds.has(id)) throw new Error(`分镜 ${sceneIndex + 1} 引用了不存在的素材`);
      if (assigned.has(id)) throw new Error(`素材 ${id} 被重复分配`);
      assigned.add(id);
      return id;
    });
    const supplementalNotes = {};
    if (scene.supplementalNotes != null) {
      if (!isRecord(scene.supplementalNotes)) {
        throw new Error(`分镜 ${sceneIndex + 1} 备注字段无效`);
      }
      for (const [id, note] of Object.entries(scene.supplementalNotes)) {
        if (!supplementalIds.includes(id)) {
          throw new Error(`分镜 ${sceneIndex + 1} 备注引用了未分配的补镜头`);
        }
        supplementalNotes[id] = boundedString(
          note,
          `素材 ${id} 备注`,
          PROJECT_NOTE_MAX_LENGTH,
          { required: false },
        );
      }
    }
    const result = { mainId, supplementalIds };
    if (Object.keys(supplementalNotes).length > 0) {
      result.supplementalNotes = supplementalNotes;
    }
    return result;
  });
  return sanitiseArrangement({ scenes });
}

/** Validate and normalise a JSON export without accepting handles or blobs. */
export function validateProjectJson(value) {
  validateJsonDepth(value);
  if (!isRecord(value)) throw new Error('工程 JSON 顶层必须是对象');
  if (value.schemaVersion !== 2) {
    throw new Error('工程 JSON 版本不受支持，只接受 schemaVersion 2');
  }
  const name = boundedString(value.name, '工程名称', PROJECT_NAME_MAX_LENGTH);
  const episode = canonicalEpisode(value.episode);
  if (!episode) throw new Error('工程集号必须是 1–9999 的整数');
  if (value.sortBy != null && !SORT_VALUES.has(value.sortBy)) {
    throw new Error('工程排序方式无效');
  }
  if (!Array.isArray(value.assets)) throw new Error('工程素材列表无效');
  if (value.assets.length > PROJECT_ASSET_MAX_COUNT) {
    throw new Error(`工程素材数量不能超过 ${PROJECT_ASSET_MAX_COUNT}`);
  }
  const assetIds = new Set();
  const assets = value.assets.map((raw, index) => {
    const asset = validateAsset(raw, index);
    if (assetIds.has(asset.id)) throw new Error(`素材 ID 重复：${asset.id}`);
    assetIds.add(asset.id);
    return asset;
  });
  const arrangement = validateArrangement(value.arrangement, assetIds);
  return {
    name,
    episode,
    sortBy: value.sortBy ?? 'lastModified',
    arrangement,
    assets,
  };
}

export function validateImportPath(value) {
  if (typeof value !== 'string' || !value || value.length > PROJECT_PATH_MAX_LENGTH) {
    throw new Error('文件相对路径无效或过长');
  }
  const path = value.replaceAll('\\', '/');
  const parts = path.split('/');
  if (/^[a-z]:/i.test(path) || path.startsWith('/') || /\p{Cc}/u.test(path) ||
      parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error('只接受有效的相对文件路径');
  }
  if (parts.length - 1 > IMPORT_MAX_DEPTH) throw new Error(`文件夹层级超过 ${IMPORT_MAX_DEPTH} 层`);
}

function validateJsonDepth(value) {
  const pending = [{value, depth: 1}];
  const seen = new WeakSet();
  let visited = 0;
  while (pending.length) {
    const entry = pending.pop();
    if (!entry?.value || typeof entry.value !== 'object') continue;
    if (entry.depth > PROJECT_JSON_MAX_DEPTH || seen.has(entry.value) || ++visited > 100_000) {
      throw new Error('工程 JSON 结构过深或过于复杂');
    }
    seen.add(entry.value);
    for (const child of Object.values(entry.value)) pending.push({value: child, depth: entry.depth + 1});
  }
}

export function parseProjectJson(text) {
  if (typeof text !== 'string' || text.length > PROJECT_JSON_MAX_BYTES ||
      new TextEncoder().encode(text).byteLength > PROJECT_JSON_MAX_BYTES) throw new Error('工程 JSON 不能超过 4 MB');
  let quoted = false;
  let escaped = false;
  let depth = 0;
  for (const character of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{' || character === '[') {
      if (++depth > PROJECT_JSON_MAX_DEPTH) throw new Error('工程 JSON 嵌套过深');
    } else if (character === '}' || character === ']') depth -= 1;
  }
  return validateProjectJson(JSON.parse(text));
}
