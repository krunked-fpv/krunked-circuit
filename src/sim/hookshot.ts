import {
  ENGINE_CONSTANTS,
  HOOKSHOT_CONSTANTS,
  PLAYER_PHYSICS,
  TileType,
  type InputFrame,
  type PickupEntity,
  type PlayerState,
  type ProjectileEntity,
  type SimState,
  type Vec2,
} from '../contracts/index';
import {
  moveAndCollideX,
  moveAndCollideY,
  setTileAt,
  sweptHookshotStep,
} from './collision';
import {
  damageBoss,
  damageEnemy,
  getActiveArmorPaint,
  hasChip,
  spawnProjectile,
  type CombatHooks,
} from './combat';

// ============================================================================
// 8-Directional Hookshot: Swept Grapple Zip, Pendulum Swing & Chain Throw Loop
// ============================================================================

const TS = ENGINE_CONSTANTS.TILE_SIZE;

export function getHookOrigin(player: PlayerState): Vec2 {
  return {
    x: player.x + player.w * 0.5,
    y: player.y + (player.crouching ? player.h * 0.5 : player.h * 0.52),
  };
}

export function releaseHookshot(state: SimState): void {
  const p = state.player;
  const hk = p.hook;
  if (hk.heldKind === 'enemy' && hk.heldEntityId > 0) {
    const enemy = state.enemies.find((e) => e.id === hk.heldEntityId);
    if (enemy) {
      enemy.grabbed = false;
    }
  } else if (
    (hk.heldKind === 'crate' || hk.heldKind === 'barrel') &&
    hk.heldEntityId > 0
  ) {
    const prop = state.props.find((pr) => pr.id === hk.heldEntityId);
    if (prop) {
      prop.grabbed = false;
    }
  }

  hk.phase = 'idle';
  hk.vx = 0;
  hk.vy = 0;
  hk.timer = 0;
  hk.ropeLen = 0;
  hk.swingAngle = 0;
  hk.swingAngVel = 0;
  hk.heldKind = 'none';
  hk.heldEntityId = 0;
  hk.heldSpriteKey = '';
  hk.heldDamage = 0;
}

export function throwHeldObject(
  state: SimState,
  input: InputFrame,
  hooks?: CombatHooks,
): void {
  const p = state.player;
  const hk = p.hook;
  if (hk.phase !== 'holding' || hk.heldKind === 'none') {
    return;
  }

  const rawX = input.aimX !== 0 ? input.aimX : input.moveX;
  const rawY = input.aimY !== 0 ? input.aimY : input.moveY;
  const dirX = rawX === 0 && rawY === 0 ? p.facing : rawX;
  const dirY = rawY;

  if (dirX !== 0) {
    p.facing = dirX;
  }

  let vx: number;
  if (dirX === 0) {
    vx = p.facing * 1.0;
  } else {
    let absVx =
      dirY === 0
        ? HOOKSHOT_CONSTANTS.THROW_VX_NEUTRAL
        : HOOKSHOT_CONSTANTS.THROW_VX_DIAGONAL;
    if (input.sprint || Math.abs(p.vx) >= 3.2) {
      absVx += HOOKSHOT_CONSTANTS.THROW_VX_SPRINT_BONUS;
    }
    vx = dirX * absVx;
  }

  let vy: number;
  if (dirY === 0) {
    vy = HOOKSHOT_CONSTANTS.THROW_VY_NEUTRAL;
  } else if (dirY === -1) {
    vy = HOOKSHOT_CONSTANTS.THROW_VY_UP;
  } else {
    vy = HOOKSHOT_CONSTANTS.THROW_VY_DOWN;
  }

  let projKind: ProjectileEntity['kind'] = 'thrown_crate';
  let color = '#fb923c';

  if (hk.heldKind === 'enemy') {
    projKind = 'thrown_enemy';
    color = '#f43f5e';
    const enemy = state.enemies.find((e) => e.id === hk.heldEntityId);
    if (enemy && !enemy.dead) {
      enemy.dead = true;
      enemy.grabbed = false;
      enemy.hp = 0;
      state.stageStats.enemiesDefeated += 1;
      hooks?.onEnemyDefeated?.(state, enemy);
    }
  } else if (hk.heldKind === 'shield') {
    projKind = 'thrown_shield';
    color = '#38bdf8';
  } else if (hk.heldKind === 'barrel') {
    projKind = 'thrown_barrel';
    color = '#ef4444';
    const prop = state.props.find((pr) => pr.id === hk.heldEntityId);
    if (prop) {
      prop.hp = 0;
      prop.grabbed = false;
    }
  } else {
    projKind = 'thrown_crate';
    color = '#f59e0b';
    const prop = state.props.find((pr) => pr.id === hk.heldEntityId);
    if (prop) {
      prop.hp = 0;
      prop.grabbed = false;
    }
  }

  const armor = getActiveArmorPaint(state);
  const throwDmg =
    HOOKSHOT_CONSTANTS.THROW_COLLISION_DAMAGE + (armor === 8 ? 1 : 0);

  spawnProjectile(state, {
    owner: 'thrown',
    kind: projKind,
    x: p.x + p.w * 0.5 - 7,
    y: p.y - 10,
    vx,
    vy,
    w: 14,
    h: 14,
    damage: throwDmg,
    ttl: 180,
    pierce: false,
    bouncesLeft: 2,
    color,
  });

  // Short throw recovery prevents melee jab double-trigger on same attackPressed tick
  p.attackTimer = Math.max(p.attackTimer, 6);
  hk.phase = 'idle';
  hk.heldKind = 'none';
  hk.heldEntityId = 0;
  hk.heldSpriteKey = '';
  hk.heldDamage = 0;

  state.events.push({ type: 'sfx', key: 'throw' });
  state.events.push({ type: 'rumble', weak: 0.25, strong: 0.35, durationMs: 70 });
}

