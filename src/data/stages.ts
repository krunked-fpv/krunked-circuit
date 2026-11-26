import {
  ENGINE_CONSTANTS,
  OFFICIAL_STAGE_IDS,
  REMIXABLE_STAGES,
  TileType,
  type ArmorPaintId,
  type SpawnPoint,
  type StageDefinition,
  type StageId,
} from '../contracts/index';

const TILE = ENGINE_CONSTANTS.TILE_SIZE;
const CELL_W = ENGINE_CONSTANTS.CELL_TILES_W;
const CELL_H = ENGINE_CONSTANTS.CELL_TILES_H;

function px(tile: number): number {
  return tile * TILE;
}

function standY(floorRow: number, entityHeight: number): number {
  return floorRow * TILE - entityHeight;
}

class TilemapBuilder {
  readonly cellsW: number;
  readonly cellsH: number;
  readonly tilesW: number;
  readonly tilesH: number;
  readonly tiles: number[];

  constructor(cellsW: number, cellsH: number) {
    this.cellsW = cellsW;
    this.cellsH = cellsH;
    this.tilesW = cellsW * CELL_W;
    this.tilesH = cellsH * CELL_H;
    this.tiles = new Array<number>(this.tilesW * this.tilesH).fill(TileType.EMPTY);
  }

  get(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.tilesW || ty >= this.tilesH) return TileType.SOLID;
    return this.tiles[ty * this.tilesW + tx] ?? TileType.EMPTY;
  }

  set(tx: number, ty: number, tile: number): void {
    if (tx < 0 || ty < 0 || tx >= this.tilesW || ty >= this.tilesH) return;
    this.tiles[ty * this.tilesW + tx] = tile;
  }

  fillRect(tx: number, ty: number, w: number, h: number, tile: number): void {
    for (let y = ty; y < ty + h; y++) {
      for (let x = tx; x < tx + w; x++) {
        this.set(x, y, tile);
      }
    }
  }

  clearRect(tx: number, ty: number, w: number, h: number): void {
    this.fillRect(tx, ty, w, h, TileType.EMPTY);
  }

  buildOuterFrame(ceilingRows = 2): void {
    if (ceilingRows > 0) {
      this.fillRect(0, 0, this.tilesW, ceilingRows, TileType.SOLID);
    }
    this.fillRect(0, 0, 1, this.tilesH, TileType.SOLID);
    this.fillRect(this.tilesW - 1, 0, 1, this.tilesH, TileType.SOLID);
  }

  buildDualDeckBase(ceilingRows = 2): void {
    this.buildOuterFrame(ceilingRows);
    this.fillRect(0, 13, this.tilesW, 4, TileType.SOLID);
    this.fillRect(0, 28, this.tilesW, 2, TileType.SOLID);
  }

  buildPlatform(tx: number, ty: number, w: number, tile: number = TileType.ONE_WAY): void {
    this.fillRect(tx, ty, w, 1, tile);
  }

  /**
   * Carves a traversable vertical shaft through the middle separator deck (rows 13..16)
   * with alternating ONE_WAY climb ledges so the player can always go both up and down.
   */
  carveDeckShaft(tx: number, width: number, addGuideWalls = false): void {
    this.clearRect(tx, 13, width, 4);
    if (addGuideWalls) {
      this.fillRect(tx - 1, 17, 1, 8, TileType.SOLID);
      this.fillRect(tx + width, 17, 1, 8, TileType.SOLID);
    }
    const ledgeW = Math.min(width, Math.max(2, Math.floor(width * 0.6)));
    this.buildPlatform(tx, 25, ledgeW, TileType.ONE_WAY);
    this.buildPlatform(tx + width - ledgeW, 22, ledgeW, TileType.ONE_WAY);
    this.buildPlatform(tx, 19, ledgeW, TileType.ONE_WAY);
    this.buildPlatform(tx + width - ledgeW, 16, ledgeW, TileType.ONE_WAY);
    this.buildPlatform(tx, 13, width, TileType.ONE_WAY);
  }

  /**
   * Builds a 1-tile (16 px) slide underpass above `floorRow`, leaving row `floorRow - 1` clear.
   */
  buildSlideVent(tx: number, width: number, topRow: number, floorRow: number): void {
    const wallH = floorRow - 1 - topRow;
    if (wallH > 0) {
      this.fillRect(tx, topRow, width, wallH, TileType.SOLID);
    }
    this.clearRect(tx, floorRow - 1, width, 1);
  }

  /**
   * Builds a clean boss arena in cell (cellX, cellY) with solid floor on local rows 13..14,
   * an open 4-tile entry doorway on the left wall (local rows 9..12), and symmetric platforms.
   */
  buildBossArena(
    cellX: number,
    cellY: number,
    withPlatforms = true,
    platformTile: number = TileType.ONE_WAY,
  ): void {
    const bx = cellX * CELL_W;
    const by = cellY * CELL_H;
    // Clear interior open space (local cols 1..23, local rows 2..12)
    this.clearRect(bx + 1, by + 2, CELL_W - 2, 11);
    // Solid ceiling and floor
    this.fillRect(bx, by, CELL_W, 2, TileType.SOLID);
    this.fillRect(bx, by + 13, CELL_W, 2, TileType.SOLID);
    // Right boundary wall
    this.fillRect(bx + CELL_W - 1, by, 1, CELL_H, TileType.SOLID);
    // Entry bulkhead on left edge leaving local rows 9..12 open (4 tiles tall)
    if (cellX > 0) {
      this.fillRect(bx, by + 2, 1, 7, TileType.SOLID);
      this.clearRect(bx - 1, by + 9, 2, 4);
    }
    if (withPlatforms) {
      this.buildPlatform(bx + 4, by + 10, 4, platformTile);
      this.buildPlatform(bx + 17, by + 10, 4, platformTile);
    }
  }
}

function makeMainCollectibles(
  stageId: StageId,
  armorPaintId: ArmorPaintId,
  rescueCoords: readonly (readonly [number, number])[],
  hpBooster: readonly [number, number],
  burstBooster: readonly [number, number],
  paletteChip: readonly [number, number],
): SpawnPoint[] {
  const out: SpawnPoint[] = [];
  for (let i = 0; i < rescueCoords.length; i++) {
    const [tx, floorRow] = rescueCoords[i];
    const rescueNum = i + 1;
    out.push({
      id: `${stageId}_rescue_${rescueNum}`,
      kind: 'rescue',
      x: px(tx),
      y: standY(floorRow, 18),
      rescueIndex: rescueNum,
    });
  }
  out.push(
    {
      id: `${stageId}_hp_booster`,
      kind: 'health_booster',
      x: px(hpBooster[0]),
      y: standY(hpBooster[1], 18),
    },
    {
      id: `${stageId}_burst_booster`,
      kind: 'burst_booster',
      x: px(burstBooster[0]),
      y: standY(burstBooster[1], 18),
    },
    {
      id: `${stageId}_palette_chip`,
      kind: 'palette_chip',
      x: px(paletteChip[0]),
      y: standY(paletteChip[1], 18),
      armorPaintId,
    },
  );
  return out;
}

function titleWithRemix(baseName: string, remix: boolean): string {
  return remix ? `${baseName} [MASTER]` : baseName;
}

function subtitleWithRemix(baseSub: string, remix: boolean): string {
  return remix ? `${baseSub} — Master Remix` : baseSub;
}

// ============================================================================
// 1. HUB — Circuit Guard HQ Command Deck (3x1 cells = 75x15)
// ============================================================================
function createHubStage(): StageDefinition {
  const b = new TilemapBuilder(3, 1);
  b.buildOuterFrame(2);
  b.fillRect(0, 13, b.tilesW, 2, TileType.SOLID);

  // Cell 0 (0..24): Command Bridge
  b.buildPlatform(8, 10, 10, TileType.ONE_WAY);
  b.fillRect(6, 2, 1, 2, TileType.SOLID);
  b.fillRect(19, 2, 1, 2, TileType.SOLID);

  // Cell 1 (25..49): Medbay & Engineering
  b.buildPlatform(30, 10, 15, TileType.ONE_WAY);
  b.set(27, 12, TileType.BOUNCE_PAD);

  // Cell 2 (50..74): Training Dojo
  b.buildPlatform(64, 10, 6, TileType.ONE_WAY);
  b.buildPlatform(56, 7, 5, TileType.ONE_WAY);
  b.fillRect(61, 4, 5, 1, TileType.SOLID);
  b.fillRect(72, 3, 2, 10, TileType.SOLID);
  b.fillRect(65, 8, 2, 1, TileType.TOGGLE_A);
  b.fillRect(68, 8, 2, 1, TileType.TOGGLE_B);

  const spawns: SpawnPoint[] = [
    // Cell 0 Terminals
    { id: 'hub_term_mission', kind: 'hub_terminal', x: px(9), y: standY(13, 28), terminalKind: 'mission_select' },
    { id: 'hub_term_compendium', kind: 'hub_terminal', x: px(15), y: standY(13, 28), terminalKind: 'compendium' },
    { id: 'hub_term_challenges', kind: 'hub_terminal', x: px(20), y: standY(13, 28), terminalKind: 'challenges' },
    { id: 'hub_term_refight', kind: 'hub_terminal', x: px(12), y: standY(10, 28), terminalKind: 'refight_terminal' },

    // Cell 1 Terminals
    { id: 'hub_term_medbay', kind: 'hub_terminal', x: px(31), y: standY(13, 28), terminalKind: 'medbay_chips' },
    { id: 'hub_term_paint', kind: 'hub_terminal', x: px(38), y: standY(13, 28), terminalKind: 'paint_bay' },
    { id: 'hub_term_dojo', kind: 'hub_terminal', x: px(44), y: standY(13, 28), terminalKind: 'burst_dojo' },
    { id: 'hub_crate_medbay', kind: 'crate', x: px(47), y: standY(13, 16) },

    // Cell 2 Dojo
    { id: 'hub_term_training', kind: 'hub_terminal', x: px(53), y: standY(13, 28), terminalKind: 'training_room' },
    { id: 'hub_crate_1', kind: 'crate', x: px(56), y: standY(13, 16) },
    { id: 'hub_crate_2', kind: 'crate', x: px(58), y: standY(13, 16) },
    { id: 'hub_dummy_floor', kind: 'enemy', x: px(60), y: standY(13, 26), archetypeId: 'training_dummy' },
    { id: 'hub_switch_dojo', kind: 'switch', x: px(62), y: standY(13, 16) },
    { id: 'hub_dummy_upper', kind: 'enemy', x: px(67), y: standY(10, 26), archetypeId: 'training_dummy' },
  ];

  return {
    id: 'hub',
    name: 'Circuit Guard HQ',
    subtitle: 'Command Deck',
    remix: false,
    biomeGimmick: 'hub_command',
    bgmKey: 'bgm_hub',
    bossBgmKey: 'bgm_boss_opening',
    cellsW: b.cellsW,
    cellsH: b.cellsH,
    tilesW: b.tilesW,
    tilesH: b.tilesH,
    tiles: b.tiles,
    spawnX: px(4),
    spawnY: standY(13, 28),
    bossCellX: 99,
    bossCellY: 99,
    spawns,
    palette: {
      skyTop: '#0d1b36',
      skyBottom: '#1c3b6b',
      farBg: '#162b4d',
      midBg: '#23426e',
      tilePrimary: '#3e5c8a',
      tileHighlight: '#7ba7db',
      tileShadow: '#1b2c4a',
      accent: '#38f2ff',
    },
    hasStars: true,
  };
}

// ============================================================================
// 2. TUTORIAL — Circuit Calibration VR Course (5x1 cells = 125x15)
// Acrobatics -> 1-Tile Slide -> Wall-Jump -> Hookshot Grapple -> Grab-Throw -> Goal Door
// ============================================================================
function createTutorialStage(): StageDefinition {
  const b = new TilemapBuilder(5, 1);
  b.buildOuterFrame(2);

  // Cell 0 (0..24): Sprint, Jump & Elevated Platforms
  b.fillRect(0, 13, 14, 2, TileType.SOLID);
  b.buildPlatform(6, 10, 5, TileType.ONE_WAY);
  b.fillRect(14, 14, 3, 1, TileType.SPIKE); // 3-tile practice jump gap
  b.fillRect(17, 13, 8, 2, TileType.SOLID);
  b.buildPlatform(18, 10, 5, TileType.ONE_WAY);

  // Cell 1 (25..49): Exact 1-Tile Slide Underpass & Bounce Pad
  b.fillRect(25, 13, 25, 2, TileType.SOLID);
  b.buildSlideVent(31, 6, 2, 13); // rows 2..11 solid, row 12 (16px) open for 14px slide!
  b.set(42, 12, TileType.BOUNCE_PAD);
  b.buildPlatform(44, 7, 5, TileType.ONE_WAY);

  // Cell 2 (50..74): Wall-Jump Chimney & Ledge Vault
  b.fillRect(50, 13, 10, 2, TileType.SOLID);
  // Left & right vertical chimney walls (gap 56..60 = 5 tiles wide)
  b.fillRect(55, 5, 1, 5, TileType.SOLID); // walk under at rows 10..12
  b.fillRect(61, 5, 1, 8, TileType.SOLID); // barrier forcing climb over top!
  b.buildPlatform(56, 10, 2, TileType.ONE_WAY);
  b.buildPlatform(59, 7, 2, TileType.ONE_WAY);
  b.buildPlatform(56, 5, 6, TileType.ONE_WAY);
  // Landing terrace & descent into Cell 3
  b.fillRect(62, 9, 5, 6, TileType.SOLID);
  b.fillRect(67, 13, 8, 2, TileType.SOLID);

  // Cell 3 (75..99): Hookshot Grapple Swing & Switch-Toggle Bridge
  b.fillRect(75, 13, 4, 2, TileType.SOLID);
  b.fillRect(79, 14, 9, 1, TileType.SPIKE); // 9-tile grapple pit
  b.fillRect(80, 5, 7, 1, TileType.SOLID); // overhead hookshot latch girder
  b.buildPlatform(82, 11, 3, TileType.ONE_WAY); // safety mid-pylon
  b.fillRect(88, 13, 4, 2, TileType.SOLID);
  // Switch-controlled toggle bridge over short gap
  b.fillRect(92, 14, 4, 1, TileType.SPIKE);
  b.fillRect(92, 12, 2, 1, TileType.TOGGLE_A);
  b.fillRect(94, 12, 2, 1, TileType.TOGGLE_B);
  b.buildPlatform(92, 9, 4, TileType.ONE_WAY); // always-safe high route
  b.fillRect(96, 13, 4, 2, TileType.SOLID);

  // Cell 4 (100..124): Crate Grab-Throw, Breakable Shutter & Goal Door
  b.fillRect(100, 13, 25, 2, TileType.SOLID);
  b.buildPlatform(103, 9, 7, TileType.ONE_WAY);
  // Breakable training barricade (rows 9..12 breakable, rows 2..8 solid)
  b.fillRect(114, 2, 1, 7, TileType.SOLID);
  b.fillRect(114, 9, 1, 4, TileType.BREAKABLE);
  // Goal Door at cols 120..121, rows 11..12
  b.fillRect(120, 11, 2, 2, TileType.GOAL_DOOR);

  const spawns: SpawnPoint[] = [
    { id: 'tut_dummy_0', kind: 'enemy', x: px(11), y: standY(13, 26), archetypeId: 'training_dummy' },
    { id: 'tut_cp_1', kind: 'checkpoint', x: px(22), y: standY(13, 28) },
    { id: 'tut_crate_1', kind: 'crate', x: px(39), y: standY(13, 16) },
    { id: 'tut_dummy_1', kind: 'enemy', x: px(46), y: standY(7, 26), archetypeId: 'training_dummy' },
    { id: 'tut_cp_2', kind: 'checkpoint', x: px(71), y: standY(13, 28) },
    { id: 'tut_switch_3', kind: 'switch', x: px(90), y: standY(13, 16) },
    { id: 'tut_cp_3', kind: 'checkpoint', x: px(98), y: standY(13, 28) },
    { id: 'tut_crate_4a', kind: 'crate', x: px(103), y: standY(13, 16) },
    { id: 'tut_barrel_4a', kind: 'barrel', x: px(106), y: standY(13, 16) },
    { id: 'tut_guard_4', kind: 'enemy', x: px(110), y: standY(13, 26), archetypeId: 'rail_shield_guard' },
    { id: 'tut_dummy_4', kind: 'enemy', x: px(117), y: standY(13, 26), archetypeId: 'training_dummy' },
  ];

  return {
    id: 'tutorial',
    name: 'Circuit Calibration',
    subtitle: 'VR Acrobatics Course',
    remix: false,
    biomeGimmick: 'tutorial_course',
    bgmKey: 'bgm_tutorial',
    bossBgmKey: 'bgm_boss_opening',
    cellsW: b.cellsW,
    cellsH: b.cellsH,
    tilesW: b.tilesW,
    tilesH: b.tilesH,
    tiles: b.tiles,
    spawnX: px(3),
    spawnY: standY(13, 28),
    bossCellX: 99,
    bossCellY: 99,
    spawns,
    palette: {
      skyTop: '#0d1b2a',
      skyBottom: '#1b3a4b',
      farBg: '#142b3c',
      midBg: '#1f445c',
      tilePrimary: '#3c6e85',
      tileHighlight: '#8ecae6',
      tileShadow: '#162f3d',
      accent: '#38f2ff',
    },
  };
}

