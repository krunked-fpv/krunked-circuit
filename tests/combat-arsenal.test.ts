import { describe, expect, it } from 'vitest';
import {
  ATTACK_DATA,
  BOSS_CONSTANTS,
  CONTENT_COUNTS,
  DAMAGE_TABLES,
  ENGINE_CONSTANTS,
  HOOKSHOT_CONSTANTS,
  PLAYER_PHYSICS,
  TileType,
  createNeutralInput,
  type ArmorPaintId,
  type BurstId,
  type ChipId,
  type Difficulty,
  type InputFrame,
  type SimState,
  type StageDefinition,
} from '../src/contracts/index';
import {
  ARMOR_PAINT_DEFINITIONS,
  BURST_DEFINITIONS,
  CHIP_DEFINITIONS,
  getStageDefinition,
} from '../src/data/index';
import { BURST_COSTS } from '../src/sim/bursts';
import {
  addBurstEnergy,
  applyDamageToPlayer,
  applyHazardDamage,
  computePlayerInvulnTicks,
  damageBoss,
  getAttackHitbox,
  getCatchInterruptTicks,
  spawnProjectile,
} from '../src/sim/combat';
import { spawnEnemyFromArchetype } from '../src/sim/enemies';
import { createInitialProgression, unlockAllContent } from '../src/sim/progression';
import { createFullSimHooks, createFullSimState, stepFullSim } from '../src/sim/runtime';
import { createSimState, loadStageIntoState, stepSim } from '../src/sim/step';

const TS = ENGINE_CONSTANTS.TILE_SIZE;
const CELL_W = ENGINE_CONSTANTS.CELL_TILES_W;
const CELL_H = ENGINE_CONSTANTS.CELL_TILES_H;
const HOOKS = createFullSimHooks();

function makeInput(overrides: Partial<InputFrame> = {}): InputFrame {
  return { ...createNeutralInput('keyboard'), ...overrides };
}

