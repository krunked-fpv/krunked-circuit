import {
  ATTACK_DATA,
  BOSS_CONSTANTS,
  DAMAGE_TABLES,
  ECONOMY_CONSTANTS,
  ENGINE_CONSTANTS,
  HOOKSHOT_CONSTANTS,
  PLAYER_PHYSICS,
  TileType,
  type ArmorPaintId,
  type AttackId,
  type AttackSpec,
  type BossEntity,
  type ChipId,
  type EnemyEntity,
  type InputFrame,
  type Loadout,
  type PickupEntity,
  type PlayerState,
  type ProjectileEntity,
  type SimState,
} from '../contracts/index';
import {
  aabbOverlap,
  getTileAt,
  isSolidTile,
  moveAndCollideX,
  moveAndCollideY,
  setTileAt,
  type Aabb,
} from './collision';
import { rngRange } from './prng';
import { evaluateChallenges, unlockDataChip } from './progression';

// ============================================================================
// Pure Melee Combat, Guard-Break, Damage Mitigation, Chips, Armors & Projectiles
// ============================================================================

const TS = ENGINE_CONSTANTS.TILE_SIZE;

// Per-PlayerState pure auxiliary tracking (GC-safe, isolated per SimState, 100% deterministic)
const catchInterruptWindowMap = new WeakMap<PlayerState, number>();
const diveBounceStreakMap = new WeakMap<PlayerState, number>();

export interface CombatHooks {
  onEnemyDefeated?: (state: SimState, enemy: EnemyEntity) => void;
  onBossDefeated?: (state: SimState, boss: BossEntity) => void;
}

export interface PlayerDamageOptions {
  isHazard?: boolean;
  isContact?: boolean;
  ignoreInvuln?: boolean;
}

export interface EnemyDamageOptions {
  armorBreak?: boolean;
  knockbackX?: number;
  knockbackY?: number;
  sourceX?: number;
  freezeTicks?: number;
  isBurst?: boolean;
  onEnemyDefeated?: (state: SimState, enemy: EnemyEntity) => void;
}

export interface BossDamageOptions {
  armorBreak?: boolean;
  freezeTicks?: number;
  isBurst?: boolean;
  onBossDefeated?: (state: SimState, boss: BossEntity) => void;
}

export function getActiveLoadout(state: SimState): Loadout {
  return state.progression.loadouts[state.progression.activeLoadoutIndex];
}

export function getActiveArmorPaint(state: SimState): ArmorPaintId {
  return getActiveLoadout(state).armorPaint;
}

export function hasChip(state: SimState, chipId: ChipId): boolean {
  const chips = getActiveLoadout(state).chips;
  return chips[0] === chipId || chips[1] === chipId || chips[2] === chipId;
}

export function getBurstDamageMultiplier(state: SimState): number {
  let mult = 1.0;
  const armor = getActiveArmorPaint(state);
  if (armor === 10) {
    mult *= 1.25; // Shadow Surge (+25% Burst damage)
  } else if (armor === 11) {
    mult *= 1.2; // Apex Prismatic (+20% Burst damage)
  }
  if (state.player.overloadTimer > 0) {
    mult *= PLAYER_PHYSICS.OVERLOAD_DAMAGE_MULT; // Function Overload (1.40x)
  }
  return mult;
}

export function getCatchInterruptTicks(player: PlayerState): number {
  return catchInterruptWindowMap.get(player) ?? 0;
}

export function setCatchInterruptTicks(player: PlayerState, ticks: number): void {
  if (ticks <= 0) {
    catchInterruptWindowMap.delete(player);
  } else {
    catchInterruptWindowMap.set(player, ticks);
  }
}

export function tickCatchInterrupt(player: PlayerState): void {
  const cur = catchInterruptWindowMap.get(player) ?? 0;
  if (cur > 1) {
    catchInterruptWindowMap.set(player, cur - 1);
  } else if (cur === 1) {
    catchInterruptWindowMap.delete(player);
  }
}

export function resetDiveBounceStreak(player: PlayerState): void {
  diveBounceStreakMap.delete(player);
}

export function addBurstEnergy(state: SimState, amount: number): void {
  if (amount <= 0) {
    return;
  }
  const p = state.player;
  const armor = getActiveArmorPaint(state);
  let mult = 1.0;
  if (hasChip(state, 10)) {
    mult *= 1.35; // Energy Multiplier (+35% burst gain)
  }
  if (armor === 1) {
    mult *= 1.1; // Solar Beam
  } else if (armor === 6) {
    mult *= 1.2; // Rhythm Cobalt
  } else if (armor === 11) {
    mult *= 1.15; // Apex Prismatic
  }
  const cap = p.maxBurstCharges * PLAYER_PHYSICS.BURST_ENERGY_PER_CHARGE;
  p.burstEnergy = Math.min(cap, Math.round((p.burstEnergy + amount * mult) * 100) / 100);
}

export function spawnBits(
  state: SimState,
  x: number,
  y: number,
  totalBits: number,
): void {
  if (totalBits <= 0) {
    return;
  }
  const armor = getActiveArmorPaint(state);
  let remaining = armor === 2 ? Math.ceil(totalBits * 1.25) : Math.floor(totalBits);

  const denoms: readonly { val: number; kind: PickupEntity['kind'] }[] = [
    { val: ECONOMY_CONSTANTS.BIT_DENOMINATIONS[3], kind: 'bit_50' },
    { val: ECONOMY_CONSTANTS.BIT_DENOMINATIONS[2], kind: 'bit_10' },
    { val: ECONOMY_CONSTANTS.BIT_DENOMINATIONS[1], kind: 'bit_5' },
    { val: ECONOMY_CONSTANTS.BIT_DENOMINATIONS[0], kind: 'bit_1' },
  ];

  for (let i = 0; i < denoms.length; i++) {
    const d = denoms[i];
    while (remaining >= d.val) {
      remaining -= d.val;
      state.pickups.push({
        id: state.nextEntityId++,
        kind: d.kind,
        x,
        y,
        vx: rngRange(state, -1.8, 1.8),
        vy: rngRange(state, -3.6, -1.8),
        value: d.val,
        ttl: 480,
        collected: false,
      });
    }
  }
}

export function spawnProjectile(
  state: SimState,
  init: Omit<ProjectileEntity, 'id' | 'hitIds'>,
): ProjectileEntity {
  const proj: ProjectileEntity = {
    ...init,
    id: state.nextEntityId++,
    hitIds: [],
  };
  state.projectiles.push(proj);
  return proj;
}

export function computePlayerInvulnTicks(state: SimState): number {
  const diffTable = DAMAGE_TABLES[state.progression.difficulty];
  const protectionMult = hasChip(state, 19) ? PLAYER_PHYSICS.PROTECTION_TIMER_MULT : 1.0;
  const armorMult =
    getActiveArmorPaint(state) === 9 ? PLAYER_PHYSICS.WEAK_ARMOR_INVULN_MULT : 1.0;
  return Math.round(
    PLAYER_PHYSICS.INVULN_BASE_TICKS * protectionMult * diffTable.invulnMult * armorMult,
  );
}

