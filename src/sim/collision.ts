import {
  ENGINE_CONSTANTS,
  HOOKSHOT_CONSTANTS,
  PLAYER_PHYSICS,
  TileType,
  type PickupEntity,
  type PlayerState,
  type SimState,
} from '../contracts/index';

// ============================================================================
// Pure Tilemap & Swept Collision Engine (16x16 Grid, Sub-Stepped Hookshot)
// ============================================================================

const TS = ENGINE_CONSTANTS.TILE_SIZE;
const EPS = 0.001;
const CONVEYOR_SPEED = 1.25;
const PROXIMITY_SOLID_RADIUS_SQ = 72 * 72;

export interface Aabb {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MoveCollisionResult {
  x: number;
  y: number;
  hitX: boolean;
  hitY: boolean;
  grounded: boolean;
  onIce: boolean;
  conveyorVx: number;
  hitHazard: boolean;
  onBouncePad: boolean;
  touchedWall: -1 | 0 | 1;
}

export interface SweptHookshotHit {
  kind:
    | 'none'
    | 'solid'
    | 'breakable'
    | 'switch'
    | 'enemy'
    | 'boss'
    | 'prop'
    | 'pickup'
    | 'projectile';
  x: number;
  y: number;
  tileX?: number;
  tileY?: number;
  tileType?: TileType;
  entityId?: number;
}

export interface SweptHookshotHooks {
  ignoreEntityId?: number;
  catchProjectiles?: boolean;
  onPickup?: (pickup: PickupEntity) => void;
  onSubstep?: (x: number, y: number) => void;
}

export interface LedgeGrabResult {
  side: -1 | 1;
  snapX: number;
  snapY: number;
  tileX: number;
  tileY: number;
}

export function getTileAt(state: SimState, tx: number, ty: number): TileType {
  if (tx < 0 || tx >= state.tilesW) {
    return TileType.SOLID;
  }
  if (ty < 0 || ty >= state.tilesH) {
    return TileType.EMPTY;
  }
  return (state.tiles[ty * state.tilesW + tx] ?? TileType.EMPTY) as TileType;
}

export function setTileAt(state: SimState, tx: number, ty: number, tile: TileType): void {
  if (tx < 0 || tx >= state.tilesW || ty < 0 || ty >= state.tilesH) {
    return;
  }
  state.tiles[ty * state.tilesW + tx] = tile;
}

export function isSolidTile(
  state: SimState,
  tile: TileType,
  tx?: number,
  ty?: number,
): boolean {
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
    case TileType.PROXIMITY_SOLID: {
      if (tx === undefined || ty === undefined) {
        return true;
      }
      const p = state.player;
      const tileCx = (tx + 0.5) * TS;
      const tileCy = (ty + 0.5) * TS;
      const dx = tileCx - (p.x + p.w * 0.5);
      const dy = tileCy - (p.y + p.h * 0.5);
      return dx * dx + dy * dy <= PROXIMITY_SOLID_RADIUS_SQ;
    }
    default:
      return false;
  }
}

export function isOneWayTile(tile: TileType): boolean {
  return tile === TileType.ONE_WAY;
}

export function isHazardTile(tile: TileType): boolean {
  return tile === TileType.SPIKE || tile === TileType.ELECTRIC_RAIL;
}

export function aabbOverlap(a: Aabb, b: Aabb): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function checkHazardOverlap(state: SimState, x: number, y: number, w: number, h: number): boolean {
  const padX = Math.min(2, w * 0.25);
  const padY = Math.min(2, h * 0.25);
  const left = Math.floor((x + padX) / TS);
  const right = Math.floor((x + w - padX - EPS) / TS);
  const top = Math.floor((y + padY) / TS);
  const bottom = Math.floor((y + h - padY - EPS) / TS);

  for (let ty = top; ty <= bottom; ty++) {
    for (let tx = left; tx <= right; tx++) {
      if (isHazardTile(getTileAt(state, tx, ty))) {
        return true;
      }
    }
  }
  return false;
}

