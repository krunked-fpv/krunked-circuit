// ============================================================================
// Krunked Circuit — Audio Manifest & Logical Sound Catalog
// Complete BGM & SFX registry with cooldowns, polyphony caps, and custom pack
// alias mapping. Imports strictly from ../contracts/index.
// ============================================================================

import type { StageId } from '../contracts/index';

export type HubStem = 'command' | 'medbay' | 'dojo';

export const HUB_STEMS: readonly HubStem[] = ['command', 'medbay', 'dojo'] as const;

export type BgmKey =
  | 'bgm_title'
  | 'bgm_hub'
  | 'bgm_tutorial'
  | 'bgm_opening'
  | 'bgm_optic'
  | 'bgm_patch'
  | 'bgm_cooler'
  | 'bgm_elec'
  | 'bgm_shift'
  | 'bgm_wave'
  | 'bgm_break'
  | 'bgm_cipher'
  | 'bgm_final_1'
  | 'bgm_final_2'
  | 'bgm_final_3'
  | 'bgm_boss_opening'
  | 'bgm_boss_master'
  | 'bgm_boss_final_1'
  | 'bgm_boss_final_2'
  | 'bgm_boss_final_3_p1'
  | 'bgm_boss_final_3_p2'
  | 'bgm_stage_clear'
  | 'bgm_gameover';

export type SfxKey =
  | 'jump'
  | 'double_jump'
  | 'land'
  | 'slide'
  | 'wall_jump'
  | 'ledge_grab'
  | 'jab'
  | 'sprint_kick'
  | 'dive_kick'
  | 'hit'
  | 'heavy_hit'
  | 'armor_break'
  | 'hook_fire'
  | 'hook_latch'
  | 'hook_grab'
  | 'throw'
  | 'bounce'
  | 'burst'
  | 'burst_freeze'
  | 'hurt'
  | 'death'
  | 'pickup_bit'
  | 'pickup_hp'
  | 'pickup_burst'
  | 'rescue'
  | 'checkpoint'
  | 'switch'
  | 'breakable'
  | 'boss_intro'
  | 'boss_desperation'
  | 'explosion'
  | 'menu_move'
  | 'menu_confirm'
  | 'menu_cancel'
  | 'loadout_swap';

export interface BgmTrackSpec {
  readonly key: BgmKey;
  readonly title: string;
  readonly bpm: number;
  readonly loop: boolean;
  readonly gain: number;
  readonly hasStems?: boolean;
  readonly stageId?: StageId;
  readonly customPackKeys: readonly string[];
  readonly customIntroKeys?: readonly string[];
  readonly customStemKeys?: Readonly<Record<HubStem, readonly string[]>>;
}

export interface SfxSpec {
  readonly key: SfxKey;
  readonly cooldownMs: number;
  readonly maxVoices: number;
  readonly baseGain: number;
  readonly pitchJitter: number;
  readonly durationMs: number;
  readonly priority: number;
  readonly customPackKeys: readonly string[];
}

