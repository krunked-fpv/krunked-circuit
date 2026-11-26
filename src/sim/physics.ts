import {
  ENGINE_CONSTANTS,
  PLAYER_PHYSICS,
  TileType,
  type InputFrame,
  type PlayerState,
  type SimState,
} from '../contracts/index';
import {
  aabbOverlap,
  canStandUpAt,
  detectLedgeGrab,
  detectWallContact,
  getTileAt,
  isOneWayTile,
  isSolidTile,
  moveAndCollideX,
  moveAndCollideY,
  type Aabb,
} from './collision';
import {
  applyHazardDamage,
  damageBoss,
  damageEnemy,
  getActiveArmorPaint,
  hasChip,
  resetDiveBounceStreak,
  spawnProjectile,
  type CombatHooks,
} from './combat';
import { evaluateChallenges } from './progression';

// ============================================================================
// Pure 60 Hz Player Physics, Ledge/Wall Tech, Armor Movement, Scarf & Cell Camera
// ============================================================================

const TS = ENGINE_CONSTANTS.TILE_SIZE;
const CELL_W = ENGINE_CONSTANTS.CELL_TILES_W * TS; // 400
const CELL_H = ENGINE_CONSTANTS.CELL_TILES_H * TS; // 240

// Pure per-PlayerState Cryo Glide air-slide state (isolated per SimState, deterministic)
const cryoAirSlideUsedMap = new WeakMap<PlayerState, boolean>();
const cryoAirSlideActiveMap = new WeakMap<PlayerState, boolean>();

function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) {
    return Math.min(target, current + maxDelta);
  }
  if (current > target) {
    return Math.max(target, current - maxDelta);
  }
  return target;
}

function isStandingOnOneWayOnly(state: SimState): boolean {
  const p = state.player;
  const footY = p.y + p.h + 1;
  const ty = Math.floor(footY / TS);
  const left = Math.floor((p.x + 0.5) / TS);
  const right = Math.floor((p.x + p.w - 0.5) / TS);

  let foundOneWay = false;
  for (let tx = left; tx <= right; tx++) {
    const tile = getTileAt(state, tx, ty);
    if (isSolidTile(state, tile, tx, ty)) {
      return false;
    }
    if (isOneWayTile(tile)) {
      foundOneWay = true;
    }
  }
  if (foundOneWay) {
    return true;
  }

  // Also check solid support_platform projectiles
  for (let i = 0; i < state.projectiles.length; i++) {
    const proj = state.projectiles[i];
    if (!proj.solid || proj.ttl <= 0) {
      continue;
    }
    if (
      p.x + p.w > proj.x &&
      p.x < proj.x + proj.w &&
      Math.abs(p.y + p.h - proj.y) <= 2.5
    ) {
      return true;
    }
  }

  return false;
}

function isSafeFloorUnderPlayer(state: SimState): boolean {
  const p = state.player;
  if (!p.grounded || p.h !== PLAYER_PHYSICS.STAND_H) {
    return false;
  }
  const footRow = Math.floor((p.y + p.h + 1) / TS);
  const leftTx = Math.floor((p.x + 1) / TS);
  const rightTx = Math.floor((p.x + p.w - 1) / TS);

  for (let tx = leftTx; tx <= rightTx; tx++) {
    const tile = getTileAt(state, tx, footRow);
    const ok =
      (isSolidTile(state, tile, tx, footRow) || isOneWayTile(tile)) &&
      tile !== TileType.ELECTRIC_RAIL &&
      tile !== TileType.SPIKE &&
      tile !== TileType.BOUNCE_PAD &&
      tile !== TileType.CRUSHER &&
      tile !== TileType.BREAKABLE;
    if (!ok) {
      return false;
    }
  }
  return true;
}

function enterCrouchCollider(state: SimState): void {
  const p = state.player;
  if (p.h !== PLAYER_PHYSICS.SLIDE_H) {
    p.y += p.h - PLAYER_PHYSICS.SLIDE_H;
    p.w = PLAYER_PHYSICS.SLIDE_W;
    p.h = PLAYER_PHYSICS.SLIDE_H;
  }
  p.crouching = true;
}

function tryStandUp(state: SimState): boolean {
  const p = state.player;
  if (p.h === PLAYER_PHYSICS.STAND_H) {
    p.crouching = false;
    p.sliding = false;
    cryoAirSlideActiveMap.delete(p);
    return true;
  }
  const standTopY = p.y + p.h - PLAYER_PHYSICS.STAND_H;
  if (canStandUpAt(state, p.x, standTopY)) {
    p.y = standTopY;
    p.w = PLAYER_PHYSICS.STAND_W;
    p.h = PLAYER_PHYSICS.STAND_H;
    p.crouching = false;
    p.sliding = false;
    cryoAirSlideActiveMap.delete(p);
    return true;
  }
  // Ceiling-wedge safety: remain safely crouched until full 14x28 clearance exists
  p.crouching = true;
  p.sliding = false;
  cryoAirSlideActiveMap.delete(p);
  return false;
}

