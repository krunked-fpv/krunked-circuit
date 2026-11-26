// ============================================================================
// Krunked Circuit — Gate A Verification Suite (Tracked in Git & CI)
// Run via: npm run verify:assets  (tsx scripts/verify/verify-assets.ts)
//
// Audits ALL 5 Gate A Pillars:
//   1. Built-In Asset Completeness (ProceduralPixelAtlas, AssetRegistry,
//      15x17 biome tiles, 21 PALETTE_KEY_COLORS hero frames, 12 bosses,
//      3 minibosses, 9 enemy families, 40 equippable icons, props/pickups/HUD,
//      ASCII 32..126 bitmap font, and all BGM/SFX keys in soundManifest.ts)
//   2. Owned Custom Pack Verification (when .krunked-circuit-assets/manifest.json
//      exists locally — validates schema + PNG/OGG/WAV headers; skips cleanly in CI)
//   3. Mechanic Oracle Parity Checks (direct contracts + live src/data/* registries
//      + optional .krunked-circuit-assets/oracle.json cross-check)
//   4. TASTE_NOTES Contract Audit (Gamepad deadzone/trigger/presets, TouchOverlay
//      strictly hidden by default, styles.css .touch-hidden & pixelated rules)
//   5. IP & Binary Hygiene Audit (git ls-files, dist/, zero retail binaries,
//      zero non-README tracked markdown, zero leaked retail proper nouns)
// ============================================================================

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ATTACK_DATA,
  BOSS_CONSTANTS,
  CONTENT_COUNTS,
  DAMAGE_TABLES,
  ENGINE_CONSTANTS,
  GAMEPAD_CONSTANTS,
  HOOKSHOT_CONSTANTS,
  MAIN_EIGHT_STAGES,
  OFFICIAL_STAGE_IDS,
  PLAYER_PHYSICS,
  REMIXABLE_STAGES,
  TileType,
  type AssetPackManifest,
  type BossId,
  type EnemyFamily,
  type MinibossId,
} from '../../src/contracts/index';
import { AssetRegistry } from '../../src/assets/AssetRegistry';
import {
  HERO_FRAME_NAMES,
  PALETTE_KEY_COLORS,
  ProceduralPixelAtlas,
  SOLID_TILE_TYPES,
  type AtlasRegion,
  type PixelSurface,
} from '../../src/assets/ProceduralPixelAtlas';
import {
  BGM_KEYS,
  SFX_KEYS,
  getSfxSpec,
  getTrackSpec,
  resolveBgmKey,
  resolveSfxKey,
} from '../../src/audio/soundManifest';
import {
  ARMOR_PAINT_DEFINITIONS,
  BOSS_DEFINITIONS,
  BURST_DEFINITIONS,
  CHALLENGE_DEFINITIONS,
  CHIP_DEFINITIONS,
  DATACHIP_DEFINITIONS,
  ENEMY_ARCHETYPES,
  getStageDefinition,
} from '../../src/data/index';
import { GamepadAdapter } from '../../src/input/GamepadAdapter';
import { TouchOverlay } from '../../src/input/TouchOverlay';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const ASSETS_DIR = process.env.KRUNKED_ASSETS_DIR
  ? path.resolve(process.env.KRUNKED_ASSETS_DIR)
  : path.join(REPO_ROOT, '.krunked-circuit-assets');

interface CheckRecord {
  readonly suite: string;
  readonly name: string;
  readonly status: 'PASS' | 'FAIL' | 'SKIP';
  readonly detail: string;
}

const results: CheckRecord[] = [];

function record(suite: string, name: string, ok: boolean, detail: string): void {
  results.push({ suite, name, status: ok ? 'PASS' : 'FAIL', detail });
}

function skip(suite: string, name: string, detail: string): void {
  results.push({ suite, name, status: 'SKIP', detail });
}

function parseHexRgb(hex: string): [number, number, number] {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

function regionStats(
  sheet: PixelSurface,
  reg: AtlasRegion,
): { opaquePixels: number; hash: string; inBounds: boolean } {
  const inBounds =
    reg.x >= 0 &&
    reg.y >= 0 &&
    reg.w > 0 &&
    reg.h > 0 &&
    reg.x + reg.w <= sheet.width &&
    reg.y + reg.h <= sheet.height;

  if (!inBounds) {
    return { opaquePixels: 0, hash: 'oob', inBounds: false };
  }

  let opaquePixels = 0;
  const buf = Buffer.allocUnsafe(reg.w * reg.h * 4);
  let cursor = 0;
  for (let yy = 0; yy < reg.h; yy++) {
    const rowStart = ((reg.y + yy) * sheet.width + reg.x) * 4;
    for (let xx = 0; xx < reg.w; xx++) {
      const idx = rowStart + xx * 4;
      const r = sheet.pixels[idx];
      const g = sheet.pixels[idx + 1];
      const b = sheet.pixels[idx + 2];
      const a = sheet.pixels[idx + 3];
      if (a > 0) opaquePixels++;
      buf[cursor++] = r;
      buf[cursor++] = g;
      buf[cursor++] = b;
      buf[cursor++] = a;
    }
  }
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);
  return { opaquePixels, hash, inBounds: true };
}

function sha1Text(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 16);
}

// ============================================================================
// SUITE 1: Built-In Asset Completeness
// ============================================================================