// ============================================================================
// 3. OPENING — Metro Expressway & Armored Train (6x1 cells = 150x15)
// Boss: Siege Tread in (5, 0)
// ============================================================================
function createOpeningStage(remix: boolean): StageDefinition {
  const b = new TilemapBuilder(6, 1);
  b.buildOuterFrame(2);

  // Cell 0 (0..24): Expressway Launch Runway
  b.fillRect(0, 13, 16, 2, TileType.SOLID);
  b.buildPlatform(7, 10, 7, TileType.ONE_WAY);
  b.fillRect(16, 14, 3, 1, TileType.SPIKE);
  b.fillRect(19, 12, 21, 3, TileType.SOLID);

  // Cell 1 (25..49): Exact 1-Tile Slide Underpass
  b.buildSlideVent(31, 5, 2, 12);
  b.fillRect(40, 13, 16, 2, TileType.SOLID);

  // Cell 2 (50..74): Hookshot Grapple Chasm
  b.fillRect(56, 14, 9, 1, TileType.SPIKE);
  b.fillRect(56, 6, 9, 1, TileType.SOLID);
  b.buildPlatform(58, 11, 2, TileType.ONE_WAY);
  b.buildPlatform(62, 11, 2, TileType.ONE_WAY);
  b.fillRect(65, 13, 3, 2, TileType.SOLID);
  b.fillRect(68, 14, 3, 1, TileType.SPIKE);
  b.fillRect(71, 13, 29, 2, TileType.SOLID);

  // Cell 3 (75..99): Cargo Car Riot
  b.buildPlatform(78, 10, 17, TileType.ONE_WAY);
  b.fillRect(97, 2, 1, 7, TileType.SOLID);
  b.fillRect(97, 11, 1, 2, TileType.BREAKABLE);

  // Cell 4 (100..124): Express Conveyor & Pre-Boss Approach
  b.fillRect(100, 13, 4, 2, TileType.SOLID);
  b.fillRect(104, 12, 10, 1, remix ? TileType.CONVEYOR_L : TileType.CONVEYOR_R);
  b.fillRect(104, 13, 10, 2, TileType.SOLID);
  b.buildPlatform(108, 9, 4, TileType.ONE_WAY);
  b.fillRect(114, 13, 11, 2, TileType.SOLID);

  // Cell 5 (125..149): Siege Tread Boss Arena
  b.buildBossArena(5, 0, true);

  const spawns: SpawnPoint[] = [
    { id: 'op_crate_0', kind: 'crate', x: px(9), y: standY(13, 16) },
    { id: 'op_trooper_0', kind: 'enemy', x: px(12), y: standY(13, 24), archetypeId: 'metro_trooper' },
    { id: 'op_drone_0', kind: 'enemy', x: px(21), y: px(8), archetypeId: 'metro_drone' },

    { id: 'op_crate_1', kind: 'crate', x: px(37), y: standY(12, 16) },
    { id: 'op_guard_1', kind: 'enemy', x: px(42), y: standY(13, 26), archetypeId: 'rail_shield_guard' },
    { id: 'op_crawler_1', kind: 'enemy', x: px(45), y: standY(13, 12), archetypeId: 'rail_crawler' },
    { id: 'op_cp_1', kind: 'checkpoint', x: px(48), y: standY(13, 28) },

    { id: 'op_hopper_2', kind: 'enemy', x: px(53), y: standY(13, 18), archetypeId: 'track_hopper' },
    { id: 'op_drone_2', kind: 'enemy', x: px(60), y: px(8), archetypeId: 'metro_drone' },
    { id: 'op_turret_2', kind: 'enemy', x: px(73), y: standY(13, 16), archetypeId: 'rail_turret' },

    { id: 'op_crate_3a', kind: 'crate', x: px(78), y: standY(13, 16) },
    { id: 'op_guard_3a', kind: 'enemy', x: px(83), y: standY(13, 26), archetypeId: 'rail_shield_guard' },
    { id: 'op_trooper_3a', kind: 'enemy', x: px(86), y: standY(10, 24), archetypeId: 'metro_trooper' },
    { id: 'op_barrel_3a', kind: 'barrel', x: px(87), y: standY(13, 16) },
    { id: 'op_barrel_3b', kind: 'barrel', x: px(91), y: standY(13, 16) },
    { id: 'op_guard_3b', kind: 'enemy', x: px(94), y: standY(13, 26), archetypeId: 'rail_shield_guard' },

    { id: 'op_turret_4', kind: 'enemy', x: px(110), y: standY(9, 16), archetypeId: 'rail_turret' },
    { id: 'op_hopper_4', kind: 'enemy', x: px(116), y: standY(13, 18), archetypeId: 'track_hopper' },
    { id: 'op_cp_2', kind: 'checkpoint', x: px(121), y: standY(13, 28) },

    { id: 'op_boss_siege', kind: 'boss', x: px(142), y: standY(13, 40), bossId: 'siege_tread' },
  ];

  if (remix) {
    // Master Remix tile mutations: extra overhead electric coils, toggle bridge & breakable lock
    b.set(27, 2, TileType.ELECTRIC_RAIL);
    b.fillRect(58, 11, 2, 1, TileType.TOGGLE_A);
    b.fillRect(62, 11, 2, 1, TileType.TOGGLE_B);
    b.fillRect(85, 2, 1, 5, TileType.SOLID);
    b.set(85, 7, TileType.LASER_MIRROR);
    b.fillRect(106, 5, 6, 1, TileType.SOLID); // overhead grapple bar over counter-conveyor
    b.fillRect(114, 9, 1, 4, TileType.BREAKABLE);
    spawns.push(
      { id: 'op_rmx_switch_2', kind: 'switch', x: px(54), y: standY(13, 16) },
      { id: 'op_rmx_guard_0', kind: 'enemy', x: px(23), y: standY(12, 26), archetypeId: 'rail_shield_guard' },
      { id: 'op_rmx_drone_3', kind: 'enemy', x: px(90), y: px(6), archetypeId: 'mirage_wing' },
      { id: 'op_rmx_barrel_4', kind: 'barrel', x: px(102), y: standY(13, 16) },
      { id: 'op_rmx_enforcer_4', kind: 'enemy', x: px(118), y: standY(13, 28), archetypeId: 'heavy_enforcer' },
    );
  }

  return {
    id: 'opening',
    name: titleWithRemix('Metro Expressway', remix),
    subtitle: subtitleWithRemix('Armored Train', remix),
    remix,
    biomeGimmick: 'metro_train',
    bgmKey: 'bgm_opening',
    bossBgmKey: 'bgm_boss_opening',
    bossId: 'siege_tread',
    cellsW: b.cellsW,
    cellsH: b.cellsH,
    tilesW: b.tilesW,
    tilesH: b.tilesH,
    tiles: b.tiles,
    spawnX: px(3),
    spawnY: standY(13, 28),
    bossCellX: 5,
    bossCellY: 0,
    spawns,
    palette: {
      skyTop: '#0b1024',
      skyBottom: '#2b224f',
      farBg: '#1c1d3d',
      midBg: '#302b59',
      tilePrimary: '#4d5873',
      tileHighlight: '#8da2c7',
      tileShadow: '#232838',
      accent: '#ff7b3a',
    },
    hasStars: true,
  };
}

// ============================================================================
// 4. OPTIC — Solar Relay (6x2 cells = 150x30)
// Boss: Prism (5, 1) | Armor Paint 1 (Solar Beam) | heatHaze + LASER_MIRROR
// ============================================================================
function createOpticStage(remix: boolean): StageDefinition {
  const b = new TilemapBuilder(6, 2);
  b.buildDualDeckBase(2);

  // Cell (0, 1): Sunlit Lower Approach
  b.buildPlatform(8, 25, 4, TileType.ONE_WAY);
  b.buildPlatform(12, 22, 4, TileType.ONE_WAY);

  // Cell (1, 1): 1-Tile Solar Slide Vent & Mirror Hall
  b.buildSlideVent(32, 6, 17, 28);
  b.set(44, 17, TileType.LASER_MIRROR);

  // Cell (2, 1) -> (2, 0): Vertical Wall-Jump Shaft
  b.fillRect(74, 15, 2, 15, TileType.SOLID);
  b.carveDeckShaft(58, 5, true);

  // Cell (1, 0): West Solar Gallery
  b.set(34, 2, TileType.LASER_MIRROR);
  b.set(41, 2, TileType.LASER_MIRROR);
  b.set(37, 12, TileType.BOUNCE_PAD);
  b.buildPlatform(31, 10, 3, TileType.ONE_WAY);
  b.buildPlatform(41, 10, 3, TileType.ONE_WAY);
  b.buildPlatform(34, 7, 7, TileType.ONE_WAY);

  // Cell (0, 0): Secret Solar Vault
  b.fillRect(10, 13, 4, 1, TileType.SPIKE);
  b.fillRect(10, 6, 4, 1, TileType.SOLID);
  b.buildPlatform(3, 10, 4, TileType.ONE_WAY);

  // Cell (3, 0): Hookshot Ceiling-Swing Gallery
  b.fillRect(81, 13, 13, 1, TileType.SPIKE);
  b.fillRect(82, 5, 3, 1, TileType.SOLID);
  b.fillRect(89, 5, 3, 1, TileType.SOLID);
  b.buildPlatform(84, 11, 2, TileType.ONE_WAY);
  b.buildPlatform(89, 11, 2, TileType.ONE_WAY);
  b.buildPlatform(85, 8, 4, TileType.ONE_WAY);

  // Cell (4, 0) -> (4, 1): Mirror Corridor & Drop Chute
  b.set(107, 2, TileType.LASER_MIRROR);
  b.fillRect(112, 10, 2, 1, TileType.TOGGLE_A);
  b.fillRect(114, 10, 2, 1, TileType.TOGGLE_B);
  b.carveDeckShaft(117, 3, false);

  // Cell (3, 1): Sub-Relay Power Vault
  b.fillRect(92, 17, 1, 7, TileType.SOLID);
  b.fillRect(92, 24, 1, 4, TileType.BREAKABLE);
  b.set(85, 17, TileType.LASER_MIRROR);

  // Cell (5, 1): Prism Boss Arena
  b.buildBossArena(5, 1, true);

  const spawns: SpawnPoint[] = [
    ...makeMainCollectibles(
      'optic',
      1,
      [
        [13, 22],
        [41, 28],
        [68, 28],
        [37, 7],
        [5, 10],
        [87, 8],
        [142, 13],
        [78, 28],
      ],
      [7, 13],
      [82, 28],
      [4, 13],
    ),
    { id: 'opt_crate_01', kind: 'crate', x: px(9), y: standY(28, 16) },
    { id: 'opt_trooper_01', kind: 'enemy', x: px(11), y: standY(28, 24), archetypeId: 'solar_trooper' },
    { id: 'opt_hopper_01', kind: 'enemy', x: px(19), y: standY(28, 18), archetypeId: 'dune_hopper' },

    { id: 'opt_crawler_11', kind: 'enemy', x: px(39), y: standY(28, 12), archetypeId: 'mirror_crawler' },
    { id: 'opt_barrel_11', kind: 'barrel', x: px(42), y: standY(28, 16) },
    { id: 'opt_aegis_11', kind: 'enemy', x: px(45), y: standY(28, 26), archetypeId: 'prism_aegis' },
    { id: 'opt_cp_1', kind: 'checkpoint', x: px(48), y: standY(28, 28) },

    { id: 'opt_glider_21', kind: 'enemy', x: px(60), y: px(20), archetypeId: 'mirage_wing' },
    { id: 'opt_turret_21', kind: 'enemy', x: px(71), y: standY(28, 18), archetypeId: 'helios_turret' },

    { id: 'opt_trooper_20', kind: 'enemy', x: px(54), y: standY(13, 24), archetypeId: 'solar_trooper' },
    { id: 'opt_cp_2', kind: 'checkpoint', x: px(65), y: standY(13, 28) },

    { id: 'opt_aegis_10', kind: 'enemy', x: px(30), y: standY(13, 26), archetypeId: 'prism_aegis' },
    { id: 'opt_crate_10', kind: 'crate', x: px(44), y: standY(13, 16) },

    { id: 'opt_glider_00', kind: 'enemy', x: px(12), y: px(8), archetypeId: 'mirage_wing' },
    { id: 'opt_turret_00', kind: 'enemy', x: px(18), y: standY(13, 18), archetypeId: 'helios_turret' },

    { id: 'opt_hazard_30', kind: 'enemy', x: px(82), y: px(9), archetypeId: 'plasma_orb' },
    { id: 'opt_glider_30', kind: 'enemy', x: px(89), y: px(8), archetypeId: 'mirage_wing' },

    { id: 'opt_cp_3', kind: 'checkpoint', x: px(102), y: standY(13, 28) },
    { id: 'opt_switch_40', kind: 'switch', x: px(105), y: standY(13, 16) },
    { id: 'opt_spawner_40', kind: 'enemy', x: px(110), y: standY(13, 24), archetypeId: 'relay_pod' },
    { id: 'opt_trooper_40', kind: 'enemy', x: px(115), y: standY(13, 24), archetypeId: 'solar_trooper' },

    { id: 'opt_crate_50', kind: 'crate', x: px(130), y: standY(13, 16) },
    { id: 'opt_aegis_50', kind: 'enemy', x: px(135), y: standY(13, 26), archetypeId: 'prism_aegis' },
    { id: 'opt_turret_50', kind: 'enemy', x: px(146), y: standY(13, 18), archetypeId: 'helios_turret' },

    { id: 'opt_hopper_41', kind: 'enemy', x: px(108), y: standY(28, 18), archetypeId: 'dune_hopper' },
    { id: 'opt_barrel_41', kind: 'barrel', x: px(113), y: standY(28, 16) },
    { id: 'opt_cp_4', kind: 'checkpoint', x: px(121), y: standY(28, 28) },

    { id: 'opt_crawler_31', kind: 'enemy', x: px(87), y: standY(28, 12), archetypeId: 'mirror_crawler' },

    { id: 'opt_boss_prism', kind: 'boss', x: px(142), y: standY(28, 40), bossId: 'prism' },
  ];

  if (remix) {
    // Master Remix: additional solar laser emitters, spike pits & breakable lens locks
    b.set(17, 17, TileType.LASER_MIRROR);
    b.set(69, 2, TileType.LASER_MIRROR);
    b.set(112, 17, TileType.LASER_MIRROR);
    b.fillRect(108, 13, 3, 1, TileType.SPIKE);
    b.buildPlatform(108, 10, 3, TileType.ONE_WAY);
    b.fillRect(132, 2, 1, 7, TileType.SOLID);
    b.fillRect(132, 9, 1, 4, TileType.BREAKABLE);
    spawns.push(
      { id: 'opt_rmx_aegis_01', kind: 'enemy', x: px(22), y: standY(28, 26), archetypeId: 'prism_aegis' },
      { id: 'opt_rmx_orb_20', kind: 'enemy', x: px(69), y: px(9), archetypeId: 'plasma_orb' },
      { id: 'opt_rmx_barrel_50', kind: 'barrel', x: px(128), y: standY(13, 16) },
      { id: 'opt_rmx_enforcer_41', kind: 'enemy', x: px(104), y: standY(28, 28), archetypeId: 'heavy_enforcer' },
    );
  }

  return {
    id: 'optic',
    name: titleWithRemix('Solar Relay', remix),
    subtitle: subtitleWithRemix('Helios Array', remix),
    remix,
    biomeGimmick: 'solar_lasers',
    bgmKey: 'bgm_optic',
    bossBgmKey: 'bgm_boss_master',
    bossId: 'prism',
    cellsW: b.cellsW,
    cellsH: b.cellsH,
    tilesW: b.tilesW,
    tilesH: b.tilesH,
    tiles: b.tiles,
    spawnX: px(3),
    spawnY: standY(28, 28),
    bossCellX: 5,
    bossCellY: 1,
    spawns,
    palette: {
      skyTop: '#2b130a',
      skyBottom: '#d96b27',
      farBg: '#7a2e16',
      midBg: '#a64b1c',
      tilePrimary: '#c48a3b',
      tileHighlight: '#ffe294',
      tileShadow: '#5e3716',
      accent: '#ffdf5e',
    },
    heatHaze: true,
  };
}

