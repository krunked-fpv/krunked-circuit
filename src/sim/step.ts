import {
  BOSS_CONSTANTS,
  ENGINE_CONSTANTS,
  PLAYER_PHYSICS,
  type BossEntity,
  type EnemyArchetype,
  type EnemyEntity,
  type InputFrame,
  type PlayerActionState,
  type PlayerState,
  type ProgressionState,
  type SimState,
  type StageDefinition,
} from '../contracts/index';
import { tryActivateBurst, updateActiveBurstEffects } from './bursts';
import { getActiveLoadout, hasChip, stepCombat, stepProjectiles } from './combat';
import { updateHookshot } from './hookshot';
import { updateCamera, updatePhysics, updateScarf } from './physics';

// ============================================================================
// Pure 60 Hz Master Simulation Step & Deterministic State Initialization
// ============================================================================

const TS = ENGINE_CONSTANTS.TILE_SIZE;
const CELL_W = ENGINE_CONSTANTS.CELL_TILES_W * TS;
const CELL_H = ENGINE_CONSTANTS.CELL_TILES_H * TS;
const DEFAULT_SEED = 0x4b52554e; // 'KRUN'

export interface SimStepHooks {
  updateEnemies?: (state: SimState) => void;
  updateBoss?: (state: SimState) => void;
  updateWorld?: (state: SimState, input?: InputFrame) => void;
  onEnemyDefeated?: (state: SimState, enemy: EnemyEntity) => void;
  onBossDefeated?: (state: SimState, boss: BossEntity) => void;
  getEnemyArchetype?: (id: string) => EnemyArchetype | undefined;
}

export function createDefaultProgression(): ProgressionState {
  return {
    bits: 0,
    rescueTokens: 0,
    totalRescues: 0,
    rescuedIds: [],
    clearedStages: [],
    clearedRemixes: [],
    collectedHealthBoosters: [],
    collectedBurstBoosters: [],
    unlockedBursts: [1, 2, 3, 4],
    unlockedChips: [1, 2, 3, 4],
    unlockedArmors: [0],
    unlockedChallenges: [],
    unlockedDataChips: [],
    loadouts: [
      {
        name: 'Standard',
        bursts: { neutral: 1, side: 4, up: 2, down: 3 },
        chips: [1, 2, 3],
        armorPaint: 0,
      },
      {
        name: 'Aerial',
        bursts: { neutral: 2, side: 1, up: 2, down: 3 },
        chips: [2, 3, 4],
        armorPaint: 0,
      },
      {
        name: 'Striker',
        bursts: { neutral: 3, side: 1, up: 2, down: 4 },
        chips: [1, 3, 4],
        armorPaint: 0,
      },
    ],
    activeLoadoutIndex: 0,
    difficulty: 'normal',
    mode: 'standard',
    modifiers: {
      masterLevels: false,
      rudeEnemies: false,
      doubleHazards: false,
      singleCredit: false,
      ironCircuit: false,
      mirrorWorld: false,
    },
    bestTimesTicks: {},
    farmCounts: {},
  };
}

function computeDerivedMaxHp(progression: ProgressionState): number {
  const perBooster =
    progression.mode === 'circuit'
      ? PLAYER_PHYSICS.CIRCUIT_MODE_HP_PER_BOOSTER
      : PLAYER_PHYSICS.HP_PER_BOOSTER;
  const raw =
    PLAYER_PHYSICS.STARTING_MAX_HP +
    progression.collectedHealthBoosters.length * perBooster;
  return Math.min(PLAYER_PHYSICS.MAX_BOOSTED_HP, raw);
}

function computeDerivedMaxBurst(progression: ProgressionState): number {
  if (progression.mode === 'circuit') {
    return PLAYER_PHYSICS.CIRCUIT_MODE_MAX_BURST;
  }
  const raw =
    PLAYER_PHYSICS.STARTING_MAX_BURST +
    progression.collectedBurstBoosters.length;
  return Math.min(PLAYER_PHYSICS.MAX_BOOSTED_BURST, raw);
}

