import {
  DAMAGE_TABLES,
  ENGINE_CONSTANTS,
  PLAYER_PHYSICS,
  TileType,
  type HubTerminalKind,
  type InputFrame,
  type PickupEntity,
  type PropEntity,
  type SimState,
} from '../contracts/index';
import { getArmorPaintDefinition } from '../data/index';
import { getMaxBurstCharges, getMaxPlayerHp, hasEquippedChip } from './progression';

export interface WorldSimCallbacks {
  damagePlayer: (state: SimState, damage: number, sourceX: number) => void;
  onStageClear: (state: SimState) => void;
}

const TILE = ENGINE_CONSTANTS.TILE_SIZE;
const PICKUP_GRAVITY = 0.22;
const PICKUP_SIZE = 12;
const MAGNET_RADIUS = 96;
const TERMINAL_INTERACT_DX = 24;
const TERMINAL_INTERACT_DY = 32;
const PROXIMITY_RADIUS_SQ = 72 * 72;
const PULSE_BOUNCE_VY = -7.2;

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

function setTile(state: SimState, tx: number, ty: number, tile: TileType): void {
  if (tx < 0 || ty < 0 || tx >= state.tilesW || ty >= state.tilesH) return;
  state.tiles[ty * state.tilesW + tx] = tile;
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
    case TileType.BOUNCE_PAD:
      return true;
    case TileType.TOGGLE_A:
      return !state.togglePhase;
    case TileType.TOGGLE_B:
      return state.togglePhase;
    default:
      return false;
  }
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

function isPermanentCollectible(kind: PickupEntity['kind']): boolean {
  return (
    kind === 'rescue' ||
    kind === 'health_booster' ||
    kind === 'burst_booster' ||
    kind === 'palette_chip'
  );
}

function getCameraTileBounds(state: SimState): {
  minTx: number;
  maxTx: number;
  minTy: number;
  maxTy: number;
} {
  return {
    minTx: Math.max(0, Math.floor((state.camera.x - 32) / TILE)),
    maxTx: Math.min(
      state.tilesW - 1,
      Math.ceil((state.camera.x + ENGINE_CONSTANTS.GAME_WIDTH + 32) / TILE),
    ),
    minTy: Math.max(0, Math.floor((state.camera.y - 32) / TILE)),
    maxTy: Math.min(
      state.tilesH - 1,
      Math.ceil((state.camera.y + ENGINE_CONSTANTS.GAME_HEIGHT + 32) / TILE),
    ),
  };
}

export function getHubZoneStem(playerCenterX: number): 'command' | 'medbay' | 'dojo' {
  if (playerCenterX < 400) return 'command';
  if (playerCenterX < 800) return 'medbay';
  return 'dojo';
}

export function findNearbyHubTerminal(state: SimState): PropEntity | null {
  if (state.stageId !== 'hub') return null;
  const pCx = state.player.x + state.player.w * 0.5;
  const pCy = state.player.y + state.player.h * 0.5;

  let best: PropEntity | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < state.props.length; i++) {
    const prop = state.props[i];
    if (prop.kind !== 'hub_terminal' || !prop.terminalKind) continue;
    const tCx = prop.x + prop.w * 0.5;
    const tCy = prop.y + prop.h * 0.5;
    const dx = Math.abs(pCx - tCx);
    const dy = Math.abs(pCy - tCy);
    if (dx <= TERMINAL_INTERACT_DX && dy <= TERMINAL_INTERACT_DY) {
      const dist = dx + dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = prop;
      }
    }
  }
  return best;
}

export function tryInteractHubTerminal(
  state: SimState,
  input: InputFrame,
): HubTerminalKind | null {
  if (state.stageId !== 'hub' || state.screen !== 'playing') return null;
  if (!input.acceptPressed && input.moveY !== -1) return null;
  const terminal = findNearbyHubTerminal(state);
  if (!terminal || !terminal.terminalKind) return null;

  state.activeHubTerminal = terminal.terminalKind;
  state.screen = 'hub_modal';
  state.events.push({ type: 'sfx', key: 'menu_confirm' });
  return terminal.terminalKind;
}