export const BGM_TRACKS: Readonly<Record<BgmKey, BgmTrackSpec>> = {
  bgm_title: {
    key: 'bgm_title',
    title: 'Krunked Circuit Anthem',
    bpm: 148,
    loop: true,
    gain: 0.78,
    customPackKeys: ['bgm_title', 'title', 'file_select'],
  },
  bgm_hub: {
    key: 'bgm_hub',
    title: 'Command Deck Sanctuary',
    bpm: 135,
    loop: true,
    gain: 0.74,
    hasStems: true,
    stageId: 'hub',
    customPackKeys: ['bgm_hub', 'hub', 'hub_command'],
    customStemKeys: {
      command: ['bgm_hub_command', 'hub_command', 'hub'],
      medbay: ['bgm_hub_medbay', 'hub_medbay'],
      dojo: ['bgm_hub_dojo', 'hub_dojo'],
    },
  },
  bgm_tutorial: {
    key: 'bgm_tutorial',
    title: 'Calibration Course',
    bpm: 138,
    loop: true,
    gain: 0.72,
    stageId: 'tutorial',
    customPackKeys: ['bgm_tutorial', 'tutorial'],
    customIntroKeys: ['tutorial_intro'],
  },
  bgm_opening: {
    key: 'bgm_opening',
    title: 'Metro Expressway Overdrive',
    bpm: 158,
    loop: true,
    gain: 0.8,
    stageId: 'opening',
    customPackKeys: ['bgm_opening', 'opening'],
    customIntroKeys: ['opening_intro'],
  },
  bgm_optic: {
    key: 'bgm_optic',
    title: 'Solar Relay Mirage',
    bpm: 150,
    loop: true,
    gain: 0.78,
    stageId: 'optic',
    customPackKeys: ['bgm_optic', 'optic'],
    customIntroKeys: ['optic_intro'],
  },
  bgm_patch: {
    key: 'bgm_patch',
    title: 'Scrap Forge Foundry',
    bpm: 144,
    loop: true,
    gain: 0.76,
    stageId: 'patch',
    customPackKeys: ['bgm_patch', 'patch'],
    customIntroKeys: ['patch_intro'],
  },
  bgm_cooler: {
    key: 'bgm_cooler',
    title: 'Cryo Conduit Drift',
    bpm: 142,
    loop: true,
    gain: 0.76,
    stageId: 'cooler',
    customPackKeys: ['bgm_cooler', 'cooler'],
    customIntroKeys: ['cooler_intro'],
  },
  bgm_elec: {
    key: 'bgm_elec',
    title: 'High-Voltage Surge',
    bpm: 156,
    loop: true,
    gain: 0.78,
    stageId: 'elec',
    customPackKeys: ['bgm_elec', 'elec'],
    customIntroKeys: ['elec_intro'],
  },
  bgm_shift: {
    key: 'bgm_shift',
    title: 'Skyway Convoy Run',
    bpm: 152,
    loop: true,
    gain: 0.78,
    stageId: 'shift',
    customPackKeys: ['bgm_shift', 'shift'],
    customIntroKeys: ['shift_intro'],
  },
  bgm_wave: {
    key: 'bgm_wave',
    title: 'Neon Pulse Frequency',
    bpm: 148,
    loop: true,
    gain: 0.76,
    stageId: 'wave',
    customPackKeys: ['bgm_wave', 'wave'],
    customIntroKeys: ['wave_intro'],
  },
  bgm_break: {
    key: 'bgm_break',
    title: 'Basalt Quarry Breaker',
    bpm: 140,
    loop: true,
    gain: 0.78,
    stageId: 'break',
    customPackKeys: ['bgm_break', 'break'],
    customIntroKeys: ['break_intro'],
  },
  bgm_cipher: {
    key: 'bgm_cipher',
    title: 'Cipher Matrix Infiltration',
    bpm: 154,
    loop: true,
    gain: 0.76,
    stageId: 'cipher',
    customPackKeys: ['bgm_cipher', 'cipher'],
    customIntroKeys: ['cipher_intro'],
  },
  bgm_final_1: {
    key: 'bgm_final_1',
    title: 'Citadel Perimeter',
    bpm: 160,
    loop: true,
    gain: 0.8,
    stageId: 'final_1',
    customPackKeys: ['bgm_final_1', 'final_1'],
    customIntroKeys: ['final_1_intro'],
  },
  bgm_final_2: {
    key: 'bgm_final_2',
    title: 'Reactor Core Ascent',
    bpm: 162,
    loop: true,
    gain: 0.8,
    stageId: 'final_2',
    customPackKeys: ['bgm_final_2', 'final_2'],
    customIntroKeys: ['final_2_intro'],
  },
  bgm_final_3: {
    key: 'bgm_final_3',
    title: 'Orbital Spire Zenith',
    bpm: 166,
    loop: true,
    gain: 0.82,
    stageId: 'final_3',
    customPackKeys: ['bgm_final_3', 'final_3'],
    customIntroKeys: ['final_3_intro'],
  },
  bgm_boss_opening: {
    key: 'bgm_boss_opening',
    title: 'Armored Siege Intercept',
    bpm: 164,
    loop: true,
    gain: 0.82,
    customPackKeys: ['bgm_boss_opening', 'boss_siege_tread', 'boss_standard'],
  },
  bgm_boss_master: {
    key: 'bgm_boss_master',
    title: 'Circuit Master Showdown',
    bpm: 168,
    loop: true,
    gain: 0.84,
    customPackKeys: ['bgm_boss_master', 'boss_standard', 'boss_prism'],
  },
  bgm_boss_final_1: {
    key: 'bgm_boss_final_1',
    title: 'Mirror Signal Duel',
    bpm: 166,
    loop: true,
    gain: 0.84,
    customPackKeys: ['bgm_boss_final_1', 'boss_mirror_rival', 'boss_standard'],
  },
  bgm_boss_final_2: {
    key: 'bgm_boss_final_2',
    title: 'Prism Core Overload',
    bpm: 164,
    loop: true,
    gain: 0.84,
    customPackKeys: ['bgm_boss_final_2', 'boss_prism_core', 'boss_standard'],
  },
  bgm_boss_final_3_p1: {
    key: 'bgm_boss_final_3_p1',
    title: 'Overlord Apex — Phase I',
    bpm: 162,
    loop: true,
    gain: 0.84,
    customPackKeys: ['bgm_boss_final_3_p1', 'boss_overlord_apex', 'boss_rush'],
  },
  bgm_boss_final_3_p2: {
    key: 'bgm_boss_final_3_p2',
    title: 'Overlord Apex — Final Circuit',
    bpm: 168,
    loop: true,
    gain: 0.86,
    customPackKeys: ['bgm_boss_final_3_p2', 'boss_overlord_apex', 'boss_rush'],
  },
  bgm_stage_clear: {
    key: 'bgm_stage_clear',
    title: 'Mission Complete Fanfare',
    bpm: 154,
    loop: false,
    gain: 0.82,
    customPackKeys: ['bgm_stage_clear', 'stage_clear'],
  },
  bgm_gameover: {
    key: 'bgm_gameover',
    title: 'Circuit Offline',
    bpm: 135,
    loop: false,
    gain: 0.76,
    customPackKeys: ['bgm_gameover', 'tension'],
  },
};

