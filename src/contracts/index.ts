// ============================================================================
// Krunked Circuit — Master Contracts & Extracted Ground-Truth Constants
// Single Source of Truth shared by src/sim, src/data, src/render, src/audio,
// src/input, src/assets, src/ui, src/app, tools/, scripts/verify/, and tests/.
// ============================================================================

export const ENGINE_CONSTANTS = {
  SIM_HZ: 60,
  FIXED_DT: 1 / 60,
  GAME_WIDTH: 400,
  GAME_HEIGHT: 240,
  TILE_SIZE: 16,
  CELL_TILES_W: 25,
  CELL_TILES_H: 15,
  DELAY_CAMERA_TRANSITION: 5,
  CAMERA_JUMP_MARGIN: 15,
  SAVE_STORAGE_KEY: 'krunked_circuit_save_v1',
  SAVE_SCHEMA_VERSION: 1,
} as const;

export const PLAYER_PHYSICS = {
  STAND_W: 14,
  STAND_H: 28,
  SPRITE_OFFSET_X: 8,
  SPRITE_OFFSET_Y: 4,
  SLIDE_W: 14,
  SLIDE_H: 14,
  WALK_MAX_SPEED: 2.0,
  SPRINT_MAX_SPEED: 4.0,
  OVERLOAD_WALK_SPEED: 3.0,
  OVERLOAD_SPRINT_SPEED: 5.0,
  OVERLOAD_DURATION_TICKS: 400,
  OVERLOAD_DAMAGE_MULT: 1.4,
  SPEED_ARMOR_BONUS: 0.5,
  RUNNING_FRICTION: 0.5,
  RUNNING_FRICTION_TURN: 0.5,
  ICE_FRICTION: 0.08,
  GRAVITY: 0.25,
  MAX_FALL_SPEED: 5.75,
  HEAVY_ARMOR_FALL_BONUS: 3.0,
  FAST_FALL_ACCEL: 0.25,
  FAST_FALL_VY_THRESHOLD: 0.5,
  JUMP_IMPULSE: -5.25,
  DOUBLE_JUMP_IMPULSE: -4.25,
  TRIPLE_JUMP_IMPULSE: -3.25,
  JUMP_RELEASE_DAMP: 0.5,
  COYOTE_TICKS: 4,
  JUMP_BUFFER_TICKS: 5,
  WALL_SLIDE_MAX_SPEED: 2.0,
  WALL_SLIDE_GRIP_SPEED: 0.0,
  WALL_JUMP_BUFFER_MAX: 4,
  WALL_JUMP_STEER_AWAY_BONUS: 4,
  WALL_JUMP_MAX_TIME: 30,
  WALL_JUMP_LEEWAY: 4.5,
  WALL_JUMP_IMPULSE_Y: -5.0,
  WALL_JUMP_IMPULSE_X: 3.4,
  SLIDE_SPEED: 4.25,
  SLIDE_DURATION_TICKS: 22,
  SLIDE_COOLDOWN_TICKS: 6,
  STARTING_MAX_HP: 16,
  MAX_BOOSTED_HP: 32,
  HP_PER_BOOSTER: 4,
  CIRCUIT_MODE_HP_PER_BOOSTER: 2,
  STARTING_MAX_BURST: 2,
  MAX_BOOSTED_BURST: 6,
  BURST_ENERGY_PER_CHARGE: 100,
  CIRCUIT_MODE_MAX_BURST: 2,
  INVULN_BASE_TICKS: 100,
  PROTECTION_TIMER_MULT: 1.5,
  WEAK_ARMOR_INVULN_MULT: 0.8,
  HAZARD_WARP_INVULN_TICKS: 16,
  SPEED_BASHER_DAMAGE: 1.55,
  SCARF_NODE_COUNT: 7,
  SCARF_SEGMENT_LEN: 3.5,
} as const;

export const HOOKSHOT_CONSTANTS = {
  TIP_W: 4,
  TIP_H: 4,
  MAX_SPEED: 30.0,
  SUBSTEP_MAX_PX: 4.0,
  TIMER_MAX: 13,
  DEACCEL_OUTWARD: 3.8,
  DEACCEL_INWARD: 1.5,
  EXTENSION_LENGTH: 12,
  SWING_ROPE_MAX_LEN: 130,
  ZIP_SPEED: 8.5,
  CHAIN_BOOSTER_BONUS_DMG: 1,
  CHAIN_BOOSTER_EXTRA_TICKS: 3,
  THROW_VX_NEUTRAL: 6.0,
  THROW_VX_DIAGONAL: 4.0,
  THROW_VX_SPRINT_BONUS: 1.25,
  THROW_VY_NEUTRAL: -2.0,
  THROW_VY_UP: -6.0,
  THROW_VY_DOWN: 3.0,
  THROW_COLLISION_DAMAGE: 5,
  THROW_BOUNCE_DAMAGE: 5,
  SHIELD_PROJECTILE_HP: 3,
} as const;

