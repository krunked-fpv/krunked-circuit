import {
  BOSS_CONSTANTS,
  DAMAGE_TABLES,
  ECONOMY_CONSTANTS,
  ENGINE_CONSTANTS,
  TileType,
  type EnemyArchetype,
  type EnemyEntity,
  type MinibossId,
  type PickupEntity,
  type ProjectileEntity,
  type SimState,
} from '../contracts/index';
import { getEnemyArchetype } from '../data/index';
import { nextRng } from './prng';

export interface EnemySimCallbacks {
  damagePlayer: (state: SimState, damage: number, sourceX: number) => void;
  spawnProjectile: (
    state: SimState,
    spec: Omit<ProjectileEntity, 'id' | 'hitIds'>,
  ) => void;
  spawnPickup: (
    state: SimState,
    spec: Omit<PickupEntity, 'id' | 'collected'>,
  ) => void;
}

const TILE = ENGINE_CONSTANTS.TILE_SIZE;
const GRAVITY = 0.25;
const MAX_FALL = 5.5;
const ACTIVE_RANGE_PX = 480;
const MINIBOSS_ACTIVE_RANGE_PX = 560;

function getTile(state: SimState, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= state.tilesW || ty >= state.tilesH) {
    return TileType.SOLID;
  }
  return state.tiles[ty * state.tilesW + tx] ?? TileType.EMPTY;
}

function isSolid(state: SimState, tile: number): boolean {
  switch (tile) {
    case TileType.SOLID:
    case TileType.BREAKABLE:
    case TileType.ICE:
    case TileType.CONVEYOR_L:
    case TileType.CONVEYOR_R:
    case TileType.ELECTRIC_RAIL:
    case TileType.LASER_MIRROR:
    case TileType.CRUSHER:
      return true;
    case TileType.TOGGLE_A:
      return !state.togglePhase;
    case TileType.TOGGLE_B:
      return state.togglePhase;
    default:
      return false;
  }
}

function isSupport(state: SimState, tile: number): boolean {
  return isSolid(state, tile) || tile === TileType.ONE_WAY;
}

function aabbOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function moveEnemyX(state: SimState, enemy: EnemyEntity, dx: number): boolean {
  if (dx === 0 || !Number.isFinite(dx)) return false;
  const nextX = enemy.x + dx;
  const topTy = Math.floor((enemy.y + 1) / TILE);
  const botTy = Math.floor((enemy.y + enemy.h - 1) / TILE);
  if (dx > 0) {
    const rightTx = Math.floor((nextX + enemy.w) / TILE);
    for (let ty = topTy; ty <= botTy; ty++) {
      if (isSolid(state, getTile(state, rightTx, ty))) {
        enemy.x = rightTx * TILE - enemy.w - 0.01;
        return true;
      }
    }
  } else {
    const leftTx = Math.floor(nextX / TILE);
    for (let ty = topTy; ty <= botTy; ty++) {
      if (isSolid(state, getTile(state, leftTx, ty))) {
        enemy.x = (leftTx + 1) * TILE + 0.01;
        return true;
      }
    }
  }
  enemy.x = nextX;
  return false;
}

function moveEnemyY(state: SimState, enemy: EnemyEntity, dy: number): boolean {
  if (!Number.isFinite(dy)) return false;
  const prevBottom = enemy.y + enemy.h;
  const nextY = enemy.y + dy;
  const leftTx = Math.floor((enemy.x + 1) / TILE);
  const rightTx = Math.floor((enemy.x + enemy.w - 1) / TILE);

  if (dy >= 0) {
    const botTy = Math.floor((nextY + enemy.h) / TILE);
    for (let tx = leftTx; tx <= rightTx; tx++) {
      const tile = getTile(state, tx, botTy);
      const tileTop = botTy * TILE;
      if (isSolid(state, tile) || (tile === TileType.ONE_WAY && prevBottom <= tileTop + 2)) {
        enemy.y = tileTop - enemy.h;
        enemy.vy = 0;
        enemy.grounded = true;
        return true;
      }
    }
    enemy.grounded = false;
  } else {
    const topTy = Math.floor(nextY / TILE);
    for (let tx = leftTx; tx <= rightTx; tx++) {
      if (isSolid(state, getTile(state, tx, topTy))) {
        enemy.y = (topTy + 1) * TILE + 0.01;
        enemy.vy = 0;
        return true;
      }
    }
    enemy.grounded = false;
  }
  enemy.y = nextY;
  return false;
}

function hasFloorAhead(state: SimState, enemy: EnemyEntity, dir: -1 | 1): boolean {
  const probeX = dir > 0 ? enemy.x + enemy.w + 2 : enemy.x - 2;
  const tx = Math.floor(probeX / TILE);
  const ty = Math.floor((enemy.y + enemy.h + 2) / TILE);
  return isSupport(state, getTile(state, tx, ty));
}

function hasWallAdjacent(state: SimState, enemy: EnemyEntity, dir: -1 | 1): boolean {
  const probeX = dir > 0 ? enemy.x + enemy.w + 3 : enemy.x - 3;
  const tx = Math.floor(probeX / TILE);
  const midTy = Math.floor((enemy.y + enemy.h * 0.5) / TILE);
  return isSolid(state, getTile(state, tx, midTy));
}

function getContactDamage(state: SimState, tier: 'light' | 'medium' | 'heavy'): number {
  const table = DAMAGE_TABLES[state.progression.difficulty];
  if (tier === 'heavy') return table.heavyContact;
  if (tier === 'medium') return table.mediumContact;
  return table.lightContact;
}

function getProjectileDamage(state: SimState, tier: 'light' | 'medium' | 'heavy'): number {
  const table = DAMAGE_TABLES[state.progression.difficulty];
  if (tier === 'heavy') return table.heavyProjectile;
  if (tier === 'medium') return table.mediumProjectile;
  return table.lightProjectile;
}

function dropEnemyRewards(
  state: SimState,
  enemy: EnemyEntity,
  dropBits: number,
  cb: EnemySimCallbacks,
): void {
  if (dropBits <= 0) return;
  const farmCount = state.progression.farmCounts[enemy.spawnId] ?? 0;
  if (farmCount >= ECONOMY_CONSTANTS.FARM_CAP_PER_ENEMY_ID) return;
  state.progression.farmCounts[enemy.spawnId] = farmCount + 1;

  const cx = enemy.x + enemy.w * 0.5;
  const cy = enemy.y + enemy.h * 0.5;
  let remaining = dropBits;
  const armorBonus =
    state.progression.loadouts[state.progression.activeLoadoutIndex].armorPaint === 2 ? 3 : 0;
  remaining += armorBonus;

  while (remaining > 0) {
    let kind: PickupEntity['kind'] = 'bit_1';
    let value = 1;
    if (remaining >= 50) {
      kind = 'bit_50';
      value = 50;
    } else if (remaining >= 10) {
      kind = 'bit_10';
      value = 10;
    } else if (remaining >= 5) {
      kind = 'bit_5';
      value = 5;
    }
    remaining -= value;
    cb.spawnPickup(state, {
      kind,
      x: cx - 4,
      y: cy - 4,
      vx: (nextRng(state) - 0.5) * 2.8,
      vy: -2.2 - nextRng(state) * 1.4,
      value,
      ttl: 420,
    });
  }

  if (enemy.isMiniboss) {
    cb.spawnPickup(state, {
      kind: 'health_large',
      x: cx - 6,
      y: cy - 6,
      vx: 0,
      vy: -3.0,
      value: 8,
      ttl: 600,
    });
    return;
  }

  const roll = nextRng(state);
  if (roll < 0.22) {
    cb.spawnPickup(state, {
      kind: 'health_small',
      x: cx - 5,
      y: cy - 5,
      vx: (nextRng(state) - 0.5) * 1.6,
      vy: -2.6,
      value: 4,
      ttl: 420,
    });
  } else if (roll < 0.36) {
    cb.spawnPickup(state, {
      kind: 'burst_orb',
      x: cx - 5,
      y: cy - 5,
      vx: (nextRng(state) - 0.5) * 1.6,
      vy: -2.6,
      value: 25,
      ttl: 420,
    });
  }
}

