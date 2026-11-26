import { describe, expect, it } from 'vitest';
import {
  BOSS_CONSTANTS,
  CONTENT_COUNTS,
  ENGINE_CONSTANTS,
  MAIN_EIGHT_STAGES,
  OFFICIAL_STAGE_IDS,
  PLAYER_PHYSICS,
  REMIXABLE_STAGES,
  TileType,
  createNeutralInput,
  type InputFrame,
  type MinibossId,
  type SimState,
  type StageDefinition,
} from '../src/contracts/index';
import {
  BOSS_DEFINITIONS,
  CHALLENGE_DEFINITIONS,
  DATACHIP_DEFINITIONS,
  ENEMY_ARCHETYPES,
  getStageDefinition,
} from '../src/data/index';
import { damageBoss } from '../src/sim/combat';
import { spawnEnemyFromArchetype, spawnMiniboss } from '../src/sim/enemies';
import { hashSimState } from '../src/sim/hash';
import {
  createInitialProgression,
  evaluateChallenges,
  unlockDataChip,
} from '../src/sim/progression';
import {
  BOSS_RUSH_ORDER,
  createFullSimHooks,
  createFullSimState,
  stepFullSim,
} from '../src/sim/runtime';
import { createSimState, loadStageIntoState, stepSim } from '../src/sim/step';

const TS = ENGINE_CONSTANTS.TILE_SIZE;
const HOOKS = createFullSimHooks();

function makeInput(overrides: Partial<InputFrame> = {}): InputFrame {
  return { ...createNeutralInput('keyboard'), ...overrides };
}

function warpIntoBossArena(state: SimState): void {
  const stage = getStageDefinition(state.stageId, state.remix);
  const cellLeft = stage.bossCellX * ENGINE_CONSTANTS.GAME_WIDTH;
  const cellTop = stage.bossCellY * ENGINE_CONSTANTS.GAME_HEIGHT;
  state.player.x = cellLeft + 44;
  state.player.y = cellTop + 13 * TS - PLAYER_PHYSICS.STAND_H;
  state.player.vx = 0;
  state.player.vy = 0;
  state.player.lastSafeX = state.player.x;
  state.player.lastSafeY = state.player.y;
  state.camera.cellX = stage.bossCellX;
  state.camera.cellY = stage.bossCellY;
  state.camera.x = cellLeft;
  state.camera.y = cellTop;
  state.camera.targetX = cellLeft;
  state.camera.targetY = cellTop;
}

function createEnemyTestSandbox(rudeEnemies = false): SimState {
  const tilesW = ENGINE_CONSTANTS.CELL_TILES_W;
  const tilesH = ENGINE_CONSTANTS.CELL_TILES_H;
  const tiles = new Array<number>(tilesW * tilesH).fill(TileType.EMPTY);
  for (let tx = 0; tx < tilesW; tx++) {
    tiles[tx] = TileType.SOLID;
    tiles[13 * tilesW + tx] = TileType.SOLID;
    tiles[14 * tilesW + tx] = TileType.SOLID;
  }
  for (let ty = 0; ty < tilesH; ty++) {
    tiles[ty * tilesW] = TileType.SOLID;
    tiles[ty * tilesW + (tilesW - 1)] = TileType.SOLID;
  }
  const stage: StageDefinition = {
    id: 'tutorial',
    name: 'Enemy Sandbox',
    subtitle: 'Archetype Harness',
    remix: false,
    biomeGimmick: 'tutorial_course',
    bgmKey: 'bgm_tutorial',
    bossBgmKey: 'bgm_boss_master',
    cellsW: 1,
    cellsH: 1,
    tilesW,
    tilesH,
    tiles,
    spawnX: 3 * TS,
    spawnY: 13 * TS - PLAYER_PHYSICS.STAND_H,
    bossCellX: 0,
    bossCellY: 0,
    spawns: [],
    palette: {
      skyTop: '#0f172a',
      skyBottom: '#1e293b',
      farBg: '#1e293b',
      midBg: '#334155',
      tilePrimary: '#475569',
      tileHighlight: '#94a3b8',
      tileShadow: '#0f172a',
      accent: '#38bdf8',
    },
  };
  const prog = createInitialProgression();
  prog.modifiers.rudeEnemies = rudeEnemies;
  const state = createSimState(stage, prog, 0x4b52554e);
  loadStageIntoState(state, stage, HOOKS);
  return state;
}