// ============================================================================
// 5. PATCH — Scrap Foundry (6x2 cells = 150x30)
// Boss: Stitch (5, 0) | Miniboss: junk_colossus (3, 1) | Armor Paint 2
// Signature: CRUSHER presses, CONVEYOR_L/R belts, BREAKABLE slag walls
// ============================================================================
function createPatchStage(remix: boolean): StageDefinition {
  const b = new TilemapBuilder(6, 2);
  b.buildDualDeckBase(2);

  // Cell (0, 1): Scrap Intake Yard — conveyors & overhead catwalk
  b.fillRect(9, 27, 8, 1, TileType.CONVEYOR_R);
  b.buildPlatform(10, 24, 6, TileType.ONE_WAY);
  b.fillRect(19, 24, 3, 1, TileType.CRUSHER); // overhead press with 3-tile walk clearance!

  // Cell (1, 1): Crusher Press Conveyor Line
  b.fillRect(27, 27, 10, 1, TileType.CONVEYOR_L);
  b.fillRect(29, 23, 2, 1, TileType.CRUSHER);
  b.fillRect(34, 23, 2, 1, TileType.CRUSHER);
  b.buildPlatform(27, 21, 10, TileType.ONE_WAY); // upper bypass gantry
  b.fillRect(42, 28, 3, 1, TileType.SPIKE); // molten slag pit
  b.buildPlatform(42, 25, 3, TileType.ONE_WAY);

  // Cell (2, 1): Slag Shredder & Breakable Scrap Wall
  b.buildSlideVent(54, 5, 17, 28);
  b.fillRect(63, 23, 2, 1, TileType.CRUSHER);
  b.fillRect(70, 17, 1, 7, TileType.SOLID);
  b.fillRect(70, 24, 1, 4, TileType.BREAKABLE);

  // Cell (3, 1): Furnace Miniboss Yard (junk_colossus!)
  b.buildPlatform(79, 25, 4, TileType.ONE_WAY);
  b.buildPlatform(91, 25, 4, TileType.ONE_WAY);
  b.fillRect(85, 21, 4, 1, TileType.SOLID); // grapple beam for miniboss aerials

  // Cell (4, 1) -> (4, 0): Foundry Elevator Shaft & Secret Sump Vault (5, 1)
  b.carveDeckShaft(108, 5, true);
  b.set(104, 27, TileType.BOUNCE_PAD);
  // Breakable foundry wall into (5, 1) Smelter Sump Vault
  b.fillRect(124, 17, 1, 7, TileType.SOLID);
  b.fillRect(124, 24, 1, 4, TileType.BREAKABLE);
  b.fillRect(130, 27, 8, 1, TileType.CONVEYOR_R);
  b.fillRect(133, 23, 2, 1, TileType.CRUSHER);
  b.buildPlatform(139, 24, 5, TileType.ONE_WAY);

  // Cell (3, 0) & (2, 0): Upper Foundry Crusher Gantry (optional west branch)
  b.fillRect(80, 12, 12, 1, TileType.CONVEYOR_L);
  b.fillRect(82, 8, 2, 1, TileType.CRUSHER);
  b.fillRect(88, 8, 2, 1, TileType.CRUSHER);
  b.buildPlatform(79, 6, 14, TileType.ONE_WAY);

  b.fillRect(55, 13, 8, 1, TileType.SPIKE); // slag vat
  b.fillRect(56, 5, 6, 1, TileType.SOLID); // hookshot girder
  b.buildPlatform(57, 10, 4, TileType.ONE_WAY);

  // Cell (1, 0) -> (0, 0): Secret Salvage Vault (Armor Paint 2 + Health Booster + Rescues)
  b.fillRect(38, 2, 1, 7, TileType.SOLID);
  b.fillRect(38, 9, 1, 4, TileType.BREAKABLE);
  b.fillRect(28, 12, 6, 1, TileType.CONVEYOR_R);
  b.fillRect(15, 8, 2, 1, TileType.CRUSHER);
  b.buildPlatform(4, 10, 6, TileType.ONE_WAY);

  // Cell (4, 0): Pre-Boss Assembly Belt
  b.fillRect(115, 12, 7, 1, TileType.CONVEYOR_R);
  b.fillRect(117, 8, 2, 1, TileType.CRUSHER);

  // Cell (5, 0): Stitch Boss Arena
  b.buildBossArena(5, 0, true);

  const spawns: SpawnPoint[] = [
    ...makeMainCollectibles(
      'patch',
      2,
      [
        [13, 24],
        [32, 21],
        [66, 28],
        [141, 24],
        [86, 6],
        [59, 10],
        [31, 12],
        [6, 10],
      ],
      [9, 13],
      [144, 28],
      [4, 13],
    ),
    // Cell (0, 1)
    { id: 'pat_crate_01', kind: 'crate', x: px(7), y: standY(28, 16) },
    { id: 'pat_trooper_01', kind: 'enemy', x: px(14), y: standY(27, 24), archetypeId: 'metro_trooper' },
    { id: 'pat_crawler_01', kind: 'enemy', x: px(22), y: standY(28, 12), archetypeId: 'rail_crawler' },

    // Cell (1, 1)
    { id: 'pat_guard_11', kind: 'enemy', x: px(38), y: standY(28, 26), archetypeId: 'rail_shield_guard' },
    { id: 'pat_barrel_11', kind: 'barrel', x: px(40), y: standY(28, 16) },
    { id: 'pat_cp_1', kind: 'checkpoint', x: px(48), y: standY(28, 28) },

    // Cell (2, 1)
    { id: 'pat_hopper_21', kind: 'enemy', x: px(60), y: standY(28, 18), archetypeId: 'track_hopper' },
    { id: 'pat_crate_21', kind: 'crate', x: px(67), y: standY(28, 16) },
    { id: 'pat_turret_21', kind: 'enemy', x: px(73), y: standY(28, 16), archetypeId: 'rail_turret' },

    // Cell (3, 1): Miniboss Junk Colossus
    { id: 'pat_barrel_31a', kind: 'barrel', x: px(78), y: standY(28, 16) },
    { id: 'pat_miniboss_colossus', kind: 'miniboss', x: px(87), y: standY(28, 36), minibossId: 'junk_colossus' },
    { id: 'pat_crate_31b', kind: 'crate', x: px(96), y: standY(28, 16) },

    // Cell (4, 1) & (5, 1)
    { id: 'pat_cp_2', kind: 'checkpoint', x: px(102), y: standY(28, 28) },
    { id: 'pat_drone_41', kind: 'enemy', x: px(111), y: px(20), archetypeId: 'metro_drone' },
    { id: 'pat_enforcer_51', kind: 'enemy', x: px(136), y: standY(28, 28), archetypeId: 'heavy_enforcer' },
    { id: 'pat_barrel_51', kind: 'barrel', x: px(128), y: standY(28, 16) },

    // Cell (4, 0) & West Gantries
    { id: 'pat_cp_3', kind: 'checkpoint', x: px(103), y: standY(13, 28) },
    { id: 'pat_guard_30', kind: 'enemy', x: px(94), y: standY(13, 26), archetypeId: 'rail_shield_guard' },
    { id: 'pat_drone_20', kind: 'enemy', x: px(59), y: px(7), archetypeId: 'metro_drone' },
    { id: 'pat_spawner_10', kind: 'enemy', x: px(34), y: standY(13, 24), archetypeId: 'relay_pod' },
    { id: 'pat_turret_00', kind: 'enemy', x: px(19), y: standY(13, 16), archetypeId: 'rail_turret' },
    { id: 'pat_crate_00', kind: 'crate', x: px(12), y: standY(13, 16) },
    { id: 'pat_cp_4', kind: 'checkpoint', x: px(122), y: standY(13, 28) },

    // Cell (5, 0): Stitch Boss
    { id: 'pat_boss_stitch', kind: 'boss', x: px(142), y: standY(13, 38), bossId: 'stitch' },
  ];

  if (remix) {
    // Master Remix: extra crushers, counter-conveyors, slag spikes & breakable gates
    b.fillRect(16, 23, 2, 1, TileType.CRUSHER);
    b.fillRect(9, 27, 8, 1, TileType.CONVEYOR_L);
    b.fillRect(66, 23, 2, 1, TileType.CRUSHER);
    b.fillRect(115, 12, 7, 1, TileType.CONVEYOR_L);
    b.fillRect(120, 8, 2, 1, TileType.CRUSHER);
    b.fillRect(46, 13, 3, 1, TileType.SPIKE);
    b.buildPlatform(46, 10, 3, TileType.ONE_WAY);
    spawns.push(
      { id: 'pat_rmx_enforcer_11', kind: 'enemy', x: px(45), y: standY(28, 28), archetypeId: 'heavy_enforcer' },
      { id: 'pat_rmx_barrel_31', kind: 'barrel', x: px(83), y: standY(25, 16) },
      { id: 'pat_rmx_spawner_30', kind: 'enemy', x: px(77), y: standY(13, 24), archetypeId: 'relay_pod' },
      { id: 'pat_rmx_guard_40', kind: 'enemy', x: px(114), y: standY(13, 26), archetypeId: 'rail_shield_guard' },
    );
  }

  return {
    id: 'patch',
    name: titleWithRemix('Scrap Foundry', remix),
    subtitle: subtitleWithRemix('Smelter Yards', remix),
    remix,
    biomeGimmick: 'scrap_crushers',
    bgmKey: 'bgm_patch',
    bossBgmKey: 'bgm_boss_master',
    bossId: 'stitch',
    minibossId: 'junk_colossus',
    cellsW: b.cellsW,
    cellsH: b.cellsH,
    tilesW: b.tilesW,
    tilesH: b.tilesH,
    tiles: b.tiles,
    spawnX: px(3),
    spawnY: standY(28, 28),
    bossCellX: 5,
    bossCellY: 0,
    spawns,
    palette: {
      skyTop: '#1a1510',
      skyBottom: '#5c3c22',
      farBg: '#332418',
      midBg: '#4d3623',
      tilePrimary: '#6d7552',
      tileHighlight: '#b2bf82',
      tileShadow: '#2d3320',
      accent: '#f97316',
    },
  };
}