export function spawnEnemyFromArchetype(
  state: SimState,
  archetypeId: string,
  x: number,
  y: number,
  spawnId = `dyn_${archetypeId}_${state.nextEntityId}`,
): EnemyEntity | null {
  const arch = getEnemyArchetype(archetypeId);
  if (!arch) return null;
  const rudeBonus =
    state.progression.modifiers.rudeEnemies &&
    arch.family !== 'dummy' &&
    arch.family !== 'hazard'
      ? 1
      : 0;
  const hp = arch.hp + rudeBonus;
  const entity: EnemyEntity = {
    id: state.nextEntityId++,
    archetypeId: arch.id,
    x,
    y,
    vx: 0,
    vy: 0,
    w: arch.width,
    h: arch.height,
    facing: -1,
    hp,
    maxHp: hp,
    shielded: Boolean(arch.shielded),
    stunTimer: 0,
    hurtFlash: 0,
    aiTimer: 0,
    aiPhase: 0,
    homeX: x,
    homeY: y,
    grounded: false,
    grabbed: false,
    dead: false,
    isMiniboss: false,
    spawnId,
  };
  state.enemies.push(entity);
  return entity;
}

export function spawnMiniboss(
  state: SimState,
  minibossId: MinibossId,
  x: number,
  y: number,
  spawnId = `miniboss_${minibossId}_${state.nextEntityId}`,
): EnemyEntity {
  const maxHp = state.progression.modifiers.rudeEnemies
    ? BOSS_CONSTANTS.MINIBOSS_HP_RUDE
    : BOSS_CONSTANTS.MINIBOSS_HP_NORMAL;
  const entity: EnemyEntity = {
    id: state.nextEntityId++,
    archetypeId: minibossId,
    x,
    y,
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
    homeX: x,
    homeY: y,
    grounded: false,
    grabbed: false,
    dead: false,
    isMiniboss: true,
    minibossId,
    spawnId,
  };
  state.enemies.push(entity);
  return entity;
}

// ============================================================================
// Miniboss Multi-Phase AI Helpers (junk_colossus, sky_gunship, wrecker_tank)
// ============================================================================

function unpackMbPhase(aiPhase: number): {
  mode: number;
  pattern: number;
  enragedTriggered: boolean;
} {
  return {
    mode: aiPhase & 0x0f,
    pattern: (aiPhase >> 4) & 0x03,
    enragedTriggered: (aiPhase & 0x100) !== 0,
  };
}

function packMbPhase(mode: number, pattern: number, enragedTriggered: boolean): number {
  return (mode & 0x0f) | ((pattern & 0x03) << 4) | (enragedTriggered ? 0x100 : 0);
}

function resolveMinibossId(enemy: EnemyEntity): MinibossId {
  const raw = enemy.minibossId ?? enemy.archetypeId;
  if (raw === 'sky_gunship' || raw === 'wrecker_tank' || raw === 'junk_colossus') {
    return raw;
  }
  return 'junk_colossus';
}

function getMinibossDisplayMeta(id: MinibossId): { label: string; accent: string } {
  switch (id) {
    case 'junk_colossus':
      return { label: 'JUNK COLOSSUS', accent: '#f97316' };
    case 'sky_gunship':
      return { label: 'SKY GUNSHIP', accent: '#f43f5e' };
    case 'wrecker_tank':
      return { label: 'WRECKER TANK', accent: '#ffd166' };
  }
}