export interface AttackSpec {
  readonly id: AttackId;
  readonly damage: number;
  readonly activeTicks: number;
  readonly startupTicks: number;
  readonly recoveryTicks: number;
  readonly freezeTicks: number;
  readonly width: number;
  readonly height: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly powerExtenderBonusW: number;
  readonly armorBreak: boolean;
  readonly bounceOnHit: boolean;
  readonly knockbackX: number;
  readonly knockbackY: number;
}

export type AttackId =
  | 'jabNeutral'
  | 'jabWalk'
  | 'jabCrouch'
  | 'sprintKick'
  | 'hopKick'
  | 'airJab'
  | 'airKick'
  | 'airUpKick'
  | 'diveKick'
  | 'diveKickHeavy'
  | 'ledgeJab'
  | 'wallSlideJab';

export const ATTACK_DATA: Record<AttackId, AttackSpec> = {
  jabNeutral: {
    id: 'jabNeutral',
    damage: 1,
    activeTicks: 10,
    startupTicks: 2,
    recoveryTicks: 6,
    freezeTicks: 1,
    width: 41,
    height: 28,
    offsetX: 8,
    offsetY: 0,
    powerExtenderBonusW: 16,
    armorBreak: false,
    bounceOnHit: false,
    knockbackX: 2.0,
    knockbackY: -1.0,
  },
  jabWalk: {
    id: 'jabWalk',
    damage: 1,
    activeTicks: 8,
    startupTicks: 2,
    recoveryTicks: 6,
    freezeTicks: 1,
    width: 42,
    height: 28,
    offsetX: 8,
    offsetY: 0,
    powerExtenderBonusW: 16,
    armorBreak: false,
    bounceOnHit: false,
    knockbackX: 2.25,
    knockbackY: -1.0,
  },
  jabCrouch: {
    id: 'jabCrouch',
    damage: 1,
    activeTicks: 8,
    startupTicks: 2,
    recoveryTicks: 6,
    freezeTicks: 1,
    width: 42,
    height: 26,
    offsetX: 8,
    offsetY: -6,
    powerExtenderBonusW: 16,
    armorBreak: false,
    bounceOnHit: false,
    knockbackX: 2.0,
    knockbackY: -1.0,
  },
  sprintKick: {
    id: 'sprintKick',
    damage: 2,
    activeTicks: 11,
    startupTicks: 2,
    recoveryTicks: 8,
    freezeTicks: 4,
    width: 33,
    height: 24,
    offsetX: 10,
    offsetY: 0,
    powerExtenderBonusW: 16,
    armorBreak: true,
    bounceOnHit: true,
    knockbackX: 4.5,
    knockbackY: -2.25,
  },
  hopKick: {
    id: 'hopKick',
    damage: 1,
    activeTicks: 10,
    startupTicks: 2,
    recoveryTicks: 7,
    freezeTicks: 2,
    width: 43,
    height: 40,
    offsetX: 6,
    offsetY: -12,
    powerExtenderBonusW: 16,
    armorBreak: true,
    bounceOnHit: false,
    knockbackX: 1.0,
    knockbackY: -5.5,
  },
  airJab: {
    id: 'airJab',
    damage: 1,
    activeTicks: 10,
    startupTicks: 2,
    recoveryTicks: 5,
    freezeTicks: 1,
    width: 40,
    height: 28,
    offsetX: 8,
    offsetY: 0,
    powerExtenderBonusW: 16,
    armorBreak: false,
    bounceOnHit: false,
    knockbackX: 2.0,
    knockbackY: -1.2,
  },
  airKick: {
    id: 'airKick',
    damage: 1,
    activeTicks: 10,
    startupTicks: 2,
    recoveryTicks: 5,
    freezeTicks: 1,
    width: 40,
    height: 28,
    offsetX: 8,
    offsetY: 0,
    powerExtenderBonusW: 16,
    armorBreak: false,
    bounceOnHit: false,
    knockbackX: 2.5,
    knockbackY: -1.5,
  },
  airUpKick: {
    id: 'airUpKick',
    damage: 1,
    activeTicks: 8,
    startupTicks: 2,
    recoveryTicks: 6,
    freezeTicks: 1,
    width: 45,
    height: 42,
    offsetX: 6,
    offsetY: -14,
    powerExtenderBonusW: 16,
    armorBreak: true,
    bounceOnHit: false,
    knockbackX: 1.0,
    knockbackY: -5.0,
  },
  diveKick: {
    id: 'diveKick',
    damage: 1,
    activeTicks: 16,
    startupTicks: 1,
    recoveryTicks: 4,
    freezeTicks: 1,
    width: 26,
    height: 33.5,
    offsetX: 0,
    offsetY: 8,
    powerExtenderBonusW: 10,
    armorBreak: false,
    bounceOnHit: true,
    knockbackX: 1.5,
    knockbackY: -3.5,
  },
  diveKickHeavy: {
    id: 'diveKickHeavy',
    damage: 2,
    activeTicks: 18,
    startupTicks: 1,
    recoveryTicks: 4,
    freezeTicks: 1,
    width: 26,
    height: 33.5,
    offsetX: 0,
    offsetY: 8,
    powerExtenderBonusW: 10,
    armorBreak: true,
    bounceOnHit: true,
    knockbackX: 2.5,
    knockbackY: -4.2,
  },
  ledgeJab: {
    id: 'ledgeJab',
    damage: 1,
    activeTicks: 10,
    startupTicks: 2,
    recoveryTicks: 6,
    freezeTicks: 1,
    width: 51,
    height: 37,
    offsetX: 4,
    offsetY: -8,
    powerExtenderBonusW: 16,
    armorBreak: false,
    bounceOnHit: false,
    knockbackX: 2.5,
    knockbackY: -2.0,
  },
  wallSlideJab: {
    id: 'wallSlideJab',
    damage: 1,
    activeTicks: 10,
    startupTicks: 2,
    recoveryTicks: 6,
    freezeTicks: 1,
    width: 51,
    height: 37,
    offsetX: 4,
    offsetY: -6,
    powerExtenderBonusW: 16,
    armorBreak: false,
    bounceOnHit: false,
    knockbackX: 2.5,
    knockbackY: -2.0,
  },
};

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface DifficultyDamageTable {
  readonly difficultyIndex: 0 | 1 | 2;
  readonly invulnMult: number;
  readonly lightContact: number;
  readonly mediumContact: number;
  readonly heavyContact: number;
  readonly lightProjectile: number;
  readonly mediumProjectile: number;
  readonly heavyProjectile: number;
  readonly explosion: number;
  readonly hazard: number;
  readonly collision: number;
  readonly bounce: number;
}