// ============================================================================
// 6. COOLER — Cryo Vault (6x2 cells = 150x30)
// Boss: Frostfang (5, 1) | Armor Paint 3 (Cryo Edge) | ICE + windForce: -0.06
// ============================================================================
function createCoolerStage(remix: boolean): StageDefinition {
  const b = new TilemapBuilder(6, 2);
  b.buildDualDeckBase(2);

  // Cell (0, 0): Glacial Entry Ridge (spawn on solid tile 2..5, then ICE!)
  b.fillRect(8, 13, 14, 1, TileType.ICE);
  b.buildPlatform(11, 10, 6, TileType.ONE_WAY);

  // Cell (1, 0): Frozen Crevasse & Grapple Icicles
  b.fillRect(28, 13, 6, 1, TileType.SPIKE);
  b.fillRect(29, 5, 5, 1, TileType.SOLID); // overhead grapple icicle beam
  b.buildPlatform(30, 10, 3, TileType.ONE_WAY);
  b.fillRect(34, 13, 12, 1, TileType.ICE);
  b.buildPlatform(38, 9, 5, TileType.ONE_WAY);

  // Cell (2, 0) -> (2, 1): Cryo Slide Vent & Glacial Drop Shaft
  b.buildSlideVent(52, 5, 2, 13);
  b.fillRect(52, 13, 5, 1, TileType.ICE);
  b.carveDeckShaft(63, 5, false);

  // Cell (3, 0): Secret Cryo Reliquary (entered east from (2, 0) through breakable frost wall)
  b.fillRect(74, 2, 1, 7, TileType.SOLID);
  b.fillRect(74, 9, 1, 4, TileType.BREAKABLE);
  b.fillRect(77, 13, 15, 1, TileType.ICE);
  b.buildPlatform(80, 9, 7, TileType.ONE_WAY);
  // Wall off (3, 0) from (4, 0) so (4, 0)/(5, 0) are climbed from (4, 1)
  b.fillRect(99, 2, 1, 11, TileType.SOLID);

  // Cell (1, 1) & (0, 1): West Frozen Turbine Vault (from (2, 1))
  b.fillRect(30, 28, 14, 1, TileType.ICE);
  b.set(46, 27, TileType.BOUNCE_PAD);
  b.buildPlatform(34, 24, 7, TileType.ONE_WAY);
  b.fillRect(15, 28, 4, 1, TileType.SPIKE);
  b.buildPlatform(15, 25, 4, TileType.ONE_WAY);
  b.fillRect(4, 28, 10, 1, TileType.ICE);
  b.buildPlatform(5, 24, 5, TileType.ONE_WAY);

  // Cell (3, 1): Blizzard Ice Runway
  b.fillRect(76, 28, 22, 1, TileType.ICE);
  b.fillRect(82, 28, 3, 1, TileType.SPIKE);
  b.fillRect(91, 28, 3, 1, TileType.SPIKE);
  b.buildPlatform(81, 25, 5, TileType.ONE_WAY);
  b.buildPlatform(90, 25, 5, TileType.ONE_WAY);
  b.fillRect(85, 20, 6, 1, TileType.SOLID); // windbreak shelter + grapple beam

  // Cell (4, 1) -> (4, 0) & (5, 0): Ice Spire Overpass
  b.carveDeckShaft(108, 4, true);
  b.fillRect(114, 28, 8, 1, TileType.ICE);
  b.fillRect(114, 13, 16, 1, TileType.ICE);
  b.fillRect(130, 13, 4, 1, TileType.SPIKE);
  b.buildPlatform(130, 10, 4, TileType.ONE_WAY);
  b.fillRect(134, 13, 14, 1, TileType.ICE);
  b.buildPlatform(138, 9, 6, TileType.ONE_WAY);

  // Cell (5, 1): Frostfang Boss Arena (icy central strip + solid edges!)
  b.buildBossArena(5, 1, true);
  b.fillRect(131, 28, 13, 1, TileType.ICE);

  const spawns: SpawnPoint[] = [
    ...makeMainCollectibles(
      'cooler',
      3,
      [
        [14, 10],
        [40, 9],
        [83, 9],
        [37, 24],
        [7, 24],
        [87, 20],
        [141, 9],
        [118, 13],
      ],
      [6, 28],
      [145, 13],
      [94, 13],
    ),
    { id: 'coo_crate_00', kind: 'crate', x: px(9), y: standY(13, 16) },
    { id: 'coo_trooper_00', kind: 'enemy', x: px(18), y: standY(13, 24), archetypeId: 'solar_trooper' },
    { id: 'coo_wing_10', kind: 'enemy', x: px(31), y: px(7), archetypeId: 'mirage_wing' },
    { id: 'coo_hopper_10', kind: 'enemy', x: px(43), y: standY(13, 18), archetypeId: 'dune_hopper' },
    { id: 'coo_cp_1', kind: 'checkpoint', x: px(48), y: standY(13, 28) },

    { id: 'coo_crawler_20', kind: 'enemy', x: px(60), y: standY(13, 12), archetypeId: 'mirror_crawler' },
    { id: 'coo_guard_30', kind: 'enemy', x: px(87), y: standY(13, 26), archetypeId: 'rail_shield_guard' },
    { id: 'coo_barrel_30', kind: 'barrel', x: px(79), y: standY(13, 16) },

    { id: 'coo_cp_2', kind: 'checkpoint', x: px(69), y: standY(28, 28) },
    { id: 'coo_turret_11', kind: 'enemy', x: px(38), y: standY(28, 18), archetypeId: 'helios_turret' },
    { id: 'coo_aegis_01', kind: 'enemy', x: px(12), y: standY(28, 26), archetypeId: 'prism_aegis' },
    { id: 'coo_crate_01', kind: 'crate', x: px(22), y: standY(28, 16) },

    { id: 'coo_wing_31', kind: 'enemy', x: px(84), y: px(22), archetypeId: 'mirage_wing' },
    { id: 'coo_hopper_31', kind: 'enemy', x: px(96), y: standY(28, 18), archetypeId: 'dune_hopper' },
    { id: 'coo_cp_3', kind: 'checkpoint', x: px(103), y: standY(28, 28) },

    { id: 'coo_enforcer_40', kind: 'enemy', x: px(124), y: standY(13, 28), archetypeId: 'heavy_enforcer' },
    { id: 'coo_turret_50', kind: 'enemy', x: px(142), y: standY(13, 18), archetypeId: 'helios_turret' },
    { id: 'coo_barrel_41', kind: 'barrel', x: px(117), y: standY(28, 16) },
    { id: 'coo_cp_4', kind: 'checkpoint', x: px(122), y: standY(28, 28) },

    { id: 'coo_boss_frostfang', kind: 'boss', x: px(142), y: standY(28, 38), bossId: 'frostfang' },
  ];

  if (remix) {
    // Master Remix: expanded ice patches, toggle wind-bridge, icicle spikes & extra fliers
    b.fillRect(6, 13, 20, 1, TileType.ICE);
    b.fillRect(30, 10, 3, 1, TileType.TOGGLE_A);
    b.fillRect(34, 9, 3, 1, TileType.TOGGLE_B);
    b.fillRect(58, 28, 4, 1, TileType.ICE);
    b.fillRect(114, 13, 10, 1, TileType.ICE);
    b.fillRect(126, 2, 1, 7, TileType.SOLID);
    b.fillRect(126, 9, 1, 4, TileType.BREAKABLE);
    spawns.push(
      { id: 'coo_rmx_switch_10', kind: 'switch', x: px(26), y: standY(13, 16) },
      { id: 'coo_rmx_orb_31', kind: 'enemy', x: px(88), y: px(23), archetypeId: 'plasma_orb' },
      { id: 'coo_rmx_aegis_41', kind: 'enemy', x: px(119), y: standY(28, 26), archetypeId: 'prism_aegis' },
      { id: 'coo_rmx_wing_50', kind: 'enemy', x: px(136), y: px(6), archetypeId: 'mirage_wing' },
    );
  }

  return {
    id: 'cooler',
    name: titleWithRemix('Cryo Vault', remix),
    subtitle: subtitleWithRemix('Glacial Conduit', remix),
    remix,
    biomeGimmick: 'cryo_wind',
    bgmKey: 'bgm_cooler',
    bossBgmKey: 'bgm_boss_master',
    bossId: 'frostfang',
    cellsW: b.cellsW,
    cellsH: b.cellsH,
    tilesW: b.tilesW,
    tilesH: b.tilesH,
    tiles: b.tiles,
    spawnX: px(3),
    spawnY: standY(13, 28),
    bossCellX: 5,
    bossCellY: 1,
    spawns,
    palette: {
      skyTop: '#081426',
      skyBottom: '#1e5788',
      farBg: '#112e4f',
      midBg: '#1c4a75',
      tilePrimary: '#5aa6d9',
      tileHighlight: '#d8f3ff',
      tileShadow: '#1f486e',
      accent: '#67e8f9',
    },
    windForce: -0.06,
  };
}

// ============================================================================
// 7. ELEC — Surge Grid (6x2 cells = 150x30)
// Boss: Arcbolt (5, 0) | Armor Paint 4 (Voltaic Surge) | ELECTRIC_RAIL coils
// ============================================================================
function createElecStage(remix: boolean): StageDefinition {
  const b = new TilemapBuilder(6, 2);
  b.buildDualDeckBase(2);

  // Cell (0, 1): Transformer Yard — safe platforms above recessed electric rail troughs
  b.fillRect(9, 28, 5, 1, TileType.ELECTRIC_RAIL);
  b.buildPlatform(9, 25, 5, TileType.ONE_WAY);
  b.set(18, 17, TileType.ELECTRIC_RAIL); // overhead pulse coil (safe to walk underneath when idle!)
  b.buildPlatform(17, 24, 5, TileType.ONE_WAY);

  // Cell (1, 1) -> (1, 0): Capacitor Ascent Shaft
  b.fillRect(49, 15, 1, 15, TileType.SOLID); // seal east so player ascends to (1,0)
  b.carveDeckShaft(34, 5, true);
  b.set(28, 17, TileType.ELECTRIC_RAIL);
  b.set(44, 27, TileType.BOUNCE_PAD);

  // Cell (0, 0): Secret Substation Vault (west of (1, 0))
  b.fillRect(19, 2, 1, 7, TileType.SOLID);
  b.fillRect(19, 9, 1, 4, TileType.BREAKABLE);
  b.fillRect(9, 13, 4, 1, TileType.ELECTRIC_RAIL);
  b.buildPlatform(9, 10, 4, TileType.ONE_WAY);
  b.set(14, 2, TileType.ELECTRIC_RAIL);
  b.buildPlatform(3, 10, 4, TileType.ONE_WAY);

  // Cell (2, 0): Twin High-Voltage Coil Span
  b.fillRect(55, 13, 13, 1, TileType.ELECTRIC_RAIL); // wide electric trough!
  b.fillRect(56, 5, 4, 1, TileType.SOLID); // grapple girder 1
  b.fillRect(63, 5, 4, 1, TileType.SOLID); // grapple girder 2
  b.buildPlatform(56, 10, 3, TileType.ONE_WAY);
  b.buildPlatform(61, 8, 3, TileType.ONE_WAY);
  b.buildPlatform(65, 10, 3, TileType.ONE_WAY);

  // Cell (3, 0) -> (3, 1): Switchboard Conduit & Drop Shaft
  b.fillRect(79, 13, 6, 1, TileType.ELECTRIC_RAIL);
  b.fillRect(79, 10, 3, 1, TileType.TOGGLE_A);
  b.fillRect(82, 10, 3, 1, TileType.TOGGLE_B);
  b.buildPlatform(79, 7, 6, TileType.ONE_WAY); // high route always open
  b.carveDeckShaft(90, 4, false);
  // Wall off (3, 0) from (4, 0) so player traverses lower dynamo ring (3, 1) -> (4, 1) -> (4, 0)
  b.fillRect(99, 2, 1, 11, TileType.SOLID);

  // Cell (2, 1): Secret Capacitor Alcove (west from (3, 1))
  b.fillRect(58, 28, 6, 1, TileType.ELECTRIC_RAIL);
  b.buildPlatform(58, 25, 6, TileType.ONE_WAY);
  b.set(66, 17, TileType.ELECTRIC_RAIL);
  b.buildPlatform(52, 24, 4, TileType.ONE_WAY);

  // Cell (4, 1) -> (4, 0): Surge Tower Chimney & Generator Deck
  b.fillRect(102, 28, 4, 1, TileType.ELECTRIC_RAIL);
  b.buildPlatform(102, 25, 4, TileType.ONE_WAY);
  b.carveDeckShaft(112, 5, true);
  b.set(108, 27, TileType.BOUNCE_PAD);
  b.set(121, 17, TileType.ELECTRIC_RAIL);
  b.set(105, 2, TileType.ELECTRIC_RAIL);
  b.fillRect(118, 13, 3, 1, TileType.ELECTRIC_RAIL);
  b.buildPlatform(118, 10, 3, TileType.ONE_WAY);

  // Cell (5, 0): Arcbolt Boss Arena
  b.buildBossArena(5, 0, true);

  const spawns: SpawnPoint[] = [
    ...makeMainCollectibles(
      'elec',
      4,
      [
        [19, 24],
        [44, 23],
        [5, 10],
        [62, 8],
        [82, 7],
        [54, 24],
        [120, 28],
        [106, 13],
      ],
      [7, 13],
      [53, 28],
      [4, 13],
    ),
    { id: 'elc_crate_01', kind: 'crate', x: px(7), y: standY(28, 16) },
    { id: 'elc_trooper_01', kind: 'enemy', x: px(16), y: standY(28, 24), archetypeId: 'solar_trooper' },
    { id: 'elc_drone_11', kind: 'enemy', x: px(36), y: px(20), archetypeId: 'metro_drone' },
    { id: 'elc_cp_1', kind: 'checkpoint', x: px(29), y: standY(28, 28) },

    { id: 'elc_aegis_10', kind: 'enemy', x: px(28), y: standY(13, 26), archetypeId: 'prism_aegis' },
    { id: 'elc_turret_00', kind: 'enemy', x: px(16), y: standY(13, 18), archetypeId: 'helios_turret' },
    { id: 'elc_cp_2', kind: 'checkpoint', x: px(46), y: standY(13, 28) },

    { id: 'elc_orb_20', kind: 'enemy', x: px(60), y: px(9), archetypeId: 'plasma_orb' },
    { id: 'elc_wing_20', kind: 'enemy', x: px(66), y: px(7), archetypeId: 'mirage_wing' },

    { id: 'elc_switch_30', kind: 'switch', x: px(77), y: standY(13, 16) },
    { id: 'elc_spawner_30', kind: 'enemy', x: px(87), y: standY(13, 24), archetypeId: 'relay_pod' },
    { id: 'elc_cp_3', kind: 'checkpoint', x: px(96), y: standY(28, 28) },

    { id: 'elc_guard_21', kind: 'enemy', x: px(70), y: standY(28, 26), archetypeId: 'rail_shield_guard' },
    { id: 'elc_barrel_21', kind: 'barrel', x: px(68), y: standY(28, 16) },
    { id: 'elc_hopper_41', kind: 'enemy', x: px(109), y: standY(28, 18), archetypeId: 'dune_hopper' },
    { id: 'elc_enforcer_40', kind: 'enemy', x: px(108), y: standY(13, 28), archetypeId: 'heavy_enforcer' },
    { id: 'elc_crate_40', kind: 'crate', x: px(116), y: standY(13, 16) },
    { id: 'elc_cp_4', kind: 'checkpoint', x: px(122), y: standY(13, 28) },

    { id: 'elc_boss_arcbolt', kind: 'boss', x: px(142), y: standY(13, 38), bossId: 'arcbolt' },
  ];

  if (remix) {
    // Master Remix: additional ceiling surge coils, electric floor trenches & orbs
    b.set(11, 17, TileType.ELECTRIC_RAIL);
    b.set(60, 2, TileType.ELECTRIC_RAIL);
    b.set(84, 2, TileType.ELECTRIC_RAIL);
    b.set(118, 2, TileType.ELECTRIC_RAIL);
    b.fillRect(78, 28, 5, 1, TileType.ELECTRIC_RAIL);
    b.buildPlatform(78, 25, 5, TileType.ONE_WAY);
    spawns.push(
      { id: 'elc_rmx_orb_01', kind: 'enemy', x: px(14), y: px(22), archetypeId: 'plasma_orb' },
      { id: 'elc_rmx_turret_20', kind: 'enemy', x: px(71), y: standY(13, 18), archetypeId: 'helios_turret' },
      { id: 'elc_rmx_aegis_31', kind: 'enemy', x: px(84), y: standY(28, 26), archetypeId: 'prism_aegis' },
      { id: 'elc_rmx_barrel_40', kind: 'barrel', x: px(104), y: standY(13, 16) },
    );
  }

  return {
    id: 'elec',
    name: titleWithRemix('Surge Grid', remix),
    subtitle: subtitleWithRemix('High-Voltage Rails', remix),
    remix,
    biomeGimmick: 'surge_rails',
    bgmKey: 'bgm_elec',
    bossBgmKey: 'bgm_boss_master',
    bossId: 'arcbolt',
    cellsW: b.cellsW,
    cellsH: b.cellsH,
    tilesW: b.tilesW,
    tilesH: b.tilesH,
    tiles: b.tiles,
    spawnX: px(3),
    spawnY: standY(28, 28),
    bossCellX: 5,
    bossCellY: 0,
    spawns,
    palette: {
      skyTop: '#0c0b24',
      skyBottom: '#2d2478',
      farBg: '#1a1647',
      midBg: '#29236b',
      tilePrimary: '#4d4aa8',
      tileHighlight: '#a5a1ff',
      tileShadow: '#1d1a4d',
      accent: '#facc15',
    },
  };
}