function updatePickups(state: SimState): void {
  const player = state.player;
  const pCx = player.x + player.w * 0.5;
  const pCy = player.y + player.h * 0.5;
  const hasMagnet = hasEquippedChip(state.progression, 7);
  const hasRepairEnhancer = hasEquippedChip(state.progression, 17);
  const hasOverflow = hasEquippedChip(state.progression, 20);
  const hasEnergyMult = hasEquippedChip(state.progression, 10);

  for (let i = state.pickups.length - 1; i >= 0; i--) {
    const pk = state.pickups[i];
    if (pk.collected) {
      state.pickups.splice(i, 1);
      continue;
    }

    const permanent = isPermanentCollectible(pk.kind);

    if (!permanent) {
      if (pk.ttl > 0) {
        pk.ttl -= 1;
        if (pk.ttl <= 0) {
          state.pickups.splice(i, 1);
          continue;
        }
      }

      // Magnet Chassis pulls bits, health, and burst orbs cleanly toward Volt
      if (hasMagnet) {
        const dx = pCx - (pk.x + PICKUP_SIZE * 0.5);
        const dy = pCy - (pk.y + PICKUP_SIZE * 0.5);
        const dist = Math.hypot(dx, dy);
        if (dist > 1 && dist <= MAGNET_RADIUS) {
          const pull = 3.2;
          pk.vx += ((dx / dist) * pull - pk.vx) * 0.25;
          pk.vy += ((dy / dist) * pull - pk.vy) * 0.25;
        } else {
          pk.vy = Math.min(4.8, pk.vy + PICKUP_GRAVITY);
        }
      } else {
        pk.vy = Math.min(4.8, pk.vy + PICKUP_GRAVITY);
      }

      pk.x += pk.vx;
      const nextY = pk.y + pk.vy;
      const footTx = Math.floor((pk.x + PICKUP_SIZE * 0.5) / TILE);
      const footTy = Math.floor((nextY + PICKUP_SIZE) / TILE);
      const underTile = getTile(state, footTx, footTy);
      if (pk.vy >= 0 && (isSolid(state, underTile) || underTile === TileType.ONE_WAY)) {
        pk.y = footTy * TILE - PICKUP_SIZE;
        pk.vy = Math.abs(pk.vy) > 1.2 ? -pk.vy * 0.35 : 0;
        pk.vx *= 0.75;
      } else {
        pk.y = nextY;
      }
    }

    // Player collection check
    const hitSize = permanent ? 16 : PICKUP_SIZE;
    if (aabbOverlap(player.x, player.y, player.w, player.h, pk.x, pk.y, hitSize, hitSize)) {
      pk.collected = true;
      const cx = pk.x + hitSize * 0.5;
      const cy = pk.y + hitSize * 0.5;

      switch (pk.kind) {
        case 'bit_1':
        case 'bit_5':
        case 'bit_10':
        case 'bit_50': {
          state.progression.bits += pk.value;
          state.stageStats.bitsCollected += pk.value;
          state.events.push(
            { type: 'sfx', key: 'pickup_bit', pitchJitter: 0.08 },
            { type: 'particle', kind: 'spark', x: cx, y: cy, color: '#fbbf24', count: 4 },
          );
          break;
        }

        case 'health_small':
        case 'health_large': {
          const baseHeal = pk.value > 0 ? pk.value : pk.kind === 'health_large' ? 8 : 4;
          const healAmount = baseHeal + (hasRepairEnhancer ? 2 : 0);
          const beforeHp = player.hp;
          player.hp = Math.min(player.maxHp, player.hp + healAmount);
          const overflow = beforeHp + healAmount - player.maxHp;
          if (hasOverflow && overflow > 0) {
            const maxEnergy = player.maxBurstCharges * PLAYER_PHYSICS.BURST_ENERGY_PER_CHARGE;
            player.burstEnergy = Math.min(maxEnergy, player.burstEnergy + overflow * 15);
          }
          state.events.push(
            { type: 'sfx', key: 'pickup_hp' },
            { type: 'particle', kind: 'heal', x: cx, y: cy, color: '#4ade80', count: 6 },
          );
          break;
        }

        case 'burst_orb': {
          const rawGain = pk.value > 0 ? pk.value : 25;
          const gain = hasEnergyMult ? Math.round(rawGain * 1.35) : rawGain;
          const maxEnergy = player.maxBurstCharges * PLAYER_PHYSICS.BURST_ENERGY_PER_CHARGE;
          player.burstEnergy = Math.min(maxEnergy, player.burstEnergy + gain);
          state.events.push(
            { type: 'sfx', key: 'pickup_burst' },
            { type: 'particle', kind: 'burst', x: cx, y: cy, color: '#38f2ff', count: 6 },
          );
          break;
        }

        case 'rescue': {
          const idx = pk.rescueIndex ?? 1;
          const displayNum = idx >= 1 ? idx : idx + 1;
          const rescueKey = pk.spawnId ?? `${state.stageId}_rescue_${displayNum}`;
          state.stageStats.rescuesCollected += 1;
          if (!state.progression.rescuedIds.includes(rescueKey)) {
            state.progression.rescuedIds.push(rescueKey);
            state.progression.totalRescues += 1;
            state.progression.rescueTokens += 1;
          }
          state.events.push(
            { type: 'sfx', key: 'rescue' },
            { type: 'rescue', index: displayNum, total: state.progression.totalRescues },
            { type: 'particle', kind: 'heal', x: cx, y: cy, color: '#66fff2', count: 10 },
            { type: 'toast', text: `RESCUED UNIT #${displayNum}! (+1 TOKEN)`, tone: 'unlock' },
          );
          break;
        }

        case 'health_booster': {
          if (!state.progression.collectedHealthBoosters.includes(state.stageId)) {
            state.progression.collectedHealthBoosters.push(state.stageId);
          }
          player.maxHp = getMaxPlayerHp(state.progression);
          player.hp = player.maxHp;
          state.events.push(
            { type: 'sfx', key: 'pickup_hp' },
            { type: 'particle', kind: 'shockring', x: cx, y: cy, color: '#4ade80', count: 12 },
            { type: 'toast', text: 'HEALTH BOOSTER! MAX HP UP!', tone: 'unlock' },
          );
          break;
        }

        case 'burst_booster': {
          if (!state.progression.collectedBurstBoosters.includes(state.stageId)) {
            state.progression.collectedBurstBoosters.push(state.stageId);
          }
          player.maxBurstCharges = getMaxBurstCharges(state.progression);
          player.burstEnergy = player.maxBurstCharges * PLAYER_PHYSICS.BURST_ENERGY_PER_CHARGE;
          state.events.push(
            { type: 'sfx', key: 'pickup_burst' },
            { type: 'particle', kind: 'shockring', x: cx, y: cy, color: '#38d9ff', count: 12 },
            { type: 'toast', text: 'BURST BOOSTER! MAX BURST UP!', tone: 'unlock' },
          );
          break;
        }

        case 'palette_chip': {
          const armorId = pk.armorPaintId ?? 1;
          const armorDef = getArmorPaintDefinition(armorId);
          if (!state.progression.unlockedArmors.includes(armorId)) {
            state.progression.unlockedArmors.push(armorId);
            state.progression.unlockedArmors.sort((a, b) => a - b);
          }
          if (!state.progression.unlockedChallenges.includes('chal_palette_hunter')) {
            state.progression.unlockedChallenges.push('chal_palette_hunter');
          }
          state.events.push(
            { type: 'sfx', key: 'rescue' },
            { type: 'particle', kind: 'shockring', x: cx, y: cy, color: armorDef.palette[2], count: 14 },
            { type: 'toast', text: `ARMOR PAINT: ${armorDef.name.toUpperCase()}!`, tone: 'unlock' },
          );
          break;
        }
      }

      state.pickups.splice(i, 1);
    }
  }
}

