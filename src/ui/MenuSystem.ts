// ============================================================================
// Krunked Circuit — Cyber-Pixel Overlay Menu System & Hub Terminal Modal
// Supports Keyboard, Gamepad (Xbox/PS/Switch/Tesla MCU), Mouse, and Touch.
// Zero direct imports from src/assets/*, src/data/*, or src/sim/*.
// ============================================================================

import {
  MAIN_EIGHT_STAGES,
  OFFICIAL_STAGE_IDS,
  REMIXABLE_STAGES,
  type ActionKey,
  type ArmorPaintDefinition,
  type ArmorPaintId,
  type AssetMode,
  type AudioSettings,
  type BossDefinition,
  type BossId,
  type BurstDefinition,
  type BurstId,
  type BurstSlots,
  type ChallengeDefinition,
  type ChipDefinition,
  type ChipId,
  type ControlBindings,
  type CustomModifiers,
  type DataChipDefinition,
  type Difficulty,
  type GameMode,
  type GamepadPreset,
  type HubTerminalKind,
  type InputFrame,
  type InputModality,
  type ProgressionState,
  type RenderSettings,
  type ScaleMode,
  type ScreenMode,
  type StageId,
  type StageStats,
  type TargetFps,
} from '../contracts/index';
import { formatSpeedrunTicks } from './HudRenderer';

export interface MenuStageInfo {
  readonly id: StageId;
  readonly name: string;
  readonly subtitle: string;
  readonly bossId?: BossId;
  readonly bossName?: string;
}

export interface MenuCatalogData {
  readonly stages?: readonly MenuStageInfo[];
  readonly bursts?: readonly BurstDefinition[];
  readonly chips?: readonly ChipDefinition[];
  readonly armors?: readonly ArmorPaintDefinition[];
  readonly bosses?: readonly BossDefinition[];
  readonly challenges?: readonly ChallengeDefinition[];
  readonly dataChips?: readonly DataChipDefinition[];
}

export interface MenuSnapshot {
  readonly screen: ScreenMode;
  readonly activeHubTerminal: HubTerminalKind | null;
  readonly progression: ProgressionState;
  readonly stageStats: StageStats;
  readonly renderSettings: RenderSettings;
  readonly audioSettings: AudioSettings;
  readonly controls: ControlBindings;
  readonly modality: InputModality;
  readonly gamepadName: string | null;
  readonly hasSave: boolean;
  readonly customPackAvailable: boolean;
  readonly touchVisible: boolean;
}

export interface MenuCallbacks {
  onPlayCampaign: (difficulty: Difficulty, mode: GameMode, modifiers: CustomModifiers) => void;
  onContinue: () => void;
  onStartBossRush: () => void;
  onEnterHub: () => void;
  onSelectStage: (stageId: StageId, remix: boolean) => void;
  onStartRefight?: (bossId: BossId, stageId: StageId) => void;
  onResume: () => void;
  onSwapLoadout: (index: 0 | 1 | 2) => void;
  onRetryCheckpoint: () => void;
  onRestartStage: () => void;
  onReturnToHub: () => void;
  onReturnToTitle: () => void;
  onCloseHubModal: () => void;
  onChangeHubTab?: (tab: HubTerminalKind) => void;
  onBuyBurst?: (burstId: BurstId) => void;
  onEquipBurst?: (slot: keyof BurstSlots, burstId: BurstId | 0) => void;
  onBuyChip?: (chipId: ChipId) => void;
  onEquipChip?: (slotIndex: 0 | 1 | 2, chipId: ChipId | 0) => void;
  onEquipArmor?: (armorId: ArmorPaintId) => void;
  onUpdateRenderSettings: (partial: Partial<RenderSettings>) => void;
  onUpdateAudioSettings: (partial: Partial<AudioSettings>) => void;
  onUpdateControls: (partial: Partial<ControlBindings>) => void;
  onStartKeyCapture?: (action: ActionKey, onCaptured: (code: string) => void) => void;
  onResetControls?: () => void;
  onToggleAssetMode: (mode: AssetMode) => void | Promise<void>;
  onUploadCustomPackFolder: (files: FileList) => void | Promise<void>;
  onToggleFullscreen?: () => void;
  onMenuSfx?: (key: 'menu_move' | 'menu_confirm' | 'menu_cancel') => void;
}

type SubView = 'none' | 'options' | 'campaign_setup';

const HUB_TABS: readonly { id: HubTerminalKind; label: string }[] = [
  { id: 'mission_select', label: 'MISSIONS' },
  { id: 'medbay_chips', label: 'MEDBAY CHIPS' },
  { id: 'burst_dojo', label: 'BURST DOJO' },
  { id: 'paint_bay', label: 'PAINT BAY' },
  { id: 'compendium', label: 'COMPENDIUM' },
  { id: 'challenges', label: 'CHALLENGES' },
  { id: 'training_room', label: 'TRAINING' },
  { id: 'refight_terminal', label: 'REFIGHT' },
];

const ACTION_KEYS: readonly { key: ActionKey; label: string }[] = [
  { key: 'left', label: 'Move Left' },
  { key: 'right', label: 'Move Right' },
  { key: 'up', label: 'Aim Up / Climb' },
  { key: 'down', label: 'Aim Down / Crouch' },
  { key: 'jump', label: 'Jump' },
  { key: 'attack', label: 'Melee Attack' },
  { key: 'hookshot', label: 'Hookshot / Throw' },
  { key: 'burst', label: 'Burst Technique' },
  { key: 'sprint', label: 'Sprint' },
  { key: 'slide', label: 'Slide' },
  { key: 'swapLoadout', label: 'Swap Loadout' },
  { key: 'pause', label: 'Pause' },
  { key: 'accept', label: 'Menu Accept' },
  { key: 'cancel', label: 'Menu Cancel' },
  { key: 'map', label: 'Map / Status' },
];