async function runSuite1BuiltInAssets(): Promise<void> {
  const suite = '1. Built-In Assets';

  const standaloneAtlas = new ProceduralPixelAtlas();
  const registry = new AssetRegistry();
  await registry.init();
  const atlas = registry.getAtlas();
  const sheet = atlas.getSheet();

  // DOM safety & atlas sheet invariants + zero region overlap check
  const standaloneSheet = standaloneAtlas.getSheet();
  const uniqueRects = new Map<string, AtlasRegion>();
  for (const reg of Object.values(atlas.getRegionsRecord())) {
    uniqueRects.set(`${reg.x},${reg.y},${reg.w},${reg.h}`, reg);
  }
  const rectList = Array.from(uniqueRects.values());
  let overlaps = 0;
  for (let i = 0; i < rectList.length; i++) {
    const a = rectList[i];
    for (let j = i + 1; j < rectList.length; j++) {
      const b = rectList[j];
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) {
        overlaps++;
      }
    }
  }
  const domSafeOk =
    registry.getMode() === 'BUILTIN' &&
    standaloneAtlas.toCanvas() === null &&
    atlas.toCanvas() === null &&
    standaloneSheet.width === sheet.width &&
    standaloneSheet.height === sheet.height &&
    isPowerOfTwo(sheet.width) &&
    isPowerOfTwo(sheet.height) &&
    sheet.pixels.length === sheet.width * sheet.height * 4 &&
    overlaps === 0;
  standaloneAtlas.dispose();
  record(
    suite,
    'DOM-safe Node instantiation, POT atlas sheet & zero packing overlaps',
    domSafeOk,
    `sheet=${sheet.width}x${sheet.height}, packedSprites=${rectList.length}, overlaps=${overlaps}, mode=${registry.getMode()}`,
  );

  // Every required logical key from AssetRegistry
  const requiredKeys = registry.getRequiredLogicalKeys();
  const missingKeys: string[] = [];
  const invalidKeys: string[] = [];
  for (const key of requiredKeys) {
    const reg = atlas.getRegion(key);
    if (!reg) {
      missingKeys.push(key);
      continue;
    }
    const stats = regionStats(sheet, reg);
    const allowEmpty = key === 'font_32'; // ASCII space is intentionally transparent
    if (!stats.inBounds || (!allowEmpty && stats.opaquePixels === 0)) {
      invalidKeys.push(`${key}(${reg.w}x${reg.h},opaque=${stats.opaquePixels},inBounds=${stats.inBounds})`);
    }
  }
  record(
    suite,
    'AssetRegistry required logical keys',
    missingKeys.length === 0 && invalidKeys.length === 0,
    missingKeys.length === 0 && invalidKeys.length === 0
      ? `All ${requiredKeys.length} required keys resolved with valid bounds & alpha`
      : `missing=[${missingKeys.slice(0, 10).join(', ')}] invalid=[${invalidKeys.slice(0, 10).join(', ')}]`,
  );

  // 15x17 Biome tilesets + 15 distinct SOLID biome visuals
  const badBiomeTiles: string[] = [];
  const solidTileHashes = new Set<string>();
  for (const stageId of OFFICIAL_STAGE_IDS) {
    for (const tileType of SOLID_TILE_TYPES) {
      const key = `tile_${stageId}_${tileType}`;
      const reg = atlas.getRegion(key);
      if (!reg) {
        badBiomeTiles.push(`${key}:missing`);
        continue;
      }
      const stats = regionStats(sheet, reg);
      if (!stats.inBounds || reg.w !== 16 || reg.h !== 16 || stats.opaquePixels === 0) {
        badBiomeTiles.push(`${key}:${reg.w}x${reg.h},opaque=${stats.opaquePixels}`);
      }
      if (tileType === TileType.SOLID) {
        solidTileHashes.add(stats.hash);
      }
    }
  }
  const expectedTileCount = OFFICIAL_STAGE_IDS.length * SOLID_TILE_TYPES.length;
  record(
    suite,
    '15x17 biome tilesets (16x16 & 15 unique biome SOLID tiles)',
    badBiomeTiles.length === 0 &&
      OFFICIAL_STAGE_IDS.length === 15 &&
      SOLID_TILE_TYPES.length === 17 &&
      solidTileHashes.size === 15,
    `tiles=${expectedTileCount - badBiomeTiles.length}/${expectedTileCount}, uniqueSolidBiomes=${solidTileHashes.size}/15` +
      (badBiomeTiles.length > 0 ? ` bad=[${badBiomeTiles.slice(0, 8).join(', ')}]` : ''),
  );

  // 21 Hero frames — strict 100% PALETTE_KEY_COLORS compliance
  const allowedRgb = new Set(
    PALETTE_KEY_COLORS.map((hex) => {
      const [r, g, b] = parseHexRgb(hex);
      return `${r},${g},${b}`;
    }),
  );
  const heroErrors: string[] = [];
  for (const frameName of HERO_FRAME_NAMES) {
    const key = `player_hero_${frameName}`;
    const reg = atlas.getRegion(key);
    if (!reg || reg.w !== 32 || reg.h !== 32) {
      heroErrors.push(`${key}:missing_or_wrong_size`);
      continue;
    }
    let opaqueCount = 0;
    let nonCompliantCount = 0;
    let firstBad = '';
    for (let yy = 0; yy < reg.h; yy++) {
      const rowStart = ((reg.y + yy) * sheet.width + reg.x) * 4;
      for (let xx = 0; xx < reg.w; xx++) {
        const idx = rowStart + xx * 4;
        const a = sheet.pixels[idx + 3];
        if (a === 0) continue;
        opaqueCount++;
        const r = sheet.pixels[idx];
        const g = sheet.pixels[idx + 1];
        const b = sheet.pixels[idx + 2];
        if (a !== 255 || !allowedRgb.has(`${r},${g},${b}`)) {
          nonCompliantCount++;
          if (!firstBad) firstBad = `rgba(${r},${g},${b},${a})@(${xx},${yy})`;
        }
      }
    }
    if (opaqueCount === 0 || nonCompliantCount > 0) {
      heroErrors.push(`${key}:opaque=${opaqueCount},bad=${nonCompliantCount}(${firstBad})`);
    }
  }
  record(
    suite,
    '21 Hero frames (32x32, 100% PALETTE_KEY_COLORS compliant)',
    HERO_FRAME_NAMES.length === 21 && heroErrors.length === 0,
    heroErrors.length === 0
      ? `All 21 hero frames strictly use the 6 PALETTE_KEY_COLORS`
      : `errors=[${heroErrors.slice(0, 6).join('; ')}]`,
  );

  // 12 Bosses + 3 Minibosses (unique silhouettes, valid bounds & non-zero alpha)
  const bossIds: readonly BossId[] = [
    'siege_tread',
    'prism',
    'stitch',
    'frostfang',
    'arcbolt',
    'strider',
    'tempo',
    'crag',
    'phantom',
    'mirror_rival',
    'prism_core',
    'overlord_apex',
  ];
  const minibossIds: readonly MinibossId[] = ['junk_colossus', 'sky_gunship', 'wrecker_tank'];
  const bossErrors: string[] = [];
  const bossHashes = new Set<string>();
  for (const id of bossIds) {
    const key = `boss_${id}`;
    const reg = atlas.getRegion(key);
    if (!reg) {
      bossErrors.push(`${key}:missing`);
      continue;
    }
    const stats = regionStats(sheet, reg);
    if (!stats.inBounds || stats.opaquePixels < 100) {
      bossErrors.push(`${key}:opaque=${stats.opaquePixels}`);
    } else {
      bossHashes.add(stats.hash);
    }
  }
  for (const id of minibossIds) {
    const key = `miniboss_${id}`;
    const reg = atlas.getRegion(key);
    if (!reg) {
      bossErrors.push(`${key}:missing`);
      continue;
    }
    const stats = regionStats(sheet, reg);
    if (!stats.inBounds || stats.opaquePixels < 100) {
      bossErrors.push(`${key}:opaque=${stats.opaquePixels}`);
    } else {
      bossHashes.add(stats.hash);
    }
  }
  record(
    suite,
    '12 Bosses + 3 Minibosses (unique sprites & non-zero alpha)',
    bossErrors.length === 0 && bossHashes.size === 15,
    `unique=${bossHashes.size}/15` + (bossErrors.length > 0 ? ` errors=[${bossErrors.join(', ')}]` : ''),
  );

  // 9 Enemy families
  const enemyFamilies: readonly EnemyFamily[] = [
    'trooper',
    'shield_guard',
    'turret',
    'hopper',
    'flyer',
    'crawler',
    'spawner',
    'hazard',
    'dummy',
  ];
  const enemyErrors: string[] = [];
  const enemyHashes = new Set<string>();
  for (const fam of enemyFamilies) {
    const key = `enemy_${fam}`;
    const reg = atlas.getRegion(key);
    if (!reg) {
      enemyErrors.push(`${key}:missing`);
      continue;
    }
    const stats = regionStats(sheet, reg);
    if (!stats.inBounds || stats.opaquePixels === 0) {
      enemyErrors.push(`${key}:empty`);
    } else {
      enemyHashes.add(stats.hash);
    }
  }
  record(
    suite,
    '9 Enemy families',
    enemyErrors.length === 0 && enemyHashes.size === 9,
    `verified=${enemyHashes.size}/9` + (enemyErrors.length > 0 ? ` errors=[${enemyErrors.join(', ')}]` : ''),
  );

  // 40 Equippable Icons: icon_burst_1..20 & icon_chip_1..20 (12x12) + data iconKey aliases
  const iconErrors: string[] = [];
  const burstIconHashes = new Set<string>();
  const chipIconHashes = new Set<string>();
  for (let i = 1; i <= 20; i++) {
    const bKey = `icon_burst_${i}`;
    const bReg = atlas.getRegion(bKey);
    if (!bReg || bReg.w !== 12 || bReg.h !== 12) {
      iconErrors.push(`${bKey}:missing_or_size`);
    } else {
      const s = regionStats(sheet, bReg);
      if (!s.inBounds || s.opaquePixels === 0) iconErrors.push(`${bKey}:empty`);
      else burstIconHashes.add(s.hash);
    }

    const cKey = `icon_chip_${i}`;
    const cReg = atlas.getRegion(cKey);
    if (!cReg || cReg.w !== 12 || cReg.h !== 12) {
      iconErrors.push(`${cKey}:missing_or_size`);
    } else {
      const s = regionStats(sheet, cReg);
      if (!s.inBounds || s.opaquePixels === 0) iconErrors.push(`${cKey}:empty`);
      else chipIconHashes.add(s.hash);
    }
  }
  for (const def of BURST_DEFINITIONS) {
    if (!atlas.getRegion(def.iconKey)) iconErrors.push(`alias:${def.iconKey}`);
  }
  for (const def of CHIP_DEFINITIONS) {
    if (!atlas.getRegion(def.iconKey)) iconErrors.push(`alias:${def.iconKey}`);
  }
  record(
    suite,
    'Equippable icons (icon_burst_1..20 & icon_chip_1..20, 12x12)',
    iconErrors.length === 0 && burstIconHashes.size === 20 && chipIconHashes.size === 20,
    `burstIcons=${burstIconHashes.size}/20, chipIcons=${chipIconHashes.size}/20` +
      (iconErrors.length > 0 ? ` errors=[${iconErrors.slice(0, 8).join(', ')}]` : ''),
  );

  // Bitmap font ASCII 32..126 + Node text buffer render
  const font = atlas.getFont();
  const fontErrors: string[] = [];
  for (let code = 32; code <= 126; code++) {
    const reg = font.getGlyph(code);
    if (!reg || reg.w !== 6 || reg.h !== 8) {
      fontErrors.push(`code_${code}:missing`);
      continue;
    }
    const stats = regionStats(sheet, reg);
    if (!stats.inBounds || (code !== 32 && stats.opaquePixels === 0)) {
      fontErrors.push(`code_${code}:empty`);
    }
  }
  const sampleText = atlas.renderTextToBuffer('KRUNKED CIRCUIT 0123456789');
  const fontOk =
    font.firstChar === 32 &&
    font.lastChar === 126 &&
    font.glyphWidth === 6 &&
    font.glyphHeight === 8 &&
    fontErrors.length === 0 &&
    sampleText.width > 0 &&
    sampleText.height === 8;
  record(
    suite,
    'Bitmap font ASCII 32..126 (6x8 outlined)',
    fontOk,
    fontOk
      ? `95 glyphs (32..126) valid, sampleBuffer=${sampleText.width}x${sampleText.height}`
      : `errors=[${fontErrors.slice(0, 8).join(', ')}]`,
  );

  // Audio Manifest: all BGM & SFX keys + stage/boss BGM resolution
  const audioErrors: string[] = [];
  for (const k of BGM_KEYS) {
    const resolved = resolveBgmKey(k);
    const spec = getTrackSpec(k);
    if (resolved !== k || !spec || spec.bpm <= 0 || spec.gain <= 0 || spec.customPackKeys.length === 0) {
      audioErrors.push(`bgm:${k}`);
    }
  }
  for (const k of SFX_KEYS) {
    const resolved = resolveSfxKey(k);
    const spec = getSfxSpec(k);
    if (
      resolved !== k ||
      !spec ||
      spec.durationMs <= 0 ||
      spec.maxVoices <= 0 ||
      spec.baseGain <= 0 ||
      spec.customPackKeys.length === 0
    ) {
      audioErrors.push(`sfx:${k}`);
    }
  }
  for (const stageId of OFFICIAL_STAGE_IDS) {
    const st = getStageDefinition(stageId, false);
    if (!resolveBgmKey(st.bgmKey)) audioErrors.push(`stage_bgm:${stageId}->${st.bgmKey}`);
    if (!resolveBgmKey(st.bossBgmKey)) audioErrors.push(`stage_bossBgm:${stageId}->${st.bossBgmKey}`);
  }
  for (const boss of BOSS_DEFINITIONS) {
    if (!resolveBgmKey(boss.bgmKey)) audioErrors.push(`boss_bgm:${boss.id}->${boss.bgmKey}`);
  }
  record(
    suite,
    'Audio manifest BGM & SFX catalog resolution',
    BGM_KEYS.length >= 23 && SFX_KEYS.length >= 35 && audioErrors.length === 0,
    `bgmKeys=${BGM_KEYS.length}, sfxKeys=${SFX_KEYS.length}` +
      (audioErrors.length > 0 ? ` errors=[${audioErrors.slice(0, 8).join(', ')}]` : ''),
  );

  registry.dispose();
}