function updateProps(state: SimState): void {
  const player = state.player;

  for (let i = state.props.length - 1; i >= 0; i--) {
    const prop = state.props[i];
    if (prop.grabbed) continue;

    if (prop.kind === 'checkpoint') {
      if (
        !prop.activated &&
        aabbOverlap(player.x, player.y, player.w, player.h, prop.x - 4, prop.y - 4, prop.w + 8, prop.h + 8)
      ) {
        prop.activated = true;
        player.lastSafeX = prop.x;
        player.lastSafeY = prop.y + prop.h - PLAYER_PHYSICS.STAND_H;
        state.events.push(
          { type: 'sfx', key: 'checkpoint' },
          { type: 'checkpoint', x: prop.x, y: prop.y },
          {
            type: 'particle',
            kind: 'spark',
            x: prop.x + prop.w * 0.5,
            y: prop.y + 6,
            color: '#38f2ff',
            count: 10,
          },
          { type: 'toast', text: 'CHECKPOINT SAVED', tone: 'info' },
        );
      }
      continue;
    }

    if (prop.kind === 'switch') {
      if (prop.hp <= 0) {
        prop.hp = 1;
        state.togglePhase = !state.togglePhase;
        state.events.push(
          { type: 'sfx', key: 'switch' },
          {
            type: 'particle',
            kind: 'spark',
            x: prop.x + prop.w * 0.5,
            y: prop.y + prop.h * 0.5,
            color: state.togglePhase ? '#38f2ff' : '#ff6b4a',
            count: 8,
          },
        );
      }
      prop.activated = state.togglePhase;
      continue;
    }

    if (prop.kind === 'walker') {
      // Keep parked Exo-Walker settled cleanly on floor
      const footTx = Math.floor((prop.x + prop.w * 0.5) / TILE);
      const footTy = Math.floor((prop.y + prop.h + 1) / TILE);
      const below = getTile(state, footTx, footTy);
      if (!isSolid(state, below) && below !== TileType.ONE_WAY) {
        prop.y += 2;
      }
      continue;
    }

    if (prop.kind === 'crate' || prop.kind === 'barrel') {
      if (prop.hp <= 0) {
        const cx = prop.x + prop.w * 0.5;
        const cy = prop.y + prop.h * 0.5;
        if (prop.kind === 'barrel') {
          const blastRadius =
            state.progression.loadouts[state.progression.activeLoadoutIndex].armorPaint === 2
              ? 64
              : 48;
          for (let j = 0; j < state.enemies.length; j++) {
            const en = state.enemies[j];
            if (en.dead) continue;
            const dist = Math.hypot(en.x + en.w * 0.5 - cx, en.y + en.h * 0.5 - cy);
            if (dist <= blastRadius) {
              en.shielded = false;
              en.hp -= 5;
              en.hurtFlash = 10;
              en.stunTimer = Math.max(en.stunTimer, 45);
            }
          }
          state.events.push(
            { type: 'sfx', key: 'explosion' },
            { type: 'shake', ticks: 8, intensity: 3 },
            { type: 'particle', kind: 'explosion', x: cx, y: cy, color: '#ff6b4a', count: 12 },
          );
        } else {
          state.events.push(
            { type: 'sfx', key: 'breakable' },
            { type: 'particle', kind: 'shard', x: cx, y: cy, color: '#d98a3b', count: 8 },
          );
        }

        // Deterministic crate/barrel drop
        const roll = nextRng(state);
        state.pickups.push({
          id: state.nextEntityId++,
          kind: roll < 0.35 ? 'health_small' : 'bit_5',
          x: cx - 5,
          y: cy - 5,
          vx: (nextRng(state) - 0.5) * 1.8,
          vy: -2.4,
          value: roll < 0.35 ? 4 : 5,
          ttl: 420,
          collected: false,
        });
        state.props.splice(i, 1);
      } else {
        // Keep crates/barrels settled on floor
        const footTx = Math.floor((prop.x + prop.w * 0.5) / TILE);
        const footTy = Math.floor((prop.y + prop.h + 1) / TILE);
        const below = getTile(state, footTx, footTy);
        if (!isSolid(state, below) && below !== TileType.ONE_WAY) {
          prop.y += 2;
        }
      }
    }
  }
}