describe('Worlds, 12 Bosses, 3 Minibosses, 42 Enemies, Boss Rush & Determinism', () => {
  describe('All 15 Official + 12 Remix Stages (27 Layouts) & 64 Rescues', () => {
    it('builds all 15 official and 12 distinct Remix stage layouts cleanly', () => {
      expect(OFFICIAL_STAGE_IDS.length).toBe(CONTENT_COUNTS.OFFICIAL_MAPS);
      expect(REMIXABLE_STAGES.length).toBe(CONTENT_COUNTS.REMIX_MAPS);
      expect(OFFICIAL_STAGE_IDS.length + REMIXABLE_STAGES.length).toBe(CONTENT_COUNTS.TOTAL_LAYOUTS);

      const layoutFingerprints = new Set<string>();

      for (const stageId of OFFICIAL_STAGE_IDS) {
        const def = getStageDefinition(stageId, false);
        expect(def.id).toBe(stageId);
        expect(def.remix).toBe(false);
        expect(def.tiles.length).toBe(def.tilesW * def.tilesH);
        expect(def.spawnX).toBeGreaterThanOrEqual(0);
        expect(def.spawnX).toBeLessThan(def.tilesW * TS);
        expect(def.spawnY).toBeGreaterThanOrEqual(0);
        expect(def.spawnY).toBeLessThan(def.tilesH * TS);
        layoutFingerprints.add(`${stageId}:std:${def.tiles.join(',')}:${def.spawns.length}`);
      }

      for (const stageId of REMIXABLE_STAGES) {
        const std = getStageDefinition(stageId, false);
        const rem = getStageDefinition(stageId, true);
        expect(rem.id).toBe(stageId);
        expect(rem.remix).toBe(true);
        expect(rem.tiles.length).toBe(rem.tilesW * rem.tilesH);

        // Remix must genuinely differ from standard layout (tiles or spawn composition)
        const tilesDiffer =
          rem.tiles.length !== std.tiles.length ||
          rem.tiles.some((t, idx) => t !== std.tiles[idx]);
        const spawnsDiffer =
          rem.spawns.length !== std.spawns.length ||
          rem.spawns.some((sp, idx) => sp.id !== std.spawns[idx]?.id || sp.x !== std.spawns[idx]?.x);
        expect(tilesDiffer || spawnsDiffer).toBe(true);

        layoutFingerprints.add(`${stageId}:rmx:${rem.tiles.join(',')}:${rem.spawns.length}`);
      }

      expect(layoutFingerprints.size).toBe(CONTENT_COUNTS.TOTAL_LAYOUTS);
    });

    it('contains exactly 64 total unique rescues across MAIN_EIGHT_STAGES (8 per stage)', () => {
      expect(MAIN_EIGHT_STAGES.length).toBe(8);
      const allRescueIds = new Set<string>();
      for (const stageId of MAIN_EIGHT_STAGES) {
        const def = getStageDefinition(stageId, false);
        const rescues = def.spawns.filter((sp) => sp.kind === 'rescue');
        expect(rescues.length).toBe(8);
        for (const r of rescues) {
          allRescueIds.add(r.id);
        }
      }
      expect(allRescueIds.size).toBe(CONTENT_COUNTS.RESCUES);
    });
  });

  describe('All 12 Bosses — Intro, Desperation Threshold, Special Mechanics & Stage Clear', () => {
    it('activates all 12 bosses, triggers Desperation at exact threshold (16 std / 32 final) & clears stage on defeat', () => {
      expect(BOSS_DEFINITIONS.length).toBe(CONTENT_COUNTS.BOSSES);

      for (const def of BOSS_DEFINITIONS) {
        const state = createFullSimState(def.stageId, false, undefined, 0x4b52554e);
        expect(state.boss).not.toBeNull();
        expect(state.boss!.bossId).toBe(def.id);

        const expectedMaxHp = def.isFinal ? BOSS_CONSTANTS.FINAL_HP : BOSS_CONSTANTS.STANDARD_HP;
        const expectedDespHp = def.isFinal
          ? BOSS_CONSTANTS.FINAL_DESPERATION_HP
          : BOSS_CONSTANTS.STANDARD_DESPERATION_HP;
        expect(state.boss!.maxHp).toBe(expectedMaxHp);
        expect(state.boss!.desperationHp).toBe(expectedDespHp);

        warpIntoBossArena(state);

        // Step 1: Activate boss intro
        let sawIntro = false;
        for (let i = 0; i < 10; i++) {
          stepFullSim(state, makeInput());
          if (state.events.some((ev) => ev.type === 'bossIntro' && ev.bossId === def.id)) {
            sawIntro = true;
          }
          if (state.boss!.active) break;
        }
        expect(state.boss!.active).toBe(true);
        expect(sawIntro).toBe(true);
        expect(state.camera.lockedBossArena).toBe(true);

        // Finish 90-tick intro + run Phase 1 AI ticks cleanly
        for (let i = 0; i < 120; i++) {
          state.player.hp = state.player.maxHp;
          stepFullSim(state, makeInput());
        }
        expect(state.boss!.aiState).not.toBe('intro');
        expect(state.boss!.desperationTriggered).toBe(false);

        // Drop boss HP right to exact Desperation threshold
        state.boss!.invulnTimer = 0;
        const toThreshold = state.boss!.hp - expectedDespHp;
        damageBoss(state, state.boss!, toThreshold, { isBurst: true, onBossDefeated: HOOKS.onBossDefeated });
        expect(state.boss!.hp).toBe(expectedDespHp);
        expect(state.boss!.desperationTriggered).toBe(true);
        expect(state.boss!.phase).toBeGreaterThanOrEqual(2);

        // Step through Desperation attack frames asserting finite coordinates
        for (let i = 0; i < 60; i++) {
          state.player.hp = state.player.maxHp;
          stepFullSim(state, makeInput());
          expect(Number.isFinite(state.boss!.x)).toBe(true);
          expect(Number.isFinite(state.boss!.y)).toBe(true);
        }

        // Defeat boss cleanly -> triggers stageClearTimer -> stage_clear screen!
        state.boss!.invulnTimer = 0;
        damageBoss(state, state.boss!, state.boss!.hp + 10, {
          isBurst: true,
          onBossDefeated: HOOKS.onBossDefeated,
        });
        expect(state.boss!.defeated).toBe(true);
        expect(state.stageClearTimer).toBeGreaterThan(0);

        for (let i = 0; i < 120 && state.screen !== 'stage_clear'; i++) {
          stepFullSim(state, makeInput());
        }
        expect(state.screen).toBe('stage_clear');
      }
    });

    it('cycles prism_core mimicIndex across Rogue Masters and runs overlord_apex multi-part partsHp + Phase 2/3', () => {
      // 1. Prism Core mimicIndex cycling
      const sCore = createFullSimState('final_2', false, undefined, 0x4b52554e);
      warpIntoBossArena(sCore);
      const seenMimics = new Set<number>();
      for (let i = 0; i < 420; i++) {
        sCore.player.hp = sCore.player.maxHp;
        stepFullSim(sCore, makeInput());
        if (sCore.boss && sCore.boss.active && sCore.boss.aiState !== 'intro') {
          seenMimics.add(sCore.boss.mimicIndex);
        }
      }
      expect(seenMimics.size).toBeGreaterThanOrEqual(3);

      // 2. Overlord Apex multi-part partsHp + Phase 2 (<= 32 HP) & Phase 3 (<= 16 HP)
      const sApex = createFullSimState('final_3', false, undefined, 0x4b52554e);
      warpIntoBossArena(sApex);
      for (let i = 0; i < 105; i++) {
        sApex.player.hp = sApex.player.maxHp;
        stepFullSim(sApex, makeInput());
      }
      const apex = sApex.boss!;
      expect(apex.active).toBe(true);
      expect(apex.partsHp[0]).toBe(16);
      expect(apex.partsHp[1]).toBe(16);
      expect(apex.partsHp[2]).toBe(48);

      // Shatter left hand (HP <= 40)
      apex.invulnTimer = 0;
      damageBoss(sApex, apex, 8, { isBurst: true, onBossDefeated: HOOKS.onBossDefeated });
      stepFullSim(sApex, makeInput());
      expect(apex.partsHp[0]).toBe(0);
      expect(apex.partsHp[1]).toBeGreaterThan(0);

      // Shatter right hand & enter Phase 2 (HP <= 32)
      apex.invulnTimer = 0;
      damageBoss(sApex, apex, 8, { isBurst: true, onBossDefeated: HOOKS.onBossDefeated });
      stepFullSim(sApex, makeInput());
      expect(apex.partsHp[1]).toBe(0);
      expect(apex.desperationTriggered).toBe(true);
      expect(apex.phase).toBe(2);

      // Step past Phase 2 desperation, then cross Phase 3 threshold (HP <= 16)
      for (let i = 0; i < 60; i++) {
        sApex.player.hp = sApex.player.maxHp;
        stepFullSim(sApex, makeInput());
      }
      apex.invulnTimer = 0;
      damageBoss(sApex, apex, 16, { isBurst: true, onBossDefeated: HOOKS.onBossDefeated });
      stepFullSim(sApex, makeInput());
      expect(apex.phase).toBe(3);
      expect(apex.partsHp[2]).toBe(16);
    });
  });

  describe('All 3 Minibosses & All 42 Enemy Archetypes', () => {
    it('spawns all 3 minibosses with 20 Normal / 25 Rude HP and steps cleanly through enraged AI', () => {
      const minibossIds: readonly MinibossId[] = ['junk_colossus', 'sky_gunship', 'wrecker_tank'];
      expect(minibossIds.length).toBe(CONTENT_COUNTS.MINIBOSSES);

      for (const mbId of minibossIds) {
        const sNormal = createEnemyTestSandbox(false);
        const mbNormal = spawnMiniboss(sNormal, mbId, 16 * TS, 13 * TS - 36);
        expect(mbNormal.maxHp).toBe(BOSS_CONSTANTS.MINIBOSS_HP_NORMAL);

        const sRude = createEnemyTestSandbox(true);
        const mbRude = spawnMiniboss(sRude, mbId, 16 * TS, 13 * TS - 36);
        expect(mbRude.maxHp).toBe(BOSS_CONSTANTS.MINIBOSS_HP_RUDE);

        // Step normal phase then drop to 50% HP to verify enraged overdrive with zero NaNs
        for (let i = 0; i < 120; i++) {
          if (i === 60) mbNormal.hp = 10;
          sNormal.player.hp = sNormal.player.maxHp;
          stepSim(sNormal, makeInput(), HOOKS);
          expect(Number.isFinite(mbNormal.x)).toBe(true);
          expect(Number.isFinite(mbNormal.y)).toBe(true);
          expect(Number.isFinite(mbNormal.vx)).toBe(true);
          expect(Number.isFinite(mbNormal.vy)).toBe(true);
        }
        // Enraged overdrive bit (0x100) was triggered
        expect((mbNormal.aiPhase & 0x100) !== 0).toBe(true);
      }
    });

    it('steps all 42 enemy archetypes cleanly with zero NaNs or infinities', () => {
      expect(ENEMY_ARCHETYPES.length).toBe(CONTENT_COUNTS.ENEMY_ARCHETYPES);

      for (const arch of ENEMY_ARCHETYPES) {
        const state = createEnemyTestSandbox(false);
        const spawnY =
          arch.family === 'flyer' || arch.family === 'hazard'
            ? 8 * TS
            : 13 * TS - arch.height;
        const enemy = spawnEnemyFromArchetype(state, arch.id, 14 * TS, spawnY);
        expect(enemy).not.toBeNull();
        expect(enemy!.hp).toBe(arch.hp);

        for (let tick = 0; tick < 60; tick++) {
          state.player.hp = state.player.maxHp;
          stepSim(state, makeInput(), HOOKS);
          expect(Number.isFinite(enemy!.x)).toBe(true);
          expect(Number.isFinite(enemy!.y)).toBe(true);
          expect(Number.isFinite(enemy!.vx)).toBe(true);
          expect(Number.isFinite(enemy!.vy)).toBe(true);
          for (const pr of state.projectiles) {
            expect(Number.isFinite(pr.x)).toBe(true);
            expect(Number.isFinite(pr.y)).toBe(true);
          }
        }
      }
    });
  });

  describe('Boss Rush, 53 Challenges, 100 DataChips & Bit-for-Bit FNV-1a Determinism', () => {
    it('advances Boss Rush sequentially through all 12 bosses with split timer tracking', () => {
      const state = createFullSimState('boss_rush', false, undefined, 0x4b52554e);
      expect(state.bossRush.active).toBe(true);
      expect(state.bossRush.bossOrder).toEqual([...BOSS_RUSH_ORDER]);
      expect(state.bossRush.currentIndex).toBe(0);
      expect(state.boss?.bossId).toBe(BOSS_RUSH_ORDER[0]);

      for (let idx = 0; idx < BOSS_RUSH_ORDER.length; idx++) {
        expect(state.boss?.bossId).toBe(BOSS_RUSH_ORDER[idx]);
        // Activate boss and advance past intro
        for (let t = 0; t < 100; t++) {
          state.player.hp = state.player.maxHp;
          stepFullSim(state, makeInput());
          if (state.boss && state.boss.active && state.boss.aiState !== 'intro') break;
        }
        expect(state.boss!.active).toBe(true);
        state.boss!.invulnTimer = 0;
        damageBoss(state, state.boss!, state.boss!.hp + 99, {
          isBurst: true,
          onBossDefeated: HOOKS.onBossDefeated,
        });
        expect(state.bossRush.splitTicks.length).toBe(idx + 1);
      }

      expect(state.bossRush.active).toBe(false);
      expect(state.bossRush.totalTicks).toBeGreaterThan(0);
      // Splits are monotonically non-decreasing
      for (let i = 1; i < state.bossRush.splitTicks.length; i++) {
        expect(state.bossRush.splitTicks[i]).toBeGreaterThanOrEqual(
          state.bossRush.splitTicks[i - 1],
        );
      }

      for (let t = 0; t < 120 && state.screen !== 'stage_clear'; t++) {
        stepFullSim(state, makeInput());
      }
      expect(state.screen).toBe('stage_clear');
    });

    it('validates all 53 Challenges & 100 DataChips and unlocks them deterministically', () => {
      expect(CHALLENGE_DEFINITIONS.length).toBe(CONTENT_COUNTS.CHALLENGES);
      expect(DATACHIP_DEFINITIONS.length).toBe(CONTENT_COUNTS.DATACHIPS);
      expect(new Set(CHALLENGE_DEFINITIONS.map((c) => c.id)).size).toBe(53);
      expect(new Set(DATACHIP_DEFINITIONS.map((d) => d.id)).size).toBe(100);

      const state = createFullSimState('opening', false, undefined, 0x4b52554e);
      state.player.comboCount = 12;
      evaluateChallenges(state);
      expect(state.progression.unlockedChallenges).toContain('chal_combo_master');

      unlockDataChip(state, 'siege_tread');
      expect(state.progression.unlockedDataChips.some((id) => id.includes('siege_tread'))).toBe(true);
    });

    it('produces bit-for-bit identical FNV-1a hashSimState() replays from identical seeds', () => {
      const runTape = (seed: number, alterTick = -1): string[] => {
        const state = createFullSimState('opening', false, undefined, seed);
        const hashes: string[] = [];
        for (let tick = 1; tick <= 240; tick++) {
          const inp = makeInput({
            moveX: tick < 180 ? 1 : -1,
            sprint: tick % 40 < 25,
            jump: tick % 35 === 5 || tick % 35 === 6,
            jumpPressed: tick % 35 === 5,
            attack: tick % 24 === 10,
            attackPressed: tick % 24 === 10,
            hookshot: tick % 60 === 20 || tick % 60 === 21,
            hookshotPressed: tick % 60 === 20,
            aimX: 1,
            aimY: tick % 60 === 20 ? -1 : 0,
            burstPressed: tick === 120 || tick === alterTick,
            burst: tick === 120 || tick === alterTick,
          });
          stepFullSim(state, inp);
          if (tick % 60 === 0) {
            hashes.push(hashSimState(state));
          }
        }
        return hashes;
      };

      const runA = runTape(0x4b52554e);
      const runB = runTape(0x4b52554e);
      const runDiv = runTape(0x4b52554e, 30);

      expect(runA).toEqual(runB);
      for (const h of runA) {
        expect(h).toMatch(/^[0-9a-f]{8}$/);
      }
      // Divergent input tape must produce a different canonical hash
      expect(runDiv[runDiv.length - 1]).not.toBe(runA[runA.length - 1]);
    });
  });
});
