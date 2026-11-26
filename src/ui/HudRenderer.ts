// ============================================================================
// Krunked Circuit — Crisp 400x240 In-Canvas Pixel HUD Renderer
// Renders segmented Player HP, Burst Energy & Charges, Boss Dual/Triple HP Bar,
// Desperation Flash Banner, Boss Intro Splash Card, Bits & Rescues, Loadout
// Badge, Speedrun Timer, Hub Interaction Prompt, and Dynamic Input Modality
// Glyph Badge using an embedded 5x7 run-length-encoded pixel bitmap font.
// Works identically in WebGL2Renderer AND Canvas2DFallback with ZERO textures.
// ============================================================================

import {
  BOSS_CONSTANTS,
  ENGINE_CONSTANTS,
  PLAYER_PHYSICS,
  type HubTerminalKind,
  type InputModality,
  type Palette6,
  type RenderSettings,
  type SimState,
} from '../contracts/index';

export interface HudDrawTarget {
  fillRect(x: number, y: number, w: number, h: number, hexColor: string, alpha?: number): void;
}

export interface HudRenderContext {
  readonly state: SimState;
  readonly settings: RenderSettings;
  readonly activePalette: Palette6;
  readonly activeModality: InputModality;
  readonly fps?: number;
  readonly bossIntroTitle?: string;
}

const W = ENGINE_CONSTANTS.GAME_WIDTH;
const H = ENGINE_CONSTANTS.GAME_HEIGHT;

// Compact 5x7 uppercase + digits + punctuation pixel bitmap font (each entry = 7 rows of 5 bits)
const FONT_5X7: Record<string, readonly number[]> = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
  '3': [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b01110, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110],
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11100, 0b10010, 0b10001, 0b10001, 0b10001, 0b10010, 0b11100],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b10010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  ':': [0b00000, 0b00100, 0b00100, 0b00000, 0b00100, 0b00100, 0b00000],
  '.': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00100, 0b00100],
  '/': [0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000],
  '-': [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000],
  '+': [0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000],
  '!': [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00000, 0b00100],
  '[': [0b01110, 0b01000, 0b01000, 0b01000, 0b01000, 0b01000, 0b01110],
  ']': [0b01110, 0b00010, 0b00010, 0b00010, 0b00010, 0b00010, 0b01110],
  '(': [0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010],
  ')': [0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000],
  '_': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b11111],
  '%': [0b11001, 0b11010, 0b00010, 0b00100, 0b01000, 0b01011, 0b10011],
};

const TERMINAL_LABELS: Record<HubTerminalKind, string> = {
  mission_select: 'MISSION SELECT',
  medbay_chips: 'MEDBAY CHIPS',
  burst_dojo: 'BURST DOJO',
  paint_bay: 'PAINT BAY',
  training_room: 'TRAINING ROOM',
  compendium: 'COMPENDIUM',
  challenges: 'CHALLENGES',
  refight_terminal: 'REFIGHT ARENA',
};

export function measurePixelText(text: string, scale = 1): number {
  if (text.length === 0) return 0;
  return text.length * 6 * scale - scale;
}

/**
 * Draws crisp run-length-batched 5x7 pixel text with optional 1px drop shadow.
 */
export function drawPixelText(
  target: HudDrawTarget,
  text: string,
  x: number,
  y: number,
  color: string,
  scale = 1,
  shadowColor: string | null = '#090c14',
): void {
  const upper = text.toUpperCase();
  const xi = Math.round(x);
  const yi = Math.round(y);

  for (let pass = shadowColor ? 0 : 1; pass < 2; pass++) {
    const ox = pass === 0 ? xi + scale : xi;
    const oy = pass === 0 ? yi + scale : yi;
    const col = pass === 0 ? (shadowColor as string) : color;

    let cursorX = ox;
    for (let i = 0; i < upper.length; i++) {
      const glyph = FONT_5X7[upper[i]] ?? FONT_5X7[' '];
      for (let row = 0; row < 7; row++) {
        const bits = glyph[row];
        if (bits === 0) continue;
        // Run-length coalesce contiguous horizontal pixels per row
        let colBit = 4;
        while (colBit >= 0) {
          if (((bits >> colBit) & 1) === 0) {
            colBit--;
            continue;
          }
          const startCol = 4 - colBit;
          let runLen = 0;
          while (colBit >= 0 && ((bits >> colBit) & 1) === 1) {
            runLen++;
            colBit--;
          }
          target.fillRect(
            cursorX + startCol * scale,
            oy + row * scale,
            runLen * scale,
            scale,
            col,
            1,
          );
        }
      }
      cursorX += 6 * scale;
    }
  }
}