// ============================================================================
// 8. SHIFT — Skyway Convoy (6x2 cells = 150x30)
// Boss: Strider (5, 0) | Miniboss: sky_gunship (2, 0) | Armor Paint 5
// Signature: Open freighter top decks (wind drift) + lower sheltered cargo hulls
// ============================================================================
function createShiftStage(remix: boolean): StageDefinition {
  const b = new TilemapBuilder(6, 2);
  // 1-tile top sky border so upper deck (cellY = 0) has open sky overhead for skyway_convoy wind!
  b.buildDualDeckBase(1);

  // Cell (0, 0): Lead Freighter Open Flight Deck
  b.fillRect(10, 12, 8, 1, TileType.CONVEYOR_R);
  b.buildPlatform(12, 9, 6, TileType.ONE_WAY);

  // Cell (1, 0): Airship Deck Jump Gaps + Hatch down to Lower Cargo Hull (1, 1)
  b.fillRect(28, 13, 4, 1, TileType.SPIKE); // between airship hulls
  b.fillRect(28, 5, 5, 1, TileType.SOLID); // rigging grapple beam
  b.buildPlatform(29, 10, 3, TileType.ONE_WAY);
  b.carveDeckShaft(38, 4, false);

  // Cell (0, 1) & (1, 1): Sheltered Lower Cargo Hold (calm cabin wind!)
  b.fillRect(19, 17, 1, 7, TileType.SOLID);
  b.fillRect(19, 24, 1, 4, TileType.BREAKABLE);
  b.buildPlatform(5, 24, 7, TileType.ONE_WAY);
  b.fillRect(26, 27, 8, 1, TileType.CONVEYOR_L);

  // Cell (2, 0): Miniboss Flight Pad (sky_gunship!)
  b.buildPlatform(54, 10, 4, TileType.ONE_WAY);
  b.buildPlatform(67, 10, 4, TileType.ONE_WAY);
  b.fillRect(59, 5, 6, 1, TileType.SOLID); // overhead aerial grapple bar

  // Cell (3, 0): Convoy Coupling Chasm & Cargo Drop (3, 1)
  b.fillRect(79, 13, 7, 1, TileType.SPIKE);
  b.fillRect(80, 5, 6, 1, TileType.SOLID);
  b.buildPlatform(81, 10, 3, TileType.ONE_WAY);
  b.carveDeckShaft(91, 4, false);

  // Cell (2, 1), (3, 1), (4, 1): Lower Freighter Engine Deck & Rear Hangar
  b.buildSlideVent(60, 5, 17, 28);
  b.buildPlatform(52, 24, 5, TileType.ONE_WAY);
  b.fillRect(78, 27, 9, 1, TileType.CONVEYOR_R);
  b.fillRect(104, 28, 4, 1, TileType.SPIKE);
  b.buildPlatform(104, 25, 4, TileType.ONE_WAY);
  b.carveDeckShaft(115, 4, false);
  b.fillRect(124, 17, 1, 7, TileType.SOLID);
  b.fillRect(124, 24, 1, 4, TileType.BREAKABLE);
  b.buildPlatform(133, 24, 6, TileType.ONE_WAY);

  // Cell (4, 0): Flagship Stern Deck
  b.fillRect(103, 12, 8, 1, TileType.CONVEYOR_R);
  b.buildPlatform(106, 9, 5, TileType.ONE_WAY);

  // Cell (5, 0): Strider Boss Arena
  b.buildBossArena(5, 0, true);

  const spawns: SpawnPoint[] = [
    ...makeMainCollectibles(
      'shift',
      5,
      [
        [15, 9],
        [8, 24],
        [54, 24],
        [69, 10],
        [82, 10],
        [84, 27],
        [136, 24],
        [108, 9],
      ],
      [53, 28],
      [142, 28],
      [5, 28],
    ),
    { id: 'shf_crate_00', kind: 'crate', x: px(8), y: standY(13, 16) },
    { id: 'shf_trooper_00', kind: 'enemy', x: px(16), y: standY(12, 24), archetypeId: 'metro_trooper' },
    { id: 'shf_drone_10', kind: 'enemy', x: px(31), y: px(7), archetypeId: 'metro_drone' },
    { id: 'shf_cp_1', kind: 'checkpoint', x: px(45), y: standY(13, 28) },

    // Lower Hold (0,1) & (1,1)
    { id: 'shf_guard_11', kind: 'enemy', x: px(28), y: standY(27, 26), archetypeId: 'rail_shield_guard' },
    { id: 'shf_barrel_01', kind: 'barrel', x: px(14), y: standY(28, 16) },
    { id: 'shf_turret_01', kind: 'enemy', x: px(11), y: standY(28, 16), archetypeId: 'rail_turret' },

    // Cell (2, 0): Miniboss Sky Gunship
    { id: 'shf_barrel_20a', kind: 'barrel', x: px(53), y: standY(13, 16) },
    { id: 'shf_miniboss_gunship', kind: 'miniboss', x: px(62), y: px(6), minibossId: 'sky_gunship' },
    { id: 'shf_crate_20b', kind: 'crate', x: px(71), y: standY(13, 16) },

    // Cell (3, 0) & Lower Engine Deck
    { id: 'shf_cp_2', kind: 'checkpoint', x: px(76), y: standY(13, 28) },
    { id: 'shf_wing_30', kind: 'enemy', x: px(83), y: px(7), archetypeId: 'mirage_wing' },
    { id: 'shf_hopper_21', kind: 'enemy', x: px(69), y: standY(28, 18), archetypeId: 'track_hopper' },
    { id: 'shf_guard_31', kind: 'enemy', x: px(86), y: standY(27, 26), archetypeId: 'rail_shield_guard' },
    { id: 'shf_cp_3', kind: 'checkpoint', x: px(97), y: standY(28, 28) },
    { id: 'shf_enforcer_51', kind: 'enemy', x: px(131), y: standY(28, 28), archetypeId: 'heavy_enforcer' },

    // Cell (4, 0)
    { id: 'shf_turret_40', kind: 'enemy', x: px(110), y: standY(12, 16), archetypeId: 'rail_turret' },
    { id: 'shf_wing_40', kind: 'enemy', x: px(116), y: px(7), archetypeId: 'mirage_wing' },
    { id: 'shf_cp_4', kind: 'checkpoint', x: px(122), y: standY(13, 28) },

    // Cell (5, 0): Strider Boss
    { id: 'shf_boss_strider', kind: 'boss', x: px(142), y: standY(13, 36), bossId: 'strider' },
  ];

  if (remix) {
    // Master Remix: headwind conveyors, extra aerial sky-gaps & escort squadrons
    b.fillRect(10, 12, 8, 1, TileType.CONVEYOR_L);
    b.fillRect(103, 12, 8, 1, TileType.CONVEYOR_L);
    b.fillRect(100, 13, 3, 1, TileType.SPIKE);
    b.buildPlatform(100, 10, 3, TileType.ONE_WAY);
    b.fillRect(36, 28, 3, 1, TileType.SPIKE);
    b.buildPlatform(36, 25, 3, TileType.ONE_WAY);
    spawns.push(
      { id: 'shf_rmx_wing_00', kind: 'enemy', x: px(20), y: px(6), archetypeId: 'mirage_wing' },
      { id: 'shf_rmx_turret_20', kind: 'enemy', x: px(68), y: standY(10, 16), archetypeId: 'rail_turret' },
      { id: 'shf_rmx_enforcer_40', kind: 'enemy', x: px(113), y: standY(13, 28), archetypeId: 'heavy_enforcer' },
      { id: 'shf_rmx_barrel_40', kind: 'barrel', x: px(104), y: standY(12, 16) },
    );
  }

  return {
    id: 'shift',
    name: titleWithRemix('Skyway Convoy', remix),
    subtitle: subtitleWithRemix('Aerial Freighter Deck', remix),
    remix,
    biomeGimmick: 'skyway_convoy',
    bgmKey: 'bgm_shift',
    bossBgmKey: 'bgm_boss_master',
    bossId: 'strider',
    minibossId: 'sky_gunship',
    cellsW: b.cellsW,
    cellsH: b.cellsH,
    tilesW: b.tilesW,
    tilesH: b.tilesH,
    tiles: b.tiles,
    spawnX: px(3),
    spawnY: standY(13, 28),
    bossCellX: 5,
    bossCellY: 0,
    spawns,
    palette: {
      skyTop: '#1c0f24',
      skyBottom: '#8c2d52',
      farBg: '#451734',
      midBg: '#6b2247',
      tilePrimary: '#944a63',
      tileHighlight: '#fda4af',
      tileShadow: '#421928',
      accent: '#34d399',
    },
    windForce: -0.14,
    hasStars: true,
  };
}

// ============================================================================
// 9. WAVE — Pulse Broadcast (6x2 cells = 150x30)
// Boss: Tempo (5, 1) | Armor Paint 6 (Harmonic Pulse)
// Signature: 120 BPM TOGGLE_A/B rhythm blocks + BOUNCE_PAD chains + hasStars
// ============================================================================
function createWaveStage(remix: boolean): StageDefinition {
  const b = new TilemapBuilder(6, 2);
  b.buildDualDeckBase(2);

  // Cell (0, 1): Soundstage Entry — intro Bounce Pad + Rhythm Platforms
  b.set(10, 27, TileType.BOUNCE_PAD);
  b.buildPlatform(12, 22, 4, TileType.ONE_WAY);
  b.fillRect(17, 24, 3, 1, TileType.TOGGLE_A);
  b.fillRect(20, 22, 3, 1, TileType.TOGGLE_B);

  // Cell (1, 1) -> (1, 0): Bassline Bounce Shaft
  b.fillRect(49, 15, 1, 15, TileType.SOLID); // direct route ascends to upper stage
  b.set(30, 27, TileType.BOUNCE_PAD);
  b.carveDeckShaft(34, 5, false);
  b.set(36, 27, TileType.BOUNCE_PAD); // launches right up the open shaft!
  b.set(44, 27, TileType.BOUNCE_PAD);
  b.buildPlatform(42, 21, 5, TileType.ONE_WAY);

  // Cell (0, 0): Secret Vinyl Vault (west from (1, 0))
  b.fillRect(14, 13, 5, 1, TileType.SPIKE);
  b.fillRect(14, 10, 3, 1, TileType.TOGGLE_A);
  b.fillRect(17, 10, 3, 1, TileType.TOGGLE_B);
  b.buildPlatform(14, 7, 5, TileType.ONE_WAY); // always traversable high bounce line
  b.set(22, 12, TileType.BOUNCE_PAD);
  b.buildPlatform(4, 9, 6, TileType.ONE_WAY);

  // Cell (2, 0): Beat-Drop Synth Skywalk
  b.fillRect(54, 13, 16, 1, TileType.SPIKE);
  b.fillRect(54, 11, 3, 1, TileType.TOGGLE_A);
  b.fillRect(58, 10, 3, 1, TileType.TOGGLE_B);
  b.fillRect(62, 11, 3, 1, TileType.TOGGLE_A);
  b.fillRect(66, 10, 3, 1, TileType.TOGGLE_B);
  // Safe hookshot rafters & stepping pylons above
  b.fillRect(57, 5, 4, 1, TileType.SOLID);
  b.fillRect(64, 5, 4, 1, TileType.SOLID);
  b.buildPlatform(60, 8, 3, TileType.ONE_WAY);

  // Cell (3, 0): Equalizer Bounce Gallery
  b.set(78, 12, TileType.BOUNCE_PAD);
  b.set(86, 12, TileType.BOUNCE_PAD);
  b.set(94, 12, TileType.BOUNCE_PAD);
  b.buildPlatform(80, 7, 5, TileType.ONE_WAY);
  b.buildPlatform(88, 7, 5, TileType.ONE_WAY);

  // Cell (4, 0) & (5, 0): Upper Broadcast Antenna Spire + Drop Chute (4, 0) -> (4, 1)
  b.carveDeckShaft(108, 4, false);
  b.fillRect(128, 13, 6, 1, TileType.SPIKE);
  b.fillRect(128, 10, 3, 1, TileType.TOGGLE_A);
  b.fillRect(131, 10, 3, 1, TileType.TOGGLE_B);
  b.set(125, 12, TileType.BOUNCE_PAD);
  b.buildPlatform(136, 9, 8, TileType.ONE_WAY);

  // Cell (3, 1) & (2, 1): Sub-Woofer Vault (west from (4, 1))
  b.fillRect(92, 17, 1, 7, TileType.SOLID);
  b.fillRect(92, 24, 1, 4, TileType.BREAKABLE);
  b.set(82, 27, TileType.BOUNCE_PAD);
  b.buildPlatform(76, 22, 6, TileType.ONE_WAY);
  b.fillRect(58, 28, 8, 1, TileType.SPIKE);
  b.fillRect(58, 25, 4, 1, TileType.TOGGLE_A);
  b.fillRect(62, 25, 4, 1, TileType.TOGGLE_B);
  b.buildPlatform(60, 22, 4, TileType.ONE_WAY);

  // Cell (5, 1): Tempo Boss Arena (with twin corner Bounce Pads!)
  b.buildBossArena(5, 1, true);
  b.set(127, 27, TileType.BOUNCE_PAD);
  b.set(147, 27, TileType.BOUNCE_PAD);

  const spawns: SpawnPoint[] = [
    ...makeMainCollectibles(
      'wave',
      6,
      [
        [14, 22],
        [44, 21],
        [6, 9],
        [61, 8],
        [90, 7],
        [140, 9],
        [78, 22],
        [54, 28],
      ],
      [5, 13],
      [144, 13],
      [9, 13],
    ),
    { id: 'wav_crate_01', kind: 'crate', x: px(8), y: standY(28, 16) },
    { id: 'wav_hopper_01', kind: 'enemy', x: px(16), y: standY(28, 18), archetypeId: 'dune_hopper' },
    { id: 'wav_cp_1', kind: 'checkpoint', x: px(27), y: standY(28, 28) },
    { id: 'wav_drone_11', kind: 'enemy', x: px(40), y: px(21), archetypeId: 'metro_drone' },

    { id: 'wav_cp_2', kind: 'checkpoint', x: px(46), y: standY(13, 28) },
    { id: 'wav_aegis_00', kind: 'enemy', x: px(11), y: standY(13, 26), archetypeId: 'prism_aegis' },
    { id: 'wav_wing_20', kind: 'enemy', x: px(61), y: px(6), archetypeId: 'mirage_wing' },
    { id: 'wav_orb_20', kind: 'enemy', x: px(67), y: px(8), archetypeId: 'plasma_orb' },

    { id: 'wav_hopper_30', kind: 'enemy', x: px(82), y: standY(7, 18), archetypeId: 'dune_hopper' },
    { id: 'wav_turret_30', kind: 'enemy', x: px(91), y: standY(7, 18), archetypeId: 'helios_turret' },
    { id: 'wav_cp_3', kind: 'checkpoint', x: px(103), y: standY(13, 28) },

    { id: 'wav_spawner_50', kind: 'enemy', x: px(139), y: standY(13, 24), archetypeId: 'relay_pod' },
    { id: 'wav_barrel_41', kind: 'barrel', x: px(104), y: standY(28, 16) },
    { id: 'wav_guard_31', kind: 'enemy', x: px(86), y: standY(28, 26), archetypeId: 'rail_shield_guard' },
    { id: 'wav_crawler_21', kind: 'enemy', x: px(70), y: standY(28, 12), archetypeId: 'mirror_crawler' },
    { id: 'wav_cp_4', kind: 'checkpoint', x: px(121), y: standY(28, 28) },

    { id: 'wav_boss_tempo', kind: 'boss', x: px(141), y: standY(28, 38), bossId: 'tempo' },
  ];

  if (remix) {
    // Master Remix: tighter rhythm-only hops, extra bounce traps & laser strobe
    b.fillRect(80, 7, 5, 1, TileType.TOGGLE_A);
    b.fillRect(88, 7, 5, 1, TileType.TOGGLE_B);
    b.fillRect(80, 13, 5, 1, TileType.SPIKE);
    b.fillRect(88, 13, 5, 1, TileType.SPIKE);
    b.set(116, 17, TileType.LASER_MIRROR);
    b.set(60, 2, TileType.LASER_MIRROR);
    spawns.push(
      { id: 'wav_rmx_orb_30', kind: 'enemy', x: px(84), y: px(9), archetypeId: 'plasma_orb' },
      { id: 'wav_rmx_wing_50', kind: 'enemy', x: px(132), y: px(7), archetypeId: 'mirage_wing' },
      { id: 'wav_rmx_enforcer_41', kind: 'enemy', x: px(114), y: standY(28, 28), archetypeId: 'heavy_enforcer' },
      { id: 'wav_rmx_crate_41', kind: 'crate', x: px(118), y: standY(28, 16) },
    );
  }

  return {
    id: 'wave',
    name: titleWithRemix('Pulse Broadcast', remix),
    subtitle: subtitleWithRemix('Synth Equalizer Tower', remix),
    remix,
    biomeGimmick: 'pulse_rhythm',
    bgmKey: 'bgm_wave',
    bossBgmKey: 'bgm_boss_master',
    bossId: 'tempo',
    cellsW: b.cellsW,
    cellsH: b.cellsH,
    tilesW: b.tilesW,
    tilesH: b.tilesH,
    tiles: b.tiles,
    spawnX: px(3),
    spawnY: standY(28, 28),
    bossCellX: 5,
    bossCellY: 1,
    spawns,
    palette: {
      skyTop: '#160926',
      skyBottom: '#6d1e8c',
      farBg: '#320f4a',
      midBg: '#4d176e',
      tilePrimary: '#8638a8',
      tileHighlight: '#f5a6ff',
      tileShadow: '#361047',
      accent: '#2dd4bf',
    },
    hasStars: true,
  };
}

