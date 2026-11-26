// ============================================================================
// Krunked Circuit — Schema-Validated Save Manager
// Persists ProgressionState, RenderSettings, AudioSettings, and ControlBindings
// under localStorage key `krunked_circuit_save_v1` with corruption recovery.
// ============================================================================

import {
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_CONTROL_BINDINGS,
  DEFAULT_RENDER_SETTINGS,
  ENGINE_CONSTANTS,
  type ArmorPaintId,
  type AudioSettings,
  type BurstId,
  type ChipId,
  type ControlBindings,
  type Difficulty,
  type GameMode,
  type Loadout,
  type ProgressionState,
  type RenderSettings,
  type SaveData,
  type StageId,
  type TargetFps,
} from '../contracts/index';
import { createInitialProgression } from '../sim/progression';

const STORAGE_KEY = ENGINE_CONSTANTS.SAVE_STORAGE_KEY;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function sanitizeNumber(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return clamp(v, min, max);
}

function sanitizeBoolean(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function sanitizeTargetFps(v: unknown): TargetFps {
  return v === 30 || v === 60 || v === 120 ? v : DEFAULT_RENDER_SETTINGS.targetFps;
}

function sanitizeDifficulty(v: unknown): Difficulty {
  return v === 'easy' || v === 'normal' || v === 'hard' ? v : 'normal';
}

function sanitizeGameMode(v: unknown): GameMode {
  return v === 'standard' || v === 'circuit' || v === 'boss_rush' || v === 'speedrun'
    ? v
    : 'standard';
}

function sanitizeLoadout(raw: unknown, fallback: Loadout): Loadout {
  if (!isRecord(raw)) return { ...fallback, bursts: { ...fallback.bursts }, chips: [...fallback.chips] as Loadout['chips'] };
  const rawBursts = isRecord(raw.bursts) ? raw.bursts : {};
  const rawChips = Array.isArray(raw.chips) ? raw.chips : [];
  const validBurst = (x: unknown, fb: BurstId | 0): BurstId | 0 =>
    typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 20 ? (x as BurstId | 0) : fb;
  const validChip = (x: unknown, fb: ChipId | 0): ChipId | 0 =>
    typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 20 ? (x as ChipId | 0) : fb;
  const armor =
    typeof raw.armorPaint === 'number' && Number.isInteger(raw.armorPaint) && raw.armorPaint >= 0 && raw.armorPaint <= 11
      ? (raw.armorPaint as ArmorPaintId)
      : fallback.armorPaint;
  return {
    name: typeof raw.name === 'string' && raw.name.trim().length > 0 ? raw.name.slice(0, 24) : fallback.name,
    bursts: {
      neutral: validBurst(rawBursts.neutral, fallback.bursts.neutral),
      side: validBurst(rawBursts.side, fallback.bursts.side),
      up: validBurst(rawBursts.up, fallback.bursts.up),
      down: validBurst(rawBursts.down, fallback.bursts.down),
    },
    chips: [
      validChip(rawChips[0], fallback.chips[0]),
      validChip(rawChips[1], fallback.chips[1]),
      validChip(rawChips[2], fallback.chips[2]),
    ],
    armorPaint: armor,
  };
}

export function sanitizeProgression(raw: unknown): ProgressionState {
  const def = createInitialProgression();
  if (!isRecord(raw)) return def;

  const rawMods = isRecord(raw.modifiers) ? raw.modifiers : {};
  const rawLoadouts = Array.isArray(raw.loadouts) ? raw.loadouts : [];
  const strArray = (x: unknown): string[] =>
    Array.isArray(x) ? x.filter((item): item is string => typeof item === 'string') : [];
  const numArray = <T extends number>(x: unknown, min: number, max: number, fallback: T[]): T[] => {
    if (!Array.isArray(x)) return [...fallback];
    const out = x.filter((n): n is T => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max);
    return out.length > 0 ? Array.from(new Set(out)) : [...fallback];
  };

  const activeLoadoutIndex =
    raw.activeLoadoutIndex === 0 || raw.activeLoadoutIndex === 1 || raw.activeLoadoutIndex === 2
      ? raw.activeLoadoutIndex
      : 0;

  return {
    bits: Math.floor(sanitizeNumber(raw.bits, def.bits, 0, 9999999)),
    rescueTokens: Math.floor(sanitizeNumber(raw.rescueTokens, def.rescueTokens, 0, 64)),
    totalRescues: Math.floor(sanitizeNumber(raw.totalRescues, def.totalRescues, 0, 64)),
    rescuedIds: strArray(raw.rescuedIds),
    clearedStages: strArray(raw.clearedStages) as StageId[],
    clearedRemixes: strArray(raw.clearedRemixes) as StageId[],
    collectedHealthBoosters: strArray(raw.collectedHealthBoosters) as StageId[],
    collectedBurstBoosters: strArray(raw.collectedBurstBoosters) as StageId[],
    unlockedBursts: numArray<BurstId>(raw.unlockedBursts, 1, 20, def.unlockedBursts),
    unlockedChips: numArray<ChipId>(raw.unlockedChips, 1, 20, def.unlockedChips),
    unlockedArmors: numArray<ArmorPaintId>(raw.unlockedArmors, 0, 11, def.unlockedArmors),
    unlockedChallenges: strArray(raw.unlockedChallenges),
    unlockedDataChips: strArray(raw.unlockedDataChips),
    loadouts: [
      sanitizeLoadout(rawLoadouts[0], def.loadouts[0]),
      sanitizeLoadout(rawLoadouts[1], def.loadouts[1]),
      sanitizeLoadout(rawLoadouts[2], def.loadouts[2]),
    ],
    activeLoadoutIndex,
    difficulty: sanitizeDifficulty(raw.difficulty),
    mode: sanitizeGameMode(raw.mode),
    modifiers: {
      masterLevels: sanitizeBoolean(rawMods.masterLevels, false),
      rudeEnemies: sanitizeBoolean(rawMods.rudeEnemies, false),
      doubleHazards: sanitizeBoolean(rawMods.doubleHazards, false),
      singleCredit: sanitizeBoolean(rawMods.singleCredit, false),
      ironCircuit: sanitizeBoolean(rawMods.ironCircuit, false),
      mirrorWorld: sanitizeBoolean(rawMods.mirrorWorld, false),
    },
    bestTimesTicks: isRecord(raw.bestTimesTicks) ? (raw.bestTimesTicks as Partial<Record<StageId, number>>) : {},
    farmCounts: isRecord(raw.farmCounts) ? (raw.farmCounts as Record<string, number>) : {},
  };
}

export function sanitizeRenderSettings(raw: unknown): RenderSettings {
  if (!isRecord(raw)) return { ...DEFAULT_RENDER_SETTINGS };
  return {
    targetFps: sanitizeTargetFps(raw.targetFps),
    classicSnap60: sanitizeBoolean(raw.classicSnap60, DEFAULT_RENDER_SETTINGS.classicSnap60),
    scaleMode:
      raw.scaleMode === 'integer' || raw.scaleMode === 'fit' || raw.scaleMode === 'fill'
        ? raw.scaleMode
        : DEFAULT_RENDER_SETTINGS.scaleMode,
    aimReticle: sanitizeBoolean(raw.aimReticle, DEFAULT_RENDER_SETTINGS.aimReticle),
    screenShake: sanitizeBoolean(raw.screenShake, DEFAULT_RENDER_SETTINGS.screenShake),
    assetMode: raw.assetMode === 'CUSTOM_PACK' ? 'CUSTOM_PACK' : 'BUILTIN',
    showSpeedrunTimer: sanitizeBoolean(raw.showSpeedrunTimer, DEFAULT_RENDER_SETTINGS.showSpeedrunTimer),
  };
}

export function sanitizeAudioSettings(raw: unknown): AudioSettings {
  if (!isRecord(raw)) return { ...DEFAULT_AUDIO_SETTINGS };
  return {
    masterVolume: sanitizeNumber(raw.masterVolume, DEFAULT_AUDIO_SETTINGS.masterVolume, 0, 1),
    bgmVolume: sanitizeNumber(raw.bgmVolume, DEFAULT_AUDIO_SETTINGS.bgmVolume, 0, 1),
    sfxVolume: sanitizeNumber(raw.sfxVolume, DEFAULT_AUDIO_SETTINGS.sfxVolume, 0, 1),
    muted: sanitizeBoolean(raw.muted, DEFAULT_AUDIO_SETTINGS.muted),
  };
}

export function sanitizeControlBindings(raw: unknown): ControlBindings {
  if (!isRecord(raw)) {
    return {
      ...DEFAULT_CONTROL_BINDINGS,
      keyboard: { ...DEFAULT_CONTROL_BINDINGS.keyboard },
    };
  }
  const kbRaw = isRecord(raw.keyboard) ? raw.keyboard : {};
  const keyboard = { ...DEFAULT_CONTROL_BINDINGS.keyboard };
  for (const key of Object.keys(keyboard) as (keyof typeof keyboard)[]) {
    const v = kbRaw[key];
    if (typeof v === 'string' && v.length > 0 && v.length <= 32) {
      keyboard[key] = v;
    }
  }
  return {
    keyboard,
    gamepadPreset: raw.gamepadPreset === 'shoulder_hook' ? 'shoulder_hook' : 'default',
    gamepadDeadzone: sanitizeNumber(raw.gamepadDeadzone, DEFAULT_CONTROL_BINDINGS.gamepadDeadzone, 0.05, 0.6),
    gamepadTriggerThreshold: sanitizeNumber(
      raw.gamepadTriggerThreshold,
      DEFAULT_CONTROL_BINDINGS.gamepadTriggerThreshold,
      0.1,
      0.9,
    ),
    rumbleEnabled: sanitizeBoolean(raw.rumbleEnabled, DEFAULT_CONTROL_BINDINGS.rumbleEnabled),
  };
}

export function createDefaultSaveData(): SaveData {
  return {
    schemaVersion: ENGINE_CONSTANTS.SAVE_SCHEMA_VERSION,
    updatedAt: new Date(0).toISOString(),
    progression: createInitialProgression(),
    renderSettings: { ...DEFAULT_RENDER_SETTINGS },
    audioSettings: { ...DEFAULT_AUDIO_SETTINGS },
    controls: {
      ...DEFAULT_CONTROL_BINDINGS,
      keyboard: { ...DEFAULT_CONTROL_BINDINGS.keyboard },
    },
  };
}

export function parseSaveData(rawJson: string | null): { data: SaveData; recovered: boolean; existed: boolean } {
  if (!rawJson) {
    return { data: createDefaultSaveData(), recovered: false, existed: false };
  }
  try {
    const parsed: unknown = JSON.parse(rawJson);
    if (!isRecord(parsed)) {
      return { data: createDefaultSaveData(), recovered: true, existed: true };
    }
    const data: SaveData = {
      schemaVersion: ENGINE_CONSTANTS.SAVE_SCHEMA_VERSION,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      progression: sanitizeProgression(parsed.progression),
      renderSettings: sanitizeRenderSettings(parsed.renderSettings),
      audioSettings: sanitizeAudioSettings(parsed.audioSettings),
      controls: sanitizeControlBindings(parsed.controls),
    };
    return { data, recovered: false, existed: true };
  } catch {
    return { data: createDefaultSaveData(), recovered: true, existed: true };
  }
}

export class SaveManager {
  private readonly storageKey: string;

  constructor(storageKey = STORAGE_KEY) {
    this.storageKey = storageKey;
  }

  private getStorage(): Storage | null {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage;
      }
    } catch {
      return null;
    }
    return null;
  }

  public hasSave(): boolean {
    const store = this.getStorage();
    if (!store) return false;
    try {
      return store.getItem(this.storageKey) !== null;
    } catch {
      return false;
    }
  }

  public load(): { data: SaveData; recovered: boolean; existed: boolean } {
    const store = this.getStorage();
    if (!store) {
      return { data: createDefaultSaveData(), recovered: false, existed: false };
    }
    try {
      const raw = store.getItem(this.storageKey);
      const result = parseSaveData(raw);
      if (result.recovered) {
        this.save(result.data);
      }
      return result;
    } catch {
      return { data: createDefaultSaveData(), recovered: true, existed: false };
    }
  }

  public save(data: SaveData): boolean {
    const store = this.getStorage();
    if (!store) return false;
    try {
      const payload: SaveData = {
        ...data,
        schemaVersion: ENGINE_CONSTANTS.SAVE_SCHEMA_VERSION,
        updatedAt: new Date().toISOString(),
      };
      store.setItem(this.storageKey, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  public clear(): void {
    const store = this.getStorage();
    if (!store) return;
    try {
      store.removeItem(this.storageKey);
    } catch {
      // Ignore storage errors
    }
  }
}