// ============================================================================
// SUITE 2: Owned Custom Pack Verification (Optional Local Steam Pack)
// ============================================================================

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function validateBinaryHeader(absPath: string): { ok: boolean; reason: string } {
  if (!fs.existsSync(absPath)) {
    return { ok: false, reason: 'file_missing' };
  }
  const stat = fs.statSync(absPath);
  if (stat.size < 24) {
    return { ok: false, reason: `too_small(${stat.size}B)` };
  }
  const ext = path.extname(absPath).toLowerCase();
  const fd = fs.openSync(absPath, 'r');
  try {
    const head = Buffer.allocUnsafe(24);
    fs.readSync(fd, head, 0, 24, 0);
    if (ext === '.png') {
      if (!head.subarray(0, 8).equals(PNG_MAGIC)) {
        return { ok: false, reason: 'invalid_png_magic' };
      }
      const ihdr = head.toString('ascii', 12, 16);
      const w = head.readUInt32BE(16);
      const h = head.readUInt32BE(20);
      if (ihdr !== 'IHDR' || w <= 0 || h <= 0) {
        return { ok: false, reason: `invalid_png_ihdr(${ihdr},${w}x${h})` };
      }
      return { ok: true, reason: 'ok' };
    }
    if (ext === '.ogg') {
      const sig = head.toString('ascii', 0, 4);
      return sig === 'OggS' ? { ok: true, reason: 'ok' } : { ok: false, reason: `invalid_ogg_magic(${sig})` };
    }
    if (ext === '.wav') {
      const riff = head.toString('ascii', 0, 4);
      const wave = head.toString('ascii', 8, 12);
      return riff === 'RIFF' && wave === 'WAVE'
        ? { ok: true, reason: 'ok' }
        : { ok: false, reason: `invalid_wav_magic(${riff}/${wave})` };
    }
    return { ok: false, reason: `unsupported_ext(${ext})` };
  } finally {
    fs.closeSync(fd);
  }
}