// ============================================================================
// 10. BREAK — Deep Quarry (6x2 cells = 150x30)
// Boss: Crag (5, 1) | Miniboss: wrecker_tank (3, 1) | Rideable Power Exo-Walker!
// Armor Paint 7 (Basalt Titan) | Rock chutes, BREAKABLE strata & ore conveyors
// ============================================================================
function createBreakStage(remix: boolean): StageDefinition {
  const b = new TilemapBuilder(6, 2);
  b.buildDualDeckBase(2);

  // Cell (0, 0): Quarry Rim Approach
  b.fillRect(10, 12, 7, 1, TileType.CONVEYOR_R);
  b.buildPlatform(12, 9, 5, TileType.ONE_WAY);
  b.fillRect(21, 9, 1, 4, TileType.BREAKABLE);

  // Cell (1, 0): Basalt Rock Chute & Ore Conveyor
  b.fillRect(27, 12, 10, 1, TileType.CONVEYOR_R);
  b.fillRect(32, 2, 1, 7, TileType.SOLID);
  b.fillRect(32, 9, 1, 4, TileType.BREAKABLE);
  b.fillRect(41, 13, 3, 1, TileType.SPIKE);
  b.buildPlatform(41, 10, 3, TileType.ONE_WAY);

  // Cell (2, 0): Power Exo-Walker Staging Bay!
  b.buildPlatform(53, 9, 6, TileType.ONE_WAY);
  b.fillRect(67, 9, 2, 4, TileType.BREAKABLE); // smash straight through with Exo-Walker!
  b.fillRect(72, 9, 2, 4, TileType.BREAKABLE);

  // Cell (3, 0): Basalt Smash Runway (built for Exo-Walker stomp shockwaves!)
  b.fillRect(79, 12, 10, 1, TileType.CONVEYOR_L);
  b.fillRect(83, 9, 2, 4, TileType.BREAKABLE);
  b.fillRect(92, 9, 2, 4, TileType.BREAKABLE);
  b.buildPlatform(80, 8, 6, TileType.ONE_WAY);

  // Cell (4, 0) & (5, 0): Upper Geode Pocket + Quarry Drop Chute (4, 0) -> (4, 1)
  b.carveDeckShaft(108, 5, false);
  b.fillRect(126, 2, 1, 7, TileType.SOLID);
  b.fillRect(126, 9, 2, 4, TileType.BREAKABLE);
  b.fillRect(132, 12, 8, 1, TileType.CONVEYOR_R);
  b.buildPlatform(135, 9, 6, TileType.ONE_WAY);

  // Cell (3, 1): Excavation Arena — Miniboss Wrecker Tank!
  b.buildPlatform(79, 25, 4, TileType.ONE_WAY);
  b.buildPlatform(91, 25, 4, TileType.ONE_WAY);
  b.fillRect(85, 21, 4, 1, TileType.SOLID);

  // Cell (2, 1), (1, 1), (0, 1): Deep Core Mine Shafts (west from (3, 1))
  b.fillRect(60, 27, 9, 1, TileType.CONVEYOR_L);
  b.fillRect(55, 24, 2, 4, TileType.BREAKABLE);
  b.buildPlatform(56, 23, 6, TileType.ONE_WAY);
  b.fillRect(35, 28, 4, 1, TileType.SPIKE);
  b.buildPlatform(35, 25, 4, TileType.ONE_WAY);
  b.fillRect(28, 24, 2, 4, TileType.BREAKABLE);
  b.fillRect(14, 27, 8, 1, TileType.CONVEYOR_R);
  b.buildPlatform(5, 24, 6, TileType.ONE_WAY);

  // Cell (5, 1): Crag Boss Arena
  b.buildBossArena(5, 1, true);

  const spawns: SpawnPoint[] = [
    ...makeMainCollectibles(
      'break',
      7,
      [
        [14, 9],
        [42, 10],
        [56, 9],
        [82, 8],
        [138, 9],
        [59, 23],
        [37, 25],
        [8, 24],
      ],
      [4, 28],
      [31, 28],
      [144, 13],
    ),
    // Upper Rim & Rock Chutes
    { id: 'brk_crate_00', kind: 'crate', x: px(8), y: standY(13, 16) },
    { id: 'brk_crawler_00', kind: 'enemy', x: px(16), y: standY(12, 12), archetypeId: 'rail_crawler' },
    { id: 'brk_turret_10', kind: 'enemy', x: px(38), y: standY(13, 16), archetypeId: 'rail_turret' },
    { id: 'brk_cp_1', kind: 'checkpoint', x: px(47), y: standY(13, 28) },

    // Cell (2, 0): Rideable Power Exo-Walker #1!
    { id: 'brk_walker_1', kind: 'walker', x: px(58), y: standY(13, 32) },
    { id: 'brk_guard_20', kind: 'enemy', x: px(70), y: standY(13, 26), archetypeId: 'rail_shield_guard' },

    // Cell (3, 0): Basalt Smash Runway
    { id: 'brk_trooper_30', kind: 'enemy', x: px(80), y: standY(12, 24), archetypeId: 'metro_trooper' },
    { id: 'brk_barrel_30', kind: 'barrel', x: px(87), y: standY(12, 16) },
    { id: 'brk_enforcer_30', kind: 'enemy', x: px(96), y: standY(13, 28), archetypeId: 'heavy_enforcer' },

    // Cell (4, 0) & (5, 0)
    { id: 'brk_cp_2', kind: 'checkpoint', x: px(103), y: standY(13, 28) },
    { id: 'brk_aegis_50', kind: 'enemy', x: px(136), y: standY(12, 26), archetypeId: 'prism_aegis' },
    { id: 'brk_barrel_50', kind: 'barrel', x: px(131), y: standY(13, 16) },

    // Cell (4, 1) & (3, 1): Miniboss Wrecker Tank + Second Walker!
    { id: 'brk_cp_3', kind: 'checkpoint', x: px(104), y: standY(28, 28) },
    { id: 'brk_walker_2', kind: 'walker', x: px(99), y: standY(28, 32) },
    { id: 'brk_miniboss_tank', kind: 'miniboss', x: px(86), y: standY(28, 36), minibossId: 'wrecker_tank' },
    { id: 'brk_barrel_31', kind: 'barrel', x: px(78), y: standY(28, 16) },

    // Deep Core Shafts (2,1..0,1)
    { id: 'brk_hopper_21', kind: 'enemy', x: px(64), y: standY(27, 18), archetypeId: 'track_hopper' },
    { id: 'brk_spawner_11', kind: 'enemy', x: px(43), y: standY(28, 24), archetypeId: 'relay_pod' },
    { id: 'brk_enforcer_01', kind: 'enemy', x: px(18), y: standY(27, 28), archetypeId: 'heavy_enforcer' },
    { id: 'brk_crate_01', kind: 'crate', x: px(11), y: standY(28, 16) },
    { id: 'brk_cp_4', kind: 'checkpoint', x: px(121), y: standY(28, 28) },

    // Cell (5, 1): Crag Boss
    { id: 'brk_boss_crag', kind: 'boss', x: px(141), y: standY(28, 42), bossId: 'crag' },
  ];

  if (remix) {
    // Master Remix: rock-stamp crushers, extra breakable seams & quarry fissure spikes
    b.fillRect(35, 8, 2, 1, TileType.CRUSHER);
    b.fillRect(86, 8, 2, 1, TileType.CRUSHER);
    b.fillRect(62, 23, 2, 1, TileType.CRUSHER);
    b.fillRect(114, 28, 3, 1, TileType.SPIKE);
    b.buildPlatform(114, 25, 3, TileType.ONE_WAY);
    b.fillRect(119, 24, 1, 4, TileType.BREAKABLE);
    spawns.push(
      { id: 'brk_rmx_turret_20', kind: 'enemy', x: px(55), y: standY(9, 18), archetypeId: 'helios_turret' },
      { id: 'brk_rmx_crawler_30', kind: 'enemy', x: px(89), y: standY(13, 12), archetypeId: 'rail_crawler' },
      { id: 'brk_rmx_guard_41', kind: 'enemy', x: px(112), y: standY(28, 26), archetypeId: 'rail_shield_guard' },
      { id: 'brk_rmx_barrel_41', kind: 'barrel', x: px(117), y: standY(28, 16) },
    );
  }

  return {
    id: 'break',
    name: titleWithRemix('Deep Quarry', remix),
    subtitle: subtitleWithRemix('Basalt Excavation', remix),
    remix,
    biomeGimmick: 'quarry_walker',
    bgmKey: 'bgm_break',
    bossBgmKey: 'bgm_boss_master',
    bossId: 'crag',
    minibossId: 'wrecker_tank',
    cellsW: b.cellsW,
    cellsH: b.cellsH,
    tilesW: b.tilesW,
    tilesH: b.tilesH,
    tiles: b.tiles,
    spawnX: px(3),
    spawnY: standY(13, 28),
    bossCellX: 5,
    bossCellY: 1,
    spawns,
    palette: {
      skyTop: '#1a1314',
      skyBottom: '#573632',
      farBg: '#302120',
      midBg: '#4a312e',
      tilePrimary: '#78625e',
      tileHighlight: '#c7b0aa',
      tileShadow: '#362725',
      accent: '#f97316',
    },
  };
}