export function formatSpeedrunTicks(ticks: number): string {
  const totalCs = Math.floor((Math.max(0, ticks) / ENGINE_CONSTANTS.SIM_HZ) * 100);
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60);
  const mm = min < 10 ? `0${min}` : `${min}`;
  const ss = sec < 10 ? `0${sec}` : `${sec}`;
  const cc = cs < 10 ? `0${cs}` : `${cs}`;
  return `${mm}:${ss}.${cc}`;
}

export class HudRenderer {
  private bossIntroTimer = 0;
  private bossIntroName = '';
  private bossIntroTitle = '';

  public triggerBossIntro(name: string, title: string): void {
    this.bossIntroName = name;
    this.bossIntroTitle = title;
    this.bossIntroTimer = 96;
  }

  public render(target: HudDrawTarget, ctx: HudRenderContext): void {
    const { state, settings, activePalette, activeModality, fps } = ctx;

    // Hide gameplay HUD on pure title screen so title presentation stays clean
    if (state.screen === 'title' || state.screen === 'file_select') {
      return;
    }

    if (this.bossIntroTimer > 0) {
      this.bossIntroTimer--;
    }

    this.drawPlayerVitals(target, state, activePalette);
    this.drawEconomyAndLoadout(target, state, activePalette, activeModality, fps);

    if (
      settings.showSpeedrunTimer ||
      state.progression.mode === 'speedrun' ||
      state.bossRush.active
    ) {
      this.drawSpeedrunTimer(target, state);
    }

    if (state.player.comboCount >= 2 && state.player.comboTimer > 0) {
      this.drawComboBadge(target, state);
    }

    if (state.player.hook.phase === 'holding') {
      this.drawHoldingHint(target, activeModality);
    }

    if (state.stageId === 'hub') {
      this.drawHubPrompt(target, state, activeModality);
    }

    if (state.boss && state.boss.active && !state.boss.defeated) {
      this.drawBossHud(target, state, ctx.bossIntroTitle);
    }
  }

  private drawPlayerVitals(
    target: HudDrawTarget,
    state: SimState,
    activePalette: Palette6,
  ): void {
    const { player } = state;
    const maxHp = Math.max(1, player.maxHp);
    const hp = Math.max(0, Math.min(maxHp, Math.ceil(player.hp)));
    const lowHp = hp / maxHp <= 0.25;
    const overload = player.overloadTimer > 0;

    // Frame behind portrait emblem + HP & Burst bars
    const segments = Math.min(maxHp, PLAYER_PHYSICS.MAX_BOOSTED_HP);
    const segPerRow = 16;
    const rows = segments > segPerRow ? 2 : 1;
    const barInnerW = Math.min(segments, segPerRow) * 4 + 2;
    const panelW = 20 + barInnerW + 6;
    const panelH = rows === 2 ? 29 : 23;

    // Dark translucent pixel panel
    target.fillRect(6, 6, panelW, panelH, '#090d18', 0.9);
    const borderColor = overload
      ? '#ffd166'
      : lowHp && (state.tick & 8) !== 0
        ? '#ff3b5c'
        : '#5584c4';
    this.drawBorder(target, 6, 6, panelW, panelH, borderColor);

    // Mini Volt armor emblem swatch (12x12)
    target.fillRect(9, 9, 12, 12, activePalette[0], 1);
    target.fillRect(10, 10, 10, 10, activePalette[2], 1);
    target.fillRect(10, 10, 10, 3, activePalette[3], 1);
    target.fillRect(12, 14, 6, 3, activePalette[5], 1); // visor
    target.fillRect(10, 18, 10, 2, activePalette[4], 1); // scarf accent

    // Segmented Player HP bar
    const hpX = 24;
    const hpY = 9;
    for (let i = 0; i < segments; i++) {
      const row = Math.floor(i / segPerRow);
      const col = i % segPerRow;
      const sx = hpX + col * 4;
      const sy = hpY + row * 6;
      target.fillRect(sx, sy, 3, 5, '#182032', 1);
      if (i < hp) {
        const fill = lowHp
          ? (state.tick & 4) !== 0
            ? '#ff4d6d'
            : '#ff8fa3'
          : overload
            ? '#ffd166'
            : '#38e89e';
        const hi = lowHp ? '#ffd6de' : overload ? '#fff6cc' : '#b8ffdf';
        target.fillRect(sx, sy, 3, 5, fill, 1);
        target.fillRect(sx, sy, 3, 1, hi, 1);
      }
    }

    // Barrier shield pips right beside HP if active
    if (player.barrierHits > 0) {
      const bx = 6 + panelW + 3;
      for (let i = 0; i < Math.min(player.barrierHits, 4); i++) {
        target.fillRect(bx + i * 6, 9, 5, 5, '#4ee7ff', 1);
        target.fillRect(bx + i * 6 + 1, 10, 3, 3, '#e0fbff', 1);
      }
    }

    // Burst Energy Meter + Charge Pips
    const burstY = hpY + rows * 6 + 2;
    const maxCharges = Math.max(1, player.maxBurstCharges);
    const fullCharges = Math.floor(player.burstEnergy / PLAYER_PHYSICS.BURST_ENERGY_PER_CHARGE);
    const partialRatio =
      (player.burstEnergy % PLAYER_PHYSICS.BURST_ENERGY_PER_CHARGE) /
      PLAYER_PHYSICS.BURST_ENERGY_PER_CHARGE;

    const pipW = 9;
    for (let i = 0; i < maxCharges; i++) {
      const px = hpX + i * (pipW + 2);
      target.fillRect(px, burstY, pipW, 4, '#141d30', 1);
      if (i < fullCharges) {
        const pulse = (state.tick & 8) !== 0 ? '#5ce1ff' : '#94f0ff';
        target.fillRect(px, burstY, pipW, 4, pulse, 1);
        target.fillRect(px, burstY, pipW, 1, '#ffffff', 0.85);
      } else if (i === fullCharges && partialRatio > 0) {
        const fillW = Math.max(1, Math.floor(pipW * partialRatio));
        target.fillRect(px, burstY, fillW, 4, '#2980b9', 1);
      }
    }
  }

