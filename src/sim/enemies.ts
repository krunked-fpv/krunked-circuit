import {
  DAMAGE_TABLES,
  ECONOMY_CONSTANTS,
  ENGINE_CONSTANTS,
  TileType,
  type EnemyEntity,
  type PickupEntity,
  type ProjectileEntity,
  type SimState,
} from '../contracts/index';
import { getEnemyArchetype } from '../data/index';

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
const ACTIVE_RANGE_PX = 460;

function nextRng(state: SimState): number {
  state.rngState = (state.rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(state.rngState ^ (state.rngState >>> 15), 1 | state.rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

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
  if (dx === 0) return false;
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
  const armorBonus = state.progression.loadouts[state.progression.activeLoadoutIndex].armorPaint === 2 ? 3 : 0;
  remaining += armorBonus;

  while (remaining > 0) {
    let kind: PickupEntity['kind'] = 'bit_1';
    let value = 1;
    if (remaining >= 10) {
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
  const rudeBonus = state.progression.modifiers.rudeEnemies && arch.family !== 'dummy' && arch.family !== 'hazard' ? 1 : 0;
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

export function updateEnemies(state: SimState, cb: EnemySimCallbacks): void {
  const player = state.player;
  const pCx = player.x + player.w * 0.5;
  const pCy = player.y + player.h * 0.5;
  const frozen = player.freezeFieldTimer > 0;
  const rude = state.progression.modifiers.rudeEnemies;

  for (let i = 0; i < state.enemies.length; i++) {
    const enemy = state.enemies[i];
    if (enemy.dead || enemy.grabbed) continue;

    const arch = getEnemyArchetype(enemy.archetypeId);
    if (!arch) continue;

    if (enemy.hurtFlash > 0) {
      enemy.hurtFlash -= 1;
    }

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
          // Patrol around homeX
          const patrolSpeed = arch.speed;
          if (Math.abs(enemy.x - enemy.homeX) > 64) {
            enemy.facing = enemy.x > enemy.homeX ? -1 : 1;
          }
          enemy.vx = enemy.facing * patrolSpeed;
          const hitWall = moveEnemyX(state, enemy, enemy.vx);
          if (hitWall || (enemy.grounded && !hasFloorAhead(state, enemy, enemy.facing))) {
            enemy.facing = enemy.facing === 1 ? -1 : 1;
          }
          if (Math.abs(dxToPlayer) < 175 && Math.abs(dyToPlayer) < 64 && enemy.aiTimer >= Math.round(75 * fireIntervalScale)) {
            enemy.facing = dirToPlayer;
            enemy.aiPhase = 1;
            enemy.aiTimer = 0;
            enemy.vx = 0;
          }
        } else if (enemy.aiPhase === 1) {
          // Telegraph stance (22 ticks) then fire
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
          }
          if (enemy.aiTimer >= 24) {
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
            if (rude) {
              cb.spawnProjectile(state, {
                owner: 'enemy',
                kind: 'enemy_shot',
                x: eCx + enemy.facing * 9 - 3,
                y: eCy - 3,
                vx: enemy.facing * 2.5,
                vy: -0.7,
                w: 6,
                h: 6,
                damage: shotDmg,
                ttl: 110,
                pierce: false,
                bouncesLeft: 0,
                color: arch.palette[4],
              });
            }
            enemy.aiPhase = 0;
            enemy.aiTimer = 0;
          }
        }
        enemy.vy = Math.min(MAX_FALL, enemy.vy + GRAVITY);
        moveEnemyY(state, enemy, enemy.vy);
        break;
      }

      case 'shield_guard': {
        // Always turns shield toward player when idle/advancing
        const approachRange = 175;
        if (enemy.aiPhase === 0) {
          if (Math.abs(dxToPlayer) < approachRange && Math.abs(dyToPlayer) < 72) {
            enemy.facing = dirToPlayer;
            if (Math.abs(dxToPlayer) > 46) {
              enemy.vx = enemy.facing * arch.speed;
              const hitWall = moveEnemyX(state, enemy, enemy.vx);
              if (hitWall || (enemy.grounded && !hasFloorAhead(state, enemy, enemy.facing))) {
                enemy.vx = 0;
              }
            } else {
              enemy.vx = 0;
            }
            if (enemy.aiTimer >= Math.round(92 * fireIntervalScale)) {
              enemy.aiPhase = 1;
              enemy.aiTimer = 0;
            }
          } else {
            enemy.vx = 0;
          }
        } else if (enemy.aiPhase === 1) {
          // Telegraph 28t -> fire shield pulse shot (or lunge if shield broken)
          enemy.vx = 0;
          if (enemy.aiTimer === 14) {
            state.events.push({
              type: 'particle',
              kind: 'spark',
              x: eCx + enemy.facing * 10,
              y: eCy - 2,
              color: arch.palette[4],
              count: 4,
            });
          }
          if (enemy.aiTimer >= 28) {
            if (enemy.shielded) {
              cb.spawnProjectile(state, {
                owner: 'enemy',
                kind: 'enemy_shot',
                x: eCx + enemy.facing * 10 - 3,
                y: eCy - 3,
                vx: enemy.facing * 3.4,
                vy: 0,
                w: 7,
                h: 6,
                damage: shotDmg,
                ttl: 115,
                pierce: false,
                bouncesLeft: 0,
                color: arch.palette[4],
              });
            } else {
              // Unshielded guard attempts a short desperate hop lunge
              enemy.vx = enemy.facing * 2.4;
              enemy.vy = -3.0;
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

        const cycle = Math.round(96 * fireIntervalScale);
        const mod = enemy.aiTimer % cycle;
        if (Math.abs(dxToPlayer) < 240 && Math.abs(dyToPlayer) < 130) {
          if (mod === cycle - 18) {
            state.events.push({
              type: 'particle',
              kind: 'spark',
              x: eCx + enemy.facing * 8,
              y: eCy - 2,
              color: arch.palette[5],
              count: 3,
            });
          } else if (mod === 0 || (arch.id === 'helios_turret' && mod === 10)) {
            const dist = Math.max(1, Math.hypot(dxToPlayer, dyToPlayer));
            const speed = arch.id === 'helios_turret' ? 3.8 : 3.1;
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
        break;
      }

      case 'hopper': {
        if (enemy.grounded) {
          enemy.vx *= 0.72;
          if (enemy.aiPhase === 0) {
            if (enemy.aiTimer >= Math.round(44 * fireIntervalScale)) {
              enemy.facing = dirToPlayer;
              enemy.aiPhase = 1;
              enemy.aiTimer = 0;
            }
          } else if (enemy.aiPhase === 1) {
            // Telegraph crouch for 16t then spring toward player
            if (enemy.aiTimer >= 16) {
              enemy.vx = enemy.facing * arch.speed * 1.45;
              enemy.vy = -4.85;
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
          // Apex shot for dune_hopper
          if (arch.projectileTier && enemy.aiPhase === 2 && enemy.vy >= -0.2 && enemy.vy <= 0.3) {
            enemy.aiPhase = 3;
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
        enemy.vy = Math.min(MAX_FALL, enemy.vy + GRAVITY);
        const hitWall = moveEnemyX(state, enemy, enemy.vx);
        if (hitWall) enemy.vx = -enemy.vx * 0.5;
        moveEnemyY(state, enemy, enemy.vy);
        break;
      }

      case 'flyer': {
        const hoverY = enemy.homeY + Math.sin(enemy.aiTimer * 0.085) * 14;
        const targetVx =
          Math.abs(dxToPlayer) < 200
            ? dirToPlayer * arch.speed * 0.85
            : Math.cos(enemy.aiTimer * 0.03) * arch.speed;
        enemy.vx += (targetVx - enemy.vx) * 0.08;
        enemy.facing = enemy.vx >= 0 ? 1 : -1;
        const hitWall = moveEnemyX(state, enemy, enemy.vx);
        if (hitWall) enemy.vx = -enemy.vx;
        enemy.y += (hoverY - enemy.y) * 0.14;

        const shotPeriod = Math.round(105 * fireIntervalScale);
        if (arch.projectileTier && Math.abs(dxToPlayer) < 150 && enemy.aiTimer % shotPeriod === 0) {
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
        break;
      }

      case 'crawler': {
        enemy.vx = enemy.facing * arch.speed;
        const hitWall = moveEnemyX(state, enemy, enemy.vx);
        enemy.vy = Math.min(MAX_FALL, enemy.vy + GRAVITY);
        moveEnemyY(state, enemy, enemy.vy);
        if (hitWall || (enemy.grounded && !hasFloorAhead(state, enemy, enemy.facing))) {
          enemy.facing = enemy.facing === 1 ? -1 : 1;
        }
        break;
      }

      case 'spawner': {
        enemy.vy = Math.min(MAX_FALL, enemy.vy + GRAVITY);
        moveEnemyY(state, enemy, enemy.vy);
        const spawnCycle = rude ? 140 : 185;
        if (Math.abs(dxToPlayer) < 280 && enemy.aiTimer % spawnCycle === 0) {
          let activeCount = 0;
          for (let j = 0; j < state.enemies.length; j++) {
            if (!state.enemies[j].dead) activeCount++;
          }
          if (activeCount < 14) {
            spawnEnemyFromArchetype(
              state,
              'metro_drone',
              enemy.x + 2,
              enemy.y - 16,
              `${enemy.spawnId}_drone_${enemy.aiTimer}`,
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
          }
        }
        break;
      }

      case 'hazard': {
        // Predictable solar plasma pendulum patrol around homeX/homeY
        const radiusX = 36;
        const radiusY = 14;
        const angle = enemy.aiTimer * 0.055 * arch.speed;
        enemy.x = enemy.homeX + Math.sin(angle) * radiusX;
        enemy.y = enemy.homeY + Math.cos(angle * 2) * radiusY;
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
    }
  }
}
