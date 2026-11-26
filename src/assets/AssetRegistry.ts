// ============================================================================
// Krunked Circuit — Unified Asset Registry Facade
// Coordinates Built-In ProceduralPixelAtlas (100% self-contained & DOM-safe)
// with optional local Owned Custom Pack loading via CustomPackLoader.
// ============================================================================

import {
  OFFICIAL_STAGE_IDS,
  type AssetMode,
  type AssetPackManifest,
  type BossId,
  type EnemyFamily,
  type MinibossId,
} from '../contracts/index';
import { CustomPackLoader } from './CustomPackLoader';
import {
  HERO_FRAME_NAMES,
  ProceduralPixelAtlas,
  SOLID_TILE_TYPES,
} from './ProceduralPixelAtlas';

const REQUIRED_ENEMY_FAMILIES: readonly EnemyFamily[] = [
  'trooper',
  'shield_guard',
  'turret',
  'hopper',
  'flyer',
  'crawler',
  'spawner',
  'hazard',
  'dummy',
];

const REQUIRED_BOSS_IDS: readonly BossId[] = [
  'siege_tread',
  'prism',
  'stitch',
  'frostfang',
  'arcbolt',
  'strider',
  'tempo',
  'crag',
  'phantom',
  'mirror_rival',
  'prism_core',
  'overlord_apex',
];

const REQUIRED_MINIBOSS_IDS: readonly MinibossId[] = [
  'junk_colossus',
  'sky_gunship',
  'wrecker_tank',
];

const REQUIRED_STATIC_KEYS: readonly string[] = [
  'player_hero',
  'hook_tip',
  'hook_chain',
  'aim_reticle',
  'crate',
  'barrel',
  'switch_off',
  'switch_on',
  'hub_terminal',
  'rescue_bot',
  'health_booster',
  'burst_booster',
  'palette_chip',
  'bit_1',
  'bit_5',
  'bit_10',
  'bit_50',
  'health_small',
  'health_large',
  'burst_orb',
  'walker',
  'hud_heart',
  'hud_burst',
  'hud_rescue',
  'hud_bit',
];