  private drawEconomyAndLoadout(
    target: HudDrawTarget,
    state: SimState,
    activePalette: Palette6,
    activeModality: InputModality,
    fps?: number,
  ): void {
    const loadoutIdx = state.progression.activeLoadoutIndex + 1;
    const bits = state.progression.bits;
    const rescues =
      state.stageId === 'hub'
        ? state.progression.totalRescues
        : state.stageStats.rescuesCollected;

    // Top-right compact status block: Bits, Rescues, Loadout [1/3], Input Glyph Badge
    const rightX = W - 6;

    // Row 1: Dynamic Modality Glyph Badge
    const modalityLabel =
      activeModality === 'gamepad'
        ? 'PAD A/X/RT'
        : activeModality === 'touch'
          ? 'TOUCH'
          : 'KB Z/X/C';
    const fpsStr = fps !== undefined && fps > 0 ? ` ${Math.round(fps)}F` : '';
    const badgeText = `${modalityLabel}${fpsStr}`;
    const badgeW = measurePixelText(badgeText) + 8;
    const badgeX = rightX - badgeW;

    target.fillRect(badgeX, 6, badgeW, 11, '#090d18', 0.82);
    const modColor =
      activeModality === 'gamepad'
        ? '#4dffb5'
        : activeModality === 'touch'
          ? '#ffd166'
          : '#5ce1ff';
    this.drawBorder(target, badgeX, 6, badgeW, 11, modColor);
    drawPixelText(target, badgeText, badgeX + 4, 8, modColor, 1, '#090c14');

    // Row 2: Bits + Rescues + Loadout [1/3]
    const loadoutText = `[${loadoutIdx}/3]`;
    const rescueText = state.stageId === 'hub' ? `R:${rescues}` : `R:${rescues}/8`;
    const bitsText = `B:${bits}`;

    const infoStr = `${bitsText} ${rescueText} ${loadoutText}`;
    const infoW = measurePixelText(infoStr) + 20;
    const infoX = rightX - infoW;

    target.fillRect(infoX, 19, infoW, 11, '#090d18', 0.88);
    this.drawBorder(target, infoX, 19, infoW, 11, '#4b74b2');

    // Gold bit diamond icon
    target.fillRect(infoX + 4, 22, 3, 5, '#ffd166', 1);
    target.fillRect(infoX + 3, 23, 5, 3, '#ffd166', 1);
    target.fillRect(infoX + 4, 23, 1, 1, '#ffffff', 1);

    // Loadout armor swatch dot (spaced cleanly after [1/3])
    target.fillRect(infoX + infoW - 5, 22, 2, 5, activePalette[4], 1);

    drawPixelText(target, infoStr, infoX + 10, 21, '#eef5ff', 1, '#090c14');
  }