export const SFX_SPECS: Readonly<Record<SfxKey, SfxSpec>> = {
  jump: {
    key: 'jump',
    cooldownMs: 35,
    maxVoices: 3,
    baseGain: 0.42,
    pitchJitter: 0.04,
    durationMs: 110,
    priority: 5,
    customPackKeys: ['jump'],
  },
  double_jump: {
    key: 'double_jump',
    cooldownMs: 40,
    maxVoices: 3,
    baseGain: 0.46,
    pitchJitter: 0.04,
    durationMs: 130,
    priority: 6,
    customPackKeys: ['double_jump', 'jump_from_hookshot', 'jump'],
  },
  land: {
    key: 'land',
    cooldownMs: 45,
    maxVoices: 2,
    baseGain: 0.32,
    pitchJitter: 0.07,
    durationMs: 70,
    priority: 2,
    customPackKeys: ['land', 'jump_land'],
  },
  slide: {
    key: 'slide',
    cooldownMs: 80,
    maxVoices: 2,
    baseGain: 0.38,
    pitchJitter: 0.05,
    durationMs: 165,
    priority: 4,
    customPackKeys: ['slide'],
  },
  wall_jump: {
    key: 'wall_jump',
    cooldownMs: 40,
    maxVoices: 3,
    baseGain: 0.44,
    pitchJitter: 0.05,
    durationMs: 110,
    priority: 5,
    customPackKeys: ['wall_jump', 'jump'],
  },
  ledge_grab: {
    key: 'ledge_grab',
    cooldownMs: 55,
    maxVoices: 2,
    baseGain: 0.36,
    pitchJitter: 0.04,
    durationMs: 75,
    priority: 4,
    customPackKeys: ['ledge_grab'],
  },
  jab: {
    key: 'jab',
    cooldownMs: 35,
    maxVoices: 4,
    baseGain: 0.42,
    pitchJitter: 0.08,
    durationMs: 90,
    priority: 5,
    customPackKeys: ['jab', 'punch'],
  },
  sprint_kick: {
    key: 'sprint_kick',
    cooldownMs: 60,
    maxVoices: 3,
    baseGain: 0.5,
    pitchJitter: 0.06,
    durationMs: 135,
    priority: 6,
    customPackKeys: ['sprint_kick', 'punch_alt', 'punch'],
  },
  dive_kick: {
    key: 'dive_kick',
    cooldownMs: 60,
    maxVoices: 3,
    baseGain: 0.48,
    pitchJitter: 0.05,
    durationMs: 150,
    priority: 6,
    customPackKeys: ['dive_kick', 'punch'],
  },
  hit: {
    key: 'hit',
    cooldownMs: 28,
    maxVoices: 5,
    baseGain: 0.56,
    pitchJitter: 0.08,
    durationMs: 105,
    priority: 7,
    customPackKeys: ['hit', 'punch_hit'],
  },
  heavy_hit: {
    key: 'heavy_hit',
    cooldownMs: 40,
    maxVoices: 4,
    baseGain: 0.68,
    pitchJitter: 0.05,
    durationMs: 185,
    priority: 8,
    customPackKeys: ['heavy_hit', 'punch_hard_hit'],
  },
  armor_break: {
    key: 'armor_break',
    cooldownMs: 65,
    maxVoices: 3,
    baseGain: 0.7,
    pitchJitter: 0.03,
    durationMs: 300,
    priority: 9,
    customPackKeys: ['armor_break', 'guard_break'],
  },
  hook_fire: {
    key: 'hook_fire',
    cooldownMs: 45,
    maxVoices: 3,
    baseGain: 0.48,
    pitchJitter: 0.04,
    durationMs: 130,
    priority: 6,
    customPackKeys: ['hook_fire', 'hookshot_shoot'],
  },
  hook_latch: {
    key: 'hook_latch',
    cooldownMs: 40,
    maxVoices: 3,
    baseGain: 0.54,
    pitchJitter: 0.05,
    durationMs: 115,
    priority: 7,
    customPackKeys: ['hook_latch', 'hookshot_latch'],
  },
  hook_grab: {
    key: 'hook_grab',
    cooldownMs: 50,
    maxVoices: 3,
    baseGain: 0.56,
    pitchJitter: 0.04,
    durationMs: 130,
    priority: 7,
    customPackKeys: ['hook_grab', 'grab'],
  },
  throw: {
    key: 'throw',
    cooldownMs: 50,
    maxVoices: 3,
    baseGain: 0.54,
    pitchJitter: 0.06,
    durationMs: 150,
    priority: 7,
    customPackKeys: ['throw'],
  },
  bounce: {
    key: 'bounce',
    cooldownMs: 35,
    maxVoices: 4,
    baseGain: 0.5,
    pitchJitter: 0.07,
    durationMs: 125,
    priority: 6,
    customPackKeys: ['bounce', 'enemy_bounce'],
  },
  burst: {
    key: 'burst',
    cooldownMs: 90,
    maxVoices: 2,
    baseGain: 0.72,
    pitchJitter: 0.02,
    durationMs: 340,
    priority: 9,
    customPackKeys: ['burst', 'burst_flash'],
  },
  burst_freeze: {
    key: 'burst_freeze',
    cooldownMs: 120,
    maxVoices: 2,
    baseGain: 0.72,
    pitchJitter: 0.02,
    durationMs: 380,
    priority: 9,
    customPackKeys: ['burst_freeze', 'burst_flash'],
  },
  hurt: {
    key: 'hurt',
    cooldownMs: 90,
    maxVoices: 2,
    baseGain: 0.66,
    pitchJitter: 0.03,
    durationMs: 210,
    priority: 9,
    customPackKeys: ['hurt', 'player_hit'],
  },
  death: {
    key: 'death',
    cooldownMs: 250,
    maxVoices: 1,
    baseGain: 0.78,
    pitchJitter: 0.0,
    durationMs: 600,
    priority: 10,
    customPackKeys: ['death', 'player_death'],
  },
  pickup_bit: {
    key: 'pickup_bit',
    cooldownMs: 32,
    maxVoices: 4,
    baseGain: 0.42,
    pitchJitter: 0.06,
    durationMs: 140,
    priority: 4,
    customPackKeys: ['pickup_bit'],
  },
  pickup_hp: {
    key: 'pickup_hp',
    cooldownMs: 45,
    maxVoices: 3,
    baseGain: 0.5,
    pitchJitter: 0.03,
    durationMs: 210,
    priority: 6,
    customPackKeys: ['pickup_hp', 'pickup_health'],
  },
  pickup_burst: {
    key: 'pickup_burst',
    cooldownMs: 45,
    maxVoices: 3,
    baseGain: 0.5,
    pitchJitter: 0.04,
    durationMs: 190,
    priority: 6,
    customPackKeys: ['pickup_burst', 'burst_charge_get'],
  },
  rescue: {
    key: 'rescue',
    cooldownMs: 140,
    maxVoices: 2,
    baseGain: 0.66,
    pitchJitter: 0.0,
    durationMs: 400,
    priority: 9,
    customPackKeys: ['rescue'],
  },
  checkpoint: {
    key: 'checkpoint',
    cooldownMs: 160,
    maxVoices: 2,
    baseGain: 0.62,
    pitchJitter: 0.0,
    durationMs: 330,
    priority: 8,
    customPackKeys: ['checkpoint'],
  },
  switch: {
    key: 'switch',
    cooldownMs: 55,
    maxVoices: 3,
    baseGain: 0.48,
    pitchJitter: 0.04,
    durationMs: 115,
    priority: 6,
    customPackKeys: ['switch', 'door'],
  },
  breakable: {
    key: 'breakable',
    cooldownMs: 35,
    maxVoices: 4,
    baseGain: 0.54,
    pitchJitter: 0.08,
    durationMs: 195,
    priority: 6,
    customPackKeys: ['breakable', 'crate_break'],
  },
  boss_intro: {
    key: 'boss_intro',
    cooldownMs: 250,
    maxVoices: 1,
    baseGain: 0.74,
    pitchJitter: 0.0,
    durationMs: 620,
    priority: 10,
    customPackKeys: ['boss_intro', 'boss_phase2'],
  },
  boss_desperation: {
    key: 'boss_desperation',
    cooldownMs: 300,
    maxVoices: 1,
    baseGain: 0.78,
    pitchJitter: 0.0,
    durationMs: 700,
    priority: 10,
    customPackKeys: ['boss_desperation', 'boss_phase2'],
  },
  explosion: {
    key: 'explosion',
    cooldownMs: 42,
    maxVoices: 4,
    baseGain: 0.68,
    pitchJitter: 0.06,
    durationMs: 460,
    priority: 8,
    customPackKeys: ['explosion', 'enemy_explode'],
  },
  menu_move: {
    key: 'menu_move',
    cooldownMs: 25,
    maxVoices: 3,
    baseGain: 0.36,
    pitchJitter: 0.02,
    durationMs: 55,
    priority: 5,
    customPackKeys: ['menu_move'],
  },
  menu_confirm: {
    key: 'menu_confirm',
    cooldownMs: 45,
    maxVoices: 3,
    baseGain: 0.46,
    pitchJitter: 0.0,
    durationMs: 120,
    priority: 7,
    customPackKeys: ['menu_confirm'],
  },
  menu_cancel: {
    key: 'menu_cancel',
    cooldownMs: 45,
    maxVoices: 3,
    baseGain: 0.42,
    pitchJitter: 0.0,
    durationMs: 115,
    priority: 7,
    customPackKeys: ['menu_cancel'],
  },
  loadout_swap: {
    key: 'loadout_swap',
    cooldownMs: 65,
    maxVoices: 2,
    baseGain: 0.5,
    pitchJitter: 0.02,
    durationMs: 135,
    priority: 7,
    customPackKeys: ['loadout_swap', 'menu_equip'],
  },
};