function triggerCatchInterruptCounter(state: SimState): void {
  const p = state.player;
  const cx = p.x + p.w * 0.5;
  const cy = p.y + p.h * 0.5;
  const counterDmg = Math.round(6 * getBurstDamageMultiplier(state) * 100) / 100;
  const dome: Aabb = { x: cx - 44, y: cy - 44, w: 88, h: 88 };

  setCatchInterruptTicks(p, 0);
  p.invulnTimer = Math.max(p.invulnTimer, 28);

  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (e.dead || e.grabbed) continue;
    if (aabbOverlap(dome, e)) {
      e.stunTimer = Math.max(e.stunTimer, 90);
      damageEnemy(state, e, counterDmg, {
        armorBreak: true,
        knockbackX: 5.0,
        knockbackY: -3.5,
        sourceX: cx,
        freezeTicks: 4,
      });
    }
  }

  const boss = state.boss;
  if (boss && boss.active && !boss.defeated && aabbOverlap(dome, boss)) {
    damageBoss(state, boss, counterDmg, {
      armorBreak: true,
      freezeTicks: 4,
      isBurst: true,
    });
  }

  for (let i = 0; i < state.projectiles.length; i++) {
    const pr = state.projectiles[i];
    if ((pr.owner === 'enemy' || pr.owner === 'boss') && aabbOverlap(dome, pr)) {
      pr.owner = 'player';
      pr.vx = -pr.vx * 1.5;
      pr.vy = -pr.vy * 1.5;
      pr.damage = counterDmg;
      pr.color = '#4de8a4';
      pr.ttl = Math.max(pr.ttl, 60);
    }
  }

  state.hitstopTicks = Math.max(state.hitstopTicks, 4);
  state.camera.shakeTimer = Math.max(state.camera.shakeTimer, 10);
  state.camera.shakeIntensity = Math.max(state.camera.shakeIntensity, 3);
  state.events.push(
    { type: 'sfx', key: 'armor_break' },
    { type: 'shake', ticks: 10, intensity: 3 },
    { type: 'rumble', weak: 0.45, strong: 0.75, durationMs: 140 },
    { type: 'particle', kind: 'shockring', x: cx, y: cy, color: '#4de8a4', count: 16 },
    { type: 'toast', text: 'COUNTER INTERRUPT!', tone: 'unlock' },
  );
}

/**
 * Applies damage to the player with full chip, armor, barrier, parry, invulnerability,
 * and difficulty table rules. Returns true if damage was applied (not blocked/dodged).
 */
export function applyDamageToPlayer(
  state: SimState,
  rawDamage: number,
  sourceX?: number,
  opts?: PlayerDamageOptions,
): boolean {
  const p = state.player;
  if (p.action === 'dead' || p.action === 'victory' || rawDamage <= 0) {
    return false;
  }

  // Catch Interrupt (Burst 6): reactive counter-parry window intercepts non-hazard attacks!
  if (!opts?.isHazard && getCatchInterruptTicks(p) > 0) {
    triggerCatchInterruptCounter(state);
    return false;
  }

  if (p.invulnTimer > 0 && !opts?.ignoreInvuln) {
    return false;
  }

  // Dodge Slider chip (ID 13): invulnerable during slide dash frames against non-hazards
  if (!opts?.isHazard && hasChip(state, 13) && p.sliding && p.slideTimer > 2) {
    state.events.push(
      { type: 'sfx', key: 'slide', pitchJitter: 0.08 },
      {
        type: 'particle',
        kind: 'spark',
        x: p.x + p.w * 0.5,
        y: p.y + p.h * 0.5,
        color: '#38bdf8',
        count: 5,
      },
    );
    return false;
  }

  // Hardware Barrier (Burst 11): absorbs up to 3 non-hazard hits
  if (!opts?.isHazard && p.barrierHits > 0) {
    p.barrierHits -= 1;
    if (p.barrierHits <= 0) {
      p.barrierHits = 0;
      p.barrierTimer = 0;
    }
    p.invulnTimer = 24;
    state.events.push({ type: 'sfx', key: 'armor_break' });
    state.events.push({
      type: 'particle',
      kind: 'shockring',
      x: p.x + p.w * 0.5,
      y: p.y + p.h * 0.5,
      color: '#38bdf8',
      count: 8,
    });
    return false;
  }

  // Nullifying Layer chip (ID 18)
  if (!opts?.isHazard && hasChip(state, 18) && p.nullifyReady) {
    p.nullifyReady = false;
    p.nullifyCooldown = 600;
    p.invulnTimer = 30;
    state.events.push({ type: 'sfx', key: 'switch' });
    state.events.push({
      type: 'particle',
      kind: 'shockring',
      x: p.x + p.w * 0.5,
      y: p.y + p.h * 0.5,
      color: '#a855f7',
      count: 6,
    });
    return false;
  }

  let dmg = rawDamage;
  const armor = getActiveArmorPaint(state);

  // Walker absorption
  if (!opts?.isHazard && p.inWalker && p.walkerHp > 0) {
    p.walkerHp = Math.max(0, p.walkerHp - dmg);
    p.invulnTimer = 36;
    if (p.walkerHp <= 0) {
      p.inWalker = false;
      state.events.push({ type: 'sfx', key: 'explosion' });
    } else {
      state.events.push({ type: 'sfx', key: 'hit' });
    }
    return true;
  }

  // Catch Block chip (ID 6) reduces damage while holding an object
  if (!opts?.isHazard && hasChip(state, 6) && p.hook.phase === 'holding') {
    dmg = Math.max(1, dmg - 1);
  }
  // Shadow Surge Armor (ID 10) reduces non-hazard damage by 1 (min 1)
  if (!opts?.isHazard && armor === 10) {
    dmg = Math.max(1, dmg - 1);
  }
  // Surge Protector chip (ID 5) reduces non-lethal hazard damage by 1
  if (opts?.isHazard && hasChip(state, 5) && !state.progression.modifiers.doubleHazards) {
    dmg = Math.max(1, dmg - 1);
  }
  // Iron Circuit modifier amplifies non-hazard damage
  if (!opts?.isHazard && state.progression.modifiers.ironCircuit) {
    dmg = Math.ceil(dmg * 1.5);
  }

  // Underflow Guard chip (ID 9): survive fatal non-hazard hit at 1 HP when hp >= 2
  if (!opts?.isHazard && hasChip(state, 9) && p.hp >= 2 && p.hp - dmg <= 0) {
    dmg = p.hp - 1;
    state.events.push(
      { type: 'toast', text: 'UNDERFLOW GUARD!', tone: 'info' },
      {
        type: 'particle',
        kind: 'shockring',
        x: p.x + p.w * 0.5,
        y: p.y + p.h * 0.5,
        color: '#facc15',
        count: 10,
      },
    );
  }

  p.hp = Math.max(0, p.hp - dmg);
  state.stageStats.damageTaken += dmg;
  p.comboCount = 0;
  p.comboTimer = 0;

  // Energy Absorber chip (ID 1) grants burst energy when taking damage
  if (hasChip(state, 1)) {
    addBurstEnergy(state, 20);
  }

  if (p.hp <= 0) {
    p.hp = 0;
    p.action = 'dead';
    p.vx = 0;
    p.vy = 0;
    p.attackId = null;
    p.attackTimer = 0;
    p.hook.phase = 'idle';
    p.hook.heldKind = 'none';
    p.hook.heldEntityId = 0;
    state.stageStats.deaths += 1;
    state.screen = 'game_over';
    state.camera.shakeTimer = 18;
    state.camera.shakeIntensity = 4;
    state.events.push({ type: 'sfx', key: 'death' });
    state.events.push({ type: 'shake', ticks: 18, intensity: 4 });
    state.events.push({ type: 'rumble', weak: 0.8, strong: 1.0, durationMs: 320 });
    state.events.push({
      type: 'particle',
      kind: 'explosion',
      x: p.x + p.w * 0.5,
      y: p.y + p.h * 0.5,
      color: '#ef4444',
      count: 16,
    });
    state.events.push({ type: 'gameOver' });
    return true;
  }

  if (opts?.isHazard) {
    p.invulnTimer = PLAYER_PHYSICS.HAZARD_WARP_INVULN_TICKS;
    p.hurtTimer = 10;
    p.warpTimer = 12;
    p.action = 'warp';
  } else {
    p.invulnTimer = computePlayerInvulnTicks(state);
    p.hurtTimer = 14;
    p.action = 'hurt';
    const knockDir =
      sourceX !== undefined ? (p.x + p.w * 0.5 >= sourceX ? 1 : -1) : -p.facing;
    const kbScale =
      (hasChip(state, 5) ? 0.5 : 1.0) * (armor === 7 ? 0.6 : 1.0);
    p.vx = knockDir * 2.6 * kbScale;
    p.vy = -2.8 * kbScale;
  }

  p.attackId = null;
  p.attackTimer = 0;
  p.onLedge = 0;
  resetDiveBounceStreak(p);
  state.camera.shakeTimer = Math.max(state.camera.shakeTimer, 8);
  state.camera.shakeIntensity = Math.max(state.camera.shakeIntensity, 2.5);
  state.events.push({ type: 'sfx', key: 'hurt' });
  state.events.push({ type: 'shake', ticks: 8, intensity: 2.5 });
  state.events.push({ type: 'rumble', weak: 0.45, strong: 0.65, durationMs: 140 });
  state.events.push({
    type: 'particle',
    kind: 'hit',
    x: p.x + p.w * 0.5,
    y: p.y + p.h * 0.5,
    color: '#f87171',
    count: 8,
  });
  return true;
}