export const DAMAGE_TABLES: Record<Difficulty, DifficultyDamageTable> = {
  normal: {
    difficultyIndex: 0,
    invulnMult: 1.0,
    lightContact: 2,
    mediumContact: 3,
    heavyContact: 4,
    lightProjectile: 2,
    mediumProjectile: 3,
    heavyProjectile: 5,
    explosion: 3,
    hazard: 5,
    collision: 5,
    bounce: 5,
  },
  easy: {
    difficultyIndex: 1,
    invulnMult: 1.5,
    lightContact: 1,
    mediumContact: 2,
    heavyContact: 2,
    lightProjectile: 2,
    mediumProjectile: 2,
    heavyProjectile: 4,
    explosion: 2,
    hazard: 3,
    collision: 5,
    bounce: 4,
  },
  hard: {
    difficultyIndex: 2,
    invulnMult: 0.8,
    lightContact: 3,
    mediumContact: 4,
    heavyContact: 5,
    lightProjectile: 3,
    mediumProjectile: 4,
    heavyProjectile: 6,
    explosion: 4,
    hazard: 6,
    collision: 5,
    bounce: 6,
  },
};

export const BOSS_CONSTANTS = {
  STANDARD_HP: 32,
  STANDARD_DESPERATION_HP: 16,
  FINAL_HP: 48,
  FINAL_DESPERATION_HP: 32,
  TECH_RECOVER_TICKS: 90,
  MINIBOSS_HP_NORMAL: 20,
  MINIBOSS_HP_RUDE: 25,
  RUDE_SINGLE_HIT_FACTOR: 0.55,
  HP_BAR_SEGMENT: 16,
} as const;

export const ECONOMY_CONSTANTS = {
  BIT_DENOMINATIONS: [1, 5, 10, 50] as const,
  RESCUES_PER_MAIN_STAGE: 8,
  MAIN_STAGE_COUNT: 8,
  TOTAL_RESCUES: 64,
  LOADOUT_COUNT: 3,
  BURST_SLOTS_PER_LOADOUT: 4,
  CHIP_SLOTS_PER_LOADOUT: 3,
  FARM_CAP_PER_ENEMY_ID: 6,
} as const;

export const CONTENT_COUNTS = {
  OFFICIAL_MAPS: 15,
  REMIX_MAPS: 12,
  TOTAL_LAYOUTS: 27,
  BURST_TECHNIQUES: 20,
  BOOSTER_CHIPS: 20,
  ARMOR_PAINTS: 12,
  BOSSES: 12,
  MINIBOSSES: 3,
  ENEMY_ARCHETYPES: 42,
  RESCUES: 64,
  CHALLENGES: 53,
  DATACHIPS: 100,
} as const;

export const GAMEPAD_CONSTANTS = {
  STICK_DEADZONE: 0.22,
  TRIGGER_THRESHOLD: 0.35,
  TOUCH_IDLE_OPACITY: 0.32,
  TOUCH_ACTIVE_OPACITY: 0.62,
} as const;