// ============================================================================
// Biome Gimmick 1: solar_lasers — Periodic Laser Mirror Beams
// ============================================================================
function updateLaserMirrors(state: SimState, cb: WorldSimCallbacks): void {
  // Periodic 150-tick pulse: 0..89 idle, 90..119 telegraph, 120..149 active beam
  const cycleTick = state.tick % 150;
  if (cycleTick < 90) return;

  const isTelegraph = cycleTick < 120;
  const player = state.player;
  const { minTx, maxTx, minTy, maxTy } = getCameraTileBounds(state);
  const table = DAMAGE_TABLES[state.progression.difficulty];
  const beamDmg = state.progression.modifiers.doubleHazards ? table.hazard * 2 : table.hazard;

  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (getTile(state, tx, ty) !== TileType.LASER_MIRROR) continue;

      const beamX = tx * TILE + 4;
      const beamW = 8;
      const beamTop = (ty + 1) * TILE;

      if (isTelegraph) {
        if (cycleTick % 8 === 0) {
          state.events.push({
            type: 'particle',
            kind: 'spark',
            x: beamX + 4,
            y: beamTop + 2,
            color: '#ffdf5e',
            count: 2,
          });
        }
        continue;
      }

      // Active beam projects downward until first solid tile
      let endTy = ty + 1;
      while (endTy < state.tilesH && !isSolid(state, getTile(state, tx, endTy))) {
        endTy++;
      }
      const beamH = Math.max(TILE, (endTy - (ty + 1)) * TILE);

      if (cycleTick === 120) {
        state.events.push({ type: 'sfx', key: 'burst', gain: 0.45 });
      }
      if (cycleTick % 6 === 0) {
        state.events.push({
          type: 'particle',
          kind: 'spark',
          x: beamX + 4,
          y: beamTop + beamH - 2,
          color: '#ff6b4a',
          count: 2,
        });
      }

      if (
        player.invulnTimer <= 0 &&
        player.action !== 'dead' &&
        player.action !== 'warp' &&
        aabbOverlap(player.x, player.y, player.w, player.h, beamX, beamTop, beamW, beamH)
      ) {
        cb.damagePlayer(state, beamDmg, beamX + beamW * 0.5);
      }
    }
  }
}

// ============================================================================
// Biome Gimmick 2: scrap_crushers — Periodic Crushing Press Hazard Timing
// ============================================================================
function updateScrapCrushers(state: SimState, cb: WorldSimCallbacks): void {
  // Deterministic 120-tick press cycle:
  // 0..59 retracted (safe), 60..83 warning rumble, 84..103 slammed active, 104..119 retracting
  const cycle = state.tick % 120;
  if (cycle < 60 || cycle >= 104) return;

  const isTelegraph = cycle < 84;
  const player = state.player;
  const { minTx, maxTx, minTy, maxTy } = getCameraTileBounds(state);
  const table = DAMAGE_TABLES[state.progression.difficulty];
  const crusherDmg = state.progression.modifiers.doubleHazards
    ? table.hazard * 2
    : Math.max(3, table.heavyContact);

  let slammedSoundPlayed = false;

  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (getTile(state, tx, ty) !== TileType.CRUSHER) continue;

      const crushX = tx * TILE + 2;
      const crushW = TILE - 4;
      const crushTop = (ty + 1) * TILE;

      if (isTelegraph) {
        if (cycle % 8 === 0) {
          state.events.push({
            type: 'particle',
            kind: 'spark',
            x: tx * TILE + 8,
            y: crushTop + 2,
            color: '#ffd166',
            count: 2,
          });
        }
        continue;
      }

      // Compute crush column down to first solid floor (max 5 tiles = 80 px)
      let endTy = ty + 1;
      const maxEnd = Math.min(state.tilesH, ty + 6);
      while (endTy < maxEnd && !isSolid(state, getTile(state, tx, endTy))) {
        endTy++;
      }
      const crushH = Math.max(TILE, (endTy - (ty + 1)) * TILE);

      if (cycle === 84) {
        if (!slammedSoundPlayed) {
          slammedSoundPlayed = true;
          state.events.push(
            { type: 'sfx', key: 'heavy_hit', gain: 0.55 },
            { type: 'shake', ticks: 5, intensity: 1.5 },
          );
        }
        state.events.push({
          type: 'particle',
          kind: 'dust',
          x: tx * TILE + 8,
          y: crushTop + crushH - 2,
          color: '#f97316',
          count: 3,
        });
      }

      if (
        player.invulnTimer <= 0 &&
        player.action !== 'dead' &&
        player.action !== 'warp' &&
        aabbOverlap(player.x, player.y, player.w, player.h, crushX, crushTop, crushW, crushH)
      ) {
        cb.damagePlayer(state, crusherDmg, tx * TILE + 8);
      }
    }
  }
}