/**
 * Applies hazard damage and warps the player back to lastSafeX/Y with 16t invuln.
 * Lethal immediately when `doubleHazards` modifier is active.
 */
export function applyHazardDamage(state: SimState): boolean {
  const p = state.player;
  const diffTable = DAMAGE_TABLES[state.progression.difficulty];
  const rawDamage = state.progression.modifiers.doubleHazards
    ? p.maxHp + 99
    : diffTable.hazard;

  const damaged = applyDamageToPlayer(state, rawDamage, undefined, {
    isHazard: true,
    ignoreInvuln: state.progression.modifiers.doubleHazards,
  });

  if (p.hp > 0) {
    // Release any held entity safely before warping
    if (p.hook.heldKind === 'enemy' && p.hook.heldEntityId > 0) {
      const held = state.enemies.find((e) => e.id === p.hook.heldEntityId);
      if (held) {
        held.grabbed = false;
      }
    } else if (
      (p.hook.heldKind === 'crate' || p.hook.heldKind === 'barrel') &&
      p.hook.heldEntityId > 0
    ) {
      const prop = state.props.find((pr) => pr.id === p.hook.heldEntityId);
      if (prop) {
        prop.grabbed = false;
      }
    }
    p.hook.phase = 'idle';
    p.hook.heldKind = 'none';
    p.hook.heldEntityId = 0;

    // Restore standing collider at last safe position
    p.w = PLAYER_PHYSICS.STAND_W;
    p.h = PLAYER_PHYSICS.STAND_H;
    p.crouching = false;
    p.sliding = false;
    p.x = p.lastSafeX;
    p.y = p.lastSafeY;
    p.vx = 0;
    p.vy = 0;
    p.grounded = false;
    p.onWall = 0;
    p.onLedge = 0;
    p.invulnTimer = PLAYER_PHYSICS.HAZARD_WARP_INVULN_TICKS;
    p.warpTimer = 12;
    p.action = 'warp';
  }
  return damaged;
}

function registerPlayerComboHit(state: SimState, energyGain: number): void {
  const p = state.player;
  p.comboCount += 1;
  const armor = getActiveArmorPaint(state);
  // Frame Amplifier (Chip 12) extends combo window by +60 ticks
  const comboWindow =
    120 + (hasChip(state, 12) ? 60 : 0) + (armor === 6 ? 45 : 0);
  p.comboTimer = comboWindow;
  if (energyGain > 0) {
    const absorberBonus = hasChip(state, 1) ? 4 : 0;
    addBurstEnergy(state, energyGain + absorberBonus);
  }

  // Armor Paint 2 (Mend Alloy): every 5-hit combo restores +1 HP (unless Iron Circuit)
  if (
    armor === 2 &&
    p.comboCount > 0 &&
    p.comboCount % 5 === 0 &&
    !state.progression.modifiers.ironCircuit
  ) {
    if (p.hp < p.maxHp) {
      p.hp = Math.min(p.maxHp, p.hp + 1);
    } else if (hasChip(state, 20)) {
      addBurstEnergy(state, 15);
    }
    state.events.push(
      { type: 'sfx', key: 'pickup_hp', gain: 0.7 },
      {
        type: 'particle',
        kind: 'heal',
        x: p.x + p.w * 0.5,
        y: p.y + p.h * 0.5,
        color: '#4ade80',
        count: 6,
      },
    );
  }

  if (p.comboCount >= 10) {
    evaluateChallenges(state);
  }
}

/**
 * Deals damage to an enemy, executing the full guard-break shield-shatter loop,
 * Frame Amplifier hitstun extension, hitstop freeze frames, knockback, bit drops, and stun states.
 */
