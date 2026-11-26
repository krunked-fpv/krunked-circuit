import {
  ENGINE_CONSTANTS,
  TileType,
  type BiomeGimmick,
  type BossId,
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

  buildOuterFrame(ceilingRows = 2): void {
    this.fillRect(0, 0, this.tilesW, ceilingRows, TileType.SOLID);
    this.fillRect(0, 0, 1, this.tilesH, TileType.SOLID);
    this.fillRect(this.tilesW - 1, 0, 1, this.tilesH, TileType.SOLID);
  }

  buildPlatform(tx: number, ty: number, w: number, tile: number = TileType.ONE_WAY): void {
    this.fillRect(tx, ty, w, 1, tile);
  }
}

// ============================================================================
// Stage 1: HUB — Circuit Guard HQ Command Deck (3x1 cells = 75x15 tiles)
// ============================================================================
function createHubStage(): StageDefinition {
  const b = new TilemapBuilder(3, 1);
  b.buildOuterFrame(2);
  // Continuous Command Deck floor across all 3 cells (rows 13..14, top y = 208)
  b.fillRect(0, 13, b.tilesW, 2, TileType.SOLID);

  // Cell 0 (0..24): Command Bridge — elevated catwalk at row 10 (3 tiles above floor)
  b.buildPlatform(8, 10, 10, TileType.ONE_WAY);
  // Decorative bridge pillars on ceiling
  b.fillRect(6, 2, 1, 2, TileType.SOLID);
  b.fillRect(19, 2, 1, 2, TileType.SOLID);

  // Cell 1 (25..49): Medbay & Engineering — upper gantry at row 10 + bounce pad
  b.buildPlatform(30, 10, 15, TileType.ONE_WAY);
  b.set(27, 12, TileType.BOUNCE_PAD);

  // Cell 2 (50..74): Training Dojo — platforms, hookshot bar, wall-jump wall, toggle blocks
  b.buildPlatform(64, 10, 6, TileType.ONE_WAY);
  b.buildPlatform(56, 7, 5, TileType.ONE_WAY);
  // Ceiling grapple anchor for hookshot swing practice
  b.fillRect(61, 4, 5, 1, TileType.SOLID);
  // Wall-jump vertical column
  b.fillRect(72, 3, 2, 10, TileType.SOLID);
  // Toggle practice blocks controlled by dojo switch
  b.fillRect(65, 8, 2, 1, TileType.TOGGLE_A);
  b.fillRect(68, 8, 2, 1, TileType.TOGGLE_B);

  const spawns: SpawnPoint[] = [
    // Cell 0 Terminals (Command Zone)
    { id: 'hub_term_mission', kind: 'hub_terminal', x: px(9), y: standY(13, 24), terminalKind: 'mission_select' },
    { id: 'hub_term_compendium', kind: 'hub_terminal', x: px(15), y: standY(13, 24), terminalKind: 'compendium' },
    { id: 'hub_term_challenges', kind: 'hub_terminal', x: px(20), y: standY(13, 24), terminalKind: 'challenges' },
    { id: 'hub_term_refight', kind: 'hub_terminal', x: px(12), y: standY(10, 24), terminalKind: 'refight_terminal' },

    // Cell 1 Terminals (Medbay & Engineering Zone)
    { id: 'hub_term_medbay', kind: 'hub_terminal', x: px(31), y: standY(13, 24), terminalKind: 'medbay_chips' },
    { id: 'hub_term_paint', kind: 'hub_terminal', x: px(38), y: standY(13, 24), terminalKind: 'paint_bay' },
    { id: 'hub_term_dojo', kind: 'hub_terminal', x: px(44), y: standY(13, 24), terminalKind: 'burst_dojo' },
    { id: 'hub_crate_medbay', kind: 'crate', x: px(47), y: standY(13, 16) },

    // Cell 2 Terminal & Training Props (Dojo Zone)
    { id: 'hub_term_training', kind: 'hub_terminal', x: px(53), y: standY(13, 24), terminalKind: 'training_room' },
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
// Stage 2: OPENING — Metro Expressway & Armored Train (6x1 cells = 150x15)
// ============================================================================
function createOpeningStage(remix: boolean): StageDefinition {
  const b = new TilemapBuilder(6, 1);
  b.buildOuterFrame(2);

  // Cell 0 (0..24): Expressway Launch Runway
  b.fillRect(0, 13, 16, 2, TileType.SOLID);
  b.buildPlatform(7, 10, 7, TileType.ONE_WAY);
  // 3-tile jump gap (16..18) with spike bottom for crisp hazard-warp
  b.fillRect(16, 14, 3, 1, TileType.SPIKE);
  // Armored train lead car deck (19..39) at row 12
  b.fillRect(19, 12, 21, 3, TileType.SOLID);

  // Cell 1 (25..49): Exact 1-Tile Slide Underpass (row 11 open above row 12 floor!)
  b.fillRect(31, 2, 5, 9, TileType.SOLID); // fills rows 2..10, leaving row 11 (16px) clear!
  // Step down to main freight car floor (40..55) at row 13
  b.fillRect(40, 13, 16, 2, TileType.SOLID);

  // Cell 2 (50..74): Hookshot Grapple Chasm & Freight Couplers
  // 9-tile chasm (56..64) with spike hazard at bottom, overhead grapple girder + coupler struts
  b.fillRect(56, 14, 9, 1, TileType.SPIKE);
  b.fillRect(56, 6, 9, 1, TileType.SOLID); // hookshot latch girder
  b.buildPlatform(58, 11, 2, TileType.ONE_WAY);
  b.buildPlatform(62, 11, 2, TileType.ONE_WAY);
  // Post-chasm car (65..67) + 3-tile gap (68..70) + deck (71..99)
  b.fillRect(65, 13, 3, 2, TileType.SOLID);
  b.fillRect(68, 14, 3, 1, TileType.SPIKE);
  b.fillRect(71, 13, 29, 2, TileType.SOLID);

  // Cell 3 (75..99): Cargo Car Riot — upper rafters + breakable partition
  b.buildPlatform(78, 10, 17, TileType.ONE_WAY);
  b.fillRect(97, 2, 1, 7, TileType.SOLID);
  b.fillRect(97, 11, 1, 2, TileType.BREAKABLE);

  // Cell 4 (100..124): Express Conveyor & Pre-Boss Approach
  b.fillRect(100, 13, 4, 2, TileType.SOLID);
  b.fillRect(104, 12, 10, 1, TileType.CONVEYOR_R);
  b.fillRect(104, 13, 10, 2, TileType.SOLID);
  b.buildPlatform(108, 9, 4, TileType.ONE_WAY);
  b.fillRect(114, 13, 11, 2, TileType.SOLID);

  // Boss bulkhead header at cell boundary (124..125, rows 2..8), open doorway rows 9..12
  b.fillRect(124, 2, 2, 7, TileType.SOLID);

  // Cell 5 (125..149): Siege Tread Boss Arena
  b.fillRect(125, 13, 25, 2, TileType.SOLID);
  b.buildPlatform(129, 10, 4, TileType.ONE_WAY);
  b.buildPlatform(142, 10, 4, TileType.ONE_WAY);

  const spawns: SpawnPoint[] = [
    // Cell 0
    { id: 'op_crate_0', kind: 'crate', x: px(9), y: standY(13, 16) },
    { id: 'op_trooper_0', kind: 'enemy', x: px(12), y: standY(13, 24), archetypeId: 'metro_trooper' },
    { id: 'op_drone_0', kind: 'enemy', x: px(21), y: px(8), archetypeId: 'metro_drone' },

    // Cell 1
    { id: 'op_crate_1', kind: 'crate', x: px(37), y: standY(12, 16) },
    { id: 'op_guard_1', kind: 'enemy', x: px(42), y: standY(13, 26), archetypeId: 'rail_shield_guard' },
    { id: 'op_crawler_1', kind: 'enemy', x: px(45), y: standY(13, 12), archetypeId: 'rail_crawler' },
    { id: 'op_cp_1', kind: 'checkpoint', x: px(48), y: standY(13, 24) },

    // Cell 2
    { id: 'op_hopper_2', kind: 'enemy', x: px(53), y: standY(13, 18), archetypeId: 'track_hopper' },
    { id: 'op_drone_2', kind: 'enemy', x: px(60), y: px(8), archetypeId: 'metro_drone' },
    { id: 'op_turret_2', kind: 'enemy', x: px(73), y: standY(13, 16), archetypeId: 'rail_turret' },

    // Cell 3 (Grab & Throw Riot)
    { id: 'op_crate_3a', kind: 'crate', x: px(78), y: standY(13, 16) },
    { id: 'op_guard_3a', kind: 'enemy', x: px(83), y: standY(13, 26), archetypeId: 'rail_shield_guard' },
    { id: 'op_trooper_3a', kind: 'enemy', x: px(86), y: standY(10, 24), archetypeId: 'metro_trooper' },
    { id: 'op_barrel_3a', kind: 'barrel', x: px(87), y: standY(13, 16) },
    { id: 'op_barrel_3b', kind: 'barrel', x: px(91), y: standY(13, 16) },
    { id: 'op_guard_3b', kind: 'enemy', x: px(94), y: standY(13, 26), archetypeId: 'rail_shield_guard' },

    // Cell 4
    { id: 'op_turret_4', kind: 'enemy', x: px(110), y: standY(9, 16), archetypeId: 'rail_turret' },
    { id: 'op_hopper_4', kind: 'enemy', x: px(116), y: standY(13, 18), archetypeId: 'track_hopper' },
    { id: 'op_cp_2', kind: 'checkpoint', x: px(121), y: standY(13, 24) },

    // Cell 5: Siege Tread Boss
    { id: 'op_boss_siege', kind: 'boss', x: px(142), y: standY(13, 40), bossId: 'siege_tread' },
  ];

  if (remix) {
    spawns.push(
      { id: 'op_rmx_guard_0', kind: 'enemy', x: px(23), y: standY(12, 26), archetypeId: 'rail_shield_guard' },
      { id: 'op_rmx_drone_3', kind: 'enemy', x: px(90), y: px(6), archetypeId: 'mirage_wing' },
      { id: 'op_rmx_enforcer_4', kind: 'enemy', x: px(118), y: standY(13, 28), archetypeId: 'heavy_enforcer' },
    );
  }

  return {
    id: 'opening',
    name: 'Metro Expressway',
    subtitle: remix ? 'Armored Train — Master Remix' : 'Armored Train',
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
// Stage 3: OPTIC — Solar Relay (6x2 cells = 150x30 tiles)
// All 8 Rescues (0..7), 1 Health Booster, 1 Burst Booster,
// 1 Solar Beam Palette Chip (Armor ID 1), 4 Checkpoints, Prism Boss Arena (5,1)
// ============================================================================
function createOpticStage(remix: boolean): StageDefinition {
  const b = new TilemapBuilder(6, 2);
  b.buildOuterFrame(2);

  // Full bottom row floor (rows 28..29) and middle separator deck (rows 13..16)
  b.fillRect(0, 28, b.tilesW, 2, TileType.SOLID);
  b.fillRect(0, 13, b.tilesW, 4, TileType.SOLID);

  // --- Cell (0, 1): Sunlit Lower Approach (tx 0..24, ty 15..29) ---
  b.buildPlatform(8, 25, 4, TileType.ONE_WAY);
  b.buildPlatform(12, 22, 4, TileType.ONE_WAY);

  // --- Cell (1, 1): 1-Tile Solar Slide Vent & Mirror Hall (tx 25..49, ty 15..29) ---
  // Exact 1-tile slide vent: bulkhead rows 17..26 at tx 32..37 leaves row 27 (16px) open!
  b.fillRect(32, 17, 6, 10, TileType.SOLID);
  // Ceiling solar mirror laser emitter
  b.set(44, 17, TileType.LASER_MIRROR);

  // --- Cell (2, 1) -> Cell (2, 0): Upward Vertical Wall-Jump Shaft (tx 50..74) ---
  // Seal right boundary between (2,1) and (3,1) so (3,1) is a secret vault entered from (4,1)
  b.fillRect(74, 15, 2, 15, TileType.SOLID);
  // Carve shaft opening through middle deck (tx 58..62, rows 13..16)
  b.fillRect(58, 13, 5, 4, TileType.EMPTY);
  // Shaft guide walls in (2,1) (rows 17..24), leaving 3-tile floor walk-under (rows 25..27)
  b.fillRect(57, 17, 1, 8, TileType.SOLID);
  b.fillRect(63, 17, 1, 8, TileType.SOLID);
  // Alternating ONE_WAY ledges every 3 rows inside the shaft + safety lip at top (row 13)
  b.buildPlatform(58, 25, 2, TileType.ONE_WAY);
  b.buildPlatform(61, 22, 2, TileType.ONE_WAY);
  b.buildPlatform(58, 19, 2, TileType.ONE_WAY);
  b.buildPlatform(61, 16, 2, TileType.ONE_WAY);
  b.buildPlatform(58, 13, 5, TileType.ONE_WAY);

  // --- Cell (1, 0): Optional West Solar Gallery (tx 25..49, ty 0..14) ---
  b.set(34, 2, TileType.LASER_MIRROR);
  b.set(41, 2, TileType.LASER_MIRROR);
  b.set(37, 12, TileType.BOUNCE_PAD);
  b.buildPlatform(31, 10, 3, TileType.ONE_WAY);
  b.buildPlatform(41, 10, 3, TileType.ONE_WAY);
  b.buildPlatform(34, 7, 7, TileType.ONE_WAY);

  // --- Cell (0, 0): Secret Solar Vault (tx 0..24, ty 0..14) ---
  // Short spike trough (tx 10..13, row 13) with overhead hookshot grapple beam
  b.fillRect(10, 13, 4, 1, TileType.SPIKE);
  b.fillRect(10, 6, 4, 1, TileType.SOLID);
  b.buildPlatform(3, 10, 4, TileType.ONE_WAY);

  // --- Cell (3, 0): Hookshot Ceiling-Swing Gallery (tx 75..99, ty 0..14) ---
  // 13-tile sunlit hazard trough (tx 81..93) with spike floor at row 13
  b.fillRect(81, 13, 13, 1, TileType.SPIKE);
  // Overhead solid hookshot grapple beams
  b.fillRect(82, 5, 3, 1, TileType.SOLID);
  b.fillRect(89, 5, 3, 1, TileType.SOLID);
  // Safe stepping pylons & upper solar perch (Rescue #5)
  b.buildPlatform(84, 11, 2, TileType.ONE_WAY);
  b.buildPlatform(89, 11, 2, TileType.ONE_WAY);
  b.buildPlatform(85, 8, 4, TileType.ONE_WAY);

  // --- Cell (4, 0) -> Cell (4, 1): Mirror Corridor & Drop Chute (tx 100..124) ---
  b.set(107, 2, TileType.LASER_MIRROR);
  b.fillRect(112, 10, 2, 1, TileType.TOGGLE_A);
  b.fillRect(114, 10, 2, 1, TileType.TOGGLE_B);
  // Carve 3-tile vertical chute (tx 117..119) between (4,0) and (4,1)
  b.fillRect(117, 13, 3, 4, TileType.EMPTY);
  // Return climbing platforms inside (4,1) so player can always ascend back to (4,0)/(5,0)
  b.buildPlatform(117, 25, 3, TileType.ONE_WAY);
  b.buildPlatform(117, 22, 3, TileType.ONE_WAY);
  b.buildPlatform(117, 19, 3, TileType.ONE_WAY);
  b.buildPlatform(117, 16, 3, TileType.ONE_WAY);

  // --- Cell (3, 1): Sub-Relay Power Vault (tx 75..99, ty 15..29) ---
  // Breakable security wall at tx 92 (rows 24..27) with solid header rows 17..23
  b.fillRect(92, 17, 1, 7, TileType.SOLID);
  b.fillRect(92, 24, 1, 4, TileType.BREAKABLE);
  b.set(85, 17, TileType.LASER_MIRROR);

  // --- Cell (5, 1): Prism Boss Arena (tx 125..149, ty 15..29) ---
  // Bulkhead frame at tx 125 (rows 17..22), leaving doorway rows 23..27 open
  b.fillRect(125, 17, 1, 6, TileType.SOLID);
  // Symmetric tactical solar platforms for dodging Prism's sweeping beams
  b.buildPlatform(129, 25, 4, TileType.ONE_WAY);
  b.buildPlatform(142, 25, 4, TileType.ONE_WAY);

  const spawns: SpawnPoint[] = [
    // Cell (0, 1) — Start & Rescue #0
    { id: 'opt_crate_01', kind: 'crate', x: px(9), y: standY(28, 16) },
    { id: 'opt_trooper_01', kind: 'enemy', x: px(11), y: standY(28, 24), archetypeId: 'solar_trooper' },
    { id: 'opt_rescue_0', kind: 'rescue', x: px(13), y: standY(22, 18), rescueIndex: 0 },
    { id: 'opt_hopper_01', kind: 'enemy', x: px(19), y: standY(28, 18), archetypeId: 'dune_hopper' },

    // Cell (1, 1) — Slide Vent, Rescue #1 & Checkpoint 1
    { id: 'opt_crawler_11', kind: 'enemy', x: px(39), y: standY(28, 12), archetypeId: 'mirror_crawler' },
    { id: 'opt_rescue_1', kind: 'rescue', x: px(41), y: standY(28, 18), rescueIndex: 1 },
    { id: 'opt_barrel_11', kind: 'barrel', x: px(42), y: standY(28, 16) },
    { id: 'opt_aegis_11', kind: 'enemy', x: px(45), y: standY(28, 26), archetypeId: 'prism_aegis' },
    { id: 'opt_cp_1', kind: 'checkpoint', x: px(48), y: standY(28, 24) },

    // Cell (2, 1) — Vertical Wall-Jump Shaft & Rescue #2
    { id: 'opt_glider_21', kind: 'enemy', x: px(60), y: px(20), archetypeId: 'mirage_wing' },
    { id: 'opt_rescue_2', kind: 'rescue', x: px(68), y: standY(28, 18), rescueIndex: 2 },
    { id: 'opt_turret_21', kind: 'enemy', x: px(71), y: standY(28, 18), archetypeId: 'helios_turret' },

    // Cell (2, 0) — Upper Crossroads & Checkpoint 2
    { id: 'opt_trooper_20', kind: 'enemy', x: px(54), y: standY(13, 24), archetypeId: 'solar_trooper' },
    { id: 'opt_cp_2', kind: 'checkpoint', x: px(65), y: standY(13, 24) },

    // Cell (1, 0) — West Solar Gallery & Rescue #3
    { id: 'opt_aegis_10', kind: 'enemy', x: px(30), y: standY(13, 26), archetypeId: 'prism_aegis' },
    { id: 'opt_rescue_3', kind: 'rescue', x: px(37), y: standY(7, 18), rescueIndex: 3 },
    { id: 'opt_crate_10', kind: 'crate', x: px(44), y: standY(13, 16) },

    // Cell (0, 0) — Secret Solar Vault (Solar Beam Armor ID 1 + Health Booster + Rescue #4)
    { id: 'opt_palette_solar', kind: 'palette_chip', x: px(4), y: standY(13, 18), armorPaintId: 1 },
    { id: 'opt_rescue_4', kind: 'rescue', x: px(5), y: standY(10, 18), rescueIndex: 4 },
    { id: 'opt_hp_booster', kind: 'health_booster', x: px(7), y: standY(13, 18) },
    { id: 'opt_glider_00', kind: 'enemy', x: px(12), y: px(8), archetypeId: 'mirage_wing' },
    { id: 'opt_turret_00', kind: 'enemy', x: px(18), y: standY(13, 18), archetypeId: 'helios_turret' },

    // Cell (3, 0) — Hookshot Ceiling-Swing Gallery & Rescue #5
    { id: 'opt_hazard_30', kind: 'enemy', x: px(82), y: px(9), archetypeId: 'plasma_orb' },
    { id: 'opt_rescue_5', kind: 'rescue', x: px(87), y: standY(8, 18), rescueIndex: 5 },
    { id: 'opt_glider_30', kind: 'enemy', x: px(89), y: px(8), archetypeId: 'mirage_wing' },

    // Cell (4, 0) — Mirror Corridor, Relay Pod & Checkpoint 3
    { id: 'opt_cp_3', kind: 'checkpoint', x: px(102), y: standY(13, 24) },
    { id: 'opt_switch_40', kind: 'switch', x: px(105), y: standY(13, 16) },
    { id: 'opt_spawner_40', kind: 'enemy', x: px(110), y: standY(13, 24), archetypeId: 'relay_pod' },
    { id: 'opt_trooper_40', kind: 'enemy', x: px(115), y: standY(13, 24), archetypeId: 'solar_trooper' },

    // Cell (5, 0) — Upper Solar Collector & Rescue #6
    { id: 'opt_crate_50', kind: 'crate', x: px(130), y: standY(13, 16) },
    { id: 'opt_aegis_50', kind: 'enemy', x: px(135), y: standY(13, 26), archetypeId: 'prism_aegis' },
    { id: 'opt_rescue_6', kind: 'rescue', x: px(142), y: standY(13, 18), rescueIndex: 6 },
    { id: 'opt_turret_50', kind: 'enemy', x: px(146), y: standY(13, 18), archetypeId: 'helios_turret' },

    // Cell (4, 1) — Lower Conduit & Checkpoint 4
    { id: 'opt_hopper_41', kind: 'enemy', x: px(108), y: standY(28, 18), archetypeId: 'dune_hopper' },
    { id: 'opt_barrel_41', kind: 'barrel', x: px(113), y: standY(28, 16) },
    { id: 'opt_cp_4', kind: 'checkpoint', x: px(121), y: standY(28, 24) },

    // Cell (3, 1) — Sub-Relay Vault (Burst Booster + Rescue #7)
    { id: 'opt_rescue_7', kind: 'rescue', x: px(78), y: standY(28, 18), rescueIndex: 7 },
    { id: 'opt_burst_booster', kind: 'burst_booster', x: px(82), y: standY(28, 18) },
    { id: 'opt_crawler_31', kind: 'enemy', x: px(87), y: standY(28, 12), archetypeId: 'mirror_crawler' },

    // Cell (5, 1) — Prism Boss Arena
    { id: 'opt_boss_prism', kind: 'boss', x: px(142), y: standY(28, 40), bossId: 'prism' },
  ];

  if (remix) {
    spawns.push(
      { id: 'opt_rmx_aegis_01', kind: 'enemy', x: px(22), y: standY(28, 26), archetypeId: 'prism_aegis' },
      { id: 'opt_rmx_orb_20', kind: 'enemy', x: px(69), y: px(9), archetypeId: 'plasma_orb' },
      { id: 'opt_rmx_enforcer_41', kind: 'enemy', x: px(104), y: standY(28, 28), archetypeId: 'heavy_enforcer' },
    );
  }

  return {
    id: 'optic',
    name: 'Solar Relay',
    subtitle: remix ? 'Helios Array — Master Remix' : 'Helios Array',
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
// Clean Single-Cell Boss Rush Arena (1x1 cell = 25x15 tiles)
// ============================================================================
function createBossRushStage(): StageDefinition {
  const b = new TilemapBuilder(1, 1);
  b.buildOuterFrame(2);
  b.fillRect(0, 13, 25, 2, TileType.SOLID);
  b.buildPlatform(4, 10, 4, TileType.ONE_WAY);
  b.buildPlatform(17, 10, 4, TileType.ONE_WAY);

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
// Wave 1 Alias Metadata for Remaining StageIds (replaced by unique maps in Wave 2)
// ============================================================================
interface StageThemeMeta {
  readonly name: string;
  readonly subtitle: string;
  readonly biomeGimmick: BiomeGimmick;
  readonly bgmKey: string;
  readonly bossBgmKey: string;
  readonly bossId?: BossId;
  readonly base: 'opening' | 'optic';
  readonly palette: StageDefinition['palette'];
  readonly heatHaze?: boolean;
  readonly windForce?: number;
  readonly hasStars?: boolean;
}

const WAVE1_ALIAS_THEMES: Partial<Record<StageId, StageThemeMeta>> = {
  tutorial: {
    name: 'Circuit Calibration',
    subtitle: 'Training Course',
    biomeGimmick: 'tutorial_course',
    bgmKey: 'bgm_tutorial',
    bossBgmKey: 'bgm_boss_opening',
    bossId: 'siege_tread',
    base: 'opening',
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
  },
  patch: {
    name: 'Scrap Foundry',
    subtitle: 'Smelter Yards',
    biomeGimmick: 'scrap_crushers',
    bgmKey: 'bgm_patch',
    bossBgmKey: 'bgm_boss_master',
    bossId: 'stitch',
    base: 'optic',
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
  },
  cooler: {
    name: 'Cryo Vault',
    subtitle: 'Glacial Conduit',
    biomeGimmick: 'cryo_wind',
    bgmKey: 'bgm_cooler',
    bossBgmKey: 'bgm_boss_master',
    bossId: 'frostfang',
    base: 'optic',
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
  },
  elec: {
    name: 'Surge Grid',
    subtitle: 'High-Voltage Rails',
    biomeGimmick: 'surge_rails',
    bgmKey: 'bgm_elec',
    bossBgmKey: 'bgm_boss_master',
    bossId: 'arcbolt',
    base: 'optic',
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
  },
  shift: {
    name: 'Skyway Transit',
    subtitle: 'Aerial Convoy',
    biomeGimmick: 'skyway_convoy',
    bgmKey: 'bgm_shift',
    bossBgmKey: 'bgm_boss_master',
    bossId: 'strider',
    base: 'optic',
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
    hasStars: true,
  },
  wave: {
    name: 'Pulse Broadcast',
    subtitle: 'Synth Tower',
    biomeGimmick: 'pulse_rhythm',
    bgmKey: 'bgm_wave',
    bossBgmKey: 'bgm_boss_master',
    bossId: 'tempo',
    base: 'optic',
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
  },
  break: {
    name: 'Basalt Quarry',
    subtitle: 'Tectonic Shaft',
    biomeGimmick: 'quarry_walker',
    bgmKey: 'bgm_break',
    bossBgmKey: 'bgm_boss_master',
    bossId: 'crag',
    base: 'optic',
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
  },
  cipher: {
    name: 'Neon Matrix',
    subtitle: 'Phantom Subnet',
    biomeGimmick: 'neon_matrix',
    bgmKey: 'bgm_cipher',
    bossBgmKey: 'bgm_boss_master',
    bossId: 'phantom',
    base: 'optic',
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
  },
  final_1: {
    name: 'Citadel Approach',
    subtitle: 'Outer Bastion',
    biomeGimmick: 'citadel_gauntlet',
    bgmKey: 'bgm_final_1',
    bossBgmKey: 'bgm_boss_final_1',
    bossId: 'mirror_rival',
    base: 'optic',
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
  },
  final_2: {
    name: 'Central Reactor',
    subtitle: 'Prism Core Sanctum',
    biomeGimmick: 'core_reactor',
    bgmKey: 'bgm_final_2',
    bossBgmKey: 'bgm_boss_final_2',
    bossId: 'prism_core',
    base: 'optic',
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
  },
  final_3: {
    name: 'Orbital Spire',
    subtitle: 'Sovereign Throne',
    biomeGimmick: 'orbital_spire',
    bgmKey: 'bgm_final_3',
    bossBgmKey: 'bgm_boss_final_3_p1',
    bossId: 'overlord_apex',
    base: 'optic',
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
  },
};

const STAGE_CACHE = new Map<string, StageDefinition>();

export function getStageDefinition(stageId: StageId, remix = false): StageDefinition {
  const effectiveRemix = stageId === 'hub' || stageId === 'tutorial' || stageId === 'boss_rush' ? false : remix;
  const cacheKey = `${stageId}:${effectiveRemix ? 'r' : 's'}`;
  const cached = STAGE_CACHE.get(cacheKey);
  if (cached) return cached;

  let def: StageDefinition;
  if (stageId === 'hub') {
    def = createHubStage();
  } else if (stageId === 'opening') {
    def = createOpeningStage(effectiveRemix);
  } else if (stageId === 'optic') {
    def = createOpticStage(effectiveRemix);
  } else if (stageId === 'boss_rush') {
    def = createBossRushStage();
  } else {
    const theme = WAVE1_ALIAS_THEMES[stageId];
    const template =
      theme?.base === 'opening'
        ? createOpeningStage(effectiveRemix)
        : createOpticStage(effectiveRemix);
    const bossId = theme?.bossId ?? template.bossId;
    const remappedSpawns: SpawnPoint[] = template.spawns.map((sp) => {
      if (sp.kind === 'boss' && bossId) {
        return { ...sp, id: `${stageId}_boss`, bossId };
      }
      return { ...sp, id: `${stageId}_${sp.id}` };
    });
    def = {
      ...template,
      id: stageId,
      name: theme?.name ?? stageId.toUpperCase(),
      subtitle: effectiveRemix
        ? `${theme?.subtitle ?? 'Sector'} — Master Remix`
        : (theme?.subtitle ?? 'Sector'),
      remix: effectiveRemix,
      biomeGimmick: theme?.biomeGimmick ?? template.biomeGimmick,
      bgmKey: theme?.bgmKey ?? template.bgmKey,
      bossBgmKey: theme?.bossBgmKey ?? template.bossBgmKey,
      bossId,
      spawns: remappedSpawns,
      palette: theme?.palette ?? template.palette,
      heatHaze: theme?.heatHaze,
      windForce: theme?.windForce,
      hasStars: theme?.hasStars,
    };
  }

  STAGE_CACHE.set(cacheKey, def);
  return def;
}

export const WAVE1_FLAGSHIP_STAGES: readonly StageId[] = ['hub', 'opening', 'optic'] as const;