function loadImageElement(url: string): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export class AssetRegistry {
  private atlas: ProceduralPixelAtlas | null = null;
  private readonly loader: CustomPackLoader;
  private mode: AssetMode = 'BUILTIN';
  private readonly customImages = new Map<string, HTMLImageElement>();
  private readonly pendingImageLoads = new Map<string, Promise<HTMLImageElement | null>>();
  private initialized = false;

  constructor(loader?: CustomPackLoader) {
    this.loader = loader ?? new CustomPackLoader();
  }

  /**
   * Builds the procedural 16-bit pixel atlas and probes for an available local
   * custom asset pack (IndexedDB first, then Vite dev-server middleware).
   */
  async init(): Promise<void> {
    if (!this.atlas) {
      this.atlas = new ProceduralPixelAtlas();
    }

    if (!this.initialized) {
      const persisted = await this.loader.restorePersistedPack();
      if (!persisted) {
        await this.loader.probeDevServer();
      }
      this.initialized = true;
    }
  }

  getMode(): AssetMode {
    return this.mode;
  }

  async setMode(mode: AssetMode): Promise<void> {
    if (mode === 'CUSTOM_PACK') {
      if (!this.loader.isAvailable()) {
        const persisted = await this.loader.restorePersistedPack();
        if (!persisted) {
          await this.loader.probeDevServer();
        }
      }
      if (!this.loader.isAvailable()) {
        this.mode = 'BUILTIN';
        return;
      }
      this.mode = 'CUSTOM_PACK';
      await this.preloadCustomImages();
      return;
    }

    this.mode = 'BUILTIN';
  }

  isCustomPackAvailable(): boolean {
    return this.loader.isAvailable();
  }

  async importCustomPackFolder(
    files: FileList,
  ): Promise<{ ok: boolean; count: number; message: string }> {
    const result = await this.loader.loadFromFileList(files);
    if (!result.ok) {
      return {
        ok: false,
        count: 0,
        message: result.message,
      };
    }

    this.customImages.clear();
    this.pendingImageLoads.clear();
    if (this.mode === 'CUSTOM_PACK') {
      await this.preloadCustomImages();
    }

    return {
      ok: true,
      count: result.count,
      message: result.message,
    };
  }

  async clearCustomPack(): Promise<void> {
    await this.loader.clearPersistedPack();
    this.customImages.clear();
    this.pendingImageLoads.clear();
    this.mode = 'BUILTIN';
  }

  getAtlas(): ProceduralPixelAtlas {
    if (!this.atlas) {
      this.atlas = new ProceduralPixelAtlas();
    }
    return this.atlas;
  }

  /**
   * Resolves a loaded HTMLImageElement for a logical key when `CUSTOM_PACK` mode
   * is active in a browser. Supports explicit prefixes (`sprite:`, `tileset:`,
   * `bg:`) as well as bare logical keys. Returns null cleanly in `BUILTIN` mode
   * or headless Node environments.
   */
  getCustomImage(key: string): HTMLImageElement | null {
    if (this.mode !== 'CUSTOM_PACK' || !this.loader.isAvailable()) {
      return null;
    }
    if (typeof Image === 'undefined') {
      return null;
    }

    const cached = this.customImages.get(key);
    if (cached && cached.complete && cached.naturalWidth > 0) {
      return cached;
    }

    const url = this.resolveCustomImageUrl(key);
    if (!url) return null;

    // Kick off non-blocking lazy load if not already queued
    if (!this.pendingImageLoads.has(key)) {
      const loadPromise = loadImageElement(url).then((img) => {
        this.pendingImageLoads.delete(key);
        if (img) {
          this.customImages.set(key, img);
        }
        return img;
      });
      this.pendingImageLoads.set(key, loadPromise);
    }

    return null;
  }

  getCustomAudioUrl(kind: 'music' | 'sfx', key: string): string | null {
    if (this.mode !== 'CUSTOM_PACK' || !this.loader.isAvailable()) {
      return null;
    }
    return kind === 'music'
      ? this.loader.resolveMusicUrl(key)
      : this.loader.resolveSfxUrl(key);
  }

  getManifest(): AssetPackManifest | null {
    return this.loader.getManifest();
  }

  /**
   * Returns every logical sprite, biome tile, enemy, boss, prop, pickup, HUD,
   * and bitmap font key required for 100% Built-In asset verification.
   */
  getRequiredLogicalKeys(): string[] {
    const keys: string[] = [...REQUIRED_STATIC_KEYS];

    for (const frame of HERO_FRAME_NAMES) {
      keys.push(`player_hero_${frame}`);
    }

    for (const stageId of OFFICIAL_STAGE_IDS) {
      for (const tileType of SOLID_TILE_TYPES) {
        keys.push(`tile_${stageId}_${tileType}`);
      }
    }

    for (const family of REQUIRED_ENEMY_FAMILIES) {
      keys.push(`enemy_${family}`);
    }

    for (const bossId of REQUIRED_BOSS_IDS) {
      keys.push(`boss_${bossId}`);
    }

    for (const mbId of REQUIRED_MINIBOSS_IDS) {
      keys.push(`miniboss_${mbId}`);
    }

    for (let code = 32; code <= 126; code++) {
      keys.push(`font_${code}`);
    }

    return keys;
  }

  /**
   * Preloads custom pack images into the HTMLImageElement cache (no-op in Node).
   */
  async preloadCustomImages(keys?: readonly string[]): Promise<number> {
    if (!this.loader.isAvailable() || typeof Image === 'undefined') {
      return 0;
    }
    const manifest = this.loader.getManifest();
    if (!manifest) return 0;

    const targetKeys =
      keys ??
      Array.from(
        new Set<string>([
          ...Object.keys(manifest.sprites),
          ...Object.keys(manifest.tilesets).map((k) => `tileset:${k}`),
          ...Object.keys(manifest.backgrounds).map((k) => `bg:${k}`),
        ]),
      );

    let loadedCount = 0;
    await Promise.all(
      targetKeys.map(async (key) => {
        if (this.customImages.has(key)) {
          loadedCount++;
          return;
        }
        const url = this.resolveCustomImageUrl(key);
        if (!url) return;
        const img = await loadImageElement(url);
        if (img) {
          this.customImages.set(key, img);
          loadedCount++;
        }
      }),
    );

    return loadedCount;
  }

  dispose(): void {
    this.atlas?.dispose();
    this.loader.dispose();
    this.customImages.clear();
    this.pendingImageLoads.clear();
  }

  private resolveCustomImageUrl(key: string): string | null {
    if (key.startsWith('sprite:')) {
      return this.loader.resolveSpriteUrl(key.slice(7));
    }
    if (key.startsWith('tileset:')) {
      return this.loader.resolveTilesetUrl(key.slice(8));
    }
    if (key.startsWith('bg:')) {
      return this.loader.resolveBackgroundUrl(key.slice(3));
    }
    return (
      this.loader.resolveSpriteUrl(key) ??
      this.loader.resolveTilesetUrl(key) ??
      this.loader.resolveBackgroundUrl(key)
    );
  }
}