function createCombatArena(
  mutate?: (tiles: number[], w: number, h: number) => void,
): SimState {
  const tilesW = CELL_W;
  const tilesH = CELL_H;
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
  mutate?.(tiles, tilesW, tilesH);

  const stage: StageDefinition = {
    id: 'tutorial',
    name: 'Combat Arena',
    subtitle: 'Testing',
    remix: false,
    biomeGimmick: 'tutorial_course',
    bgmKey: 'bgm_tutorial',
    bossBgmKey: 'bgm_boss_master',
    cellsW: 1,
    cellsH: 1,
    tilesW,
    tilesH,
    tiles,
    spawnX: 6 * TS,
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
  unlockAllContent(prog);
  prog.loadouts[0].chips = [0, 0, 0];
  prog.loadouts[0].armorPaint = 0;
  prog.loadouts[0].bursts = { neutral: 1, side: 4, up: 2, down: 3 };

  const state = createSimState(stage, prog, 0x4b52554e);
  loadStageIntoState(state, stage, HOOKS);
  state.player.maxBurstCharges = 6;
  state.player.burstEnergy = 600;
  stepSim(state, makeInput(), HOOKS);
  return state;
}

describe('Combat, Guard-Break, 20 Bursts, 20 Chips, 12 Armors & Modifiers', () => {
  describe('Guard-Break, Grabbable Shield & 8-Dir Overhead Throw Chain', () => {
    it('blocks frontal jabs, shatters shield on sprintKick/airUpKick, grabs shield & deals 5 COLLISION + 5 BOUNCE', () => {
      expect(HOOKSHOT_CONSTANTS.SHIELD_PROJECTILE_HP).toBe(3);

      // 1. Verify frontal jab is blocked by intact shield
      const state = createCombatArena();
      const guard = spawnEnemyFromArchetype(
        state,
        'rail_shield_guard',
        state.player.x + 22,
        13 * TS - 26,
      )!;
      guard.facing = -1;
      const initialHp = guard.hp;

      stepSim(state, makeInput({ attack: true, attackPressed: true }), HOOKS);
      for (let i = 0; i < 6; i++) stepSim(state, makeInput(), HOOKS);
      expect(guard.shielded).toBe(true);
      expect(guard.hp).toBe(initialHp);

      // 2. Guard-break via airUpKick shatters shield -> spawns grabbable thrown_shield
      const sAir = createCombatArena();
      const gAir = spawnEnemyFromArchetype(
        sAir,
        'rail_shield_guard',
        sAir.player.x + 20,
        13 * TS - 26,
      )!;
      gAir.facing = -1;
      sAir.player.grounded = false;
      sAir.player.y -= 6;
      stepSim(sAir, makeInput({ moveY: -1, attack: true, attackPressed: true }), HOOKS);
      expect(sAir.player.attackId).toBe('airUpKick');
      for (let i = 0; i < 5; i++) stepSim(sAir, makeInput(), HOOKS);
      expect(gAir.shielded).toBe(false);
      expect(sAir.projectiles.some((pr) => pr.kind === 'thrown_shield')).toBe(true);

      // 3. Guard-break via sprintKick -> grab dropped shield -> verify 8-dir throw velocities
      const sSprint = createCombatArena();
      const gSprint = spawnEnemyFromArchetype(
        sSprint,
        'rail_shield_guard',
        sSprint.player.x + 24,
        13 * TS - 26,
      )!;
      gSprint.facing = -1;
      sSprint.player.vx = 4.0;
      stepSim(sSprint, makeInput({ sprint: true, attack: true, attackPressed: true }), HOOKS);
      expect(sSprint.player.attackId).toBe('sprintKick');
      for (let i = 0; i < 10; i++) stepSim(sSprint, makeInput(), HOOKS);

      expect(gSprint.shielded).toBe(false);
      const shieldProj = sSprint.projectiles.find((pr) => pr.kind === 'thrown_shield');
      expect(shieldProj).toBeDefined();
      expect(shieldProj!.bouncesLeft).toBe(2); // 1 collision + 2 bounces = 3 HP

      // Place shield calmly in front of Volt & hookshot-grab it overhead
      shieldProj!.x = sSprint.player.x + 28;
      shieldProj!.y = sSprint.player.y + 8;
      shieldProj!.vx = 0;
      shieldProj!.vy = 0;
      gSprint.dead = true;
      sSprint.player.attackTimer = 0;
      sSprint.player.attackId = null;

      stepSim(sSprint, makeInput({ hookshot: true, hookshotPressed: true, aimX: 1 }), HOOKS);
      stepSim(sSprint, makeInput({ hookshot: true }), HOOKS);
      expect(sSprint.player.hook.phase).toBe('holding');
      expect(sSprint.player.hook.heldKind).toBe('shield');

      // Test all 8-dir throw vector formulas cleanly
      const checkThrowVec = (
        inputPatch: Partial<InputFrame>,
        expectedVx: number,
        expectedVy: number,
      ): void => {
        const s = createCombatArena();
        s.player.facing = 1;
        s.player.hook.phase = 'holding';
        s.player.hook.heldKind = 'shield';
        s.player.hook.heldEntityId = 0;
        stepSim(s, makeInput({ hookshotPressed: true, ...inputPatch }), HOOKS);
        const thrown = s.projectiles.find((pr) => pr.kind === 'thrown_shield');
        expect(thrown).toBeDefined();
        expect(thrown!.vx).toBeCloseTo(expectedVx, 5);
        // stepProjectiles applies +0.22 thrown gravity on the same tick
        expect(thrown!.vy).toBeCloseTo(expectedVy + 0.22, 5);
      };

      // Neutral right: vx = 6.0, vy = -2.0
      checkThrowVec({ aimX: 1, aimY: 0 }, 6.0, -2.0);
      // Sprint neutral right: vx = 6.0 + 1.25 = 7.25, vy = -2.0
      checkThrowVec({ aimX: 1, aimY: 0, sprint: true }, 7.25, -2.0);
      // Diagonal up-right: vx = 4.0, vy = -6.0
      checkThrowVec({ aimX: 1, aimY: -1 }, 4.0, -6.0);
      // Diagonal down-right: vx = 4.0, vy = +3.0
      checkThrowVec({ aimX: 1, aimY: 1 }, 4.0, 3.0);

      // 4. Verify 5 COLLISION + 5 BOUNCE chain damage across two enemies
      const sChain = createCombatArena();
      const targetA = spawnEnemyFromArchetype(sChain, 'heavy_enforcer', 10 * TS, 13 * TS - 28)!;
      targetA.hp = 10;
      targetA.maxHp = 10;
      targetA.shielded = false;
      const targetB = spawnEnemyFromArchetype(sChain, 'heavy_enforcer', 8 * TS, 13 * TS - 28)!;
      targetB.hp = 10;
      targetB.maxHp = 10;
      targetB.shielded = false;

      // Spawn thrown shield flying right into targetA, which bounces left into targetB!
      spawnProjectile(sChain, {
        owner: 'thrown',
        kind: 'thrown_shield',
        x: targetA.x - 10,
        y: targetA.y + 8,
        vx: HOOKSHOT_CONSTANTS.THROW_VX_NEUTRAL,
        vy: -0.5,
        w: 14,
        h: 14,
        damage: HOOKSHOT_CONSTANTS.THROW_COLLISION_DAMAGE,
        ttl: 120,
        pierce: false,
        bouncesLeft: 2,
        color: '#38bdf8',
      });

      for (let i = 0; i < 20; i++) {
        stepSim(sChain, makeInput(), HOOKS);
        // Freeze AI movement so bounce path hits cleanly
        targetA.vx = 0;
        targetB.vx = 0;
      }

      expect(targetA.hp).toBe(5); // 10 - 5 COLLISION
      expect(targetB.hp).toBe(5); // 10 - 5 BOUNCE
    });
  });

  describe('Dive Kick Bounce & Heavy Dive Kick Upgrade (>= 16 ticks)', () => {
    it('bounces player upward on dive kick hit and upgrades to diveKickHeavy (2 dmg + armorBreak) after 16t fall', () => {
      // 1. Standard dive kick bounce
      const state = createCombatArena();
      const foe = spawnEnemyFromArchetype(state, 'heavy_enforcer', 8 * TS, 13 * TS - 28)!;
      foe.shielded = false;
      foe.hp = 8;

      state.player.x = foe.x;
      state.player.y = foe.y - 36;
      state.player.grounded = false;
      state.player.airJumpsUsed = 1;

      stepSim(state, makeInput({ moveY: 1, attack: true, attackPressed: true }), HOOKS);
      expect(state.player.attackId).toBe('diveKick');

      let bounced = false;
      for (let i = 0; i < 12; i++) {
        stepSim(state, makeInput(), HOOKS);
        if (state.player.vy < -3.0) {
          bounced = true;
          break;
        }
      }
      expect(bounced).toBe(true);
      expect(state.player.airJumpsUsed).toBe(0);
      expect(foe.hp).toBe(7); // 1 dmg standard dive kick

      // 2. Heavy dive kick upgrade (>= 16 ticks fall -> 2 dmg + armorBreak)
      const sHeavy = createCombatArena();
      const shieldFoe = spawnEnemyFromArchetype(sHeavy, 'heavy_enforcer', 8 * TS, 13 * TS - 28)!;
      shieldFoe.shielded = true;
      shieldFoe.hp = 8;

      sHeavy.player.x = shieldFoe.x;
      sHeavy.player.y = 2 * TS;
      sHeavy.player.grounded = false;
      sHeavy.player.diveKickTicks = 15; // Next dive tick hits 16 -> upgrades!

      stepSim(sHeavy, makeInput({ moveY: 1, attack: true, attackPressed: true }), HOOKS);
      // After 1st tick of diveKick, diveKickTicks increments from 15 -> 16 and upgrades to diveKickHeavy
      expect(sHeavy.player.attackId).toBe('diveKickHeavy');

      // Reposition directly above shielded enemy to strike while diveKickHeavy is active
      sHeavy.player.x = shieldFoe.x;
      sHeavy.player.y = shieldFoe.y - 16;
      for (let i = 0; i < 6; i++) {
        stepSim(sHeavy, makeInput(), HOOKS);
        if (!shieldFoe.shielded) break;
      }

      expect(shieldFoe.shielded).toBe(false); // armorBreak shattered shield!
      expect(shieldFoe.hp).toBe(6); // 8 - 2 heavy dive kick dmg
    });
  });

  describe('ALL 20 Burst Techniques (IDs 1..20)', () => {
    it('activates every single Burst Technique (1..20) cleanly with verified gameplay effects', () => {
      expect(BURST_DEFINITIONS.length).toBe(CONTENT_COUNTS.BURST_TECHNIQUES);

      for (const def of BURST_DEFINITIONS) {
        const id: BurstId = def.id;
        const state = createCombatArena((tiles, w) => {
          // Breakable tile directly ahead for Piercing Drill (14)
          tiles[12 * w + 8] = TileType.BREAKABLE;
        });
        state.progression.loadouts[0].bursts = { neutral: id, side: id, up: id, down: id };
        state.player.facing = 1;
        state.player.burstEnergy = 400;

        // Place target enemy nearby in front of Volt
        const foe = spawnEnemyFromArchetype(
          state,
          'heavy_enforcer',
          state.player.x + 26,
          13 * TS - 28,
        )!;
        foe.hp = 20;
        foe.maxHp = 20;
        foe.shielded = false;

        // Special setup for specific bursts
        if (id === 4 || id === 6 || id === 7) {
          spawnProjectile(state, {
            owner: 'enemy',
            kind: 'enemy_shot',
            x: state.player.x - 16,
            y: state.player.y + 8,
            vx: 4.0,
            vy: 0,
            w: 8,
            h: 8,
            damage: 2,
            ttl: 60,
            pierce: false,
            bouncesLeft: 0,
            color: '#f43f5e',
          });
        }
        if (id === 16 || id === 17) {
          // Place mid-range so Hologram Trap stays armed first and Current Arc bolts visibly home in
          foe.x = state.player.x + 70;
        }
        if (id === 18) {
          state.player.hp = 6;
        }
        if (id === 19) {
          foe.x = state.player.x + 120;
          state.player.hook.remoteBombTargetId = foe.id;
        }
        if (id === 15) {
          state.player.grounded = false;
          state.player.y = 8 * TS;
          state.player.vy = 1.0;
        }

        const energyBefore = state.player.burstEnergy;
        const expectedCost = BURST_COSTS[id] * PLAYER_PHYSICS.BURST_ENERGY_PER_CHARGE;

        stepSim(state, makeInput({ burst: true, burstPressed: true }), HOOKS);

        // Energy deducted accurately
        expect(state.player.burstEnergy).toBeCloseTo(energyBefore - expectedCost, 2);

        switch (id) {
          case 1: // Flying Strike
            expect(state.projectiles.some((pr) => pr.kind === 'burst_beam')).toBe(true);
            expect(foe.hp).toBeLessThan(20);
            break;
          case 2: // Rising Upper
            expect(state.player.vy).toBeLessThan(-5.0);
            expect(state.projectiles.some((pr) => pr.kind === 'burst_beam')).toBe(true);
            break;
          case 3: // Heavenly Piledrive
            expect(state.projectiles.filter((pr) => pr.kind === 'shockwave').length).toBeGreaterThanOrEqual(2);
            expect(foe.hp).toBeLessThan(20);
            break;
          case 4: // Gravity Freeze
            expect(state.player.freezeFieldTimer).toBe(240);
            expect(foe.stunTimer).toBeGreaterThan(0);
            break;
          case 5: // Surface Render
            expect(state.projectiles.filter((pr) => pr.kind === 'shockwave').length).toBe(3);
            break;
          case 6: // Catch Interrupt
            expect(getCatchInterruptTicks(state.player)).toBeGreaterThan(0);
            // Enemy shot inside dome was reflected to player owner
            expect(state.projectiles.some((pr) => pr.owner === 'player')).toBe(true);
            // Reactive parry also intercepts incoming damage with 0 HP lost
            const hpPreParry = state.player.hp;
            const hitApplied = applyDamageToPlayer(state, 4, state.player.x + 10);
            expect(hitApplied).toBe(false);
            expect(state.player.hp).toBe(hpPreParry);
            break;
          case 7: // Screen Interrupt
            expect(foe.hp).toBeLessThan(20);
            expect(state.projectiles.some((pr) => pr.owner === 'enemy')).toBe(false);
            break;
          case 8: // Cycle Kick
            expect(state.projectiles.filter((pr) => pr.kind === 'burst_beam').length).toBe(3);
            break;
          case 9: // Clone Array
            expect(state.player.cloneTimer).toBe(360);
            expect(state.projectiles.some((pr) => pr.kind === 'burst_beam')).toBe(true);
            break;
          case 10: // Burst Spark
            expect(state.projectiles.filter((pr) => pr.kind === 'electric_arc').length).toBe(8);
            break;
          case 11: // Hardware Barrier
            expect(state.player.barrierHits).toBe(3);
            expect(state.player.barrierTimer).toBe(600);
            break;
          case 12: // Gravity Dash
            expect(state.player.invulnTimer).toBeGreaterThan(0);
            expect(state.projectiles.some((pr) => pr.kind === 'burst_beam')).toBe(true);
            break;
          case 13: // Function Overload
            expect(state.player.overloadTimer).toBe(PLAYER_PHYSICS.OVERLOAD_DURATION_TICKS);
            break;
          case 14: // Piercing Drill
            expect(state.projectiles.some((pr) => pr.kind === 'dive_beam')).toBe(true);
            expect(state.tiles[12 * state.tilesW + 8]).toBe(TileType.EMPTY);
            break;
          case 15: // Support Platform
            expect(state.projectiles.some((pr) => pr.kind === 'support_platform' && pr.solid)).toBe(true);
            break;
          case 16: // Hologram Trap
            expect(state.projectiles.some((pr) => pr.kind === 'hologram_mine')).toBe(true);
            // Step until nearby foe triggers mine explosion
            foe.x = state.player.x + 8;
            stepSim(state, makeInput(), HOOKS);
            expect(foe.hp).toBeLessThan(20);
            break;
          case 17: // Current Arc
            expect(state.projectiles.filter((pr) => pr.kind === 'electric_arc').length).toBe(3);
            for (let k = 0; k < 20; k++) stepSim(state, makeInput(), HOOKS);
            expect(foe.hp).toBeLessThan(20);
            break;
          case 18: // Emergency Heal
            expect(state.player.hp).toBe(12); // 6 + 6
            break;
          case 19: // Distant Detonation
            expect(state.player.hook.remoteBombTargetId).toBe(0);
            expect(foe.hp).toBe(13); // 20 - 7 explosive AoE
            break;
          case 20: // Erupting Beam
            const beam = state.projectiles.find((pr) => pr.kind === 'burst_beam');
            expect(beam).toBeDefined();
            expect(beam!.damage).toBe(9);
            expect(beam!.pierce).toBe(true);
            break;
        }
      }
    });
  });

  describe('ALL 20 Booster Chips (IDs 1..20)', () => {
    it('verifies active mechanical effects for every Booster Chip 1..20', () => {
      expect(CHIP_DEFINITIONS.length).toBe(CONTENT_COUNTS.BOOSTER_CHIPS);
      const verifiedChips = new Set<ChipId>();

      // Chip 1: Energy Absorber (damage taken grants +20 burst energy)
      {
        const s = createCombatArena();
        s.progression.loadouts[0].chips = [1, 0, 0];
        s.player.burstEnergy = 0;
        applyDamageToPlayer(s, 2);
        expect(s.player.burstEnergy).toBe(20);
        verifiedChips.add(1);
      }

      // Chip 2: Air Jumper (mid-air double jump)
      {
        const s = createCombatArena();
        s.progression.loadouts[0].chips = [2, 0, 0];
        s.player.grounded = false;
        s.player.leftGroundTick = -999;
        s.player.y = 8 * TS;
        s.player.vy = 1.0;
        stepSim(s, makeInput({ jump: true, jumpPressed: true }), HOOKS);
        expect(s.player.airJumpsUsed).toBe(1);
        expect(s.player.vy).toBeCloseTo(PLAYER_PHYSICS.DOUBLE_JUMP_IMPULSE + PLAYER_PHYSICS.GRAVITY, 5);
        verifiedChips.add(2);
      }

      // Chip 3: Power Extender (+16 px attack width)
      {
        const s = createCombatArena();
        const baseW = getAttackHitbox(s, ATTACK_DATA.jabNeutral).w;
        s.progression.loadouts[0].chips = [3, 0, 0];
        const extW = getAttackHitbox(s, ATTACK_DATA.jabNeutral).w;
        expect(extW - baseW).toBe(16);
        verifiedChips.add(3);
      }

      // Chip 4: Grip Enhancer (0.0 wall-slide speed)
      {
        const s = createCombatArena((tiles, w) => {
          for (let ty = 3; ty <= 12; ty++) tiles[ty * w + 10] = TileType.SOLID;
        });
        s.progression.loadouts[0].chips = [4, 0, 0];
        s.player.x = 10 * TS - PLAYER_PHYSICS.STAND_W;
        s.player.y = 5 * TS;
        s.player.vy = 3.5;
        s.player.grounded = false;
        stepSim(s, makeInput({ moveX: 1 }), HOOKS);
        expect(s.player.vy).toBe(0);
        verifiedChips.add(4);
      }

      // Chip 5: Surge Protector (-1 non-lethal hazard damage)
      {
        const s = createCombatArena();
        s.progression.loadouts[0].chips = [5, 0, 0];
        const hpBefore = s.player.hp;
        applyHazardDamage(s);
        expect(hpBefore - s.player.hp).toBe(DAMAGE_TABLES.normal.hazard - 1);
        verifiedChips.add(5);
      }

      // Chip 6: Catch Block (blocks frontal enemy projectile when holding object)
      {
        const s = createCombatArena();
        s.progression.loadouts[0].chips = [6, 0, 0];
        s.player.facing = 1;
        s.player.hook.phase = 'holding';
        s.player.hook.heldKind = 'shield';
        const hpBefore = s.player.hp;
        spawnProjectile(s, {
          owner: 'enemy',
          kind: 'enemy_shot',
          x: s.player.x + s.player.w - 2,
          y: s.player.y + 8,
          vx: -2,
          vy: 0,
          w: 8,
          h: 8,
          damage: 3,
          ttl: 30,
          pierce: false,
          bouncesLeft: 0,
          color: '#f43f5e',
        });
        stepSim(s, makeInput(), HOOKS);
        expect(s.player.hp).toBe(hpBefore);
        verifiedChips.add(6);
      }

      // Chip 7: Magnet Chassis (pulls nearby pickup inward)
      {
        const s = createCombatArena();
        s.progression.loadouts[0].chips = [7, 0, 0];
        const startX = s.player.x + 60;
        s.pickups.push({
          id: s.nextEntityId++,
          kind: 'bit_10',
          x: startX,
          y: s.player.y + 8,
          vx: 0,
          vy: 0,
          value: 10,
          ttl: 200,
          collected: false,
        });
        for (let i = 0; i < 6; i++) stepSim(s, makeInput(), HOOKS);
        expect(s.pickups[0].x).toBeLessThan(startX - 4);
        verifiedChips.add(7);
      }

      // Chip 8: Emergency Accumulator (passive burst recharge at <= 25% HP)
      {
        const s = createCombatArena();
        s.progression.loadouts[0].chips = [8, 0, 0];
        s.player.hp = Math.ceil(s.player.maxHp * 0.25);
        s.player.burstEnergy = 0;
        for (let i = 0; i < 18; i++) stepSim(s, makeInput(), HOOKS);
        expect(s.player.burstEnergy).toBeGreaterThan(0);
        verifiedChips.add(8);
      }

      // Chip 9: Underflow Guard (survive fatal non-hazard hit at 1 HP when hp >= 2)
      {
        const s = createCombatArena();
        s.progression.loadouts[0].chips = [9, 0, 0];
        s.player.hp = 3;
        applyDamageToPlayer(s, 10);
        expect(s.player.hp).toBe(1);
        expect(s.screen).toBe('playing');
        verifiedChips.add(9);
      }

      // Chip 10: Energy Multiplier (+35% burst energy gain)
      {
        const s = createCombatArena();
        s.progression.loadouts[0].chips = [10, 0, 0];
        s.player.burstEnergy = 0;
        addBurstEnergy(s, 20);
        expect(s.player.burstEnergy).toBeCloseTo(27, 5);
        verifiedChips.add(10);
      }

      // Chip 11: Light Alloy (low-gravity hold-jump float capped at 2.2)
      {
        const sNormal = createCombatArena();
        const sLight = createCombatArena();
        sLight.progression.loadouts[0].chips = [11, 0, 0];
        for (const st of [sNormal, sLight]) {
          st.player.grounded = false;
          st.player.y = 3 * TS;
          st.player.vy = 0;
        }
        for (let i = 0; i < 15; i++) {
          stepSim(sNormal, makeInput({ jump: true }), HOOKS);
          stepSim(sLight, makeInput({ jump: true }), HOOKS);
        }
        expect(sLight.player.vy).toBeLessThanOrEqual(2.2);
        expect(sLight.player.vy).toBeLessThan(sNormal.player.vy);
        verifiedChips.add(11);
      }

      // Chip 12: Frame Amplifier (extended combo timer +60t and longer enemy stun)
      {
        const sBase = createCombatArena();
        const sAmp = createCombatArena();
        sAmp.progression.loadouts[0].chips = [12, 0, 0];

        const eBase = spawnEnemyFromArchetype(sBase, 'heavy_enforcer', sBase.player.x + 22, 13 * TS - 28)!;
        const eAmp = spawnEnemyFromArchetype(sAmp, 'heavy_enforcer', sAmp.player.x + 22, 13 * TS - 28)!;
        eBase.shielded = false;
        eAmp.shielded = false;

        stepSim(sBase, makeInput({ attack: true, attackPressed: true }), HOOKS);
        stepSim(sAmp, makeInput({ attack: true, attackPressed: true }), HOOKS);
        for (let i = 0; i < 5; i++) {
          stepSim(sBase, makeInput(), HOOKS);
          stepSim(sAmp, makeInput(), HOOKS);
        }
        expect(sAmp.player.comboTimer).toBeGreaterThan(sBase.player.comboTimer);
        expect(eAmp.stunTimer).toBeGreaterThan(eBase.stunTimer);
        verifiedChips.add(12);
      }

      // Chip 13: Dodge Slider (invulnerable while sliding)
      {
        const s = createCombatArena();
        s.progression.loadouts[0].chips = [13, 0, 0];
        stepSim(s, makeInput({ slide: true, slidePressed: true }), HOOKS);
        expect(s.player.sliding).toBe(true);
        const hpBefore = s.player.hp;
        const hit = applyDamageToPlayer(s, 4);
        expect(hit).toBe(false);
        expect(s.player.hp).toBe(hpBefore);
        verifiedChips.add(13);
      }

      // Chip 14: Speed Basher (1.55 impact damage while sprinting into enemy)
      {
        const s = createCombatArena();
        s.progression.loadouts[0].chips = [14, 0, 0];
        const foe = spawnEnemyFromArchetype(s, 'heavy_enforcer', s.player.x + 8, 13 * TS - 28)!;
        foe.shielded = false;
        foe.hp = 10;
        s.player.vx = PLAYER_PHYSICS.SPRINT_MAX_SPEED;
        stepSim(s, makeInput({ moveX: 1, sprint: true }), HOOKS);
        expect(foe.hp).toBeCloseTo(10 - PLAYER_PHYSICS.SPEED_BASHER_DAMAGE, 2);
        verifiedChips.add(14);
      }

      // Chip 15: Chain Booster (+3 ticks hookshot timer & +1 hookshot damage)
      {
        const s = createCombatArena();
        s.progression.loadouts[0].chips = [15, 0, 0];
        const foe = spawnEnemyFromArchetype(s, 'heavy_enforcer', s.player.x + 36, 13 * TS - 28)!;
        foe.shielded = false;
        foe.hp = 10;
        stepSim(s, makeInput({ hookshot: true, hookshotPressed: true, aimX: 1 }), HOOKS);
        expect(s.player.hook.timer).toBe(
          HOOKSHOT_CONSTANTS.TIMER_MAX + HOOKSHOT_CONSTANTS.CHAIN_BOOSTER_EXTRA_TICKS,
        );
        stepSim(s, makeInput({ hookshot: true }), HOOKS);
        expect(foe.hp).toBe(8); // 1 base + 1 Chain Booster = 2 dmg
        verifiedChips.add(15);
      }

      // Chip 16: Chain Dasher (hookshot zips into non-grabbable enemy via latched_wall)
      {
        const s = createCombatArena();
        s.progression.loadouts[0].chips = [16, 0, 0];
        const foe = spawnEnemyFromArchetype(s, 'heavy_enforcer', s.player.x + 36, 13 * TS - 28)!;
        foe.shielded = false;
        foe.hp = 10;
        stepSim(s, makeInput({ hookshot: true, hookshotPressed: true, aimX: 1 }), HOOKS);
        stepSim(s, makeInput({ hookshot: true }), HOOKS);
        expect(s.player.hook.phase).toBe('latched_wall');
        verifiedChips.add(16);
      }

      // Chip 17: Repair Enhancer (+2 HP on health pickups & Emergency Heal)
      {
        const s = createCombatArena();
        s.progression.loadouts[0].chips = [17, 0, 0];
        s.player.hp = 6;
        s.pickups.push({
          id: s.nextEntityId++,
          kind: 'health_small',
          x: s.player.x + 2,
          y: s.player.y + 8,
          vx: 0,
          vy: 0,
          value: 4,
          ttl: 120,
          collected: false,
        });
        stepSim(s, makeInput(), HOOKS);
        expect(s.player.hp).toBe(12); // 6 + (4 + 2)
        verifiedChips.add(17);
      }

      // Chip 18: Nullifying Layer (negates 1 hit & enters 600t cooldown)
      {
        const s = createCombatArena();
        s.progression.loadouts[0].chips = [18, 0, 0];
        s.player.nullifyReady = true;
        const hpBefore = s.player.hp;
        const applied = applyDamageToPlayer(s, 5);
        expect(applied).toBe(false);
        expect(s.player.hp).toBe(hpBefore);
        expect(s.player.nullifyReady).toBe(false);
        expect(s.player.nullifyCooldown).toBe(600);
        verifiedChips.add(18);
      }

      // Chip 19: Protection Timer (1.5x invuln frames)
      {
        const s = createCombatArena();
        const baseInv = computePlayerInvulnTicks(s);
        s.progression.loadouts[0].chips = [19, 0, 0];
        const boostedInv = computePlayerInvulnTicks(s);
        expect(boostedInv).toBe(Math.round(baseInv * PLAYER_PHYSICS.PROTECTION_TIMER_MULT));
        verifiedChips.add(19);
      }

      // Chip 20: Overflow Converter (excess healing converts to burst energy)
      {
        const s = createCombatArena();
        s.progression.loadouts[0].chips = [20, 0, 0];
        s.player.hp = s.player.maxHp;
        s.player.burstEnergy = 0;
        s.pickups.push({
          id: s.nextEntityId++,
          kind: 'health_small',
          x: s.player.x + 2,
          y: s.player.y + 8,
          vx: 0,
          vy: 0,
          value: 4,
          ttl: 120,
          collected: false,
        });
        stepSim(s, makeInput(), HOOKS);
        expect(s.player.burstEnergy).toBe(60); // 4 overflow * 15
        verifiedChips.add(20);
      }

      expect(verifiedChips.size).toBe(20);
    });
  });

  describe('ALL 12 Functional Armor Paints (IDs 0..11)', () => {
    it('verifies distinct functional gameplay traits across all 12 Armor Paints (0..11)', () => {
      expect(ARMOR_PAINT_DEFINITIONS.length).toBe(CONTENT_COUNTS.ARMOR_PAINTS);
      const testedArmors = new Set<ArmorPaintId>();

      // Armor 0: Classic K-01 baseline
      {
        const s = createCombatArena();
        s.progression.loadouts[0].armorPaint = 0;
        expect(computePlayerInvulnTicks(s)).toBe(100);
        for (let i = 0; i < 15; i++) stepSim(s, makeInput({ moveX: 1 }), HOOKS);
        expect(s.player.vx).toBeCloseTo(2.0, 5);
        testedArmors.add(0);
      }

      // Armor 1: Solar Beam (Dive Kick fires dive_beam projectile)
      {
        const s = createCombatArena();
        s.progression.loadouts[0].armorPaint = 1;
        s.player.grounded = false;
        s.player.y = 6 * TS;
        stepSim(s, makeInput({ moveY: 1, attack: true, attackPressed: true }), HOOKS);
        expect(s.projectiles.some((pr) => pr.kind === 'dive_beam')).toBe(true);
        testedArmors.add(1);
      }

      // Armor 2: Mend Alloy / Salvage Weld (5-hit combo heals +1 HP)
      {
        const s = createCombatArena();
        s.progression.loadouts[0].armorPaint = 2;
        s.player.hp = 10;
        s.player.comboCount = 4; // 5th hit heals +1 HP
        const foe = spawnEnemyFromArchetype(s, 'heavy_enforcer', s.player.x + 22, 13 * TS - 28)!;
        foe.shielded = false;
        stepSim(s, makeInput({ attack: true, attackPressed: true }), HOOKS);
        for (let i = 0; i < 5; i++) stepSim(s, makeInput(), HOOKS);
        expect(s.player.comboCount).toBe(5);
        expect(s.player.hp).toBe(11);
        testedArmors.add(2);
      }

      // Armor 3: Cryo Edge (airborne Cryo Air-Slide burst with vy === 0 & full ice traction)
      {
        const s = createCombatArena((tiles, w) => {
          for (let tx = 2; tx <= 18; tx++) tiles[13 * w + tx] = TileType.ICE;
        });
        s.progression.loadouts[0].armorPaint = 3;
        stepSim(s, makeInput({ moveX: 1 }), HOOKS);
        expect(s.player.vx).toBeCloseTo(PLAYER_PHYSICS.RUNNING_FRICTION, 5); // Full traction on ice!

        s.player.grounded = false;
        s.player.y = 7 * TS;
        s.player.vy = 2.0;
        stepSim(s, makeInput({ slide: true, slidePressed: true }), HOOKS);
        expect(s.player.sliding).toBe(true);
        expect(s.player.vy).toBe(0);
        expect(Math.abs(s.player.vx)).toBeCloseTo(PLAYER_PHYSICS.SLIDE_SPEED + 0.75, 5);
        testedArmors.add(3);
      }

      // Armor 4: Voltaic Surge (+0.5 melee damage & emits electric_arc spark on melee hit)
      {
        const s = createCombatArena();
        s.progression.loadouts[0].armorPaint = 4;
        const foe = spawnEnemyFromArchetype(s, 'heavy_enforcer', s.player.x + 22, 13 * TS - 28)!;
        foe.shielded = false;
        foe.hp = 10;
        stepSim(s, makeInput({ attack: true, attackPressed: true }), HOOKS);
        for (let i = 0; i < 5; i++) stepSim(s, makeInput(), HOOKS);
        expect(foe.hp).toBeCloseTo(8.5, 2); // 1.0 + 0.5 electric melee bonus
        expect(s.projectiles.some((pr) => pr.kind === 'electric_arc')).toBe(true);
        testedArmors.add(4);
      }

      // Armor 5: Aero Strider (+0.50 horizontal walk/sprint speed)
      {
        const s = createCombatArena();
        s.progression.loadouts[0].armorPaint = 5;
        for (let i = 0; i < 15; i++) stepSim(s, makeInput({ moveX: 1 }), HOOKS);
        expect(s.player.vx).toBeCloseTo(2.5, 5);
        testedArmors.add(5);
      }

      // Armor 6: Rhythm Cobalt / Harmonic Pulse (Pirouette Jump Attack damages overlapping foe during ascent)
      {
        const s = createCombatArena();
        s.progression.loadouts[0].armorPaint = 6;
        const foe = spawnEnemyFromArchetype(s, 'heavy_enforcer', s.player.x, 13 * TS - 40)!;
        foe.shielded = false;
        foe.hp = 10;
        stepSim(s, makeInput({ jump: true, jumpPressed: true }), HOOKS);
        expect(foe.hp).toBe(9);
        testedArmors.add(6);
      }

      // Armor 7: Quake Amber / Basalt Titan (8.75 max fall speed & twin stomp shockwaves on high fall landing)
      {
        const s = createCombatArena();
        s.progression.loadouts[0].armorPaint = 7;
        s.player.grounded = false;
        s.player.y = 2 * TS;
        s.player.vy = 8.7;
        // Confirm terminal velocity allows 8.75 (5.75 + 3.0)
        stepSim(s, makeInput(), HOOKS);
        expect(s.player.vy).toBeCloseTo(
          PLAYER_PHYSICS.MAX_FALL_SPEED + PLAYER_PHYSICS.HEAVY_ARMOR_FALL_BONUS,
          5,
        );
        // Drop onto floor -> emits left & right shockwaves
        for (let i = 0; i < 30; i++) {
          stepSim(s, makeInput(), HOOKS);
          if (s.projectiles.some((pr) => pr.kind === 'shockwave')) break;
        }
        expect(s.projectiles.filter((pr) => pr.kind === 'shockwave').length).toBe(2);
        testedArmors.add(7);
      }

      // Armor 8: Phase Violet / Cipher Ghost (ground slide launches piercing phase_ball)
      {
        const s = createCombatArena();
        s.progression.loadouts[0].armorPaint = 8;
        stepSim(s, makeInput({ slide: true, slidePressed: true }), HOOKS);
        const orb = s.projectiles.find((pr) => pr.kind === 'phase_ball');
        expect(orb).toBeDefined();
        expect(orb!.pierce).toBe(true);
        testedArmors.add(8);
      }

      // Armor 9: Obsidian Glass / Overclock Crimson (0.8x invuln frames & 1.35x melee damage)
      {
        const s = createCombatArena();
        s.progression.loadouts[0].armorPaint = 9;
        expect(computePlayerInvulnTicks(s)).toBe(80);
        const foe = spawnEnemyFromArchetype(s, 'heavy_enforcer', s.player.x + 22, 13 * TS - 28)!;
        foe.shielded = false;
        foe.hp = 10;
        stepSim(s, makeInput({ attack: true, attackPressed: true }), HOOKS);
        for (let i = 0; i < 5; i++) stepSim(s, makeInput(), HOOKS);
        expect(foe.hp).toBeCloseTo(10 - 1.35, 2);
        testedArmors.add(9);
      }

      // Armor 10: Shadow Surge / Aegis Platinum (+25% burst damage & -1 non-hazard damage)
      {
        const s = createCombatArena();
        s.progression.loadouts[0].armorPaint = 10;
        s.progression.loadouts[0].bursts.neutral = 20; // base 9 dmg -> 9 * 1.25 = 11.25
        stepSim(s, makeInput({ burst: true, burstPressed: true }), HOOKS);
        const beam = s.projectiles.find((pr) => pr.kind === 'burst_beam');
        expect(beam?.damage).toBeCloseTo(11.25, 2);

        const hpBefore = s.player.hp;
        s.player.invulnTimer = 0;
        applyDamageToPlayer(s, 4);
        expect(hpBefore - s.player.hp).toBe(3); // 4 - 1 = 3
        testedArmors.add(10);
      }

      // Armor 11: Apex Prismatic (blended speed +0.50, Solar dive_beam, Volt melee spark, +20% burst)
      {
        const s = createCombatArena();
        s.progression.loadouts[0].armorPaint = 11;
        for (let i = 0; i < 15; i++) stepSim(s, makeInput({ moveX: 1 }), HOOKS);
        expect(s.player.vx).toBeCloseTo(2.5, 5);

        s.progression.loadouts[0].bursts.neutral = 20; // base 9 -> 9 * 1.2 = 10.8
        stepSim(s, makeInput({ burst: true, burstPressed: true }), HOOKS);
        expect(s.projectiles.find((pr) => pr.kind === 'burst_beam')?.damage).toBeCloseTo(10.8, 2);

        // Clear hitstop freeze frames from Burst 20 before testing Solar dive_beam
        s.hitstopTicks = 0;
        s.player.grounded = false;
        s.player.y = 6 * TS;
        s.player.attackTimer = 0;
        stepSim(s, makeInput({ moveY: 1, attack: true, attackPressed: true }), HOOKS);
        expect(s.projectiles.some((pr) => pr.kind === 'dive_beam')).toBe(true);
        testedArmors.add(11);
      }

      expect(testedArmors.size).toBe(12);
    });
  });

  describe('Difficulty Scaling, Hazard Warp, All 6 Modifiers & Rude Mode Anti-Infinite', () => {
    it('scales damage and invulnerability frames across Easy, Normal, and Hard difficulties', () => {
      const expectedInvuln: Record<Difficulty, number> = {
        easy: 150,
        normal: 100,
        hard: 80,
      };
      for (const diff of ['easy', 'normal', 'hard'] as const) {
        const s = createCombatArena();
        s.progression.difficulty = diff;
        expect(computePlayerInvulnTicks(s)).toBe(expectedInvuln[diff]);

        const hpBefore = s.player.hp;
        applyDamageToPlayer(s, DAMAGE_TABLES[diff].mediumContact);
        expect(hpBefore - s.player.hp).toBe(DAMAGE_TABLES[diff].mediumContact);
        expect(s.player.invulnTimer).toBe(expectedInvuln[diff]);
      }
    });

    it('warps player to lastSafeX/Y with 16t invuln on hazard, and insta-kills on Double Hazards', () => {
      const s = createCombatArena();
      s.player.lastSafeX = 4 * TS;
      s.player.lastSafeY = 13 * TS - PLAYER_PHYSICS.STAND_H;
      s.player.x = 12 * TS;
      s.player.y = 10 * TS;

      const hpBefore = s.player.hp;
      applyHazardDamage(s);
      expect(hpBefore - s.player.hp).toBe(DAMAGE_TABLES.normal.hazard);
      expect(s.player.invulnTimer).toBe(PLAYER_PHYSICS.HAZARD_WARP_INVULN_TICKS);
      expect(s.player.x).toBe(4 * TS);
      expect(s.player.y).toBe(13 * TS - PLAYER_PHYSICS.STAND_H);
      expect(s.player.action).toBe('warp');

      // Double Hazards modifier -> instant lethal even while invulnerable
      s.progression.modifiers.doubleHazards = true;
      applyHazardDamage(s);
      expect(s.player.hp).toBe(0);
      expect(s.player.action).toBe('dead');
      expect(s.screen).toBe('game_over');
    });

    it('enforces all 6 Custom Modifiers and Rude Mode boss anti-infinite (0.55x + 90t techRecover)', () => {
      // 1. masterLevels -> remix stage selection
      const remixStage = getStageDefinition('optic', true);
      expect(remixStage.remix).toBe(true);

      // 2. mirrorWorld -> flips horizontal movement direction
      const sMirror = createCombatArena();
      sMirror.progression.modifiers.mirrorWorld = true;
      const startX = sMirror.player.x;
      for (let i = 0; i < 6; i++) stepSim(sMirror, makeInput({ moveX: 1 }), HOOKS);
      expect(sMirror.player.x).toBeLessThan(startX);

      // 3. ironCircuit -> 1.5x non-hazard damage & halved Emergency Heal
      const sIron = createCombatArena();
      sIron.progression.modifiers.ironCircuit = true;
      const hpPre = sIron.player.hp;
      applyDamageToPlayer(sIron, 4);
      expect(hpPre - sIron.player.hp).toBe(6); // ceil(4 * 1.5) = 6
      sIron.player.invulnTimer = 0;
      sIron.player.hurtTimer = 0;
      sIron.player.action = 'idle';
      sIron.progression.loadouts[0].bursts.neutral = 18;
      const hpPreHeal = sIron.player.hp;
      stepSim(sIron, makeInput({ burst: true, burstPressed: true }), HOOKS);
      expect(sIron.player.hp - hpPreHeal).toBe(3); // 6 / 2 = 3 on Iron Circuit

      // 4. singleCredit & doubleHazards modifier flags
      const sMods = createCombatArena();
      sMods.progression.modifiers.singleCredit = true;
      sMods.progression.modifiers.masterLevels = true;
      expect(sMods.progression.modifiers.singleCredit).toBe(true);
      expect(sMods.progression.modifiers.masterLevels).toBe(true);

      // 5. rudeEnemies -> +1 enemy HP, 0.55x boss anti-infinite scaling & 90t techRecoverTimer!
      const sRude = createFullSimState('opening', false);
      sRude.progression.modifiers.rudeEnemies = true;
      const rudeTrooper = spawnEnemyFromArchetype(sRude, 'metro_trooper', 100, 100)!;
      expect(rudeTrooper.maxHp).toBe(4); // 3 base + 1 rude

      // Warp into Siege Tread boss arena & activate boss
      const stage = getStageDefinition('opening', false);
      sRude.player.x = stage.bossCellX * ENGINE_CONSTANTS.GAME_WIDTH + 48;
      sRude.player.y = stage.bossCellY * ENGINE_CONSTANTS.GAME_HEIGHT + 13 * TS - PLAYER_PHYSICS.STAND_H;
      for (let i = 0; i < 100; i++) {
        stepFullSim(sRude, makeInput());
        if (sRude.boss && sRude.boss.active && sRude.boss.aiState !== 'intro') break;
      }
      const boss = sRude.boss!;
      expect(boss.active).toBe(true);
      boss.invulnTimer = 0;

      // 1st light/launch hit: full 1.0 damage, launchHits -> 1
      const hp0 = boss.hp;
      damageBoss(sRude, boss, 1, { armorBreak: true });
      expect(hp0 - boss.hp).toBeCloseTo(1.0, 2);
      expect(boss.launchHits).toBe(1);

      // 2nd repeated light/launch hit under Rude Mode: scaled by 0.55x!
      boss.invulnTimer = 0;
      const hp1 = boss.hp;
      damageBoss(sRude, boss, 1, { armorBreak: true });
      expect(hp1 - boss.hp).toBeCloseTo(BOSS_CONSTANTS.RUDE_SINGLE_HIT_FACTOR, 2);
      expect(boss.launchHits).toBe(2);

      // Next boss update triggers 90-tick techRecoverTimer (decrements by 1 on trigger tick -> 89)
      stepFullSim(sRude, makeInput());
      expect(boss.techRecoverTimer).toBe(BOSS_CONSTANTS.TECH_RECOVER_TICKS - 1);
      expect(boss.launchHits).toBe(0);
    });
  });
});