export function damageEnemy(
  state: SimState,
  enemy: EnemyEntity,
  damage: number,
  opts?: EnemyDamageOptions,
): boolean {
  if (enemy.dead || damage <= 0) {
    return false;
  }

  const cx = enemy.x + enemy.w * 0.5;
  const cy = enemy.y + enemy.h * 0.5;
  const hasFrameAmp = hasChip(state, 12);

  // Shield guard-break / directional block check
  if (enemy.shielded) {
    const srcX = opts?.sourceX ?? state.player.x + state.player.w * 0.5;
    const hitFromFront =
      (enemy.facing === 1 && srcX >= cx - 4) || (enemy.facing === -1 && srcX <= cx + 4);

    if (opts?.armorBreak) {
      enemy.shielded = false;
      enemy.stunTimer = Math.max(enemy.stunTimer, hasFrameAmp ? 165 : 120);
      // Spawn a grabbable broken shield projectile
      spawnProjectile(state, {
        owner: 'thrown',
        kind: 'thrown_shield',
        x: cx - 6,
        y: cy - 8,
        vx: -enemy.facing * 1.4,
        vy: -3.2,
        w: 12,
        h: 16,
        damage: HOOKSHOT_CONSTANTS.THROW_COLLISION_DAMAGE,
        ttl: 360,
        pierce: false,
        bouncesLeft: 2,
        color: '#38bdf8',
      });
      state.hitstopTicks = Math.max(state.hitstopTicks, 4);
      state.camera.shakeTimer = Math.max(state.camera.shakeTimer, 6);
      state.camera.shakeIntensity = Math.max(state.camera.shakeIntensity, 2);
      state.events.push({ type: 'sfx', key: 'armor_break' });
      state.events.push({
        type: 'particle',
        kind: 'shard',
        x: cx,
        y: cy,
        color: '#38bdf8',
        count: 10,
      });
      evaluateChallenges(state);
    } else if (hitFromFront) {
      // Blocked by intact shield
      enemy.hurtFlash = 4;
      state.events.push({ type: 'sfx', key: 'switch', pitchJitter: 0.1 });
      state.events.push({
        type: 'particle',
        kind: 'spark',
        x: cx + enemy.facing * (enemy.w * 0.5),
        y: cy,
        color: '#e2e8f0',
        count: 5,
      });
      return false;
    }
  }

  enemy.hp = Math.round((enemy.hp - damage) * 100) / 100;
  enemy.hurtFlash = hasFrameAmp ? 12 : 8;

  if (opts?.knockbackX !== undefined || opts?.knockbackY !== undefined) {
    const dir =
      opts.sourceX !== undefined
        ? cx >= opts.sourceX
          ? 1
          : -1
        : state.player.facing;
    if (opts.knockbackX !== undefined) {
      enemy.vx = dir * Math.abs(opts.knockbackX);
    }
    if (opts.knockbackY !== undefined) {
      enemy.vy = opts.knockbackY;
      if (opts.knockbackY < -1.5) {
        enemy.grounded = false;
      }
    }
  }

  if (opts?.freezeTicks && opts.freezeTicks > 0) {
    state.hitstopTicks = Math.max(state.hitstopTicks, opts.freezeTicks);
  }

  registerPlayerComboHit(state, opts?.isBurst ? 0 : 10);

  if (enemy.hp <= 0) {
    enemy.hp = 0;
    enemy.dead = true;
    enemy.grabbed = false;
    state.stageStats.enemiesDefeated += 1;

    // Energy Absorber chip (ID 1): bonus Burst Energy on every enemy takedown
    if (hasChip(state, 1)) {
      addBurstEnergy(state, 15);
    }

    // Unlock matching enemy DataChip on defeat
    unlockDataChip(state, enemy.archetypeId);

    // Anti-farm cap per enemy spawn ID
    const farmKey = `${state.stageId}:${enemy.spawnId}`;
    const farmCount = state.progression.farmCounts[farmKey] ?? 0;
    if (farmCount < ECONOMY_CONSTANTS.FARM_CAP_PER_ENEMY_ID) {
      state.progression.farmCounts[farmKey] = farmCount + 1;
      const dropVal = enemy.isMiniboss ? 50 : 5 + Math.min(15, enemy.maxHp * 2);
      spawnBits(state, cx, cy, dropVal);
    }

    state.events.push({ type: 'sfx', key: 'explosion' });
    state.events.push({
      type: 'particle',
      kind: 'explosion',
      x: cx,
      y: cy,
      color: '#fb923c',
      count: 10,
    });
    opts?.onEnemyDefeated?.(state, enemy);
  } else {
    // Low HP non-miniboss enemies enter grabbable stunned state
    if (!enemy.isMiniboss && !enemy.shielded && enemy.hp <= 1) {
      enemy.stunTimer = Math.max(enemy.stunTimer, hasFrameAmp ? 135 : 90);
    } else if (hasFrameAmp && !enemy.isMiniboss) {
      // Frame Amplifier chip (ID 12): extended enemy hitstun on strikes
      enemy.stunTimer = Math.max(enemy.stunTimer + 20, 36);
    }
    state.events.push({ type: 'sfx', key: damage >= 2 ? 'heavy_hit' : 'hit' });
    state.events.push({
      type: 'particle',
      kind: 'hit',
      x: cx,
      y: cy,
      color: '#facc15',
      count: 6,
    });
  }

  return true;
}

/**
 * Deals damage to the active boss with Rude Mode anti-infinite scaling
 * (0.55x factor on repeated 1-dmg / launch hits + 90t techRecoverTimer reset),
 * desperation activation at threshold HP, and defeat event emission.
 */
export function damageBoss(
  state: SimState,
  boss: BossEntity,
  damage: number,
  opts?: BossDamageOptions,
): boolean {
  if (!boss.active || boss.defeated || damage <= 0) {
    return false;
  }
  if (boss.invulnTimer > 0 && !opts?.isBurst) {
    return false;
  }

  let applied = damage;
  const isLightOrLaunch = Boolean(opts?.armorBreak) || (!opts?.isBurst && damage <= 1.5);

  // Rude Mode anti-infinite scaling: 0.55x factor on repeated 1-dmg / launch hits
  if (
    state.progression.modifiers.rudeEnemies &&
    isLightOrLaunch &&
    (boss.launchHits >= 1 || boss.techRecoverTimer > 0)
  ) {
    applied = Math.round(applied * BOSS_CONSTANTS.RUDE_SINGLE_HIT_FACTOR * 100) / 100;
  }

  boss.hp = Math.max(0, Math.round((boss.hp - applied) * 100) / 100);
  boss.hurtFlash = hasChip(state, 12) ? 10 : 8;
  boss.invulnTimer = opts?.isBurst ? 6 : 10;

  // Anti-infinite launch/juggle tracker with 90-tick techRecoverTimer reset
  if (isLightOrLaunch && boss.techRecoverTimer <= 0) {
    boss.launchHits += 1;
    if (boss.launchHits >= 3) {
      boss.techRecoverTimer = BOSS_CONSTANTS.TECH_RECOVER_TICKS;
      boss.launchHits = 0;
      boss.invulnTimer = Math.max(boss.invulnTimer, 24);
      state.events.push(
        { type: 'sfx', key: 'switch', pitchJitter: 0.05 },
        {
          type: 'particle',
          kind: 'shockring',
          x: boss.x + boss.w * 0.5,
          y: boss.y + boss.h * 0.5,
          color: '#f43f5e',
          count: 8,
        },
      );
    }
  }

  if (opts?.freezeTicks && opts.freezeTicks > 0) {
    state.hitstopTicks = Math.max(state.hitstopTicks, opts.freezeTicks);
  }

  registerPlayerComboHit(state, opts?.isBurst ? 0 : 12);

  const cx = boss.x + boss.w * 0.5;
  const cy = boss.y + boss.h * 0.5;

  // Trigger Desperation phase once below desperationHp
  if (boss.hp > 0 && boss.hp <= boss.desperationHp && !boss.desperationTriggered) {
    boss.desperationTriggered = true;
    boss.desperationBannerTicks = 75;
    boss.phase = boss.phase < 2 ? 2 : boss.phase;
    boss.aiState = 'desperation';
    boss.aiTimer = 45;
    state.camera.shakeTimer = 16;
    state.camera.shakeIntensity = 3.5;
    state.events.push({ type: 'sfx', key: 'boss_desperation' });
    state.events.push({ type: 'shake', ticks: 16, intensity: 3.5 });
    state.events.push({
      type: 'particle',
      kind: 'shockring',
      x: cx,
      y: cy,
      color: '#f43f5e',
      count: 14,
    });
  }

  if (boss.hp <= 0) {
    boss.hp = 0;
    boss.defeated = true;
    boss.aiState = 'defeated';
    state.camera.lockedBossArena = false;
    state.hitstopTicks = Math.max(state.hitstopTicks, 8);
    state.camera.shakeTimer = 24;
    state.camera.shakeIntensity = 4.5;
    spawnBits(state, cx, cy, 100);
    unlockDataChip(state, boss.bossId);
    evaluateChallenges(state);
    state.events.push({ type: 'sfx', key: 'explosion' });
    state.events.push({ type: 'shake', ticks: 24, intensity: 4.5 });
    state.events.push({ type: 'rumble', weak: 0.7, strong: 1.0, durationMs: 360 });
    state.events.push({
      type: 'particle',
      kind: 'explosion',
      x: cx,
      y: cy,
      color: '#facc15',
      count: 20,
    });
    opts?.onBossDefeated?.(state, boss);
  } else {
    state.events.push({ type: 'sfx', key: applied >= 2 ? 'heavy_hit' : 'hit' });
    state.events.push({
      type: 'particle',
      kind: 'hit',
      x: cx,
      y: cy,
      color: '#fde047',
      count: 7,
    });
  }

  return true;
}