function runSuite2CustomPack(): void {
  const suite = '2. Owned Custom Pack';
  const assetsDir = ASSETS_DIR;
  const manifestPath = path.join(assetsDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    skip(
      suite,
      'Local custom pack verification',
      'No .krunked-circuit-assets/manifest.json present (expected in CI / clean clones without Steam assets)',
    );
    return;
  }

  let manifest: AssetPackManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as AssetPackManifest;
  } catch (err) {
    record(suite, 'Manifest JSON parse', false, `Failed to parse manifest.json: ${String(err)}`);
    return;
  }

  const schemaOk =
    typeof manifest.version === 'number' &&
    manifest.version >= 1 &&
    typeof manifest.source === 'string' &&
    manifest.source.length > 0 &&
    typeof manifest.extractedAt === 'string' &&
    manifest.counts !== null &&
    typeof manifest.counts === 'object' &&
    manifest.counts.images > 0 &&
    manifest.counts.audioMusic > 0 &&
    manifest.counts.audioSfx > 0 &&
    typeof manifest.sprites === 'object' &&
    Object.keys(manifest.sprites).length > 0 &&
    typeof manifest.tilesets === 'object' &&
    Object.keys(manifest.tilesets).length >= 15 &&
    typeof manifest.backgrounds === 'object' &&
    Object.keys(manifest.backgrounds).length >= 15 &&
    typeof manifest.audioMusic === 'object' &&
    Object.keys(manifest.audioMusic).length > 0 &&
    typeof manifest.audioSfx === 'object' &&
    Object.keys(manifest.audioSfx).length > 0;

  record(
    suite,
    'Manifest schema & counts',
    schemaOk,
    `v=${manifest.version}, sprites=${Object.keys(manifest.sprites ?? {}).length}, tilesets=${Object.keys(manifest.tilesets ?? {}).length}, bg=${Object.keys(manifest.backgrounds ?? {}).length}, music=${Object.keys(manifest.audioMusic ?? {}).length}, sfx=${Object.keys(manifest.audioSfx ?? {}).length}`,
  );

  // Verify every referenced file exists and has valid PNG/OGG/WAV magic headers
  const allRelPaths = new Set<string>([
    ...Object.values(manifest.sprites ?? {}),
    ...Object.values(manifest.tilesets ?? {}),
    ...Object.values(manifest.backgrounds ?? {}),
    ...Object.values(manifest.audioMusic ?? {}),
    ...Object.values(manifest.audioSfx ?? {}),
  ]);
  const badFiles: string[] = [];
  for (const rel of allRelPaths) {
    const abs = path.resolve(assetsDir, rel);
    if (!abs.startsWith(assetsDir + path.sep)) {
      badFiles.push(`${rel}:path_traversal`);
      continue;
    }
    const check = validateBinaryHeader(abs);
    if (!check.ok) {
      badFiles.push(`${rel}:${check.reason}`);
    }
  }
  record(
    suite,
    'Referenced custom pack files & PNG/OGG/WAV headers',
    badFiles.length === 0,
    badFiles.length === 0
      ? `Validated ${allRelPaths.size} unique image/audio files with valid PNG/OGG/WAV headers`
      : `failed=${badFiles.length}/${allRelPaths.size} [${badFiles.slice(0, 8).join(', ')}]`,
  );
}

// ============================================================================
// SUITE 3: Mechanic Oracle Parity Checks
// ============================================================================

interface OracleDatum {
  value: number | null;
  source: string;
  file: string;
}

interface OracleJson {
  engine: Record<string, OracleDatum>;
  playerPhysics: Record<string, OracleDatum>;
  hookshot: Record<string, OracleDatum>;
  damageTables: Record<'normal' | 'easy' | 'hard', Record<string, OracleDatum>>;
  attacks: Record<string, Record<string, OracleDatum>>;
  bosses: Record<string, OracleDatum>;
  counts: Record<string, OracleDatum>;
  discrepancies?: unknown[];
}