export function updateHookshot(
  state: SimState,
  input: InputFrame,
  hooks?: CombatHooks,
): void {
  const p = state.player;
  const hk = p.hook;

  if (p.action === 'dead' || p.action === 'hurt' || p.action === 'warp') {
    if (hk.phase !== 'idle') {
      releaseHookshot(state);
    }
    return;
  }

  const origin = getHookOrigin(p);

  // ---------------- PHASE: HOLDING ----------------
  if (hk.phase === 'holding') {
    const holdX = p.x + p.w * 0.5;
    const holdY = p.y - 10;
    hk.tipX = holdX;
    hk.tipY = holdY;

    if (hk.heldKind === 'enemy' && hk.heldEntityId > 0) {
      const enemy = state.enemies.find((e) => e.id === hk.heldEntityId);
      if (!enemy || enemy.dead) {
        releaseHookshot(state);
        return;
      }
      enemy.x = holdX - enemy.w * 0.5;
      enemy.y = holdY - enemy.h * 0.5;
      enemy.vx = 0;
      enemy.vy = 0;
    } else if (
      (hk.heldKind === 'crate' || hk.heldKind === 'barrel') &&
      hk.heldEntityId > 0
    ) {
      const prop = state.props.find((pr) => pr.id === hk.heldEntityId);
      if (!prop || prop.hp <= 0) {
        releaseHookshot(state);
        return;
      }
      prop.x = holdX - prop.w * 0.5;
      prop.y = holdY - prop.h * 0.5;
    }

    if (input.hookshotPressed || input.attackPressed) {
      throwHeldObject(state, input, hooks);
    }
    return;
  }

  // ---------------- PHASE: IDLE ----------------
  if (hk.phase === 'idle') {
    hk.tipX = origin.x;
    hk.tipY = origin.y;
    if (!input.hookshotPressed) {
      return;
    }

    const aimX = input.aimX !== 0 ? input.aimX : input.moveX;
    const aimY = input.aimY !== 0 ? input.aimY : input.moveY;
    const dx = aimX === 0 && aimY === 0 ? p.facing : aimX;
    const dy = aimY;
    const len = Math.max(1, Math.hypot(dx, dy));

    hk.dirX = dx / len;
    hk.dirY = dy / len;
    if (dx !== 0) {
      p.facing = dx > 0 ? 1 : -1;
    }

    hk.phase = 'extending';
    hk.tipX = origin.x;
    hk.tipY = origin.y;
    hk.vx = hk.dirX * HOOKSHOT_CONSTANTS.MAX_SPEED;
    hk.vy = hk.dirY * HOOKSHOT_CONSTANTS.MAX_SPEED;
    hk.timer =
      HOOKSHOT_CONSTANTS.TIMER_MAX +
      (hasChip(state, 15) ? HOOKSHOT_CONSTANTS.CHAIN_BOOSTER_EXTRA_TICKS : 0);
    hk.ropeLen = 0;
    p.onLedge = 0;

    state.events.push({ type: 'sfx', key: 'hook_fire' });
    return;
  }

  // ---------------- PHASE: EXTENDING ----------------
  if (hk.phase === 'extending') {
    const nextX = hk.tipX + hk.vx;
    const nextY = hk.tipY + hk.vy;

    const pullPickup = (pk: PickupEntity): void => {
      pk.x = origin.x;
      pk.y = origin.y;
      pk.vx = 0;
      pk.vy = 0;
      state.events.push({ type: 'sfx', key: 'hook_grab', pitchJitter: 0.1 });
    };

    const hit = sweptHookshotStep(state, hk.tipX, hk.tipY, nextX, nextY, {
      catchProjectiles: hasChip(state, 6),
      onPickup: pullPickup,
    });

    const chainBooster = hasChip(state, 15);
    const chainDasher = hasChip(state, 16);
    const hookDmg = 1 + (chainBooster ? HOOKSHOT_CONSTANTS.CHAIN_BOOSTER_BONUS_DMG : 0);

    if (hit.kind === 'breakable' && hit.tileX !== undefined && hit.tileY !== undefined) {
      setTileAt(state, hit.tileX, hit.tileY, TileType.EMPTY);
      hk.tipX = hit.x;
      hk.tipY = hit.y;
      hk.phase = 'retracting';
      state.events.push({ type: 'sfx', key: 'breakable' });
      state.events.push({
        type: 'particle',
        kind: 'shard',
        x: (hit.tileX + 0.5) * TS,
        y: (hit.tileY + 0.5) * TS,
        color: '#cbd5e1',
        count: 8,
      });
      return;
    }

    if (hit.kind === 'switch' && hit.entityId !== undefined) {
      const prop = state.props.find((pr) => pr.id === hit.entityId);
      if (prop) {
        prop.activated = !prop.activated;
        state.togglePhase = !state.togglePhase;
        state.events.push({ type: 'sfx', key: 'switch' });
        state.events.push({
          type: 'particle',
          kind: 'spark',
          x: hit.x,
          y: hit.y,
          color: '#38bdf8',
          count: 8,
        });
      }
      hk.tipX = hit.x;
      hk.tipY = hit.y;
      hk.phase = 'retracting';
      return;
    }

    if (hit.kind === 'prop' && hit.entityId !== undefined) {
      const prop = state.props.find((pr) => pr.id === hit.entityId);
      if (prop && (prop.kind === 'crate' || prop.kind === 'barrel')) {
        prop.grabbed = true;
        hk.phase = 'holding';
        hk.heldKind = prop.kind;
        hk.heldEntityId = prop.id;
        hk.heldSpriteKey = prop.kind;
        hk.heldDamage = HOOKSHOT_CONSTANTS.THROW_COLLISION_DAMAGE;
        hk.tipX = p.x + p.w * 0.5;
        hk.tipY = p.y - 10;
        state.events.push({ type: 'sfx', key: 'hook_grab' });
        return;
      }
    }

    if (hit.kind === 'projectile' && hit.entityId !== undefined) {
      const idx = state.projectiles.findIndex((pr) => pr.id === hit.entityId);
      if (idx >= 0) {
        state.projectiles.splice(idx, 1);
        hk.phase = 'holding';
        hk.heldKind = 'shield';
        hk.heldEntityId = 0;
        hk.heldSpriteKey = 'shield_guard';
        hk.heldDamage = HOOKSHOT_CONSTANTS.THROW_COLLISION_DAMAGE;
        hk.tipX = p.x + p.w * 0.5;
        hk.tipY = p.y - 10;
        state.events.push({ type: 'sfx', key: 'hook_grab' });
        return;
      }
    }

    if (hit.kind === 'enemy' && hit.entityId !== undefined) {
      const enemy = state.enemies.find((e) => e.id === hit.entityId);
      if (enemy && !enemy.dead) {
        hk.remoteBombTargetId = enemy.id;
        const canGrab =
          !enemy.isMiniboss &&
          (enemy.stunTimer > 0 || (!enemy.shielded && enemy.hp <= hookDmg));

        if (canGrab) {
          enemy.grabbed = true;
          hk.phase = 'holding';
          hk.heldKind = 'enemy';
          hk.heldEntityId = enemy.id;
          hk.heldSpriteKey = enemy.archetypeId;
          hk.heldDamage = HOOKSHOT_CONSTANTS.THROW_COLLISION_DAMAGE;
          hk.tipX = p.x + p.w * 0.5;
          hk.tipY = p.y - 10;
          state.events.push({ type: 'sfx', key: 'hook_grab' });
          return;
        }

        damageEnemy(state, enemy, hookDmg, {
          armorBreak: false,
          knockbackX: 1.5,
          knockbackY: -1.5,
          sourceX: origin.x,
          freezeTicks: 1,
          onEnemyDefeated: hooks?.onEnemyDefeated,
        });

        if (chainDasher && !enemy.dead) {
          // Chain Dasher chip zips toward enemy and allows instant melee cancel
          hk.phase = 'latched_wall';
          hk.tipX = enemy.x + enemy.w * 0.5;
          hk.tipY = enemy.y + enemy.h * 0.5;
          hk.timer = 26;
          p.airJumpsUsed = 0;
          state.events.push({ type: 'sfx', key: 'hook_latch' });
          return;
        }

        hk.tipX = hit.x;
        hk.tipY = hit.y;
        hk.phase = 'retracting';
        return;
      }
    }

    if (hit.kind === 'boss' && state.boss && !state.boss.defeated) {
      hk.remoteBombTargetId = state.boss.id;
      damageBoss(state, state.boss, hookDmg, {
        armorBreak: false,
        freezeTicks: 1,
        onBossDefeated: hooks?.onBossDefeated,
      });
      if (chainDasher) {
        hk.phase = 'latched_wall';
        hk.tipX = state.boss.x + state.boss.w * 0.5;
        hk.tipY = state.boss.y + state.boss.h * 0.5;
        hk.timer = 22;
        p.airJumpsUsed = 0;
        state.events.push({ type: 'sfx', key: 'hook_latch' });
        return;
      }
      hk.tipX = hit.x;
      hk.tipY = hit.y;
      hk.phase = 'retracting';
      return;
    }

    if (hit.kind === 'solid') {
      hk.tipX = hit.x;
      hk.tipY = hit.y;
      hk.latchedTileX = hit.tileX ?? 0;
      hk.latchedTileY = hit.tileY ?? 0;
      p.airJumpsUsed = 0;
      p.sliding = false;
      state.events.push({ type: 'sfx', key: 'hook_latch' });
      state.events.push({
        type: 'particle',
        kind: 'spark',
        x: hit.x,
        y: hit.y,
        color: '#fde047',
        count: 6,
      });

      const ropeDist = Math.hypot(origin.x - hit.x, origin.y - hit.y);
      const shouldSwing =
        !p.grounded &&
        hk.dirY < -0.35 &&
        ropeDist >= 20 &&
        ropeDist <= HOOKSHOT_CONSTANTS.SWING_ROPE_MAX_LEN;

      if (shouldSwing) {
        hk.phase = 'swinging';
        hk.ropeLen = Math.min(
          HOOKSHOT_CONSTANTS.SWING_ROPE_MAX_LEN,
          Math.max(24, ropeDist),
        );
        hk.swingAngle = Math.atan2(origin.y - hit.y, origin.x - hit.x);
        const tangentX = -Math.sin(hk.swingAngle);
        const tangentY = Math.cos(hk.swingAngle);
        const tangVel = p.vx * tangentX + p.vy * tangentY;
        hk.swingAngVel = tangVel / hk.ropeLen;
        hk.timer = 0;
      } else {
        hk.phase = 'latched_wall';
        hk.timer = 45;
      }
      return;
    }

    // Continue outward flight with exact outward deceleration
    hk.tipX = nextX;
    hk.tipY = nextY;
    const speed = Math.hypot(hk.vx, hk.vy);
    const nextSpeed = Math.max(2.0, speed - HOOKSHOT_CONSTANTS.DEACCEL_OUTWARD);
    hk.vx = hk.dirX * nextSpeed;
    hk.vy = hk.dirY * nextSpeed;
    hk.timer -= 1;

    if (hk.timer <= 0) {
      hk.phase = 'retracting';
      hk.vx = 0;
      hk.vy = 0;
    }
    return;
  }

  // ---------------- PHASE: LATCHED_WALL (GRAPPLE ZIP) ----------------
  if (hk.phase === 'latched_wall') {
    const dx = hk.tipX - origin.x;
    const dy = hk.tipY - origin.y;
    const dist = Math.hypot(dx, dy);

    // Jump-cancel zip preserving momentum
    if (input.jumpPressed) {
      const inv = dist > 0.001 ? 1 / dist : 0;
      p.vx = (dx * inv) * 5.2;
      p.vy = PLAYER_PHYSICS.JUMP_IMPULSE;
      p.grounded = false;
      releaseHookshot(state);
      state.events.push({ type: 'sfx', key: 'jump' });
      return;
    }

    // Melee cancel (especially powerful with Chain Dasher chip)
    if (input.attackPressed) {
      const inv = dist > 0.001 ? 1 / dist : 0;
      p.vx = (dx * inv) * 4.5;
      p.vy = Math.min(0, (dy * inv) * 3.5);
      releaseHookshot(state);
      return;
    }

    hk.timer -= 1;
    if (dist <= HOOKSHOT_CONSTANTS.EXTENSION_LENGTH + 4 || hk.timer <= 0) {
      const inv = dist > 0.001 ? 1 / dist : 0;
      p.vx = (dx * inv) * 3.2;
      p.vy = (dy * inv) * 2.4;
      releaseHookshot(state);
      return;
    }

    const stepDist = Math.min(HOOKSHOT_CONSTANTS.ZIP_SPEED, dist);
    const mx = (dx / dist) * stepDist;
    const my = (dy / dist) * stepDist;

    const rx = moveAndCollideX(state, p, mx);
    p.x = rx.x;
    const ry = moveAndCollideY(state, p, my, false);
    p.y = ry.y;
    p.vx = mx;
    p.vy = my;
    p.grounded = ry.grounded;

    if (rx.hitX && ry.hitY) {
      releaseHookshot(state);
    }
    return;
  }

  // ---------------- PHASE: SWINGING (PENDULUM SWING) ----------------
  if (hk.phase === 'swinging') {
    hk.timer += 1;

    // Rope reel adjustment with Up / Down
    if (input.moveY !== 0) {
      hk.ropeLen = Math.max(
        24,
        Math.min(HOOKSHOT_CONSTANTS.SWING_ROPE_MAX_LEN, hk.ropeLen + input.moveY * 2.0),
      );
    }

    // Pendulum physics: angle = PI/2 straight down
    const angGravity = (PLAYER_PHYSICS.GRAVITY / Math.max(24, hk.ropeLen)) * Math.cos(hk.swingAngle);
    const pumpAccel = -input.moveX * 0.0026;
    hk.swingAngVel = (hk.swingAngVel + angGravity + pumpAccel) * 0.992;
    hk.swingAngle += hk.swingAngVel;

    // Clamp angle to lower hemisphere (-0.05..PI+0.05) so rope never inverts awkwardly
    if (hk.swingAngle < -0.05) {
      hk.swingAngle = -0.05;
      hk.swingAngVel = Math.max(0, hk.swingAngVel);
    } else if (hk.swingAngle > Math.PI + 0.05) {
      hk.swingAngle = Math.PI + 0.05;
      hk.swingAngVel = Math.min(0, hk.swingAngVel);
    }

    const targetOriginX = hk.tipX + Math.cos(hk.swingAngle) * hk.ropeLen;
    const targetOriginY = hk.tipY + Math.sin(hk.swingAngle) * hk.ropeLen;
    const moveDx = targetOriginX - origin.x;
    const moveDy = targetOriginY - origin.y;

    const rx = moveAndCollideX(state, p, moveDx);
    p.x = rx.x;
    const ry = moveAndCollideY(state, p, moveDy, false);
    p.y = ry.y;
    p.grounded = ry.grounded;

    if (rx.hitX || ry.hitY) {
      hk.swingAngVel *= -0.25;
    }

    // Tangential velocity for momentum-preserving release
    const tangVx = -hk.ropeLen * Math.sin(hk.swingAngle) * hk.swingAngVel;
    const tangVy = hk.ropeLen * Math.cos(hk.swingAngle) * hk.swingAngVel;
    p.vx = tangVx;
    p.vy = tangVy;

    // Jump-cancel or release hookshot preserves full swing momentum!
    if (input.jumpPressed || (!input.hookshot && hk.timer >= 5)) {
      p.vx = Math.max(-7.5, Math.min(7.5, tangVx * 1.18));
      if (input.jumpPressed) {
        p.vy = Math.min(tangVy - 2.4, PLAYER_PHYSICS.JUMP_IMPULSE);
        state.events.push({ type: 'sfx', key: 'jump' });
      } else {
        p.vy = Math.max(-7.0, Math.min(5.0, tangVy));
      }
      p.grounded = false;
      releaseHookshot(state);
    }
    return;
  }

  // ---------------- PHASE: RETRACTING ----------------
  if (hk.phase === 'retracting') {
    const dx = origin.x - hk.tipX;
    const dy = origin.y - hk.tipY;
    const dist = Math.hypot(dx, dy);
    const speed = Math.min(
      HOOKSHOT_CONSTANTS.MAX_SPEED,
      Math.max(12.0, Math.hypot(hk.vx, hk.vy) + HOOKSHOT_CONSTANTS.DEACCEL_INWARD),
    );

    if (dist <= speed + 4) {
      releaseHookshot(state);
      return;
    }

    hk.vx = (dx / dist) * speed;
    hk.vy = (dy / dist) * speed;
    hk.tipX += hk.vx;
    hk.tipY += hk.vy;
  }
}