export function selectAttackId(state: SimState, input: InputFrame): AttackId {
  const p = state.player;
  if (p.onLedge !== 0) {
    return 'ledgeJab';
  }
  if (p.onWall !== 0 && !p.grounded) {
    return 'wallSlideJab';
  }
  if (!p.grounded) {
    if (input.moveY === 1) {
      return p.diveKickTicks >= 16 ? 'diveKickHeavy' : 'diveKick';
    }
    if (input.moveY === -1) {
      return 'airUpKick';
    }
    if (Math.abs(p.vx) >= 2.2) {
      return 'airKick';
    }
    return 'airJab';
  }
  if (p.crouching || p.sliding) {
    return 'jabCrouch';
  }
  if (input.moveY === -1) {
    return 'hopKick';
  }
  if (input.sprint || Math.abs(p.vx) >= 3.2) {
    return 'sprintKick';
  }
  if (Math.abs(p.vx) >= 0.4) {
    return 'jabWalk';
  }
  return 'jabNeutral';
}

export function getAttackHitbox(state: SimState, spec: AttackSpec): Aabb {
  const p = state.player;
  const bonusW = hasChip(state, 3) ? spec.powerExtenderBonusW : 0;
  const w = spec.width + bonusW;
  const h = spec.height;
  const cx = p.x + p.w * 0.5;
  const cy = p.y + p.h * 0.5;

  if (spec.id === 'diveKick' || spec.id === 'diveKickHeavy') {
    return {
      x: cx - w * 0.5 + p.facing * spec.offsetX,
      y: cy - h * 0.5 + spec.offsetY,
      w,
      h,
    };
  }

  const x =
    p.facing === 1
      ? cx - 6 + spec.offsetX
      : cx + 6 - spec.offsetX - w;
  const y = cy - h * 0.5 + spec.offsetY;
  return { x, y, w, h };
}

function computeMeleeDamage(state: SimState, spec: AttackSpec): number {
  let dmg = spec.damage;
  const armor = getActiveArmorPaint(state);

  if (armor === 9) {
    dmg *= 1.35; // Obsidian Glass: 1.35x Glass Cannon melee damage
  } else if (armor === 4 || armor === 11) {
    dmg += 0.5; // Volt Surge & Apex Prismatic: +0.5 electric melee bonus
  } else if (armor === 7 && (spec.id === 'diveKick' || spec.id === 'diveKickHeavy')) {
    dmg += 1; // Quake Amber heavy dive bonus
  }

  if (state.player.overloadTimer > 0) {
    dmg *= PLAYER_PHYSICS.OVERLOAD_DAMAGE_MULT; // Function Overload 1.40x
  }
  return Math.round(dmg * 100) / 100;
}

function emitVoltMeleeSpark(
  state: SimState,
  targetId: number,
  targetCx: number,
  targetCy: number,
): void {
  const p = state.player;
  const spark = spawnProjectile(state, {
    owner: 'player',
    kind: 'electric_arc',
    x: targetCx - 4,
    y: targetCy - 4,
    vx: p.facing * 4.4,
    vy: -1.4,
    w: 8,
    h: 8,
    damage: 0.5,
    ttl: 24,
    pierce: false,
    bouncesLeft: 0,
    color: '#38f8ff',
  });
  spark.hitIds.push(targetId);
  state.events.push({
    type: 'particle',
    kind: 'spark',
    x: targetCx,
    y: targetCy,
    color: '#38f8ff',
    count: 6,
  });
}

function shatterBreakablesInBox(state: SimState, box: Aabb): void {
  const left = Math.floor(box.x / TS);
  const right = Math.floor((box.x + box.w) / TS);
  const top = Math.floor(box.y / TS);
  const bottom = Math.floor((box.y + box.h) / TS);

  for (let ty = top; ty <= bottom; ty++) {
    for (let tx = left; tx <= right; tx++) {
      if (getTileAt(state, tx, ty) === TileType.BREAKABLE) {
        setTileAt(state, tx, ty, TileType.EMPTY);
        state.events.push({ type: 'sfx', key: 'breakable' });
        state.events.push({
          type: 'particle',
          kind: 'shard',
          x: (tx + 0.5) * TS,
          y: (ty + 0.5) * TS,
          color: '#cbd5e1',
          count: 8,
        });
      }
    }
  }
}