export function getMaxHorizontalSpeed(state: SimState, sprinting: boolean): number {
  const p = state.player;
  const armor = getActiveArmorPaint(state);
  let base: number;
  if (p.overloadTimer > 0) {
    base = sprinting
      ? PLAYER_PHYSICS.OVERLOAD_SPRINT_SPEED
      : PLAYER_PHYSICS.OVERLOAD_WALK_SPEED;
  } else {
    base = sprinting
      ? PLAYER_PHYSICS.SPRINT_MAX_SPEED
      : PLAYER_PHYSICS.WALK_MAX_SPEED;
  }
  if (armor === 5 || armor === 11) {
    // Aero Teal (5) & Apex Prismatic (11): +0.50 px/tick horizontal speed
    base += PLAYER_PHYSICS.SPEED_ARMOR_BONUS;
  }
  return base;
}

export function updatePhysics(
  state: SimState,
  input: InputFrame,
  hooks?: CombatHooks,
): void {
  const p = state.player;
  if (p.action === 'dead' || p.action === 'victory' || p.warpTimer > 0) {
    return;
  }

  // Hookshot zip & pendulum swing own player locomotion while active
  if (p.hook.phase === 'latched_wall' || p.hook.phase === 'swinging') {
    if (p.hook.phase === 'swinging' && p.hook.timer >= 5) {
      evaluateChallenges(state);
    }
    return;
  }

  // Mirror World modifier cleanly flips horizontal steering & environmental forces
  const mirrored = state.progression.modifiers.mirrorWorld;
  const moveX = (mirrored ? -input.moveX : input.moveX) as -1 | 0 | 1;

  // Buffer jump press
  if (input.jumpPressed) {
    p.jumpBufferTick = state.tick;
  }

  // ---------------- LEDGE HANG STATE ----------------
  if (p.onLedge !== 0) {
    p.vx = 0;
    p.vy = 0;
    p.grounded = false;
    p.onWall = 0;
    cryoAirSlideUsedMap.delete(p);
    cryoAirSlideActiveMap.delete(p);
    resetDiveBounceStreak(p);

    if (input.moveY === -1 || input.jumpPressed) {
      // Climb up cleanly onto ledge top
      const climbX = p.x + p.onLedge * 8;
      const climbY = p.y - PLAYER_PHYSICS.STAND_H + 2;
      if (canStandUpAt(state, climbX, climbY)) {
        p.x = climbX;
        p.y = climbY;
        p.vy = -1.5;
      } else {
        p.vy = PLAYER_PHYSICS.WALL_JUMP_IMPULSE_Y;
        p.vx = p.onLedge * 2.0;
      }
      p.onLedge = 0;
      p.ledgeTimer = 10;
      p.jumpBufferTick = -999;
      p.airJumpsUsed = 0;
      state.events.push({ type: 'sfx', key: 'jump' });
    } else if (input.moveY === 1) {
      // Drop down from ledge
      p.onLedge = 0;
      p.ledgeTimer = 14;
      p.vy = 1.0;
    }
    return;
  }

  const armor = getActiveArmorPaint(state);
  const inHurtKnockback = p.hurtTimer > 0;
  let dropThroughOneWay = false;
  const inCryoAirSlide = Boolean(cryoAirSlideActiveMap.get(p));

  // ---------------- CROUCH / SLIDE / CRYO AIR-SLIDE / ONE-WAY DROP ----------------
  if (!inHurtKnockback) {
    if (p.grounded) {
      cryoAirSlideUsedMap.delete(p);
      const wantsOneWayDrop =
        input.moveY === 1 && input.jumpPressed && isStandingOnOneWayOnly(state);

      if (wantsOneWayDrop) {
        dropThroughOneWay = true;
        p.jumpBufferTick = -999;
        p.grounded = false;
        p.leftGroundTick = -999;
        p.y += 2;
        p.vy = 1.0;
        tryStandUp(state);
      } else if (
        (input.slidePressed ||
          (input.moveY === 1 && input.jumpPressed && !isStandingOnOneWayOnly(state))) &&
        !p.sliding &&
        p.slideCooldown <= 0
      ) {
        // Start ground slide (14x14 collider)
        enterCrouchCollider(state);
        p.sliding = true;
        cryoAirSlideActiveMap.delete(p);
        p.slideTimer = PLAYER_PHYSICS.SLIDE_DURATION_TICKS;
        p.jumpBufferTick = -999;
        if (moveX !== 0) {
          p.facing = moveX;
        }
        const slideSpeed =
          PLAYER_PHYSICS.SLIDE_SPEED +
          (armor === 5 || armor === 11 ? PLAYER_PHYSICS.SPEED_ARMOR_BONUS : 0) +
          (p.overloadTimer > 0 ? 0.75 : 0);
        p.vx = p.facing * slideSpeed;
        state.events.push({ type: 'sfx', key: 'slide' });
        state.events.push({
          type: 'particle',
          kind: 'dust',
          x: p.x + p.w * 0.5,
          y: p.y + p.h,
          color: '#cbd5e1',
          count: 5,
        });

        // Armor Paint 8 (Phase Violet): Ground Slide fires a piercing phase_ball warp orb forward!
        if (armor === 8) {
          spawnProjectile(state, {
            owner: 'player',
            kind: 'phase_ball',
            x: p.x + (p.facing === 1 ? p.w : -12),
            y: p.y + 1,
            vx: p.facing * 6.4,
            vy: 0,
            w: 12,
            h: 12,
            damage: 2,
            ttl: 40,
            pierce: true,
            bouncesLeft: 0,
            color: '#8b5cf6',
          });
          state.events.push({
            type: 'particle',
            kind: 'spark',
            x: p.x + (p.facing === 1 ? p.w : 0),
            y: p.y + p.h * 0.5,
            color: '#8b5cf6',
            count: 7,
          });
        }
      }
    } else if (
      // Armor Paint 3 (Cryo Glide): airborne Slide executes a horizontal Cryo Air-Slide burst (once per jump)
      armor === 3 &&
      input.slidePressed &&
      !p.sliding &&
      p.slideCooldown <= 0 &&
      !cryoAirSlideUsedMap.get(p)
    ) {
      cryoAirSlideUsedMap.set(p, true);
      cryoAirSlideActiveMap.set(p, true);
      enterCrouchCollider(state);
      p.sliding = true;
      p.slideTimer = 14;
      if (moveX !== 0) {
        p.facing = moveX;
      }
      const airSlideSpeed =
        PLAYER_PHYSICS.SLIDE_SPEED + 0.75 + (p.overloadTimer > 0 ? 0.75 : 0);
      p.vx = p.facing * airSlideSpeed;
      p.vy = 0;
      state.events.push(
        { type: 'sfx', key: 'slide', pitchJitter: 0.14 },
        {
          type: 'particle',
          kind: 'spark',
          x: p.x + p.w * 0.5,
          y: p.y + p.h * 0.5,
          color: '#38bdf8',
          count: 8,
        },
      );
    }

    const currentlyCryoAirSliding = Boolean(cryoAirSlideActiveMap.get(p));
    if (p.sliding) {
      p.slideTimer -= 1;
      const hitOpposite = moveX !== 0 && moveX === -p.facing;
      const shouldEnd = currentlyCryoAirSliding
        ? p.slideTimer <= 0 || hitOpposite || p.grounded
        : p.slideTimer <= 0 || hitOpposite || !p.grounded;

      if (shouldEnd) {
        p.sliding = false;
        cryoAirSlideActiveMap.delete(p);
        p.slideCooldown = PLAYER_PHYSICS.SLIDE_COOLDOWN_TICKS;
        tryStandUp(state);
      } else if (currentlyCryoAirSliding) {
        const airSlideSpeed =
          PLAYER_PHYSICS.SLIDE_SPEED + 0.75 + (p.overloadTimer > 0 ? 0.75 : 0);
        p.vx = p.facing * airSlideSpeed;
        p.vy = 0;
        if (p.slideTimer % 3 === 0) {
          state.events.push({
            type: 'particle',
            kind: 'spark',
            x: p.x + p.w * 0.5,
            y: p.y + p.h * 0.5,
            color: '#a5f3fc',
            count: 3,
          });
        }
      } else {
        const slideSpeed =
          PLAYER_PHYSICS.SLIDE_SPEED +
          (armor === 5 || armor === 11 ? PLAYER_PHYSICS.SPEED_ARMOR_BONUS : 0) +
          (p.overloadTimer > 0 ? 0.75 : 0);
        p.vx = p.facing * slideSpeed;
        evaluateChallenges(state);
      }
    } else if (p.grounded && input.moveY === 1) {
      enterCrouchCollider(state);
    } else if (p.crouching) {
      // Continuously check ceiling-wedge safety until full 14x28 clearance exists
      tryStandUp(state);
    }
  } else if (inCryoAirSlide) {
    cryoAirSlideActiveMap.delete(p);
  }

  // ---------------- HORIZONTAL VELOCITY ----------------
  if (!inHurtKnockback && !p.sliding) {
    const canSteer = p.wallJumpLockTimer <= 0;
    const isDiving = p.attackId === 'diveKick' || p.attackId === 'diveKickHeavy';

    if (canSteer && !isDiving) {
      if (moveX !== 0 && p.attackTimer <= 0) {
        p.facing = moveX;
      }

      const maxSpeed = p.crouching
        ? 1.6
        : getMaxHorizontalSpeed(state, input.sprint);
      const targetVx = moveX * maxSpeed;

      let accel: number;
      if (p.grounded) {
        const onSlipperyIce = p.onIce && armor !== 3; // Cryo Glide (3) grants full ice traction
        if (onSlipperyIce) {
          accel = PLAYER_PHYSICS.ICE_FRICTION;
        } else if (armor === 5 && moveX === 0 && Math.abs(p.vx) > 0.1) {
          // Aero Teal (5): low-friction momentum skate when coasting
          accel = 0.16;
        } else if (moveX !== 0 && Math.sign(p.vx) !== 0 && Math.sign(p.vx) !== moveX) {
          accel = PLAYER_PHYSICS.RUNNING_FRICTION_TURN;
        } else {
          accel = PLAYER_PHYSICS.RUNNING_FRICTION;
        }
      } else {
        accel = moveX !== 0 ? (armor === 8 ? 0.45 : 0.35) : 0.08;
      }

      p.vx = approach(p.vx, targetVx, accel);
    }
  }

  // Apply environmental wind gently when not actively braced against ground
  const effWindForce = mirrored ? -state.windForce : state.windForce;
  let windVx = 0;
  if (effWindForce !== 0) {
    windVx = p.grounded ? effWindForce * 0.35 : effWindForce * 0.65;
  }

  // ---------------- JUMP, COYOTE, WALL-JUMP, AIR-JUMPER ----------------
  const hasBufferedJump =
    p.jumpBufferTick >= 0 &&
    state.tick - p.jumpBufferTick <= PLAYER_PHYSICS.JUMP_BUFFER_TICKS;

  const withinCoyote =
    p.grounded ||
    (p.leftGroundTick >= 0 &&
      state.tick - p.leftGroundTick <= PLAYER_PHYSICS.COYOTE_TICKS);

  const leewayWall = !p.grounded
    ? detectWallContact(state, p, PLAYER_PHYSICS.WALL_JUMP_LEEWAY)
    : 0;
  const wallBufferWindow =
    PLAYER_PHYSICS.WALL_JUMP_BUFFER_MAX +
    (p.wallJumpDir !== 0 && moveX === p.wallJumpDir
      ? PLAYER_PHYSICS.WALL_JUMP_STEER_AWAY_BONUS
      : 0);
  const withinWallBuffer =
    !p.grounded &&
    p.wallJumpDir !== 0 &&
    p.wallJumpBufferTick >= 0 &&
    state.tick - p.wallJumpBufferTick <= wallBufferWindow;

  if (!inHurtKnockback && hasBufferedJump) {
    if (withinCoyote && !dropThroughOneWay) {
      // Only jump if full standing clearance exists (never wedge into ceiling)
      if (!p.crouching || tryStandUp(state)) {
        p.vy = PLAYER_PHYSICS.JUMP_IMPULSE;
        p.grounded = false;
        p.sliding = false;
        cryoAirSlideActiveMap.delete(p);
        p.leftGroundTick = -999;
        p.jumpBufferTick = -999;
        p.airJumpsUsed = 0;
        p.onWall = 0;
        state.events.push({ type: 'sfx', key: 'jump' });
        state.events.push({
          type: 'particle',
          kind: 'dust',
          x: p.x + p.w * 0.5,
          y: p.y + p.h,
          color: '#e2e8f0',
          count: 5,
        });
      }
    } else if (p.onWall !== 0 || leewayWall !== 0 || withinWallBuffer) {
      const wallSide = p.onWall !== 0 ? p.onWall : leewayWall;
      const jumpDir: -1 | 1 =
        wallSide !== 0
          ? ((-wallSide) as -1 | 1)
          : p.wallJumpDir !== 0
            ? p.wallJumpDir
            : ((-p.facing) as -1 | 1);
      p.vy = PLAYER_PHYSICS.WALL_JUMP_IMPULSE_Y;
      p.vx = jumpDir * (PLAYER_PHYSICS.WALL_JUMP_IMPULSE_X + (input.sprint ? 0.5 : 0));
      p.facing = jumpDir;
      p.wallJumpLockTimer = Math.min(8, PLAYER_PHYSICS.WALL_JUMP_MAX_TIME);
      p.wallJumpBufferTick = -999;
      p.jumpBufferTick = -999;
      p.onWall = 0;
      p.airJumpsUsed = 0;
      p.diveKickTicks = 0;
      cryoAirSlideUsedMap.delete(p);
      cryoAirSlideActiveMap.delete(p);
      state.events.push({ type: 'sfx', key: 'wall_jump' });
      state.events.push({
        type: 'particle',
        kind: 'spark',
        x: jumpDir === 1 ? p.x : p.x + p.w,
        y: p.y + p.h * 0.5,
        color: '#38bdf8',
        count: 6,
      });
    } else if (input.jumpPressed && hasChip(state, 2)) {
      // Air Jumper chip (ID 2) — double jump (-4.25), plus triple jump (-3.25) during Overload
      const maxAirJumps = p.overloadTimer > 0 ? 2 : 1;
      if (p.airJumpsUsed < maxAirJumps) {
        p.airJumpsUsed += 1;
        p.vy =
          p.airJumpsUsed === 1
            ? PLAYER_PHYSICS.DOUBLE_JUMP_IMPULSE
            : PLAYER_PHYSICS.TRIPLE_JUMP_IMPULSE;
        p.jumpBufferTick = -999;
        p.diveKickTicks = 0;
        cryoAirSlideActiveMap.delete(p);
        if (p.attackId === 'diveKick' || p.attackId === 'diveKickHeavy') {
          p.attackId = null;
          p.attackTimer = 0;
        }
        state.events.push({ type: 'sfx', key: 'double_jump' });
        state.events.push({
          type: 'particle',
          kind: 'shockring',
          x: p.x + p.w * 0.5,
          y: p.y + p.h,
          color: '#38bdf8',
          count: 7,
        });
      }
    }
  }

  // Variable jump height damping on release
  if (input.jumpReleased && p.vy < -1.0) {
    p.vy *= PLAYER_PHYSICS.JUMP_RELEASE_DAMP;
  }

  // ---------------- GRAVITY, LIGHT ALLOY, FAST-FALL ----------------
  const activeCryoGlide = Boolean(cryoAirSlideActiveMap.get(p)) && p.sliding;
  if (!activeCryoGlide) {
    let grav: number = PLAYER_PHYSICS.GRAVITY;
    const isLightAlloyFloating =
      !p.grounded && hasChip(state, 11) && input.jump && p.vy >= -1.5;
    if (isLightAlloyFloating) {
      grav *= 0.55; // Light Alloy (Chip 11) low-grav hold-jump float
    }
    p.vy += grav;

    if (!p.grounded && input.moveY === 1 && p.vy >= PLAYER_PHYSICS.FAST_FALL_VY_THRESHOLD) {
      p.vy += PLAYER_PHYSICS.FAST_FALL_ACCEL;
    }

    let maxFall =
      PLAYER_PHYSICS.MAX_FALL_SPEED +
      (armor === 7 ? PLAYER_PHYSICS.HEAVY_ARMOR_FALL_BONUS : 0); // Quake Amber: 8.75
    if (isLightAlloyFloating && input.moveY !== 1) {
      maxFall = Math.min(maxFall, 2.2);
    }
    if (p.vy > maxFall) {
      p.vy = maxFall;
    }
  }

  // ---------------- MOVE & COLLIDE X ----------------
  const wasGrounded = p.grounded;
  const prevBottom = p.y + p.h;
  const impactVy = p.vy;

  const resX = moveAndCollideX(state, p, p.vx + windVx);
  p.x = resX.x;
  if (resX.hitX) {
    p.vx = 0;
    if (p.sliding) {
      p.sliding = false;
      cryoAirSlideActiveMap.delete(p);
      p.slideCooldown = PLAYER_PHYSICS.SLIDE_COOLDOWN_TICKS;
      tryStandUp(state);
    }
  }

  // ---------------- MOVE & COLLIDE Y ----------------
  const resY = moveAndCollideY(state, p, p.vy, dropThroughOneWay);
  p.y = resY.y;
  p.grounded = resY.grounded;
  p.onIce = resY.onIce;

  // Explicit Support Platform 1-way rideable landing safeguard
  if (!dropThroughOneWay && p.vy >= 0 && !p.grounded) {
    for (let i = 0; i < state.projectiles.length; i++) {
      const proj = state.projectiles[i];
      if (proj.kind !== 'support_platform' || !proj.solid || proj.ttl <= 0) {
        continue;
      }
      if (p.x + p.w > proj.x && p.x < proj.x + proj.w) {
        if (prevBottom <= proj.y + 3.0 && p.y + p.h >= proj.y) {
          p.y = proj.y - p.h;
          p.vy = 0;
          p.grounded = true;
          break;
        }
      }
    }
  }

  // Transfer conveyor velocity cleanly when grounded (flipped in Mirror World)
  const effConveyorVx = mirrored ? -resY.conveyorVx : resY.conveyorVx;
  if (p.grounded && effConveyorVx !== 0) {
    const convX = moveAndCollideX(state, p, effConveyorVx);
    p.x = convX.x;
  }

  if (resY.hitY || p.grounded) {
    if (impactVy >= 0 && p.grounded) {
      if (!wasGrounded && impactVy >= 2.5) {
        state.events.push({ type: 'sfx', key: 'land' });
        state.events.push({
          type: 'particle',
          kind: 'dust',
          x: p.x + p.w * 0.5,
          y: p.y + p.h,
          color: '#cbd5e1',
          count: 4,
        });

        // Armor Paint 7 (Quake Amber): landing from high fall emits ground shockwave projectiles left & right!
        if (armor === 7 && impactVy >= 5.0) {
          const cx = p.x + p.w * 0.5;
          for (const dir of [-1, 1] as const) {
            spawnProjectile(state, {
              owner: 'player',
              kind: 'shockwave',
              x: cx - 8 + dir * 10,
              y: p.y + p.h - 14,
              vx: dir * 5.2,
              vy: 0,
              w: 16,
              h: 14,
              damage: 2,
              ttl: 30,
              pierce: true,
              bouncesLeft: 0,
              color: '#f97316',
            });
          }
          state.camera.shakeTimer = Math.max(state.camera.shakeTimer, 6);
          state.camera.shakeIntensity = Math.max(state.camera.shakeIntensity, 2.2);
          state.events.push(
            { type: 'sfx', key: 'heavy_hit', gain: 0.85 },
            {
              type: 'particle',
              kind: 'shockring',
              x: cx,
              y: p.y + p.h,
              color: '#f97316',
              count: 10,
            },
          );
        }
      }
      p.vy = 0;
      p.airJumpsUsed = 0;
      p.onWall = 0;
      p.wallJumpLockTimer = 0;
      cryoAirSlideUsedMap.delete(p);
      resetDiveBounceStreak(p);
    } else if (resY.hitY && p.vy < 0) {
      p.vy = 0;
    }
  }

  // Bounce pad launch
  if (resY.onBouncePad) {
    p.vy = input.jump ? -8.0 : -6.6;
    p.grounded = false;
    p.airJumpsUsed = 0;
    p.leftGroundTick = -999;
    state.events.push({ type: 'sfx', key: 'jump', pitchJitter: 0.12 });
    state.events.push({
      type: 'particle',
      kind: 'shockring',
      x: p.x + p.w * 0.5,
      y: p.y + p.h,
      color: '#4ade80',
      count: 8,
    });
  }

  if (p.grounded) {
    p.leftGroundTick = state.tick;
    if (isSafeFloorUnderPlayer(state)) {
      p.lastSafeX = p.x;
      p.lastSafeY = p.y;
    }
  }

  // ---------------- WALL-SLIDE & LEDGE GRAB ----------------
  if (!p.grounded && !inHurtKnockback) {
    const wall = detectWallContact(state, p, 1.0);
    if (wall !== 0 && (moveX === wall || p.vy > 0)) {
      p.onWall = wall;
      p.wallJumpDir = (-wall) as -1 | 1;
      p.wallJumpBufferTick = state.tick;
      cryoAirSlideUsedMap.delete(p);
      resetDiveBounceStreak(p);

      if (p.vy > 0) {
        const hasGrip = hasChip(state, 4);
        const slideCap = hasGrip
          ? input.moveY === 1
            ? PLAYER_PHYSICS.WALL_SLIDE_MAX_SPEED
            : PLAYER_PHYSICS.WALL_SLIDE_GRIP_SPEED
          : PLAYER_PHYSICS.WALL_SLIDE_MAX_SPEED;
        if (p.vy > slideCap) {
          p.vy = slideCap;
        }
      }
    } else {
      p.onWall = 0;
    }

    // Automatic ledge grab when not holding Down and not dive-kicking
    if (
      input.moveY !== 1 &&
      p.attackId !== 'diveKick' &&
      p.attackId !== 'diveKickHeavy'
    ) {
      const ledge = detectLedgeGrab(state, p);
      if (ledge) {
        p.x = ledge.snapX;
        p.y = ledge.snapY;
        p.vx = 0;
        p.vy = 0;
        p.onLedge = ledge.side;
        p.facing = ledge.side;
        p.onWall = 0;
        p.airJumpsUsed = 0;
        cryoAirSlideUsedMap.delete(p);
        cryoAirSlideActiveMap.delete(p);
        state.events.push({ type: 'sfx', key: 'ledge_grab' });
      }
    }
  } else {
    p.onWall = 0;
  }

  // ---------------- ARMOR PAINT 6 (RHYTHM COBALT): PIROUETTE JUMP ATTACK ----------------
  if (!inHurtKnockback && armor === 6 && !p.grounded && p.vy < -0.5) {
    const spinBox: Aabb = {
      x: p.x - 6,
      y: p.y - 4,
      w: p.w + 12,
      h: p.h + 6,
    };
    const spinDmg =
      p.overloadTimer > 0
        ? Math.round(1 * PLAYER_PHYSICS.OVERLOAD_DAMAGE_MULT * 100) / 100
        : 1;
    let connected = false;

    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (e.dead || e.grabbed || e.hurtFlash > 0) continue;
      if (aabbOverlap(spinBox, e)) {
        const hit = damageEnemy(state, e, spinDmg, {
          armorBreak: false,
          knockbackX: 2.0,
          knockbackY: -2.2,
          sourceX: p.x + p.w * 0.5,
          freezeTicks: 1,
          onEnemyDefeated: hooks?.onEnemyDefeated,
        });
        if (hit) connected = true;
      }
    }

    const boss = state.boss;
    if (boss && boss.active && !boss.defeated && boss.invulnTimer === 0 && aabbOverlap(spinBox, boss)) {
      const hit = damageBoss(state, boss, spinDmg, {
        armorBreak: false,
        freezeTicks: 1,
        onBossDefeated: hooks?.onBossDefeated,
      });
      if (hit) connected = true;
    }

    if (connected) {
      p.invulnTimer = Math.max(p.invulnTimer, 6);
      state.events.push({
        type: 'particle',
        kind: 'spark',
        x: p.x + p.w * 0.5,
        y: p.y + p.h * 0.5,
        color: '#c026d3',
        count: 6,
      });
    } else if (state.tick % 6 === 0) {
      state.events.push({
        type: 'particle',
        kind: 'spark',
        x: p.x + p.w * 0.5,
        y: p.y + p.h * 0.5,
        color: '#60a5fa',
        count: 2,
      });
    }
  }

  // ---------------- SPEED BASHER CHIP (ID 14) ----------------
  if (
    !inHurtKnockback &&
    hasChip(state, 14) &&
    (Math.abs(p.vx) >= PLAYER_PHYSICS.SPRINT_MAX_SPEED - 0.15 || p.sliding)
  ) {
    let bashed = false;
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (e.dead || e.grabbed || e.hurtFlash > 0) {
        continue;
      }
      if (aabbOverlap(p, e)) {
        const hit = damageEnemy(state, e, PLAYER_PHYSICS.SPEED_BASHER_DAMAGE, {
          armorBreak: false,
          knockbackX: 3.5,
          knockbackY: -2.0,
          sourceX: p.x + p.w * 0.5,
          freezeTicks: 2,
          onEnemyDefeated: hooks?.onEnemyDefeated,
        });
        if (hit) bashed = true;
      }
    }

    const boss = state.boss;
    if (boss && boss.active && !boss.defeated && boss.invulnTimer === 0 && aabbOverlap(p, boss)) {
      const hit = damageBoss(state, boss, PLAYER_PHYSICS.SPEED_BASHER_DAMAGE, {
        armorBreak: false,
        freezeTicks: 2,
        onBossDefeated: hooks?.onBossDefeated,
      });
      if (hit) bashed = true;
    }

    if (bashed) {
      // Brief ram protection avoids trading contact damage on the bash tick
      p.invulnTimer = Math.max(p.invulnTimer, 6);
    }
  }

  // ---------------- HAZARD & PITFALL WARP ----------------
  const fellIntoPit = p.y > state.tilesH * TS + 20;
  if (resX.hitHazard || resY.hitHazard || fellIntoPit) {
    applyHazardDamage(state);
  }
}

