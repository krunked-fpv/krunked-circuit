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
          const idx = pk.rescueIndex ?? 0;
          const rescueKey = `${state.stageId}:rescue_${idx}`;
          state.stageStats.rescuesCollected += 1;
          if (!state.progression.rescuedIds.includes(rescueKey)) {
            state.progression.rescuedIds.push(rescueKey);
            state.progression.totalRescues += 1;
            state.progression.rescueTokens += 1;
          }
          state.events.push(
            { type: 'sfx', key: 'rescue' },
            { type: 'rescue', index: idx, total: state.progression.totalRescues },
            { type: 'particle', kind: 'heal', x: cx, y: cy, color: '#66fff2', count: 10 },
            { type: 'toast', text: `RESCUED UNIT #${idx + 1}! (+1 TOKEN)`, tone: 'unlock' },
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
        prop.activated = state.togglePhase;
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

function updateLaserMirrors(state: SimState, cb: WorldSimCallbacks): void {
  // Periodic 150-tick pulse: 0..89 idle, 90..119 telegraph, 120..149 active beam
  const cycleTick = state.tick % 150;
  if (cycleTick < 90) return;

  const isTelegraph = cycleTick < 120;
  const player = state.player;
  const camMinTx = Math.max(0, Math.floor((state.camera.x - 32) / TILE));
  const camMaxTx = Math.min(state.tilesW - 1, Math.ceil((state.camera.x + ENGINE_CONSTANTS.GAME_WIDTH + 32) / TILE));
  const camMinTy = Math.max(0, Math.floor((state.camera.y - 32) / TILE));
  const camMaxTy = Math.min(state.tilesH - 1, Math.ceil((state.camera.y + ENGINE_CONSTANTS.GAME_HEIGHT + 32) / TILE));

  const table = DAMAGE_TABLES[state.progression.difficulty];
  const beamDmg = state.progression.modifiers.doubleHazards ? table.hazard * 2 : table.hazard;

  for (let ty = camMinTy; ty <= camMaxTy; ty++) {
    for (let tx = camMinTx; tx <= camMaxTx; tx++) {
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

export function updateWorld(
  state: SimState,
  cb: WorldSimCallbacks,
  input?: InputFrame,
): void {
  // 1. Rhythm beat counter (120 BPM = 30 ticks/beat)
  const prevBeat = state.rhythmBeat;
  state.rhythmBeat = Math.floor(state.tick / 30) % 4;
  if (state.biomeGimmick === 'pulse_rhythm' && state.rhythmBeat !== prevBeat && state.rhythmBeat === 0) {
    state.togglePhase = !state.togglePhase;
  }

  // 2. Hub 3-stem BGM switching by player X zone (deterministic, zero external state)
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

  // 4. Props (checkpoints, switches, breakable crates/barrels)
  updateProps(state);

  // 5. Laser Mirror pulsing hazards
  updateLaserMirrors(state, cb);

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
