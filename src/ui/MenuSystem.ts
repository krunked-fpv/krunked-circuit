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

const COMPENDIUM_FILTERS: readonly { id: 'all' | DataChipDefinition['category']; label: string }[] = [
  { id: 'all', label: 'ALL' },
  { id: 'enemy', label: 'ENEMY' },
  { id: 'boss', label: 'BOSS' },
  { id: 'hero', label: 'HERO' },
  { id: 'world', label: 'WORLD' },
  { id: 'tech', label: 'TECH' },
];

const CHALLENGE_FILTERS: readonly { id: 'all' | ChallengeDefinition['category']; label: string }[] = [
  { id: 'all', label: 'ALL' },
  { id: 'combat', label: 'COMBAT' },
  { id: 'movement', label: 'MOVEMENT' },
  { id: 'boss', label: 'BOSS' },
  { id: 'collectible', label: 'COLLECTIBLE' },
  { id: 'mode', label: 'MODE' },
];

const COMPENDIUM_CAT_COLORS: Readonly<Record<DataChipDefinition['category'], string>> = {
  enemy: '#ff6b81',
  boss: '#ffd166',
  hero: '#5ce1ff',
  world: '#4dffb5',
  tech: '#c084fc',
};

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
  private compendiumFilter: 'all' | DataChipDefinition['category'] = 'all';
  private challengeFilter: 'all' | ChallengeDefinition['category'] = 'all';
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
      this.compendiumFilter,
      this.challengeFilter,
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
      p.clearedRemixes.length,
      p.collectedHealthBoosters.length,
      p.collectedBurstBoosters.length,
      Object.keys(p.bestTimesTicks).length,
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
        const playableStages = stages.filter((st) => st.id !== 'hub');
        const bosses = this.catalog.bosses ?? [];
        const clearedCount = playableStages.filter((st) => p.clearedStages.includes(st.id)).length;
        const remixClearedCount = REMIXABLE_STAGES.filter((id) => p.clearedRemixes.includes(id)).length;

        return `
          <div class="kc-hub-toolbar">
            <div class="kc-row">
              <span>SECTORS CLEARED: <strong style="color:#4dffb5">${clearedCount} / ${playableStages.length}</strong></span>
              <span class="kc-pill">REMIXES: ${remixClearedCount} / ${REMIXABLE_STAGES.length}</span>
              <span class="kc-pill">HP+: ${p.collectedHealthBoosters.length} &nbsp;|&nbsp; BST+: ${p.collectedBurstBoosters.length}</span>
            </div>
            <button type="button" class="kc-chip-btn kc-focusable ${this.remixSelected ? 'is-selected' : ''}" data-action="toggle-remix">
              MASTER REMIX: ${this.remixSelected ? 'ON' : 'OFF'}
            </button>
          </div>
          <div class="kc-card-grid">
            ${playableStages
              .map((st) => {
                const cleared = p.clearedStages.includes(st.id);
                const remixCleared = p.clearedRemixes.includes(st.id);
                const canRemix = REMIXABLE_STAGES.includes(st.id);
                const useRemix = this.remixSelected && canRemix;
                const hasHpBooster = p.collectedHealthBoosters.includes(st.id);
                const hasBurstBooster = p.collectedBurstBoosters.includes(st.id);
                const showBoosters = MAIN_EIGHT_STAGES.includes(st.id) || hasHpBooster || hasBurstBooster;
                const matchedBoss =
                  bosses.find((b) => (st.bossId ? b.id === st.bossId : b.stageId === st.id));
                const bossLabel = st.bossName ?? matchedBoss?.name;
                const bestTicks = p.bestTimesTicks[st.id];

                return `
                  <button type="button" class="kc-stage-card kc-focusable ${cleared ? 'is-cleared' : ''}" data-launch-stage="${st.id}" data-launch-remix="${useRemix ? '1' : '0'}">
                    <div class="kc-card-top">
                      <strong>${escapeHtml(st.name)}</strong>
                      <div class="kc-row" style="gap:4px">
                        ${cleared ? '<span class="kc-badge" style="color:#4dffb5;border-color:#2c8a66">CLEARED</span>' : '<span class="kc-badge">ACTIVE</span>'}
                        ${remixCleared ? '<span class="kc-badge" style="color:#ffd166;border-color:#b88a1e">REMIX CLEARED</span>' : ''}
                      </div>
                    </div>
                    <div class="kc-card-sub">${escapeHtml(st.subtitle)}</div>
                    ${
                      bossLabel
                        ? `<div style="font-size:10px;color:#fda4af;letter-spacing:0.06em">BOSS: <strong>${escapeHtml(bossLabel.toUpperCase())}</strong></div>`
                        : ''
                    }
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-top:2px;font-size:9px">
                      <div style="display:flex;align-items:center;gap:8px">
                        ${
                          showBoosters
                            ? `<span title="Health Booster" style="display:inline-flex;align-items:center;gap:3px;color:${hasHpBooster ? '#4dffb5' : '#64748b'}">
                                 <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${hasHpBooster ? '#4dffb5' : 'transparent'};border:1px solid ${hasHpBooster ? '#4dffb5' : '#475569'}"></span>HP
                               </span>
                               <span title="Burst Booster" style="display:inline-flex;align-items:center;gap:3px;color:${hasBurstBooster ? '#5ce1ff' : '#64748b'}">
                                 <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${hasBurstBooster ? '#5ce1ff' : 'transparent'};border:1px solid ${hasBurstBooster ? '#5ce1ff' : '#475569'}"></span>BST
                               </span>`
                            : `<span style="color:#64748b">${canRemix ? 'REMIX READY' : 'STANDARD ONLY'}</span>`
                        }
                      </div>
                      ${
                        bestTicks !== undefined
                          ? `<span style="color:#ffd166">${formatSpeedrunTicks(bestTicks)}</span>`
                          : useRemix
                            ? '<span class="kc-badge-remix">REMIX LAYOUT</span>'
                            : ''
                      }
                    </div>
                    ${useRemix && bestTicks !== undefined ? '<div class="kc-badge-remix">REMIX LAYOUT</div>' : ''}
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
        const chipNameById = (id: ChipId | 0): string => {
          if (id === 0) return 'EMPTY';
          return chips.find((c) => c.id === id)?.name ?? `#${id}`;
        };

        return `
          <div class="kc-hub-toolbar">
            <span>Target Chip Slot (Unlocked: ${p.unlockedChips.length} / ${chips.length || 20}):</span>
            <div class="kc-row">
              ${slots
                .map(
                  (si) =>
                    `<button type="button" class="kc-chip-btn kc-focusable ${this.selectedChipSlot === si ? 'is-selected' : ''}" data-chip-slot="${si}">SLOT ${si + 1}: ${escapeHtml(chipNameById(ld.chips[si]))}</button>`,
                )
                .join('')}
              <button type="button" class="kc-btn-xs kc-focusable" data-clear-chip-slot="${this.selectedChipSlot}">CLEAR SLOT</button>
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
                      const costText =
                        c.rescueTokens > 0
                          ? `${c.priceBits}B + ${c.rescueTokens}T`
                          : `${c.priceBits}B`;
                      return `
                        <button type="button" class="kc-item-card kc-focusable ${equipped ? 'is-equipped' : ''}" data-chip-id="${c.id}" data-chip-unlocked="${unlocked ? '1' : '0'}">
                          <div class="kc-card-top">
                            <strong>${escapeHtml(c.name)}</strong>
                            <span class="kc-badge" style="${equipped ? 'color:#4dffb5;border-color:#4dffb5' : unlocked ? '' : 'color:#ffd166;border-color:#8a6d1c'}">${equipped ? 'EQUIPPED' : unlocked ? 'OWNED' : costText}</span>
                          </div>
                          <div style="font-size:9px;color:#5ce1ff;letter-spacing:0.1em">${c.part.toUpperCase()} MODULE</div>
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
        const burstNameById = (id: BurstId | 0): string => {
          if (id === 0) return 'EMPTY';
          return bursts.find((b) => b.id === id)?.name ?? `#${id}`;
        };

        return `
          <div class="kc-hub-toolbar">
            <span>Directional Burst Slot (Unlocked: ${p.unlockedBursts.length} / ${bursts.length || 20}):</span>
            <div class="kc-row">
              ${bSlots
                .map(
                  (sl) =>
                    `<button type="button" class="kc-chip-btn kc-focusable ${this.selectedBurstSlot === sl ? 'is-selected' : ''}" data-burst-slot="${sl}">${sl.toUpperCase()}: ${escapeHtml(burstNameById(ld.bursts[sl]))}</button>`,
                )
                .join('')}
              <button type="button" class="kc-btn-xs kc-focusable" data-clear-burst-slot="${this.selectedBurstSlot}">CLEAR SLOT</button>
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
                        <button type="button" class="kc-item-card kc-focusable ${equipped ? 'is-equipped' : ''}" style="border-left:3px solid ${escapeHtml(b.color)}" data-burst-id="${b.id}" data-burst-unlocked="${unlocked ? '1' : '0'}">
                          <div class="kc-card-top">
                            <strong>${escapeHtml(b.name)}</strong>
                            <span class="kc-badge" style="${equipped ? 'color:#4dffb5;border-color:#4dffb5' : unlocked ? '' : 'color:#ffd166;border-color:#8a6d1c'}">${equipped ? 'EQUIPPED' : unlocked ? 'OWNED' : `${b.priceBits}B`}</span>
                          </div>
                          <div style="display:flex;justify-content:space-between;font-size:9px;color:#94a3b8;letter-spacing:0.08em">
                            <span style="color:${escapeHtml(b.color)}">${b.costCharges} CHG // DMG ${b.baseDamage}</span>
                            ${!unlocked && b.unlockStage ? `<span>SECTOR: ${escapeHtml(defaultStageLabel(b.unlockStage).toUpperCase())}</span>` : ''}
                          </div>
                          <div class="kc-card-sub">${escapeHtml(b.description)}</div>
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
        const activeArmor = armors.find((a) => a.id === ld.armorPaint);
        return `
          <div class="kc-hub-toolbar">
            <span>ARMOR PAINTS UNLOCKED: <strong style="color:#5ce1ff">${p.unlockedArmors.length} / ${armors.length || 12}</strong></span>
            ${
              activeArmor
                ? `<span class="kc-pill">ACTIVE: ${escapeHtml(activeArmor.name.toUpperCase())} — ${escapeHtml(activeArmor.traitName.toUpperCase())}</span>`
                : '<span>Functional Trait + Live 6-Color GPU Palette Swap</span>'
            }
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
                        .map(
                          (hex) =>
                            `<span class="kc-swatch" style="flex:1;height:12px;background:${escapeHtml(hex)}" title="${escapeHtml(hex)}"></span>`,
                        )
                        .join('');
                      const visorMini = `<span style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:14px;background:${escapeHtml(a.palette[2])};border:2px solid ${escapeHtml(a.palette[0])};box-shadow:inset 0 2px 0 ${escapeHtml(a.palette[3])}"><span style="width:8px;height:4px;background:${escapeHtml(a.palette[5])};display:block"></span></span>`;
                      return `
                        <button type="button" class="kc-item-card kc-focusable ${eq ? 'is-equipped' : unlocked ? '' : 'is-locked'}" ${!unlocked ? 'disabled' : ''} data-equip-armor="${a.id}">
                          <div class="kc-card-top">
                            <span style="display:inline-flex;align-items:center;gap:6px">${visorMini}<strong>${escapeHtml(a.name)}</strong></span>
                            <span class="kc-badge" style="${eq ? 'color:#4dffb5;border-color:#4dffb5' : unlocked ? 'color:#5ce1ff' : 'color:#94a3b8'}">${eq ? 'EQUIPPED' : unlocked ? 'OWNED' : 'LOCKED'}</span>
                          </div>
                          <div class="kc-swatch-row" style="width:100%;gap:2px;margin:2px 0">${swatches}</div>
                          <div style="font-size:10px;font-weight:700;color:#ffd166;letter-spacing:0.06em">TRAIT: ${escapeHtml(a.traitName.toUpperCase())}</div>
                          <div class="kc-card-sub">${escapeHtml(a.description)}</div>
                          ${
                            !unlocked && a.unlockStage
                              ? `<div style="font-size:9px;color:#94a3b8;margin-top:2px">FIND CHIP IN: ${escapeHtml(defaultStageLabel(a.unlockStage).toUpperCase())}</div>`
                              : ''
                          }
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
        const totalChips = entries.length || 100;
        const unlockedTotal = p.unlockedDataChips.length;
        const pct = Math.min(100, Math.round((unlockedTotal / Math.max(1, totalChips)) * 100));
        const filtered =
          this.compendiumFilter === 'all'
            ? entries
            : entries.filter((d) => d.category === this.compendiumFilter);

        return `
          <div class="kc-hub-toolbar" style="flex-direction:column;align-items:stretch;gap:8px">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <span>DATA CHIPS DECODED: <strong style="color:#5ce1ff">${unlockedTotal} / ${totalChips}</strong> (${pct}%)</span>
              <div style="flex:1;min-width:140px;max-width:260px;height:10px;background:#091121;border:1px solid #2c436b;overflow:hidden">
                <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#38bdf8,#4dffb5)"></div>
              </div>
            </div>
            <div class="kc-row">
              ${COMPENDIUM_FILTERS.map((f) => {
                const catEntries = f.id === 'all' ? entries : entries.filter((d) => d.category === f.id);
                const catUnlocked = catEntries.filter((d) => p.unlockedDataChips.includes(d.id)).length;
                return `<button type="button" class="kc-chip-btn kc-focusable ${this.compendiumFilter === f.id ? 'is-selected' : ''}" data-compendium-filter="${f.id}">${f.label} (${catUnlocked}/${catEntries.length})</button>`;
              }).join('')}
            </div>
          </div>
          <div class="kc-card-grid">
            ${
              filtered.length === 0
                ? '<div class="kc-empty">Defeat enemies, clear sectors, and explore vaults to decode all 100 Bestiary Data Chips.</div>'
                : filtered
                    .map((d) => {
                      const unlocked = p.unlockedDataChips.includes(d.id);
                      const catColor = COMPENDIUM_CAT_COLORS[d.category] ?? '#5ce1ff';
                      return `
                        <div class="kc-item-card ${unlocked ? '' : 'is-locked'}" style="${unlocked ? `border-left:3px solid ${catColor}` : ''}">
                          <div class="kc-card-top">
                            <strong>#${String(d.index).padStart(3, '0')} ${unlocked ? escapeHtml(d.title) : 'ENCRYPTED SIGNAL'}</strong>
                            <span class="kc-badge" style="color:${catColor};border-color:${catColor}">${d.category.toUpperCase()}</span>
                          </div>
                          <div class="kc-card-sub" style="${unlocked ? 'color:#d7e7ff' : ''}">${unlocked ? escapeHtml(d.lore) : 'Engage this target or sector in the field to decrypt archive lore.'}</div>
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
        const totalChallenges = list.length || 53;
        const doneCount = p.unlockedChallenges.length;
        const pct = Math.min(100, Math.round((doneCount / Math.max(1, totalChallenges)) * 100));
        const earnedBits = list
          .filter((ch) => p.unlockedChallenges.includes(ch.id))
          .reduce((acc, ch) => acc + ch.rewardBits, 0);
        const totalBits = list.reduce((acc, ch) => acc + ch.rewardBits, 0);
        const filtered =
          this.challengeFilter === 'all'
            ? list
            : list.filter((ch) => ch.category === this.challengeFilter);

        return `
          <div class="kc-hub-toolbar" style="flex-direction:column;align-items:stretch;gap:8px">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <span>CHALLENGES COMPLETED: <strong style="color:#4dffb5">${doneCount} / ${totalChallenges}</strong> (${pct}%)</span>
              <span class="kc-pill" style="color:#ffd166;border-color:#8a6d1c">REWARD BITS: ${earnedBits} / ${totalBits} B</span>
            </div>
            <div style="width:100%;height:12px;background:#091121;border:1px solid #2c436b;position:relative;overflow:hidden">
              <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#ffd166,#4dffb5)"></div>
            </div>
            <div class="kc-row">
              ${CHALLENGE_FILTERS.map((f) => {
                const catList = f.id === 'all' ? list : list.filter((ch) => ch.category === f.id);
                const catDone = catList.filter((ch) => p.unlockedChallenges.includes(ch.id)).length;
                return `<button type="button" class="kc-chip-btn kc-focusable ${this.challengeFilter === f.id ? 'is-selected' : ''}" data-challenge-filter="${f.id}">${f.label} (${catDone}/${catList.length})</button>`;
              }).join('')}
            </div>
          </div>
          <div class="kc-card-grid">
            ${
              filtered.length === 0
                ? '<div class="kc-empty">53 combat, speed, and boss mastery challenges tracked automatically.</div>'
                : filtered
                    .map((ch) => {
                      const done = p.unlockedChallenges.includes(ch.id);
                      return `
                        <div class="kc-item-card ${done ? 'is-cleared' : ''}" style="${done ? 'border-left:3px solid #4dffb5' : ''}">
                          <div class="kc-card-top">
                            <strong>${escapeHtml(ch.name)}</strong>
                            <span class="kc-badge" style="${done ? 'color:#4dffb5;border-color:#2c8a66' : 'color:#ffd166;border-color:#8a6d1c'}">${done ? `DONE • +${ch.rewardBits}B` : `+${ch.rewardBits} BITS`}</span>
                          </div>
                          <div style="font-size:9px;color:#5ce1ff;letter-spacing:0.1em">${ch.category.toUpperCase()}</div>
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
            <p>Practice 8-dir grapple zips, guard-breaking Air Up-Kicks, shield throws, and Burst combos in a safe VR calibration arena.</p>
            <div class="kc-card-grid">
              <div class="kc-item-card" style="cursor:default">
                <div class="kc-card-top"><strong>GUARD-BREAK LOOP</strong><span class="kc-badge">COMBAT</span></div>
                <div class="kc-card-sub">Use Sprint Kick, Up+Attack, or Heavy Dive-Kick to shatter enemy shields, then Hookshot grab &amp; throw!</div>
              </div>
              <div class="kc-item-card" style="cursor:default">
                <div class="kc-card-top"><strong>8-DIR GRAPPLE</strong><span class="kc-badge">MOBILITY</span></div>
                <div class="kc-card-sub">Aim with directional keys/stick and fire Hookshot to zip to walls, pendulum-swing across chasms, or snatch Bits.</div>
              </div>
              <div class="kc-item-card" style="cursor:default">
                <div class="kc-card-top"><strong>DIRECTIONAL BURSTS</strong><span class="kc-badge">BURST</span></div>
                <div class="kc-card-sub">Hold Neutral, Side, Up, or Down + Burst to fire any of your 4 equipped techniques. Swap 3 loadouts on the fly!</div>
              </div>
            </div>
            <div class="kc-row">
              <button type="button" class="kc-btn kc-btn-primary kc-focusable" data-launch-stage="tutorial" data-launch-remix="0">ENTER TRAINING COURSE</button>
              <button type="button" class="kc-btn kc-focusable" data-action="cycle-loadout">CYCLE LOADOUT [${p.activeLoadoutIndex + 1}/3]</button>
            </div>
          </div>
        `;

      case 'refight_terminal': {
        const bosses = this.catalog.bosses ?? [];
        return `
          <div class="kc-hub-toolbar">
            <span>Instant Circuit Master Rematch Simulator (${bosses.length} Encounters)</span>
            <button type="button" class="kc-chip-btn kc-focusable" data-action="boss-rush">LAUNCH FULL BOSS RUSH</button>
          </div>
          <div class="kc-card-grid">
            ${
              bosses.length === 0
                ? '<div class="kc-empty">Defeat Circuit Masters to challenge them directly here.</div>'
                : bosses
                    .map((b) => {
                      const defeated = p.clearedStages.includes(b.stageId);
                      const swatches = b.palette
                        .map((hex) => `<span class="kc-swatch" style="flex:1;height:6px;background:${escapeHtml(hex)}"></span>`)
                        .join('');
                      return `
                        <button type="button" class="kc-stage-card kc-focusable ${defeated ? 'is-cleared' : ''}" data-refight-boss="${b.id}" data-refight-stage="${b.stageId}">
                          <div class="kc-card-top">
                            <strong>${escapeHtml(b.name)}</strong>
                            <span class="kc-badge" style="${defeated ? 'color:#4dffb5;border-color:#2c8a66' : ''}">${defeated ? 'DEFEATED' : `${b.baseHp} HP`}</span>
                          </div>
                          <div class="kc-swatch-row" style="width:100%;gap:2px">${swatches}</div>
                          <div class="kc-card-sub">${escapeHtml(b.title)} • ${b.baseHp} HP • ${b.phases} PHASES</div>
                        </button>
                      `;
                    })
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

    clickBind('[data-clear-chip-slot]', (el) => {
      const slot = Number(el.dataset.clearChipSlot) as 0 | 1 | 2;
      this.callbacks.onEquipChip?.(slot, 0);
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

    clickBind('[data-clear-burst-slot]', (el) => {
      const slot = el.dataset.clearBurstSlot as keyof BurstSlots;
      this.callbacks.onEquipBurst?.(slot, 0);
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

    clickBind('[data-compendium-filter]', (el) => {
      this.compendiumFilter = el.dataset.compendiumFilter as 'all' | DataChipDefinition['category'];
      this.focusIndex = 0;
      this.lastRenderKey = '';
      this.sync(snap);
    });

    clickBind('[data-challenge-filter]', (el) => {
      this.challengeFilter = el.dataset.challengeFilter as 'all' | ChallengeDefinition['category'];
      this.focusIndex = 0;
      this.lastRenderKey = '';
      this.sync(snap);
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