/**
 * Updates Volt's 7-node flowing cyber-scarf smoothly reacting to movement,
 * jumps, hookshot zips, and biome wind.
 */
export function updateScarf(state: SimState): void {
  const p = state.player;
  const count = PLAYER_PHYSICS.SCARF_NODE_COUNT;
  const segLen = PLAYER_PHYSICS.SCARF_SEGMENT_LEN;

  const neckX = p.x + p.w * 0.5 - p.facing * 2;
  const neckY = p.y + (p.crouching ? 4 : 7);

  if (p.scarf.length !== count) {
    p.scarf = [];
    for (let i = 0; i < count; i++) {
      p.scarf.push({ x: neckX - p.facing * i * segLen, y: neckY });
    }
    return;
  }

  p.scarf[0].x = neckX;
  p.scarf[0].y = neckY;

  const effWind = state.progression.modifiers.mirrorWorld ? -state.windForce : state.windForce;
  const trailWindX =
    -p.facing * (0.8 + Math.min(2.2, Math.abs(p.vx) * 0.35)) + effWind * 0.6;

  for (let i = 1; i < count; i++) {
    const prev = p.scarf[i - 1];
    const node = p.scarf[i];

    // Flutter & gravity drift
    const flutter = Math.sin(state.tick * 0.24 + i * 0.85) * 0.32;
    node.x += trailWindX * 0.45;
    node.y += 0.22 + flutter - p.vy * 0.12;

    const dx = node.x - prev.x;
    const dy = node.y - prev.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.0001) {
      node.x = prev.x + (dx / dist) * segLen;
      node.y = prev.y + (dy / dist) * segLen;
    } else {
      node.x = prev.x - p.facing * segLen;
      node.y = prev.y;
    }
  }
}

