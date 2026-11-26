import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  ATTACK_DATA,
  BOSS_CONSTANTS,
  CONTENT_COUNTS,
  DAMAGE_TABLES,
  ENGINE_CONSTANTS,
  HOOKSHOT_CONSTANTS,
  PLAYER_PHYSICS,
} from '../src/contracts/index';

// ============================================================================
// Krunked Circuit — Strictly Read-Only Steam Retail Oracle Dumper
// Parses the fused LÖVE2D ZIP inside GravityCircuit.exe read-only ('r')
// and emits .krunked-circuit-assets/oracle.json with source-tagged constants.
// ============================================================================

const DEFAULT_STEAM_EXE =
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Gravity Circuit\\win64_steam\\GravityCircuit.exe';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const OUTPUT_DIR = path.join(REPO_ROOT, '.krunked-circuit-assets');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'oracle.json');

interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

class ReadOnlyFusedZip {
  private readonly fd: number;
  private readonly zipBaseOffset: number;
  private readonly entries = new Map<string, ZipEntry>();

  constructor(exePath: string) {
    this.fd = fs.openSync(exePath, 'r');
    const stat = fs.fstatSync(this.fd);
    const fileSize = stat.size;
    const tailLen = Math.min(fileSize, 65557);
    const tailBuf = Buffer.allocUnsafe(tailLen);
    fs.readSync(this.fd, tailBuf, 0, tailLen, fileSize - tailLen);

    let eocdRel = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tailBuf.readUInt32LE(i) === 0x06054b50) {
        const commentLen = tailBuf.readUInt16LE(i + 20);
        if (i + 22 + commentLen === tailLen) {
          eocdRel = i;
          break;
        }
      }
    }
    if (eocdRel < 0) {
      this.close();
      throw new Error(`Could not locate ZIP End-Of-Central-Directory in ${exePath}`);
    }

    const totalEntries = tailBuf.readUInt16LE(eocdRel + 10);
    const cdSize = tailBuf.readUInt32LE(eocdRel + 12);
    const cdOffset = tailBuf.readUInt32LE(eocdRel + 16);
    const eocdAbs = fileSize - tailLen + eocdRel;
    const cdStartAbs = eocdAbs - cdSize;
    this.zipBaseOffset = cdStartAbs - cdOffset;

    const cdBuf = Buffer.allocUnsafe(cdSize);
    fs.readSync(this.fd, cdBuf, 0, cdSize, cdStartAbs);

    let pos = 0;
    for (let idx = 0; idx < totalEntries && pos + 46 <= cdSize; idx++) {
      const sig = cdBuf.readUInt32LE(pos);
      if (sig !== 0x02014b50) {
        this.close();
        throw new Error(`Invalid ZIP Central Directory signature at offset ${pos}`);
      }
      const compressionMethod = cdBuf.readUInt16LE(pos + 10);
      const compressedSize = cdBuf.readUInt32LE(pos + 20);
      const uncompressedSize = cdBuf.readUInt32LE(pos + 24);
      const nameLen = cdBuf.readUInt16LE(pos + 28);
      const extraLen = cdBuf.readUInt16LE(pos + 30);
      const commentLen = cdBuf.readUInt16LE(pos + 32);
      const localHeaderOffset = cdBuf.readUInt32LE(pos + 42);
      const name = cdBuf.toString('utf8', pos + 46, pos + 46 + nameLen);

      this.entries.set(name, {
        name,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });

      pos += 46 + nameLen + extraLen + commentLen;
    }
  }

  listNames(): string[] {
    return Array.from(this.entries.keys());
  }

  has(entryPath: string): boolean {
    return this.entries.has(entryPath);
  }

  readBuffer(entryPath: string): Buffer {
    const entry = this.entries.get(entryPath);
    if (!entry) {
      throw new Error(`ZIP entry not found: ${entryPath}`);
    }
    const headerAbs = this.zipBaseOffset + entry.localHeaderOffset;
    const headerBuf = Buffer.allocUnsafe(30);
    fs.readSync(this.fd, headerBuf, 0, 30, headerAbs);
    if (headerBuf.readUInt32LE(0) !== 0x04034b50) {
      throw new Error(`Invalid ZIP local file header for ${entryPath}`);
    }
    const nameLen = headerBuf.readUInt16LE(26);
    const extraLen = headerBuf.readUInt16LE(28);
    const dataOffset = headerAbs + 30 + nameLen + extraLen;
    const raw = Buffer.allocUnsafe(entry.compressedSize);
    if (entry.compressedSize > 0) {
      fs.readSync(this.fd, raw, 0, entry.compressedSize, dataOffset);
    }
    if (entry.compressionMethod === 0) {
      return raw;
    }
    if (entry.compressionMethod === 8) {
      return zlib.inflateRawSync(raw);
    }
    throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod} for ${entryPath}`);
  }

  readText(entryPath: string): string {
    return this.readBuffer(entryPath).toString('utf8');
  }

  close(): void {
    fs.closeSync(this.fd);
  }
}

export interface OracleDatum<T = number> {
  value: T;
  source: 'extracted' | 'measured';
  file: string;
  note?: string;
}

export interface OracleDiscrepancy {
  path: string;
  extracted: number;
  contract: number;
  file: string;
  detail: string;
}

function datum<T>(
  value: T,
  source: 'extracted' | 'measured',
  file: string,
  note?: string,
): OracleDatum<T> {
  return note ? { value, source, file, note } : { value, source, file };
}

function extractNumber(text: string, regex: RegExp, label: string, file: string, group = 1): number {
  const match = text.match(regex);
  if (!match || match[group] === undefined) {
    throw new Error(`Failed to extract ${label} from ${file} using ${regex}`);
  }
  const parsed = Number(match[group]);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Extracted non-numeric value "${match[group]}" for ${label} from ${file}`);
  }
  return parsed;
}