export function moveAndCollideX(
  state: SimState,
  box: Aabb,
  dx: number,
): MoveCollisionResult {
  let x = box.x + dx;
  const y = box.y;
  let hitX = false;
  let hitHazard = false;
  let touchedWall: -1 | 0 | 1 = 0;

  if (dx !== 0) {
    const top = Math.floor((y + EPS) / TS);
    const bottom = Math.floor((y + box.h - EPS) / TS);

    if (dx > 0) {
      const right = Math.floor((x + box.w - EPS) / TS);
      const startCol = Math.floor((box.x + box.w - EPS) / TS);
      outerRight: for (let tx = startCol; tx <= right; tx++) {
        for (let ty = top; ty <= bottom; ty++) {
          const tile = getTileAt(state, tx, ty);
          if (isSolidTile(state, tile, tx, ty)) {
            x = tx * TS - box.w;
            hitX = true;
            touchedWall = 1;
            if (isHazardTile(tile)) {
              hitHazard = true;
            }
            break outerRight;
          }
        }
      }
    } else {
      const left = Math.floor(x / TS);
      const startCol = Math.floor(box.x / TS);
      outerLeft: for (let tx = startCol; tx >= left; tx--) {
        for (let ty = top; ty <= bottom; ty++) {
          const tile = getTileAt(state, tx, ty);
          if (isSolidTile(state, tile, tx, ty)) {
            x = (tx + 1) * TS;
            hitX = true;
            touchedWall = -1;
            if (isHazardTile(tile)) {
              hitHazard = true;
            }
            break outerLeft;
          }
        }
      }
    }
  }

  if (!hitHazard && checkHazardOverlap(state, x, y, box.w, box.h)) {
    hitHazard = true;
  }

  return {
    x,
    y,
    hitX,
    hitY: false,
    grounded: false,
    onIce: false,
    conveyorVx: 0,
    hitHazard,
    onBouncePad: false,
    touchedWall,
  };
}

export function moveAndCollideY(
  state: SimState,
  box: Aabb,
  dy: number,
  dropThroughOneWay = false,
): MoveCollisionResult {
  const x = box.x;
  let y = box.y + dy;
  let hitY = false;
  let grounded = false;
  let onIce = false;
  let conveyorVx = 0;
  let hitHazard = false;
  let onBouncePad = false;

  const left = Math.floor((x + EPS) / TS);
  const right = Math.floor((x + box.w - EPS) / TS);

  if (dy >= 0) {
    const prevBottom = box.y + box.h;
    const startRow = Math.floor((prevBottom - EPS) / TS);
    const endRow = Math.floor((y + box.h - EPS) / TS);

    let landedRow = -1;
    for (let ty = startRow; ty <= endRow; ty++) {
      let rowBlocked = false;
      for (let tx = left; tx <= right; tx++) {
        const tile = getTileAt(state, tx, ty);
        if (isSolidTile(state, tile, tx, ty)) {
          rowBlocked = true;
          break;
        }
        if (!dropThroughOneWay && isOneWayTile(tile)) {
          const tileTop = ty * TS;
          if (prevBottom <= tileTop + 2.0 && y + box.h >= tileTop) {
            rowBlocked = true;
            break;
          }
        }
      }
      if (rowBlocked) {
        landedRow = ty;
        break;
      }
    }

    if (landedRow >= 0) {
      y = landedRow * TS - box.h;
      hitY = true;
      grounded = true;

      for (let tx = left; tx <= right; tx++) {
        const tile = getTileAt(state, tx, landedRow);
        if (tile === TileType.ICE) {
          onIce = true;
        } else if (tile === TileType.CONVEYOR_L) {
          conveyorVx = -CONVEYOR_SPEED;
        } else if (tile === TileType.CONVEYOR_R) {
          conveyorVx = CONVEYOR_SPEED;
        } else if (tile === TileType.BOUNCE_PAD) {
          onBouncePad = true;
        } else if (isHazardTile(tile)) {
          hitHazard = true;
        }
      }
    }

    // Check solid temporary support_platform projectiles
    if (!dropThroughOneWay) {
      for (let i = 0; i < state.projectiles.length; i++) {
        const proj = state.projectiles[i];
        if (!proj.solid || proj.ttl <= 0) {
          continue;
        }
        if (x + box.w > proj.x && x < proj.x + proj.w) {
          if (prevBottom <= proj.y + 2.5 && y + box.h >= proj.y) {
            y = proj.y - box.h;
            hitY = true;
            grounded = true;
          }
        }
      }
    }
  } else {
    const startRow = Math.floor(box.y / TS);
    const endRow = Math.floor(y / TS);

    outerUp: for (let ty = startRow; ty >= endRow; ty--) {
      for (let tx = left; tx <= right; tx++) {
        const tile = getTileAt(state, tx, ty);
        if (isSolidTile(state, tile, tx, ty)) {
          y = (ty + 1) * TS;
          hitY = true;
          if (isHazardTile(tile)) {
            hitHazard = true;
          }
          break outerUp;
        }
      }
    }
  }

  if (!hitHazard && checkHazardOverlap(state, x, y, box.w, box.h)) {
    hitHazard = true;
  }

  return {
    x,
    y,
    hitX: false,
    hitY,
    grounded,
    onIce,
    conveyorVx,
    hitHazard,
    onBouncePad,
    touchedWall: 0,
  };
}