// ============================================================================
// Biome Gimmick 3: cryo_wind — Periodic Icy Blizzard Gusts
// ============================================================================
function updateCryoWind(state: SimState): void {
  if (state.biomeGimmick !== 'cryo_wind') return;

  // 240-tick deterministic gust cycle:
  // 0..119 calm breeze (-0.06), 120..149 rising gust, 150..219 strong gust (-0.26), 220..239 calming
  const cycle = state.tick % 240;
  let targetWind = -0.06;
  let gustStrength = 0;

  if (cycle >= 120 && cycle < 150) {
    const t = (cycle - 120) / 30;
    targetWind = -0.06 - t * 0.2;
    gustStrength = t * 0.4;
  } else if (cycle >= 150 && cycle < 220) {
    targetWind = -0.26;
    gustStrength = 1.0;
  } else if (cycle >= 220) {
    const t = (240 - cycle) / 20;
    targetWind = -0.06 - t * 0.2;
    gustStrength = t * 0.4;
  }

  state.windForce = targetWind;

  // Smoothly nudge airborne / unanchored Volt during icy gusts
  const p = state.player;
  if (
    gustStrength > 0 &&
    p.action !== 'dead' &&
    p.action !== 'warp' &&
    !p.grounded &&
    p.onWall === 0 &&
    p.onLedge === 0 &&
    p.hook.phase === 'idle'
  ) {
    const armor = state.progression.loadouts[state.progression.activeLoadoutIndex].armorPaint;
    const armorScale = armor === 3 ? 0.5 : 1.0; // Cryo Edge steadies Volt in blizzards
    p.vx = Math.max(-4.5, p.vx - 0.055 * gustStrength * armorScale);
  }

  // Deterministic frost-gust streak particles across viewport
  if (gustStrength > 0.25 && state.tick % 8 === 0) {
    const bandY = state.camera.y + 24 + ((state.tick * 37) % (ENGINE_CONSTANTS.GAME_HEIGHT - 48));
    state.events.push({
      type: 'particle',
      kind: 'spark',
      x: state.camera.x + ENGINE_CONSTANTS.GAME_WIDTH - 8,
      y: bandY,
      vx: -4.2,
      vy: 0.4,
      color: '#d8f3ff',
      count: 2,
    });
  }
}