function hasCameraBlockerOnColumn(
  state: SimState,
  tx: number,
  cellRowStart: number,
  cellRowEnd: number,
): boolean {
  if (tx < 0 || tx >= state.tilesW) {
    return true;
  }
  for (let ty = cellRowStart; ty < cellRowEnd; ty++) {
    if (getTileAt(state, tx, ty) === TileType.CAMERA_BLOCKER) {
      return true;
    }
  }
  return false;
}

/**
 * Cell-bounded smooth camera with DELAY_CAMERA_TRANSITION (5t), CAMERA_JUMP_MARGIN (15px),
 * CAMERA_BLOCKER room stops, boss arena lock-in, and shake timer decay.
 */
export function updateCamera(state: SimState, instant = false): void {
  const cam = state.camera;
  const p = state.player;
  const worldW = state.tilesW * TS;
  const worldH = state.tilesH * TS;
  const maxCamX = Math.max(0, worldW - CELL_W);
  const maxCamY = Math.max(0, worldH - CELL_H);

  // Decay screen shake timer
  if (cam.shakeTimer > 0) {
    cam.shakeTimer -= 1;
    if (cam.shakeTimer <= 0) {
      cam.shakeIntensity = 0;
    }
  }

  const cellsW = Math.max(1, Math.floor(worldW / CELL_W));
  const cellsH = Math.max(1, Math.floor(worldH / CELL_H));

  if (cam.lockedBossArena && state.boss && state.boss.active) {
    cam.targetX = Math.max(0, Math.min(maxCamX, state.boss.arenaLeft));
    cam.targetY = Math.max(0, Math.min(maxCamY, state.boss.arenaTop));
    cam.cellX = Math.floor(cam.targetX / CELL_W);
    cam.cellY = Math.floor(cam.targetY / CELL_H);
  } else {
    const px = p.x + p.w * 0.5;
    const py = p.y + p.h * 0.5;
    const rawCellX = Math.max(0, Math.min(cellsW - 1, Math.floor(px / CELL_W)));
    let rawCellY = Math.max(0, Math.min(cellsH - 1, Math.floor(py / CELL_H)));

    // CAMERA_JUMP_MARGIN (15 px): don't prematurely scroll upward on high jumps near cell top
    if (!instant && rawCellY < cam.cellY && !p.grounded && p.onLedge === 0 && p.onWall === 0) {
      const ceilingY = cam.cellY * CELL_H;
      if (p.y + p.h > ceilingY - ENGINE_CONSTANTS.CAMERA_JUMP_MARGIN) {
        rawCellY = cam.cellY;
      }
    }

    if (rawCellX !== cam.cellX || rawCellY !== cam.cellY) {
      cam.cellX = rawCellX;
      cam.cellY = rawCellY;
      cam.transitionTimer = instant ? 0 : ENGINE_CONSTANTS.DELAY_CAMERA_TRANSITION;
    }

    // Compute horizontal span bounded by CAMERA_BLOCKER tiles
    const rowStart = cam.cellY * ENGINE_CONSTANTS.CELL_TILES_H;
    const rowEnd = rowStart + ENGINE_CONSTANTS.CELL_TILES_H;

    let leftCell = cam.cellX;
    while (leftCell > 0) {
      const borderCol = leftCell * ENGINE_CONSTANTS.CELL_TILES_W;
      if (
        hasCameraBlockerOnColumn(state, borderCol, rowStart, rowEnd) ||
        hasCameraBlockerOnColumn(state, borderCol - 1, rowStart, rowEnd)
      ) {
        break;
      }
      leftCell -= 1;
    }

    let rightCell = cam.cellX;
    while (rightCell < cellsW - 1) {
      const borderCol = (rightCell + 1) * ENGINE_CONSTANTS.CELL_TILES_W;
      if (
        hasCameraBlockerOnColumn(state, borderCol, rowStart, rowEnd) ||
        hasCameraBlockerOnColumn(state, borderCol - 1, rowStart, rowEnd)
      ) {
        break;
      }
      rightCell += 1;
    }

    const spanMinX = leftCell * CELL_W;
    const spanMaxX = Math.min(maxCamX, rightCell * CELL_W);
    const desiredX = px - CELL_W * 0.5 + p.facing * 24;
    cam.targetX = Math.max(spanMinX, Math.min(spanMaxX, desiredX));
    cam.targetY = Math.max(0, Math.min(maxCamY, cam.cellY * CELL_H));
  }

  if (instant) {
    cam.x = cam.targetX;
    cam.y = cam.targetY;
    cam.transitionTimer = 0;
    return;
  }

  if (cam.transitionTimer > 0) {
    cam.transitionTimer -= 1;
    cam.x += (cam.targetX - cam.x) * 0.28;
    cam.y += (cam.targetY - cam.y) * 0.28;
  } else {
    cam.x += (cam.targetX - cam.x) * 0.22;
    cam.y += (cam.targetY - cam.y) * 0.2;
  }

  if (Math.abs(cam.targetX - cam.x) < 0.25) cam.x = cam.targetX;
  if (Math.abs(cam.targetY - cam.y) < 0.25) cam.y = cam.targetY;
}