function createFreshPlayer(
  spawnX: number,
  spawnY: number,
  progression: ProgressionState,
): PlayerState {
  const maxHp = computeDerivedMaxHp(progression);
  const maxBurstCharges = computeDerivedMaxBurst(progression);
  const scarf = [];
  for (let i = 0; i < PLAYER_PHYSICS.SCARF_NODE_COUNT; i++) {
    scarf.push({
      x: spawnX + PLAYER_PHYSICS.STAND_W * 0.5 - i * PLAYER_PHYSICS.SCARF_SEGMENT_LEN,
      y: spawnY + 7,
    });
  }

  return {
    x: spawnX,
    y: spawnY,
    vx: 0,
    vy: 0,
    w: PLAYER_PHYSICS.STAND_W,
    h: PLAYER_PHYSICS.STAND_H,
    facing: 1,
    grounded: false,
    onIce: false,
    onWall: 0,
    onLedge: 0,
    ledgeTimer: 0,
    crouching: false,
    sliding: false,
    slideTimer: 0,
    slideCooldown: 0,
    leftGroundTick: -999,
    jumpBufferTick: -999,
    wallJumpBufferTick: -999,
    wallJumpDir: 0,
    wallJumpLockTimer: 0,
    airJumpsUsed: 0,
    diveKickTicks: 0,
    action: 'idle',
    animTick: 0,
    attackId: null,
    attackTimer: 0,
    attackHitIds: [],
    hp: maxHp,
    maxHp,
    burstEnergy: maxBurstCharges * PLAYER_PHYSICS.BURST_ENERGY_PER_CHARGE,
    maxBurstCharges,
    invulnTimer: 0,
    hurtTimer: 0,
    overloadTimer: 0,
    freezeFieldTimer: 0,
    barrierHits: 0,
    barrierTimer: 0,
    cloneTimer: 0,
    nullifyCooldown: 0,
    nullifyReady: false,
    comboCount: 0,
    comboTimer: 0,
    inWalker: false,
    walkerHp: 0,
    lastSafeX: spawnX,
    lastSafeY: spawnY,
    scarf,
    hook: {
      phase: 'idle',
      tipX: spawnX + PLAYER_PHYSICS.STAND_W * 0.5,
      tipY: spawnY + 10,
      vx: 0,
      vy: 0,
      dirX: 1,
      dirY: 0,
      timer: 0,
      ropeLen: 0,
      swingAngle: 0,
      swingAngVel: 0,
      latchedTileX: 0,
      latchedTileY: 0,
      heldKind: 'none',
      heldEntityId: 0,
      heldSpriteKey: '',
      heldDamage: 0,
      remoteBombTargetId: 0,
    },
    warpTimer: 0,
  };
}