function updateMiniboss(
  state: SimState,
  enemy: EnemyEntity,
  cb: EnemySimCallbacks,
  dxToPlayer: number,
  dyToPlayer: number,
  rude: boolean,
): void {
  const mbId = resolveMinibossId(enemy);
  const meta = getMinibossDisplayMeta(mbId);
  const table = DAMAGE_TABLES[state.progression.difficulty];
  const projMed = table.mediumProjectile;
  const projHeavy = table.heavyProjectile;
  const expDmg = table.explosion;
  const dirToPlayer: -1 | 1 = dxToPlayer >= 0 ? 1 : -1;
  const eCx = enemy.x + enemy.w * 0.5;
  const eCy = enemy.y + enemy.h * 0.5;

  let { mode, pattern, enragedTriggered } = unpackMbPhase(enemy.aiPhase);
  const enraged = enemy.hp <= Math.ceil(enemy.maxHp * 0.5);

  // Trigger Phase 2 Enraged Overdrive once at <= 50% HP
  if (enraged && !enragedTriggered) {
    enragedTriggered = true;
    mode = 1; // jump cleanly into an immediate enraged telegraph
    enemy.aiTimer = 0;
    enemy.vx = 0;
    enemy.shielded = false;
    state.events.push(
      { type: 'sfx', key: 'boss_desperation', gain: 0.85 },
      { type: 'shake', ticks: 12, intensity: 3 },
      {
        type: 'particle',
        kind: 'shockring',
        x: eCx,
        y: eCy,
        color: meta.accent,
        count: 14,
      },
      { type: 'toast', text: `${meta.label} — OVERDRIVE!`, tone: 'warn' },
    );
  }

  const p2 = enragedTriggered || rude;
  enemy.aiTimer += 1;

  if (mbId === 'junk_colossus') {
    // ------------------------------------------------------------------------
    // MINIBOSS 1: JUNK COLOSSUS — heavy charge, falling debris, shockwave slam
    // ------------------------------------------------------------------------
    if (mode === 0) {
      // Idle pacing
      enemy.vx *= 0.8;
      enemy.facing = dirToPlayer;
      if (enemy.aiTimer >= (p2 ? 16 : 24)) {
        mode = 1;
        enemy.aiTimer = 0;
      }
    } else if (mode === 1) {
      // Telegraph stance
      enemy.vx = 0;
      enemy.facing = dirToPlayer;
      if (enemy.aiTimer === 8) {
        state.events.push({
          type: 'particle',
          kind: 'spark',
          x: eCx,
          y: eCy - 6,
          color: '#fbbf24',
          count: 7,
        });
      }
      if (enemy.aiTimer >= (p2 ? 18 : 24)) {
        mode = 2;
        enemy.aiTimer = 0;
        if (pattern === 0) {
          // Heavy Chassis Charge
          enemy.vx = enemy.facing * (p2 ? 4.8 : 3.8);
          state.events.push({ type: 'sfx', key: 'sprint_kick', gain: 0.9 });
        } else if (pattern === 1) {
          // Leap for Falling Scrap Debris quake
          enemy.vy = -5.4;
          enemy.vx = enemy.facing * 1.4;
          enemy.grounded = false;
          state.events.push({ type: 'sfx', key: 'jump', gain: 0.85 });
        } else {
          // Shockwave Fist Slam windup
          enemy.vx = 0;
        }
      }
    } else if (mode === 2) {
      // Active attack
      if (pattern === 0) {
        // Heavy Chassis Charge across arena
        if (enemy.aiTimer % 6 === 0) {
          state.events.push({
            type: 'particle',
            kind: 'dust',
            x: eCx - enemy.facing * 14,
            y: enemy.y + enemy.h - 2,
            color: '#f97316',
            count: 3,
          });
        }
        const hitWall = moveEnemyX(state, enemy, enemy.vx);
        const pastRange = Math.abs(enemy.x - enemy.homeX) > 145;
        if (hitWall || pastRange || enemy.aiTimer >= 48) {
          enemy.vx = 0;
          state.events.push(
            { type: 'sfx', key: 'heavy_hit', gain: 0.9 },
            { type: 'shake', ticks: 8, intensity: 3 },
          );
          cb.spawnProjectile(state, {
            owner: 'enemy',
            kind: 'shockwave',
            x: eCx - 7,
            y: enemy.y + enemy.h - 14,
            vx: (hitWall ? -enemy.facing : enemy.facing) * (p2 ? 4.1 : 3.2),
            vy: 0,
            w: 14,
            h: 14,
            damage: projMed,
            ttl: 75,
            pierce: true,
            bouncesLeft: 0,
            color: '#f97316',
          });
          mode = 3;
          enemy.aiTimer = 0;
          pattern = (pattern + 1) % 3;
        }
      } else if (pattern === 1) {
        // Falling Scrap Debris on slam impact or timer
        const prevGrounded = enemy.grounded;
        enemy.vy = Math.min(MAX_FALL, enemy.vy + GRAVITY);
        moveEnemyX(state, enemy, enemy.vx);
        moveEnemyY(state, enemy, enemy.vy);
        if ((enemy.grounded && !prevGrounded && enemy.aiTimer > 6) || enemy.aiTimer >= 46) {
          enemy.vx = 0;
          const debrisCount = p2 ? 5 : 3;
          const baseCenter = state.player.x + state.player.w * 0.5;
          for (let d = 0; d < debrisCount; d++) {
            const spread = (d - (debrisCount - 1) * 0.5) * 44 + (nextRng(state) - 0.5) * 16;
            cb.spawnProjectile(state, {
              owner: 'enemy',
              kind: 'enemy_shot',
              x: baseCenter + spread - 5,
              y: Math.max(TILE * 2, enemy.homeY - 110),
              vx: (nextRng(state) - 0.5) * 0.8,
              vy: 2.8 + nextRng(state) * 0.9,
              w: 10,
              h: 10,
              damage: expDmg,
              ttl: 110,
              pierce: false,
              bouncesLeft: 1,
              color: '#fbbf24',
            });
          }
          state.events.push(
            { type: 'sfx', key: 'explosion', gain: 0.85 },
            { type: 'shake', ticks: 10, intensity: 3 },
            {
              type: 'particle',
              kind: 'dust',
              x: eCx,
              y: enemy.y + enemy.h,
              color: '#d97706',
              count: 10,
            },
          );
          mode = 3;
          enemy.aiTimer = 0;
          pattern = (pattern + 1) % 3;
        }
      } else {
        // Shockwave Fist Slam releasing twin ground waves
        if (enemy.aiTimer === 10) {
          for (const dir of [-1, 1] as const) {
            cb.spawnProjectile(state, {
              owner: 'enemy',
              kind: 'shockwave',
              x: eCx - 7 + dir * 12,
              y: enemy.y + enemy.h - 14,
              vx: dir * (p2 ? 4.3 : 3.4),
              vy: 0,
              w: 14,
              h: 14,
              damage: projHeavy,
              ttl: 85,
              pierce: true,
              bouncesLeft: 0,
              color: '#ff6b4a',
            });
          }
          if (p2) {
            cb.spawnProjectile(state, {
              owner: 'enemy',
              kind: 'enemy_shot',
              x: eCx - 4,
              y: enemy.y,
              vx: enemy.facing * 2.2,
              vy: -3.2,
              w: 8,
              h: 8,
              damage: projMed,
              ttl: 95,
              pierce: false,
              bouncesLeft: 1,
              color: '#fde047',
            });
          }
          state.events.push(
            { type: 'sfx', key: 'heavy_hit', gain: 0.95 },
            { type: 'shake', ticks: 10, intensity: 3 },
            {
              type: 'particle',
              kind: 'shockring',
              x: eCx,
              y: enemy.y + enemy.h - 4,
              color: '#f97316',
              count: 12,
            },
          );
        }
        if (enemy.aiTimer >= 26) {
          mode = 3;
          enemy.aiTimer = 0;
          pattern = (pattern + 1) % 3;
        }
      }
    } else {
      // Recover
      enemy.vx *= 0.8;
      if (enemy.aiTimer >= (p2 ? 18 : 26)) {
        mode = 0;
        enemy.aiTimer = 0;
      }
    }

    if (!(mode === 2 && pattern === 1)) {
      enemy.vy = Math.min(MAX_FALL, enemy.vy + GRAVITY);
      moveEnemyY(state, enemy, enemy.vy);
      if (mode !== 2) {
        moveEnemyX(state, enemy, enemy.vx);
      }
    }
  } else if (mbId === 'sky_gunship') {
    // ------------------------------------------------------------------------
    // MINIBOSS 2: SKY GUNSHIP — aerial strafe, aimed twin cannons, bomb pass
    // ------------------------------------------------------------------------
    const cruiseY = Math.max(TILE * 2 + 8, enemy.homeY - 38);
    const bobY = cruiseY + Math.sin(state.tick * 0.08) * 10;

    if (mode === 0) {
      enemy.facing = dirToPlayer;
      const targetX = enemy.homeX + Math.sin(state.tick * 0.04) * 70;
      enemy.vx = (targetX - enemy.x) * 0.06;
      enemy.y += (bobY - enemy.y) * 0.12;
      moveEnemyX(state, enemy, enemy.vx);
      if (enemy.aiTimer >= (p2 ? 16 : 24)) {
        mode = 1;
        enemy.aiTimer = 0;
      }
    } else if (mode === 1) {
      // Target lock telegraph
      enemy.vx *= 0.85;
      enemy.facing = dirToPlayer;
      enemy.y += (bobY - enemy.y) * 0.1;
      moveEnemyX(state, enemy, enemy.vx);
      if (enemy.aiTimer === 8) {
        state.events.push({
          type: 'particle',
          kind: 'spark',
          x: eCx + enemy.facing * 14,
          y: eCy + 4,
          color: '#38f8ff',
          count: 7,
        });
      }
      if (enemy.aiTimer >= (p2 ? 16 : 22)) {
        mode = 2;
        enemy.aiTimer = 0;
        if (pattern === 2) {
          // Start Bomb Drop Pass across arena
          const passDir: -1 | 1 = enemy.x > enemy.homeX ? -1 : 1;
          enemy.facing = passDir;
          enemy.vx = passDir * (p2 ? 4.2 : 3.2);
          state.events.push({ type: 'sfx', key: 'sprint_kick', gain: 0.75 });
        }
      }
    } else if (mode === 2) {
      if (pattern === 0) {
        // Hovering Aerial Strafe firing suppressive angled shots
        const strafeX = enemy.homeX + Math.sin(enemy.aiTimer * 0.09) * 105;
        enemy.vx = (strafeX - enemy.x) * 0.14;
        enemy.facing = dirToPlayer;
        moveEnemyX(state, enemy, enemy.vx);
        enemy.y += (bobY - enemy.y) * 0.12;
        const interval = p2 ? 12 : 16;
        if (enemy.aiTimer % interval === 0) {
          const dist = Math.max(1, Math.hypot(dxToPlayer, dyToPlayer));
          cb.spawnProjectile(state, {
            owner: 'enemy',
            kind: 'enemy_shot',
            x: eCx - 4,
            y: enemy.y + enemy.h - 2,
            vx: (dxToPlayer / dist) * 3.6,
            vy: Math.max(1.2, (dyToPlayer / dist) * 3.6),
            w: 7,
            h: 7,
            damage: projMed,
            ttl: 105,
            pierce: false,
            bouncesLeft: 0,
            color: '#f43f5e',
          });
          state.events.push({ type: 'sfx', key: 'jab', gain: 0.65 });
        }
        if (enemy.aiTimer >= 52) {
          mode = 3;
          enemy.aiTimer = 0;
          pattern = (pattern + 1) % 3;
        }
      } else if (pattern === 1) {
        // Aimed Twin Cannon Bursts
        enemy.vx *= 0.82;
        enemy.facing = dirToPlayer;
        enemy.y += (cruiseY - enemy.y) * 0.1;
        const fireNow =
          enemy.aiTimer === 10 || enemy.aiTimer === 24 || (p2 && enemy.aiTimer === 38);
        if (fireNow) {
          const dist = Math.max(1, Math.hypot(dxToPlayer, dyToPlayer));
          const speed = p2 ? 4.8 : 4.0;
          const vx = (dxToPlayer / dist) * speed;
          const vy = (dyToPlayer / dist) * speed;
          for (const barrelOff of [-7, 7]) {
            cb.spawnProjectile(state, {
              owner: 'enemy',
              kind: 'laser_beam',
              x: eCx + barrelOff - 4,
              y: eCy + 6,
              vx,
              vy,
              w: 8,
              h: 8,
              damage: projMed,
              ttl: 100,
              pierce: false,
              bouncesLeft: 0,
              color: '#38f8ff',
            });
          }
          state.events.push({ type: 'sfx', key: 'burst', gain: 0.7 });
        }
        if (enemy.aiTimer >= (p2 ? 44 : 34)) {
          mode = 3;
          enemy.aiTimer = 0;
          pattern = (pattern + 1) % 3;
        }
      } else {
        // Bomb Drop Pass
        const hitWall = moveEnemyX(state, enemy, enemy.vx);
        enemy.y += (cruiseY - 8 - enemy.y) * 0.14;
        const dropEvery = p2 ? 9 : 13;
        if (enemy.aiTimer % dropEvery === 0) {
          cb.spawnProjectile(state, {
            owner: 'enemy',
            kind: 'shockwave',
            x: eCx - 5,
            y: enemy.y + enemy.h,
            vx: enemy.vx * 0.25,
            vy: 3.1,
            w: 10,
            h: 10,
            damage: expDmg,
            ttl: 95,
            pierce: false,
            bouncesLeft: 1,
            color: '#ff6b4a',
          });
          state.events.push({ type: 'sfx', key: 'throw', gain: 0.65 });
        }
        if (hitWall || Math.abs(enemy.x - enemy.homeX) > 140 || enemy.aiTimer >= 46) {
          enemy.vx = 0;
          mode = 3;
          enemy.aiTimer = 0;
          pattern = (pattern + 1) % 3;
        }
      }
    } else {
      enemy.vx *= 0.85;
      enemy.y += (bobY - enemy.y) * 0.1;
      moveEnemyX(state, enemy, enemy.vx);
      if (enemy.aiTimer >= (p2 ? 16 : 24)) {
        mode = 0;
        enemy.aiTimer = 0;
      }
    }
  } else {
    // ------------------------------------------------------------------------
    // MINIBOSS 3: WRECKER TANK — armored tread roll, mortar lob, shield bash
    // ------------------------------------------------------------------------
    if (mode === 0) {
      enemy.shielded = false;
      enemy.vx *= 0.8;
      enemy.facing = dirToPlayer;
      if (enemy.aiTimer >= (p2 ? 16 : 24)) {
        mode = 1;
        enemy.aiTimer = 0;
      }
    } else if (mode === 1) {
      enemy.vx = 0;
      enemy.facing = dirToPlayer;
      if (pattern === 2) {
        // Engage frontal hard-light plow during shield-bash windup & charge
        enemy.shielded = true;
      }
      if (enemy.aiTimer === 8) {
        state.events.push({
          type: 'particle',
          kind: 'spark',
          x: eCx + enemy.facing * 16,
          y: eCy,
          color: pattern === 2 ? '#38f8ff' : '#ffd166',
          count: 7,
        });
      }
      if (enemy.aiTimer >= (p2 ? 18 : 24)) {
        mode = 2;
        enemy.aiTimer = 0;
        if (pattern === 0) {
          enemy.vx = enemy.facing * (p2 ? 3.8 : 2.9);
          state.events.push({ type: 'sfx', key: 'sprint_kick', gain: 0.8 });
        } else if (pattern === 2) {
          enemy.vx = enemy.facing * (p2 ? 5.2 : 4.2);
          state.events.push({ type: 'sfx', key: 'sprint_kick', gain: 0.95 });
        }
      }
    } else if (mode === 2) {
      if (pattern === 0) {
        // Armored Tread Roll
        const hitWall = moveEnemyX(state, enemy, enemy.vx);
        if (enemy.aiTimer % 12 === 0) {
          state.events.push({
            type: 'particle',
            kind: 'dust',
            x: eCx - enemy.facing * 14,
            y: enemy.y + enemy.h - 2,
            color: '#c7b8bf',
            count: 3,
          });
        }
        if (hitWall || Math.abs(enemy.x - enemy.homeX) > 135 || enemy.aiTimer >= 48) {
          enemy.vx = 0;
          cb.spawnProjectile(state, {
            owner: 'enemy',
            kind: 'shockwave',
            x: eCx - 7,
            y: enemy.y + enemy.h - 14,
            vx: enemy.facing * (p2 ? 4.0 : 3.2),
            vy: 0,
            w: 14,
            h: 14,
            damage: projMed,
            ttl: 80,
            pierce: true,
            bouncesLeft: 0,
            color: '#f97316',
          });
          state.events.push({ type: 'sfx', key: 'heavy_hit', gain: 0.85 });
          mode = 3;
          enemy.aiTimer = 0;
          pattern = (pattern + 1) % 3;
        }
      } else if (pattern === 1) {
        // Mortar Lob barrage
        enemy.vx = 0;
        const interval = p2 ? 10 : 13;
        if (enemy.aiTimer % interval === 0 && enemy.aiTimer <= interval * (p2 ? 4 : 3)) {
          const idx = Math.floor(enemy.aiTimer / interval);
          cb.spawnProjectile(state, {
            owner: 'enemy',
            kind: 'enemy_shot',
            x: eCx - 5,
            y: enemy.y + 2,
            vx: enemy.facing * (1.8 + idx * 0.75),
            vy: -4.2,
            w: 10,
            h: 10,
            damage: expDmg,
            ttl: 105,
            pierce: false,
            bouncesLeft: 1,
            color: '#ffd166',
          });
          state.events.push({ type: 'sfx', key: 'throw', gain: 0.75 });
        }
        if (enemy.aiTimer >= (p2 ? 46 : 44)) {
          mode = 3;
          enemy.aiTimer = 0;
          pattern = (pattern + 1) % 3;
        }
      } else {
        // Shield-Bash Charge
        const hitWall = moveEnemyX(state, enemy, enemy.vx);
        if (hitWall || Math.abs(enemy.x - enemy.homeX) > 150 || enemy.aiTimer >= 42) {
          enemy.vx = 0;
          enemy.shielded = false;
          state.events.push(
            { type: 'sfx', key: 'armor_break', gain: 0.8 },
            { type: 'shake', ticks: 8, intensity: 3 },
            {
              type: 'particle',
              kind: 'shard',
              x: eCx + enemy.facing * 16,
              y: eCy,
              color: '#38f8ff',
              count: 8,
            },
          );
          cb.spawnProjectile(state, {
            owner: 'enemy',
            kind: 'shockwave',
            x: eCx + enemy.facing * 10 - 6,
            y: enemy.y + enemy.h - 14,
            vx: enemy.facing * 3.6,
            vy: 0,
            w: 12,
            h: 14,
            damage: projHeavy,
            ttl: 65,
            pierce: true,
            bouncesLeft: 0,
            color: '#38f8ff',
          });
          mode = 3;
          enemy.aiTimer = 0;
          pattern = (pattern + 1) % 3;
        }
      }
    } else {
      enemy.shielded = false;
      enemy.vx *= 0.8;
      if (enemy.aiTimer >= (p2 ? 18 : 28)) {
        mode = 0;
        enemy.aiTimer = 0;
      }
    }

    enemy.vy = Math.min(MAX_FALL, enemy.vy + GRAVITY);
    moveEnemyY(state, enemy, enemy.vy);
  }

  enemy.aiPhase = packMbPhase(mode, pattern, enragedTriggered);
}

