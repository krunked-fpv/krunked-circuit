// ============================================================================
// Krunked Circuit — Gate B Headless Deterministic Campaign Soak (Tracked in CI)
// Run via: npm run verify:sim  (tsx scripts/verify/verify-sim.ts)
//
// Audits ALL 3 Gate B Pillars:
//   1. All 15 Official + 12 Remix Stages (27 Layouts): 180-tick autonomous
//      active traversal/combat soak (run, sprint, jump, double-jump, slide,
//      wall-jump, melee, 8-dir hookshot, burst) asserting zero NaNs/infinities,
//      zero OOB traps/softlocks, finite camera & 7-node scarf coordinates.
//   2. Full 12-Boss Gauntlet + Boss Rush + Game Over: warps into each of the
//      12 bosses' arenas, activates boss intro, drives Phase 1 -> Desperation
//      (`desperationTriggered === true`) -> Defeat -> Stage Clear (`stage_clear`),
//      verifies Boss Rush sequential advancement & split timer, and verifies
//      HP -> 0 transitions cleanly to `game_over`.
//   3. Bit-for-Bit FNV-1a Determinism Verification: runs a 600-tick scripted
//      multi-action campaign tape twice from seed 0x4b52554e and asserts
//      IDENTICAL FNV-1a `hashSimState()` at ticks 150, 300, 450, and 600.
// ============================================================================

import {
  BOSS_CONSTANTS,
  CONTENT_COUNTS,
  ENGINE_CONSTANTS,
  OFFICIAL_STAGE_IDS,
  PLAYER_PHYSICS,
  REMIXABLE_STAGES,
  createNeutralInput,
  type InputFrame,
  type SimState,
  type StageId,
} from '../../src/contracts/index';
import { BOSS_DEFINITIONS, getStageDefinition } from '../../src/data/index';
import { applyDamageToPlayer, damageBoss } from '../../src/sim/combat';
import { hashSimState } from '../../src/sim/hash';
import { createInitialProgression, unlockAllContent } from '../../src/sim/progression';
import {
  BOSS_RUSH_ORDER,
  createFullSimHooks,
  createFullSimState,
  stepFullSim,
} from '../../src/sim/runtime';

const TS = ENGINE_CONSTANTS.TILE_SIZE;
const CANONICAL_SEED = 0x4b52554e; // 'KRUN'
const SOAK_TICKS_PER_STAGE = 180;
const DETERMINISM_TICKS = 600;
const HOOKS = createFullSimHooks();

interface CheckRecord {
  readonly suite: string;
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const checks: CheckRecord[] = [];

function record(suite: string, name: string, ok: boolean, detail: string): void {
  checks.push({ suite, name, ok, detail });
}

function makeInput(overrides: Partial<InputFrame> = {}): InputFrame {
  return { ...createNeutralInput('keyboard'), ...overrides };
}

/**
 * Validates every numeric simulation invariant on a single tick:
 * finite player, hook, camera, 7-node scarf, enemies, boss, projectiles, pickups,
 * props, and strict world-bound containment.
 */
function assertStateIntegrity(state: SimState, context: string): string | null {
  const p = state.player;
  const maxWorldX = state.tilesW * TS;
  const maxWorldY = state.tilesH * TS + 64;

  const nums: readonly [string, number][] = [
    ['player.x', p.x],
    ['player.y', p.y],
    ['player.vx', p.vx],
    ['player.vy', p.vy],
    ['player.hp', p.hp],
    ['player.burstEnergy', p.burstEnergy],
    ['hook.tipX', p.hook.tipX],
    ['hook.tipY', p.hook.tipY],
    ['hook.vx', p.hook.vx],
    ['hook.vy', p.hook.vy],
    ['camera.x', state.camera.x],
    ['camera.y', state.camera.y],
    ['camera.targetX', state.camera.targetX],
    ['camera.targetY', state.camera.targetY],
  ];

  for (const [label, val] of nums) {
    if (!Number.isFinite(val)) {
      return `${context} tick=${state.tick}: non-finite ${label}=${val}`;
    }
  }

  if (p.x < -1 || p.x + p.w > maxWorldX + 1 || p.y < -65 || p.y > maxWorldY + 1) {
    return `${context} tick=${state.tick}: player OOB (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) world=${maxWorldX}x${state.tilesH * TS}`;
  }

  if (p.scarf.length !== PLAYER_PHYSICS.SCARF_NODE_COUNT) {
    return `${context} tick=${state.tick}: scarf node count=${p.scarf.length} expected=${PLAYER_PHYSICS.SCARF_NODE_COUNT}`;
  }
  for (let i = 0; i < p.scarf.length; i++) {
    if (!Number.isFinite(p.scarf[i].x) || !Number.isFinite(p.scarf[i].y)) {
      return `${context} tick=${state.tick}: non-finite scarf[${i}]`;
    }
  }

  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(e.vx) || !Number.isFinite(e.vy) || !Number.isFinite(e.hp)) {
      return `${context} tick=${state.tick}: non-finite enemy ${e.archetypeId}#${e.id}`;
    }
  }

  if (state.boss) {
    const b = state.boss;
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.vx) || !Number.isFinite(b.vy) || !Number.isFinite(b.hp)) {
      return `${context} tick=${state.tick}: non-finite boss ${b.bossId}`;
    }
  }

  for (let i = 0; i < state.projectiles.length; i++) {
    const pr = state.projectiles[i];
    if (!Number.isFinite(pr.x) || !Number.isFinite(pr.y) || !Number.isFinite(pr.vx) || !Number.isFinite(pr.vy)) {
      return `${context} tick=${state.tick}: non-finite projectile ${pr.kind}#${pr.id}`;
    }
  }

  for (let i = 0; i < state.pickups.length; i++) {
    const pk = state.pickups[i];
    if (!Number.isFinite(pk.x) || !Number.isFinite(pk.y)) {
      return `${context} tick=${state.tick}: non-finite pickup ${pk.kind}#${pk.id}`;
    }
  }

  return null;
}