// ============================================================================
// 11. CIPHER — Neon Matrix (6x2 cells = 150x30)
// Boss: Phantom (5, 0) | Armor Paint 8 (Cipher Ghost)
// Signature: PROXIMITY_SOLID cyber-blocks + TOGGLE_A/B switch gates
// ============================================================================
function createCipherStage(remix: boolean): StageDefinition {
  const b = new TilemapBuilder(6, 2);
  b.buildDualDeckBase(2);

  // Cell (0, 1): Subnet Entry Node — intro Proximity Solid stepping bridge
  b.fillRect(10, 28, 8, 1, TileType.SPIKE);
  b.fillRect(10, 26, 2, 1, TileType.PROXIMITY_SOLID);
  b.fillRect(13, 25, 2, 1, TileType.PROXIMITY_SOLID);
  b.fillRect(16, 26, 2, 1, TileType.PROXIMITY_SOLID);
  b.buildPlatform(12, 22, 4, TileType.ONE_WAY);

  // Cell (1, 1): Dual-Phase Firewall Corridor (switches on both sides — never softlocks!)
  b.fillRect(32, 17, 1, 7, TileType.SOLID);
  b.fillRect(32, 24, 1, 4, TileType.TOGGLE_A);
  b.fillRect(42, 17, 1, 7, TileType.SOLID);
  b.fillRect(42, 24, 1, 4, TileType.TOGGLE_B);
  b.buildPlatform(34, 24, 6, TileType.ONE_WAY);

  // Cell (2, 1) -> (2, 0): Phantom Bridge Chasm & Upload Shaft
  b.fillRect(74, 15, 1, 15, TileType.SOLID); // seal east; (3,1)/(4,1) entered from (4,0)
  b.fillRect(54, 28, 8, 1, TileType.SPIKE);
  b.fillRect(55, 25, 2, 1, TileType.PROXIMITY_SOLID);
  b.fillRect(59, 24, 2, 1, TileType.PROXIMITY_SOLID);
  b.carveDeckShaft(65, 5, false);

  // Cell (1, 0) & (0, 0): Encrypted Datavault (west from (2, 0))
  b.fillRect(32, 13, 8, 1, TileType.SPIKE);
  b.fillRect(33, 10, 2, 1, TileType.PROXIMITY_SOLID);
  b.fillRect(37, 9, 2, 1, TileType.PROXIMITY_SOLID);
  b.fillRect(21, 2, 1, 7, TileType.SOLID);
  b.fillRect(21, 9, 1, 4, TileType.BREAKABLE);
  b.fillRect(8, 10, 3, 1, TileType.PROXIMITY_SOLID);
  b.buildPlatform(3, 8, 4, TileType.ONE_WAY);

  // Cell (3, 0): Switch-Matrix Puzzle Room
  b.fillRect(80, 13, 10, 1, TileType.SPIKE);
  b.fillRect(80, 11, 3, 1, TileType.TOGGLE_A);
  b.fillRect(84, 10, 3, 1, TileType.TOGGLE_B);
  b.fillRect(88, 11, 2, 1, TileType.PROXIMITY_SOLID);
  b.fillRect(82, 5, 6, 1, TileType.SOLID); // hookshot bypass beam
  b.buildPlatform(83, 8, 4, TileType.ONE_WAY);

  // Cell (4, 0) -> (4, 1) & (3, 1): Data-Stream Overpass & Deep Cache Vault
  b.carveDeckShaft(108, 4, false);
  b.fillRect(114, 13, 6, 1, TileType.SPIKE);
  b.fillRect(114, 11, 2, 1, TileType.PROXIMITY_SOLID);
  b.fillRect(118, 11, 2, 1, TileType.PROXIMITY_SOLID);

  b.fillRect(84, 28, 6, 1, TileType.SPIKE);
  b.fillRect(85, 25, 2, 1, TileType.PROXIMITY_SOLID);
  b.fillRect(88, 24, 2, 1, TileType.PROXIMITY_SOLID);
  b.buildPlatform(77, 24, 5, TileType.ONE_WAY);

  // Cell (5, 0): Phantom Boss Arena (with PROXIMITY_SOLID mid-air cyber ledges!)
  b.buildBossArena(5, 0, true, TileType.PROXIMITY_SOLID);

  const spawns: SpawnPoint[] = [
    ...makeMainCollectibles(
      'cipher',
      8,
      [
        [14, 22],
        [37, 24],
        [57, 22],
        [37, 9],
        [5, 8],
        [85, 8],
        [119, 28],
        [79, 24],
      ],
      [13, 13],
      [78, 28],
      [4, 13],
    ),
    { id: 'cph_crate_01', kind: 'crate', x: px(7), y: standY(28, 16) },
    { id: 'cph_crawler_01', kind: 'enemy', x: px(21), y: standY(28, 12), archetypeId: 'mirror_crawler' },

    // Switches on each side of firewall gates in (1, 1)
    { id: 'cph_switch_11a', kind: 'switch', x: px(29), y: standY(28, 16) },
    { id: 'cph_aegis_11', kind: 'enemy', x: px(37), y: standY(28, 26), archetypeId: 'prism_aegis' },
    { id: 'cph_switch_11b', kind: 'switch', x: px(40), y: standY(28, 16) },
    { id: 'cph_switch_11c', kind: 'switch', x: px(45), y: standY(28, 16) },
    { id: 'cph_cp_1', kind: 'checkpoint', x: px(48), y: standY(28, 28) },

    { id: 'cph_orb_21', kind: 'enemy', x: px(58), y: px(22), archetypeId: 'plasma_orb' },
    { id: 'cph_cp_2', kind: 'checkpoint', x: px(71), y: standY(13, 28) },

    { id: 'cph_wing_10', kind: 'enemy', x: px(36), y: px(6), archetypeId: 'mirage_wing' },
    { id: 'cph_turret_00', kind: 'enemy', x: px(16), y: standY(13, 18), archetypeId: 'helios_turret' },

    { id: 'cph_switch_30', kind: 'switch', x: px(77), y: standY(13, 16) },
    { id: 'cph_spawner_30', kind: 'enemy', x: px(94), y: standY(13, 24), archetypeId: 'relay_pod' },
    { id: 'cph_cp_3', kind: 'checkpoint', x: px(103), y: standY(13, 28) },

    { id: 'cph_enforcer_41', kind: 'enemy', x: px(101), y: standY(28, 28), archetypeId: 'heavy_enforcer' },
    { id: 'cph_barrel_41', kind: 'barrel', x: px(96), y: standY(28, 16) },
    { id: 'cph_hopper_31', kind: 'enemy', x: px(81), y: standY(28, 18), archetypeId: 'dune_hopper' },
    { id: 'cph_cp_4', kind: 'checkpoint', x: px(122), y: standY(13, 28) },

    { id: 'cph_boss_phantom', kind: 'boss', x: px(142), y: standY(13, 38), bossId: 'phantom' },
  ];

  if (remix) {
    // Master Remix: scanner lasers, extra proximity gaps & cyber sentinels
    b.set(14, 17, TileType.LASER_MIRROR);
    b.set(85, 2, TileType.LASER_MIRROR);
    b.set(116, 2, TileType.LASER_MIRROR);
    b.buildPlatform(34, 24, 6, TileType.PROXIMITY_SOLID);
    b.fillRect(102, 28, 4, 1, TileType.SPIKE);
    b.fillRect(103, 25, 2, 1, TileType.PROXIMITY_SOLID);
    spawns.push(
      { id: 'cph_rmx_orb_30', kind: 'enemy', x: px(87), y: px(7), archetypeId: 'plasma_orb' },
      { id: 'cph_rmx_aegis_40', kind: 'enemy', x: px(112), y: standY(13, 26), archetypeId: 'prism_aegis' },
      { id: 'cph_rmx_enforcer_10', kind: 'enemy', x: px(28), y: standY(13, 28), archetypeId: 'heavy_enforcer' },
      { id: 'cph_rmx_crate_40', kind: 'crate', x: px(105), y: standY(13, 16) },
    );
  }

  return {
    id: 'cipher',
    name: titleWithRemix('Neon Matrix', remix),
    subtitle: subtitleWithRemix('Phantom Subnet', remix),
    remix,
    biomeGimmick: 'neon_matrix',
    bgmKey: 'bgm_cipher',
    bossBgmKey: 'bgm_boss_master',
    bossId: 'phantom',
    cellsW: b.cellsW,
    cellsH: b.cellsH,
    tilesW: b.tilesW,
    tilesH: b.tilesH,
    tiles: b.tiles,
    spawnX: px(3),
    spawnY: standY(28, 28),
    bossCellX: 5,
    bossCellY: 0,
    spawns,
    palette: {
      skyTop: '#071414',
      skyBottom: '#134e4a',
      farBg: '#0c2929',
      midBg: '#113d3a',
      tilePrimary: '#247569',
      tileHighlight: '#86efac',
      tileShadow: '#0d302b',
      accent: '#a855f7',
    },
  };
}

// ============================================================================
// 12. FINAL_1 — Citadel Gates (6x2 cells = 150x30)
// Boss: Unit K-00 Mirror (mirror_rival) in (5, 0) | Secret Armor Paint 9
// ============================================================================
function createFinal1Stage(remix: boolean): StageDefinition {
  const b = new TilemapBuilder(6, 2);
  b.buildDualDeckBase(2);

  // Cell (0, 1): Outer Drawbridge
  b.fillRect(10, 27, 9, 1, TileType.CONVEYOR_L);
  b.buildPlatform(12, 24, 6, TileType.ONE_WAY);

  // Cell (1, 1): Gatehouse Crusher & Slide Vent
  b.fillRect(28, 23, 2, 1, TileType.CRUSHER);
  b.buildSlideVent(35, 6, 17, 28);
  b.fillRect(44, 23, 2, 1, TileType.CRUSHER);

  // Cell (2, 1) -> (2, 0): Bastion Ascent Tower
  b.fillRect(74, 15, 1, 15, TileType.SOLID);
  b.carveDeckShaft(58, 5, true);
  b.set(53, 27, TileType.BOUNCE_PAD);

  // Cell (1, 0) & (0, 0): Secret Citadel Armory (Armor Paint 9: Overclock Crimson)
  b.fillRect(36, 2, 1, 7, TileType.SOLID);
  b.fillRect(36, 9, 1, 4, TileType.BREAKABLE);
  b.set(28, 2, TileType.LASER_MIRROR);
  b.fillRect(14, 13, 5, 1, TileType.SPIKE);
  b.fillRect(14, 5, 5, 1, TileType.SOLID);
  b.buildPlatform(4, 10, 6, TileType.ONE_WAY);

  // Cell (3, 0): Laser Turret Ramparts
  b.set(81, 2, TileType.LASER_MIRROR);
  b.set(89, 2, TileType.LASER_MIRROR);
  b.fillRect(83, 13, 5, 1, TileType.SPIKE);
  b.buildPlatform(83, 10, 5, TileType.ONE_WAY);

  // Cell (4, 0) & (4, 1): Inner Keep Gauntlet
  b.carveDeckShaft(104, 4, false);
  b.fillRect(112, 12, 8, 1, TileType.CONVEYOR_L);
  b.fillRect(115, 8, 2, 1, TileType.CRUSHER);
  b.buildPlatform(112, 24, 8, TileType.ONE_WAY);

  // Cell (5, 0): Mirror Rival Boss Arena
  b.buildBossArena(5, 0, true);

  const spawns: SpawnPoint[] = [
    { id: 'f1_palette_9', kind: 'palette_chip', x: px(6), y: standY(10, 18), armorPaintId: 9 },
    { id: 'f1_crate_01', kind: 'crate', x: px(8), y: standY(28, 16) },
    { id: 'f1_turret_01', kind: 'enemy', x: px(21), y: standY(28, 18), archetypeId: 'helios_turret' },
    { id: 'f1_guard_11', kind: 'enemy', x: px(32), y: standY(28, 26), archetypeId: 'rail_shield_guard' },
    { id: 'f1_cp_1', kind: 'checkpoint', x: px(48), y: standY(28, 28) },

    { id: 'f1_wing_21', kind: 'enemy', x: px(61), y: px(20), archetypeId: 'mirage_wing' },
    { id: 'f1_enforcer_20', kind: 'enemy', x: px(54), y: standY(13, 28), archetypeId: 'heavy_enforcer' },
    { id: 'f1_cp_2', kind: 'checkpoint', x: px(68), y: standY(13, 28) },

    { id: 'f1_aegis_10', kind: 'enemy', x: px(32), y: standY(13, 26), archetypeId: 'prism_aegis' },
    { id: 'f1_barrel_00', kind: 'barrel', x: px(11), y: standY(13, 16) },

    { id: 'f1_spawner_30', kind: 'enemy', x: px(86), y: standY(10, 24), archetypeId: 'relay_pod' },
    { id: 'f1_hopper_30', kind: 'enemy', x: px(94), y: standY(13, 18), archetypeId: 'dune_hopper' },
    { id: 'f1_cp_3', kind: 'checkpoint', x: px(101), y: standY(13, 28) },

    { id: 'f1_enforcer_40', kind: 'enemy', x: px(118), y: standY(12, 28), archetypeId: 'heavy_enforcer' },
    { id: 'f1_barrel_40', kind: 'barrel', x: px(111), y: standY(13, 16) },
    { id: 'f1_cp_4', kind: 'checkpoint', x: px(122), y: standY(13, 28) },

    { id: 'f1_boss_mirror', kind: 'boss', x: px(142), y: standY(13, 36), bossId: 'mirror_rival' },
  ];

  if (remix) {
    b.set(14, 17, TileType.ELECTRIC_RAIL);
    b.fillRect(32, 23, 2, 1, TileType.CRUSHER);
    b.fillRect(83, 10, 2, 1, TileType.TOGGLE_A);
    b.fillRect(86, 10, 2, 1, TileType.TOGGLE_B);
    b.set(109, 2, TileType.LASER_MIRROR);
    spawns.push(
      { id: 'f1_rmx_switch_30', kind: 'switch', x: px(78), y: standY(13, 16) },
      { id: 'f1_rmx_orb_30', kind: 'enemy', x: px(85), y: px(7), archetypeId: 'plasma_orb' },
      { id: 'f1_rmx_aegis_40', kind: 'enemy', x: px(113), y: standY(12, 26), archetypeId: 'prism_aegis' },
      { id: 'f1_rmx_enforcer_11', kind: 'enemy', x: px(42), y: standY(28, 28), archetypeId: 'heavy_enforcer' },
    );
  }

  return {
    id: 'final_1',
    name: titleWithRemix('Citadel Gates', remix),
    subtitle: subtitleWithRemix('Outer Bastion', remix),
    remix,
    biomeGimmick: 'citadel_gauntlet',
    bgmKey: 'bgm_final_1',
    bossBgmKey: 'bgm_boss_final_1',
    bossId: 'mirror_rival',
    cellsW: b.cellsW,
    cellsH: b.cellsH,
    tilesW: b.tilesW,
    tilesH: b.tilesH,
    tiles: b.tiles,
    spawnX: px(3),
    spawnY: standY(28, 28),
    bossCellX: 5,
    bossCellY: 0,
    spawns,
    palette: {
      skyTop: '#17060d',
      skyBottom: '#661128',
      farBg: '#330a17',
      midBg: '#521024',
      tilePrimary: '#7a283e',
      tileHighlight: '#fda4af',
      tileShadow: '#360d18',
      accent: '#fbbf24',
    },
    hasStars: true,
  };
}

