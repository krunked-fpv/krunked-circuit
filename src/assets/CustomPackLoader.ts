// ============================================================================
// Krunked Circuit — Optional Local Custom Asset Pack Loader
// Probes Vite dev-server /__custom_pack__/manifest.json cleanly (404-safe),
// supports local folder selection via FileList with IndexedDB persistence
// (krunked_circuit_custom_pack_v1), and resolves logical asset keys to URLs.
// ============================================================================

import type { AssetPackManifest } from '../contracts/index';

export const CUSTOM_PACK_DB_NAME = 'krunked_circuit_custom_pack_v1';
export const CUSTOM_PACK_DEV_PREFIX = '/__custom_pack__/';
export const CUSTOM_PACK_MANIFEST_URL = '/__custom_pack__/manifest.json';

const DB_VERSION = 1;
const STORE_META = 'meta';
const STORE_BLOBS = 'blobs';
const MANIFEST_RECORD_KEY = 'manifest';

export type CustomPackCategory =
  | 'sprites'
  | 'tilesets'
  | 'backgrounds'
  | 'audioMusic'
  | 'audioSfx';

export type CustomPackSourceKind = 'none' | 'dev_server' | 'indexeddb';

export interface CustomPackImportResult {
  readonly ok: boolean;
  readonly count: number;
  readonly manifest: AssetPackManifest | null;
  readonly message: string;
}

/**
 * Generic logical BGM key aliases bridging synth track keys (`bgm_*`) to
 * compact pack manifest keys.
 */
const MUSIC_KEY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  bgm_title: ['title', 'title_ambient'],
  bgm_hub: ['hub', 'hub_command'],
  bgm_hub_command: ['hub_command', 'hub'],
  bgm_hub_medbay: ['hub_medbay', 'hub'],
  bgm_hub_dojo: ['hub_dojo', 'hub'],
  bgm_tutorial: ['tutorial'],
  bgm_opening: ['opening'],
  bgm_optic: ['optic'],
  bgm_patch: ['patch'],
  bgm_cooler: ['cooler'],
  bgm_elec: ['elec'],
  bgm_shift: ['shift'],
  bgm_wave: ['wave'],
  bgm_break: ['break'],
  bgm_cipher: ['cipher'],
  bgm_final_1: ['final_1'],
  bgm_final_2: ['final_2'],
  bgm_final_3: ['final_3'],
  bgm_boss_rush: ['boss_rush'],
  bgm_boss_opening: ['boss_siege_tread', 'boss_standard'],
  bgm_boss_master: ['boss_standard', 'boss_prism'],
  bgm_boss_final_1: ['boss_mirror_rival', 'boss_standard'],
  bgm_boss_final_2: ['boss_prism_core', 'boss_standard'],
  bgm_boss_final_3_p1: ['boss_overlord_apex', 'boss_standard'],
  bgm_boss_final_3_p2: ['boss_overlord_apex', 'boss_rush'],
  bgm_stage_clear: ['stage_clear'],
  bgm_gameover: ['tension', 'file_select'],
};

/**
 * Generic logical SFX key aliases bridging AudioEngine event keys to pack
 * manifest SFX keys.
 */
const SFX_KEY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  double_jump: ['jump'],
  land: ['jump_land'],
  wall_jump: ['jump_from_hookshot', 'jump'],
  jab: ['punch', 'punch_alt'],
  sprint_kick: ['punch_alt', 'punch'],
  dive_kick: ['punch_alt', 'punch'],
  hit: ['punch_hit', 'enemy_hit'],
  heavy_hit: ['punch_hard_hit', 'enemy_hit'],
  armor_break: ['guard_break', 'punch_shield'],
  hook_fire: ['hookshot_shoot'],
  hook_latch: ['hookshot_latch'],
  hook_grab: ['grab'],
  bounce: ['enemy_bounce'],
  burst: ['burst_flash'],
  burst_freeze: ['burst_flash'],
  hurt: ['player_hit'],
  death: ['player_death'],
  pickup_hp: ['pickup_health', 'pickup_health_large'],
  breakable: ['crate_break', 'barrel_break'],
  switch: ['door', 'menu_confirm'],
  boss_intro: ['boss_phase2'],
  boss_desperation: ['boss_phase2'],
  explosion: ['enemy_explode', 'boss_explode'],
  loadout_swap: ['menu_equip', 'menu_confirm'],
};