  private drawSpeedrunTimer(target: HudDrawTarget, state: SimState): void {
    const ticks = state.bossRush.active
      ? state.bossRush.totalTicks
      : state.stageStats.elapsedTicks;
    const text = formatSpeedrunTicks(ticks);
    const tw = measurePixelText(text) + 10;
    const x = Math.floor((W - tw) / 2);
    target.fillRect(x, 6, tw, 11, '#090d18', 0.84);
    this.drawBorder(target, x, 6, tw, 11, '#ffd166');
    drawPixelText(target, text, x + 5, 8, '#fff4b8', 1, '#090c14');
  }

  private drawComboBadge(target: HudDrawTarget, state: SimState): void {
    const text = `${state.player.comboCount} HIT`;
    const tw = measurePixelText(text) + 8;
    target.fillRect(6, 38, tw, 11, '#180c1f', 0.85);
    this.drawBorder(target, 6, 38, tw, 11, '#ff4d94');
    drawPixelText(target, text, 10, 40, '#ff99c8', 1, '#090c14');
  }

  private drawHoldingHint(target: HudDrawTarget, modality: InputModality): void {
    const keyHint =
      modality === 'gamepad' ? 'RT/X THROW' : modality === 'touch' ? 'HOOK/ATK THROW' : 'C/X THROW';
    const text = `HOLDING // ${keyHint}`;
    const tw = measurePixelText(text) + 10;
    const x = Math.floor((W - tw) / 2);
    const y = H - 20;
    target.fillRect(x, y, tw, 11, '#09121e', 0.86);
    this.drawBorder(target, x, y, tw, 11, '#5ce1ff');
    drawPixelText(target, text, x + 5, y + 2, '#9cf0ff', 1, '#090c14');
  }

  private drawHubPrompt(
    target: HudDrawTarget,
    state: SimState,
    modality: InputModality,
  ): void {
    const px = state.player.x + state.player.w * 0.5;
    const py = state.player.y + state.player.h * 0.5;
    let nearestName: string | null = null;
    let bestDist = 34;

    for (let i = 0; i < state.props.length; i++) {
      const prop = state.props[i];
      if (prop.kind !== 'hub_terminal' || !prop.terminalKind) continue;
      const cx = prop.x + prop.w * 0.5;
      const cy = prop.y + prop.h * 0.5;
      const d = Math.hypot(px - cx, py - cy);
      if (d < bestDist) {
        bestDist = d;
        nearestName = TERMINAL_LABELS[prop.terminalKind] ?? prop.terminalKind.toUpperCase();
      }
    }

    if (!nearestName) return;

    const verb = modality === 'gamepad' ? '[UP/A]' : modality === 'touch' ? '[JUMP]' : '[UP/Z]';
    const prompt = `${verb} ${nearestName}`;
    const tw = measurePixelText(prompt) + 12;
    const x = Math.floor((W - tw) / 2);
    const y = H - 22;

    target.fillRect(x, y, tw, 13, '#09101f', 0.9);
    this.drawBorder(target, x, y, tw, 13, '#4dffb5');
    drawPixelText(target, prompt, x + 6, y + 3, '#e8fff5', 1, '#090c14');
  }