/**
 * Checks whether a full 14x28 standing collider at top-left (x, y) is free of solid tiles.
 * Guarantees ceiling-wedge safety inside 1-tile (16 px) slide tunnels.
 */
export function canStandUpAt(state: SimState, x: number, y: number): boolean {
  const w = PLAYER_PHYSICS.STAND_W;
  const h = PLAYER_PHYSICS.STAND_H;
  const left = Math.floor((x + EPS) / TS);
  const right = Math.floor((x + w - EPS) / TS);
  const top = Math.floor((y + EPS) / TS);
  const bottom = Math.floor((y + h - EPS) / TS);

  for (let ty = top; ty <= bottom; ty++) {
    for (let tx = left; tx <= right; tx++) {
      const tile = getTileAt(state, tx, ty);
      if (isSolidTile(state, tile, tx, ty)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Checks if any solid tile touches the left (-1) or right (+1) side of box within `leeway` px.
 */
export function detectWallContact(
  state: SimState,
  box: Aabb,
  leeway = 1.0,
): -1 | 0 | 1 {
  const top = Math.floor((box.y + 4) / TS);
  const bottom = Math.floor((box.y + box.h - 4) / TS);

  // Check right wall
  const rightStart = Math.floor((box.x + box.w) / TS);
  const rightEnd = Math.floor((box.x + box.w + leeway) / TS);
  for (let tx = rightStart; tx <= rightEnd; tx++) {
    for (let ty = top; ty <= bottom; ty++) {
      const tile = getTileAt(state, tx, ty);
      if (isSolidTile(state, tile, tx, ty) && !isHazardTile(tile)) {
        return 1;
      }
    }
  }

  // Check left wall
  const leftEnd = Math.floor((box.x - leeway) / TS);
  const leftStart = Math.floor((box.x - EPS) / TS);
  for (let tx = leftStart; tx >= leftEnd; tx--) {
    for (let ty = top; ty <= bottom; ty++) {
      const tile = getTileAt(state, tx, ty);
      if (isSolidTile(state, tile, tx, ty) && !isHazardTile(tile)) {
        return -1;
      }
    }
  }

  return 0;
}

/**
 * Sub-stepped swept hookshot collision with step size <= HOOKSHOT_CONSTANTS.SUBSTEP_MAX_PX (4.0 px).
 * Prevents 30.0 px/tick hookshot from ever tunneling through 16 px tiles, breakables,
 * switches, enemies, boss, crates, barrels, shields, or pickups.
 */
export function sweptHookshotStep(
  state: SimState,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  hooks?: SweptHookshotHooks,
): SweptHookshotHit {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / HOOKSHOT_CONSTANTS.SUBSTEP_MAX_PX));
  const halfW = HOOKSHOT_CONSTANTS.TIP_W * 0.5;
  const halfH = HOOKSHOT_CONSTANTS.TIP_H * 0.5;

  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    const cx = x0 + dx * t;
    const cy = y0 + dy * t;
    hooks?.onSubstep?.(cx, cy);

    const tipBox: Aabb = {
      x: cx - halfW,
      y: cy - halfH,
      w: HOOKSHOT_CONSTANTS.TIP_W,
      h: HOOKSHOT_CONSTANTS.TIP_H,
    };

    // 1. Pickups (pull immediately; continue sweeping if callback handles pull-through)
    for (let i = 0; i < state.pickups.length; i++) {
      const pk = state.pickups[i];
      if (pk.collected) {
        continue;
      }
      const pkBox: Aabb = { x: pk.x - 6, y: pk.y - 6, w: 12, h: 12 };
      if (aabbOverlap(tipBox, pkBox)) {
        if (hooks?.onPickup) {
          hooks.onPickup(pk);
        } else {
          return { kind: 'pickup', x: cx, y: cy, entityId: pk.id };
        }
      }
    }

    // 2. Props (switches, crates, barrels)
    for (let i = 0; i < state.props.length; i++) {
      const prop = state.props[i];
      if (prop.grabbed || prop.hp <= 0) {
        continue;
      }
      if (prop.kind === 'switch') {
        if (aabbOverlap(tipBox, prop)) {
          return { kind: 'switch', x: cx, y: cy, entityId: prop.id };
        }
      } else if (prop.kind === 'crate' || prop.kind === 'barrel') {
        if (aabbOverlap(tipBox, prop)) {
          return { kind: 'prop', x: cx, y: cy, entityId: prop.id };
        }
      }
    }

    // 3. Grabbable dropped shields & catchable enemy projectiles (Catch Block chip)
    for (let i = 0; i < state.projectiles.length; i++) {
      const proj = state.projectiles[i];
      if (proj.ttl <= 0 || proj.id === hooks?.ignoreEntityId) {
        continue;
      }
      if (proj.kind === 'thrown_shield' && Math.hypot(proj.vx, proj.vy) < 4.5) {
        if (aabbOverlap(tipBox, proj)) {
          return { kind: 'projectile', x: cx, y: cy, entityId: proj.id };
        }
      } else if (
        hooks?.catchProjectiles &&
        (proj.owner === 'enemy' || proj.owner === 'boss') &&
        (proj.kind === 'enemy_shot' || proj.kind === 'phase_ball')
      ) {
        if (aabbOverlap(tipBox, proj)) {
          return { kind: 'projectile', x: cx, y: cy, entityId: proj.id };
        }
      }
    }

    // 4. Enemies
    for (let i = 0; i < state.enemies.length; i++) {
      const enemy = state.enemies[i];
      if (enemy.dead || enemy.grabbed || enemy.id === hooks?.ignoreEntityId) {
        continue;
      }
      if (aabbOverlap(tipBox, enemy)) {
        return { kind: 'enemy', x: cx, y: cy, entityId: enemy.id };
      }
    }

    // 5. Boss
    const boss = state.boss;
    if (boss && boss.active && !boss.defeated && boss.id !== hooks?.ignoreEntityId) {
      if (aabbOverlap(tipBox, boss)) {
        return { kind: 'boss', x: cx, y: cy, entityId: boss.id };
      }
    }

    // 6. Solid & Breakable Tiles
    const left = Math.floor(tipBox.x / TS);
    const right = Math.floor((tipBox.x + tipBox.w - EPS) / TS);
    const top = Math.floor(tipBox.y / TS);
    const bottom = Math.floor((tipBox.y + tipBox.h - EPS) / TS);

    for (let ty = top; ty <= bottom; ty++) {
      for (let tx = left; tx <= right; tx++) {
        const tile = getTileAt(state, tx, ty);
        if (tile === TileType.BREAKABLE) {
          return { kind: 'breakable', x: cx, y: cy, tileX: tx, tileY: ty, tileType: tile };
        }
        if (isSolidTile(state, tile, tx, ty)) {
          return { kind: 'solid', x: cx, y: cy, tileX: tx, tileY: ty, tileType: tile };
        }
      }
    }
  }

  return { kind: 'none', x: x1, y: y1 };
}

/**
 * Detects an automatic outer-corner solid ledge for ledge-hanging.
 */
export function detectLedgeGrab(
  state: SimState,
  player: PlayerState,
): LedgeGrabResult | null {
  if (
    player.grounded ||
    player.crouching ||
    player.sliding ||
    player.ledgeTimer > 0 ||
    player.vy < -0.5
  ) {
    return null;
  }

  const side = player.facing;
  const probeX = side === 1 ? player.x + player.w + 2 : player.x - 2;
  const frontTx = Math.floor(probeX / TS);
  const handTy = Math.floor((player.y + 4) / TS);

  const ledgeTile = getTileAt(state, frontTx, handTy);
  if (!isSolidTile(state, ledgeTile, frontTx, handTy) || isHazardTile(ledgeTile)) {
    return null;
  }

  // Must be an outer corner: tile directly above the ledge tile must be open
  const aboveLedgeTile = getTileAt(state, frontTx, handTy - 1);
  if (isSolidTile(state, aboveLedgeTile, frontTx, handTy - 1)) {
    return null;
  }

  // Vertical grab range near the top edge of the ledge tile
  const ledgeTopY = handTy * TS;
  if (player.y < ledgeTopY - 6 || player.y > ledgeTopY + 8) {
    return null;
  }

  const snapX = side === 1 ? frontTx * TS - player.w : (frontTx + 1) * TS;
  const snapY = ledgeTopY;

  // Ensure the hanging body does not overlap solid tiles at the snap position
  if (!canStandUpAt(state, snapX, snapY)) {
    return null;
  }

  return {
    side,
    snapX,
    snapY,
    tileX: frontTx,
    tileY: handTy,
  };
}