// ============================================================================
// 13. FINAL_2 — Core Reactor (6x2 cells = 150x30)
// Boss: Prism Core (5, 1) | Secret Armor Paint 10 (Aegis Platinum)
// ============================================================================
function createFinal2Stage(remix: boolean): StageDefinition {
  const b = new TilemapBuilder(6, 2);
  b.buildDualDeckBase(2);

  // Cell (0, 0): Reactor Coolant Intake (ICE + ELECTRIC_RAIL coil)
  b.fillRect(8, 13, 14, 1, TileType.ICE);
  b.set(16, 2, TileType.ELECTRIC_RAIL);
  b.buildPlatform(12, 10, 6, TileType.ONE_WAY);

  // Cell (1, 0): Phase Conduit (PROXIMITY_SOLID bridge over reactor core pit)
  b.fillRect(29, 13, 12, 1, TileType.SPIKE);
  b.fillRect(30, 10, 2, 1, TileType.PROXIMITY_SOLID);
  b.fillRect(34, 9, 2, 1, TileType.PROXIMITY_SOLID);
  b.fillRect(38, 10, 2, 1, TileType.PROXIMITY_SOLID);
  b.fillRect(32, 5, 6, 1, TileType.SOLID);

  // Cell (2, 0) -> (2, 1): Rhythm Turbine & Reactor Drop Shaft
  b.fillRect(54, 13, 8, 1, TileType.ELECTRIC_RAIL);
  b.fillRect(54, 10, 4, 1, TileType.TOGGLE_A);
  b.fillRect(58, 10, 4, 1, TileType.TOGGLE_B);
  b.buildPlatform(55, 7, 6, TileType.ONE_WAY);
  b.carveDeckShaft(66, 5, false);

  // Cell (1, 1) & (0, 1): Secret Titanium Vault (Armor Paint 10: Aegis Platinum)
  b.fillRect(38, 17, 1, 7, TileType.SOLID);
  b.fillRect(38, 24, 1, 4, TileType.BREAKABLE);
  b.fillRect(20, 28, 14, 1, TileType.ICE);
  b.set(26, 17, TileType.LASER_MIRROR);
  b.buildPlatform(5, 24, 6, TileType.ONE_WAY);

  // Cell (3, 1): Laser & Surge Hall
  b.set(80, 17, TileType.LASER_MIRROR);
  b.set(88, 17, TileType.LASER_MIRROR);
  b.fillRect(82, 28, 5, 1, TileType.ELECTRIC_RAIL);
  b.buildPlatform(82, 25, 5, TileType.ONE_WAY);

  // Cell (4, 1): Reactor Sanctum Airlock
  b.fillRect(105, 28, 6, 1, TileType.SPIKE);
  b.fillRect(106, 25, 2, 1, TileType.PROXIMITY_SOLID);
  b.fillRect(109, 25, 2, 1, TileType.PROXIMITY_SOLID);
  b.set(102, 27, TileType.BOUNCE_PAD);

  // Cell (5, 1): Prism Core Boss Arena
  b.buildBossArena(5, 1, true);

  const spawns: SpawnPoint[] = [
    { id: 'f2_palette_10', kind: 'palette_chip', x: px(7), y: standY(24, 18), armorPaintId: 10 },
    { id: 'f2_crate_00', kind: 'crate', x: px(7), y: standY(13, 16) },
    { id: 'f2_aegis_00', kind: 'enemy', x: px(18), y: standY(13, 26), archetypeId: 'prism_aegis' },
    { id: 'f2_orb_10', kind: 'enemy', x: px(35), y: px(7), archetypeId: 'plasma_orb' },
    { id: 'f2_cp_1', kind: 'checkpoint', x: px(46), y: standY(13, 28) },

    { id: 'f2_switch_20', kind: 'switch', x: px(51), y: standY(13, 16) },
    { id: 'f2_wing_20', kind: 'enemy', x: px(58), y: px(5), archetypeId: 'mirage_wing' },
    { id: 'f2_cp_2', kind: 'checkpoint', x: px(72), y: standY(28, 28) },

    { id: 'f2_enforcer_11', kind: 'enemy', x: px(29), y: standY(28, 28), archetypeId: 'heavy_enforcer' },
    { id: 'f2_turret_01', kind: 'enemy', x: px(14), y: standY(28, 18), archetypeId: 'helios_turret' },

    { id: 'f2_spawner_31', kind: 'enemy', x: px(93), y: standY(28, 24), archetypeId: 'relay_pod' },
    { id: 'f2_barrel_31', kind: 'barrel', x: px(77), y: standY(28, 16) },
    { id: 'f2_cp_3', kind: 'checkpoint', x: px(99), y: standY(28, 28) },

    { id: 'f2_enforcer_41', kind: 'enemy', x: px(115), y: standY(28, 28), archetypeId: 'heavy_enforcer' },
    { id: 'f2_cp_4', kind: 'checkpoint', x: px(121), y: standY(28, 28) },

    { id: 'f2_boss_prism_core', kind: 'boss', x: px(140), y: standY(28, 48), bossId: 'prism_core' },
  ];

  if (remix) {
    b.fillRect(76, 28, 6, 1, TileType.ICE);
    b.set(116, 17, TileType.LASER_MIRROR);
    b.set(35, 2, TileType.LASER_MIRROR);
    b.fillRect(114, 28, 3, 1, TileType.ELECTRIC_RAIL);
    b.buildPlatform(114, 25, 3, TileType.ONE_WAY);
    spawns.push(
      { id: 'f2_rmx_turret_10', kind: 'enemy', x: px(43), y: standY(13, 18), archetypeId: 'helios_turret' },
      { id: 'f2_rmx_orb_31', kind: 'enemy', x: px(84), y: px(22), archetypeId: 'plasma_orb' },
      { id: 'f2_rmx_aegis_41', kind: 'enemy', x: px(118), y: standY(28, 26), archetypeId: 'prism_aegis' },
      { id: 'f2_rmx_barrel_41', kind: 'barrel', x: px(103), y: standY(28, 16) },
    );
  }

  return {
    id: 'final_2',
    name: titleWithRemix('Core Reactor', remix),
    subtitle: subtitleWithRemix('Prism Core Sanctum', remix),
    remix,
    biomeGimmick: 'core_reactor',
    bgmKey: 'bgm_final_2',
    bossBgmKey: 'bgm_boss_final_2',
    bossId: 'prism_core',
    cellsW: b.cellsW,
    cellsH: b.cellsH,
    tilesW: b.tilesW,
    tilesH: b.tilesH,
    tiles: b.tiles,
    spawnX: px(3),
    spawnY: standY(13, 28),
    bossCellX: 5,
    bossCellY: 1,
    spawns,
    palette: {
      skyTop: '#090d1f',
      skyBottom: '#1d3c82',
      farBg: '#12224d',
      midBg: '#1d3570',
      tilePrimary: '#3f5f9e',
      tileHighlight: '#bae6fd',
      tileShadow: '#15254a',
      accent: '#f43f5e',
    },
    hasStars: true,
  };
}

// ============================================================================
// 14. FINAL_3 — Orbital Spire (6x2 cells = 150x30)
// Boss: Overlord Apex (5, 0) | Secret Armor Paint 11 (Apex Circuit)
// ============================================================================
function createFinal3Stage(remix: boolean): StageDefinition {
  const b = new TilemapBuilder(6, 2);
  b.buildDualDeckBase(2);

  // Cell (0, 1): Orbital Lift Base
  b.set(10, 27, TileType.BOUNCE_PAD);
  b.buildPlatform(12, 22, 6, TileType.ONE_WAY);
  b.set(20, 17, TileType.LASER_MIRROR);

  // Cell (1, 1): Grand Hookshot Spire Chasm
  b.fillRect(28, 28, 15, 1, TileType.SPIKE);
  b.fillRect(30, 19, 4, 1, TileType.SOLID);
  b.fillRect(38, 19, 4, 1, TileType.SOLID);
  b.buildPlatform(32, 25, 3, TileType.ONE_WAY);
  b.buildPlatform(38, 25, 3, TileType.ONE_WAY);
  b.set(45, 27, TileType.BOUNCE_PAD);

  // Cell (2, 1): Zero-G Multi-Biome Conduit
  b.fillRect(54, 23, 2, 1, TileType.CRUSHER);
  b.fillRect(60, 28, 6, 1, TileType.ELECTRIC_RAIL);
  b.fillRect(60, 25, 3, 1, TileType.PROXIMITY_SOLID);
  b.fillRect(64, 24, 2, 1, TileType.PROXIMITY_SOLID);
  b.fillRect(70, 23, 2, 1, TileType.CRUSHER);

  // Cell (3, 1) -> (3, 0): Spire Ascent Chimney
  b.fillRect(99, 15, 1, 15, TileType.SOLID);
  b.carveDeckShaft(84, 5, true);
  b.set(80, 27, TileType.BOUNCE_PAD);

  // Cell (2, 0), (1, 0), (0, 0): Secret Sovereign Vault (Armor Paint 11: Apex Circuit)
  b.fillRect(56, 13, 8, 1, TileType.SPIKE);
  b.fillRect(57, 10, 2, 1, TileType.PROXIMITY_SOLID);
  b.fillRect(61, 10, 2, 1, TileType.PROXIMITY_SOLID);
  b.fillRect(34, 2, 1, 7, TileType.SOLID);
  b.fillRect(34, 9, 1, 4, TileType.BREAKABLE);
  b.set(22, 2, TileType.LASER_MIRROR);
  b.buildPlatform(4, 10, 6, TileType.ONE_WAY);

  // Cell (4, 0): Sovereign Throne Approach
  b.fillRect(104, 12, 8, 1, TileType.CONVEYOR_L);
  b.set(108, 2, TileType.LASER_MIRROR);
  b.fillRect(114, 13, 5, 1, TileType.SPIKE);
  b.fillRect(114, 10, 2, 1, TileType.PROXIMITY_SOLID);
  b.fillRect(117, 10, 2, 1, TileType.PROXIMITY_SOLID);
  b.buildPlatform(106, 8, 6, TileType.ONE_WAY);

  // Cell (5, 0): Overlord Apex Sovereign Throne Arena
  b.buildBossArena(5, 0, true);

  const spawns: SpawnPoint[] = [
    { id: 'f3_palette_11', kind: 'palette_chip', x: px(6), y: standY(10, 18), armorPaintId: 11 },
    { id: 'f3_crate_01', kind: 'crate', x: px(7), y: standY(28, 16) },
    { id: 'f3_aegis_01', kind: 'enemy', x: px(16), y: standY(28, 26), archetypeId: 'prism_aegis' },
    { id: 'f3_orb_11', kind: 'enemy', x: px(35), y: px(22), archetypeId: 'plasma_orb' },
    { id: 'f3_wing_11', kind: 'enemy', x: px(40), y: px(21), archetypeId: 'mirage_wing' },
    { id: 'f3_cp_1', kind: 'checkpoint', x: px(48), y: standY(28, 28) },

    { id: 'f3_enforcer_21', kind: 'enemy', x: px(57), y: standY(28, 28), archetypeId: 'heavy_enforcer' },
    { id: 'f3_turret_21', kind: 'enemy', x: px(73), y: standY(28, 18), archetypeId: 'helios_turret' },
    { id: 'f3_cp_2', kind: 'checkpoint', x: px(77), y: standY(28, 28) },

    { id: 'f3_cp_3', kind: 'checkpoint', x: px(94), y: standY(13, 28) },
    { id: 'f3_spawner_20', kind: 'enemy', x: px(68), y: standY(13, 24), archetypeId: 'relay_pod' },
    { id: 'f3_enforcer_00', kind: 'enemy', x: px(16), y: standY(13, 28), archetypeId: 'heavy_enforcer' },

    { id: 'f3_barrel_40', kind: 'barrel', x: px(102), y: standY(13, 16) },
    { id: 'f3_aegis_40', kind: 'enemy', x: px(109), y: standY(12, 26), archetypeId: 'prism_aegis' },
    { id: 'f3_enforcer_40', kind: 'enemy', x: px(120), y: standY(13, 28), archetypeId: 'heavy_enforcer' },
    { id: 'f3_cp_4', kind: 'checkpoint', x: px(123), y: standY(13, 28) },

    { id: 'f3_boss_overlord', kind: 'boss', x: px(140), y: standY(13, 52), bossId: 'overlord_apex' },
  ];

  if (remix) {
    // Master Remix: full orbital gauntlet with ice approach, crushers, surge coils & lasers
    b.fillRect(10, 28, 10, 1, TileType.ICE);
    b.set(36, 17, TileType.ELECTRIC_RAIL);
    b.fillRect(32, 25, 3, 1, TileType.PROXIMITY_SOLID);
    b.fillRect(38, 25, 3, 1, TileType.PROXIMITY_SOLID);
    b.fillRect(105, 8, 2, 1, TileType.CRUSHER);
    b.set(116, 2, TileType.LASER_MIRROR);
    spawns.push(
      { id: 'f3_rmx_orb_21', kind: 'enemy', x: px(63), y: px(21), archetypeId: 'plasma_orb' },
      { id: 'f3_rmx_spawner_30', kind: 'enemy', x: px(97), y: standY(13, 24), archetypeId: 'relay_pod' },
      { id: 'f3_rmx_turret_40', kind: 'enemy', x: px(111), y: standY(8, 18), archetypeId: 'helios_turret' },
      { id: 'f3_rmx_barrel_40', kind: 'barrel', x: px(121), y: standY(13, 16) },
    );
  }

  return {
    id: 'final_3',
    name: titleWithRemix('Orbital Spire', remix),
    subtitle: subtitleWithRemix('Sovereign Throne', remix),
    remix,
    biomeGimmick: 'orbital_spire',
    bgmKey: 'bgm_final_3',
    bossBgmKey: 'bgm_boss_final_3_p1',
    bossId: 'overlord_apex',
    cellsW: b.cellsW,
    cellsH: b.cellsH,
    tilesW: b.tilesW,
    tilesH: b.tilesH,
    tiles: b.tiles,
    spawnX: px(3),
    spawnY: standY(28, 28),
    bossCellX: 5,
    bossCellY: 0,
    spawns,
    palette: {
      skyTop: '#0a0514',
      skyBottom: '#431478',
      farBg: '#1d0a36',
      midBg: '#321259',
      tilePrimary: '#6b3fa0',
      tileHighlight: '#e9d5ff',
      tileShadow: '#240f40',
      accent: '#f59e0b',
    },
    hasStars: true,
  };
}

// ============================================================================
// 15. BOSS_RUSH — Apex Gauntlet Championship Coliseum (1x1 cell = 25x15)
// ============================================================================
function createBossRushStage(): StageDefinition {
  const b = new TilemapBuilder(1, 1);
  b.buildOuterFrame(2);
  b.fillRect(0, 13, 25, 2, TileType.SOLID);
  b.buildPlatform(4, 10, 4, TileType.ONE_WAY);
  b.buildPlatform(17, 10, 4, TileType.ONE_WAY);
  // Central overhead grapple beam for high-skill Boss Rush aerials
  b.fillRect(10, 4, 5, 1, TileType.SOLID);

  return {
    id: 'boss_rush',
    name: 'Apex Gauntlet',
    subtitle: 'Boss Rush Arena',
    remix: false,
    biomeGimmick: 'boss_rush_arena',
    bgmKey: 'bgm_boss_master',
    bossBgmKey: 'bgm_boss_master',
    bossId: 'siege_tread',
    cellsW: 1,
    cellsH: 1,
    tilesW: 25,
    tilesH: 15,
    tiles: b.tiles,
    spawnX: px(3),
    spawnY: standY(13, 28),
    bossCellX: 0,
    bossCellY: 0,
    spawns: [
      { id: 'br_boss_0', kind: 'boss', x: px(18), y: standY(13, 40), bossId: 'siege_tread' },
    ],
    palette: {
      skyTop: '#10081c',
      skyBottom: '#3b1557',
      farBg: '#230d38',
      midBg: '#371854',
      tilePrimary: '#593d78',
      tileHighlight: '#a78bfa',
      tileShadow: '#231336',
      accent: '#f43f5e',
    },
    hasStars: true,
  };
}

// ============================================================================
// Master Stage Registry — 15 Official + 12 Master Remix = 27 Distinct Layouts
// ============================================================================

const STAGE_CACHE = new Map<string, StageDefinition>();

function buildStageDefinition(stageId: StageId, remix: boolean): StageDefinition {
  switch (stageId) {
    case 'hub':
      return createHubStage();
    case 'tutorial':
      return createTutorialStage();
    case 'opening':
      return createOpeningStage(remix);
    case 'optic':
      return createOpticStage(remix);
    case 'patch':
      return createPatchStage(remix);
    case 'cooler':
      return createCoolerStage(remix);
    case 'elec':
      return createElecStage(remix);
    case 'shift':
      return createShiftStage(remix);
    case 'wave':
      return createWaveStage(remix);
    case 'break':
      return createBreakStage(remix);
    case 'cipher':
      return createCipherStage(remix);
    case 'final_1':
      return createFinal1Stage(remix);
    case 'final_2':
      return createFinal2Stage(remix);
    case 'final_3':
      return createFinal3Stage(remix);
    case 'boss_rush':
      return createBossRushStage();
  }
}

export function getStageDefinition(stageId: StageId, remix = false): StageDefinition {
  const effectiveRemix =
    stageId === 'hub' || stageId === 'tutorial' || stageId === 'boss_rush' ? false : remix;
  const cacheKey = `${stageId}:${effectiveRemix ? 'r' : 's'}`;
  const cached = STAGE_CACHE.get(cacheKey);
  if (cached) return cached;

  const def = buildStageDefinition(stageId, effectiveRemix);
  STAGE_CACHE.set(cacheKey, def);
  return def;
}

export const ALL_OFFICIAL_STAGES: readonly StageDefinition[] = OFFICIAL_STAGE_IDS.map((id) =>
  getStageDefinition(id, false),
);

export const ALL_REMIX_STAGES: readonly StageDefinition[] = REMIXABLE_STAGES.map((id) =>
  getStageDefinition(id, true),
);

export const WAVE1_FLAGSHIP_STAGES: readonly StageId[] = ['hub', 'opening', 'optic'] as const;