  private drawBossHud(
    target: HudDrawTarget,
    state: SimState,
    externalTitle?: string,
  ): void {
    const boss = state.boss;
    if (!boss) return;

    const segSize = BOSS_CONSTANTS.HP_BAR_SEGMENT; // 16
    const maxHp = Math.max(1, boss.maxHp);
    const hp = Math.max(0, Math.min(maxHp, Math.ceil(boss.hp)));
    const barW = 160;
    const barH = 8;
    const x = Math.floor((W - barW) / 2);
    const y = H - 18;

    // Frame + Boss Nameplate
    target.fillRect(x - 4, y - 12, barW + 8, 24, '#0b0914', 0.86);
    const frameCol = boss.desperationTriggered ? '#ff3b5c' : '#9c4dff';
    this.drawBorder(target, x - 4, y - 12, barW + 8, 24, frameCol);

    drawPixelText(target, boss.name, x, y - 10, '#fff2f6', 1, '#090c14');

    // Segment indicator dots (dual / triple bar layers)
    const totalLayers = Math.max(1, Math.ceil(maxHp / segSize));
    const currentLayer = Math.max(0, Math.ceil(hp / segSize) - 1);
    for (let l = 0; l < totalLayers; l++) {
      const dotX = x + barW - (totalLayers - l) * 6;
      const filled = hp > l * segSize;
      const dotCol = l === 0 ? '#ff3b5c' : l === 1 ? '#ffb703' : '#c77dff';
      target.fillRect(dotX, y - 9, 4, 4, filled ? dotCol : '#241b2f', 1);
    }

    // Stacked multi-segment Boss HP bar
    target.fillRect(x, y, barW, barH, '#1d1326', 1);

    const layerColors = ['#ff3b5c', '#ffb703', '#c77dff'] as const;
    const layerHi = ['#ff9ebb', '#ffe599', '#edd4ff'] as const;

    if (hp > 0) {
      // Draw underlying full bar if above layer 0
      if (currentLayer > 0) {
        const underCol = layerColors[Math.min(currentLayer - 1, layerColors.length - 1)];
        target.fillRect(x, y, barW, barH, underCol, 1);
      }
      const inLayerHp = hp - currentLayer * segSize;
      const layerCap = Math.min(segSize, maxHp - currentLayer * segSize);
      const fillW = Math.round((inLayerHp / Math.max(1, layerCap)) * barW);
      const topCol = layerColors[Math.min(currentLayer, layerColors.length - 1)];
      const hiCol = layerHi[Math.min(currentLayer, layerHi.length - 1)];

      target.fillRect(x, y, fillW, barH, topCol, 1);
      target.fillRect(x, y, fillW, 2, hiCol, 0.85);
    }

    // Crisp vertical tick dividers across the 16-HP segment
    for (let t = 1; t < 16; t++) {
      const tx = x + Math.floor((t * barW) / 16);
      target.fillRect(tx, y + 5, 1, 3, '#0b0914', 0.45);
    }

    // Desperation Flash Banner
    if (boss.desperationBannerTicks > 0) {
      const flashOn = (state.tick & 4) !== 0;
      const bannerY = 44;
      target.fillRect(0, bannerY, W, 22, '#22060d', 0.88);
      target.fillRect(0, bannerY, W, 2, flashOn ? '#ff3b5c' : '#ffd166', 1);
      target.fillRect(0, bannerY + 20, W, 2, flashOn ? '#ff3b5c' : '#ffd166', 1);
      const alert = '!! OVERDRIVE DESPERATION !!';
      const aw = measurePixelText(alert, 1);
      drawPixelText(
        target,
        alert,
        Math.floor((W - aw) / 2),
        bannerY + 7,
        flashOn ? '#fff2b2' : '#ff5c7c',
        1,
        '#140207',
      );
    }

    // Boss Intro Splash Card
    if (boss.aiState === 'intro' || this.bossIntroTimer > 0) {
      const name = this.bossIntroName || boss.name;
      const title = this.bossIntroTitle || externalTitle || 'CIRCUIT MASTER';
      const cardY = 82;
      target.fillRect(0, cardY, W, 56, '#080b16', 0.9);
      target.fillRect(0, cardY, W, 2, '#ff3b5c', 1);
      target.fillRect(0, cardY + 54, W, 2, '#5ce1ff', 1);

      const warnText = 'WARNING // HOSTILE SIGNAL';
      drawPixelText(
        target,
        warnText,
        Math.floor((W - measurePixelText(warnText)) / 2),
        cardY + 7,
        '#ff5c7c',
        1,
        '#05060c',
      );

      const nameW = measurePixelText(name, 2);
      drawPixelText(
        target,
        name,
        Math.floor((W - nameW) / 2),
        cardY + 20,
        '#ffffff',
        2,
        '#1a0f2e',
      );

      const titleW = measurePixelText(title, 1);
      drawPixelText(
        target,
        title,
        Math.floor((W - titleW) / 2),
        cardY + 40,
        '#7ae6ff',
        1,
        '#05060c',
      );
    }
  }

  private drawBorder(
    target: HudDrawTarget,
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
  ): void {
    target.fillRect(x, y, w, 1, color, 1);
    target.fillRect(x, y + h - 1, w, 1, color, 1);
    target.fillRect(x, y, 1, h, color, 1);
    target.fillRect(x + w - 1, y, 1, h, color, 1);
  }
}

export function createCanvas2DHudTarget(ctx: CanvasRenderingContext2D): HudDrawTarget {
  return {
    fillRect(x: number, y: number, w: number, h: number, hexColor: string, alpha = 1): void {
      if (alpha <= 0) return;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = hexColor;
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
      ctx.globalAlpha = 1;
    },
  };
}