// ----------------------------------------------------------------------------
// Stage, Biome, Boss, Miniboss, Enemy, Burst, Chip & Armor Identifiers
// ----------------------------------------------------------------------------

export type StageId =
  | 'hub'
  | 'tutorial'
  | 'opening'
  | 'optic'
  | 'patch'
  | 'cooler'
  | 'elec'
  | 'shift'
  | 'wave'
  | 'break'
  | 'cipher'
  | 'final_1'
  | 'final_2'
  | 'final_3'
  | 'boss_rush';

export const OFFICIAL_STAGE_IDS: readonly StageId[] = [
  'hub',
  'tutorial',
  'opening',
  'optic',
  'patch',
  'cooler',
  'elec',
  'shift',
  'wave',
  'break',
  'cipher',
  'final_1',
  'final_2',
  'final_3',
  'boss_rush',
] as const;

export const MAIN_EIGHT_STAGES: readonly StageId[] = [
  'optic',
  'patch',
  'cooler',
  'elec',
  'shift',
  'wave',
  'break',
  'cipher',
] as const;

export const REMIXABLE_STAGES: readonly StageId[] = [
  'opening',
  'optic',
  'patch',
  'cooler',
  'elec',
  'shift',
  'wave',
  'break',
  'cipher',
  'final_1',
  'final_2',
  'final_3',
] as const;

export type BossId =
  | 'siege_tread'
  | 'prism'
  | 'stitch'
  | 'frostfang'
  | 'arcbolt'
  | 'strider'
  | 'tempo'
  | 'crag'
  | 'phantom'
  | 'mirror_rival'
  | 'prism_core'
  | 'overlord_apex';

export type MinibossId = 'junk_colossus' | 'sky_gunship' | 'wrecker_tank';

export type BurstId =
  | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20;

export type ChipId =
  | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20;

export type ArmorPaintId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export type Palette6 = readonly [string, string, string, string, string, string];

export type GameMode = 'standard' | 'circuit' | 'boss_rush' | 'speedrun';

export interface CustomModifiers {
  masterLevels: boolean;
  rudeEnemies: boolean;
  doubleHazards: boolean;
  singleCredit: boolean;
  ironCircuit: boolean;
  mirrorWorld: boolean;
}

export interface BurstSlots {
  neutral: BurstId | 0;
  side: BurstId | 0;
  up: BurstId | 0;
  down: BurstId | 0;
}

export interface Loadout {
  name: string;
  bursts: BurstSlots;
  chips: [ChipId | 0, ChipId | 0, ChipId | 0];
  armorPaint: ArmorPaintId;
}

// ----------------------------------------------------------------------------
// Declarative Content Definitions
// ----------------------------------------------------------------------------

export interface BurstDefinition {
  readonly id: BurstId;
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly costCharges: number;
  readonly baseDamage: number;
  readonly priceBits: number;
  readonly unlockStage?: StageId;
  readonly iconKey: string;
  readonly color: string;
  readonly starter?: boolean;
}

export interface ChipDefinition {
  readonly id: ChipId;
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly part: 'circuit' | 'head' | 'body' | 'arms' | 'legs';
  readonly priceBits: number;
  readonly rescueTokens: number;
  readonly iconKey: string;
  readonly starter?: boolean;
}

export interface ArmorPaintDefinition {
  readonly id: ArmorPaintId;
  readonly key: string;
  readonly name: string;
  readonly traitName: string;
  readonly description: string;
  readonly unlockStage?: StageId;
  readonly palette: Palette6;
}

export type EnemyFamily =
  | 'trooper'
  | 'shield_guard'
  | 'turret'
  | 'hopper'
  | 'flyer'
  | 'crawler'
  | 'spawner'
  | 'hazard'
  | 'dummy';

export interface EnemyArchetype {
  readonly id: string;
  readonly index: number;
  readonly name: string;
  readonly family: EnemyFamily;
  readonly hp: number;
  readonly width: number;
  readonly height: number;
  readonly contactTier: 'light' | 'medium' | 'heavy';
  readonly projectileTier?: 'light' | 'medium' | 'heavy';
  readonly shielded?: boolean;
  readonly grabbableWhenStunned: boolean;
  readonly speed: number;
  readonly dropBits: number;
  readonly biomeTag: StageId;
  readonly spriteKey: string;
  readonly palette: Palette6;
}

export interface BossDefinition {
  readonly id: BossId;
  readonly stageId: StageId;
  readonly name: string;
  readonly title: string;
  readonly baseHp: number;
  readonly desperationHp: number;
  readonly width: number;
  readonly height: number;
  readonly palette: Palette6;
  readonly bgmKey: string;
  readonly phases: number;
  readonly isFinal?: boolean;
}

export interface ChallengeDefinition {
  readonly id: string;
  readonly index: number;
  readonly name: string;
  readonly description: string;
  readonly category: 'combat' | 'movement' | 'boss' | 'collectible' | 'mode';
  readonly rewardBits: number;
}