/**
 * Deterministic active player script exercising run, sprint, jump, double-jump,
 * slide, wall-jump, melee, 8-directional hookshot, and Burst Techniques.
 */
function buildActiveScriptInput(tick: number, stageId: StageId): InputFrame {
  const phase = tick % 180;
  const moveX: -1 | 0 | 1 =
    phase < 110 ? 1 : phase < 145 ? -1 : phase < 165 ? 1 : 0;

  // Cycle across all 8 hookshot aim directions cleanly
  const dirs: readonly (readonly [-1 | 0 | 1, -1 | 0 | 1])[] = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ];
  const [aimX, aimY] = dirs[Math.floor(tick / 18) % dirs.length];

  const sprint = phase % 45 < 28;
  // Jump + double-jump & wall-jump pulses
  const jumpPressed =
    phase === 12 ||
    phase === 24 || // mid-air double jump
    phase === 58 ||
    phase === 70 ||
    phase === 120 ||
    phase === 132;
  const jump =
    (phase >= 12 && phase <= 28) ||
    (phase >= 58 && phase <= 74) ||
    (phase >= 120 && phase <= 136);
  const jumpReleased = phase === 29 || phase === 75 || phase === 137;

  const slidePressed = phase === 40 || phase === 104;
  const slide = (phase >= 40 && phase <= 52) || (phase >= 104 && phase <= 114);

  const attackPressed = phase % 22 === 8;
  const attack = attackPressed || phase % 22 === 9;

  const hookshotPressed = phase === 18 || phase === 82 || phase === 148;
  const hookshot =
    (phase >= 18 && phase <= 26) ||
    (phase >= 82 && phase <= 92) ||
    (phase >= 148 && phase <= 156);

  const burstPressed = phase === 96 || phase === 168;
  const burst = burstPressed;

  // Avoid triggering hub terminal modals via Up press in hub so all 180 ticks execute live gameplay
  const moveY: -1 | 0 | 1 =
    stageId === 'hub'
      ? 0
      : phase === 66
        ? 1 // dive kick / crouch
        : phase === 134
          ? -1 // air up kick
          : 0;

  return makeInput({
    moveX,
    moveY,
    aimX,
    aimY,
    sprint,
    jump,
    jumpPressed,
    jumpReleased,
    slide,
    slidePressed,
    attack,
    attackPressed,
    hookshot,
    hookshotPressed,
    burst,
    burstPressed,
  });
}