function runSuite3OracleParity(): void {
  const suite = '3. Mechanic Oracle Parity';

  // 3A. Direct Engine Contract Invariants
  const engineMismatches: string[] = [];
  const assertEq = (list: string[], label: string, actual: number, expected: number): void => {
    if (Math.abs(actual - expected) > 1e-9) {
      list.push(`${label}: actual=${actual} expected=${expected}`);
    }
  };

  assertEq(engineMismatches, 'SIM_HZ', ENGINE_CONSTANTS.SIM_HZ, 60);
  assertEq(engineMismatches, 'GAME_WIDTH', ENGINE_CONSTANTS.GAME_WIDTH, 400);
  assertEq(engineMismatches, 'GAME_HEIGHT', ENGINE_CONSTANTS.GAME_HEIGHT, 240);
  assertEq(engineMismatches, 'TILE_SIZE', ENGINE_CONSTANTS.TILE_SIZE, 16);
  assertEq(engineMismatches, 'CELL_TILES_W', ENGINE_CONSTANTS.CELL_TILES_W, 25);
  assertEq(engineMismatches, 'CELL_TILES_H', ENGINE_CONSTANTS.CELL_TILES_H, 15);
  assertEq(engineMismatches, 'DELAY_CAMERA_TRANSITION', ENGINE_CONSTANTS.DELAY_CAMERA_TRANSITION, 5);
  assertEq(engineMismatches, 'CAMERA_JUMP_MARGIN', ENGINE_CONSTANTS.CAMERA_JUMP_MARGIN, 15);
  record(
    suite,
    'Engine invariants (60Hz, 400x240, 16px, 25x15, 5t cam, 15px jumpMargin)',
    engineMismatches.length === 0,
    engineMismatches.length === 0 ? 'All 8 engine invariants match' : engineMismatches.join('; '),
  );

  // 3B. Player Physics, Hookshot & Boss HP Invariants
  const physMismatches: string[] = [];
  assertEq(physMismatches, 'STAND_W', PLAYER_PHYSICS.STAND_W, 14);
  assertEq(physMismatches, 'STAND_H', PLAYER_PHYSICS.STAND_H, 28);
  assertEq(physMismatches, 'SLIDE_W', PLAYER_PHYSICS.SLIDE_W, 14);
  assertEq(physMismatches, 'SLIDE_H', PLAYER_PHYSICS.SLIDE_H, 14);
  assertEq(physMismatches, 'WALK_MAX_SPEED', PLAYER_PHYSICS.WALK_MAX_SPEED, 2.0);
  assertEq(physMismatches, 'SPRINT_MAX_SPEED', PLAYER_PHYSICS.SPRINT_MAX_SPEED, 4.0);
  assertEq(physMismatches, 'OVERLOAD_WALK_SPEED', PLAYER_PHYSICS.OVERLOAD_WALK_SPEED, 3.0);
  assertEq(physMismatches, 'OVERLOAD_SPRINT_SPEED', PLAYER_PHYSICS.OVERLOAD_SPRINT_SPEED, 5.0);
  assertEq(physMismatches, 'OVERLOAD_DURATION_TICKS', PLAYER_PHYSICS.OVERLOAD_DURATION_TICKS, 400);
  assertEq(physMismatches, 'OVERLOAD_DAMAGE_MULT', PLAYER_PHYSICS.OVERLOAD_DAMAGE_MULT, 1.4);
  assertEq(physMismatches, 'JUMP_IMPULSE', PLAYER_PHYSICS.JUMP_IMPULSE, -5.25);
  assertEq(physMismatches, 'DOUBLE_JUMP_IMPULSE', PLAYER_PHYSICS.DOUBLE_JUMP_IMPULSE, -4.25);
  assertEq(physMismatches, 'GRAVITY', PLAYER_PHYSICS.GRAVITY, 0.25);
  assertEq(physMismatches, 'MAX_FALL_SPEED', PLAYER_PHYSICS.MAX_FALL_SPEED, 5.75);
  assertEq(physMismatches, 'COYOTE_TICKS', PLAYER_PHYSICS.COYOTE_TICKS, 4);
  assertEq(physMismatches, 'JUMP_BUFFER_TICKS', PLAYER_PHYSICS.JUMP_BUFFER_TICKS, 5);
  assertEq(physMismatches, 'HOOKSHOT.MAX_SPEED', HOOKSHOT_CONSTANTS.MAX_SPEED, 30.0);
  assertEq(physMismatches, 'HOOKSHOT.TIP_W', HOOKSHOT_CONSTANTS.TIP_W, 4);
  assertEq(physMismatches, 'HOOKSHOT.TIP_H', HOOKSHOT_CONSTANTS.TIP_H, 4);
  assertEq(physMismatches, 'STARTING_MAX_HP', PLAYER_PHYSICS.STARTING_MAX_HP, 16);
  assertEq(physMismatches, 'MAX_BOOSTED_HP', PLAYER_PHYSICS.MAX_BOOSTED_HP, 32);
  assertEq(physMismatches, 'STARTING_MAX_BURST', PLAYER_PHYSICS.STARTING_MAX_BURST, 2);
  assertEq(physMismatches, 'MAX_BOOSTED_BURST', PLAYER_PHYSICS.MAX_BOOSTED_BURST, 6);
  assertEq(physMismatches, 'BOSS.STANDARD_HP', BOSS_CONSTANTS.STANDARD_HP, 32);
  assertEq(physMismatches, 'BOSS.STANDARD_DESPERATION_HP', BOSS_CONSTANTS.STANDARD_DESPERATION_HP, 16);
  assertEq(physMismatches, 'BOSS.FINAL_HP', BOSS_CONSTANTS.FINAL_HP, 48);
  assertEq(physMismatches, 'BOSS.FINAL_DESPERATION_HP', BOSS_CONSTANTS.FINAL_DESPERATION_HP, 32);
  assertEq(physMismatches, 'BOSS.TECH_RECOVER_TICKS', BOSS_CONSTANTS.TECH_RECOVER_TICKS, 90);
  assertEq(physMismatches, 'BOSS.MINIBOSS_HP_NORMAL', BOSS_CONSTANTS.MINIBOSS_HP_NORMAL, 20);
  assertEq(physMismatches, 'BOSS.MINIBOSS_HP_RUDE', BOSS_CONSTANTS.MINIBOSS_HP_RUDE, 25);
  record(
    suite,
    'Player physics, hookshot & boss HP invariants',
    physMismatches.length === 0,
    physMismatches.length === 0 ? 'All 30 combat/physics/hookshot/boss constants match' : physMismatches.join('; '),
  );

  // 3C. CONTENT_COUNTS Contract Invariants
  const countConstMismatches: string[] = [];
  assertEq(countConstMismatches, 'OFFICIAL_MAPS', CONTENT_COUNTS.OFFICIAL_MAPS, 15);
  assertEq(countConstMismatches, 'REMIX_MAPS', CONTENT_COUNTS.REMIX_MAPS, 12);
  assertEq(countConstMismatches, 'TOTAL_LAYOUTS', CONTENT_COUNTS.TOTAL_LAYOUTS, 27);
  assertEq(countConstMismatches, 'BURST_TECHNIQUES', CONTENT_COUNTS.BURST_TECHNIQUES, 20);
  assertEq(countConstMismatches, 'BOOSTER_CHIPS', CONTENT_COUNTS.BOOSTER_CHIPS, 20);
  assertEq(countConstMismatches, 'ARMOR_PAINTS', CONTENT_COUNTS.ARMOR_PAINTS, 12);
  assertEq(countConstMismatches, 'BOSSES', CONTENT_COUNTS.BOSSES, 12);
  assertEq(countConstMismatches, 'MINIBOSSES', CONTENT_COUNTS.MINIBOSSES, 3);
  assertEq(countConstMismatches, 'ENEMY_ARCHETYPES', CONTENT_COUNTS.ENEMY_ARCHETYPES, 42);
  assertEq(countConstMismatches, 'RESCUES', CONTENT_COUNTS.RESCUES, 64);
  assertEq(countConstMismatches, 'CHALLENGES', CONTENT_COUNTS.CHALLENGES, 53);
  assertEq(countConstMismatches, 'DATACHIPS', CONTENT_COUNTS.DATACHIPS, 100);
  record(
    suite,
    'CONTENT_COUNTS contract constants',
    countConstMismatches.length === 0,
    countConstMismatches.length === 0 ? 'All 12 CONTENT_COUNTS constants match' : countConstMismatches.join('; '),
  );

  // 3D. Optional local oracle.json cross-check
  const oraclePath = path.join(ASSETS_DIR, 'oracle.json');
  if (!fs.existsSync(oraclePath)) {
    skip(
      suite,
      'oracle.json cross-check',
      'No .krunked-circuit-assets/oracle.json present (expected in CI / clean clones)',
    );
  } else {
    try {
      const oracle = JSON.parse(fs.readFileSync(oraclePath, 'utf8')) as OracleJson;
      const oracleMismatches: string[] = [];
      const cmp = (label: string, d: OracleDatum | undefined, contractVal: number): void => {
        if (!d || d.value === null || d.value === undefined) {
          oracleMismatches.push(`${label}:missing_in_oracle`);
          return;
        }
        if (Math.abs(d.value - contractVal) > 1e-9) {
          oracleMismatches.push(`${label}:oracle=${d.value},contract=${contractVal}`);
        }
      };

      cmp('engine.simHz', oracle.engine?.simHz, ENGINE_CONSTANTS.SIM_HZ);
      cmp('engine.gameWidth', oracle.engine?.gameWidth, ENGINE_CONSTANTS.GAME_WIDTH);
      cmp('engine.gameHeight', oracle.engine?.gameHeight, ENGINE_CONSTANTS.GAME_HEIGHT);
      cmp('engine.tileSize', oracle.engine?.tileSize, ENGINE_CONSTANTS.TILE_SIZE);
      cmp('engine.cellTilesW', oracle.engine?.cellTilesW, ENGINE_CONSTANTS.CELL_TILES_W);
      cmp('engine.cellTilesH', oracle.engine?.cellTilesH, ENGINE_CONSTANTS.CELL_TILES_H);
      cmp('engine.delayCameraTransition', oracle.engine?.delayCameraTransition, ENGINE_CONSTANTS.DELAY_CAMERA_TRANSITION);
      cmp('engine.jumpMargin', oracle.engine?.jumpMargin, ENGINE_CONSTANTS.CAMERA_JUMP_MARGIN);

      cmp('playerPhysics.standW', oracle.playerPhysics?.standW, PLAYER_PHYSICS.STAND_W);
      cmp('playerPhysics.standH', oracle.playerPhysics?.standH, PLAYER_PHYSICS.STAND_H);
      cmp('playerPhysics.slideW', oracle.playerPhysics?.slideW, PLAYER_PHYSICS.SLIDE_W);
      cmp('playerPhysics.slideH', oracle.playerPhysics?.slideH, PLAYER_PHYSICS.SLIDE_H);
      cmp('playerPhysics.walkMaxSpeed', oracle.playerPhysics?.walkMaxSpeed, PLAYER_PHYSICS.WALK_MAX_SPEED);
      cmp('playerPhysics.sprintMaxSpeed', oracle.playerPhysics?.sprintMaxSpeed, PLAYER_PHYSICS.SPRINT_MAX_SPEED);
      cmp('playerPhysics.jumpImpulse', oracle.playerPhysics?.jumpImpulse, PLAYER_PHYSICS.JUMP_IMPULSE);
      cmp('playerPhysics.gravity', oracle.playerPhysics?.gravity, PLAYER_PHYSICS.GRAVITY);
      cmp('playerPhysics.maxFallSpeed', oracle.playerPhysics?.maxFallSpeed, PLAYER_PHYSICS.MAX_FALL_SPEED);
      cmp('playerPhysics.coyoteTicks', oracle.playerPhysics?.coyoteTicks, PLAYER_PHYSICS.COYOTE_TICKS);
      cmp('playerPhysics.jumpBufferTicks', oracle.playerPhysics?.jumpBufferTicks, PLAYER_PHYSICS.JUMP_BUFFER_TICKS);
      cmp('playerPhysics.startingMaxHp', oracle.playerPhysics?.startingMaxHp, PLAYER_PHYSICS.STARTING_MAX_HP);
      cmp('playerPhysics.maxBoostedHp', oracle.playerPhysics?.maxBoostedHp, PLAYER_PHYSICS.MAX_BOOSTED_HP);
      cmp('playerPhysics.startingMaxBurst', oracle.playerPhysics?.startingMaxBurst, PLAYER_PHYSICS.STARTING_MAX_BURST);
      cmp('playerPhysics.maxBoostedBurst', oracle.playerPhysics?.maxBoostedBurst, PLAYER_PHYSICS.MAX_BOOSTED_BURST);

      cmp('hookshot.maxSpeed', oracle.hookshot?.maxSpeed, HOOKSHOT_CONSTANTS.MAX_SPEED);
      cmp('hookshot.tipW', oracle.hookshot?.tipW, HOOKSHOT_CONSTANTS.TIP_W);
      cmp('hookshot.tipH', oracle.hookshot?.tipH, HOOKSHOT_CONSTANTS.TIP_H);
      cmp('hookshot.timerMax', oracle.hookshot?.timerMax, HOOKSHOT_CONSTANTS.TIMER_MAX);
      cmp('hookshot.swingRopeMaxLen', oracle.hookshot?.swingRopeMaxLen, HOOKSHOT_CONSTANTS.SWING_ROPE_MAX_LEN);

      for (const diff of ['normal', 'easy', 'hard'] as const) {
        const ext = oracle.damageTables?.[diff];
        const con = DAMAGE_TABLES[diff];
        cmp(`damageTables.${diff}.lightContact`, ext?.lightContact, con.lightContact);
        cmp(`damageTables.${diff}.hazard`, ext?.hazard, con.hazard);
        cmp(`damageTables.${diff}.invulnMult`, ext?.invulnMult, con.invulnMult);
      }

      for (const [atkKey, extAtk] of Object.entries(oracle.attacks ?? {})) {
        const conAtk = ATTACK_DATA[atkKey as keyof typeof ATTACK_DATA];
        if (!conAtk) continue;
        cmp(`attacks.${atkKey}.damage`, extAtk.damage, conAtk.damage);
        cmp(`attacks.${atkKey}.width`, extAtk.width, conAtk.width);
        cmp(`attacks.${atkKey}.height`, extAtk.height, conAtk.height);
      }

      cmp('bosses.standardHp', oracle.bosses?.standardHp, BOSS_CONSTANTS.STANDARD_HP);
      cmp('bosses.finalHp', oracle.bosses?.finalHp, BOSS_CONSTANTS.FINAL_HP);
      cmp('bosses.techRecoverTicks', oracle.bosses?.techRecoverTicks, BOSS_CONSTANTS.TECH_RECOVER_TICKS);
      cmp('counts.officialMaps', oracle.counts?.officialMaps, CONTENT_COUNTS.OFFICIAL_MAPS);
      cmp('counts.remixMaps', oracle.counts?.remixMaps, CONTENT_COUNTS.REMIX_MAPS);
      cmp('counts.enemies', oracle.counts?.enemies, CONTENT_COUNTS.ENEMY_ARCHETYPES);
      cmp('counts.rescues', oracle.counts?.rescues, CONTENT_COUNTS.RESCUES);
      cmp('counts.challenges', oracle.counts?.challenges, CONTENT_COUNTS.CHALLENGES);
      cmp('counts.datachips', oracle.counts?.datachips, CONTENT_COUNTS.DATACHIPS);

      if (Array.isArray(oracle.discrepancies) && oracle.discrepancies.length > 0) {
        oracleMismatches.push(`oracle.discrepancies.length=${oracle.discrepancies.length}`);
      }

      record(
        suite,
        'oracle.json parity cross-check',
        oracleMismatches.length === 0,
        oracleMismatches.length === 0
          ? '0 discrepancies between oracle.json and src/contracts/index.ts'
          : oracleMismatches.slice(0, 10).join('; '),
      );
    } catch (err) {
      record(suite, 'oracle.json parity cross-check', false, `Parse error: ${String(err)}`);
    }
  }

  // 3E. Live Data Registry Counts
  record(
    suite,
    'Live BURST_DEFINITIONS count === 20',
    BURST_DEFINITIONS.length === CONTENT_COUNTS.BURST_TECHNIQUES,
    `actual=${BURST_DEFINITIONS.length}, expected=${CONTENT_COUNTS.BURST_TECHNIQUES}`,
  );
  record(
    suite,
    'Live CHIP_DEFINITIONS count === 20',
    CHIP_DEFINITIONS.length === CONTENT_COUNTS.BOOSTER_CHIPS,
    `actual=${CHIP_DEFINITIONS.length}, expected=${CONTENT_COUNTS.BOOSTER_CHIPS}`,
  );
  record(
    suite,
    'Live ARMOR_PAINT_DEFINITIONS count === 12',
    ARMOR_PAINT_DEFINITIONS.length === CONTENT_COUNTS.ARMOR_PAINTS &&
      ARMOR_PAINT_DEFINITIONS.every((a) => a.palette.length === 6),
    `actual=${ARMOR_PAINT_DEFINITIONS.length}, expected=${CONTENT_COUNTS.ARMOR_PAINTS}`,
  );
  record(
    suite,
    'Live BOSS_DEFINITIONS count === 12',
    BOSS_DEFINITIONS.length === CONTENT_COUNTS.BOSSES,
    `actual=${BOSS_DEFINITIONS.length}, expected=${CONTENT_COUNTS.BOSSES}`,
  );
  record(
    suite,
    'Live ENEMY_ARCHETYPES count === 42',
    ENEMY_ARCHETYPES.length === CONTENT_COUNTS.ENEMY_ARCHETYPES,
    `actual=${ENEMY_ARCHETYPES.length}, expected=${CONTENT_COUNTS.ENEMY_ARCHETYPES}`,
  );
  record(
    suite,
    'Live CHALLENGE_DEFINITIONS count === 53',
    CHALLENGE_DEFINITIONS.length === CONTENT_COUNTS.CHALLENGES,
    `actual=${CHALLENGE_DEFINITIONS.length}, expected=${CONTENT_COUNTS.CHALLENGES}`,
  );
  record(
    suite,
    'Live DATACHIP_DEFINITIONS count === 100',
    DATACHIP_DEFINITIONS.length === CONTENT_COUNTS.DATACHIPS,
    `actual=${DATACHIP_DEFINITIONS.length}, expected=${CONTENT_COUNTS.DATACHIPS}`,
  );

  // 3F. 15 Official Stages + 12 Distinct Remix Layouts = 27 Distinct Layouts
  const officialTileHashes = new Set<string>();
  const allLayoutHashes = new Set<string>();
  const stageLayoutErrors: string[] = [];
  const stageFingerprints = new Map<string, string>();

  const fingerprintStage = (stageId: (typeof OFFICIAL_STAGE_IDS)[number], remix: boolean): { tileHash: string; fullHash: string } => {
    const def = getStageDefinition(stageId, remix);
    if (def.tiles.length !== def.tilesW * def.tilesH || def.tiles.length === 0) {
      stageLayoutErrors.push(`${stageId}(remix=${remix}):bad_tile_dims`);
    }
    const tileHash = sha1Text(`${def.tilesW}x${def.tilesH}:${def.tiles.join(',')}`);
    const spawnSig = def.spawns
      .map((s) => `${s.kind}@${s.x},${s.y}:${s.archetypeId ?? s.bossId ?? s.minibossId ?? s.terminalKind ?? ''}`)
      .join('|');
    const fullHash = sha1Text(`${tileHash}#${spawnSig}`);
    return { tileHash, fullHash };
  };

  for (const stageId of OFFICIAL_STAGE_IDS) {
    const fp = fingerprintStage(stageId, false);
    officialTileHashes.add(fp.tileHash);
    allLayoutHashes.add(fp.fullHash);
    stageFingerprints.set(stageId, fp.fullHash);
  }

  let distinctRemixes = 0;
  for (const stageId of REMIXABLE_STAGES) {
    const def = getStageDefinition(stageId, true);
    const fp = fingerprintStage(stageId, true);
    const stdHash = stageFingerprints.get(stageId);
    if (def.remix && fp.fullHash !== stdHash) {
      distinctRemixes++;
    } else {
      stageLayoutErrors.push(`${stageId}:remix_not_distinct_from_standard`);
    }
    allLayoutHashes.add(fp.fullHash);
  }

  record(
    suite,
    '15 distinct official stages + 12 distinct remix layouts (27 total)',
    stageLayoutErrors.length === 0 &&
      officialTileHashes.size === CONTENT_COUNTS.OFFICIAL_MAPS &&
      distinctRemixes === CONTENT_COUNTS.REMIX_MAPS &&
      allLayoutHashes.size === CONTENT_COUNTS.TOTAL_LAYOUTS,
    `uniqueOfficialTilemaps=${officialTileHashes.size}/15, distinctRemixes=${distinctRemixes}/12, totalDistinctLayouts=${allLayoutHashes.size}/27` +
      (stageLayoutErrors.length > 0 ? ` [${stageLayoutErrors.slice(0, 6).join(', ')}]` : ''),
  );

  // 3G. 64 Rescues across MAIN_EIGHT_STAGES (8 per main stage)
  let totalRescues = 0;
  const rescueIssues: string[] = [];
  const seenRescueIds = new Set<string>();
  const mainStageTileHashes = new Set<string>();

  for (const stageId of MAIN_EIGHT_STAGES) {
    const def = getStageDefinition(stageId, false);
    mainStageTileHashes.add(sha1Text(`${def.tilesW}x${def.tilesH}:${def.tiles.join(',')}`));
    const rescues = def.spawns.filter((s) => s.kind === 'rescue');
    totalRescues += rescues.length;
    if (rescues.length !== 8) {
      rescueIssues.push(`${stageId}:${rescues.length}/8`);
    }
    for (const r of rescues) {
      if (seenRescueIds.has(r.id)) {
        rescueIssues.push(`dup_id:${r.id}`);
      }
      seenRescueIds.add(r.id);
    }
  }
  if (mainStageTileHashes.size !== MAIN_EIGHT_STAGES.length) {
    rescueIssues.push(`distinctMainStageMaps=${mainStageTileHashes.size}/8`);
  }
  record(
    suite,
    '64 Rescues across MAIN_EIGHT_STAGES (8 per distinct main stage)',
    totalRescues === CONTENT_COUNTS.RESCUES && rescueIssues.length === 0,
    `totalRescues=${totalRescues}/64, uniqueIds=${seenRescueIds.size}, distinctMainMaps=${mainStageTileHashes.size}/8` +
      (rescueIssues.length > 0 ? ` issues=[${rescueIssues.join(', ')}]` : ''),
  );
}