export interface DataChipDefinition {
  readonly id: string;
  readonly index: number;
  readonly title: string;
  readonly category: 'enemy' | 'boss' | 'hero' | 'world' | 'tech';
  readonly lore: string;
  readonly relatedKey: string;
}

// ----------------------------------------------------------------------------
// Tilemap & Stage Layout Contracts
// ----------------------------------------------------------------------------

export const enum TileType {
  EMPTY = 0,
  SOLID = 1,
  ONE_WAY = 2,
  SPIKE = 3,
  BREAKABLE = 4,
  ICE = 5,
  CONVEYOR_L = 6,
  CONVEYOR_R = 7,
  ELECTRIC_RAIL = 8,
  TOGGLE_A = 9,
  TOGGLE_B = 10,
  BOUNCE_PAD = 11,
  LASER_MIRROR = 12,
  CAMERA_BLOCKER = 13,
  CHECKPOINT = 14,
  GOAL_DOOR = 15,
  CRUSHER = 16,
  PROXIMITY_SOLID = 17,
}

export type BiomeGimmick =
  | 'hub_command'
  | 'tutorial_course'
  | 'metro_train'
  | 'solar_lasers'
  | 'scrap_crushers'
  | 'cryo_wind'
  | 'surge_rails'
  | 'skyway_convoy'
  | 'pulse_rhythm'
  | 'quarry_walker'
  | 'neon_matrix'
  | 'citadel_gauntlet'
  | 'core_reactor'
  | 'orbital_spire'
  | 'boss_rush_arena';

export interface SpawnPoint {
  readonly id: string;
  readonly kind:
    | 'enemy'
    | 'boss'
    | 'miniboss'
    | 'rescue'
    | 'health_booster'
    | 'burst_booster'
    | 'palette_chip'
    | 'crate'
    | 'barrel'
    | 'switch'
    | 'checkpoint'
    | 'hub_terminal'
    | 'walker';
  readonly x: number;
  readonly y: number;
  readonly archetypeId?: string;
  readonly bossId?: BossId;
  readonly minibossId?: MinibossId;
  readonly terminalKind?: HubTerminalKind;
  readonly armorPaintId?: ArmorPaintId;
  readonly rescueIndex?: number;
}

export type HubTerminalKind =
  | 'mission_select'
  | 'medbay_chips'
  | 'burst_dojo'
  | 'paint_bay'
  | 'training_room'
  | 'compendium'
  | 'challenges'
  | 'refight_terminal';

export interface StageDefinition {
  readonly id: StageId;
  readonly name: string;
  readonly subtitle: string;
  readonly remix: boolean;
  readonly biomeGimmick: BiomeGimmick;
  readonly bgmKey: string;
  readonly bossBgmKey: string;
  readonly bossId?: BossId;
  readonly minibossId?: MinibossId;
  readonly cellsW: number;
  readonly cellsH: number;
  readonly tilesW: number;
  readonly tilesH: number;
  readonly tiles: readonly number[];
  readonly spawnX: number;
  readonly spawnY: number;
  readonly bossCellX: number;
  readonly bossCellY: number;
  readonly spawns: readonly SpawnPoint[];
  readonly palette: {
    readonly skyTop: string;
    readonly skyBottom: string;
    readonly farBg: string;
    readonly midBg: string;
    readonly tilePrimary: string;
    readonly tileHighlight: string;
    readonly tileShadow: string;
    readonly accent: string;
  };
  readonly heatHaze?: boolean;
  readonly windForce?: number;
  readonly hasStars?: boolean;
}

// ----------------------------------------------------------------------------
// Input, Gamepad & Touch Contracts (TASTE_NOTES Enforced)
// ----------------------------------------------------------------------------

export type InputModality = 'keyboard' | 'gamepad' | 'touch';
export type GamepadPreset = 'default' | 'shoulder_hook';
export type ActionKey =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'jump'
  | 'attack'
  | 'hookshot'
  | 'burst'
  | 'sprint'
  | 'slide'
  | 'swapLoadout'
  | 'pause'
  | 'accept'
  | 'cancel'
  | 'map';

export interface ControlBindings {
  keyboard: Record<ActionKey, string>;
  gamepadPreset: GamepadPreset;
  gamepadDeadzone: number;
  gamepadTriggerThreshold: number;
  rumbleEnabled: boolean;
}

export interface InputFrame {
  moveX: -1 | 0 | 1;
  moveY: -1 | 0 | 1;
  aimX: -1 | 0 | 1;
  aimY: -1 | 0 | 1;
  jump: boolean;
  jumpPressed: boolean;
  jumpReleased: boolean;
  attack: boolean;
  attackPressed: boolean;
  hookshot: boolean;
  hookshotPressed: boolean;
  burst: boolean;
  burstPressed: boolean;
  sprint: boolean;
  slide: boolean;
  slidePressed: boolean;
  swapLoadoutPressed: boolean;
  pausePressed: boolean;
  acceptPressed: boolean;
  cancelPressed: boolean;
  mapPressed: boolean;
  modality: InputModality;
}

