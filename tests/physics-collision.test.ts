import { describe, expect, it } from 'vitest';
import {
  ATTACK_DATA,
  ENGINE_CONSTANTS,
  HOOKSHOT_CONSTANTS,
  PLAYER_PHYSICS,
  TileType,
  createNeutralInput,
  type InputFrame,
  type SimState,
  type StageDefinition,
} from '../src/contracts/index';
import {
  canStandUpAt,
  detectLedgeGrab,
  sweptHookshotStep,
} from '../src/sim/collision';
import { getAttackHitbox } from '../src/sim/combat';
import { createInitialProgression } from '../src/sim/progression';
import { createFullSimHooks } from '../src/sim/runtime';
import { createSimState, loadStageIntoState, stepSim } from '../src/sim/step';

const TS = ENGINE_CONSTANTS.TILE_SIZE;
const CELL_W = ENGINE_CONSTANTS.CELL_TILES_W;
const CELL_H = ENGINE_CONSTANTS.CELL_TILES_H;
const HOOKS = createFullSimHooks();

function makeInput(overrides: Partial<InputFrame> = {}): InputFrame {
  return { ...createNeutralInput('keyboard'), ...overrides };
}

function makeSandboxStage(
  cellsW = 2,
  cellsH = 2,
  mutate?: (tiles: number[], tilesW: number, tilesH: number) => void,
  spawnTileX = 4,
  spawnFloorRow = 13,
): StageDefinition {
  const tilesW = cellsW * CELL_W;
  const tilesH = cellsH * CELL_H;
  const tiles = new Array<number>(tilesW * tilesH).fill(TileType.EMPTY);

  const set = (tx: number, ty: number, t: TileType): void => {
    if (tx >= 0 && tx < tilesW && ty >= 0 && ty < tilesH) {
      tiles[ty * tilesW + tx] = t;
    }
  };

  // Perimeter walls + ceiling + primary floor at row 13..14 (cellY = 0) & bottom floor
  for (let tx = 0; tx < tilesW; tx++) {
    set(tx, 0, TileType.SOLID);
    set(tx, 13, TileType.SOLID);
    set(tx, 14, TileType.SOLID);
    set(tx, tilesH - 1, TileType.SOLID);
  }
  for (let ty = 0; ty < tilesH; ty++) {
    set(0, ty, TileType.SOLID);
    set(tilesW - 1, ty, TileType.SOLID);
  }

  mutate?.(tiles, tilesW, tilesH);

  return {
    id: 'tutorial',
    name: 'Physics Sandbox',
    subtitle: 'Test Chamber',
    remix: false,
    biomeGimmick: 'tutorial_course',
    bgmKey: 'bgm_tutorial',
    bossBgmKey: 'bgm_boss_master',
    cellsW,
    cellsH,
    tilesW,
    tilesH,
    tiles,
    spawnX: spawnTileX * TS,
    spawnY: spawnFloorRow * TS - PLAYER_PHYSICS.STAND_H,
    bossCellX: cellsW - 1,
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
}

function createSandboxState(
  mutate?: (tiles: number[], tilesW: number, tilesH: number) => void,
  opts?: { cellsW?: number; cellsH?: number; spawnTileX?: number; spawnFloorRow?: number },
): SimState {
  const stage = makeSandboxStage(
    opts?.cellsW ?? 2,
    opts?.cellsH ?? 1,
    mutate,
    opts?.spawnTileX ?? 4,
    opts?.spawnFloorRow ?? 13,
  );
  const prog = createInitialProgression();
  prog.loadouts[0].chips = [0, 0, 0];
  prog.loadouts[0].armorPaint = 0;
  const state = createSimState(stage, prog, 0x4b52554e);
  loadStageIntoState(state, stage, HOOKS);
  // Settle player cleanly onto ground
  stepSim(state, makeInput(), HOOKS);
  return state;
}

describe('Physics & Collision Engine', () => {
  describe('Swept Hookshot Anti-Tunneling (30.0 px/tick, <= 4.0 px substeps)', () => {
    it('substeps every segment at <= 4.0 px and NEVER tunnels through a 16 px solid wall', () => {
      // Single 1-tile (16 px) solid vertical pillar at tx = 8, rows 5..12
      const state = createSandboxState((tiles, w) => {
        for (let ty = 5; ty <= 12; ty++) {
          tiles[ty * w + 8] = TileType.SOLID;
        }
      });

      const substeps: { x: number; y: number }[] = [];
      const startX = 7 * TS + 2; // 114 px (14 px before wall at x=128..144)
      const endX = startX + HOOKSHOT_CONSTANTS.MAX_SPEED; // 144 px (spans full 16 px wall in 1 tick!)
      const y = 11 * TS + 8;

      const hit = sweptHookshotStep(state, startX, y, endX, y, {
        onSubstep: (x, sy) => substeps.push({ x, y: sy }),
      });

      expect(hit.kind).toBe('solid');
      expect(hit.tileX).toBe(8);
      expect(hit.x).toBeLessThanOrEqual(8 * TS + HOOKSHOT_CONSTANTS.SUBSTEP_MAX_PX);
      expect(substeps.length).toBeGreaterThanOrEqual(1);

      // Verify every single substep delta is <= SUBSTEP_MAX_PX (4.0 px)
      let prevX = startX;
      let prevY = y;
      for (const pt of substeps) {
        expect(Math.hypot(pt.x - prevX, pt.y - prevY)).toBeLessThanOrEqual(
          HOOKSHOT_CONSTANTS.SUBSTEP_MAX_PX + 1e-6,
        );
        prevX = pt.x;
        prevY = pt.y;
      }

      // Also test full sim firing hookshot directly into the 16 px solid wall
      state.player.x = 7 * TS - 2;
      state.player.facing = 1;
      stepSim(state, makeInput({ hookshot: true, hookshotPressed: true, aimX: 1 }), HOOKS);
      expect(state.player.hook.phase).toBe('extending');
      expect(state.player.hook.vx).toBeCloseTo(HOOKSHOT_CONSTANTS.MAX_SPEED, 5);

      stepSim(state, makeInput({ hookshot: true }), HOOKS);
      expect(state.player.hook.phase).toBe('latched_wall');
      expect(state.player.hook.latchedTileX).toBe(8);
      expect(state.player.hook.tipX).toBeLessThan(9 * TS);
    });

    it('NEVER tunnels through a single 16 px breakable tile and shatters it cleanly', () => {
      // Single 1-tile breakable column at tx = 8
      const state = createSandboxState((tiles, w) => {
        for (let ty = 8; ty <= 12; ty++) {
          tiles[ty * w + 8] = TileType.BREAKABLE;
        }
      });

      // Place player right in front so 30 px/tick spans past the entire 16 px tile
      state.player.x = 7 * TS;
      state.player.facing = 1;
      stepSim(state, makeInput({ hookshot: true, hookshotPressed: true, aimX: 1 }), HOOKS);
      expect(state.player.hook.phase).toBe('extending');

      stepSim(state, makeInput({ hookshot: true }), HOOKS);
      expect(state.player.hook.phase).toBe('retracting');
      expect(state.player.hook.tipX).toBeLessThan(9 * TS);

      // The hit breakable tile at column 8 was shattered to EMPTY
      const hitRow = Math.floor(state.player.hook.tipY / TS);
      expect(state.tiles[hitRow * state.tilesW + 8]).toBe(TileType.EMPTY);
    });
  });

  describe('14x14 Slide Tunnel Ceiling-Wedge Safety', () => {
    it('keeps player safely crouched inside a 16 px slide tunnel until full 14x28 clearance exists', () => {
      // Tunnel roof at row 11 across cols 7..13, leaving row 12 (16 px) clear above floor row 13
      const state = createSandboxState((tiles, w) => {
        for (let tx = 7; tx <= 13; tx++) {
          tiles[11 * w + tx] = TileType.SOLID;
        }
      });

      state.player.x = 5 * TS;
      state.player.facing = 1;
      expect(state.player.w).toBe(PLAYER_PHYSICS.STAND_W);
      expect(state.player.h).toBe(PLAYER_PHYSICS.STAND_H);

      // Initiate ground slide right into tunnel
      stepSim(state, makeInput({ slide: true, slidePressed: true }), HOOKS);
      expect(state.player.sliding).toBe(true);
      expect(state.player.w).toBe(PLAYER_PHYSICS.SLIDE_W);
      expect(state.player.h).toBe(PLAYER_PHYSICS.SLIDE_H);

      // Advance through full slide duration (22 ticks) so player stops squarely under the ceiling
      for (let i = 0; i < 26; i++) {
        stepSim(state, makeInput(), HOOKS);
      }

      // Verify player is inside tunnel cols 7..13, slide ended, STILL crouched (14x14), zero ceiling overlap
      expect(state.player.x).toBeGreaterThanOrEqual(7 * TS);
      expect(state.player.x + state.player.w).toBeLessThanOrEqual(14 * TS);
      expect(state.player.sliding).toBe(false);
      expect(state.player.crouching).toBe(true);
      expect(state.player.h).toBe(PLAYER_PHYSICS.SLIDE_H);
      expect(state.player.y).toBe(13 * TS - PLAYER_PHYSICS.SLIDE_H);
      expect(canStandUpAt(state, state.player.x, state.player.y + state.player.h - PLAYER_PHYSICS.STAND_H)).toBe(false);

      // Attempting to jump while wedged under the ceiling MUST NOT stand up or clip into ceiling
      stepSim(state, makeInput({ jump: true, jumpPressed: true }), HOOKS);
      expect(state.player.crouching).toBe(true);
      expect(state.player.h).toBe(PLAYER_PHYSICS.SLIDE_H);
      expect(state.player.y).toBeGreaterThanOrEqual(12 * TS);

      // Crouch-walk cleanly out the right exit of the tunnel
      for (let i = 0; i < 90; i++) {
        stepSim(state, makeInput({ moveX: 1 }), HOOKS);
        if (!state.player.crouching) break;
      }

      expect(state.player.x).toBeGreaterThanOrEqual(14 * TS);
      expect(state.player.crouching).toBe(false);
      expect(state.player.w).toBe(PLAYER_PHYSICS.STAND_W);
      expect(state.player.h).toBe(PLAYER_PHYSICS.STAND_H);
      expect(state.player.y).toBe(13 * TS - PLAYER_PHYSICS.STAND_H);
    });
  });

  describe('Horizontal Locomotion, Function Overload, Speed Armor & Ice Friction', () => {
    it('reaches exact Walk (2.0), Sprint (4.0), Overload (3.0/5.0), and Speed Armor (+0.50) caps', () => {
      const state = createSandboxState();

      // Walk speed = 2.0
      for (let i = 0; i < 15; i++) stepSim(state, makeInput({ moveX: 1 }), HOOKS);
      expect(state.player.vx).toBeCloseTo(PLAYER_PHYSICS.WALK_MAX_SPEED, 5);

      // Sprint speed = 4.0
      for (let i = 0; i < 15; i++) stepSim(state, makeInput({ moveX: 1, sprint: true }), HOOKS);
      expect(state.player.vx).toBeCloseTo(PLAYER_PHYSICS.SPRINT_MAX_SPEED, 5);

      // Function Overload: Walk = 3.0, Sprint = 5.0
      state.player.overloadTimer = PLAYER_PHYSICS.OVERLOAD_DURATION_TICKS;
      state.player.vx = 0;
      for (let i = 0; i < 15; i++) stepSim(state, makeInput({ moveX: 1 }), HOOKS);
      expect(state.player.vx).toBeCloseTo(PLAYER_PHYSICS.OVERLOAD_WALK_SPEED, 5);

      for (let i = 0; i < 15; i++) stepSim(state, makeInput({ moveX: 1, sprint: true }), HOOKS);
      expect(state.player.vx).toBeCloseTo(PLAYER_PHYSICS.OVERLOAD_SPRINT_SPEED, 5);

      // Speed Armor (Aero Strider ID 5): +0.50 bonus
      state.player.overloadTimer = 0;
      state.progression.loadouts[0].armorPaint = 5;
      state.player.x = 4 * TS;
      state.player.vx = 0;
      for (let i = 0; i < 15; i++) stepSim(state, makeInput({ moveX: 1 }), HOOKS);
      expect(state.player.vx).toBeCloseTo(
        PLAYER_PHYSICS.WALK_MAX_SPEED + PLAYER_PHYSICS.SPEED_ARMOR_BONUS,
        5,
      );

      for (let i = 0; i < 15; i++) stepSim(state, makeInput({ moveX: 1, sprint: true }), HOOKS);
      expect(state.player.vx).toBeCloseTo(
        PLAYER_PHYSICS.SPRINT_MAX_SPEED + PLAYER_PHYSICS.SPEED_ARMOR_BONUS,
        5,
      );
    });

    it('applies exact ICE_FRICTION (0.08) on ice tiles vs normal friction (0.50)', () => {
      const iceState = createSandboxState((tiles, w) => {
        for (let tx = 2; tx <= 20; tx++) {
          tiles[13 * w + tx] = TileType.ICE;
        }
      });
      const normalState = createSandboxState();

      expect(iceState.player.onIce).toBe(true);
      expect(normalState.player.onIce).toBe(false);

      stepSim(iceState, makeInput({ moveX: 1 }), HOOKS);
      stepSim(normalState, makeInput({ moveX: 1 }), HOOKS);

      expect(iceState.player.vx).toBeCloseTo(PLAYER_PHYSICS.ICE_FRICTION, 5);
      expect(normalState.player.vx).toBeCloseTo(PLAYER_PHYSICS.RUNNING_FRICTION, 5);

      // Coasting deceleration on ice also uses 0.08
      iceState.player.vx = 2.0;
      stepSim(iceState, makeInput(), HOOKS);
      expect(iceState.player.vx).toBeCloseTo(2.0 - PLAYER_PHYSICS.ICE_FRICTION, 5);
    });
  });

  describe('Jump, Coyote Time, Jump Buffer, Air Jumper & One-Way Platform Drop', () => {
    it('executes Jump (-5.25 impulse + 0.25 grav = -5.0 post-tick) and variable jump damping', () => {
      const state = createSandboxState();
      stepSim(state, makeInput({ jump: true, jumpPressed: true }), HOOKS);
      expect(state.player.grounded).toBe(false);
      expect(state.player.vy).toBeCloseTo(PLAYER_PHYSICS.JUMP_IMPULSE + PLAYER_PHYSICS.GRAVITY, 5);

      // Early jump release damps upward velocity by 0.5 before gravity
      const prevVy = state.player.vy;
      stepSim(state, makeInput({ jump: false, jumpReleased: true }), HOOKS);
      expect(state.player.vy).toBeCloseTo(prevVy * PLAYER_PHYSICS.JUMP_RELEASE_DAMP + PLAYER_PHYSICS.GRAVITY, 5);
    });

    it('honors 4-tick Coyote time window and rejects jumps after 5+ airborne ticks', () => {
      // Ledge ends after col 6 (cols 7..16 open floor drop)
      const makeLedgeState = (): SimState =>
        createSandboxState((tiles, w) => {
          for (let tx = 7; tx <= 18; tx++) {
            tiles[13 * w + tx] = TileType.EMPTY;
            tiles[14 * w + tx] = TileType.EMPTY;
          }
        }, { cellsW: 2, cellsH: 2 });

      // Test within 4-tick coyote window (stepSim increments tick first, so wait 2 more ticks -> 4t on jump tick)
      const sOk = makeLedgeState();
      sOk.player.x = 7 * TS - 1; // right at edge
      sOk.player.vx = 2.0;
      stepSim(sOk, makeInput({ moveX: 1 }), HOOKS);
      expect(sOk.player.grounded).toBe(false);
      for (let i = 0; i < 2; i++) stepSim(sOk, makeInput({ moveX: 1 }), HOOKS);
      expect(sOk.tick - sOk.player.leftGroundTick).toBe(PLAYER_PHYSICS.COYOTE_TICKS - 1);

      stepSim(sOk, makeInput({ jump: true, jumpPressed: true }), HOOKS);
      expect(sOk.player.vy).toBeLessThan(-4.5);

      // Test past coyote window (5 ticks since leaving ground on jump tick)
      const sLate = makeLedgeState();
      sLate.player.x = 7 * TS - 1;
      sLate.player.vx = 2.0;
      stepSim(sLate, makeInput({ moveX: 1 }), HOOKS);
      for (let i = 0; i < 3; i++) stepSim(sLate, makeInput({ moveX: 1 }), HOOKS);
      expect(sLate.tick - sLate.player.leftGroundTick).toBe(PLAYER_PHYSICS.COYOTE_TICKS);

      stepSim(sLate, makeInput({ jump: true, jumpPressed: true }), HOOKS);
      expect(sLate.player.vy).toBeGreaterThan(0);
    });

    it('honors 5-tick Jump buffer before landing', () => {
      const state = createSandboxState();
      // Position player 10 px above floor falling at 3.0 px/tick (lands in ~3 ticks <= 5t buffer)
      state.player.grounded = false;
      state.player.leftGroundTick = -999;
      state.player.y = 13 * TS - PLAYER_PHYSICS.STAND_H - 10;
      state.player.vy = 3.0;

      // Press jump while still airborne
      stepSim(state, makeInput({ jump: true, jumpPressed: true }), HOOKS);
      expect(state.player.grounded).toBe(false);

      // Keep stepping without pressing jump again; buffered jump must fire automatically on landing
      let jumped = false;
      for (let i = 0; i < 6; i++) {
        stepSim(state, makeInput({ jump: true }), HOOKS);
        if (state.player.vy < -4.0) {
          jumped = true;
          break;
        }
      }
      expect(jumped).toBe(true);
    });

    it('enables Air Jumper double jump (-4.25) with Chip ID 2 and blocks without it', () => {
      const state = createSandboxState();
      // Jump from ground without Air Jumper
      stepSim(state, makeInput({ jump: true, jumpPressed: true }), HOOKS);
      for (let i = 0; i < 8; i++) stepSim(state, makeInput(), HOOKS);
      const vyBefore = state.player.vy;
      stepSim(state, makeInput({ jump: true, jumpPressed: true }), HOOKS);
      expect(state.player.vy).toBeGreaterThan(vyBefore); // no double jump without chip 2

      // Equip Chip ID 2 (Air Jumper)
      state.progression.loadouts[0].chips = [2, 0, 0];
      stepSim(state, makeInput({ jump: true, jumpPressed: true }), HOOKS);
      expect(state.player.airJumpsUsed).toBe(1);
      expect(state.player.vy).toBeCloseTo(
        PLAYER_PHYSICS.DOUBLE_JUMP_IMPULSE + PLAYER_PHYSICS.GRAVITY,
        5,
      );
    });

    it('drops cleanly through a 1-way platform on Down + Jump', () => {
      const state = createSandboxState((tiles, w) => {
        for (let tx = 4; tx <= 10; tx++) {
          tiles[9 * w + tx] = TileType.ONE_WAY;
        }
      });

      // Stand on top of ONE_WAY platform at row 9
      state.player.x = 6 * TS;
      state.player.y = 9 * TS - PLAYER_PHYSICS.STAND_H;
      state.player.vy = 0;
      stepSim(state, makeInput(), HOOKS);
      expect(state.player.grounded).toBe(true);
      expect(state.player.y).toBe(9 * TS - PLAYER_PHYSICS.STAND_H);

      // Press Down + Jump to drop through
      stepSim(state, makeInput({ moveY: 1, jump: true, jumpPressed: true }), HOOKS);
      expect(state.player.grounded).toBe(false);
      for (let i = 0; i < 10; i++) stepSim(state, makeInput(), HOOKS);
      expect(state.player.y + state.player.h).toBeGreaterThan(9 * TS + 16);
      expect(state.player.y).toBeGreaterThan(9 * TS);
    });
  });

  describe('Wall-Slide, Wall-Jump Buffer/Leeway, Ledge Grab/Jab, Support Platform, Scarf & Camera', () => {
    it('caps wall-slide at 2.0 px/tick normally and 0.0 px/tick with Grip Enhancer (Chip ID 4)', () => {
      const state = createSandboxState((tiles, w) => {
        for (let ty = 2; ty <= 12; ty++) {
          tiles[ty * w + 10] = TileType.SOLID;
        }
      });

      // Place airborne falling fast right against left face of col 10 wall
      state.player.x = 10 * TS - PLAYER_PHYSICS.STAND_W;
      state.player.y = 4 * TS;
      state.player.vy = 5.0;
      state.player.grounded = false;

      stepSim(state, makeInput({ moveX: 1 }), HOOKS);
      expect(state.player.onWall).toBe(1);
      expect(state.player.vy).toBeCloseTo(PLAYER_PHYSICS.WALL_SLIDE_MAX_SPEED, 5);

      // Equip Grip Enhancer (Chip ID 4) -> wall-slide halts completely (0.0 px/tick)
      state.progression.loadouts[0].chips = [4, 0, 0];
      state.player.vy = 3.0;
      stepSim(state, makeInput({ moveX: 1 }), HOOKS);
      expect(state.player.onWall).toBe(1);
      expect(state.player.vy).toBeCloseTo(PLAYER_PHYSICS.WALL_SLIDE_GRIP_SPEED, 5);

      // Holding Down overrides Grip Enhancer to slide at 2.0 px/tick
      state.player.vy = 3.0;
      stepSim(state, makeInput({ moveX: 1, moveY: 1 }), HOOKS);
      expect(state.player.vy).toBeCloseTo(PLAYER_PHYSICS.WALL_SLIDE_MAX_SPEED, 5);
    });

    it('supports wall-jump buffer (4t neutral / 8t steer-away) and 4.5 px same-wall leeway', () => {
      const makeWallState = (): SimState =>
        createSandboxState((tiles, w) => {
          for (let ty = 2; ty <= 12; ty++) {
            tiles[ty * w + 12] = TileType.SOLID;
          }
        });

      // 1. 4.5 px leeway wall jump (player 4.0 px away from wall, never touched it yet)
      const sLeeway = makeWallState();
      sLeeway.player.grounded = false;
      sLeeway.player.leftGroundTick = -999;
      sLeeway.player.x = 12 * TS - PLAYER_PHYSICS.STAND_W - 4.0;
      sLeeway.player.y = 5 * TS;
      sLeeway.player.vy = 1.0;

      stepSim(sLeeway, makeInput({ jump: true, jumpPressed: true }), HOOKS);
      expect(sLeeway.player.vy).toBeCloseTo(
        PLAYER_PHYSICS.WALL_JUMP_IMPULSE_Y + PLAYER_PHYSICS.GRAVITY,
        5,
      );
      expect(sLeeway.player.vx).toBeLessThan(-3.0);

      // 2. 4-tick neutral wall-jump buffer
      const sNeutralBuf = makeWallState();
      sNeutralBuf.player.grounded = false;
      sNeutralBuf.player.leftGroundTick = -999;
      sNeutralBuf.player.x = 12 * TS - PLAYER_PHYSICS.STAND_W;
      sNeutralBuf.player.y = 5 * TS;
      sNeutralBuf.player.vy = 1.0;
      stepSim(sNeutralBuf, makeInput({ moveX: 1 }), HOOKS); // touch wall -> sets wallJumpBufferTick
      expect(sNeutralBuf.player.onWall).toBe(1);

      // Move 10 px away from wall (outside 4.5 px leeway) and wait 3 ticks (total 4t from touch)
      sNeutralBuf.player.x -= 10;
      for (let i = 0; i < 3; i++) stepSim(sNeutralBuf, makeInput(), HOOKS);
      expect(sNeutralBuf.tick - sNeutralBuf.player.wallJumpBufferTick).toBe(3);

      stepSim(sNeutralBuf, makeInput({ jump: true, jumpPressed: true }), HOOKS);
      expect(sNeutralBuf.player.vy).toBeCloseTo(
        PLAYER_PHYSICS.WALL_JUMP_IMPULSE_Y + PLAYER_PHYSICS.GRAVITY,
        5,
      );

      // 3. 8-tick steer-away wall-jump buffer (4t base + 4t steer-away bonus)
      const sSteerBuf = makeWallState();
      sSteerBuf.player.grounded = false;
      sSteerBuf.player.leftGroundTick = -999;
      sSteerBuf.player.x = 12 * TS - PLAYER_PHYSICS.STAND_W;
      sSteerBuf.player.y = 4 * TS;
      sSteerBuf.player.vy = 1.0;
      stepSim(sSteerBuf, makeInput({ moveX: 1 }), HOOKS);
      expect(sSteerBuf.player.wallJumpDir).toBe(-1);

      // Move away from wall, wait 6 ticks (past 4t neutral window, inside 8t steer-away window!)
      sSteerBuf.player.x -= 12;
      for (let i = 0; i < 6; i++) stepSim(sSteerBuf, makeInput({ moveX: -1 }), HOOKS);
      expect(sSteerBuf.tick - sSteerBuf.player.wallJumpBufferTick).toBe(6);

      stepSim(sSteerBuf, makeInput({ moveX: -1, jump: true, jumpPressed: true }), HOOKS);
      expect(sSteerBuf.player.vy).toBeCloseTo(
        PLAYER_PHYSICS.WALL_JUMP_IMPULSE_Y + PLAYER_PHYSICS.GRAVITY,
        5,
      );
      expect(sSteerBuf.player.vx).toBeLessThan(-3.0);
    });

    it('detects outer-corner ledge grab and executes 51x37 ledgeJab cleanly', () => {
      // Raised platform block at cols 10..13, rows 8..12 (row 7 open above ledge!)
      const state = createSandboxState((tiles, w) => {
        for (let ty = 8; ty <= 12; ty++) {
          for (let tx = 10; tx <= 13; tx++) {
            tiles[ty * w + tx] = TileType.SOLID;
          }
        }
      });

      // Position airborne facing right just below ledge top (row 8 = 128 px)
      state.player.grounded = false;
      state.player.facing = 1;
      state.player.x = 10 * TS - PLAYER_PHYSICS.STAND_W - 1;
      state.player.y = 8 * TS + 1;
      state.player.vy = 0.5;

      const probe = detectLedgeGrab(state, state.player);
      expect(probe).not.toBeNull();
      expect(probe?.side).toBe(1);

      stepSim(state, makeInput(), HOOKS);
      expect(state.player.onLedge).toBe(1);
      expect(state.player.action).toBe('ledge_hang');

      // Attack while ledge hanging -> selects 51x37 ledgeJab!
      stepSim(state, makeInput({ attack: true, attackPressed: true }), HOOKS);
      expect(state.player.attackId).toBe('ledgeJab');
      const box = getAttackHitbox(state, ATTACK_DATA.ledgeJab);
      expect(box.w).toBe(51);
      expect(box.h).toBe(37);

      // Press Up to climb cleanly onto the ledge
      stepSim(state, makeInput({ moveY: -1 }), HOOKS);
      expect(state.player.onLedge).toBe(0);
      expect(state.player.y).toBeLessThan(8 * TS);
    });

    it('renders Burst 15 Support Platform walkable and drop-through via Down+Jump', () => {
      const state = createSandboxState();
      state.progression.unlockedBursts.push(15);
      state.progression.loadouts[0].bursts.neutral = 15;
      state.player.burstEnergy = 200;

      // Jump mid-air and summon Support Platform beneath Volt
      state.player.grounded = false;
      state.player.y = 7 * TS;
      state.player.vy = 1.0;

      stepSim(state, makeInput({ burst: true, burstPressed: true }), HOOKS);
      const plat = state.projectiles.find((pr) => pr.kind === 'support_platform');
      expect(plat).toBeDefined();
      expect(plat?.solid).toBe(true);

      // Step a couple ticks so Volt lands squarely on the support platform
      for (let i = 0; i < 4; i++) stepSim(state, makeInput(), HOOKS);
      expect(state.player.grounded).toBe(true);
      expect(state.player.y + state.player.h).toBeCloseTo(plat!.y, 1);

      // Down + Jump drops right through the support platform
      const beforeY = state.player.y;
      stepSim(state, makeInput({ moveY: 1, jump: true, jumpPressed: true }), HOOKS);
      for (let i = 0; i < 6; i++) stepSim(state, makeInput(), HOOKS);
      expect(state.player.y).toBeGreaterThan(beforeY + 8);
    });

    it('updates the 7-node cyber-scarf smoothly with exact segment constraints', () => {
      const state = createSandboxState();
      expect(state.player.scarf.length).toBe(PLAYER_PHYSICS.SCARF_NODE_COUNT);

      for (let i = 0; i < 25; i++) {
        stepSim(state, makeInput({ moveX: 1, sprint: true }), HOOKS);
      }

      expect(state.player.scarf.length).toBe(7);
      for (let i = 0; i < state.player.scarf.length; i++) {
        expect(Number.isFinite(state.player.scarf[i].x)).toBe(true);
        expect(Number.isFinite(state.player.scarf[i].y)).toBe(true);
        if (i > 0) {
          const dist = Math.hypot(
            state.player.scarf[i].x - state.player.scarf[i - 1].x,
            state.player.scarf[i].y - state.player.scarf[i - 1].y,
          );
          expect(dist).toBeCloseTo(PLAYER_PHYSICS.SCARF_SEGMENT_LEN, 2);
        }
      }
      // Scarf tail trails behind Volt when sprinting right
      expect(state.player.scarf[6].x).toBeLessThan(state.player.scarf[0].x);
    });

    it('handles cell-bounded camera transitions, CAMERA_BLOCKER stops, and CAMERA_JUMP_MARGIN', () => {
      // 2x2 cell arena with CAMERA_BLOCKER on cell border x = 25 in top row, open passage below
      const state = createSandboxState(
        (tiles, w) => {
          // Clear middle floor so player can exist in cellY=1 too
          for (let tx = 1; tx < w - 1; tx++) {
            tiles[13 * w + tx] = TileType.EMPTY;
            tiles[14 * w + tx] = TileType.EMPTY;
            tiles[28 * w + tx] = TileType.SOLID;
          }
          // Floor for cellY=0 left/right
          for (let tx = 1; tx < w - 1; tx++) {
            tiles[13 * w + tx] = TileType.SOLID;
          }
        },
        { cellsW: 2, cellsH: 2, spawnTileX: 20, spawnFloorRow: 13 },
      );

      expect(state.camera.cellX).toBe(0);
      expect(state.camera.transitionTimer).toBe(0);

      // Walk player across x = 400 into cellX = 1
      state.player.x = ENGINE_CONSTANTS.GAME_WIDTH + 20;
      stepSim(state, makeInput(), HOOKS);
      expect(state.camera.cellX).toBe(1);
      // Transition timer was set to DELAY_CAMERA_TRANSITION (5) then decremented once on the same tick -> 4
      expect(state.camera.transitionTimer).toBe(ENGINE_CONSTANTS.DELAY_CAMERA_TRANSITION - 1);

      for (let i = 0; i < 40; i++) stepSim(state, makeInput(), HOOKS);
      expect(state.camera.x).toBeCloseTo(state.camera.targetX, 0);

      // Verify CAMERA_JUMP_MARGIN (15 px): jumping slightly above cellY=1 ceiling does not prematurely flip to cellY=0
      const vertState = createSandboxState(
        (tiles, w) => {
          for (let tx = 1; tx < w - 1; tx++) {
            tiles[13 * w + tx] = TileType.EMPTY;
            tiles[14 * w + tx] = TileType.EMPTY;
            tiles[28 * w + tx] = TileType.SOLID;
          }
        },
        { cellsW: 1, cellsH: 2, spawnTileX: 10, spawnFloorRow: 28 },
      );
      expect(vertState.camera.cellY).toBe(1);
      // Place airborne player with center barely inside cell 0 (y = 240 - 18 = 222 => center 236 < 240, bottom 250 > 240 - 15)
      vertState.player.grounded = false;
      vertState.player.y = ENGINE_CONSTANTS.GAME_HEIGHT - 18;
      vertState.player.vy = -1.0;
      stepSim(vertState, makeInput(), HOOKS);
      expect(vertState.camera.cellY).toBe(1);
    });
  });
});
