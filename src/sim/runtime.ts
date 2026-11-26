// ============================================================================
// Krunked Circuit — Pure Simulation Runtime Composition
// Connects pure simcore (step/combat/physics/hookshot/bursts) with pure
// gameplay systems (enemies/bosses/world/progression/data).
// 100% DOM-free and deterministic — shared by GameApp, Vitest, and verify:sim.
// ============================================================================

import {
  ENGINE_CONSTANTS,
  type BossEntity,
  type BossId,
  type EnemyEntity,
  type InputFrame,
  type ProgressionState,
  type RenderSnapshot,
  type SimState,
  type StageId,
} from '../contracts/index';
import { getEnemyArchetype, getStageDefinition } from '../data/index';
import { createBossEntity, updateBoss } from './bosses';
import { applyDamageToPlayer, spawnProjectile } from './combat';
import { updateEnemies } from './enemies';
import { completeStage, createInitialProgression } from './progression';
import {
  createSimState,
  loadStageIntoState,
  stepSim,
  type SimStepHooks,
} from './step';
import { updateWorld } from './world';

export const BOSS_RUSH_ORDER: readonly BossId[] = [
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

function handleStageClear(state: SimState): void {
  if (state.screen === 'stage_clear') return;
  const stats = completeStage(state.progression, state.stageStats);
  state.stageStats = stats;
  state.player.action = 'victory';
  state.screen = 'stage_clear';
  state.events.push(
    { type: 'bgm', key: 'bgm_stage_clear', fadeMs: 120 },
    { type: 'stageClear', stats: { ...stats } },
  );
}

function handleBossDefeated(state: SimState, _boss: BossEntity): void {
  if (state.bossRush.active) {
    state.bossRush.splitTicks.push(state.bossRush.totalTicks);
    const nextIdx = state.bossRush.currentIndex + 1;
    if (nextIdx < state.bossRush.bossOrder.length) {
      state.bossRush.currentIndex = nextIdx;
      const nextBossId = state.bossRush.bossOrder[nextIdx];
      const cellW = ENGINE_CONSTANTS.GAME_WIDTH;
      const cellH = ENGINE_CONSTANTS.GAME_HEIGHT;
      const ts = ENGINE_CONSTANTS.TILE_SIZE;
      const boss = createBossEntity(
        nextBossId,
        cellW - 96,
        cellH - ts - 44,
        ts,
        cellW - ts,
        ts,
        cellH - ts,
        state.nextEntityId++,
        state.progression.difficulty,
        state.progression.modifiers.rudeEnemies,
      );
      state.boss = boss;
      // Give small between-boss recovery in Boss Rush
      state.player.hp = Math.min(state.player.maxHp, state.player.hp + 4);
      state.events.push({
        type: 'toast',
        text: `BOSS RUSH ${nextIdx + 1}/${state.bossRush.bossOrder.length}: ${boss.name.toUpperCase()}`,
        tone: 'info',
      });
      return;
    }
    state.bossRush.active = false;
    state.stageClearTimer = 90;
    return;
  }

  state.camera.lockedBossArena = false;
  state.stageClearTimer = 90;
}

function handleEnemyDefeated(_state: SimState, _enemy: EnemyEntity): void {
  // Drop economy & stats are handled in combat.ts; hook point ready for Wave 2 challenges.
}

export function createFullSimHooks(): SimStepHooks {
  return {
    getEnemyArchetype: (id: string) => getEnemyArchetype(id),
    updateEnemies: (state: SimState) => {
      updateEnemies(state, {
        damagePlayer: (s, damage, sourceX) => {
          applyDamageToPlayer(s, damage, sourceX);
        },
        spawnProjectile: (s, spec) => {
          spawnProjectile(s, spec);
        },
        spawnPickup: (s, spec) => {
          s.pickups.push({
            id: s.nextEntityId++,
            collected: false,
            ...spec,
          });
        },
      });
    },
    updateBoss: (state: SimState) => {
      updateBoss(state, {
        damagePlayer: (s, damage, sourceX) => {
          applyDamageToPlayer(s, damage, sourceX);
        },
        spawnProjectile: (s, spec) => {
          spawnProjectile(s, spec);
        },
        onBossDefeated: (s, boss) => {
          handleBossDefeated(s, boss);
        },
      });
    },
    updateWorld: (state: SimState, input?: InputFrame) => {
      updateWorld(
        state,
        {
          damagePlayer: (s, damage, sourceX) => {
            applyDamageToPlayer(s, damage, sourceX);
          },
          onStageClear: (s) => {
            handleStageClear(s);
          },
        },
        input,
      );
    },
    onEnemyDefeated: handleEnemyDefeated,
    onBossDefeated: handleBossDefeated,
  };
}

const SHARED_HOOKS = createFullSimHooks();

export function createFullSimState(
  stageId: StageId,
  remix = false,
  progression?: ProgressionState,
  seed?: number,
): SimState {
  const prog = progression ?? createInitialProgression();
  const stage = getStageDefinition(stageId, remix);
  const state = createSimState(stage, prog, seed);
  // Reload with full archetype-aware hooks so enemy HP/sizes match data catalog exactly
  loadStageIntoState(state, stage, SHARED_HOOKS);
  configureBossRushIfNeeded(state, stageId);
  return state;
}

export function loadFullStage(
  state: SimState,
  stageId: StageId,
  remix = false,
): void {
  const stage = getStageDefinition(stageId, remix);
  loadStageIntoState(state, stage, SHARED_HOOKS);
  configureBossRushIfNeeded(state, stageId);
}

function configureBossRushIfNeeded(state: SimState, stageId: StageId): void {
  if (stageId === 'boss_rush') {
    state.bossRush = {
      active: true,
      bossOrder: [...BOSS_RUSH_ORDER],
      currentIndex: 0,
      splitTicks: [],
      totalTicks: 0,
    };
    const cellW = ENGINE_CONSTANTS.GAME_WIDTH;
    const cellH = ENGINE_CONSTANTS.GAME_HEIGHT;
    const ts = ENGINE_CONSTANTS.TILE_SIZE;
    state.boss = createBossEntity(
      BOSS_RUSH_ORDER[0],
      cellW - 96,
      cellH - ts - 44,
      ts,
      cellW - ts,
      ts,
      cellH - ts,
      state.nextEntityId++,
      state.progression.difficulty,
      state.progression.modifiers.rudeEnemies,
    );
  } else {
    state.bossRush.active = false;
  }
}

export function stepFullSim(state: SimState, input: InputFrame): void {
  stepSim(state, input, SHARED_HOOKS);
}

export function captureRenderSnapshot(state: SimState): RenderSnapshot {
  const enemyPos: Record<number, { x: number; y: number }> = {};
  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (!e.dead) {
      enemyPos[e.id] = { x: e.x, y: e.y };
    }
  }
  const projPos: Record<number, { x: number; y: number }> = {};
  for (let i = 0; i < state.projectiles.length; i++) {
    const pr = state.projectiles[i];
    projPos[pr.id] = { x: pr.x, y: pr.y };
  }
  return {
    tick: state.tick,
    playerX: state.player.x,
    playerY: state.player.y,
    cameraX: state.camera.x,
    cameraY: state.camera.y,
    hookTipX: state.player.hook.tipX,
    hookTipY: state.player.hook.tipY,
    enemyPos,
    bossPos: state.boss && !state.boss.defeated ? { x: state.boss.x, y: state.boss.y } : null,
    projPos,
  };
}