export interface TouchOverlayState {
  visible: boolean;
  opacityIdle: number;
  opacityActive: number;
  stickDx: number;
  stickDy: number;
  activeButtons: Record<string, boolean>;
}

export interface SimulatedGamepadState {
  id: string;
  connected: boolean;
  axes: [number, number, number, number];
  buttons: number[];
}

// ----------------------------------------------------------------------------
// Simulation Runtime State (100% Pure, DOM-Free, Deterministic)
// ----------------------------------------------------------------------------

export interface Vec2 {
  x: number;
  y: number;
}

export type PlayerActionState =
  | 'idle'
  | 'walk'
  | 'sprint'
  | 'jump'
  | 'fall'
  | 'wall_slide'
  | 'ledge_hang'
  | 'slide'
  | 'attack'
  | 'dive_kick'
  | 'hook_zip'
  | 'hook_swing'
  | 'burst'
  | 'hurt'
  | 'warp'
  | 'victory'
  | 'dead';

export interface HookshotState {
  phase: 'idle' | 'extending' | 'latched_wall' | 'swinging' | 'retracting' | 'holding';
  tipX: number;
  tipY: number;
  vx: number;
  vy: number;
  dirX: number;
  dirY: number;
  timer: number;
  ropeLen: number;
  swingAngle: number;
  swingAngVel: number;
  latchedTileX: number;
  latchedTileY: number;
  heldKind: 'none' | 'enemy' | 'shield' | 'crate' | 'barrel' | 'platform';
  heldEntityId: number;
  heldSpriteKey: string;
  heldDamage: number;
  remoteBombTargetId: number;
}

export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  facing: -1 | 1;
  grounded: boolean;
  onIce: boolean;
  onWall: -1 | 0 | 1;
  onLedge: -1 | 0 | 1;
  ledgeTimer: number;
  crouching: boolean;
  sliding: boolean;
  slideTimer: number;
  slideCooldown: number;
  leftGroundTick: number;
  jumpBufferTick: number;
  wallJumpBufferTick: number;
  wallJumpDir: -1 | 0 | 1;
  wallJumpLockTimer: number;
  airJumpsUsed: number;
  diveKickTicks: number;
  action: PlayerActionState;
  animTick: number;
  attackId: AttackId | null;
  attackTimer: number;
  attackHitIds: number[];
  hp: number;
  maxHp: number;
  burstEnergy: number;
  maxBurstCharges: number;
  invulnTimer: number;
  hurtTimer: number;
  overloadTimer: number;
  freezeFieldTimer: number;
  barrierHits: number;
  barrierTimer: number;
  cloneTimer: number;
  nullifyCooldown: number;
  nullifyReady: boolean;
  comboCount: number;
  comboTimer: number;
  inWalker: boolean;
  walkerHp: number;
  lastSafeX: number;
  lastSafeY: number;
  scarf: Vec2[];
  hook: HookshotState;
  warpTimer: number;
}

export interface EnemyEntity {
  id: number;
  archetypeId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  facing: -1 | 1;
  hp: number;
  maxHp: number;
  shielded: boolean;
  stunTimer: number;
  hurtFlash: number;
  aiTimer: number;
  aiPhase: number;
  homeX: number;
  homeY: number;
  grounded: boolean;
  grabbed: boolean;
  dead: boolean;
  isMiniboss: boolean;
  minibossId?: MinibossId;
  spawnId: string;
}

export interface BossEntity {
  id: number;
  bossId: BossId;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  facing: -1 | 1;
  hp: number;
  maxHp: number;
  desperationHp: number;
  phase: 1 | 2 | 3;
  desperationTriggered: boolean;
  desperationBannerTicks: number;
  aiState: 'intro' | 'idle' | 'telegraph' | 'attack' | 'recover' | 'desperation' | 'defeated';
  aiTimer: number;
  patternIndex: number;
  mimicIndex: number;
  hurtFlash: number;
  techRecoverTimer: number;
  launchHits: number;
  invulnTimer: number;
  active: boolean;
  defeated: boolean;
  arenaLeft: number;
  arenaRight: number;
  arenaTop: number;
  arenaBottom: number;
  /** Final boss multi-part targets: left hand, right hand, eye/forehead */
  partsHp: [number, number, number];
}

export interface ProjectileEntity {
  id: number;
  owner: 'player' | 'enemy' | 'boss' | 'thrown';
  kind:
    | 'thrown_enemy'
    | 'thrown_shield'
    | 'thrown_crate'
    | 'thrown_barrel'
    | 'enemy_shot'
    | 'laser_beam'
    | 'shockwave'
    | 'electric_arc'
    | 'burst_beam'
    | 'hologram_mine'
    | 'support_platform'
    | 'dive_beam'
    | 'phase_ball';
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  damage: number;
  ttl: number;
  pierce: boolean;
  bouncesLeft: number;
  color: string;
  solid?: boolean;
  hitIds: number[];
}