const MODIFIER_SPECS: readonly { key: keyof CustomModifiers; label: string; desc: string }[] = [
  { key: 'masterLevels', label: 'Master Levels', desc: 'Remixed stage layouts & hazards' },
  { key: 'rudeEnemies', label: 'Rude Enemies', desc: 'Aggressive foes & stronger minibosses' },
  { key: 'doubleHazards', label: 'Double Hazards', desc: 'Spikes & environmental damage x2' },
  { key: 'singleCredit', label: 'Single Credit', desc: 'No mid-stage checkpoint retries' },
  { key: 'ironCircuit', label: 'Iron Circuit', desc: 'No healing drops during combat' },
  { key: 'mirrorWorld', label: 'Mirror World', desc: 'Flipped horizontal stage discipline' },
];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function defaultStageLabel(id: StageId): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export class ToastManager {
  private readonly container: HTMLElement | null;

  constructor(container: HTMLElement | null) {
    this.container = container;
  }

  public show(text: string, tone: 'info' | 'unlock' | 'warn' = 'info', durationMs = 2600): void {
    if (!this.container || typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.className = `kc-toast kc-toast-${tone}`;
    el.textContent = text;
    this.container.appendChild(el);

    // Keep stack clean (max 4 simultaneous toasts)
    while (this.container.children.length > 4) {
      this.container.removeChild(this.container.firstChild!);
    }

    window.setTimeout(() => {
      el.classList.add('kc-toast-out');
      window.setTimeout(() => {
        el.remove();
      }, 240);
    }, durationMs);
  }
}

export class MenuSystem {
  private readonly root: HTMLElement | null;
  private readonly toasts: ToastManager;
  private readonly callbacks: MenuCallbacks;
  private catalog: MenuCatalogData;

  private subView: SubView = 'none';
  private activeHubTab: HubTerminalKind = 'mission_select';
  private remixSelected = false;
  private selectedBurstSlot: keyof BurstSlots = 'neutral';
  private selectedChipSlot: 0 | 1 | 2 = 0;
  private capturingAction: ActionKey | null = null;

  // Draft setup options for Campaign Select
  private setupDifficulty: Difficulty = 'normal';
  private setupMode: GameMode = 'standard';
  private setupModifiers: CustomModifiers = {
    masterLevels: false,
    rudeEnemies: false,
    doubleHazards: false,
    singleCredit: false,
    ironCircuit: false,
    mirrorWorld: false,
  };

  private lastSnapshot: MenuSnapshot | null = null;
  private lastRenderKey = '';
  private focusIndex = 0;
  private navRepeatCooldown = 0;
  private fileInputEl: HTMLInputElement | null = null;

  constructor(
    root: HTMLElement | null,
    callbacks: MenuCallbacks,
    catalog: MenuCatalogData = {},
    toastContainer: HTMLElement | null = null,
  ) {
    this.root = root;
    this.callbacks = callbacks;
    this.catalog = catalog;
    this.toasts = new ToastManager(toastContainer);

    if (typeof document !== 'undefined') {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.setAttribute('webkitdirectory', '');
      input.style.display = 'none';
      input.addEventListener('change', () => {
        if (input.files && input.files.length > 0) {
          this.callbacks.onUploadCustomPackFolder(input.files);
          input.value = '';
        }
      });
      this.fileInputEl = input;
      if (this.root && this.root.parentElement) {
        this.root.parentElement.appendChild(input);
      }
    }
  }

  public setCatalog(catalog: MenuCatalogData): void {
    this.catalog = catalog;
    this.lastRenderKey = '';
  }

  public showToast(text: string, tone: 'info' | 'unlock' | 'warn' = 'info'): void {
    this.toasts.show(text, tone);
  }

  public isOptionsOpen(): boolean {
    return this.subView === 'options';
  }

  public closeSubView(): void {
    if (this.subView !== 'none') {
      this.subView = 'none';
      this.capturingAction = null;
      this.focusIndex = 0;
      this.lastRenderKey = '';
    }
  }

  public sync(snap: MenuSnapshot): void {
    this.lastSnapshot = snap;

    if (snap.screen === 'playing') {
      this.subView = 'none';
      this.capturingAction = null;
      if (this.root && this.lastRenderKey !== 'PLAYING') {
        this.root.innerHTML = '';
        this.root.classList.remove('kc-ui-active');
        this.lastRenderKey = 'PLAYING';
      }
      return;
    }

    if (snap.screen === 'hub_modal' && snap.activeHubTerminal) {
      this.activeHubTab = snap.activeHubTerminal;
    }

    if (snap.screen === 'file_select' && this.subView === 'none') {
      this.setupDifficulty = snap.progression.difficulty;
      this.setupMode = snap.progression.mode;
      this.setupModifiers = { ...snap.progression.modifiers };
    }

    const renderKey = this.computeRenderKey(snap);
    if (renderKey === this.lastRenderKey) return;
    this.lastRenderKey = renderKey;

    this.renderCurrentView(snap);
  }

  private computeRenderKey(s: MenuSnapshot): string {
    const p = s.progression;
    const ld = p.loadouts[p.activeLoadoutIndex];
    return [
      s.screen,
      this.subView,
      this.activeHubTab,
      this.remixSelected ? 1 : 0,
      this.selectedBurstSlot,
      this.selectedChipSlot,
      this.capturingAction ?? '',
      s.modality,
      s.gamepadName ?? '',
      s.hasSave ? 1 : 0,
      s.customPackAvailable ? 1 : 0,
      s.touchVisible ? 1 : 0,
      p.bits,
      p.rescueTokens,
      p.totalRescues,
      p.activeLoadoutIndex,
      ld.armorPaint,
      ld.bursts.neutral,
      ld.bursts.side,
      ld.bursts.up,
      ld.bursts.down,
      ld.chips.join(','),
      p.unlockedBursts.length,
      p.unlockedChips.length,
      p.unlockedArmors.length,
      p.clearedStages.length,
      p.unlockedChallenges.length,
      p.unlockedDataChips.length,
      s.renderSettings.targetFps,
      s.renderSettings.classicSnap60 ? 1 : 0,
      s.renderSettings.scaleMode,
      s.renderSettings.aimReticle ? 1 : 0,
      s.renderSettings.screenShake ? 1 : 0,
      s.renderSettings.assetMode,
      s.renderSettings.showSpeedrunTimer ? 1 : 0,
      Math.round(s.audioSettings.masterVolume * 100),
      Math.round(s.audioSettings.bgmVolume * 100),
      Math.round(s.audioSettings.sfxVolume * 100),
      s.audioSettings.muted ? 1 : 0,
      s.controls.gamepadPreset,
      s.controls.rumbleEnabled ? 1 : 0,
      Object.values(s.controls.keyboard).join(','),
      this.setupDifficulty,
      this.setupMode,
      JSON.stringify(this.setupModifiers),
      s.stageStats.rank,
      s.stageStats.elapsedTicks,
    ].join('|');
  }

  /**
   * Drives Keyboard & Gamepad navigation inside active menus.
   */
  public handleInput(input: InputFrame): void {
    const snap = this.lastSnapshot;
    if (!snap || snap.screen === 'playing' || !this.root) return;
    if (this.capturingAction) return;

    if (this.navRepeatCooldown > 0) {
      this.navRepeatCooldown--;
    }

    if (input.cancelPressed) {
      this.callbacks.onMenuSfx?.('menu_cancel');
      if (this.subView !== 'none') {
        this.subView = 'none';
        this.focusIndex = 0;
        this.lastRenderKey = '';
        this.sync(snap);
        return;
      }
      if (snap.screen === 'paused') {
        this.callbacks.onResume();
        return;
      }
      if (snap.screen === 'hub_modal') {
        this.callbacks.onCloseHubModal();
        return;
      }
      if (snap.screen === 'file_select') {
        this.callbacks.onReturnToTitle();
        return;
      }
    }

    const focusables = this.getFocusableElements();
    if (focusables.length === 0) return;

    if (this.navRepeatCooldown === 0 && (input.moveY !== 0 || input.moveX !== 0)) {
      const currentEl = focusables[Math.min(this.focusIndex, focusables.length - 1)];
      // Horizontal input adjusts range sliders directly
      if (input.moveX !== 0 && currentEl instanceof HTMLInputElement && currentEl.type === 'range') {
        const step = Number(currentEl.step || 5);
        const nextVal = Math.max(
          Number(currentEl.min || 0),
          Math.min(Number(currentEl.max || 100), Number(currentEl.value) + input.moveX * step),
        );
        currentEl.value = String(nextVal);
        currentEl.dispatchEvent(new Event('input', { bubbles: true }));
        this.navRepeatCooldown = 8;
        return;
      }

      const delta = input.moveY !== 0 ? input.moveY : input.moveX;
      this.focusIndex = (this.focusIndex + delta + focusables.length) % focusables.length;
      this.applyFocusHighlight(focusables);
      this.callbacks.onMenuSfx?.('menu_move');
      this.navRepeatCooldown = 11;
    }

    if (input.acceptPressed) {
      const target = focusables[Math.min(this.focusIndex, focusables.length - 1)];
      if (target && !target.hasAttribute('disabled')) {
        this.callbacks.onMenuSfx?.('menu_confirm');
        target.click();
      }
    }
  }

  private getFocusableElements(): HTMLElement[] {
    if (!this.root) return [];
    return Array.from(
      this.root.querySelectorAll<HTMLElement>(
        'button.kc-focusable:not([disabled]), input.kc-focusable:not([disabled])',
      ),
    );
  }

  private applyFocusHighlight(focusables: HTMLElement[]): void {
    for (let i = 0; i < focusables.length; i++) {
      const isActive = i === this.focusIndex;
      focusables[i].classList.toggle('is-focused', isActive);
      if (isActive && typeof focusables[i].scrollIntoView === 'function') {
        focusables[i].scrollIntoView({ block: 'nearest' });
      }
    }
  }

  private renderCurrentView(snap: MenuSnapshot): void {
    if (!this.root) return;
    this.root.classList.add('kc-ui-active');

    let html = '';
    if (this.subView === 'options') {
      html = this.buildOptionsHtml(snap);
    } else if (this.subView === 'campaign_setup' || snap.screen === 'file_select') {
      html = this.buildCampaignSetupHtml();
    } else {
      switch (snap.screen) {
        case 'title':
          html = this.buildTitleHtml(snap);
          break;
        case 'paused':
          html = this.buildPauseHtml(snap);
          break;
        case 'hub_modal':
          html = this.buildHubModalHtml(snap);
          break;
        case 'stage_clear':
          html = this.buildStageClearHtml(snap);
          break;
        case 'game_over':
          html = this.buildGameOverHtml(snap);
          break;
        default:
          html = '';
      }
    }

    this.root.innerHTML = html;
    this.wireDomEvents(snap);

    const focusables = this.getFocusableElements();
    if (focusables.length > 0) {
      this.focusIndex = Math.max(0, Math.min(this.focusIndex, focusables.length - 1));
      this.applyFocusHighlight(focusables);
    }
  }

  private buildTitleHtml(snap: MenuSnapshot): string {
    const assetMode = snap.renderSettings.assetMode;
    const modPill =
      snap.modality === 'gamepad'
        ? `GAMEPAD ACTIVE${snap.gamepadName ? `: ${escapeHtml(snap.gamepadName)}` : ''}`
        : snap.modality === 'touch'
          ? 'TOUCH CONTROLS ACTIVE'
          : 'KEYBOARD + MOUSE READY';

    const packHint = snap.customPackAvailable
      ? 'CUSTOM PACK DETECTED'
      : 'BUILT-IN 16-BIT ENGINE ART';

    return `
      <div class="kc-backdrop kc-title-screen">
        <div class="kc-logo-block">
          <div class="kc-logo-kicker">60 HZ HOOKSHOT ACTION-PLATFORMER</div>
          <h1 class="kc-logo-title">KRUNKED <span>CIRCUIT</span></h1>
          <div class="kc-logo-sub">VOLT OVERDRIVE // 8-DIR GRAPPLE // 12 ARMOR PAINTS</div>
        </div>

        <div class="kc-menu-stack">
          <button type="button" class="kc-btn kc-btn-primary kc-focusable" data-action="open-campaign-setup">PLAY CAMPAIGN</button>
          ${
            snap.hasSave
              ? `<button type="button" class="kc-btn kc-focusable" data-action="continue">CONTINUE</button>`
              : `<button type="button" class="kc-btn kc-btn-dim" disabled>CONTINUE (NO SAVE)</button>`
          }
          <button type="button" class="kc-btn kc-focusable" data-action="boss-rush">BOSS RUSH</button>
          <button type="button" class="kc-btn kc-focusable" data-action="enter-hub">HUB COMMAND</button>
          <button type="button" class="kc-btn kc-focusable" data-action="open-options">OPTIONS</button>
        </div>

        <div class="kc-asset-bar">
          <div class="kc-asset-label">${packHint}</div>
          <div class="kc-asset-actions">
            <button type="button" class="kc-chip-btn kc-focusable ${assetMode === 'BUILTIN' ? 'is-selected' : ''}" data-action="asset-builtin">USE BUILT-IN ART</button>
            <button type="button" class="kc-chip-btn kc-focusable ${assetMode === 'CUSTOM_PACK' ? 'is-selected' : ''}" data-action="asset-custom">LOAD CUSTOM PACK</button>
            <button type="button" class="kc-chip-btn kc-focusable" data-action="upload-pack">UPLOAD FOLDER...</button>
          </div>
        </div>

        <div class="kc-status-footer">
          <span class="kc-pill kc-pill-${snap.modality}">${modPill}</span>
          <span class="kc-hint">KB: ARROWS + Z/X/C/SPACE &nbsp;|&nbsp; PAD: STICK + A/X/RT &nbsp;|&nbsp; F9: DEV</span>
        </div>
      </div>
    `;
  }

  private buildCampaignSetupHtml(): string {
    const diffs: Difficulty[] = ['easy', 'normal', 'hard'];
    const modes: { id: GameMode; label: string }[] = [
      { id: 'standard', label: 'STANDARD' },
      { id: 'circuit', label: 'CIRCUIT' },
      { id: 'speedrun', label: 'SPEEDRUN' },
    ];

    return `
      <div class="kc-backdrop">
        <div class="kc-panel kc-panel-md">
          <div class="kc-panel-header">
            <h2>MISSION LAUNCH CONFIG</h2>
            <button type="button" class="kc-btn-sm kc-focusable" data-action="close-subview">BACK</button>
          </div>

          <div class="kc-section">
            <div class="kc-section-title">DIFFICULTY</div>
            <div class="kc-row">
              ${diffs
                .map(
                  (d) =>
                    `<button type="button" class="kc-chip-btn kc-focusable ${this.setupDifficulty === d ? 'is-selected' : ''}" data-set-diff="${d}">${d.toUpperCase()}</button>`,
                )
                .join('')}
            </div>
          </div>

          <div class="kc-section">
            <div class="kc-section-title">GAME MODE</div>
            <div class="kc-row">
              ${modes
                .map(
                  (m) =>
                    `<button type="button" class="kc-chip-btn kc-focusable ${this.setupMode === m.id ? 'is-selected' : ''}" data-set-mode="${m.id}">${m.label}</button>`,
                )
                .join('')}
            </div>
          </div>

          <div class="kc-section">
            <div class="kc-section-title">CUSTOM MODIFIERS (6)</div>
            <div class="kc-mod-grid">
              ${MODIFIER_SPECS.map(
                (m) => `
                  <button type="button" class="kc-mod-card kc-focusable ${this.setupModifiers[m.key] ? 'is-selected' : ''}" data-toggle-mod="${m.key}">
                    <span class="kc-mod-name">${m.label}</span>
                    <span class="kc-mod-desc">${m.desc}</span>
                  </button>
                `,
              ).join('')}
            </div>
          </div>

          <div class="kc-panel-footer">
            <button type="button" class="kc-btn kc-btn-primary kc-focusable" data-action="launch-campaign">LAUNCH CAMPAIGN</button>
          </div>
        </div>
      </div>
    `;
  }

  private buildPauseHtml(snap: MenuSnapshot): string {
    const idx = snap.progression.activeLoadoutIndex;
    const ld = snap.progression.loadouts[idx];
    return `
      <div class="kc-backdrop">
        <div class="kc-panel kc-panel-sm">
          <div class="kc-panel-header">
            <h2>PAUSED</h2>
            <span class="kc-pill">LOADOUT [${idx + 1}/3]: ${escapeHtml(ld.name)}</span>
          </div>
          <div class="kc-menu-stack">
            <button type="button" class="kc-btn kc-btn-primary kc-focusable" data-action="resume">RESUME</button>
            <button type="button" class="kc-btn kc-focusable" data-action="cycle-loadout">SWAP LOADOUT [${idx + 1}/3]</button>
            <button type="button" class="kc-btn kc-focusable" data-action="return-hub">RETURN TO HUB</button>
            <button type="button" class="kc-btn kc-focusable" data-action="open-options">OPTIONS</button>
            <button type="button" class="kc-btn kc-btn-danger kc-focusable" data-action="return-title">TITLE SCREEN</button>
          </div>
        </div>
      </div>
    `;
  }

  private buildOptionsHtml(snap: MenuSnapshot): string {
    const rs = snap.renderSettings;
    const as = snap.audioSettings;
    const ct = snap.controls;
    const fpsChoices: TargetFps[] = [30, 60, 120];
    const scaleChoices: ScaleMode[] = ['fit', 'integer', 'fill'];
    const presets: { id: GamepadPreset; label: string; desc: string }[] = [
      { id: 'default', label: 'DEFAULT', desc: 'A:Jump B:Slide X:Atk Y/RB:Burst RT:Hook LT:Sprint LB:Swap' },
      { id: 'shoulder_hook', label: 'SHOULDER HOOK', desc: 'A:Jump B:Cancel X:Atk Y:Burst RB:Hook LB:Sprint LT:Slide RT:Swap' },
    ];

    return `
      <div class="kc-backdrop">
        <div class="kc-panel kc-panel-lg">
          <div class="kc-panel-header">
            <h2>SYSTEM OPTIONS</h2>
            <button type="button" class="kc-btn-sm kc-focusable" data-action="close-subview">DONE</button>
          </div>

          <div class="kc-options-scroll">
            <div class="kc-section">
              <div class="kc-section-title">DISPLAY &amp; PERFORMANCE</div>
              <div class="kc-opt-row">
                <span>Target FPS</span>
                <div class="kc-row">
                  ${fpsChoices
                    .map(
                      (f) =>
                        `<button type="button" class="kc-chip-btn kc-focusable ${rs.targetFps === f ? 'is-selected' : ''}" data-set-fps="${f}">${f} FPS</button>`,
                    )
                    .join('')}
                </div>
              </div>
              <div class="kc-opt-row">
                <span>Classic Snap 60</span>
                <button type="button" class="kc-chip-btn kc-focusable ${rs.classicSnap60 ? 'is-selected' : ''}" data-toggle-render="classicSnap60">${rs.classicSnap60 ? 'ON' : 'OFF'}</button>
              </div>
              <div class="kc-opt-row">
                <span>Viewport Scale</span>
                <div class="kc-row">
                  ${scaleChoices
                    .map(
                      (sc) =>
                        `<button type="button" class="kc-chip-btn kc-focusable ${rs.scaleMode === sc ? 'is-selected' : ''}" data-set-scale="${sc}">${sc.toUpperCase()}</button>`,
                    )
                    .join('')}
                </div>
              </div>
              <div class="kc-opt-row">
                <span>Aim Reticle</span>
                <button type="button" class="kc-chip-btn kc-focusable ${rs.aimReticle ? 'is-selected' : ''}" data-toggle-render="aimReticle">${rs.aimReticle ? 'ON' : 'OFF'}</button>
              </div>
              <div class="kc-opt-row">
                <span>Screen Shake</span>
                <button type="button" class="kc-chip-btn kc-focusable ${rs.screenShake ? 'is-selected' : ''}" data-toggle-render="screenShake">${rs.screenShake ? 'ON' : 'OFF'}</button>
              </div>
              <div class="kc-opt-row">
                <span>Speedrun Timer</span>
                <button type="button" class="kc-chip-btn kc-focusable ${rs.showSpeedrunTimer ? 'is-selected' : ''}" data-toggle-render="showSpeedrunTimer">${rs.showSpeedrunTimer ? 'ON' : 'OFF'}</button>
              </div>
              <div class="kc-opt-row">
                <span>Fullscreen</span>
                <button type="button" class="kc-chip-btn kc-focusable" data-action="fullscreen">TOGGLE FULLSCREEN</button>
              </div>
            </div>

            <div class="kc-section">
              <div class="kc-section-title">AUDIO MIXER</div>
              <div class="kc-opt-row">
                <span>Master (${Math.round(as.masterVolume * 100)}%)</span>
                <input type="range" class="kc-slider kc-focusable" min="0" max="100" step="5" value="${Math.round(as.masterVolume * 100)}" data-audio-slider="masterVolume" />
              </div>
              <div class="kc-opt-row">
                <span>BGM (${Math.round(as.bgmVolume * 100)}%)</span>
                <input type="range" class="kc-slider kc-focusable" min="0" max="100" step="5" value="${Math.round(as.bgmVolume * 100)}" data-audio-slider="bgmVolume" />
              </div>
              <div class="kc-opt-row">
                <span>SFX (${Math.round(as.sfxVolume * 100)}%)</span>
                <input type="range" class="kc-slider kc-focusable" min="0" max="100" step="5" value="${Math.round(as.sfxVolume * 100)}" data-audio-slider="sfxVolume" />
              </div>
              <div class="kc-opt-row">
                <span>Mute All</span>
                <button type="button" class="kc-chip-btn kc-focusable ${as.muted ? 'is-selected' : ''}" data-action="toggle-mute">${as.muted ? 'MUTED' : 'ACTIVE'}</button>
              </div>
            </div>

            <div class="kc-section">
              <div class="kc-section-title">GAMEPAD &amp; HAPTICS</div>
              <div class="kc-opt-row">
                <span>Gamepad Preset</span>
                <div class="kc-row">
                  ${presets
                    .map(
                      (p) =>
                        `<button type="button" class="kc-chip-btn kc-focusable ${ct.gamepadPreset === p.id ? 'is-selected' : ''}" data-set-preset="${p.id}">${p.label}</button>`,
                    )
                    .join('')}
                </div>
              </div>
              <div class="kc-preset-legend">
                ${presets.find((p) => p.id === ct.gamepadPreset)?.desc ?? ''}
              </div>
              <div class="kc-opt-row">
                <span>Dual Rumble</span>
                <button type="button" class="kc-chip-btn kc-focusable ${ct.rumbleEnabled ? 'is-selected' : ''}" data-action="toggle-rumble">${ct.rumbleEnabled ? 'ON' : 'OFF'}</button>
              </div>
            </div>

            <div class="kc-section">
              <div class="kc-section-title">
                <span>KEYBOARD REBINDING</span>
                <button type="button" class="kc-btn-xs kc-focusable" data-action="reset-controls">RESET DEFAULTS</button>
              </div>
              <div class="kc-rebind-grid">
                ${ACTION_KEYS.map((item) => {
                  const waiting = this.capturingAction === item.key;
                  const code = ct.keyboard[item.key];
                  return `
                    <div class="kc-rebind-row">
                      <span>${item.label}</span>
                      <button type="button" class="kc-chip-btn kc-focusable ${waiting ? 'is-listening' : ''}" data-rebind-key="${item.key}">
                        ${waiting ? 'PRESS KEY...' : escapeHtml(code)}
                      </button>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private buildHubModalHtml(snap: MenuSnapshot): string {
    const p = snap.progression;
    const ldIdx = p.activeLoadoutIndex;

    return `
      <div class="kc-backdrop">
        <div class="kc-panel kc-panel-xl">
          <div class="kc-panel-header">
            <div class="kc-hub-title">
              <h2>HUB COMMAND TERMINAL</h2>
              <div class="kc-hub-stats">
                <span class="kc-pill">BITS: ${p.bits}</span>
                <span class="kc-pill">RESCUES: ${p.totalRescues}/64</span>
                <span class="kc-pill">TOKENS: ${p.rescueTokens}</span>
                <button type="button" class="kc-btn-xs kc-focusable" data-action="cycle-loadout">LOADOUT [${ldIdx + 1}/3]</button>
              </div>
            </div>
            <button type="button" class="kc-btn-sm kc-focusable" data-action="close-hub">EXIT</button>
          </div>

          <div class="kc-tab-bar">
            ${HUB_TABS.map(
              (t) =>
                `<button type="button" class="kc-tab kc-focusable ${this.activeHubTab === t.id ? 'is-active' : ''}" data-hub-tab="${t.id}">${t.label}</button>`,
            ).join('')}
          </div>

          <div class="kc-hub-body">
            ${this.buildHubTabContent(snap)}
          </div>
        </div>
      </div>
    `;
  }

  private buildHubTabContent(snap: MenuSnapshot): string {
    const p = snap.progression;
    const ld = p.loadouts[p.activeLoadoutIndex];

    switch (this.activeHubTab) {
      case 'mission_select': {
        const stages: readonly MenuStageInfo[] =
          this.catalog.stages && this.catalog.stages.length > 0
            ? this.catalog.stages
            : OFFICIAL_STAGE_IDS.filter((id) => id !== 'hub').map((id) => ({
                id,
                name: defaultStageLabel(id),
                subtitle: MAIN_EIGHT_STAGES.includes(id) ? 'Main Circuit Sector' : 'Special Operation',
              }));

        return `
          <div class="kc-hub-toolbar">
            <span>Select deployment sector</span>
            <button type="button" class="kc-chip-btn kc-focusable ${this.remixSelected ? 'is-selected' : ''}" data-action="toggle-remix">
              MASTER REMIX: ${this.remixSelected ? 'ON' : 'OFF'}
            </button>
          </div>
          <div class="kc-card-grid">
            ${stages
              .filter((st) => st.id !== 'hub')
              .map((st) => {
                const cleared = p.clearedStages.includes(st.id);
                const canRemix = REMIXABLE_STAGES.includes(st.id);
                const useRemix = this.remixSelected && canRemix;
                return `
                  <button type="button" class="kc-stage-card kc-focusable ${cleared ? 'is-cleared' : ''}" data-launch-stage="${st.id}" data-launch-remix="${useRemix ? '1' : '0'}">
                    <div class="kc-card-top">
                      <strong>${escapeHtml(st.name)}</strong>
                      <span class="kc-badge">${cleared ? 'CLEARED' : 'ACTIVE'}</span>
                    </div>
                    <div class="kc-card-sub">${escapeHtml(st.subtitle)}</div>
                    ${useRemix ? '<div class="kc-badge-remix">REMIX LAYOUT</div>' : ''}
                  </button>
                `;
              })
              .join('')}
          </div>
        `;
      }

      case 'medbay_chips': {
        const chips = this.catalog.chips ?? [];
        const slots: (0 | 1 | 2)[] = [0, 1, 2];
        return `
          <div class="kc-hub-toolbar">
            <span>Target Chip Slot:</span>
            <div class="kc-row">
              ${slots
                .map(
                  (si) =>
                    `<button type="button" class="kc-chip-btn kc-focusable ${this.selectedChipSlot === si ? 'is-selected' : ''}" data-chip-slot="${si}">SLOT ${si + 1} (${ld.chips[si] || 'EMPTY'})</button>`,
                )
                .join('')}
            </div>
          </div>
          <div class="kc-card-grid">
            ${
              chips.length === 0
                ? '<div class="kc-empty">Chip catalog ready once data module connects.</div>'
                : chips
                    .map((c) => {
                      const unlocked = p.unlockedChips.includes(c.id);
                      const equipped = ld.chips.includes(c.id);
                      return `
                        <button type="button" class="kc-item-card kc-focusable ${equipped ? 'is-equipped' : ''}" data-chip-id="${c.id}" data-chip-unlocked="${unlocked ? '1' : '0'}">
                          <div class="kc-card-top">
                            <strong>${escapeHtml(c.name)}</strong>
                            <span class="kc-badge">${equipped ? 'EQUIPPED' : unlocked ? 'OWNED' : `${c.priceBits}B`}</span>
                          </div>
                          <div class="kc-card-sub">${escapeHtml(c.description)}</div>
                        </button>
                      `;
                    })
                    .join('')
            }
          </div>
        `;
      }

      case 'burst_dojo': {
        const bursts = this.catalog.bursts ?? [];
        const bSlots: (keyof BurstSlots)[] = ['neutral', 'side', 'up', 'down'];
        return `
          <div class="kc-hub-toolbar">
            <span>Target Directional Slot:</span>
            <div class="kc-row">
              ${bSlots
                .map(
                  (sl) =>
                    `<button type="button" class="kc-chip-btn kc-focusable ${this.selectedBurstSlot === sl ? 'is-selected' : ''}" data-burst-slot="${sl}">${sl.toUpperCase()} (${ld.bursts[sl] || '-'})</button>`,
                )
                .join('')}
            </div>
          </div>
          <div class="kc-card-grid">
            ${
              bursts.length === 0
                ? '<div class="kc-empty">Burst catalog ready once data module connects.</div>'
                : bursts
                    .map((b) => {
                      const unlocked = p.unlockedBursts.includes(b.id);
                      const equipped = Object.values(ld.bursts).includes(b.id);
                      return `
                        <button type="button" class="kc-item-card kc-focusable ${equipped ? 'is-equipped' : ''}" data-burst-id="${b.id}" data-burst-unlocked="${unlocked ? '1' : '0'}">
                          <div class="kc-card-top">
                            <strong>${escapeHtml(b.name)}</strong>
                            <span class="kc-badge">${equipped ? 'EQUIPPED' : unlocked ? 'OWNED' : `${b.priceBits}B`}</span>
                          </div>
                          <div class="kc-card-sub">${escapeHtml(b.description)} (${b.costCharges} CHG)</div>
                        </button>
                      `;
                    })
                    .join('')
            }
          </div>
        `;
      }

      case 'paint_bay': {
        const armors = this.catalog.armors ?? [];
        return `
          <div class="kc-hub-toolbar">
            <span>Select Armor Paint (functional trait + 6-color GPU palette swap)</span>
          </div>
          <div class="kc-card-grid">
            ${
              armors.length === 0
                ? Array.from({ length: 12 }, (_, idx) => {
                    const id = idx as ArmorPaintId;
                    const eq = ld.armorPaint === id;
                    return `<button type="button" class="kc-item-card kc-focusable ${eq ? 'is-equipped' : ''}" data-equip-armor="${id}"><strong>ARMOR #${id}</strong><div class="kc-card-sub">${eq ? 'ACTIVE' : 'EQUIP'}</div></button>`;
                  }).join('')
                : armors
                    .map((a) => {
                      const unlocked = p.unlockedArmors.includes(a.id);
                      const eq = ld.armorPaint === a.id;
                      const swatches = a.palette
                        .map((hex) => `<span class="kc-swatch" style="background:${escapeHtml(hex)}"></span>`)
                        .join('');
                      return `
                        <button type="button" class="kc-item-card kc-focusable ${eq ? 'is-equipped' : ''}" ${!unlocked ? 'disabled' : ''} data-equip-armor="${a.id}">
                          <div class="kc-card-top">
                            <strong>${escapeHtml(a.name)}</strong>
                            <span class="kc-badge">${eq ? 'EQUIPPED' : unlocked ? escapeHtml(a.traitName) : 'LOCKED'}</span>
                          </div>
                          <div class="kc-swatch-row">${swatches}</div>
                          <div class="kc-card-sub">${escapeHtml(a.description)}</div>
                        </button>
                      `;
                    })
                    .join('')
            }
          </div>
        `;
      }

      case 'compendium': {
        const entries = this.catalog.dataChips ?? [];
        return `
          <div class="kc-hub-toolbar">
            <span>Data Chips Decoded: ${p.unlockedDataChips.length} / ${entries.length || 100}</span>
          </div>
          <div class="kc-card-grid">
            ${
              entries.length === 0
                ? '<div class="kc-empty">Collect enemies & bosses to decode all 100 Bestiary Data Chips.</div>'
                : entries
                    .slice(0, 40)
                    .map((d) => {
                      const unlocked = p.unlockedDataChips.includes(d.id);
                      return `
                        <div class="kc-item-card ${unlocked ? '' : 'is-locked'}">
                          <div class="kc-card-top">
                            <strong>#${String(d.index).padStart(3, '0')} ${unlocked ? escapeHtml(d.title) : '???'}</strong>
                            <span class="kc-badge">${d.category.toUpperCase()}</span>
                          </div>
                          <div class="kc-card-sub">${unlocked ? escapeHtml(d.lore) : 'Defeat target in the field to decode.'}</div>
                        </div>
                      `;
                    })
                    .join('')
            }
          </div>
        `;
      }

      case 'challenges': {
        const list = this.catalog.challenges ?? [];
        return `
          <div class="kc-hub-toolbar">
            <span>Challenges Cleared: ${p.unlockedChallenges.length} / ${list.length || 53}</span>
          </div>
          <div class="kc-card-grid">
            ${
              list.length === 0
                ? '<div class="kc-empty">53 combat, speed, and boss mastery challenges tracked automatically.</div>'
                : list
                    .map((ch) => {
                      const done = p.unlockedChallenges.includes(ch.id);
                      return `
                        <div class="kc-item-card ${done ? 'is-cleared' : ''}">
                          <div class="kc-card-top">
                            <strong>${escapeHtml(ch.name)}</strong>
                            <span class="kc-badge">${done ? 'DONE' : `+${ch.rewardBits}B`}</span>
                          </div>
                          <div class="kc-card-sub">${escapeHtml(ch.description)}</div>
                        </div>
                      `;
                    })
                    .join('')
            }
          </div>
        `;
      }

      case 'training_room':
        return `
          <div class="kc-training-box">
            <h3>COMBAT &amp; HOOKSHOT TRAINING SIMULATOR</h3>
            <p>Practice 8-dir grapple zips, guard-breaking Air Up-Kicks, shield throws, and Burst combos in a safe test arena.</p>
            <div class="kc-row">
              <button type="button" class="kc-btn kc-btn-primary kc-focusable" data-launch-stage="tutorial" data-launch-remix="0">ENTER TRAINING COURSE</button>
              <button type="button" class="kc-btn kc-focusable" data-action="cycle-loadout">CYCLE LOADOUT</button>
            </div>
          </div>
        `;

      case 'refight_terminal': {
        const bosses = this.catalog.bosses ?? [];
        return `
          <div class="kc-hub-toolbar">
            <span>Instant Circuit Master Rematch Simulator</span>
            <button type="button" class="kc-chip-btn kc-focusable" data-action="boss-rush">LAUNCH FULL BOSS RUSH</button>
          </div>
          <div class="kc-card-grid">
            ${
              bosses.length === 0
                ? '<div class="kc-empty">Defeat Circuit Masters to challenge them directly here.</div>'
                : bosses
                    .map(
                      (b) => `
                        <button type="button" class="kc-stage-card kc-focusable" data-refight-boss="${b.id}" data-refight-stage="${b.stageId}">
                          <div class="kc-card-top">
                            <strong>${escapeHtml(b.name)}</strong>
                            <span class="kc-badge">${b.baseHp} HP</span>
                          </div>
                          <div class="kc-card-sub">${escapeHtml(b.title)}</div>
                        </button>
                      `,
                    )
                    .join('')
            }
          </div>
        `;
      }
    }
  }

  private buildStageClearHtml(snap: MenuSnapshot): string {
    const st = snap.stageStats;
    return `
      <div class="kc-backdrop">
        <div class="kc-panel kc-panel-md kc-rank-card">
          <div class="kc-panel-header">
            <h2>SECTOR CLEARED</h2>
            <span class="kc-pill">${defaultStageLabel(st.stageId).toUpperCase()}</span>
          </div>

          <div class="kc-rank-hero">
            <div class="kc-rank-badge kc-rank-${st.rank.toLowerCase()}">${st.rank}</div>
            <div class="kc-rank-metrics">
              <div><span>CLEAR TIME</span><strong>${formatSpeedrunTicks(st.elapsedTicks)}</strong></div>
              <div><span>RESCUES</span><strong>${st.rescuesCollected} / 8</strong></div>
              <div><span>BITS COLLECTED</span><strong>${st.bitsCollected}</strong></div>
              <div><span>DAMAGE TAKEN</span><strong>${st.damageTaken}</strong></div>
              <div><span>ENEMIES DEFEATED</span><strong>${st.enemiesDefeated}</strong></div>
            </div>
          </div>

          <div class="kc-panel-footer">
            <button type="button" class="kc-btn kc-btn-primary kc-focusable" data-action="return-hub">RETURN TO HUB</button>
            <button type="button" class="kc-btn kc-focusable" data-action="restart-stage">REPLAY STAGE</button>
          </div>
        </div>
      </div>
    `;
  }

  private buildGameOverHtml(snap: MenuSnapshot): string {
    const singleCredit = snap.progression.modifiers.singleCredit;
    return `
      <div class="kc-backdrop">
        <div class="kc-panel kc-panel-sm">
          <div class="kc-panel-header">
            <h2 class="kc-text-danger">CIRCUIT OFFLINE</h2>
          </div>
          <div class="kc-menu-stack">
            <button type="button" class="kc-btn kc-btn-primary kc-focusable" ${singleCredit ? 'disabled' : ''} data-action="retry-checkpoint">
              ${singleCredit ? 'CHECKPOINT LOCKED (SINGLE CREDIT)' : 'RETRY CHECKPOINT'}
            </button>
            <button type="button" class="kc-btn kc-focusable" data-action="restart-stage">RESTART STAGE</button>
            <button type="button" class="kc-btn kc-focusable" data-action="return-hub">RETURN TO HUB</button>
          </div>
        </div>
      </div>
    `;
  }

  private wireDomEvents(snap: MenuSnapshot): void {
    if (!this.root) return;

    const clickBind = (selector: string, fn: (el: HTMLElement) => void): void => {
      this.root!.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        el.addEventListener('click', () => fn(el));
      });
    };

    clickBind('[data-action="open-campaign-setup"]', () => {
      this.setupDifficulty = snap.progression.difficulty;
      this.setupMode = snap.progression.mode;
      this.setupModifiers = { ...snap.progression.modifiers };
      this.subView = 'campaign_setup';
      this.focusIndex = 0;
      this.lastRenderKey = '';
      this.sync(snap);
    });

    clickBind('[data-action="launch-campaign"]', () => {
      this.subView = 'none';
      this.callbacks.onPlayCampaign(this.setupDifficulty, this.setupMode, { ...this.setupModifiers });
    });

    clickBind('[data-action="continue"]', () => this.callbacks.onContinue());
    clickBind('[data-action="boss-rush"]', () => this.callbacks.onStartBossRush());
    clickBind('[data-action="enter-hub"]', () => this.callbacks.onEnterHub());
    clickBind('[data-action="resume"]', () => this.callbacks.onResume());
    clickBind('[data-action="return-hub"]', () => this.callbacks.onReturnToHub());
    clickBind('[data-action="return-title"]', () => this.callbacks.onReturnToTitle());
    clickBind('[data-action="retry-checkpoint"]', () => this.callbacks.onRetryCheckpoint());
    clickBind('[data-action="restart-stage"]', () => this.callbacks.onRestartStage());
    clickBind('[data-action="close-hub"]', () => this.callbacks.onCloseHubModal());

    clickBind('[data-action="cycle-loadout"]', () => {
      const next = ((snap.progression.activeLoadoutIndex + 1) % 3) as 0 | 1 | 2;
      this.callbacks.onSwapLoadout(next);
    });

    clickBind('[data-action="open-options"]', () => {
      this.subView = 'options';
      this.focusIndex = 0;
      this.lastRenderKey = '';
      this.sync(snap);
    });

    clickBind('[data-action="close-subview"]', () => {
      this.subView = 'none';
      this.capturingAction = null;
      this.focusIndex = 0;
      this.lastRenderKey = '';
      this.sync(snap);
    });

    clickBind('[data-action="asset-builtin"]', () => {
      void this.callbacks.onToggleAssetMode('BUILTIN');
    });

    clickBind('[data-action="asset-custom"]', () => {
      void this.callbacks.onToggleAssetMode('CUSTOM_PACK');
    });

    clickBind('[data-action="upload-pack"]', () => {
      this.fileInputEl?.click();
    });

    clickBind('[data-set-diff]', (el) => {
      this.setupDifficulty = el.dataset.setDiff as Difficulty;
      this.lastRenderKey = '';
      this.sync(snap);
    });

    clickBind('[data-set-mode]', (el) => {
      this.setupMode = el.dataset.setMode as GameMode;
      this.lastRenderKey = '';
      this.sync(snap);
    });

    clickBind('[data-toggle-mod]', (el) => {
      const key = el.dataset.toggleMod as keyof CustomModifiers;
      this.setupModifiers[key] = !this.setupModifiers[key];
      this.lastRenderKey = '';
      this.sync(snap);
    });

    clickBind('[data-set-fps]', (el) => {
      this.callbacks.onUpdateRenderSettings({ targetFps: Number(el.dataset.setFps) as TargetFps });
    });

    clickBind('[data-set-scale]', (el) => {
      this.callbacks.onUpdateRenderSettings({ scaleMode: el.dataset.setScale as ScaleMode });
    });

    clickBind('[data-toggle-render]', (el) => {
      const key = el.dataset.toggleRender as
        | 'classicSnap60'
        | 'aimReticle'
        | 'screenShake'
        | 'showSpeedrunTimer';
      this.callbacks.onUpdateRenderSettings({ [key]: !snap.renderSettings[key] });
    });

    clickBind('[data-action="fullscreen"]', () => {
      if (this.callbacks.onToggleFullscreen) {
        this.callbacks.onToggleFullscreen();
      } else if (typeof document !== 'undefined') {
        if (!document.fullscreenElement) {
          void document.documentElement.requestFullscreen?.().catch(() => {});
        } else {
          void document.exitFullscreen?.().catch(() => {});
        }
      }
    });

    clickBind('[data-action="toggle-mute"]', () => {
      this.callbacks.onUpdateAudioSettings({ muted: !snap.audioSettings.muted });
    });

    this.root.querySelectorAll<HTMLInputElement>('[data-audio-slider]').forEach((slider) => {
      slider.addEventListener('input', () => {
        const key = slider.dataset.audioSlider as 'masterVolume' | 'bgmVolume' | 'sfxVolume';
        this.callbacks.onUpdateAudioSettings({ [key]: Number(slider.value) / 100 });
      });
    });

    clickBind('[data-set-preset]', (el) => {
      this.callbacks.onUpdateControls({ gamepadPreset: el.dataset.setPreset as GamepadPreset });
    });

    clickBind('[data-action="toggle-rumble"]', () => {
      this.callbacks.onUpdateControls({ rumbleEnabled: !snap.controls.rumbleEnabled });
    });

    clickBind('[data-action="reset-controls"]', () => {
      this.callbacks.onResetControls?.();
    });

    clickBind('[data-rebind-key]', (el) => {
      const action = el.dataset.rebindKey as ActionKey;
      this.capturingAction = action;
      this.lastRenderKey = '';
      this.sync(snap);
      this.callbacks.onStartKeyCapture?.(action, (code) => {
        this.capturingAction = null;
        this.callbacks.onUpdateControls({
          keyboard: { ...snap.controls.keyboard, [action]: code },
        });
      });
    });

    clickBind('[data-hub-tab]', (el) => {
      const tab = el.dataset.hubTab as HubTerminalKind;
      this.activeHubTab = tab;
      this.focusIndex = 0;
      this.callbacks.onChangeHubTab?.(tab);
      this.lastRenderKey = '';
      this.sync(snap);
    });

    clickBind('[data-action="toggle-remix"]', () => {
      this.remixSelected = !this.remixSelected;
      this.lastRenderKey = '';
      this.sync(snap);
    });

    clickBind('[data-launch-stage]', (el) => {
      const stageId = el.dataset.launchStage as StageId;
      const remix = el.dataset.launchRemix === '1';
      this.callbacks.onSelectStage(stageId, remix);
    });

    clickBind('[data-chip-slot]', (el) => {
      this.selectedChipSlot = Number(el.dataset.chipSlot) as 0 | 1 | 2;
      this.lastRenderKey = '';
      this.sync(snap);
    });

    clickBind('[data-chip-id]', (el) => {
      const id = Number(el.dataset.chipId) as ChipId;
      const unlocked = el.dataset.chipUnlocked === '1';
      if (!unlocked) {
        this.callbacks.onBuyChip?.(id);
      } else {
        this.callbacks.onEquipChip?.(this.selectedChipSlot, id);
      }
    });

    clickBind('[data-burst-slot]', (el) => {
      this.selectedBurstSlot = el.dataset.burstSlot as keyof BurstSlots;
      this.lastRenderKey = '';
      this.sync(snap);
    });

    clickBind('[data-burst-id]', (el) => {
      const id = Number(el.dataset.burstId) as BurstId;
      const unlocked = el.dataset.burstUnlocked === '1';
      if (!unlocked) {
        this.callbacks.onBuyBurst?.(id);
      } else {
        this.callbacks.onEquipBurst?.(this.selectedBurstSlot, id);
      }
    });

    clickBind('[data-equip-armor]', (el) => {
      const armorId = Number(el.dataset.equipArmor) as ArmorPaintId;
      this.callbacks.onEquipArmor?.(armorId);
    });

    clickBind('[data-refight-boss]', (el) => {
      const bossId = el.dataset.refightBoss as BossId;
      const stageId = el.dataset.refightStage as StageId;
      if (this.callbacks.onStartRefight) {
        this.callbacks.onStartRefight(bossId, stageId);
      } else {
        this.callbacks.onSelectStage(stageId, false);
      }
    });
  }

  public dispose(): void {
    if (this.fileInputEl) {
      this.fileInputEl.remove();
      this.fileInputEl = null;
    }
    if (this.root) {
      this.root.innerHTML = '';
      this.root.classList.remove('kc-ui-active');
    }
  }
}