// ============================================================================
// SUITE 4: TASTE_NOTES Contract Audit
// ============================================================================

function runSuite4TasteNotes(): void {
  const suite = '4. TASTE_NOTES Audit';

  // 4A. GAMEPAD_CONSTANTS exact thresholds & opacities
  const constsOk =
    GAMEPAD_CONSTANTS.STICK_DEADZONE === 0.22 &&
    GAMEPAD_CONSTANTS.TRIGGER_THRESHOLD === 0.35 &&
    GAMEPAD_CONSTANTS.TOUCH_IDLE_OPACITY === 0.32 &&
    GAMEPAD_CONSTANTS.TOUCH_ACTIVE_OPACITY === 0.62;
  record(
    suite,
    'GAMEPAD_CONSTANTS thresholds & touch opacities',
    constsOk,
    `deadzone=${GAMEPAD_CONSTANTS.STICK_DEADZONE}, trigger=${GAMEPAD_CONSTANTS.TRIGGER_THRESHOLD}, idleOpacity=${GAMEPAD_CONSTANTS.TOUCH_IDLE_OPACITY}, activeOpacity=${GAMEPAD_CONSTANTS.TOUCH_ACTIVE_OPACITY}`,
  );

  // 4B. TouchOverlay strictly hidden by default
  const touch = new TouchOverlay(null);
  const initialTouchState = touch.getState();
  const touchHiddenByDefault =
    initialTouchState.visible === false &&
    touch.isVisible() === false &&
    initialTouchState.opacityIdle === 0.32 &&
    initialTouchState.opacityActive === 0.62;
  touch.setVisible(true);
  const revealedOk = touch.getState().visible === true;
  touch.setVisible(false);
  const hiddenAgainOk = touch.getState().visible === false;
  touch.dispose();
  record(
    suite,
    'TouchOverlay default hidden & visibility transitions',
    touchHiddenByDefault && revealedOk && hiddenAgainOk,
    `initialVisible=${initialTouchState.visible}, revealed=${revealedOk}, reHidden=${hiddenAgainOk}`,
  );

  // 4C. GamepadAdapter 'default' and 'shoulder_hook' presets + deadzone/trigger thresholds
  const gp = new GamepadAdapter({ preset: 'default' });
  const emptyBtns = (): number[] => new Array<number>(16).fill(0);

  // Deadzone test (< 0.22 ignored, >= 0.22 active)
  gp.setSimulatedGamepad({ id: 'TestPad', connected: true, axes: [0.18, 0, 0, 0], buttons: emptyBtns() });
  const deadzoneBelow = gp.poll();
  gp.setSimulatedGamepad({ id: 'TestPad', connected: true, axes: [0.65, 0, 0, 0], buttons: emptyBtns() });
  const deadzoneAbove = gp.poll();

  // Trigger threshold & 'default' preset test (RT=btn7 -> hookshot, LT=btn6 -> sprint, LB=btn4 -> swapLoadout, B=btn1 -> slide)
  const btnsBelowTrig = emptyBtns();
  btnsBelowTrig[7] = 0.25;
  gp.setSimulatedGamepad({ id: 'TestPad', connected: true, axes: [0, 0, 0, 0], buttons: btnsBelowTrig });
  const trigBelow = gp.poll();

  const btnsDefault = emptyBtns();
  btnsDefault[7] = 0.5; // RT -> hookshot
  btnsDefault[6] = 0.5; // LT -> sprint
  btnsDefault[4] = 1; // LB -> swapLoadout
  btnsDefault[1] = 1; // B -> slide
  gp.setSimulatedGamepad({ id: 'TestPad', connected: true, axes: [0, 0, 0, 0], buttons: btnsDefault });
  const defaultPoll = gp.poll();

  // 'shoulder_hook' preset test (RB=btn5 -> hookshot, LB=btn4 -> sprint, LT=btn6 -> slide, RT=btn7 -> swapLoadout)
  gp.setPreset('shoulder_hook');
  const btnsShoulder = emptyBtns();
  btnsShoulder[5] = 1; // RB -> hookshot
  btnsShoulder[4] = 1; // LB -> sprint
  btnsShoulder[6] = 0.5; // LT -> slide
  btnsShoulder[7] = 0.5; // RT -> swapLoadout
  gp.setSimulatedGamepad({ id: 'TestPad', connected: true, axes: [0, 0, 0, 0], buttons: btnsShoulder });
  const shoulderPoll = gp.poll();
  gp.dispose();

  const gpOk =
    gp.getDeadzone() === 0.22 &&
    gp.getTriggerThreshold() === 0.35 &&
    deadzoneBelow.moveX === 0 &&
    !deadzoneBelow.active &&
    deadzoneAbove.moveX === 1 &&
    deadzoneAbove.active &&
    !trigBelow.hookshot &&
    defaultPoll.hookshot &&
    defaultPoll.sprint &&
    defaultPoll.swapLoadout &&
    defaultPoll.slide &&
    gp.getPreset() === 'shoulder_hook' &&
    shoulderPoll.hookshot &&
    shoulderPoll.sprint &&
    shoulderPoll.slide &&
    shoulderPoll.swapLoadout;

  record(
    suite,
    'GamepadAdapter deadzone, trigger threshold & both presets',
    gpOk,
    `deadzone(0.18->${deadzoneBelow.moveX}, 0.65->${deadzoneAbove.moveX}), trig(0.25->${trigBelow.hookshot}), defaultHook=${defaultPoll.hookshot}, shoulderHook=${shoulderPoll.hookshot}`,
  );

  // 4D. styles.css (.touch-hidden opacity:0 & pointer-events:none, image-rendering:pixelated) + index.html
  const cssPath = path.join(REPO_ROOT, 'src', 'ui', 'styles.css');
  const htmlPath = path.join(REPO_ROOT, 'index.html');
  const css = fs.readFileSync(cssPath, 'utf8');
  const html = fs.readFileSync(htmlPath, 'utf8');

  const touchHiddenBlock = css.match(/\.touch-hidden\s*\{([\s\S]*?)\}/);
  const blockBody = touchHiddenBlock ? touchHiddenBlock[1] : '';
  const hasOpacityZero = /opacity\s*:\s*0(?:\s*!important)?\s*;/.test(blockBody);
  const hasPointerNone = /pointer-events\s*:\s*none(?:\s*!important)?\s*;/.test(blockBody);
  const hasPixelated = /image-rendering\s*:\s*pixelated\s*;/.test(css);
  const htmlHasTouchHidden = /id=["']touch-layer["'][^>]*class=["'][^"']*touch-hidden/.test(html);

  record(
    suite,
    'styles.css .touch-hidden, image-rendering: pixelated & index.html',
    hasOpacityZero && hasPointerNone && hasPixelated && htmlHasTouchHidden,
    `touchHiddenOpacity0=${hasOpacityZero}, pointerEventsNone=${hasPointerNone}, pixelated=${hasPixelated}, htmlTouchHidden=${htmlHasTouchHidden}`,
  );
}

// ============================================================================
// SUITE 5: IP & Binary Hygiene Audit
// ============================================================================

const FORBIDDEN_BINARY_EXTS = new Set(['.exe', '.gcl', '.ogg', '.wav']);

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function runSuite5IpHygiene(): void {
  const suite = '5. IP & Binary Hygiene';

  // 5A. git ls-files checks
  let trackedFiles: string[] = [];
  try {
    const raw = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' });
    trackedFiles = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch (err) {
    record(suite, 'git ls-files audit', false, `git ls-files failed: ${String(err)}`);
    return;
  }

  const badTrackedBinaries = trackedFiles.filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return FORBIDDEN_BINARY_EXTS.has(ext) || f.startsWith('.krunked-circuit-assets/');
  });
  record(
    suite,
    'Zero retail binaries (.exe/.gcl/.ogg/.wav) tracked in git',
    badTrackedBinaries.length === 0,
    badTrackedBinaries.length === 0
      ? `Scanned ${trackedFiles.length} tracked files: 0 retail binaries`
      : `FORBIDDEN: [${badTrackedBinaries.join(', ')}]`,
  );

  const badTrackedDocs = trackedFiles.filter((f) => f.toLowerCase().endsWith('.md') && f !== 'README.md');
  record(
    suite,
    'Zero local markdown docs except README.md tracked in git',
    badTrackedDocs.length === 0,
    badTrackedDocs.length === 0
      ? 'Only README.md tracked among markdown files'
      : `FORBIDDEN_MD: [${badTrackedDocs.join(', ')}]`,
  );

  // 5B. dist/ bundle binary audit (if present)
  const distDir = path.join(REPO_ROOT, 'dist');
  if (!fs.existsSync(distDir)) {
    skip(suite, 'dist/ retail binary audit', 'dist/ not built yet (skipped)');
  } else {
    const distFiles = walkFiles(distDir);
    const badDist = distFiles
      .filter((f) => FORBIDDEN_BINARY_EXTS.has(path.extname(f).toLowerCase()))
      .map((f) => path.relative(REPO_ROOT, f));
    record(
      suite,
      'Zero retail binaries bundled in dist/',
      badDist.length === 0,
      badDist.length === 0
        ? `Scanned ${distFiles.length} dist files: 0 retail binaries`
        : `FORBIDDEN_DIST: [${badDist.join(', ')}]`,
    );
  }

  // 5C. Zero leaked original retail proper nouns in README.md, index.html, src/data/*, src/ui/*, src/assets/*
  const scanTargets: string[] = [
    path.join(REPO_ROOT, 'README.md'),
    path.join(REPO_ROOT, 'index.html'),
    ...walkFiles(path.join(REPO_ROOT, 'src', 'data')),
    ...walkFiles(path.join(REPO_ROOT, 'src', 'ui')),
    ...walkFiles(path.join(REPO_ROOT, 'src', 'assets')),
  ].filter((p) => fs.existsSync(p));

  const forbiddenPatterns: ReadonlyArray<{ label: string; regex: RegExp }> = [
    { label: 'Gravity Circuit', regex: /\bgravity\s+circuit\b/i },
    { label: 'Domesticated Ant', regex: /\bdomesticated\s+ant\b/i },
    { label: 'PID Games', regex: /\bpid\s+games\b/i },
    { label: 'Medley', regex: /\bmedley\b/i },
    { label: 'Nega', regex: /\bnega\b/i },
    { label: 'Cable', regex: /\bCable\b/ },
    { label: 'Trace', regex: /\bTrace\b/ },
    { label: 'Kai', regex: /\bkai\b/i },
  ];

  const ipLeaks: string[] = [];
  for (const filePath of scanTargets) {
    const rel = path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pat of forbiddenPatterns) {
        if (pat.regex.test(line)) {
          ipLeaks.push(`${rel}:${i + 1} (${pat.label})`);
        }
      }
    }
  }

  record(
    suite,
    'Zero leaked original retail proper nouns in public/game sources',
    ipLeaks.length === 0,
    ipLeaks.length === 0
      ? `Scanned ${scanTargets.length} files across README, index.html, src/data, src/ui, src/assets: 0 leaks`
      : `LEAKS: [${ipLeaks.slice(0, 12).join(', ')}]`,
  );
}