function parseLuaNumericTable(text: string, tableName: string): Record<string, number> {
  const rx = new RegExp(`local\\s+${tableName}\\s*=\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
  const match = text.match(rx);
  if (!match) {
    throw new Error(`Failed to find Lua table ${tableName}`);
  }
  const result: Record<string, number> = {};
  const body = match[1];
  const entryRx = /^\s*([A-Z0-9_]+)\s*=\s*(-?[0-9]+(?:\.[0-9]+)?)\s*,/gm;
  let m: RegExpExecArray | null;
  while ((m = entryRx.exec(body)) !== null) {
    result[m[1]] = Number(m[2]);
  }
  return result;
}

function applyDamageFillValues(
  baseNormal: Record<string, number>,
  explicit: Record<string, number>,
  inc: number,
  floorAtMax?: number,
): Record<string, number> {
  const out: Record<string, number> = { ...explicit };
  for (const [k, v] of Object.entries(baseNormal)) {
    if (out[k] === undefined) {
      if (v <= 0) {
        out[k] = 0;
      } else if (floorAtMax !== undefined) {
        out[k] = v >= floorAtMax ? Math.max(v + inc, floorAtMax) : Math.max(v + inc, 1);
      } else {
        out[k] = Math.max(v + inc, 1);
      }
    }
  }
  return out;
}

function main(): void {
  const exePath = process.env.GRAVITY_CIRCUIT_EXE || DEFAULT_STEAM_EXE;
  if (!fs.existsSync(exePath)) {
    console.log(
      `[oracle-dump] Owned Steam GravityCircuit.exe not found at "${exePath}". Skipping retail oracle dump cleanly.`,
    );
    return;
  }

  const zip = new ReadOnlyFusedZip(exePath);
  try {
    const allNames = zip.listNames();
    const confLua = zip.readText('conf.lua');
    const mainLua = zip.readText('main.lua');
    const windowLua = zip.readText('window.lua');
    const mapManagerLua = zip.readText('lua/map/mapManager.lua');
    const cameraLua = zip.readText('lua/misc/camera.lua');
    const baseObjectLua = zip.readText('lua/gameobjects/base_object.lua');
    const kaiLua = zip.readText('lua/gameobjects/player/kai.lua');
    const hookshotLua = zip.readText('lua/gameobjects/player/hookshot.lua');
    const kaiAttackDataLua = zip.readText('content/data/attacks/kai_attack_data.lua');
    const damageTypesLua = zip.readText('content/data/attacks/damageTypes.lua');
    const gameDataLua = zip.readText('content/data/game/GameData.lua');
    const loadoutsLua = zip.readText('content/data/equippables/loadouts.lua');
    const equippablesLua = zip.readText('content/data/equippables/equippables.lua');
    const burstsLua = zip.readText('content/data/equippables/bursts.lua');
    const chipsLua = zip.readText('content/data/equippables/chips.lua');
    const datachipsLua = zip.readText('content/data/collectibles/datachips.lua');
    const challengesLua = zip.readText('content/data/collectibles/challenges.lua');
    const challengesCsv = zip.readText('content/csv/en/challengesData.csv');
    const scrapGolemLua = zip.readText('lua/gameobjects/editorLoaded/minibosses/scrap_golem.lua');

    // ---------------- ENGINE ----------------
    const loveVersionMatch = confLua.match(/t\.version\s*=\s*"([^"]+)"/);
    const simHzVal = extractNumber(mainLua, /tick\.framerate\s*=\s*(\d+)/, 'simHz', 'main.lua');
    const gameWidthVal = extractNumber(windowLua, /GLOBAL_SETTINGS\.GAME_WIDTH\s*=\s*(\d+)/, 'gameWidth', 'window.lua');
    const gameHeightVal = extractNumber(windowLua, /GLOBAL_SETTINGS\.GAME_HEIGHT\s*=\s*(\d+)/, 'gameHeight', 'window.lua');
    const tileSizeVal = extractNumber(
      mapManagerLua,
      /local\s+tileWidth,\s*tileHeight\s*=\s*tw\s+or\s+(\d+)/,
      'tileSize',
      'lua/map/mapManager.lua',
    );
    const cellMatch = mapManagerLua.match(/local\s+cellWidth,\s*cellHeight\s*=\s*cw\s+or\s+(\d+),\s*ch\s+or\s+(\d+)/);
    if (!cellMatch) {
      throw new Error('Failed to extract cellTilesW / cellTilesH from lua/map/mapManager.lua');
    }
    const cellTilesWVal = Number(cellMatch[1]);
    const cellTilesHVal = Number(cellMatch[2]);
    const delayCamVal = extractNumber(
      cameraLua,
      /self\.delayCameraTransition\s*=\s*\{\s*x\s*=\s*(\d+)/,
      'delayCameraTransition',
      'lua/misc/camera.lua',
    );
    const jumpMarginVal = extractNumber(cameraLua, /self\.jumpMargin\s*=\s*(\d+)/, 'jumpMargin', 'lua/misc/camera.lua');

    const engine = {
      simHz: datum(simHzVal, 'extracted', 'main.lua', 'tick.framerate = 60'),
      gameWidth: datum(gameWidthVal, 'extracted', 'window.lua', 'GLOBAL_SETTINGS.GAME_WIDTH = 400'),
      gameHeight: datum(gameHeightVal, 'extracted', 'window.lua', 'GLOBAL_SETTINGS.GAME_HEIGHT = 240'),
      tileSize: datum(tileSizeVal, 'extracted', 'lua/map/mapManager.lua', 'tw or 16'),
      cellTilesW: datum(cellTilesWVal, 'extracted', 'lua/map/mapManager.lua', 'cw or 25'),
      cellTilesH: datum(cellTilesHVal, 'extracted', 'lua/map/mapManager.lua', 'ch or 15'),
      delayCameraTransition: datum(delayCamVal, 'extracted', 'lua/misc/camera.lua', 'self.delayCameraTransition.x = 5'),
      jumpMargin: datum(jumpMarginVal, 'extracted', 'lua/misc/camera.lua', 'self.jumpMargin = 15'),
    };

    // ---------------- PLAYER PHYSICS ----------------
    const dimsMatch = kaiLua.match(
      /_KAI\.static\.DIMENSIONS\s*=\s*\{\s*x\s*=\s*(\d+),\s*y\s*=\s*(\d+),\s*w\s*=\s*(\d+),\s*h\s*=\s*(\d+)/,
    );
    if (!dimsMatch) {
      throw new Error('Failed to extract _KAI.static.DIMENSIONS from lua/gameobjects/player/kai.lua');
    }
    const standWVal = Number(dimsMatch[3]);
    const standHVal = Number(dimsMatch[4]);
    const slideMatch = kaiLua.match(/addCollider\s*\(\s*"slideCollision"[^)]*self\.dimensions\.w,\s*self\.dimensions\.h\s*\/\s*(\d+)/);
    if (!slideMatch) {
      throw new Error('Failed to extract slideCollision dimensions from lua/gameobjects/player/kai.lua');
    }
    const slideWVal = standWVal;
    const slideHVal = standHVal / Number(slideMatch[1]);

    const horiBaseMatch = kaiLua.match(/function _KAI:getMaxHoriSpeed[\s\S]*?return \(self\.state\.isSprinting and (\d+(?:\.\d+)?) or (\d+(?:\.\d+)?)\)/);
    if (!horiBaseMatch) {
      throw new Error('Failed to extract walk/sprint speeds from lua/gameobjects/player/kai.lua');
    }
    const sprintMaxSpeedVal = Number(horiBaseMatch[1]);
    const walkMaxSpeedVal = Number(horiBaseMatch[2]);

    const overloadSpeedMatch = kaiLua.match(
      /if self\.abilities\.functionOverload\.active then\s*return self\.state\.isSprinting and (\d+(?:\.\d+)?) or (\d+(?:\.\d+)?)/,
    );
    if (!overloadSpeedMatch) {
      throw new Error('Failed to extract overload speeds from lua/gameobjects/player/kai.lua');
    }
    const overloadSprintSpeedVal = Number(overloadSpeedMatch[1]);
    const overloadWalkSpeedVal = Number(overloadSpeedMatch[2]);

    const overloadBlockMatch = kaiLua.match(
      /functionOverload\s*=\s*\{[\s\S]*?max\s*=\s*(\d+),[\s\S]*?dmgMultiplier\s*=\s*([0-9.]+)/,
    );
    if (!overloadBlockMatch) {
      throw new Error('Failed to extract functionOverload block from lua/gameobjects/player/kai.lua');
    }
    const overloadDurationVal = Number(overloadBlockMatch[1]);
    const overloadDamageMultVal = Number(overloadBlockMatch[2]);

    const speedArmorBonusVal = extractNumber(
      kaiLua,
      /GAMEDATA\.armorEffects\.SPEED_ARMOR\(\)\)\s+and\s+([0-9.]+)\s+or\s+0/,
      'speedArmorBonus',
      'lua/gameobjects/player/kai.lua',
    );
    const runningFrictionVal = extractNumber(
      kaiLua,
      /_KAI\.static\.RUNNING_FRICTION\s*=\s*([0-9.]+)/,
      'runningFriction',
      'lua/gameobjects/player/kai.lua',
    );
    const gravityVal = extractNumber(
      baseObjectLua,
      /gravity\s*=\s*\{\s*acceleration\s*=\s*([0-9.]+)/,
      'gravity',
      'lua/gameobjects/base_object.lua',
    );
    const maxFallSpeedVal = extractNumber(
      baseObjectLua,
      /gravity\s*=\s*\{[\s\S]*?maximum\s*=\s*([0-9.]+)/,
      'maxFallSpeed',
      'lua/gameobjects/base_object.lua',
    );
    const heavyArmorBonusVal = extractNumber(
      kaiLua,
      /self\.velocity\.vertical\.gravity\.maximum\s*\+\s*(\d+(?:\.\d+)?)/,
      'heavyArmorFallBonus',
      'lua/gameobjects/player/kai.lua',
    );
    const baseJumpMag = extractNumber(
      baseObjectLua,
      /jump\s*=\s*([0-9.]+),/,
      'jumpImpulse',
      'lua/gameobjects/base_object.lua',
    );
    const jumpImpulseVal = -baseJumpMag;
    const doubleJumpOffsetMatch = kaiLua.match(
      /self\.velocity\.vertical\.jump\s*\*\s*-1\s*\+\s*\(self\.abilities\.jumping\.current\s*==\s*3\s+and\s+(\d+)\s+or\s+(\d+)\)/,
    );
    if (!doubleJumpOffsetMatch) {
      throw new Error('Failed to extract doubleJumpImpulse expression from lua/gameobjects/player/kai.lua');
    }
    const doubleJumpImpulseVal = -baseJumpMag + Number(doubleJumpOffsetMatch[2]);
    const coyoteTicksVal = extractNumber(
      kaiLua,
      /leftGroundTimer\s*\+\s*(\d+)\s*>\s*GetLevelTime\(\)/,
      'coyoteTicks',
      'lua/gameobjects/player/kai.lua',
    );
    const jumpBufferTicksVal = extractNumber(
      kaiLua,
      /ACTIVE_INSTANCE\._jumpBuffer\s*=\s*(\d+)/,
      'jumpBufferTicks',
      'lua/gameobjects/player/kai.lua',
    );
    const wallSlideMaxSpeedVal = extractNumber(
      kaiLua,
      /local\s+maxWallSlideSpeed\s*=\s*grip\s+and\s+\(self\.buttons\.down\s+and\s+(\d+(?:\.\d+)?)\s+or\s+0\)\s+or\s+(\d+(?:\.\d+)?)/,
      'wallSlideMaxSpeed',
      'lua/gameobjects/player/kai.lua',
      2,
    );
    const wallJumpBlockMatch = kaiLua.match(
      /wallJump\s*=\s*\{[\s\S]*?maxTime\s*=\s*(\d+),[\s\S]*?bufferMax\s*=\s*(\d+)/,
    );
    if (!wallJumpBlockMatch) {
      throw new Error('Failed to extract wallJump config from lua/gameobjects/player/kai.lua');
    }
    const wallJumpMaxTimeVal = Number(wallJumpBlockMatch[1]);
    const wallJumpBufferMaxVal = Number(wallJumpBlockMatch[2]);
    const wallJumpLeewayVal = extractNumber(
      kaiLua,
      /_KAI\.static\.ENABLE_SAME_WALL_WALL_JUMPS_LEEWAY\s*=\s*([0-9.]+)/,
      'wallJumpLeeway',
      'lua/gameobjects/player/kai.lua',
    );
    const wallJumpYOffset = extractNumber(
      kaiLua,
      /self\.velocity\.vertical\.current\s*=\s*self\.velocity\.vertical\.jump\s*\*\s*-1\s*\+\s*([0-9.]+)/,
      'wallJumpImpulseY',
      'lua/gameobjects/player/kai.lua',
    );
    const wallJumpImpulseYVal = -baseJumpMag + wallJumpYOffset;

    const startingMaxHpVal = extractNumber(
      loadoutsLua,
      /maxHealth\s*=\s*(\d+),/,
      'startingMaxHp',
      'content/data/equippables/loadouts.lua',
    );
    const maxBoostedHpVal = extractNumber(
      loadoutsLua,
      /maxBoostedHealth\s*=\s*(\d+),/,
      'maxBoostedHp',
      'content/data/equippables/loadouts.lua',
    );
    const startingMaxBurstVal = extractNumber(
      loadoutsLua,
      /maxBurst\s*=\s*(\d+),/,
      'startingMaxBurst',
      'content/data/equippables/loadouts.lua',
    );
    const maxBoostedBurstVal = extractNumber(
      loadoutsLua,
      /maxBoostedBurst\s*=\s*(\d+),/,
      'maxBoostedBurst',
      'content/data/equippables/loadouts.lua',
    );
    const invulnBaseTicksVal = extractNumber(
      kaiLua,
      /self\.invul\s*=\s*\{\s*current\s*=\s*0,\s*max\s*=\s*(\d+)/,
      'invulnBaseTicks',
      'lua/gameobjects/player/kai.lua',
    );
    const hazardWarpInvulnVal = extractNumber(
      kaiLua,
      /self\.state\.isVulnerable\s*=\s*false[\s\S]{0,120}?self\.invul\.current\s*=\s*(\d+)/,
      'hazardWarpInvulnTicks',
      'lua/gameobjects/player/kai.lua',
    );

    const playerPhysics = {
      standW: datum(standWVal, 'extracted', 'lua/gameobjects/player/kai.lua', '_KAI.static.DIMENSIONS.w'),
      standH: datum(standHVal, 'extracted', 'lua/gameobjects/player/kai.lua', '_KAI.static.DIMENSIONS.h'),
      slideW: datum(slideWVal, 'extracted', 'lua/gameobjects/player/kai.lua', 'slideCollision width = self.dimensions.w'),
      slideH: datum(slideHVal, 'extracted', 'lua/gameobjects/player/kai.lua', 'slideCollision height = self.dimensions.h / 2'),
      walkMaxSpeed: datum(walkMaxSpeedVal, 'extracted', 'lua/gameobjects/player/kai.lua', 'getMaxHoriSpeed walk'),
      sprintMaxSpeed: datum(sprintMaxSpeedVal, 'extracted', 'lua/gameobjects/player/kai.lua', 'getMaxHoriSpeed sprint'),
      overloadWalkSpeed: datum(overloadWalkSpeedVal, 'extracted', 'lua/gameobjects/player/kai.lua', 'getMaxHoriSpeed functionOverload walk'),
      overloadSprintSpeed: datum(overloadSprintSpeedVal, 'extracted', 'lua/gameobjects/player/kai.lua', 'getMaxHoriSpeed functionOverload sprint'),
      overloadDurationTicks: datum(overloadDurationVal, 'extracted', 'lua/gameobjects/player/kai.lua', 'functionOverload.max'),
      overloadDamageMult: datum(overloadDamageMultVal, 'extracted', 'lua/gameobjects/player/kai.lua', 'functionOverload.dmgMultiplier'),
      speedArmorBonus: datum(speedArmorBonusVal, 'extracted', 'lua/gameobjects/player/kai.lua', 'SPEED_ARMOR() bonus'),
      runningFriction: datum(runningFrictionVal, 'extracted', 'lua/gameobjects/player/kai.lua', '_KAI.static.RUNNING_FRICTION'),
      gravity: datum(gravityVal, 'extracted', 'lua/gameobjects/base_object.lua', 'velocity.vertical.gravity.acceleration'),
      maxFallSpeed: datum(maxFallSpeedVal, 'extracted', 'lua/gameobjects/base_object.lua', 'velocity.vertical.gravity.maximum'),
      heavyArmorFallBonus: datum(heavyArmorBonusVal, 'extracted', 'lua/gameobjects/player/kai.lua', 'HEAVY_ARMOR fall cap +3'),
      jumpImpulse: datum(jumpImpulseVal, 'extracted', 'lua/gameobjects/base_object.lua', '-velocity.vertical.jump'),
      doubleJumpImpulse: datum(doubleJumpImpulseVal, 'extracted', 'lua/gameobjects/player/kai.lua', 'jump * -1 + 1'),
      coyoteTicks: datum(coyoteTicksVal, 'extracted', 'lua/gameobjects/player/kai.lua', 'leftGroundTimer + 4 > GetLevelTime()'),
      jumpBufferTicks: datum(jumpBufferTicksVal, 'extracted', 'lua/gameobjects/player/kai.lua', 'ACTIVE_INSTANCE._jumpBuffer = 5 (verified directly in source)'),
      wallSlideMaxSpeed: datum(wallSlideMaxSpeedVal, 'extracted', 'lua/gameobjects/player/kai.lua', 'maxWallSlideSpeed = 2'),
      wallJumpBufferMax: datum(wallJumpBufferMaxVal, 'extracted', 'lua/gameobjects/player/kai.lua', 'abilities.wallJump.bufferMax'),
      wallJumpMaxTime: datum(wallJumpMaxTimeVal, 'extracted', 'lua/gameobjects/player/kai.lua', 'abilities.wallJump.maxTime'),
      wallJumpLeeway: datum(wallJumpLeewayVal, 'extracted', 'lua/gameobjects/player/kai.lua', '_KAI.static.ENABLE_SAME_WALL_WALL_JUMPS_LEEWAY'),
      wallJumpImpulseY: datum(wallJumpImpulseYVal, 'extracted', 'lua/gameobjects/player/kai.lua', 'jump * -1 + 0.25'),
      startingMaxHp: datum(startingMaxHpVal, 'extracted', 'content/data/equippables/loadouts.lua', 'player.default.maxHealth'),
      maxBoostedHp: datum(maxBoostedHpVal, 'extracted', 'content/data/equippables/loadouts.lua', 'player.default.maxBoostedHealth'),
      startingMaxBurst: datum(startingMaxBurstVal, 'extracted', 'content/data/equippables/loadouts.lua', 'player.default.maxBurst'),
      maxBoostedBurst: datum(maxBoostedBurstVal, 'extracted', 'content/data/equippables/loadouts.lua', 'player.default.maxBoostedBurst'),
      invulnBaseTicks: datum(invulnBaseTicksVal, 'extracted', 'lua/gameobjects/player/kai.lua', 'self.invul.max'),
      hazardWarpInvulnTicks: datum(hazardWarpInvulnVal, 'extracted', 'lua/gameobjects/player/kai.lua', 'hazard warp self.invul.current = 16'),
    };

    // ---------------- HOOKSHOT ----------------
    const tipDimsMatch = hookshotLua.match(/local\s+ox,\s*oy,\s*w,\s*h\s*=\s*-?[0-9.]+,\s*-?[0-9.]+,\s*(\d+),\s*(\d+)/);
    if (!tipDimsMatch) {
      throw new Error('Failed to extract hookshot tipW/tipH from lua/gameobjects/player/hookshot.lua');
    }
    const tipWVal = Number(tipDimsMatch[1]);
    const tipHVal = Number(tipDimsMatch[2]);
    const hsMaxSpeedVal = extractNumber(hookshotLua, /self\.speedMax\s*=\s*([0-9.]+)/, 'hookshot.maxSpeed', 'lua/gameobjects/player/hookshot.lua');
    const hsTimerMaxVal = extractNumber(hookshotLua, /self\.timerMax\s*=\s*(\d+)/, 'hookshot.timerMax', 'lua/gameobjects/player/hookshot.lua');
    const hsDeaccelMatch = hookshotLua.match(/self\.deaccel\s*=\s*\{\s*outward\s*=\s*([0-9.]+),\s*inward\s*=\s*([0-9.]+)/);
    if (!hsDeaccelMatch) {
      throw new Error('Failed to extract hookshot deaccel from lua/gameobjects/player/hookshot.lua');
    }
    const hsDeaccelOutVal = Number(hsDeaccelMatch[1]);
    const hsDeaccelInVal = Number(hsDeaccelMatch[2]);
    const hsExtLenVal = extractNumber(
      hookshotLua,
      /self\.extensionLength\s*=\s*(\d+)/,
      'hookshot.extensionLength',
      'lua/gameobjects/player/hookshot.lua',
    );
    const swingRopeMaxLenVal = extractNumber(
      kaiLua,
      /swinging\s*=\s*\{\s*point\s*=\s*\{x=0,y=0\},\s*length\s*=\s*(\d+)/,
      'hookshot.swingRopeMaxLen',
      'lua/gameobjects/player/kai.lua',
    );
    const throwVelMatch = kaiLua.match(
      /local\s+speedX,\s*speedY\s*=\s*t\.x\s*==\s*0\s+and\s+facing\s*\*\s*1\s+or\s+\(t\.y\s*==\s*0\s+and\s+(\d+(?:\.\d+)?)\s+or\s+(\d+(?:\.\d+)?)\),\s*t\.y\s*==\s*0\s+and\s+(-?\d+(?:\.\d+)?)\s+or\s+\(t\.y\s*==\s*-1\s+and\s+(-?\d+(?:\.\d+)?)\s+or\s+(-?\d+(?:\.\d+)?)\s*\)/,
    );
    if (!throwVelMatch) {
      throw new Error('Failed to extract throw velocities from lua/gameobjects/player/kai.lua');
    }
    const throwVxNeutralVal = Number(throwVelMatch[1]);
    const throwVxDiagonalVal = Number(throwVelMatch[2]);
    const throwVyNeutralVal = Number(throwVelMatch[3]);
    const throwVyUpVal = Number(throwVelMatch[4]);
    const throwVyDownVal = Number(throwVelMatch[5]);
    const throwVxSprintBonusVal = extractNumber(
      kaiLua,
      /speedX\s*=\s*math\.abs\(speedX\)\s*\+\s*([0-9.]+)/,
      'hookshot.throwVxSprintBonus',
      'lua/gameobjects/player/kai.lua',
    );

    // ---------------- DAMAGE TABLES ----------------
    const normalDmgRaw = parseLuaNumericTable(damageTypesLua, 'NORMAL_MODE_DAMAGE_VALUES');
    const easyDmgExplicit = parseLuaNumericTable(damageTypesLua, 'EASY_MODE_DAMAGE_VALUES');
    const hardDmgExplicit = parseLuaNumericTable(damageTypesLua, 'HARD_MODE_DAMAGE_VALUES');
    const easyFillMatch = damageTypesLua.match(/fillValues\s*\(\s*EASY_MODE_DAMAGE_VALUES,\s*(-?\d+),\s*(\d+)\s*\)/);
    const hardFillMatch = damageTypesLua.match(/fillValues\s*\(\s*HARD_MODE_DAMAGE_VALUES,\s*(-?\d+)\s*\)/);
    if (!easyFillMatch || !hardFillMatch) {
      throw new Error('Failed to extract fillValues parameters from content/data/attacks/damageTypes.lua');
    }
    const easyDmgFull = applyDamageFillValues(
      normalDmgRaw,
      easyDmgExplicit,
      Number(easyFillMatch[1]),
      Number(easyFillMatch[2]),
    );
    const hardDmgFull = applyDamageFillValues(normalDmgRaw, hardDmgExplicit, Number(hardFillMatch[1]));

    const modeMultMatch = kaiLua.match(
      /local\s+_modeMultiplier\s*=\s*\{\s*\[0\]\s*=\s*([0-9.]+),\s*\[1\]\s*=\s*([0-9.]+),\s*\[2\]\s*=\s*([0-9.]+)/,
    );
    if (!modeMultMatch) {
      throw new Error('Failed to extract _modeMultiplier from lua/gameobjects/player/kai.lua');
    }
    const invulnMultNormal = Number(modeMultMatch[1]);
    const invulnMultEasy = Number(modeMultMatch[2]);
    const invulnMultHard = Number(modeMultMatch[3]);

    const hookshot = {
      tipW: datum(tipWVal, 'extracted', 'lua/gameobjects/player/hookshot.lua', 'local ox, oy, w, h = -4.5, -4.5, 4, 4'),
      tipH: datum(tipHVal, 'extracted', 'lua/gameobjects/player/hookshot.lua', 'local ox, oy, w, h = -4.5, -4.5, 4, 4'),
      maxSpeed: datum(hsMaxSpeedVal, 'extracted', 'lua/gameobjects/player/hookshot.lua', 'self.speedMax = 30.0'),
      timerMax: datum(hsTimerMaxVal, 'extracted', 'lua/gameobjects/player/hookshot.lua', 'self.timerMax = 13'),
      deaccelOutward: datum(hsDeaccelOutVal, 'extracted', 'lua/gameobjects/player/hookshot.lua', 'self.deaccel.outward = 3.8'),
      deaccelInward: datum(hsDeaccelInVal, 'extracted', 'lua/gameobjects/player/hookshot.lua', 'self.deaccel.inward = 1.5'),
      extensionLength: datum(hsExtLenVal, 'extracted', 'lua/gameobjects/player/hookshot.lua', 'self.extensionLength = 12'),
      swingRopeMaxLen: datum(swingRopeMaxLenVal, 'extracted', 'lua/gameobjects/player/kai.lua', 'self.abilities.swinging.length = 130'),
      throwVxNeutral: datum(throwVxNeutralVal, 'extracted', 'lua/gameobjects/player/kai.lua', 't.y == 0 and 6 or 4'),
      throwVxDiagonal: datum(throwVxDiagonalVal, 'extracted', 'lua/gameobjects/player/kai.lua', 't.y == 0 and 6 or 4'),
      throwVxSprintBonus: datum(throwVxSprintBonusVal, 'extracted', 'lua/gameobjects/player/kai.lua', 'math.abs(speedX) + 1.25'),
      throwVyNeutral: datum(throwVyNeutralVal, 'extracted', 'lua/gameobjects/player/kai.lua', 't.y == 0 and -2'),
      throwVyUp: datum(throwVyUpVal, 'extracted', 'lua/gameobjects/player/kai.lua', 't.y == -1 and -6'),
      throwVyDown: datum(throwVyDownVal, 'extracted', 'lua/gameobjects/player/kai.lua', 'down throw vy = 3'),
      throwCollisionDmg: datum(normalDmgRaw.COLLISION, 'extracted', 'content/data/attacks/damageTypes.lua', 'NORMAL_MODE_DAMAGE_VALUES.COLLISION'),
      throwBounceDmg: datum(normalDmgRaw.BOUNCE, 'extracted', 'content/data/attacks/damageTypes.lua', 'NORMAL_MODE_DAMAGE_VALUES.BOUNCE'),
    };

    const buildDamageDifficulty = (
      tbl: Record<string, number>,
      invulnMult: number,
      modeLabel: string,
    ) => ({
      lightContact: datum(tbl.LIGHT_CONTACT_DAMAGE, 'extracted', 'content/data/attacks/damageTypes.lua', `${modeLabel}.LIGHT_CONTACT_DAMAGE`),
      mediumContact: datum(tbl.MEDIUM_CONTACT_DAMAGE, 'extracted', 'content/data/attacks/damageTypes.lua', `${modeLabel}.MEDIUM_CONTACT_DAMAGE`),
      heavyContact: datum(tbl.HEAVY_CONTACT_DAMAGE, 'extracted', 'content/data/attacks/damageTypes.lua', `${modeLabel}.HEAVY_CONTACT_DAMAGE`),
      lightProjectile: datum(tbl.LIGHT_PROJECTILE, 'extracted', 'content/data/attacks/damageTypes.lua', `${modeLabel}.LIGHT_PROJECTILE`),
      mediumProjectile: datum(tbl.MEDIUM_PROJECTILE, 'extracted', 'content/data/attacks/damageTypes.lua', `${modeLabel}.MEDIUM_PROJECTILE`),
      heavyProjectile: datum(tbl.HEAVY_PROJECTILE, 'extracted', 'content/data/attacks/damageTypes.lua', `${modeLabel}.HEAVY_PROJECTILE`),
      explosion: datum(tbl.EXPLOSION, 'extracted', 'content/data/attacks/damageTypes.lua', `${modeLabel}.EXPLOSION`),
      hazard: datum(tbl.HAZARD_DAMAGE, 'extracted', 'content/data/attacks/damageTypes.lua', `${modeLabel}.HAZARD_DAMAGE`),
      collision: datum(tbl.COLLISION, 'extracted', 'content/data/attacks/damageTypes.lua', `${modeLabel}.COLLISION`),
      bounce: datum(tbl.BOUNCE, 'extracted', 'content/data/attacks/damageTypes.lua', `${modeLabel}.BOUNCE`),
      invulnMult: datum(invulnMult, 'extracted', 'lua/gameobjects/player/kai.lua', `_modeMultiplier for ${modeLabel}`),
    });

    const damageTables = {
      normal: buildDamageDifficulty(normalDmgRaw, invulnMultNormal, 'NORMAL_MODE_DAMAGE_VALUES'),
      easy: buildDamageDifficulty(easyDmgFull, invulnMultEasy, 'EASY_MODE_DAMAGE_VALUES (post fillValues)'),
      hard: buildDamageDifficulty(hardDmgFull, invulnMultHard, 'HARD_MODE_DAMAGE_VALUES (post fillValues)'),
    };

    // ---------------- ATTACK DATA (audit against ATTACK_DATA) ----------------
    const extractAttack = (luaKey: string) => {
      const rx = new RegExp(`data\\["${luaKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\]\\s*=\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
      const m = kaiAttackDataLua.match(rx);
      if (!m) {
        throw new Error(`Failed to extract attack "${luaKey}" from content/data/attacks/kai_attack_data.lua`);
      }
      const body = m[1];
      const numField = (field: string): number | null => {
        const fm = body.match(new RegExp(`\\b${field}\\s*=\\s*(-?[0-9]+(?:\\.[0-9]+)?)`));
        return fm ? Number(fm[1]) : null;
      };
      return {
        damage: datum(numField('damage') ?? 0, 'extracted', 'content/data/attacks/kai_attack_data.lua', `${luaKey}.damage`),
        width: datum(numField('w') ?? 0, 'extracted', 'content/data/attacks/kai_attack_data.lua', `${luaKey}.w`),
        height: datum(numField('h') ?? 0, 'extracted', 'content/data/attacks/kai_attack_data.lua', `${luaKey}.h`),
        activeTicks: datum(numField('active'), 'extracted', 'content/data/attacks/kai_attack_data.lua', `${luaKey}.active`),
        freezeTicks: datum(numField('freeze'), 'extracted', 'content/data/attacks/kai_attack_data.lua', `${luaKey}.freeze`),
      };
    };

    const attacks = {
      jabNeutral: extractAttack('jab'),
      jabWalk: extractAttack('walk_jab'),
      jabCrouch: extractAttack('crouch_jab'),
      sprintKick: extractAttack('sprint-attack'),
      hopKick: extractAttack('hopkick-grounded'),
      airJab: extractAttack('air_jab'),
      airKick: extractAttack('air_kick'),
      airUpKick: extractAttack('air_up_kick'),
      diveKick: extractAttack('divekick_neutral'),
      diveKickHeavy: extractAttack('divekick_neutral_heavy'),
      ledgeJab: extractAttack('ledge_jab'),
    };

    // ---------------- BOSSES ----------------
    const bossMaxHpFn = gameDataLua.match(/GAMEDATA\.boss\.getMaxHealth\s*=\s*function[\s\S]*?\nend/);
    const bossForceLaunchFn = gameDataLua.match(/GAMEDATA\.boss\.getForceLaunchPoint\s*=\s*function[\s\S]*?\nend/);
    const bossTechFn = gameDataLua.match(/GAMEDATA\.boss\.getTechRecoverFrames\s*=\s*function[\s\S]*?\nend/);
    if (!bossMaxHpFn || !bossForceLaunchFn || !bossTechFn) {
      throw new Error('Failed to extract boss helper functions from content/data/game/GameData.lua');
    }
    const finalHpVal = extractNumber(bossMaxHpFn[0], /if\s+final\s+then\s*return\s+(\d+)/, 'bosses.finalHp', 'content/data/game/GameData.lua');
    const standardHpVal = extractNumber(bossMaxHpFn[0], /return\s+(\d+)\s*\nend$/, 'bosses.standardHp', 'content/data/game/GameData.lua');
    const finalDespVal = extractNumber(
      bossForceLaunchFn[0],
      /if\s+GAMESTATE\.mod_rudeEnemies\s+and\s+GAMESTATE\.mode\s*==\s*2\s+then\s*return\s+(\d+)/,
      'bosses.finalDesperationHp',
      'content/data/game/GameData.lua',
    );
    const standardDespVal = extractNumber(
      bossForceLaunchFn[0],
      /return\s+(\d+)\s*\nend$/,
      'bosses.standardDesperationHp',
      'content/data/game/GameData.lua',
    );
    const techRecoverVal = extractNumber(
      bossTechFn[0],
      /return\s+(\d+)\s*\nend$/,
      'bosses.techRecoverTicks',
      'content/data/game/GameData.lua',
    );
    const minibossHpMatch = scrapGolemLua.match(/self\.health\s*=\s*GAMESTATE\.mod_rudeEnemies\s+and\s+(\d+)\s+or\s+(\d+)/);
    if (!minibossHpMatch) {
      throw new Error('Failed to extract miniboss HP from lua/gameobjects/editorLoaded/minibosses/scrap_golem.lua');
    }
    const minibossHpRudeVal = Number(minibossHpMatch[1]);
    const minibossHpNormalVal = Number(minibossHpMatch[2]);

    const bosses = {
      standardHp: datum(standardHpVal, 'extracted', 'content/data/game/GameData.lua', 'GAMEDATA.boss.getMaxHealth default'),
      standardDesperationHp: datum(standardDespVal, 'extracted', 'content/data/game/GameData.lua', 'GAMEDATA.boss.getForceLaunchPoint default'),
      finalHp: datum(finalHpVal, 'extracted', 'content/data/game/GameData.lua', 'GAMEDATA.boss.getMaxHealth(final=true) / Hard+Rude'),
      finalDesperationHp: datum(finalDespVal, 'extracted', 'content/data/game/GameData.lua', 'GAMEDATA.boss.getForceLaunchPoint Hard+Rude'),
      techRecoverTicks: datum(techRecoverVal, 'extracted', 'content/data/game/GameData.lua', 'GAMEDATA.boss.getTechRecoverFrames'),
      minibossHpNormal: datum(minibossHpNormalVal, 'extracted', 'lua/gameobjects/editorLoaded/minibosses/scrap_golem.lua', 'normal HP (also verified in virus_heli.lua)'),
      minibossHpRude: datum(minibossHpRudeVal, 'extracted', 'lua/gameobjects/editorLoaded/minibosses/scrap_golem.lua', 'rudeEnemies HP (also verified in virus_heli.lua)'),
    };

    // ---------------- COUNTS ----------------
    const gclFiles = allNames.filter((n) => n.startsWith('content/maps/') && n.endsWith('.gcl'));
    const remixFiles = gclFiles.filter((n) => n.endsWith('-remix.gcl'));
    const officialFiles = gclFiles.filter((n) => !n.endsWith('-remix.gcl'));

    const burstIds = Array.from(burstsLua.matchAll(/^\s*\[(-?\d+)\]\s*=/gm), (m) => Number(m[1])).filter((id) => id > 0);
    const chipIds = Array.from(chipsLua.matchAll(/^\s*\[(-?\d+)\]\s*=/gm), (m) => Number(m[1])).filter((id) => id > 0);

    const armorIdxStart = equippablesLua.indexOf('local armor =');
    const armorSection = armorIdxStart >= 0 ? equippablesLua.slice(armorIdxStart, armorIdxStart + 22000) : equippablesLua;
    const armorIds = new Set(Array.from(armorSection.matchAll(/^\s*\[(\d+)\]\s*=\s*\{/gm), (m) => Number(m[1])));

    const bossScripts = allNames.filter((n) => n.startsWith('lua/gameobjects/editorLoaded/bosses/') && n.endsWith('.lua'));
    const minibossScripts = allNames.filter((n) => n.startsWith('lua/gameobjects/editorLoaded/minibosses/') && n.endsWith('.lua'));
    const enemyScripts = allNames.filter((n) => n.startsWith('lua/gameobjects/editorLoaded/enemies/') && n.endsWith('.lua'));

    const rescuesMaxVal = extractNumber(
      loadoutsLua,
      /rescues\s*=\s*\{[\s\S]*?max\s*=\s*(\d+),/,
      'counts.rescues',
      'content/data/equippables/loadouts.lua',
    );
    const csvChallengeKeys = Array.from(challengesCsv.matchAll(/^(t_[a-zA-Z0-9_]+);/gm), (m) => m[1]).filter(
      (k) => k !== 't_hidden' && k !== 't_null',
    );
    const luaChallengeCount = Array.from(challengesLua.matchAll(/name\s*=\s*"(t_[^"]+)"/g)).length;
    const datachipEntries = Array.from(datachipsLua.matchAll(/class\s*=\s*"([^"]+)"/g));

    const counts = {
      officialMaps: datum(officialFiles.length, 'extracted', 'content/maps/*.gcl', 'Non-remix .gcl files'),
      remixMaps: datum(remixFiles.length, 'extracted', 'content/maps/*-remix.gcl', 'Remix .gcl files'),
      totalLayouts: datum(gclFiles.length, 'extracted', 'content/maps/*.gcl', 'Total .gcl layouts'),
      bursts: datum(burstIds.length, 'extracted', 'content/data/equippables/bursts.lua', 'Positive burst IDs 1..20'),
      chips: datum(chipIds.length, 'extracted', 'content/data/equippables/chips.lua', 'Positive chip IDs 1..20'),
      armors: datum(armorIds.size, 'extracted', 'content/data/equippables/equippables.lua', 'Armor paint IDs 0..11'),
      bosses: datum(bossScripts.length, 'extracted', 'lua/gameobjects/editorLoaded/bosses/*.lua', 'Boss actor scripts'),
      minibosses: datum(minibossScripts.length, 'extracted', 'lua/gameobjects/editorLoaded/minibosses/*.lua', 'Miniboss actor scripts'),
      enemies: datum(enemyScripts.length, 'extracted', 'lua/gameobjects/editorLoaded/enemies/*.lua', 'Enemy actor scripts'),
      rescues: datum(rescuesMaxVal, 'extracted', 'content/data/equippables/loadouts.lua', 'player.default.rescues.max = 64'),
      challenges: datum(
        csvChallengeKeys.length,
        'extracted',
        'content/csv/en/challengesData.csv',
        `Excluding t_hidden/t_null (cross-checked with challenges.lua base_list=${luaChallengeCount})`,
      ),
      datachips: datum(datachipEntries.length, 'extracted', 'content/data/collectibles/datachips.lua', 'DataChip.OG_TYPES count'),
    };

    // ---------------- CONTRACT PARITY AUDIT ----------------
    const discrepancies: OracleDiscrepancy[] = [];
    const checkParity = (dotPath: string, d: OracleDatum<number>, contractVal: number, detail = 'Value differs from src/contracts/index.ts') => {
      if (Math.abs(d.value - contractVal) > 1e-9) {
        discrepancies.push({
          path: dotPath,
          extracted: d.value,
          contract: contractVal,
          file: d.file,
          detail,
        });
      }
    };

    // Engine checks
    checkParity('engine.simHz', engine.simHz, ENGINE_CONSTANTS.SIM_HZ);
    checkParity('engine.gameWidth', engine.gameWidth, ENGINE_CONSTANTS.GAME_WIDTH);
    checkParity('engine.gameHeight', engine.gameHeight, ENGINE_CONSTANTS.GAME_HEIGHT);
    checkParity('engine.tileSize', engine.tileSize, ENGINE_CONSTANTS.TILE_SIZE);
    checkParity('engine.cellTilesW', engine.cellTilesW, ENGINE_CONSTANTS.CELL_TILES_W);
    checkParity('engine.cellTilesH', engine.cellTilesH, ENGINE_CONSTANTS.CELL_TILES_H);
    checkParity('engine.delayCameraTransition', engine.delayCameraTransition, ENGINE_CONSTANTS.DELAY_CAMERA_TRANSITION);
    checkParity('engine.jumpMargin', engine.jumpMargin, ENGINE_CONSTANTS.CAMERA_JUMP_MARGIN);

    // Player physics checks
    checkParity('playerPhysics.standW', playerPhysics.standW, PLAYER_PHYSICS.STAND_W);
    checkParity('playerPhysics.standH', playerPhysics.standH, PLAYER_PHYSICS.STAND_H);
    checkParity('playerPhysics.slideW', playerPhysics.slideW, PLAYER_PHYSICS.SLIDE_W);
    checkParity('playerPhysics.slideH', playerPhysics.slideH, PLAYER_PHYSICS.SLIDE_H);
    checkParity('playerPhysics.walkMaxSpeed', playerPhysics.walkMaxSpeed, PLAYER_PHYSICS.WALK_MAX_SPEED);
    checkParity('playerPhysics.sprintMaxSpeed', playerPhysics.sprintMaxSpeed, PLAYER_PHYSICS.SPRINT_MAX_SPEED);
    checkParity('playerPhysics.overloadWalkSpeed', playerPhysics.overloadWalkSpeed, PLAYER_PHYSICS.OVERLOAD_WALK_SPEED);
    checkParity('playerPhysics.overloadSprintSpeed', playerPhysics.overloadSprintSpeed, PLAYER_PHYSICS.OVERLOAD_SPRINT_SPEED);
    checkParity('playerPhysics.overloadDurationTicks', playerPhysics.overloadDurationTicks, PLAYER_PHYSICS.OVERLOAD_DURATION_TICKS);
    checkParity('playerPhysics.overloadDamageMult', playerPhysics.overloadDamageMult, PLAYER_PHYSICS.OVERLOAD_DAMAGE_MULT);
    checkParity('playerPhysics.speedArmorBonus', playerPhysics.speedArmorBonus, PLAYER_PHYSICS.SPEED_ARMOR_BONUS);
    checkParity('playerPhysics.runningFriction', playerPhysics.runningFriction, PLAYER_PHYSICS.RUNNING_FRICTION);
    checkParity('playerPhysics.gravity', playerPhysics.gravity, PLAYER_PHYSICS.GRAVITY);
    checkParity('playerPhysics.maxFallSpeed', playerPhysics.maxFallSpeed, PLAYER_PHYSICS.MAX_FALL_SPEED);
    checkParity('playerPhysics.heavyArmorFallBonus', playerPhysics.heavyArmorFallBonus, PLAYER_PHYSICS.HEAVY_ARMOR_FALL_BONUS);
    checkParity('playerPhysics.jumpImpulse', playerPhysics.jumpImpulse, PLAYER_PHYSICS.JUMP_IMPULSE);
    checkParity('playerPhysics.doubleJumpImpulse', playerPhysics.doubleJumpImpulse, PLAYER_PHYSICS.DOUBLE_JUMP_IMPULSE);
    checkParity('playerPhysics.coyoteTicks', playerPhysics.coyoteTicks, PLAYER_PHYSICS.COYOTE_TICKS);
    checkParity('playerPhysics.jumpBufferTicks', playerPhysics.jumpBufferTicks, PLAYER_PHYSICS.JUMP_BUFFER_TICKS);
    checkParity('playerPhysics.wallSlideMaxSpeed', playerPhysics.wallSlideMaxSpeed, PLAYER_PHYSICS.WALL_SLIDE_MAX_SPEED);
    checkParity('playerPhysics.wallJumpBufferMax', playerPhysics.wallJumpBufferMax, PLAYER_PHYSICS.WALL_JUMP_BUFFER_MAX);
    checkParity('playerPhysics.wallJumpMaxTime', playerPhysics.wallJumpMaxTime, PLAYER_PHYSICS.WALL_JUMP_MAX_TIME);
    checkParity('playerPhysics.wallJumpLeeway', playerPhysics.wallJumpLeeway, PLAYER_PHYSICS.WALL_JUMP_LEEWAY);
    checkParity('playerPhysics.wallJumpImpulseY', playerPhysics.wallJumpImpulseY, PLAYER_PHYSICS.WALL_JUMP_IMPULSE_Y);
    checkParity('playerPhysics.startingMaxHp', playerPhysics.startingMaxHp, PLAYER_PHYSICS.STARTING_MAX_HP);
    checkParity('playerPhysics.maxBoostedHp', playerPhysics.maxBoostedHp, PLAYER_PHYSICS.MAX_BOOSTED_HP);
    checkParity('playerPhysics.startingMaxBurst', playerPhysics.startingMaxBurst, PLAYER_PHYSICS.STARTING_MAX_BURST);
    checkParity('playerPhysics.maxBoostedBurst', playerPhysics.maxBoostedBurst, PLAYER_PHYSICS.MAX_BOOSTED_BURST);
    checkParity('playerPhysics.invulnBaseTicks', playerPhysics.invulnBaseTicks, PLAYER_PHYSICS.INVULN_BASE_TICKS);
    checkParity('playerPhysics.hazardWarpInvulnTicks', playerPhysics.hazardWarpInvulnTicks, PLAYER_PHYSICS.HAZARD_WARP_INVULN_TICKS);

    // Hookshot checks
    checkParity('hookshot.tipW', hookshot.tipW, HOOKSHOT_CONSTANTS.TIP_W);
    checkParity('hookshot.tipH', hookshot.tipH, HOOKSHOT_CONSTANTS.TIP_H);
    checkParity('hookshot.maxSpeed', hookshot.maxSpeed, HOOKSHOT_CONSTANTS.MAX_SPEED);
    checkParity('hookshot.timerMax', hookshot.timerMax, HOOKSHOT_CONSTANTS.TIMER_MAX);
    checkParity('hookshot.deaccelOutward', hookshot.deaccelOutward, HOOKSHOT_CONSTANTS.DEACCEL_OUTWARD);
    checkParity('hookshot.deaccelInward', hookshot.deaccelInward, HOOKSHOT_CONSTANTS.DEACCEL_INWARD);
    checkParity('hookshot.extensionLength', hookshot.extensionLength, HOOKSHOT_CONSTANTS.EXTENSION_LENGTH);
    checkParity('hookshot.swingRopeMaxLen', hookshot.swingRopeMaxLen, HOOKSHOT_CONSTANTS.SWING_ROPE_MAX_LEN);
    checkParity('hookshot.throwVxNeutral', hookshot.throwVxNeutral, HOOKSHOT_CONSTANTS.THROW_VX_NEUTRAL);
    checkParity('hookshot.throwVxDiagonal', hookshot.throwVxDiagonal, HOOKSHOT_CONSTANTS.THROW_VX_DIAGONAL);
    checkParity('hookshot.throwVxSprintBonus', hookshot.throwVxSprintBonus, HOOKSHOT_CONSTANTS.THROW_VX_SPRINT_BONUS);
    checkParity('hookshot.throwVyNeutral', hookshot.throwVyNeutral, HOOKSHOT_CONSTANTS.THROW_VY_NEUTRAL);
    checkParity('hookshot.throwVyUp', hookshot.throwVyUp, HOOKSHOT_CONSTANTS.THROW_VY_UP);
    checkParity('hookshot.throwVyDown', hookshot.throwVyDown, HOOKSHOT_CONSTANTS.THROW_VY_DOWN);
    checkParity('hookshot.throwCollisionDmg', hookshot.throwCollisionDmg, HOOKSHOT_CONSTANTS.THROW_COLLISION_DAMAGE);
    checkParity('hookshot.throwBounceDmg', hookshot.throwBounceDmg, HOOKSHOT_CONSTANTS.THROW_BOUNCE_DAMAGE);

    // Damage table checks
    for (const diff of ['normal', 'easy', 'hard'] as const) {
      const ext = damageTables[diff];
      const con = DAMAGE_TABLES[diff];
      checkParity(`damageTables.${diff}.lightContact`, ext.lightContact, con.lightContact);
      checkParity(`damageTables.${diff}.mediumContact`, ext.mediumContact, con.mediumContact);
      checkParity(`damageTables.${diff}.heavyContact`, ext.heavyContact, con.heavyContact);
      checkParity(
        `damageTables.${diff}.lightProjectile`,
        ext.lightProjectile,
        con.lightProjectile,
        diff === 'easy'
          ? 'Retail fillValues(EASY_MODE_DAMAGE_VALUES, -1, 2) clamps max(2 - 1, 2) = 2'
          : 'Value differs from src/contracts/index.ts',
      );
      checkParity(`damageTables.${diff}.mediumProjectile`, ext.mediumProjectile, con.mediumProjectile);
      checkParity(`damageTables.${diff}.heavyProjectile`, ext.heavyProjectile, con.heavyProjectile);
      checkParity(`damageTables.${diff}.explosion`, ext.explosion, con.explosion);
      checkParity(`damageTables.${diff}.hazard`, ext.hazard, con.hazard);
      checkParity(`damageTables.${diff}.collision`, ext.collision, con.collision);
      checkParity(
        `damageTables.${diff}.bounce`,
        ext.bounce,
        con.bounce,
        'Retail damageTypes.lua omits explicit BOUNCE override on easy/hard so fillValues shifts it (-1/+1)',
      );
      checkParity(`damageTables.${diff}.invulnMult`, ext.invulnMult, con.invulnMult);
    }

    // Attack checks (dimensions / damage / activeTicks where non-null)
    for (const [key, extAtk] of Object.entries(attacks)) {
      const conAtk = ATTACK_DATA[key as keyof typeof ATTACK_DATA];
      checkParity(`attacks.${key}.damage`, extAtk.damage, conAtk.damage);
      checkParity(`attacks.${key}.width`, extAtk.width, conAtk.width);
      checkParity(`attacks.${key}.height`, extAtk.height, conAtk.height);
      if (extAtk.activeTicks.value !== null) {
        checkParity(
          `attacks.${key}.activeTicks`,
          datum(extAtk.activeTicks.value, extAtk.activeTicks.source, extAtk.activeTicks.file),
          conAtk.activeTicks,
        );
      }
      if (extAtk.freezeTicks.value !== null) {
        checkParity(
          `attacks.${key}.freezeTicks`,
          datum(extAtk.freezeTicks.value, extAtk.freezeTicks.source, extAtk.freezeTicks.file),
          conAtk.freezeTicks,
        );
      }
    }

    // Boss checks
    checkParity('bosses.standardHp', bosses.standardHp, BOSS_CONSTANTS.STANDARD_HP);
    checkParity('bosses.standardDesperationHp', bosses.standardDesperationHp, BOSS_CONSTANTS.STANDARD_DESPERATION_HP);
    checkParity('bosses.finalHp', bosses.finalHp, BOSS_CONSTANTS.FINAL_HP);
    checkParity('bosses.finalDesperationHp', bosses.finalDesperationHp, BOSS_CONSTANTS.FINAL_DESPERATION_HP);
    checkParity('bosses.techRecoverTicks', bosses.techRecoverTicks, BOSS_CONSTANTS.TECH_RECOVER_TICKS);
    checkParity('bosses.minibossHpNormal', bosses.minibossHpNormal, BOSS_CONSTANTS.MINIBOSS_HP_NORMAL);
    checkParity('bosses.minibossHpRude', bosses.minibossHpRude, BOSS_CONSTANTS.MINIBOSS_HP_RUDE);

    // Count checks
    checkParity('counts.officialMaps', counts.officialMaps, CONTENT_COUNTS.OFFICIAL_MAPS);
    checkParity('counts.remixMaps', counts.remixMaps, CONTENT_COUNTS.REMIX_MAPS);
    checkParity('counts.totalLayouts', counts.totalLayouts, CONTENT_COUNTS.TOTAL_LAYOUTS);
    checkParity('counts.bursts', counts.bursts, CONTENT_COUNTS.BURST_TECHNIQUES);
    checkParity('counts.chips', counts.chips, CONTENT_COUNTS.BOOSTER_CHIPS);
    checkParity('counts.armors', counts.armors, CONTENT_COUNTS.ARMOR_PAINTS);
    checkParity('counts.bosses', counts.bosses, CONTENT_COUNTS.BOSSES);
    checkParity('counts.minibosses', counts.minibosses, CONTENT_COUNTS.MINIBOSSES);
    checkParity('counts.enemies', counts.enemies, CONTENT_COUNTS.ENEMY_ARCHETYPES);
    checkParity('counts.rescues', counts.rescues, CONTENT_COUNTS.RESCUES);
    checkParity('counts.challenges', counts.challenges, CONTENT_COUNTS.CHALLENGES);
    checkParity('counts.datachips', counts.datachips, CONTENT_COUNTS.DATACHIPS);

    const oracle = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      sourceExe: exePath,
      loveVersion: loveVersionMatch ? loveVersionMatch[1] : 'unknown',
      archiveEntries: allNames.length,
      engine,
      playerPhysics,
      hookshot,
      damageTables,
      attacks,
      bosses,
      counts,
      discrepancies,
    };

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(oracle, null, 2) + '\n', 'utf8');

    console.log(`[oracle-dump] Wrote ${OUTPUT_FILE}`);
    console.log(
      `[oracle-dump] Verified counts: officialMaps=${counts.officialMaps.value}, remixMaps=${counts.remixMaps.value}, totalLayouts=${counts.totalLayouts.value}, bursts=${counts.bursts.value}, chips=${counts.chips.value}, armors=${counts.armors.value}, bosses=${counts.bosses.value}, minibosses=${counts.minibosses.value}, enemies=${counts.enemies.value}, rescues=${counts.rescues.value}, challenges=${counts.challenges.value}, datachips=${counts.datachips.value}`,
    );
    console.log(`[oracle-dump] Contract parity discrepancies detected: ${discrepancies.length}`);
    for (const d of discrepancies) {
      console.log(`  - ${d.path}: extracted=${d.extracted} vs contract=${d.contract} (${d.file}) — ${d.detail}`);
    }
  } finally {
    zip.close();
  }
}

main();