function normalizeRelPath(input: string): string {
  return input
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/');
}

function isStringRecord(val: unknown): val is Record<string, string> {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
  for (const v of Object.values(val as Record<string, unknown>)) {
    if (typeof v !== 'string') return false;
  }
  return true;
}

export function isValidAssetPackManifest(data: unknown): data is AssetPackManifest {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.version !== 'number') return false;
  if (typeof obj.source !== 'string') return false;
  if (typeof obj.extractedAt !== 'string') return false;
  if (!obj.counts || typeof obj.counts !== 'object') return false;
  return (
    isStringRecord(obj.sprites) &&
    isStringRecord(obj.tilesets) &&
    isStringRecord(obj.backgrounds) &&
    isStringRecord(obj.audioMusic) &&
    isStringRecord(obj.audioSfx)
  );
}

function openPackDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(CUSTOM_PACK_DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
        if (!db.objectStoreNames.contains(STORE_BLOBS)) {
          db.createObjectStore(STORE_BLOBS);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function collectReferencedPaths(manifest: AssetPackManifest): Set<string> {
  const paths = new Set<string>();
  const categories: CustomPackCategory[] = [
    'sprites',
    'tilesets',
    'backgrounds',
    'audioMusic',
    'audioSfx',
  ];
  for (const cat of categories) {
    for (const rel of Object.values(manifest[cat])) {
      paths.add(normalizeRelPath(rel));
    }
  }
  return paths;
}

function encodePosixPath(relPath: string): string {
  return normalizeRelPath(relPath)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export class CustomPackLoader {
  private manifest: AssetPackManifest | null = null;
  private sourceKind: CustomPackSourceKind = 'none';
  private readonly blobUrls = new Map<string, string>();

  getManifest(): AssetPackManifest | null {
    return this.manifest;
  }

  getSourceKind(): CustomPackSourceKind {
    return this.sourceKind;
  }

  isAvailable(): boolean {
    return this.manifest !== null && this.sourceKind !== 'none';
  }

  /**
   * Probes `/__custom_pack__/manifest.json` on the Vite dev server.
   * Returns null gracefully without throwing or logging errors if absent (404)
   * or when invoked in a DOM-free Node environment.
   */
  async probeDevServer(): Promise<AssetPackManifest | null> {
    if (!import.meta.env?.DEV || typeof window === 'undefined' || typeof fetch !== 'function') {
      return null;
    }

    try {
      const response = await fetch(CUSTOM_PACK_MANIFEST_URL, {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        return null;
      }
      const data: unknown = await response.json();
      if (!isValidAssetPackManifest(data)) {
        return null;
      }
      this.revokeBlobUrls();
      this.manifest = data;
      this.sourceKind = 'dev_server';
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Imports a user-selected local folder (`FileList`) containing `manifest.json`
   * and referenced asset files, caches object URLs for immediate playback, and
   * persists the manifest + asset blobs in IndexedDB (`krunked_circuit_custom_pack_v1`).
   */
  async loadFromFileList(files: FileList): Promise<CustomPackImportResult> {
    if (!files || files.length === 0) {
      return {
        ok: false,
        count: 0,
        manifest: null,
        message: 'No files selected.',
      };
    }

    const fileList: File[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files.item(i);
      if (f) fileList.push(f);
    }

    // Build normalized relative path map (strip top-level selected folder prefix if present)
    const rawPaths = fileList.map((f) =>
      normalizeRelPath(f.webkitRelativePath && f.webkitRelativePath.length > 0 ? f.webkitRelativePath : f.name),
    );
    const firstSegment = rawPaths[0]?.includes('/') ? rawPaths[0].split('/')[0] : null;
    const allShareRoot =
      firstSegment !== null &&
      rawPaths.every((p) => p.startsWith(`${firstSegment}/`));

    const byRelPath = new Map<string, File>();
    const byLowerPath = new Map<string, string>();
    let manifestFile: File | null = null;

    for (let i = 0; i < fileList.length; i++) {
      const rel = allShareRoot && firstSegment ? rawPaths[i].slice(firstSegment.length + 1) : rawPaths[i];
      const normalized = normalizeRelPath(rel);
      const file = fileList[i];
      byRelPath.set(normalized, file);
      byLowerPath.set(normalized.toLowerCase(), normalized);
      if (normalized.toLowerCase() === 'manifest.json') {
        manifestFile = file;
      }
    }

    if (!manifestFile) {
      return {
        ok: false,
        count: 0,
        manifest: null,
        message: 'Selected folder does not contain a valid manifest.json file.',
      };
    }

    let parsed: unknown;
    try {
      const text = await manifestFile.text();
      parsed = JSON.parse(text);
    } catch {
      return {
        ok: false,
        count: 0,
        manifest: null,
        message: 'Failed to parse manifest.json in selected folder.',
      };
    }

    if (!isValidAssetPackManifest(parsed)) {
      return {
        ok: false,
        count: 0,
        manifest: null,
        message: 'manifest.json does not match the Krunked Circuit asset pack schema.',
      };
    }

    const referenced = collectReferencedPaths(parsed);
    const matchedBlobs = new Map<string, Blob>();

    for (const refPath of referenced) {
      const exact = byRelPath.get(refPath);
      if (exact) {
        matchedBlobs.set(refPath, exact);
        continue;
      }
      const lowerKey = byLowerPath.get(refPath.toLowerCase());
      if (lowerKey) {
        const ciFile = byRelPath.get(lowerKey);
        if (ciFile) matchedBlobs.set(refPath, ciFile);
      }
    }

    if (matchedBlobs.size === 0) {
      return {
        ok: false,
        count: 0,
        manifest: null,
        message: 'manifest.json was read, but none of its referenced asset files were found in the folder.',
      };
    }

    // Activate in memory first so playback works even if IndexedDB is unavailable
    this.revokeBlobUrls();
    for (const [relPath, blob] of matchedBlobs.entries()) {
      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        this.blobUrls.set(relPath, URL.createObjectURL(blob));
      }
    }
    this.manifest = parsed;
    this.sourceKind = 'indexeddb';

    // Persist manifest + blobs into IndexedDB for reload persistence
    const persisted = await this.persistToIndexedDB(parsed, matchedBlobs);

    return {
      ok: true,
      count: matchedBlobs.size,
      manifest: parsed,
      message: persisted
        ? `Loaded and cached ${matchedBlobs.size} custom pack assets.`
        : `Loaded ${matchedBlobs.size} custom pack assets for this session (IndexedDB storage unavailable).`,
    };
  }

  /**
   * Restores a previously imported custom pack from IndexedDB (`krunked_circuit_custom_pack_v1`).
   */
  async restorePersistedPack(): Promise<AssetPackManifest | null> {
    const db = await openPackDatabase();
    if (!db) return null;

    try {
      const manifest = await new Promise<AssetPackManifest | null>((resolve) => {
        const tx = db.transaction(STORE_META, 'readonly');
        const req = tx.objectStore(STORE_META).get(MANIFEST_RECORD_KEY);
        req.onsuccess = () => {
          resolve(isValidAssetPackManifest(req.result) ? req.result : null);
        };
        req.onerror = () => resolve(null);
      });

      if (!manifest) {
        return null;
      }

      const loadedBlobs = await new Promise<Map<string, Blob>>((resolve) => {
        const map = new Map<string, Blob>();
        const tx = db.transaction(STORE_BLOBS, 'readonly');
        const cursorReq = tx.objectStore(STORE_BLOBS).openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) {
            resolve(map);
            return;
          }
          if (typeof cursor.key === 'string' && cursor.value instanceof Blob) {
            map.set(cursor.key, cursor.value);
          }
          cursor.continue();
        };
        cursorReq.onerror = () => resolve(map);
      });

      if (loadedBlobs.size === 0) {
        return null;
      }

      this.revokeBlobUrls();
      for (const [relPath, blob] of loadedBlobs.entries()) {
        if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
          this.blobUrls.set(relPath, URL.createObjectURL(blob));
        }
      }
      this.manifest = manifest;
      this.sourceKind = 'indexeddb';
      return manifest;
    } catch {
      return null;
    } finally {
      db.close();
    }
  }

  /**
   * Clears any persisted custom pack from IndexedDB and releases in-memory blob URLs.
   */
  async clearPersistedPack(): Promise<void> {
    this.revokeBlobUrls();
    this.manifest = null;
    this.sourceKind = 'none';

    const db = await openPackDatabase();
    if (!db) return;

    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction([STORE_META, STORE_BLOBS], 'readwrite');
        tx.objectStore(STORE_META).clear();
        tx.objectStore(STORE_BLOBS).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
    } catch {
      // Ignore storage clear failures
    } finally {
      db.close();
    }
  }

  resolveSpriteUrl(key: string): string | null {
    return this.resolveAssetUrl('sprites', key);
  }

  resolveTilesetUrl(key: string): string | null {
    return this.resolveAssetUrl('tilesets', key);
  }

  resolveBackgroundUrl(key: string): string | null {
    return this.resolveAssetUrl('backgrounds', key);
  }

  resolveMusicUrl(key: string): string | null {
    return this.resolveAssetUrl('audioMusic', key);
  }

  resolveSfxUrl(key: string): string | null {
    return this.resolveAssetUrl('audioSfx', key);
  }

  resolveAssetUrl(category: CustomPackCategory, key: string): string | null {
    if (!this.manifest || this.sourceKind === 'none') return null;

    const relPath = this.lookupRelativePath(category, key);
    if (!relPath) return null;

    const normalized = normalizeRelPath(relPath);
    if (this.sourceKind === 'indexeddb') {
      return this.blobUrls.get(normalized) ?? null;
    }
    return `${CUSTOM_PACK_DEV_PREFIX}${encodePosixPath(normalized)}`;
  }

  dispose(): void {
    this.revokeBlobUrls();
  }

  private lookupRelativePath(category: CustomPackCategory, key: string): string | null {
    if (!this.manifest) return null;
    const table = this.manifest[category];
    if (table[key]) return table[key];

    if (category === 'audioMusic') {
      const aliases = MUSIC_KEY_ALIASES[key];
      if (aliases) {
        for (const candidate of aliases) {
          if (table[candidate]) return table[candidate];
        }
      }
      if (key.startsWith('bgm_')) {
        const stripped = key.slice(4);
        if (table[stripped]) return table[stripped];
      }
    } else if (category === 'audioSfx') {
      const aliases = SFX_KEY_ALIASES[key];
      if (aliases) {
        for (const candidate of aliases) {
          if (table[candidate]) return table[candidate];
        }
      }
    }

    return null;
  }

  private async persistToIndexedDB(
    manifest: AssetPackManifest,
    blobs: Map<string, Blob>,
  ): Promise<boolean> {
    const db = await openPackDatabase();
    if (!db) return false;

    try {
      return await new Promise<boolean>((resolve) => {
        const tx = db.transaction([STORE_META, STORE_BLOBS], 'readwrite');
        const metaStore = tx.objectStore(STORE_META);
        const blobStore = tx.objectStore(STORE_BLOBS);

        metaStore.clear();
        blobStore.clear();
        metaStore.put(manifest, MANIFEST_RECORD_KEY);
        for (const [relPath, blob] of blobs.entries()) {
          blobStore.put(blob, relPath);
        }

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      });
    } catch {
      return false;
    } finally {
      db.close();
    }
  }

  private revokeBlobUrls(): void {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      for (const url of this.blobUrls.values()) {
        URL.revokeObjectURL(url);
      }
    }
    this.blobUrls.clear();
  }
}