// ============================================================================
// Main Entrypoint & Reporting
// ============================================================================

async function main(): Promise<void> {
  console.log('============================================================================');
  console.log(' Krunked Circuit — Gate A Verification (Asset, Oracle, TASTE_NOTES & IP)');
  console.log('============================================================================');

  await runSuite1BuiltInAssets();
  runSuite2CustomPack();
  runSuite3OracleParity();
  runSuite4TasteNotes();
  runSuite5IpHygiene();

  let currentSuite = '';
  let passCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (const r of results) {
    if (r.suite !== currentSuite) {
      currentSuite = r.suite;
      console.log(`\n[${currentSuite}]`);
    }
    const tag = r.status === 'PASS' ? 'PASS' : r.status === 'SKIP' ? 'SKIP' : 'FAIL';
    console.log(`  ${tag.padEnd(4)} | ${r.name}`);
    console.log(`       | ${r.detail}`);
    if (r.status === 'PASS') passCount++;
    else if (r.status === 'SKIP') skipCount++;
    else failCount++;
  }

  console.log('\n----------------------------------------------------------------------------');
  console.log(`Gate A Summary: ${passCount} PASS, ${failCount} FAIL, ${skipCount} SKIP (${results.length} checks)`);
  console.log('----------------------------------------------------------------------------');

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[verify-assets] Unhandled verification error:', err);
  process.exitCode = 1;
});