export interface PickupEntity {
  id: number;
  kind: 'bit_1' | 'bit_5' | 'bit_10' | 'bit_50' | 'health_small' | 'health_large' | 'burst_orb' | 'rescue' | 'health_booster' | 'burst_booster' | 'palette_chip';
  x: number;
  y: number;
  vx: number;
  vy: number;
  value: number;
  ttl: number;
  collected: boolean;
  spawnId?: string;
  armorPaintId?: ArmorPaintId;
  rescueIndex?: number;
}

export interface PropEntity {
  id: number;
  kind: 'crate' | 'barrel' | 'switch' | 'checkpoint' | 'hub_terminal' | 'walker';
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  activated: boolean;
  grabbed: boolean;
  terminalKind?: HubTerminalKind;
  spawnId: string;
}

export interface CameraState {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  cellX: number;
  cellY: number;
  transitionTimer: number;
  lockedBossArena: boolean;
  shakeTimer: number;
  shakeIntensity: number;
}

export interface StageStats {
  stageId: StageId;
  remix: boolean;
  elapsedTicks: number;
  damageTaken: number;
  enemiesDefeated: number;
  rescuesCollected: number;
  bitsCollected: number;
  deaths: number;
  rank: 'S' | 'A' | 'B' | 'C';
}

export interface BossRushState {
  active: boolean;
  bossOrder: BossId[];
  currentIndex: number;
  splitTicks: number[];
  totalTicks: number;
}

export interface ProgressionState {
  bits: number;
  rescueTokens: number;
  totalRescues: number;
  rescuedIds: string[];
  clearedStages: StageId[];
  clearedRemixes: StageId[];
  collectedHealthBoosters: StageId[];
  collectedBurstBoosters: StageId[];
  unlockedBursts: BurstId[];
  unlockedChips: ChipId[];
  unlockedArmors: ArmorPaintId[];
  unlockedChallenges: string[];
  unlockedDataChips: string[];
  loadouts: [Loadout, Loadout, Loadout];
  activeLoadoutIndex: 0 | 1 | 2;
  difficulty: Difficulty;
  mode: GameMode;
  modifiers: CustomModifiers;
  bestTimesTicks: Partial<Record<StageId, number>>;
  farmCounts: Record<string, number>;
}

export type ScreenMode =
  | 'title'
  | 'file_select'
  | 'playing'
  | 'paused'
  | 'stage_clear'
  | 'game_over'
  | 'hub_modal';

export interface SimState {
  tick: number;
  rngState: number;
  screen: ScreenMode;
  activeHubTerminal: HubTerminalKind | null;
  stageId: StageId;
  remix: boolean;
  tilesW: number;
  tilesH: number;
  tiles: number[];
  biomeGimmick: BiomeGimmick;
  togglePhase: boolean;
  rhythmBeat: number;
  windForce: number;
  hitstopTicks: number;
  stageClearTimer: number;
  nextEntityId: number;
  player: PlayerState;
  camera: CameraState;
  enemies: EnemyEntity[];
  boss: BossEntity | null;
  projectiles: ProjectileEntity[];
  pickups: PickupEntity[];
  props: PropEntity[];
  progression: ProgressionState;
  stageStats: StageStats;
  bossRush: BossRushState;
  events: SimEvent[];
}

export type SimEvent =
  | { type: 'sfx'; key: string; pan?: number; pitchJitter?: number; gain?: number }
  | { type: 'bgm'; key: string; fadeMs?: number }
  | { type: 'bgmStem'; stem: 'command' | 'medbay' | 'dojo' }
  | { type: 'particle'; kind: 'spark' | 'dust' | 'burst' | 'hit' | 'shard' | 'heal' | 'explosion' | 'shockring'; x: number; y: number; color: string; count: number; vx?: number; vy?: number }
  | { type: 'shake'; ticks: number; intensity: number }
  | { type: 'rumble'; weak: number; strong: number; durationMs: number }
  | { type: 'toast'; text: string; tone?: 'info' | 'unlock' | 'warn' }
  | { type: 'bossIntro'; bossId: BossId; name: string; title: string }
  | { type: 'stageClear'; stats: StageStats }
  | { type: 'gameOver' }
  | { type: 'checkpoint'; x: number; y: number }
  | { type: 'rescue'; index: number; total: number }
  | { type: 'challengeUnlock'; id: string; name: string }
  | { type: 'datachipUnlock'; id: string; title: string };

// ----------------------------------------------------------------------------
// Renderer, Audio, Asset Pack & Save Contracts
// ----------------------------------------------------------------------------

export type TargetFps = 30 | 60 | 120;
export type AssetMode = 'BUILTIN' | 'CUSTOM_PACK';
export type ScaleMode = 'integer' | 'fit' | 'fill';