export function stepCombat(
  state: SimState,
  input: InputFrame,
  hooks?: CombatHooks,
): void {
  const p = state.player;
  if (p.action === 'dead' || p.action === 'hurt' || p.action === 'warp') {
    return;
  }

  const armor = getActiveArmorPaint(state);

  // Start a new melee attack when pressing Attack (and not holding a hookshot object)
  if (
    input.attackPressed &&
    p.hook.phase !== 'holding' &&
    p.attackTimer <= 2
  ) {
    const id = selectAttackId(state, input);
    const spec = ATTACK_DATA[id];
    p.attackId = id;
    p.attackTimer = spec.startupTicks + spec.activeTicks + spec.recoveryTicks;
    p.attackHitIds = [];

    if (id === 'hopKick' && p.grounded) {
      p.vy = -2.6;
      p.grounded = false;
    } else if (id === 'sprintKick') {
      p.vx = p.facing * Math.max(Math.abs(p.vx), 4.2);
    } else if (id === 'diveKick' || id === 'diveKickHeavy') {
      p.vy = Math.max(p.vy, 5.2);
      p.vx = p.facing * 2.2;

      // Armor Paint 1 (Solar Beam) & 11 (Apex Prismatic): Dive Kick fires downward/angled dive_beam (1.5 dmg)
      if (armor === 1 || armor === 11) {
        const beamDmg =
          p.overloadTimer > 0
            ? Math.round(1.5 * PLAYER_PHYSICS.OVERLOAD_DAMAGE_MULT * 100) / 100
            : 1.5;
        spawnProjectile(state, {
          owner: 'player',
          kind: 'dive_beam',
          x: p.x + p.w * 0.5 - 6 + p.facing * 4,
          y: p.y + p.h - 4,
          vx: p.facing * 3.8,
          vy: 6.2,
          w: 12,
          h: 16,
          damage: beamDmg,
          ttl: 36,
          pierce: false,
          bouncesLeft: 0,
          color: armor === 11 ? '#fef08a' : '#fde047',
        });
        state.events.push({
          type: 'particle',
          kind: 'spark',
          x: p.x + p.w * 0.5,
          y: p.y + p.h,
          color: '#fde047',
          count: 6,
        });
      }
    }

    const sfxKey =
      id === 'sprintKick'
        ? 'sprint_kick'
        : id === 'diveKick' || id === 'diveKickHeavy'
          ? 'dive_kick'
          : 'jab';
    state.events.push({ type: 'sfx', key: sfxKey });

    // Clone Array (Burst 9): echo attack with a synchronized piercing photonic wave
    if (p.cloneTimer > 0) {
      const cloneDmg = Math.round(1.5 * getBurstDamageMultiplier(state) * 100) / 100;
      spawnProjectile(state, {
        owner: 'player',
        kind: 'burst_beam',
        x: p.x + (p.facing === 1 ? p.w : -16),
        y: p.y + 6,
        vx: p.facing * 7.5,
        vy: 0,
        w: 16,
        h: 10,
        damage: cloneDmg,
        ttl: 34,
        pierce: true,
        bouncesLeft: 0,
        color: '#7cffcb',
      });
    }
  }

  if (!p.attackId || p.attackTimer <= 0) {
    p.attackId = null;
    p.attackTimer = 0;
    if (p.grounded) {
      p.diveKickTicks = 0;
    }
    return;
  }

  // Upgrade diveKick -> diveKickHeavy after >= 16 ticks of dive fall
  if (p.attackId === 'diveKick' || p.attackId === 'diveKickHeavy') {
    if (p.grounded) {
      // Landing ends dive kick cleanly
      p.attackId = null;
      p.attackTimer = 0;
      p.diveKickTicks = 0;
      return;
    }
    p.diveKickTicks += 1;
    p.vy = Math.max(p.vy, 5.4);
    if (p.diveKickTicks >= 16 && p.attackId === 'diveKick') {
      p.attackId = 'diveKickHeavy';
    }
  }

  const spec = ATTACK_DATA[p.attackId];
  const totalTicks = spec.startupTicks + spec.activeTicks + spec.recoveryTicks;
  const elapsed = totalTicks - p.attackTimer;

  // Evaluate hitbox during active frames
  if (elapsed >= spec.startupTicks && elapsed < spec.startupTicks + spec.activeTicks) {
    const hitbox = getAttackHitbox(state, spec);
    const dmg = computeMeleeDamage(state, spec);
    let bounced = false;

    shatterBreakablesInBox(state, hitbox);

    // Hit props (crates, barrels, switches)
    for (let i = 0; i < state.props.length; i++) {
      const prop = state.props[i];
      if (prop.grabbed || prop.hp <= 0 || p.attackHitIds.includes(prop.id)) {
        continue;
      }
      if (!aabbOverlap(hitbox, prop)) {
        continue;
      }
      if (prop.kind === 'switch') {
        p.attackHitIds.push(prop.id);
        prop.activated = !prop.activated;
        state.togglePhase = !state.togglePhase;
        state.events.push({ type: 'sfx', key: 'switch' });
      } else if (prop.kind === 'crate' || prop.kind === 'barrel') {
        p.attackHitIds.push(prop.id);
        prop.hp -= dmg;
        state.events.push({ type: 'sfx', key: 'hit' });
        if (prop.hp <= 0) {
          if (prop.kind === 'barrel') {
            explodeAt(state, prop.x + prop.w * 0.5, prop.y + prop.h * 0.5, 44, 5, hooks);
          } else {
            spawnBits(state, prop.x + prop.w * 0.5, prop.y + prop.h * 0.5, 5);
            state.events.push({ type: 'sfx', key: 'breakable' });
          }
        }
        if (spec.bounceOnHit) {
          bounced = true;
        }
      }
    }

    // Hit enemies
    for (let i = 0; i < state.enemies.length; i++) {
      const enemy = state.enemies[i];
      if (enemy.dead || enemy.grabbed || p.attackHitIds.includes(enemy.id)) {
        continue;
      }
      if (!aabbOverlap(hitbox, enemy)) {
        continue;
      }
      p.attackHitIds.push(enemy.id);
      const hit = damageEnemy(state, enemy, dmg, {
        armorBreak: spec.armorBreak,
        knockbackX: spec.knockbackX,
        knockbackY: spec.knockbackY,
        sourceX: p.x + p.w * 0.5,
        freezeTicks: spec.freezeTicks,
        onEnemyDefeated: hooks?.onEnemyDefeated,
      });
      if (hit) {
        // Armor Paint 4 (Volt Surge) & 11 (Apex Prismatic): emit electric_arc spark on melee hit
        if (armor === 4 || armor === 11) {
          emitVoltMeleeSpark(state, enemy.id, enemy.x + enemy.w * 0.5, enemy.y + enemy.h * 0.5);
        }
        if (spec.bounceOnHit) {
          bounced = true;
        }
      }
    }

    // Hit boss
    const boss = state.boss;
    if (boss && boss.active && !boss.defeated && !p.attackHitIds.includes(boss.id)) {
      if (aabbOverlap(hitbox, boss)) {
        p.attackHitIds.push(boss.id);
        const hit = damageBoss(state, boss, dmg, {
          armorBreak: spec.armorBreak,
          freezeTicks: spec.freezeTicks,
          onBossDefeated: hooks?.onBossDefeated,
        });
        if (hit) {
          if (armor === 4 || armor === 11) {
            emitVoltMeleeSpark(state, boss.id, boss.x + boss.w * 0.5, boss.y + boss.h * 0.5);
          }
          if (spec.bounceOnHit) {
            bounced = true;
          }
        }
      }
    }

    if (bounced) {
      if (spec.id === 'diveKick' || spec.id === 'diveKickHeavy') {
        p.vy = spec.id === 'diveKickHeavy' ? -5.0 : -4.4;
        p.vx = -p.facing * 1.4;
        p.airJumpsUsed = 0;
        p.diveKickTicks = 0;
        p.attackId = null;
        p.attackTimer = 0;
        const streak = (diveBounceStreakMap.get(p) ?? 0) + 1;
        diveBounceStreakMap.set(p, streak);
        if (streak >= 3 && !state.progression.unlockedChallenges.includes('chal_dive_bounce')) {
          state.progression.unlockedChallenges.push('chal_dive_bounce');
          state.progression.bits += 120;
          state.events.push({
            type: 'challengeUnlock',
            id: 'chal_dive_bounce',
            name: 'Skyward Rebound',
          });
        }
      } else if (spec.id === 'sprintKick') {
        p.vx = -p.facing * 2.0;
        p.vy = -2.8;
        p.grounded = false;
      }
    }
  }
}

export function explodeAt(
  state: SimState,
  cx: number,
  cy: number,
  radius: number,
  damage: number,
  hooks?: CombatHooks,
  isBurst = false,
): void {
  const box: Aabb = { x: cx - radius, y: cy - radius, w: radius * 2, h: radius * 2 };
  shatterBreakablesInBox(state, box);

  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (e.dead || e.grabbed) {
      continue;
    }
    const dx = e.x + e.w * 0.5 - cx;
    const dy = e.y + e.h * 0.5 - cy;
    if (dx * dx + dy * dy <= (radius + Math.max(e.w, e.h) * 0.5) ** 2) {
      damageEnemy(state, e, damage, {
        armorBreak: true,
        knockbackX: 3.5,
        knockbackY: -3.5,
        sourceX: cx,
        freezeTicks: 3,
        isBurst,
        onEnemyDefeated: hooks?.onEnemyDefeated,
      });
    }
  }

  const boss = state.boss;
  if (boss && boss.active && !boss.defeated) {
    const dx = boss.x + boss.w * 0.5 - cx;
    const dy = boss.y + boss.h * 0.5 - cy;
    if (dx * dx + dy * dy <= (radius + Math.max(boss.w, boss.h) * 0.5) ** 2) {
      damageBoss(state, boss, damage, {
        armorBreak: true,
        freezeTicks: 3,
        isBurst,
        onBossDefeated: hooks?.onBossDefeated,
      });
    }
  }

  state.camera.shakeTimer = Math.max(state.camera.shakeTimer, 10);
  state.camera.shakeIntensity = Math.max(state.camera.shakeIntensity, 3);
  state.events.push({ type: 'sfx', key: 'explosion' });
  state.events.push({ type: 'shake', ticks: 10, intensity: 3 });
  state.events.push({ type: 'rumble', weak: 0.5, strong: 0.75, durationMs: 160 });
  state.events.push({
    type: 'particle',
    kind: 'explosion',
    x: cx,
    y: cy,
    color: '#f97316',
    count: 14,
  });
}