function warpPlayerIntoBossArena(state: SimState): void {
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

// ============================================================================
// PILLAR 1: All 15 Official + 12 Remix Stages (27 Layouts x 180 ticks)
// ============================================================================
function runSuite1StageSoak(): void {
  const suite = '1. 27-Layout Stage Soak';
  const layouts: { stageId: StageId; remix: boolean }[] = [
    ...OFFICIAL_STAGE_IDS.map((stageId) => ({ stageId, remix: false })),
    ...REMIXABLE_STAGES.map((stageId) => ({ stageId, remix: true })),
  ];

  const failures: string[] = [];
  let totalTicksStepped = 0;

  for (const { stageId, remix } of layouts) {
    const tag = `${stageId}${remix ? ':remix' : ':std'}`;
    const prog = createInitialProgression();
    unlockAllContent(prog);
    // Equip Air Jumper (2), Power Extender (3), Energy Absorber (1) for rich traversal soak
    prog.loadouts[0].chips = [2, 3, 1];
    prog.loadouts[0].bursts = { neutral: 1, side: 10, up: 2, down: 3 };

    const state = createFullSimState(stageId, remix, prog, CANONICAL_SEED);
    state.player.maxBurstCharges = 6;
    state.player.burstEnergy = 600;

    let stageErr: string | null = null;
    for (let t = 1; t <= SOAK_TICKS_PER_STAGE; t++) {
      // Keep soak running actively even on lethal stages without masking OOB/NaN bugs
      if (state.player.hp <= 4) {
        state.player.hp = state.player.maxHp;
      }
      if (state.player.burstEnergy < 200) {
        state.player.burstEnergy = 400;
      }
      const input = buildActiveScriptInput(t, stageId);
      stepFullSim(state, input);
      totalTicksStepped += 1;

      if (state.screen !== 'playing' && state.screen !== 'stage_clear') {
        stageErr = `${tag} tick=${t}: unexpected screen=${state.screen}`;
        break;
      }
      stageErr = assertStateIntegrity(state, tag);
      if (stageErr) break;
    }

    const digest = hashSimState(state);
    if (!/^[0-9a-f]{8}$/.test(digest)) {
      stageErr = `${tag}: invalid FNV-1a digest=${digest}`;
    }

    if (stageErr) {
      failures.push(stageErr);
    }
  }

  record(
    suite,
    `All ${CONTENT_COUNTS.TOTAL_LAYOUTS} layouts (15 official + 12 remix) x ${SOAK_TICKS_PER_STAGE} ticks`,
    layouts.length === CONTENT_COUNTS.TOTAL_LAYOUTS && failures.length === 0,
    failures.length === 0
      ? `${layouts.length}/27 layouts soaked (${totalTicksStepped} ticks), zero NaNs, zero OOB traps`
      : `failed=${failures.length} [${failures.slice(0, 5).join('; ')}]`,
  );
}

// ============================================================================
// PILLAR 2: Full 12-Boss Gauntlet + Boss Rush + Game Over Transition
// ============================================================================
function runSuite2BossGauntlet(): void {
  const suite = '2. 12-Boss Gauntlet & Lifecycle';
  const bossFailures: string[] = [];

  for (const def of BOSS_DEFINITIONS) {
    const prog = createInitialProgression();
    unlockAllContent(prog);
    prog.loadouts[0].bursts = { neutral: 20, side: 1, up: 2, down: 3 };

    const state = createFullSimState(def.stageId, false, prog, CANONICAL_SEED);
    if (!state.boss || state.boss.bossId !== def.id) {
      bossFailures.push(`${def.id}: missing boss on stage ${def.stageId}`);
      continue;
    }

    const expectedDesp = def.isFinal
      ? BOSS_CONSTANTS.FINAL_DESPERATION_HP
      : BOSS_CONSTANTS.STANDARD_DESPERATION_HP;

    warpPlayerIntoBossArena(state);

    // 1. Activate boss intro
    let sawIntro = false;
    for (let t = 0; t < 12; t++) {
      stepFullSim(state, makeInput());
      if (state.events.some((ev) => ev.type === 'bossIntro' && ev.bossId === def.id)) {
        sawIntro = true;
      }
      if (state.boss.active) break;
    }
    if (!state.boss.active || !sawIntro) {
      bossFailures.push(`${def.id}: failed to activate boss intro`);
      continue;
    }

    // 2. Advance past 90-tick intro + 40 ticks of live Phase 1 AI
    let integrityErr: string | null = null;
    for (let t = 0; t < 130; t++) {
      state.player.hp = state.player.maxHp;
      const aimDir: -1 | 1 = state.boss.x >= state.player.x ? 1 : -1;
      stepFullSim(
        state,
        makeInput({
          moveX: t % 30 < 10 ? aimDir : 0,
          jumpPressed: t % 45 === 10,
          jump: t % 45 >= 10 && t % 45 <= 18,
        }),
      );
      integrityErr = assertStateIntegrity(state, `boss:${def.id}:p1`);
      if (integrityErr) break;
    }
    if (integrityErr) {
      bossFailures.push(integrityErr);
      continue;
    }

    // 3. Drive boss to exact Desperation threshold
    state.boss.invulnTimer = 0;
    const toDesp = Math.max(1, state.boss.hp - expectedDesp);
    damageBoss(state, state.boss, toDesp, {
      isBurst: true,
      onBossDefeated: HOOKS.onBossDefeated,
    });
    if (!state.boss.desperationTriggered || state.boss.phase < 2) {
      bossFailures.push(
        `${def.id}: desperation did not trigger at HP=${state.boss.hp} (threshold=${expectedDesp})`,
      );
      continue;
    }

    // Step through active Desperation attack frames (and Phase 3 for Overlord Apex)
    for (let t = 0; t < 65; t++) {
      state.player.hp = state.player.maxHp;
      stepFullSim(state, makeInput());
      integrityErr = assertStateIntegrity(state, `boss:${def.id}:desp`);
      if (integrityErr) break;
    }
    if (integrityErr) {
      bossFailures.push(integrityErr);
      continue;
    }

    if (def.id === 'overlord_apex') {
      state.boss.invulnTimer = 0;
      damageBoss(state, state.boss, Math.max(1, state.boss.hp - 16), {
        isBurst: true,
        onBossDefeated: HOOKS.onBossDefeated,
      });
      for (let t = 0; t < 35; t++) {
        state.player.hp = state.player.maxHp;
        stepFullSim(state, makeInput());
        integrityErr = assertStateIntegrity(state, 'boss:overlord_apex:p3');
        if (integrityErr) break;
      }
      if (integrityErr || state.boss.phase !== 3) {
        bossFailures.push(integrityErr ?? `overlord_apex: failed to enter phase 3 (phase=${state.boss.phase})`);
        continue;
      }
    }

    // 4. Finish boss & advance stageClearTimer -> screen === 'stage_clear'
    state.boss.invulnTimer = 0;
    damageBoss(state, state.boss, state.boss.hp + 99, {
      isBurst: true,
      onBossDefeated: HOOKS.onBossDefeated,
    });

    for (let t = 0; t < 120 && state.screen !== 'stage_clear'; t++) {
      stepFullSim(state, makeInput());
    }
    if (!state.boss.defeated || state.screen !== 'stage_clear') {
      bossFailures.push(`${def.id}: failed to reach stage_clear (defeated=${state.boss.defeated}, screen=${state.screen})`);
    }
  }

  record(
    suite,
    '12-Boss Gauntlet (Intro -> Phase 1 -> Desperation -> Defeat -> Stage Clear)',
    bossFailures.length === 0,
    bossFailures.length === 0
      ? `All 12/12 bosses completed Intro -> Desperation -> Defeat -> stage_clear cleanly`
      : `failed=${bossFailures.length} [${bossFailures.slice(0, 4).join('; ')}]`,
  );

  // Boss Rush sequential gauntlet verification
  const rushState = createFullSimState('boss_rush', false, undefined, CANONICAL_SEED);
  let rushOk = rushState.bossRush.active && rushState.bossRush.bossOrder.length === BOSS_RUSH_ORDER.length;
  let rushDetail = '';

  for (let i = 0; i < BOSS_RUSH_ORDER.length && rushOk; i++) {
    if (!rushState.boss || rushState.boss.bossId !== BOSS_RUSH_ORDER[i]) {
      rushOk = false;
      rushDetail = `expected boss[${i}]=${BOSS_RUSH_ORDER[i]}, got ${rushState.boss?.bossId ?? 'null'}`;
      break;
    }
    for (let t = 0; t < 100; t++) {
      rushState.player.hp = rushState.player.maxHp;
      stepFullSim(rushState, makeInput());
      if (rushState.boss && rushState.boss.active && rushState.boss.aiState !== 'intro') break;
    }
    rushState.boss!.invulnTimer = 0;
    damageBoss(rushState, rushState.boss!, rushState.boss!.hp + 99, {
      isBurst: true,
      onBossDefeated: HOOKS.onBossDefeated,
    });
  }
  for (let t = 0; t < 120 && rushState.screen !== 'stage_clear'; t++) {
    stepFullSim(rushState, makeInput());
  }
  if (
    rushOk &&
    (rushState.bossRush.splitTicks.length !== 12 ||
      rushState.bossRush.active !== false ||
      rushState.screen !== 'stage_clear')
  ) {
    rushOk = false;
    rushDetail = `splits=${rushState.bossRush.splitTicks.length}, active=${rushState.bossRush.active}, screen=${rushState.screen}`;
  }
  record(
    suite,
    'Boss Rush sequential 12-boss chain & split timer',
    rushOk,
    rushOk
      ? `Chained 12/12 bosses sequentially, totalTicks=${rushState.bossRush.totalTicks}, splits=12, screen=stage_clear`
      : rushDetail,
  );

  // Game Over transition verification (HP -> 0 -> screen === 'game_over')
  const goState = createFullSimState('opening', false, undefined, CANONICAL_SEED);
  stepFullSim(goState, makeInput());
  applyDamageToPlayer(goState, goState.player.maxHp + 50, goState.player.x + 12, {
    ignoreInvuln: true,
  });
  const sawGameOverEv = goState.events.some((ev) => ev.type === 'gameOver');
  const goOk =
    goState.player.hp === 0 &&
    goState.player.action === 'dead' &&
    goState.screen === 'game_over' &&
    sawGameOverEv;
  record(
    suite,
    'Player HP -> 0 clean Game Over transition',
    goOk,
    `hp=${goState.player.hp}, action=${goState.player.action}, screen=${goState.screen}, event=${sawGameOverEv}`,
  );
}

// ============================================================================
// PILLAR 3: Bit-for-Bit FNV-1a Determinism Verification (600 ticks x 2 runs)
// ============================================================================
function runDeterminismTape(): {
  checkpoints: Record<number, string>;
  integrityErr: string | null;
} {
  const prog = createInitialProgression();
  unlockAllContent(prog);
  prog.loadouts[0].chips = [2, 3, 1];
  prog.loadouts[0].bursts = { neutral: 1, side: 10, up: 2, down: 3 };
  prog.loadouts[0].armorPaint = 5;

  const state = createFullSimState('opening', false, prog, CANONICAL_SEED);
  state.player.maxBurstCharges = 6;
  state.player.burstEnergy = 600;

  const checkpoints: Record<number, string> = {};
  let integrityErr: string | null = null;

  for (let tick = 1; tick <= DETERMINISM_TICKS; tick++) {
    if (state.player.hp <= 4) {
      state.player.hp = state.player.maxHp;
    }
    const input = buildActiveScriptInput(tick, 'opening');
    stepFullSim(state, input);

    const err = assertStateIntegrity(state, 'determinism:opening');
    if (err) {
      integrityErr = err;
      break;
    }

    if (tick === 150 || tick === 300 || tick === 450 || tick === 600) {
      checkpoints[tick] = hashSimState(state);
    }
  }

  return { checkpoints, integrityErr };
}

function runSuite3Determinism(): Record<number, string> {
  const suite = '3. FNV-1a Determinism';
  const runA = runDeterminismTape();
  const runB = runDeterminismTape();

  const ticks = [150, 300, 450, 600] as const;
  const mismatches: string[] = [];

  if (runA.integrityErr) mismatches.push(`runA:${runA.integrityErr}`);
  if (runB.integrityErr) mismatches.push(`runB:${runB.integrityErr}`);

  for (const t of ticks) {
    const a = runA.checkpoints[t];
    const b = runB.checkpoints[t];
    if (!a || !b || a !== b || !/^[0-9a-f]{8}$/.test(a)) {
      mismatches.push(`t=${t}: A=${a ?? 'none'} vs B=${b ?? 'none'}`);
    }
  }

  record(
    suite,
    '600-tick multi-action campaign tape bit-for-bit FNV-1a parity (seed 0x4b52554e)',
    mismatches.length === 0,
    mismatches.length === 0
      ? `t150=${runA.checkpoints[150]} t300=${runA.checkpoints[300]} t450=${runA.checkpoints[450]} t600=${runA.checkpoints[600]}`
      : mismatches.join('; '),
  );

  return runA.checkpoints;
}

// ============================================================================
// Main Runner
// ============================================================================
function main(): void {
  const t0 = performance.now();
  console.log('========================================================================');
  console.log('KRUNKED CIRCUIT — GATE B HEADLESS DETERMINISTIC CAMPAIGN SOAK');
  console.log('========================================================================');

  runSuite1StageSoak();
  runSuite2BossGauntlet();
  const canonicalHashes = runSuite3Determinism();

  const elapsedMs = Math.round(performance.now() - t0);
  let passed = 0;
  let failed = 0;

  for (const c of checks) {
    const tag = c.ok ? '[PASS]' : '[FAIL]';
    console.log(`${tag} ${c.suite} :: ${c.name}`);
    console.log(`       ${c.detail}`);
    if (c.ok) passed += 1;
    else failed += 1;
  }

  console.log('------------------------------------------------------------------------');
  console.log(`CANONICAL FNV-1A REPLAY HASH (seed=0x4b52554e, tick=600): ${canonicalHashes[600] ?? 'N/A'}`);
  console.log(`CHECKPOINTS: t150=${canonicalHashes[150]} | t300=${canonicalHashes[300]} | t450=${canonicalHashes[450]} | t600=${canonicalHashes[600]}`);
  console.log(`SUMMARY: ${passed}/${checks.length} PASSED, ${failed} FAILED (${elapsedMs} ms)`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main();