export interface RenderSettings {
  targetFps: TargetFps;
  classicSnap60: boolean;
  scaleMode: ScaleMode;
  aimReticle: boolean;
  screenShake: boolean;
  assetMode: AssetMode;
  showSpeedrunTimer: boolean;
}

export interface AudioSettings {
  masterVolume: number;
  bgmVolume: number;
  sfxVolume: number;
  muted: boolean;
}

export interface SaveData {
  schemaVersion: number;
  updatedAt: string;
  progression: ProgressionState;
  renderSettings: RenderSettings;
  audioSettings: AudioSettings;
  controls: ControlBindings;
}

export interface AssetPackManifest {
  version: number;
  source: string;
  extractedAt: string;
  counts: {
    images: number;
    audioMusic: number;
    audioSfx: number;
    maps: number;
    palettes: number;
  };
  sprites: Record<string, string>;
  tilesets: Record<string, string>;
  backgrounds: Record<string, string>;
  audioMusic: Record<string, string>;
  audioSfx: Record<string, string>;
}

export interface RenderSnapshot {
  tick: number;
  playerX: number;
  playerY: number;
  cameraX: number;
  cameraY: number;
  hookTipX: number;
  hookTipY: number;
  enemyPos: Record<number, Vec2>;
  bossPos: Vec2 | null;
  projPos: Record<number, Vec2>;
}

export interface KrunkedDebugBridge {
  getState: () => SimState;
  getHash: () => string;
  getFps: () => number;
  getRenderSettings: () => RenderSettings;
  setRenderSettings: (partial: Partial<RenderSettings>) => void;
  getAudioSettings: () => AudioSettings;
  setAudioSettings: (partial: Partial<AudioSettings>) => void;
  getModality: () => InputModality;
  getTouchOverlayState: () => TouchOverlayState;
  getAssetMode: () => AssetMode;
  setAssetMode: (mode: AssetMode) => Promise<void>;
  loadStage: (stageId: StageId, remix?: boolean) => void;
  startGame: (stageId?: StageId, remix?: boolean) => void;
  warpToBoss: () => void;
  spawnEnemy: (archetypeId: string, x: number, y: number) => number;
  setPlayerHp: (hp: number) => void;
  setPlayerBurst: (energy: number) => void;
  unlockAll: () => void;
  equipLoadout: (index: 0 | 1 | 2) => void;
  equipArmor: (armorId: ArmorPaintId) => void;
  setDifficulty: (diff: Difficulty) => void;
  setModifiers: (partial: Partial<CustomModifiers>) => void;
  setGameMode: (mode: GameMode) => void;
  stepTicks: (ticks: number, overrideInput?: Partial<InputFrame>) => string;
  simulateGamepad: (state: SimulatedGamepadState | null) => void;
  openHubTerminal: (kind: HubTerminalKind | null) => void;
  getCustomPackAvailable: () => boolean;
}

declare global {
  interface Window {
    __KRUNKED_DEBUG__?: KrunkedDebugBridge;
  }
}

export function createNeutralInput(modality: InputModality = 'keyboard'): InputFrame {
  return {
    moveX: 0,
    moveY: 0,
    aimX: 0,
    aimY: 0,
    jump: false,
    jumpPressed: false,
    jumpReleased: false,
    attack: false,
    attackPressed: false,
    hookshot: false,
    hookshotPressed: false,
    burst: false,
    burstPressed: false,
    sprint: false,
    slide: false,
    slidePressed: false,
    swapLoadoutPressed: false,
    pausePressed: false,
    acceptPressed: false,
    cancelPressed: false,
    mapPressed: false,
    modality,
  };
}

export const DEFAULT_CONTROL_BINDINGS: ControlBindings = {
  keyboard: {
    left: 'ArrowLeft',
    right: 'ArrowRight',
    up: 'ArrowUp',
    down: 'ArrowDown',
    jump: 'KeyZ',
    attack: 'KeyX',
    hookshot: 'KeyC',
    burst: 'Space',
    sprint: 'ShiftLeft',
    slide: 'KeyV',
    swapLoadout: 'KeyQ',
    pause: 'Enter',
    accept: 'KeyZ',
    cancel: 'KeyX',
    map: 'Tab',
  },
  gamepadPreset: 'default',
  gamepadDeadzone: GAMEPAD_CONSTANTS.STICK_DEADZONE,
  gamepadTriggerThreshold: GAMEPAD_CONSTANTS.TRIGGER_THRESHOLD,
  rumbleEnabled: true,
};

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  targetFps: 120,
  classicSnap60: false,
  scaleMode: 'fit',
  aimReticle: true,
  screenShake: true,
  assetMode: 'BUILTIN',
  showSpeedrunTimer: false,
};

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  masterVolume: 0.75,
  bgmVolume: 0.65,
  sfxVolume: 0.85,
  muted: false,
};