export const BGM_KEYS: readonly BgmKey[] = Object.keys(BGM_TRACKS) as BgmKey[];
export const SFX_KEYS: readonly SfxKey[] = Object.keys(SFX_SPECS) as SfxKey[];

const BGM_KEY_ALIASES: Readonly<Record<string, BgmKey>> = {
  title: 'bgm_title',
  hub: 'bgm_hub',
  tutorial: 'bgm_tutorial',
  opening: 'bgm_opening',
  optic: 'bgm_optic',
  patch: 'bgm_patch',
  cooler: 'bgm_cooler',
  elec: 'bgm_elec',
  shift: 'bgm_shift',
  wave: 'bgm_wave',
  break: 'bgm_break',
  cipher: 'bgm_cipher',
  final_1: 'bgm_final_1',
  final_2: 'bgm_final_2',
  final_3: 'bgm_final_3',
  boss_rush: 'bgm_boss_final_3_p2',
  bgm_boss_rush: 'bgm_boss_final_3_p2',
  boss_siege_tread: 'bgm_boss_opening',
  boss_standard: 'bgm_boss_master',
  boss_prism: 'bgm_boss_master',
  boss_stitch: 'bgm_boss_master',
  boss_frostfang: 'bgm_boss_master',
  boss_arcbolt: 'bgm_boss_master',
  boss_strider: 'bgm_boss_master',
  boss_tempo: 'bgm_boss_master',
  boss_crag: 'bgm_boss_master',
  boss_phantom: 'bgm_boss_master',
  boss_mirror_rival: 'bgm_boss_final_1',
  boss_prism_core: 'bgm_boss_final_2',
  boss_overlord_apex: 'bgm_boss_final_3_p2',
  stage_clear: 'bgm_stage_clear',
  gameover: 'bgm_gameover',
  game_over: 'bgm_gameover',
  bgm_game_over: 'bgm_gameover',
};