// ============================================================================
// Biome Gimmick 4: surge_rails — Periodic Electric Rail Pulses
// ============================================================================
function updateSurgeRails(state: SimState, cb: WorldSimCallbacks): void {
  // Deterministic 120-tick high-voltage cycle:
  // 0..59 idle, 60..83 telegraph crackle, 84..113 active surge pulse, 114..119 cooldown
  const cycle = state.tick % 120;
  if (cycle < 60 || cycle >= 114) return;

  const isTelegraph = cycle < 84;
  const player = state.player;
  const { minTx, maxTx, minTy, maxTy } = getCameraTileBounds(state);
  const table = DAMAGE_TABLES[state.progression.difficulty];
  const hasSurgeProtector = hasEquippedChip(state.progression, 5);
  const basePulseDmg = Math.max(2, Math.floor(table.hazard * 0.6));
  const rawDmg = state.progression.modifiers.doubleHazards ? basePulseDmg * 2 : basePulseDmg;
  let crackleEmitted = false;

  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (getTile(state, tx, ty) !== TileType.ELECTRIC_RAIL) continue;

      if (isTelegraph) {
        if ((cycle + tx) % 10 === 0) {
          state.events.push({
            type: 'particle',
            kind: 'spark',
            x: tx * TILE + 8,
            y: ty * TILE + 8,
            color: '#facc15',
            count: 2,
          });
        }
        continue;
      }

      if (cycle === 84 && !crackleEmitted) {
        crackleEmitted = true;
        state.events.push({ type: 'sfx', key: 'switch', gain: 0.4, pitchJitter: 0.15 });
      }
      if ((cycle + tx * 3) % 8 === 0) {
        state.events.push({
          type: 'particle',
          kind: 'spark',
          x: tx * TILE + 8,
          y: ty * TILE + 8,
          color: '#5ce1ff',
          count: 2,
        });
      }

      // Active pulse zone extends slightly above rail floor and downward from ceiling coils
      const zoneX = tx * TILE - 2;
      const zoneY = ty * TILE - 8;
      const zoneW = TILE + 4;
      const zoneH = TILE + 24;

      if (
        player.invulnTimer <= 0 &&
        player.action !== 'dead' &&
        player.action !== 'warp' &&
        aabbOverlap(player.x, player.y, player.w, player.h, zoneX, zoneY, zoneW, zoneH)
      ) {
        if (hasSurgeProtector && !state.progression.modifiers.doubleHazards) {
          // Surge Protector insulates Volt from ambient rail discharge pulses!
          if (cycle % 10 === 0) {
            state.events.push({
              type: 'particle',
              kind: 'spark',
              x: player.x + player.w * 0.5,
              y: player.y + player.h * 0.5,
              color: '#38f2ff',
              count: 3,
            });
          }
          continue;
        }
        const appliedDmg = hasSurgeProtector ? Math.max(1, Math.floor(rawDmg * 0.5)) : rawDmg;
        cb.damagePlayer(state, appliedDmg, tx * TILE + 8);
      }
    }
  }
}

// ============================================================================
// Biome Gimmick 5: skyway_convoy — High-Speed Wind Drift on Open Freighter Decks
// ============================================================================
function updateSkywayConvoy(state: SimState): void {
  if (state.biomeGimmick !== 'skyway_convoy') return;

  const p = state.player;
  const pTx = Math.floor((p.x + p.w * 0.5) / TILE);
  const headTy = Math.floor(p.y / TILE);

  // Detect whether Volt is sheltered under a cargo hull roof or deck ceiling (rows 1..headTy-1)
  let sheltered = false;
  for (let ty = headTy - 1; ty >= 1; ty--) {
    if (isSolid(state, getTile(state, pTx, ty))) {
      sheltered = true;
      break;
    }
  }

  if (sheltered) {
    state.windForce = -0.04;
    return;
  }

  // Open freighter deck: steady high-speed slipstream + rhythmic jet wash
  const jetOsc = Math.sin(state.tick * 0.035) * 0.06;
  state.windForce = -0.22 + jetOsc;

  if (
    p.action !== 'dead' &&
    p.action !== 'warp' &&
    !p.grounded &&
    p.onWall === 0 &&
    p.onLedge === 0 &&
    p.hook.phase === 'idle'
  ) {
    p.vx = Math.max(-4.8, p.vx - 0.045);
  }

  if (state.tick % 9 === 0) {
    const streakY = state.camera.y + 18 + ((state.tick * 43) % (ENGINE_CONSTANTS.GAME_HEIGHT - 36));
    state.events.push({
      type: 'particle',
      kind: 'dust',
      x: state.camera.x + ENGINE_CONSTANTS.GAME_WIDTH - 4,
      y: streakY,
      vx: -5.4,
      vy: 0,
      color: '#fda4af',
      count: 2,
    });
  }
}

// ============================================================================
// Biome Gimmick 6: pulse_rhythm — 120 BPM Beat Toggle & High-Spring BOUNCE_PAD
// ============================================================================
function updatePulseRhythmAndBouncePads(state: SimState, input?: InputFrame): void {
  // 120 BPM = 30 ticks/beat; toggle TOGGLE_A/B cleanly every 4-beat bar (120 ticks)
  state.rhythmBeat = Math.floor(state.tick / 30) % 4;
  if (state.biomeGimmick === 'pulse_rhythm' && state.tick > 0) {
    const barTick = state.tick % 120;
    if (barTick === 0) {
      state.togglePhase = !state.togglePhase;
      state.events.push({ type: 'sfx', key: 'switch', gain: 0.35 });
    } else if (barTick === 90) {
      // Beat 3 telegraph shimmer near player
      state.events.push({
        type: 'particle',
        kind: 'spark',
        x: state.player.x + state.player.w * 0.5,
        y: state.player.y - 6,
        color: state.togglePhase ? '#ff4d6d' : '#4ee7ff',
        count: 2,
      });
    }
  }

  // BOUNCE_PAD high-spring launch (vy = -7.2, or -8.0 when holding jump!)
  const p = state.player;
  if (p.action === 'dead' || p.action === 'warp') return;

  const footY = p.y + p.h;
  const footTy = Math.floor((footY + 1) / TILE);
  const tileTop = footTy * TILE;
  if (Math.abs(footY - tileTop) > 3) return;

  const leftTx = Math.floor((p.x + 1) / TILE);
  const rightTx = Math.floor((p.x + p.w - 1) / TILE);
  let onBounce = false;
  for (let tx = leftTx; tx <= rightTx; tx++) {
    if (getTile(state, tx, footTy) === TileType.BOUNCE_PAD) {
      onBounce = true;
      break;
    }
  }

  if (onBounce && p.vy > PULSE_BOUNCE_VY) {
    const targetVy = input?.jump ? Math.min(p.vy, -8.0) : PULSE_BOUNCE_VY;
    const wasIdle = p.vy >= 0;
    p.vy = targetVy;
    p.grounded = false;
    p.airJumpsUsed = 0;
    p.leftGroundTick = -999;
    if (wasIdle) {
      state.events.push(
        { type: 'sfx', key: 'bounce', pitchJitter: 0.08 },
        {
          type: 'particle',
          kind: 'shockring',
          x: p.x + p.w * 0.5,
          y: p.y + p.h,
          color: '#4dffb5',
          count: 8,
        },
      );
    }
  }
}