// ============================================================================
// Biome-Aware Projectile Helper for All 42 Archetypes
// ============================================================================

function fireTrooperShot(
  state: SimState,
  enemy: EnemyEntity,
  arch: EnemyArchetype,
  shotDmg: number,
  rude: boolean,
  cb: EnemySimCallbacks,
): void {
  const eCx = enemy.x + enemy.w * 0.5;
  const eCy = enemy.y + enemy.h * 0.5;

  if (arch.biomeTag === 'patch') {
    // Molten bouncing slag bolts
    cb.spawnProjectile(state, {
      owner: 'enemy',
      kind: 'enemy_shot',
      x: eCx + enemy.facing * 9 - 4,
      y: eCy - 4,
      vx: enemy.facing * 2.8,
      vy: -2.0,
      w: 8,
      h: 8,
      damage: shotDmg,
      ttl: 115,
      pierce: false,
      bouncesLeft: 2,
      color: arch.palette[4],
    });
  } else if (arch.biomeTag === 'cooler') {
    // Frost bolt + chill gust pulse
    cb.spawnProjectile(state, {
      owner: 'enemy',
      kind: 'phase_ball',
      x: eCx + enemy.facing * 9 - 3,
      y: eCy - 3,
      vx: enemy.facing * 3.1,
      vy: 0,
      w: 7,
      h: 7,
      damage: shotDmg,
      ttl: 115,
      pierce: false,
      bouncesLeft: 0,
      color: '#67e8f9',
    });
    const p = state.player;
    if (
      Math.abs(p.x + p.w * 0.5 - eCx) < 92 &&
      Math.abs(p.y + p.h * 0.5 - eCy) < 42
    ) {
      p.vx *= 0.65;
      state.events.push({
        type: 'particle',
        kind: 'shard',
        x: p.x + p.w * 0.5,
        y: p.y + p.h * 0.5,
        color: '#67e8f9',
        count: 4,
      });
    }
  } else if (arch.biomeTag === 'elec') {
    // Crackling high-voltage electric arc
    cb.spawnProjectile(state, {
      owner: 'enemy',
      kind: 'electric_arc',
      x: eCx + enemy.facing * 9 - 4,
      y: eCy - 4,
      vx: enemy.facing * 3.8,
      vy: 0,
      w: 8,
      h: 8,
      damage: shotDmg,
      ttl: 105,
      pierce: false,
      bouncesLeft: 0,
      color: '#facc15',
    });
  } else if (arch.biomeTag === 'wave') {
    // Wide rhythmic sonic shockwave
    cb.spawnProjectile(state, {
      owner: 'enemy',
      kind: 'shockwave',
      x: eCx + enemy.facing * 9 - 5,
      y: eCy - 6,
      vx: enemy.facing * 3.3,
      vy: 0,
      w: 10,
      h: 12,
      damage: shotDmg,
      ttl: 105,
      pierce: true,
      bouncesLeft: 0,
      color: '#d946ef',
    });
  } else if (arch.biomeTag === 'cipher') {
    // Neon phase bolt
    cb.spawnProjectile(state, {
      owner: 'enemy',
      kind: 'phase_ball',
      x: eCx + enemy.facing * 9 - 3,
      y: eCy - 3,
      vx: enemy.facing * 4.0,
      vy: 0,
      w: 7,
      h: 7,
      damage: shotDmg,
      ttl: 110,
      pierce: false,
      bouncesLeft: 1,
      color: '#10b981',
    });
  } else if (arch.biomeTag === 'optic') {
    // Focused solar laser bolt
    cb.spawnProjectile(state, {
      owner: 'enemy',
      kind: 'laser_beam',
      x: eCx + enemy.facing * 9 - 6,
      y: eCy - 3,
      vx: enemy.facing * 4.1,
      vy: 0,
      w: 12,
      h: 6,
      damage: shotDmg,
      ttl: 100,
      pierce: false,
      bouncesLeft: 0,
      color: '#fde047',
    });
  } else if (arch.id === 'citadel_vanguard') {
    // Disciplined twin burst
    for (const dy of [-4, 4]) {
      cb.spawnProjectile(state, {
        owner: 'enemy',
        kind: 'enemy_shot',
        x: eCx + enemy.facing * 9 - 3,
        y: eCy + dy - 3,
        vx: enemy.facing * 4.0,
        vy: dy * 0.08,
        w: 7,
        h: 6,
        damage: shotDmg,
        ttl: 115,
        pierce: false,
        bouncesLeft: 0,
        color: arch.palette[5],
      });
    }
  } else {
    // Classic rail blaster bolt
    cb.spawnProjectile(state, {
      owner: 'enemy',
      kind: 'enemy_shot',
      x: eCx + enemy.facing * 9 - 3,
      y: eCy - 3,
      vx: enemy.facing * 3.2,
      vy: 0,
      w: 6,
      h: 6,
      damage: shotDmg,
      ttl: 110,
      pierce: false,
      bouncesLeft: 0,
      color: arch.palette[5],
    });
  }

  if (rude) {
    cb.spawnProjectile(state, {
      owner: 'enemy',
      kind: 'enemy_shot',
      x: eCx + enemy.facing * 9 - 3,
      y: eCy - 3,
      vx: enemy.facing * 2.5,
      vy: -0.75,
      w: 6,
      h: 6,
      damage: shotDmg,
      ttl: 105,
      pierce: false,
      bouncesLeft: 0,
      color: arch.palette[4],
    });
  }
}