function formatBossDisplayName(bossId: string): string {
  return bossId
    .split('_')
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

export function loadStageIntoState(
  state: SimState,
  stage: StageDefinition,
  hooks?: SimStepHooks,
): void {
  state.stageId = stage.id;
  state.remix = stage.remix;
  state.tilesW = stage.tilesW;
  state.tilesH = stage.tilesH;
  state.tiles = stage.tiles.slice();
  state.biomeGimmick = stage.biomeGimmick;
  state.windForce = stage.windForce ?? 0;
  state.togglePhase = false;
  state.rhythmBeat = 0;
  state.hitstopTicks = 0;
  state.stageClearTimer = 0;
  state.activeHubTerminal = null;
  state.nextEntityId = 1;

  state.player = createFreshPlayer(stage.spawnX, stage.spawnY, state.progression);
  if (hasChip(state, 18)) {
    state.player.nullifyReady = true;
  }

  state.enemies = [];
  state.boss = null;
  state.projectiles = [];
  state.pickups = [];
  state.props = [];
  state.events = [];

  const prog = state.progression;
  const isRude = prog.modifiers.rudeEnemies;

  for (let i = 0; i < stage.spawns.length; i++) {
    const sp = stage.spawns[i];
    switch (sp.kind) {
      case 'enemy': {
        const archId = sp.archetypeId ?? 'trooper_basic';
        const arch = hooks?.getEnemyArchetype?.(archId);
        const baseHp = arch ? arch.hp : 3;
        const maxHp = isRude ? baseHp + 1 : baseHp;
        const w = arch ? arch.width : 16;
        const h = arch ? arch.height : 24;
        const shielded = arch ? Boolean(arch.shielded) : archId.includes('shield');
        state.enemies.push({
          id: state.nextEntityId++,
          archetypeId: archId,
          x: sp.x,
          y: sp.y,
          vx: 0,
          vy: 0,
          w,
          h,
          facing: -1,
          hp: maxHp,
          maxHp,
          shielded,
          stunTimer: 0,
          hurtFlash: 0,
          aiTimer: 0,
          aiPhase: 0,
          homeX: sp.x,
          homeY: sp.y,
          grounded: false,
          grabbed: false,
          dead: false,
          isMiniboss: false,
          spawnId: sp.id,
        });
        break;
      }

      case 'miniboss': {
        const maxHp = isRude
          ? BOSS_CONSTANTS.MINIBOSS_HP_RUDE
          : BOSS_CONSTANTS.MINIBOSS_HP_NORMAL;
        state.enemies.push({
          id: state.nextEntityId++,
          archetypeId: sp.minibossId ?? 'junk_colossus',
          x: sp.x,
          y: sp.y,
          vx: 0,
          vy: 0,
          w: 36,
          h: 36,
          facing: -1,
          hp: maxHp,
          maxHp,
          shielded: false,
          stunTimer: 0,
          hurtFlash: 0,
          aiTimer: 0,
          aiPhase: 0,
          homeX: sp.x,
          homeY: sp.y,
          grounded: false,
          grabbed: false,
          dead: false,
          isMiniboss: true,
          minibossId: sp.minibossId,
          spawnId: sp.id,
        });
        break;
      }

      case 'boss': {
        const bossId = sp.bossId ?? stage.bossId ?? 'siege_tread';
        const isFinalTier =
          bossId === 'overlord_apex' ||
          bossId === 'prism_core' ||
          (prog.difficulty === 'hard' && isRude);
        const maxHp = isFinalTier
          ? BOSS_CONSTANTS.FINAL_HP
          : BOSS_CONSTANTS.STANDARD_HP;
        const desperationHp = isFinalTier
          ? BOSS_CONSTANTS.FINAL_DESPERATION_HP
          : BOSS_CONSTANTS.STANDARD_DESPERATION_HP;
        const arenaLeft = stage.bossCellX * CELL_W;
        const arenaTop = stage.bossCellY * CELL_H;
        const isLargeBoss =
          bossId === 'siege_tread' || bossId === 'overlord_apex' || bossId === 'prism_core';

        state.boss = {
          id: state.nextEntityId++,
          bossId,
          name: formatBossDisplayName(bossId),
          x: sp.x,
          y: sp.y,
          vx: 0,
          vy: 0,
          w: isLargeBoss ? 48 : 34,
          h: isLargeBoss ? 40 : 38,
          facing: -1,
          hp: maxHp,
          maxHp,
          desperationHp,
          phase: 1,
          desperationTriggered: false,
          desperationBannerTicks: 0,
          aiState: 'intro',
          aiTimer: 60,
          patternIndex: 0,
          mimicIndex: 0,
          hurtFlash: 0,
          techRecoverTimer: 0,
          launchHits: 0,
          invulnTimer: 0,
          active: false,
          defeated: false,
          arenaLeft: arenaLeft + TS,
          arenaRight: arenaLeft + CELL_W - TS,
          arenaTop: arenaTop + TS,
          arenaBottom: arenaTop + CELL_H - TS,
          partsHp: [16, 16, 16],
        };
        break;
      }

      case 'rescue': {
        if (!prog.rescuedIds.includes(sp.id)) {
          state.pickups.push({
            id: state.nextEntityId++,
            kind: 'rescue',
            x: sp.x,
            y: sp.y,
            vx: 0,
            vy: 0,
            value: 1,
            ttl: -1,
            collected: false,
            spawnId: sp.id,
            rescueIndex: sp.rescueIndex,
          });
        }
        break;
      }

      case 'health_booster': {
        if (!prog.collectedHealthBoosters.includes(stage.id)) {
          state.pickups.push({
            id: state.nextEntityId++,
            kind: 'health_booster',
            x: sp.x,
            y: sp.y,
            vx: 0,
            vy: 0,
            value: 1,
            ttl: -1,
            collected: false,
            spawnId: sp.id,
          });
        }
        break;
      }

      case 'burst_booster': {
        if (!prog.collectedBurstBoosters.includes(stage.id)) {
          state.pickups.push({
            id: state.nextEntityId++,
            kind: 'burst_booster',
            x: sp.x,
            y: sp.y,
            vx: 0,
            vy: 0,
            value: 1,
            ttl: -1,
            collected: false,
            spawnId: sp.id,
          });
        }
        break;
      }

      case 'palette_chip': {
        const paintId = sp.armorPaintId ?? 1;
        if (!prog.unlockedArmors.includes(paintId)) {
          state.pickups.push({
            id: state.nextEntityId++,
            kind: 'palette_chip',
            x: sp.x,
            y: sp.y,
            vx: 0,
            vy: 0,
            value: 1,
            ttl: -1,
            collected: false,
            spawnId: sp.id,
            armorPaintId: paintId,
          });
        }
        break;
      }

      case 'crate':
      case 'barrel':
      case 'switch':
      case 'checkpoint':
      case 'hub_terminal':
      case 'walker': {
        const w = sp.kind === 'walker' ? 32 : sp.kind === 'hub_terminal' ? 24 : 16;
        const h =
          sp.kind === 'walker'
            ? 32
            : sp.kind === 'hub_terminal' || sp.kind === 'checkpoint'
              ? 28
              : 16;
        const hp =
          sp.kind === 'crate' || sp.kind === 'barrel'
            ? 2
            : sp.kind === 'walker'
              ? 12
              : 999;
        state.props.push({
          id: state.nextEntityId++,
          kind: sp.kind,
          x: sp.x,
          y: sp.y,
          w,
          h,
          hp,
          activated: false,
          grabbed: false,
          terminalKind: sp.terminalKind,
          spawnId: sp.id,
        });
        break;
      }
    }
  }

  state.stageStats = {
    stageId: stage.id,
    remix: stage.remix,
    elapsedTicks: 0,
    damageTaken: 0,
    enemiesDefeated: 0,
    rescuesCollected: 0,
    bitsCollected: 0,
    deaths: 0,
    rank: 'S',
  };

  state.camera = {
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    cellX: Math.floor(stage.spawnX / CELL_W),
    cellY: Math.floor(stage.spawnY / CELL_H),
    transitionTimer: 0,
    lockedBossArena: false,
    shakeTimer: 0,
    shakeIntensity: 0,
  };
  updateCamera(state, true);
  state.events.push({ type: 'bgm', key: stage.bgmKey });
}

export function createSimState(
  stage: StageDefinition,
  progression?: ProgressionState,
  seed = DEFAULT_SEED,
): SimState {
  const prog = progression ?? createDefaultProgression();
  const state: SimState = {
    tick: 0,
    rngState: seed >>> 0,
    screen: 'playing',
    activeHubTerminal: null,
    stageId: stage.id,
    remix: stage.remix,
    tilesW: stage.tilesW,
    tilesH: stage.tilesH,
    tiles: [],
    biomeGimmick: stage.biomeGimmick,
    togglePhase: false,
    rhythmBeat: 0,
    windForce: stage.windForce ?? 0,
    hitstopTicks: 0,
    stageClearTimer: 0,
    nextEntityId: 1,
    player: createFreshPlayer(stage.spawnX, stage.spawnY, prog),
    camera: {
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
      cellX: 0,
      cellY: 0,
      transitionTimer: 0,
      lockedBossArena: false,
      shakeTimer: 0,
      shakeIntensity: 0,
    },
    enemies: [],
    boss: null,
    projectiles: [],
    pickups: [],
    props: [],
    progression: prog,
    stageStats: {
      stageId: stage.id,
      remix: stage.remix,
      elapsedTicks: 0,
      damageTaken: 0,
      enemiesDefeated: 0,
      rescuesCollected: 0,
      bitsCollected: 0,
      deaths: 0,
      rank: 'S',
    },
    bossRush: {
      active: prog.mode === 'boss_rush',
      bossOrder: [],
      currentIndex: 0,
      splitTicks: [],
      totalTicks: 0,
    },
    events: [],
  };

  loadStageIntoState(state, stage);
  return state;
}

function resolvePlayerAction(state: SimState): PlayerActionState {
  const p = state.player;
  if (p.hp <= 0 || p.action === 'dead') return 'dead';
  if (p.action === 'victory') return 'victory';
  if (p.warpTimer > 0) return 'warp';
  if (p.hurtTimer > 0) return 'hurt';
  if (p.hook.phase === 'latched_wall') return 'hook_zip';
  if (p.hook.phase === 'swinging') return 'hook_swing';
  if (p.action === 'burst' && p.attackTimer > 0) return 'burst';
  if (p.attackId === 'diveKick' || p.attackId === 'diveKickHeavy') return 'dive_kick';
  if (p.attackId !== null && p.attackTimer > 0) return 'attack';
  if (p.onLedge !== 0) return 'ledge_hang';
  if (p.sliding) return 'slide';
  if (p.onWall !== 0 && !p.grounded) return 'wall_slide';
  if (!p.grounded) return p.vy < 0 ? 'jump' : 'fall';
  if (Math.abs(p.vx) >= 3.0) return 'sprint';
  if (Math.abs(p.vx) >= 0.2) return 'walk';
  return 'idle';
}

function clampSimCoordinates(state: SimState): void {
  const p = state.player;
  const maxPlayerX = Math.max(0, state.tilesW * TS - p.w);
  if (!Number.isFinite(p.x)) p.x = p.lastSafeX;
  if (!Number.isFinite(p.y)) p.y = p.lastSafeY;
  if (!Number.isFinite(p.vx)) p.vx = 0;
  if (!Number.isFinite(p.vy)) p.vy = 0;

  p.x = Math.max(0, Math.min(maxPlayerX, p.x));
  p.y = Math.max(-64, Math.min(state.tilesH * TS + 64, p.y));

  // Keep player inside active boss arena horizontally
  if (state.camera.lockedBossArena && state.boss && state.boss.active) {
    const minArenaX = state.boss.arenaLeft + 4;
    const maxArenaX = state.boss.arenaRight - p.w - 4;
    p.x = Math.max(minArenaX, Math.min(maxArenaX, p.x));
  }
}

/**
 * Advances the entire pure simulation by exactly 1 fixed tick (1/60 s).
 */
export function stepSim(
  state: SimState,
  input: InputFrame,
  hooks?: SimStepHooks,
): void {
  state.events.length = 0;

  // Handle pause toggling cleanly
  if (state.screen === 'paused') {
    if (input.pausePressed) {
      state.screen = 'playing';
      state.events.push({ type: 'sfx', key: 'menu_cancel' });
    }
    return;
  }

  if (state.screen !== 'playing') {
    return;
  }

  if (input.pausePressed) {
    state.screen = 'paused';
    state.events.push({ type: 'sfx', key: 'menu_confirm' });
    return;
  }

  // Loadout quick-swap
  if (input.swapLoadoutPressed) {
    state.progression.activeLoadoutIndex = ((state.progression.activeLoadoutIndex + 1) % 3) as
      | 0
      | 1
      | 2;
    const active = getActiveLoadout(state);
    state.events.push({ type: 'sfx', key: 'loadout_swap' });
    state.events.push({
      type: 'toast',
      text: `LOADOUT ${state.progression.activeLoadoutIndex + 1}: ${active.name.toUpperCase()}`,
      tone: 'info',
    });
  }

  state.tick += 1;
  state.stageStats.elapsedTicks += 1;
  state.rhythmBeat = Math.floor(state.tick / 30) % 4;
  if (state.bossRush.active) {
    state.bossRush.totalTicks += 1;
  }

  // Hitstop freeze frames pause gameplay physics while keeping shake decay crisp
  if (state.hitstopTicks > 0) {
    state.hitstopTicks -= 1;
    if (state.camera.shakeTimer > 0) {
      state.camera.shakeTimer -= 1;
      if (state.camera.shakeTimer <= 0) {
        state.camera.shakeIntensity = 0;
      }
    }
    return;
  }

  const p = state.player;

  // Tick down player state timers
  if (p.invulnTimer > 0) p.invulnTimer -= 1;
  if (p.hurtTimer > 0) p.hurtTimer -= 1;
  if (p.ledgeTimer > 0) p.ledgeTimer -= 1;
  if (p.slideCooldown > 0) p.slideCooldown -= 1;
  if (p.wallJumpLockTimer > 0) p.wallJumpLockTimer -= 1;
  if (p.attackTimer > 0) p.attackTimer -= 1;
  if (p.comboTimer > 0) {
    p.comboTimer -= 1;
    if (p.comboTimer === 0) {
      p.comboCount = 0;
    }
  }
  if (p.warpTimer > 0) {
    p.warpTimer -= 1;
  }

  // Burst passive sustain & activation
  updateActiveBurstEffects(state);
  if (input.burstPressed) {
    tryActivateBurst(state, input, hooks);
  }

  // 8-directional Hookshot grapple/swing/grab/throw
  updateHookshot(state, input, hooks);

  // Player locomotion, jumping, wall/ledge tech, slide wedge safety
  updatePhysics(state, input, hooks);

  // Melee attacks, dive-kick, guard-breaks & projectile simulation
  stepCombat(state, input, hooks);
  stepProjectiles(state, hooks);

  // External world, enemy, and boss hooks
  hooks?.updateEnemies?.(state);
  hooks?.updateBoss?.(state);
  hooks?.updateWorld?.(state, input);

  // Clamp coordinates, update flowing 7-node scarf, camera, and action state
  clampSimCoordinates(state);
  updateScarf(state);
  updateCamera(state, false);

  p.animTick += 1;
  p.action = resolvePlayerAction(state);
}