// ============================================================================
// Biome Gimmick 7: quarry_walker — Power Exo-Walker Mount, Stomp & Dismount
// ============================================================================
function emitWalkerStompShockwave(state: SimState): void {
  const p = state.player;
  const cx = p.x + p.w * 0.5;
  const footY = p.y + p.h;

  // Spawn twin floor shockwaves left and right
  for (const dir of [-1, 1] as const) {
    state.projectiles.push({
      id: state.nextEntityId++,
      owner: 'player',
      kind: 'shockwave',
      x: cx - 7 + dir * 10,
      y: footY - 14,
      vx: dir * 4.4,
      vy: 0,
      w: 14,
      h: 14,
      damage: 3,
      ttl: 34,
      pierce: true,
      bouncesLeft: 0,
      color: '#f97316',
      hitIds: [],
    });
  }

  // Shatter adjacent/underlying BREAKABLE basalt tiles
  const minTx = Math.floor((p.x - 16) / TILE);
  const maxTx = Math.floor((p.x + p.w + 16) / TILE);
  const minTy = Math.floor(p.y / TILE);
  const maxTy = Math.floor((footY + 4) / TILE);
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (getTile(state, tx, ty) === TileType.BREAKABLE) {
        setTile(state, tx, ty, TileType.EMPTY);
        state.events.push(
          { type: 'sfx', key: 'breakable' },
          {
            type: 'particle',
            kind: 'shard',
            x: tx * TILE + 8,
            y: ty * TILE + 8,
            color: '#c7b0aa',
            count: 6,
          },
        );
      }
    }
  }

  state.camera.shakeTimer = Math.max(state.camera.shakeTimer, 7);
  state.camera.shakeIntensity = Math.max(state.camera.shakeIntensity, 2.5);
  state.events.push(
    { type: 'sfx', key: 'heavy_hit', gain: 0.9 },
    { type: 'shake', ticks: 7, intensity: 2.5 },
    { type: 'particle', kind: 'shockring', x: cx, y: footY, color: '#f97316', count: 10 },
  );
}

function updateQuarryWalker(state: SimState, input?: InputFrame): void {
  const p = state.player;
  if (p.action === 'dead' || p.action === 'warp') return;

  // Active piloting state
  if (p.inWalker) {
    if (p.walkerHp <= 0) {
      p.inWalker = false;
      // Remove destroyed walker prop
      for (let i = state.props.length - 1; i >= 0; i--) {
        if (state.props[i].kind === 'walker' && state.props[i].grabbed) {
          state.props.splice(i, 1);
          break;
        }
      }
      return;
    }

    // Down + Jump dismounts Volt safely upward and parks the Exo-Walker in place!
    if (input && input.moveY === 1 && input.jumpPressed) {
      p.inWalker = false;
      p.vy = -5.5;
      p.grounded = false;
      p.invulnTimer = Math.max(p.invulnTimer, 20);
      p.jumpBufferTick = -999;

      for (let i = 0; i < state.props.length; i++) {
        const prop = state.props[i];
        if (prop.kind === 'walker' && prop.grabbed) {
          prop.grabbed = false;
          prop.activated = false;
          prop.x = p.x + p.w * 0.5 - prop.w * 0.5;
          prop.y = p.y + p.h - prop.h;
          prop.hp = Math.max(1, p.walkerHp);
          break;
        }
      }

      state.events.push(
        { type: 'sfx', key: 'jump' },
        {
          type: 'particle',
          kind: 'dust',
          x: p.x + p.w * 0.5,
          y: p.y + p.h,
          color: '#cbd5e1',
          count: 8,
        },
        { type: 'toast', text: 'EXO-WALKER DISMOUNTED', tone: 'info' },
      );
      return;
    }

    // Stomp shockwave on hard landing (detected via physics land SFX) or grounded attack slam
    let landedThisTick = false;
    for (let i = 0; i < state.events.length; i++) {
      const ev = state.events[i];
      if (ev.type === 'sfx' && ev.key === 'land') {
        landedThisTick = true;
        break;
      }
    }

    if (landedThisTick || (p.grounded && Boolean(input?.attackPressed))) {
      emitWalkerStompShockwave(state);
    }
    return;
  }

  // Not in walker: check interaction with parked walker props to mount!
  if (!input || input.moveY === 1) return;
  const wantsInteract = input.acceptPressed || input.moveY === -1;
  if (!wantsInteract) return;

  for (let i = 0; i < state.props.length; i++) {
    const prop = state.props[i];
    if (prop.kind !== 'walker' || prop.grabbed || prop.hp <= 0) continue;
    if (
      aabbOverlap(
        p.x,
        p.y,
        p.w,
        p.h,
        prop.x - 4,
        prop.y - 4,
        prop.w + 8,
        prop.h + 8,
      )
    ) {
      p.inWalker = true;
      p.walkerHp = prop.hp > 0 ? prop.hp : 12;
      p.y = prop.y + prop.h - p.h;
      p.vy = 0;
      p.grounded = true;
      p.jumpBufferTick = -999;
      prop.grabbed = true;
      prop.activated = true;
      state.events.push(
        { type: 'sfx', key: 'checkpoint' },
        {
          type: 'particle',
          kind: 'shockring',
          x: p.x + p.w * 0.5,
          y: p.y + p.h * 0.5,
          color: '#f97316',
          count: 10,
        },
        { type: 'toast', text: 'POWER EXO-WALKER MOUNTED! (DOWN+JUMP TO DISMOUNT)', tone: 'info' },
      );
      return;
    }
  }
}