// ============================================================================
// Master Enemy & Miniboss Update Loop
// ============================================================================

export function updateEnemies(state: SimState, cb: EnemySimCallbacks): void {
  const player = state.player;
  const pCx = player.x + player.w * 0.5;
  const pCy = player.y + player.h * 0.5;
  const frozen = player.freezeFieldTimer > 0;
  const rude = state.progression.modifiers.rudeEnemies;

  for (let i = 0; i < state.enemies.length; i++) {
    const enemy = state.enemies[i];
    if (enemy.dead || enemy.grabbed) continue;

    if (enemy.hurtFlash > 0) {
      enemy.hurtFlash -= 1;
    }

    // ------------------------------------------------------------------------
    // Bespoke Miniboss Path (3 Minibosses: junk_colossus, sky_gunship, wrecker_tank)
    // ------------------------------------------------------------------------
    if (enemy.isMiniboss) {
      const mbId = resolveMinibossId(enemy);
      const meta = getMinibossDisplayMeta(mbId);

      if (enemy.hp <= 0) {
        enemy.dead = true;
        enemy.shielded = false;
        state.stageStats.enemiesDefeated += 1;
        state.events.push(
          { type: 'sfx', key: 'explosion', gain: 0.95 },
          { type: 'shake', ticks: 18, intensity: 4 },
          { type: 'rumble', weak: 0.5, strong: 0.9, durationMs: 320 },
          {
            type: 'particle',
            kind: 'explosion',
            x: enemy.x + enemy.w * 0.5,
            y: enemy.y + enemy.h * 0.5,
            color: meta.accent,
            count: 16,
          },
          { type: 'toast', text: `${meta.label} DISMANTLED!`, tone: 'unlock' },
        );
        dropEnemyRewards(state, enemy, 50, cb);
        continue;
      }

      const eCx = enemy.x + enemy.w * 0.5;
      const eCy = enemy.y + enemy.h * 0.5;
      const dxToPlayer = pCx - eCx;
      const dyToPlayer = pCy - eCy;
      const distSq = dxToPlayer * dxToPlayer + dyToPlayer * dyToPlayer;

      if (frozen) continue;

      if (enemy.stunTimer > 0) {
        enemy.stunTimer -= 1;
        enemy.vx *= 0.82;
        if (mbId !== 'sky_gunship') {
          enemy.vy = Math.min(MAX_FALL, enemy.vy + GRAVITY);
          moveEnemyY(state, enemy, enemy.vy);
        }
        moveEnemyX(state, enemy, enemy.vx);
        continue;
      }

      if (distSq <= MINIBOSS_ACTIVE_RANGE_PX * MINIBOSS_ACTIVE_RANGE_PX) {
        updateMiniboss(state, enemy, cb, dxToPlayer, dyToPlayer, rude);
      }

      if (
        player.invulnTimer <= 0 &&
        player.action !== 'dead' &&
        player.action !== 'warp' &&
        aabbOverlap(player.x, player.y, player.w, player.h, enemy.x, enemy.y, enemy.w, enemy.h)
      ) {
        const dmg = getContactDamage(state, 'heavy');
        cb.damagePlayer(state, dmg, enemy.x + enemy.w * 0.5);
      }
      continue;
    }

    // ------------------------------------------------------------------------
    // Standard Enemy Path (All 42 Archetypes across 9 Families & 13 Biomes)
    // ------------------------------------------------------------------------
    const arch = getEnemyArchetype(enemy.archetypeId);
    if (!arch) continue;

    // Safety net for defeated enemies not yet marked dead
    if (enemy.hp <= 0 && arch.family !== 'dummy') {
      enemy.dead = true;
      state.stageStats.enemiesDefeated += 1;
      state.events.push(
        { type: 'sfx', key: 'explosion', gain: 0.7 },
        {
          type: 'particle',
          kind: 'explosion',
          x: enemy.x + enemy.w * 0.5,
          y: enemy.y + enemy.h * 0.5,
          color: arch.palette[4],
          count: 8,
        },
      );
      dropEnemyRewards(state, enemy, arch.dropBits, cb);
      continue;
    }

    // Practice dummy regenerates smoothly and never dies
    if (arch.family === 'dummy') {
      enemy.aiTimer += 1;
      enemy.vx *= 0.8;
      enemy.vy = Math.min(MAX_FALL, enemy.vy + GRAVITY);
      moveEnemyX(state, enemy, enemy.vx);
      moveEnemyY(state, enemy, enemy.vy);
      if (enemy.hp < enemy.maxHp && enemy.hurtFlash === 0 && enemy.aiTimer % 90 === 0) {
        enemy.hp = enemy.maxHp;
      }
      continue;
    }

    const eCx = enemy.x + enemy.w * 0.5;
    const eCy = enemy.y + enemy.h * 0.5;
    const dxToPlayer = pCx - eCx;
    const dyToPlayer = pCy - eCy;
    const distSq = dxToPlayer * dxToPlayer + dyToPlayer * dyToPlayer;

    // Gravity Freeze pauses non-boss enemy AI & movement
    if (frozen) {
      continue;
    }

    // Stunned state: vulnerable to hookshot grab, slides with friction and gravity
    if (enemy.stunTimer > 0) {
      enemy.stunTimer -= 1;
      enemy.vx *= 0.84;
      if (Math.abs(enemy.vx) < 0.05) enemy.vx = 0;
      if (arch.family !== 'flyer' && arch.family !== 'hazard') {
        enemy.vy = Math.min(MAX_FALL, enemy.vy + GRAVITY);
        moveEnemyY(state, enemy, enemy.vy);
      }
      moveEnemyX(state, enemy, enemy.vx);
      continue;
    }

    // Skip heavy AI when far off-screen
    if (distSq > ACTIVE_RANGE_PX * ACTIVE_RANGE_PX) {
      continue;
    }

    enemy.aiTimer += 1;
    const dirToPlayer: -1 | 1 = dxToPlayer >= 0 ? 1 : -1;
    const shotDmg = getProjectileDamage(state, arch.projectileTier ?? 'light');
    const fireIntervalScale = rude ? 0.78 : 1.0;

    switch (arch.family) {
      case 'trooper': {
        if (enemy.aiPhase === 0) {
          const patrolSpeed = arch.speed;
          if (Math.abs(enemy.x - enemy.homeX) > 68) {
            enemy.facing = enemy.x > enemy.homeX ? -1 : 1;
          }
          enemy.vx = enemy.facing * patrolSpeed;
          const hitWall = moveEnemyX(state, enemy, enemy.vx);
          if (hitWall || (enemy.grounded && !hasFloorAhead(state, enemy, enemy.facing))) {
            enemy.facing = enemy.facing === 1 ? -1 : 1;
          }
          const beatGate =
            arch.biomeTag !== 'wave' || state.rhythmBeat === 0 || state.rhythmBeat === 2;
          if (
            beatGate &&
            Math.abs(dxToPlayer) < 185 &&
            Math.abs(dyToPlayer) < 68 &&
            enemy.aiTimer >= Math.round(72 * fireIntervalScale)
          ) {
            enemy.facing = dirToPlayer;
            enemy.aiPhase = 1;
            enemy.aiTimer = 0;
            enemy.vx = 0;
          }
        } else if (enemy.aiPhase === 1) {
          enemy.vx = 0;
          enemy.facing = dirToPlayer;
          if (enemy.aiTimer === 10) {
            state.events.push({
              type: 'particle',
              kind: 'spark',
              x: eCx + enemy.facing * 8,
              y: eCy - 2,
              color: arch.palette[5],
              count: 3,
            });
            // Cipher Stalker performs a snappy phase-blink reposition before firing
            if (arch.id === 'cipher_stalker' && Math.abs(dxToPlayer) > 48) {
              moveEnemyX(state, enemy, enemy.facing * 20);
            }
          }
          if (enemy.aiTimer >= 24) {
            fireTrooperShot(state, enemy, arch, shotDmg, rude, cb);
            enemy.aiPhase = 0;
            enemy.aiTimer = 0;
          }
        }
        enemy.vy = Math.min(MAX_FALL, enemy.vy + GRAVITY);
        moveEnemyY(state, enemy, enemy.vy);
        break;
      }

      case 'shield_guard': {
        const approachRange = 185;
        if (enemy.aiPhase === 0) {
          if (Math.abs(dxToPlayer) < approachRange && Math.abs(dyToPlayer) < 76) {
            // Directional tracking: always turn shield toward Volt
            enemy.facing = dirToPlayer;
            const advanceSpeed = enemy.shielded ? arch.speed : arch.speed * 1.4;
            if (Math.abs(dxToPlayer) > (enemy.shielded ? 46 : 24)) {
              enemy.vx = enemy.facing * advanceSpeed;
              const hitWall = moveEnemyX(state, enemy, enemy.vx);
              if (hitWall || (enemy.grounded && !hasFloorAhead(state, enemy, enemy.facing))) {
                enemy.vx = 0;
              }
            } else {
              enemy.vx = 0;
            }
            const readyTicks = Math.round((enemy.shielded ? 88 : 56) * fireIntervalScale);
            if (enemy.aiTimer >= readyTicks) {
              enemy.aiPhase = 1;
              enemy.aiTimer = 0;
            }
          } else {
            enemy.vx = 0;
          }
        } else if (enemy.aiPhase === 1) {
          enemy.vx = 0;
          if (enemy.aiTimer === 12) {
            state.events.push({
              type: 'particle',
              kind: 'spark',
              x: eCx + enemy.facing * 10,
              y: eCy - 2,
              color: enemy.shielded ? arch.palette[4] : '#ff4d6d',
              count: 4,
            });
          }
          if (enemy.aiTimer >= 26) {
            if (enemy.shielded) {
              if (arch.id === 'orbital_sentinel') {
                // Apex sentinel: heavy lance + twin shockwaves
                cb.spawnProjectile(state, {
                  owner: 'enemy',
                  kind: 'laser_beam',
                  x: eCx + enemy.facing * 12 - 8,
                  y: eCy - 4,
                  vx: enemy.facing * 4.5,
                  vy: 0,
                  w: 16,
                  h: 8,
                  damage: shotDmg,
                  ttl: 100,
                  pierce: true,
                  bouncesLeft: 0,
                  color: '#f59e0b',
                });
                cb.spawnProjectile(state, {
                  owner: 'enemy',
                  kind: 'shockwave',
                  x: eCx + enemy.facing * 10 - 6,
                  y: enemy.y + enemy.h - 12,
                  vx: enemy.facing * 3.4,
                  vy: 0,
                  w: 12,
                  h: 12,
                  damage: shotDmg,
                  ttl: 85,
                  pierce: true,
                  bouncesLeft: 0,
                  color: '#9333ea',
                });
              } else if (arch.id === 'amp_shield_guard') {
                // Wide acoustic bass wave
                cb.spawnProjectile(state, {
                  owner: 'enemy',
                  kind: 'shockwave',
                  x: eCx + enemy.facing * 10 - 6,
                  y: eCy - 8,
                  vx: enemy.facing * 3.4,
                  vy: 0,
                  w: 12,
                  h: 16,
                  damage: shotDmg,
                  ttl: 105,
                  pierce: true,
                  bouncesLeft: 0,
                  color: '#c026d3',
                });
              } else if (arch.id === 'scrap_crusher_guard') {
                // Heavy bouncing scrap chunk
                cb.spawnProjectile(state, {
                  owner: 'enemy',
                  kind: 'enemy_shot',
                  x: eCx + enemy.facing * 10 - 4,
                  y: eCy - 4,
                  vx: enemy.facing * 3.0,
                  vy: -1.6,
                  w: 9,
                  h: 9,
                  damage: shotDmg,
                  ttl: 115,
                  pierce: false,
                  bouncesLeft: 1,
                  color: '#ea580c',
                });
              } else if (arch.id === 'heavy_enforcer') {
                for (const vy of [-0.55, 0.55]) {
                  cb.spawnProjectile(state, {
                    owner: 'enemy',
                    kind: 'enemy_shot',
                    x: eCx + enemy.facing * 10 - 3,
                    y: eCy - 3,
                    vx: enemy.facing * 3.6,
                    vy,
                    w: 7,
                    h: 7,
                    damage: shotDmg,
                    ttl: 115,
                    pierce: false,
                    bouncesLeft: 0,
                    color: '#ff3d00',
                  });
                }
              } else {
                cb.spawnProjectile(state, {
                  owner: 'enemy',
                  kind: arch.biomeTag === 'optic' ? 'laser_beam' : 'enemy_shot',
                  x: eCx + enemy.facing * 10 - 3,
                  y: eCy - 3,
                  vx: enemy.facing * 3.5,
                  vy: 0,
                  w: arch.biomeTag === 'optic' ? 12 : 7,
                  h: 6,
                  damage: shotDmg,
                  ttl: 115,
                  pierce: false,
                  bouncesLeft: 0,
                  color: arch.palette[4],
                });
              }
            } else {
              // Guard-broken exposed lunge
              enemy.vx = enemy.facing * 2.8;
              enemy.vy = -3.2;
              enemy.grounded = false;
            }
            enemy.aiPhase = 0;
            enemy.aiTimer = 0;
          }
        }
        enemy.vy = Math.min(MAX_FALL, enemy.vy + GRAVITY);
        moveEnemyY(state, enemy, enemy.vy);
        break;
      }

      case 'turret': {
        enemy.facing = dirToPlayer;
        enemy.vy = Math.min(MAX_FALL, enemy.vy + GRAVITY);
        moveEnemyY(state, enemy, enemy.vy);

        const cycle = Math.round(92 * fireIntervalScale);
        const mod = enemy.aiTimer % cycle;
        if (Math.abs(dxToPlayer) < 250 && Math.abs(dyToPlayer) < 136) {
          if (mod === cycle - 18) {
            state.events.push({
              type: 'particle',
              kind: 'spark',
              x: eCx + enemy.facing * 8,
              y: eCy - 2,
              color: arch.palette[5],
              count: 3,
            });
          } else if (
            mod === 0 ||
            ((arch.id === 'helios_turret' || arch.id === 'convoy_turret') && mod === 10)
          ) {
            const dist = Math.max(1, Math.hypot(dxToPlayer, dyToPlayer));
            const baseAngle = Math.atan2(dyToPlayer, dxToPlayer);

            if (arch.id === 'frost_turret') {
              // Twin diverging frost shards
              for (const offset of [-0.18, 0.18]) {
                const ang = baseAngle + offset;
                cb.spawnProjectile(state, {
                  owner: 'enemy',
                  kind: 'phase_ball',
                  x: eCx - 3,
                  y: eCy - 3,
                  vx: Math.cos(ang) * 3.3,
                  vy: Math.sin(ang) * 3.3,
                  w: 6,
                  h: 6,
                  damage: shotDmg,
                  ttl: 115,
                  pierce: false,
                  bouncesLeft: 0,
                  color: '#67e8f9',
                });
              }
            } else if (arch.id === 'basalt_turret') {
              // Bouncing mortar boulder
              cb.spawnProjectile(state, {
                owner: 'enemy',
                kind: 'shockwave',
                x: eCx - 5,
                y: enemy.y,
                vx: dirToPlayer * Math.min(3.8, Math.max(1.8, Math.abs(dxToPlayer) * 0.025)),
                vy: -3.6,
                w: 10,
                h: 10,
                damage: shotDmg,
                ttl: 120,
                pierce: false,
                bouncesLeft: 2,
                color: '#f97316',
              });
            } else if (arch.id === 'core_cannon') {
              // 3-way core plasma spread
              for (const offset of [-0.28, 0, 0.28]) {
                const ang = baseAngle + offset;
                cb.spawnProjectile(state, {
                  owner: 'enemy',
                  kind: 'laser_beam',
                  x: eCx - 4,
                  y: eCy - 4,
                  vx: Math.cos(ang) * 3.8,
                  vy: Math.sin(ang) * 3.8,
                  w: 8,
                  h: 8,
                  damage: shotDmg,
                  ttl: 115,
                  pierce: false,
                  bouncesLeft: 0,
                  color: '#fb7185',
                });
              }
            } else {
              const speed =
                arch.id === 'helios_turret' || arch.id === 'convoy_turret' ? 3.8 : 3.1;
              cb.spawnProjectile(state, {
                owner: 'enemy',
                kind: 'enemy_shot',
                x: eCx - 3,
                y: eCy - 3,
                vx: (dxToPlayer / dist) * speed,
                vy: (dyToPlayer / dist) * speed * 0.65,
                w: 6,
                h: 6,
                damage: shotDmg,
                ttl: 120,
                pierce: false,
                bouncesLeft: 0,
                color: arch.palette[4],
              });
            }
          }
        }
        break;
      }

      case 'hopper': {
        if (enemy.grounded) {
          enemy.vx *= 0.72;
          if (enemy.aiPhase === 0) {
            if (enemy.aiTimer >= Math.round(42 * fireIntervalScale)) {
              enemy.facing = dirToPlayer;
              enemy.aiPhase = 1;
              enemy.aiTimer = 0;
            }
          } else if (enemy.aiPhase === 1) {
            if (enemy.aiTimer >= 16) {
              enemy.vx = enemy.facing * arch.speed * 1.45;
              enemy.vy = arch.id === 'gale_hopper' ? -5.5 : -4.85;
              enemy.grounded = false;
              enemy.aiPhase = 2;
              enemy.aiTimer = 0;
              state.events.push({
                type: 'particle',
                kind: 'dust',
                x: eCx,
                y: enemy.y + enemy.h,
                color: '#cbd5e1',
                count: 3,
              });
            }
          } else {
            enemy.aiPhase = 0;
            enemy.aiTimer = 0;
          }
        } else {
          if (arch.projectileTier && enemy.aiPhase === 2 && enemy.vy >= -0.25 && enemy.vy <= 0.35) {
            enemy.aiPhase = 3;
            if (arch.id === 'slag_hopper') {
              // Drops bouncing slag mine
              cb.spawnProjectile(state, {
                owner: 'enemy',
                kind: 'shockwave',
                x: eCx - 4,
                y: eCy,
                vx: enemy.facing * 1.4,
                vy: 1.6,
                w: 8,
                h: 8,
                damage: shotDmg,
                ttl: 120,
                pierce: false,
                bouncesLeft: 2,
                color: '#f97316',
              });
            } else if (arch.id === 'gale_hopper') {
              for (const vxMul of [0.8, 1.8]) {
                cb.spawnProjectile(state, {
                  owner: 'enemy',
                  kind: 'enemy_shot',
                  x: eCx - 3,
                  y: eCy,
                  vx: enemy.facing * vxMul,
                  vy: 2.3,
                  w: 6,
                  h: 6,
                  damage: shotDmg,
                  ttl: 90,
                  pierce: false,
                  bouncesLeft: 0,
                  color: '#34d399',
                });
              }
            } else {
              cb.spawnProjectile(state, {
                owner: 'enemy',
                kind: 'enemy_shot',
                x: eCx - 3,
                y: eCy,
                vx: enemy.facing * 2.2,
                vy: 2.0,
                w: 6,
                h: 6,
                damage: shotDmg,
                ttl: 90,
                pierce: false,
                bouncesLeft: 0,
                color: arch.palette[4],
              });
            }
          }
        }
        enemy.vy = Math.min(MAX_FALL, enemy.vy + GRAVITY);
        const hitWall = moveEnemyX(state, enemy, enemy.vx);
        if (hitWall) enemy.vx = -enemy.vx * 0.5;
        moveEnemyY(state, enemy, enemy.vy);
        break;
      }

      case 'flyer': {
        const amp = arch.id === 'skyway_jet' ? 8 : 14;
        const hoverY = enemy.homeY + Math.sin(enemy.aiTimer * 0.085) * amp;
        const chaseRange = arch.id === 'citadel_interceptor' ? 250 : 205;
        const targetVx =
          Math.abs(dxToPlayer) < chaseRange
            ? dirToPlayer * arch.speed * (arch.id === 'skyway_jet' ? 1.05 : 0.85)
            : Math.cos(enemy.aiTimer * 0.03) * arch.speed;
        enemy.vx += (targetVx - enemy.vx) * 0.08;
        enemy.facing = enemy.vx >= 0 ? 1 : -1;
        const hitWall = moveEnemyX(state, enemy, enemy.vx);
        if (hitWall) enemy.vx = -enemy.vx;
        enemy.y += (hoverY - enemy.y) * 0.14;

        const shotPeriod = Math.round(98 * fireIntervalScale);
        const waveReady =
          arch.biomeTag !== 'wave' || state.rhythmBeat === 0 || state.rhythmBeat === 2;
        if (
          arch.projectileTier &&
          waveReady &&
          Math.abs(dxToPlayer) < 165 &&
          enemy.aiTimer % shotPeriod === 0
        ) {
          if (arch.id === 'tesla_drone') {
            // Twin diverging electric arcs
            for (const vxOff of [-1.2, 1.2]) {
              cb.spawnProjectile(state, {
                owner: 'enemy',
                kind: 'electric_arc',
                x: eCx - 4,
                y: enemy.y + enemy.h,
                vx: vxOff,
                vy: 2.7,
                w: 8,
                h: 8,
                damage: shotDmg,
                ttl: 95,
                pierce: false,
                bouncesLeft: 0,
                color: '#fde047',
              });
            }
          } else if (arch.id === 'pulse_drone') {
            // 3-way rhythmic synth fan
            for (const vxOff of [-1.5, 0, 1.5]) {
              cb.spawnProjectile(state, {
                owner: 'enemy',
                kind: 'phase_ball',
                x: eCx - 3,
                y: enemy.y + enemy.h,
                vx: vxOff,
                vy: 2.4,
                w: 6,
                h: 6,
                damage: shotDmg,
                ttl: 95,
                pierce: false,
                bouncesLeft: 0,
                color: '#d946ef',
              });
            }
          } else if (arch.id === 'citadel_interceptor') {
            const dist = Math.max(1, Math.hypot(dxToPlayer, dyToPlayer));
            cb.spawnProjectile(state, {
              owner: 'enemy',
              kind: 'laser_beam',
              x: eCx - 4,
              y: enemy.y + enemy.h,
              vx: (dxToPlayer / dist) * 3.8,
              vy: (dyToPlayer / dist) * 3.8,
              w: 8,
              h: 8,
              damage: shotDmg,
              ttl: 100,
              pierce: false,
              bouncesLeft: 0,
              color: '#facc15',
            });
          } else {
            cb.spawnProjectile(state, {
              owner: 'enemy',
              kind: 'enemy_shot',
              x: eCx - 3,
              y: enemy.y + enemy.h,
              vx: dirToPlayer * 1.4,
              vy: 2.6,
              w: 6,
              h: 6,
              damage: shotDmg,
              ttl: 95,
              pierce: false,
              bouncesLeft: 0,
              color: arch.palette[5],
            });
          }
        }
        break;
      }

      case 'crawler': {
        const canWallCling = arch.id !== 'quarry_driller';
        if (canWallCling && enemy.aiPhase === 1) {
          // Wall-cling vertical ascent along solid surface
          enemy.vx = 0;
          enemy.vy = -arch.speed * 0.9;
          const hitCeil = moveEnemyY(state, enemy, enemy.vy);
          const stillOnWall = hasWallAdjacent(state, enemy, enemy.facing);
          if (!stillOnWall) {
            // Reached ledge top — crest smoothly onto platform
            moveEnemyX(state, enemy, enemy.facing * 6);
            enemy.aiPhase = 0;
            enemy.aiTimer = 0;
          } else if (hitCeil || enemy.aiTimer >= 42) {
            // Reached ceiling or climb cap — peel off and reverse
            enemy.facing = enemy.facing === 1 ? -1 : 1;
            enemy.aiPhase = 0;
            enemy.aiTimer = 0;
          }
        } else {
          enemy.vx = enemy.facing * arch.speed;
          const hitWall = moveEnemyX(state, enemy, enemy.vx);
          enemy.vy = Math.min(MAX_FALL, enemy.vy + GRAVITY);
          moveEnemyY(state, enemy, enemy.vy);
          if (hitWall) {
            if (canWallCling && enemy.grounded) {
              // Latch onto vertical wall and climb
              enemy.aiPhase = 1;
              enemy.aiTimer = 0;
            } else {
              enemy.facing = enemy.facing === 1 ? -1 : 1;
            }
          } else if (enemy.grounded && !hasFloorAhead(state, enemy, enemy.facing)) {
            enemy.facing = enemy.facing === 1 ? -1 : 1;
          }
        }

        // Matrix Wireframe Spider fires periodic cyber darts while patrolling/clinging
        if (
          arch.id === 'matrix_crawler' &&
          arch.projectileTier &&
          Math.abs(dxToPlayer) < 180 &&
          enemy.aiTimer % Math.round(88 * fireIntervalScale) === 0
        ) {
          const dist = Math.max(1, Math.hypot(dxToPlayer, dyToPlayer));
          cb.spawnProjectile(state, {
            owner: 'enemy',
            kind: 'phase_ball',
            x: eCx - 3,
            y: eCy - 3,
            vx: (dxToPlayer / dist) * 3.1,
            vy: (dyToPlayer / dist) * 3.1,
            w: 6,
            h: 6,
            damage: shotDmg,
            ttl: 95,
            pierce: false,
            bouncesLeft: 1,
            color: '#14b8a6',
          });
        }
        break;
      }

      case 'spawner': {
        enemy.vy = Math.min(MAX_FALL, enemy.vy + GRAVITY);
        moveEnemyY(state, enemy, enemy.vy);
        const spawnCycle = rude ? 135 : 175;
        if (Math.abs(dxToPlayer) < 290 && enemy.aiTimer % spawnCycle === 0) {
          let activeCount = 0;
          for (let j = 0; j < state.enemies.length; j++) {
            if (!state.enemies[j].dead) activeCount++;
          }
          if (activeCount < 14) {
            const summonId =
              arch.id === 'reactor_spawner'
                ? 'citadel_interceptor'
                : arch.id === 'shale_spawner'
                  ? enemy.aiTimer % (spawnCycle * 2) === 0
                    ? 'quarry_driller'
                    : 'metro_drone'
                  : 'mirage_wing';
            spawnEnemyFromArchetype(
              state,
              summonId,
              enemy.x + 2,
              enemy.y - 16,
              `${enemy.spawnId}_sub_${enemy.aiTimer}`,
            );
            state.events.push(
              { type: 'sfx', key: 'switch', gain: 0.7 },
              {
                type: 'particle',
                kind: 'burst',
                x: eCx,
                y: enemy.y,
                color: arch.palette[4],
                count: 6,
              },
            );

            // Reactor Hive emits defensive 4-way spark pulse on summon
            if (arch.id === 'reactor_spawner') {
              for (const [vx, vy] of [
                [-2.6, -1.2],
                [2.6, -1.2],
                [-2.2, 1.0],
                [2.2, 1.0],
              ]) {
                cb.spawnProjectile(state, {
                  owner: 'enemy',
                  kind: 'electric_arc',
                  x: eCx - 3,
                  y: eCy - 3,
                  vx,
                  vy,
                  w: 7,
                  h: 7,
                  damage: shotDmg,
                  ttl: 80,
                  pierce: false,
                  bouncesLeft: 0,
                  color: '#f43f5e',
                });
              }
            }
          }
        }
        break;
      }

      case 'hazard': {
        if (arch.id === 'coil_hazard') {
          // Circular high-voltage patrol + periodic spark bolt
          const angle = enemy.aiTimer * 0.055 * arch.speed;
          enemy.x = enemy.homeX + Math.cos(angle) * 28;
          enemy.y = enemy.homeY + Math.sin(angle) * 24;
          if (
            arch.projectileTier &&
            Math.abs(dxToPlayer) < 160 &&
            enemy.aiTimer % Math.round(105 * fireIntervalScale) === 0
          ) {
            cb.spawnProjectile(state, {
              owner: 'enemy',
              kind: 'electric_arc',
              x: eCx - 4,
              y: eCy - 4,
              vx: dirToPlayer * 3.0,
              vy: 0,
              w: 8,
              h: 8,
              damage: shotDmg,
              ttl: 85,
              pierce: false,
              bouncesLeft: 0,
              color: '#facc15',
            });
          }
        } else if (arch.id === 'glitch_hazard') {
          // Crisp diamond-loop matrix anomaly
          const phase = (enemy.aiTimer * 0.025 * arch.speed) % 4;
          const r = 34;
          let ox = 0;
          let oy = 0;
          if (phase < 1) {
            ox = phase * r;
            oy = -(1 - phase) * r * 0.6;
          } else if (phase < 2) {
            const t = phase - 1;
            ox = (1 - t) * r;
            oy = t * r * 0.6;
          } else if (phase < 3) {
            const t = phase - 2;
            ox = -t * r;
            oy = (1 - t) * r * 0.6;
          } else {
            const t = phase - 3;
            ox = -(1 - t) * r;
            oy = -t * r * 0.6;
          }
          enemy.x = enemy.homeX + ox;
          enemy.y = enemy.homeY + oy;
        } else {
          // Solar Spark figure-8 pendulum patrol
          const radiusX = 36;
          const radiusY = 14;
          const angle = enemy.aiTimer * 0.055 * arch.speed;
          enemy.x = enemy.homeX + Math.sin(angle) * radiusX;
          enemy.y = enemy.homeY + Math.cos(angle * 2) * radiusY;
        }
        break;
      }
    }

    // Contact collision with player
    if (
      player.invulnTimer <= 0 &&
      player.action !== 'dead' &&
      player.action !== 'warp' &&
      aabbOverlap(player.x, player.y, player.w, player.h, enemy.x, enemy.y, enemy.w, enemy.h)
    ) {
      const dmg = getContactDamage(state, arch.contactTier);
      cb.damagePlayer(state, dmg, enemy.x + enemy.w * 0.5);
      // Cryo biome enemies chill Volt's horizontal momentum on contact
      if (arch.biomeTag === 'cooler') {
        player.vx *= 0.45;
        state.events.push({
          type: 'particle',
          kind: 'shard',
          x: player.x + player.w * 0.5,
          y: player.y + player.h * 0.5,
          color: '#67e8f9',
          count: 6,
        });
      }
    }
  }
}