function segmentIntersectsBox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  box: Aabb,
): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 6));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const px = x0 + (x1 - x0) * t;
    const py = y0 + (y1 - y0) * t;
    if (
      px >= box.x - 4 &&
      px <= box.x + box.w + 4 &&
      py >= box.y - 4 &&
      py <= box.y + box.h + 4
    ) {
      return true;
    }
  }
  return false;
}

export function stepProjectiles(state: SimState, hooks?: CombatHooks): void {
  const p = state.player;
  const frozen = p.freezeFieldTimer > 0;

  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const proj = state.projectiles[i];
    proj.ttl -= 1;
    if (proj.ttl <= 0) {
      // Hologram mine detonates cleanly on expiration as well
      if (proj.kind === 'hologram_mine') {
        explodeAt(
          state,
          proj.x + proj.w * 0.5,
          proj.y + proj.h * 0.5,
          44,
          proj.damage,
          hooks,
          true,
        );
      }
      state.projectiles.splice(i, 1);
      continue;
    }

    // Solid support platform stays static & can be hookshot-grabbed and thrown!
    if (proj.kind === 'support_platform') {
      if (p.hook.phase === 'extending') {
        const originX = p.x + p.w * 0.5;
        const originY = p.y + p.h * 0.5;
        if (segmentIntersectsBox(originX, originY, p.hook.tipX, p.hook.tipY, proj)) {
          p.hook.phase = 'holding';
          p.hook.heldKind = 'platform';
          p.hook.heldEntityId = proj.id;
          p.hook.heldSpriteKey = 'support_platform';
          p.hook.heldDamage = Math.max(HOOKSHOT_CONSTANTS.THROW_COLLISION_DAMAGE, proj.damage);
          p.hook.tipX = originX;
          p.hook.tipY = p.y - 10;
          state.events.push({ type: 'sfx', key: 'hook_grab' });
          state.projectiles.splice(i, 1);
        }
      }
      continue;
    }

    // Hologram mine decoy + proximity detonation
    if (proj.kind === 'hologram_mine') {
      const mcx = proj.x + proj.w * 0.5;
      const mcy = proj.y + proj.h * 0.5;
      let triggered = false;
      for (let j = 0; j < state.enemies.length; j++) {
        const e = state.enemies[j];
        if (!e.dead && !e.grabbed) {
          const dx = mcx - (e.x + e.w * 0.5);
          const dy = mcy - (e.y + e.h * 0.5);
          const distSq = dx * dx + dy * dy;
          if (distSq <= 96 * 96 && distSq > 32 * 32) {
            // Decoy draws nearby enemies toward the hologram
            e.facing = dx >= 0 ? 1 : -1;
          }
          if (distSq <= 32 * 32) {
            triggered = true;
            break;
          }
        }
      }
      if (!triggered && state.boss && state.boss.active && !state.boss.defeated) {
        const b = state.boss;
        const distSq = (b.x + b.w * 0.5 - mcx) ** 2 + (b.y + b.h * 0.5 - mcy) ** 2;
        if (distSq <= 42 * 42) {
          triggered = true;
        }
      }
      if (triggered) {
        explodeAt(state, mcx, mcy, 48, proj.damage, hooks, true);
        state.projectiles.splice(i, 1);
      }
      continue;
    }

    // Enemy / Boss projectiles slow drastically inside Gravity Freeze field
    const timeScale =
      frozen && (proj.owner === 'enemy' || proj.owner === 'boss') ? 0.15 : 1.0;

    // Electric arc homes toward nearest unhit enemy OR active boss
    if (proj.kind === 'electric_arc' && proj.owner === 'player') {
      const strongHoming = proj.w >= 12; // Current Arc (Burst 17)
      const range = strongHoming ? 180 : 96;
      const blend = strongHoming ? 0.26 : 0.18;
      let bestDistSq = range * range;
      let targetX = 0;
      let targetY = 0;
      let found = false;
      const pcx = proj.x + proj.w * 0.5;
      const pcy = proj.y + proj.h * 0.5;

      for (let j = 0; j < state.enemies.length; j++) {
        const e = state.enemies[j];
        if (e.dead || e.grabbed || proj.hitIds.includes(e.id)) {
          continue;
        }
        const dx = e.x + e.w * 0.5 - pcx;
        const dy = e.y + e.h * 0.5 - pcy;
        const dSq = dx * dx + dy * dy;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          targetX = dx;
          targetY = dy;
          found = true;
        }
      }

      const boss = state.boss;
      if (boss && boss.active && !boss.defeated && !proj.hitIds.includes(boss.id)) {
        const dx = boss.x + boss.w * 0.5 - pcx;
        const dy = boss.y + boss.h * 0.5 - pcy;
        const dSq = dx * dx + dy * dy;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          targetX = dx;
          targetY = dy;
          found = true;
        }
      }

      if (found) {
        const len = Math.max(0.001, Math.hypot(targetX, targetY));
        const speed = strongHoming ? 5.6 : 5.2;
        proj.vx = proj.vx * (1 - blend) + (targetX / len) * speed * blend;
        proj.vy = proj.vy * (1 - blend) + (targetY / len) * speed * blend;
      }
    }

    // Gravity on thrown objects
    if (proj.owner === 'thrown') {
      proj.vy = Math.min(6.5, proj.vy + 0.22);
    }

    let remove = false;
    const speedMag = Math.hypot(proj.vx, proj.vy);

    if (proj.owner === 'thrown') {
      const rx = moveAndCollideX(state, proj, proj.vx);
      proj.x = rx.x;
      const ry = moveAndCollideY(state, proj, proj.vy, false);
      proj.y = ry.y;

      const isDroppedShield =
        proj.kind === 'thrown_shield' && speedMag < 4.5 && proj.bouncesLeft <= 2;

      if (rx.hitX || ry.hitY) {
        if (proj.kind === 'thrown_barrel' && speedMag >= 2.2) {
          explodeAt(state, proj.x + proj.w * 0.5, proj.y + proj.h * 0.5, 48, proj.damage, hooks);
          remove = true;
        } else if (isDroppedShield) {
          if (rx.hitX) proj.vx *= -0.4;
          if (ry.hitY) {
            proj.vy = Math.abs(proj.vy) > 1.2 ? -proj.vy * 0.35 : 0;
            proj.vx *= 0.72;
          }
        } else if (proj.bouncesLeft > 0) {
          proj.bouncesLeft -= 1;
          proj.damage = HOOKSHOT_CONSTANTS.THROW_BOUNCE_DAMAGE;
          if (rx.hitX) proj.vx = -proj.vx * 0.65;
          if (ry.hitY) proj.vy = -Math.max(2.6, Math.abs(proj.vy) * 0.55);
          state.events.push({ type: 'sfx', key: 'bounce' });
          state.events.push({
            type: 'particle',
            kind: 'shockring',
            x: proj.x + proj.w * 0.5,
            y: proj.y + proj.h * 0.5,
            color: proj.color,
            count: 6,
          });
        } else {
          if (proj.kind === 'thrown_barrel' || proj.kind === 'thrown_enemy') {
            explodeAt(
              state,
              proj.x + proj.w * 0.5,
              proj.y + proj.h * 0.5,
              36,
              HOOKSHOT_CONSTANTS.THROW_BOUNCE_DAMAGE,
              hooks,
            );
          } else {
            state.events.push({ type: 'sfx', key: 'breakable' });
          }
          remove = true;
        }
      }

      // Check thrown collisions with enemies & boss when moving fast enough
      if (!remove && speedMag >= 2.0) {
        shatterBreakablesInBox(state, proj);

        for (let j = 0; j < state.enemies.length; j++) {
          const e = state.enemies[j];
          if (e.dead || e.grabbed || proj.hitIds.includes(e.id)) {
            continue;
          }
          if (!aabbOverlap(proj, e)) {
            continue;
          }
          proj.hitIds.push(e.id);
          if (proj.hitIds.length >= 2) {
            evaluateChallenges(state);
          }
          const dmg = proj.damage;
          damageEnemy(state, e, dmg, {
            armorBreak: true,
            knockbackX: 4.5,
            knockbackY: -3.2,
            sourceX: proj.x + proj.w * 0.5,
            freezeTicks: 4,
            onEnemyDefeated: hooks?.onEnemyDefeated,
          });

          // Explosive chain kill & bounce!
          if (e.dead || proj.kind === 'thrown_barrel') {
            addBurstEnergy(state, 15);
            explodeAt(
              state,
              e.x + e.w * 0.5,
              e.y + e.h * 0.5,
              proj.kind === 'thrown_barrel' ? 48 : 30,
              HOOKSHOT_CONSTANTS.THROW_BOUNCE_DAMAGE,
              hooks,
            );
          }

          if (proj.bouncesLeft > 0 && proj.kind !== 'thrown_barrel') {
            proj.bouncesLeft -= 1;
            proj.damage = HOOKSHOT_CONSTANTS.THROW_BOUNCE_DAMAGE;
            proj.vx = -proj.vx * 0.55;
            proj.vy = -3.8;
            state.events.push({ type: 'sfx', key: 'bounce' });
          } else {
            remove = true;
            break;
          }
        }

        const boss = state.boss;
        if (!remove && boss && boss.active && !boss.defeated && !proj.hitIds.includes(boss.id)) {
          if (aabbOverlap(proj, boss)) {
            proj.hitIds.push(boss.id);
            damageBoss(state, boss, proj.damage, {
              armorBreak: true,
              freezeTicks: 4,
              onBossDefeated: hooks?.onBossDefeated,
            });
            if (proj.kind === 'thrown_barrel') {
              explodeAt(
                state,
                proj.x + proj.w * 0.5,
                proj.y + proj.h * 0.5,
                40,
                HOOKSHOT_CONSTANTS.THROW_BOUNCE_DAMAGE,
                hooks,
              );
            }
            remove = true;
          }
        }
      }
    } else {
      // Standard player or enemy/boss projectile movement
      proj.x += proj.vx * timeScale;
      proj.y += proj.vy * timeScale;

      if (!proj.pierce) {
        const tx = Math.floor((proj.x + proj.w * 0.5) / TS);
        const ty = Math.floor((proj.y + proj.h * 0.5) / TS);
        const tile = getTileAt(state, tx, ty);
        if (tile === TileType.BREAKABLE && proj.owner === 'player') {
          setTileAt(state, tx, ty, TileType.EMPTY);
          state.events.push({ type: 'sfx', key: 'breakable' });
          remove = true;
        } else if (isSolidTile(state, tile, tx, ty)) {
          if (proj.bouncesLeft > 0) {
            proj.bouncesLeft -= 1;
            proj.vx = -proj.vx;
            proj.vy = -proj.vy;
            state.events.push({ type: 'sfx', key: 'bounce' });
          } else {
            remove = true;
          }
        }
      } else if (proj.owner === 'player') {
        shatterBreakablesInBox(state, proj);
      }

      if (!remove && proj.owner === 'player') {
        for (let j = 0; j < state.enemies.length; j++) {
          const e = state.enemies[j];
          if (e.dead || e.grabbed || proj.hitIds.includes(e.id)) {
            continue;
          }
          if (!aabbOverlap(proj, e)) {
            continue;
          }
          proj.hitIds.push(e.id);
          damageEnemy(state, e, proj.damage, {
            armorBreak:
              proj.kind === 'burst_beam' ||
              proj.kind === 'shockwave' ||
              proj.kind === 'dive_beam' ||
              proj.kind === 'phase_ball',
            knockbackX: 2.5,
            knockbackY: -1.8,
            sourceX: proj.x + proj.w * 0.5,
            freezeTicks: 2,
            onEnemyDefeated: hooks?.onEnemyDefeated,
          });
          if (!proj.pierce) {
            remove = true;
            break;
          }
        }

        const boss = state.boss;
        if (!remove && boss && boss.active && !boss.defeated && !proj.hitIds.includes(boss.id)) {
          if (aabbOverlap(proj, boss)) {
            proj.hitIds.push(boss.id);
            damageBoss(state, boss, proj.damage, {
              armorBreak:
                proj.kind === 'burst_beam' ||
                proj.kind === 'shockwave' ||
                proj.kind === 'dive_beam',
              freezeTicks: 2,
              isBurst: true,
              onBossDefeated: hooks?.onBossDefeated,
            });
            if (!proj.pierce) {
              remove = true;
            }
          }
        }
      } else if (!remove && (proj.owner === 'enemy' || proj.owner === 'boss')) {
        if (aabbOverlap(proj, p)) {
          // Catch Block chip (ID 6): frontal energy guard blocks shots while holding an object
          const projCx = proj.x + proj.w * 0.5;
          const pCx = p.x + p.w * 0.5;
          const fromFront =
            (p.facing === 1 && projCx >= pCx - 2) || (p.facing === -1 && projCx <= pCx + 2);
          if (hasChip(state, 6) && p.hook.phase === 'holding' && !proj.pierce && fromFront) {
            state.events.push(
              { type: 'sfx', key: 'switch', pitchJitter: 0.1 },
              {
                type: 'particle',
                kind: 'spark',
                x: projCx,
                y: proj.y + proj.h * 0.5,
                color: '#38bdf8',
                count: 6,
              },
            );
            remove = true;
          } else {
            applyDamageToPlayer(state, proj.damage, projCx);
            if (!proj.pierce) {
              remove = true;
            }
          }
        }
      }
    }

    // Cull far off-map projectiles
    const maxW = state.tilesW * TS + 64;
    const maxH = state.tilesH * TS + 64;
    if (remove || proj.x < -64 || proj.x > maxW || proj.y < -64 || proj.y > maxH) {
      state.projectiles.splice(i, 1);
    }
  }
}