// ============================================================================
// Biome Gimmick 8: neon_matrix — Proximity Detection & Switch-Toggled Cyber Blocks
// ============================================================================
function updateNeonMatrix(state: SimState): void {
  const p = state.player;
  const pCx = p.x + p.w * 0.5;
  const pCy = p.y + p.h * 0.5;
  const { minTx, maxTx, minTy, maxTy } = getCameraTileBounds(state);
  let sparkBudget = 2;

  for (let ty = minTy; ty <= maxTy && sparkBudget > 0; ty++) {
    for (let tx = minTx; tx <= maxTx && sparkBudget > 0; tx++) {
      if (getTile(state, tx, ty) !== TileType.PROXIMITY_SOLID) continue;

      const tileCx = (tx + 0.5) * TILE;
      const tileCy = (ty + 0.5) * TILE;
      const dx = tileCx - pCx;
      const dy = tileCy - pCy;
      if (dx * dx + dy * dy <= PROXIMITY_RADIUS_SQ) {
        if ((state.tick + tx * 7 + ty * 13) % 24 === 0) {
          sparkBudget -= 1;
          state.events.push({
            type: 'particle',
            kind: 'spark',
            x: tileCx,
            y: tileCy,
            color: '#86efac',
            count: 2,
          });
        }
      }
    }
  }
}

export function updateWorld(
  state: SimState,
  cb: WorldSimCallbacks,
  input?: InputFrame,
): void {
  // 1. Pulse Rhythm 120 BPM toggle & High-Spring BOUNCE_PAD launch
  updatePulseRhythmAndBouncePads(state, input);

  // 2. Hub 3-stem BGM switching & terminal interaction (deterministic, zero external state)
  if (state.stageId === 'hub') {
    const curCx = state.player.x + state.player.w * 0.5;
    const prevCx = curCx - state.player.vx;
    const curStem = getHubZoneStem(curCx);
    const prevStem = getHubZoneStem(prevCx);
    if (state.tick === 1 || curStem !== prevStem) {
      state.events.push({ type: 'bgmStem', stem: curStem });
    }
    if (input) {
      tryInteractHubTerminal(state, input);
    }
  }

  // 3. Pickups (gravity, Magnet Chassis, collection, Repair Enhancer, Overflow Converter)
  updatePickups(state);

  // 4. Props (checkpoints, switches, breakable crates/barrels, parked walkers)
  updateProps(state);

  // 5. All Biome Gimmicks (100% deterministic, pure simulation)
  updateLaserMirrors(state, cb);
  updateScrapCrushers(state, cb);
  updateCryoWind(state);
  updateSurgeRails(state, cb);
  updateSkywayConvoy(state);
  updateQuarryWalker(state, input);
  updateNeonMatrix(state);

  // 6. Goal Door tile check & Stage Clear timer
  if (state.stageClearTimer > 0) {
    state.stageClearTimer -= 1;
    if (state.stageClearTimer === 0) {
      cb.onStageClear(state);
    }
  } else if (!state.boss || state.boss.defeated) {
    const pTx = Math.floor((state.player.x + state.player.w * 0.5) / TILE);
    const pTy = Math.floor((state.player.y + state.player.h * 0.5) / TILE);
    if (getTile(state, pTx, pTy) === TileType.GOAL_DOOR) {
      cb.onStageClear(state);
    }
  }
}