const SFX_KEY_ALIASES: Readonly<Record<string, SfxKey>> = {
  jump_land: 'land',
  punch: 'jab',
  punch_alt: 'sprint_kick',
  punch_hit: 'hit',
  punch_hard_hit: 'heavy_hit',
  guard_break: 'armor_break',
  hookshot_shoot: 'hook_fire',
  hookshot_latch: 'hook_latch',
  grab: 'hook_grab',
  enemy_bounce: 'bounce',
  burst_flash: 'burst',
  player_hit: 'hurt',
  player_death: 'death',
  pickup_health: 'pickup_hp',
  pickup_health_large: 'pickup_hp',
  crate_break: 'breakable',
  barrel_break: 'breakable',
  boss_phase2: 'boss_desperation',
  enemy_explode: 'explosion',
  boss_explode: 'explosion',
  menu_equip: 'loadout_swap',
};

export function resolveBgmKey(key: string): BgmKey | undefined {
  if (key in BGM_TRACKS) {
    return key as BgmKey;
  }
  const normalized = key.trim().toLowerCase();
  if (normalized in BGM_TRACKS) {
    return normalized as BgmKey;
  }
  return BGM_KEY_ALIASES[normalized];
}

export function resolveSfxKey(key: string): SfxKey | undefined {
  if (key in SFX_SPECS) {
    return key as SfxKey;
  }
  const normalized = key.trim().toLowerCase();
  if (normalized in SFX_SPECS) {
    return normalized as SfxKey;
  }
  return SFX_KEY_ALIASES[normalized];
}

export function getTrackSpec(key: string): BgmTrackSpec | undefined {
  const resolved = resolveBgmKey(key);
  return resolved ? BGM_TRACKS[resolved] : undefined;
}

export function getSfxSpec(key: string): SfxSpec | undefined {
  const resolved = resolveSfxKey(key);
  return resolved ? SFX_SPECS[resolved] : undefined;
}
