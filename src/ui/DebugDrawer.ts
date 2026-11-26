// ============================================================================
// Krunked Circuit — Dev-Only F9 Playtest & Telemetry Drawer
// Provides instant stage switching, Remix toggle, Warp to Boss, Heal/Full Burst,
// Unlock All, 12-Armor Paint switcher, and live FPS/Hash/Modality/Touch readout.
// Zero direct imports from src/assets/*, src/data/*, or src/sim/*.
// ============================================================================

import {
  OFFICIAL_STAGE_IDS,
  type ArmorPaintId,
  type AssetMode,
  type InputModality,
  type StageId,
  type TouchOverlayState,
} from '../contracts/index';

export interface DebugDiagnostics {
  readonly fps: number;
  readonly hash: string;
  readonly tick: number;
  readonly stageId: StageId;
  readonly remix: boolean;
  readonly modality: InputModality;
  readonly touchState: TouchOverlayState;
  readonly assetMode: AssetMode;
  readonly rendererBackend?: 'webgl2' | 'canvas2d';
  readonly playerX: number;
  readonly playerY: number;
  readonly playerHp: number;
  readonly playerMaxHp: number;
  readonly burstEnergy: number;
  readonly activeArmorId: ArmorPaintId;
}

export interface DebugDrawerCallbacks {
  onLoadStage: (stageId: StageId, remix: boolean) => void;
  onWarpToBoss: () => void;
  onHealFull: () => void;
  onFullBurst: () => void;
  onUnlockAll: () => void;
  onEquipArmor: (armorId: ArmorPaintId) => void;
  onSetAssetMode?: (mode: AssetMode) => void;
  onTestTouchOverlay?: () => void;
  onTestXboxGamepad?: () => void;
  getDiagnostics: () => DebugDiagnostics;
}

export class DebugDrawer {
  private readonly container: HTMLElement | null;
  private readonly callbacks: DebugDrawerCallbacks;
  private open = false;
  private pollTimer: number | null = null;

  private stageSelectEl: HTMLSelectElement | null = null;
  private remixCheckEl: HTMLInputElement | null = null;
  private statsEl: HTMLElement | null = null;
  private armorButtons: HTMLButtonElement[] = [];

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'F9') {
      e.preventDefault();
      this.toggle();
    }
  };

  constructor(container: HTMLElement | null, callbacks: DebugDrawerCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    if (this.container) {
      this.container.classList.add('hidden');
      this.mountDom(this.container);
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', this.handleKeyDown);
    }
  }

  public isOpen(): boolean {
    return this.open;
  }

  public toggle(): void {
    this.setOpen(!this.open);
  }

  public setOpen(next: boolean): void {
    this.open = next;
    if (!this.container) return;

    if (this.open) {
      this.container.classList.remove('hidden');
      this.refreshTelemetry();
      if (this.pollTimer === null && typeof window !== 'undefined') {
        this.pollTimer = window.setInterval(() => this.refreshTelemetry(), 120);
      }
    } else {
      this.container.classList.add('hidden');
      if (this.pollTimer !== null && typeof window !== 'undefined') {
        window.clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    }
  }

  private mountDom(root: HTMLElement): void {
    if (typeof document === 'undefined') return;
    root.innerHTML = `
      <div class="kc-debug-header">
        <strong>DEV PLAYTEST [F9]</strong>
        <button type="button" class="kc-btn-xs" data-dbg="close">X</button>
      </div>

      <div class="kc-debug-stats" data-dbg="stats"></div>

      <div class="kc-debug-section">
        <label class="kc-debug-label">Stage Warp</label>
        <div class="kc-debug-row">
          <select class="kc-debug-select" data-dbg="stage">
            ${OFFICIAL_STAGE_IDS.map((id) => `<option value="${id}">${id}</option>`).join('')}
          </select>
          <label class="kc-debug-check">
            <input type="checkbox" data-dbg="remix" /> Remix
          </label>
        </div>
        <button type="button" class="kc-btn-xs kc-btn-wide" data-dbg="load-stage">LOAD STAGE</button>
      </div>

      <div class="kc-debug-section">
        <label class="kc-debug-label">Quick Cheats &amp; Input QA</label>
        <div class="kc-debug-grid2">
          <button type="button" class="kc-btn-xs" data-dbg="warp-boss">WARP BOSS</button>
          <button type="button" class="kc-btn-xs" data-dbg="heal">HEAL FULL</button>
          <button type="button" class="kc-btn-xs" data-dbg="burst">FULL BURST</button>
          <button type="button" class="kc-btn-xs" data-dbg="unlock-all">UNLOCK ALL</button>
          <button type="button" class="kc-btn-xs" data-dbg="test-touch">TEST TOUCH UI</button>
          <button type="button" class="kc-btn-xs" data-dbg="test-pad">TEST XBOX PAD</button>
        </div>
      </div>

      <div class="kc-debug-section">
        <label class="kc-debug-label">Armor Paint (0-11)</label>
        <div class="kc-debug-armor-grid" data-dbg="armors">
          ${Array.from({ length: 12 }, (_, i) => `<button type="button" class="kc-btn-xs" data-dbg-armor="${i}">${i}</button>`).join('')}
        </div>
      </div>
    `;

    this.stageSelectEl = root.querySelector<HTMLSelectElement>('[data-dbg="stage"]');
    this.remixCheckEl = root.querySelector<HTMLInputElement>('[data-dbg="remix"]');
    this.statsEl = root.querySelector<HTMLElement>('[data-dbg="stats"]');
    this.armorButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-dbg-armor]'));

    root.querySelector('[data-dbg="close"]')?.addEventListener('click', () => this.setOpen(false));
    root.querySelector('[data-dbg="load-stage"]')?.addEventListener('click', () => {
      const stageId = (this.stageSelectEl?.value ?? 'opening') as StageId;
      const remix = Boolean(this.remixCheckEl?.checked);
      this.callbacks.onLoadStage(stageId, remix);
      this.refreshTelemetry();
    });
    root.querySelector('[data-dbg="warp-boss"]')?.addEventListener('click', () => {
      this.callbacks.onWarpToBoss();
      this.refreshTelemetry();
    });
    root.querySelector('[data-dbg="heal"]')?.addEventListener('click', () => {
      this.callbacks.onHealFull();
      this.refreshTelemetry();
    });
    root.querySelector('[data-dbg="burst"]')?.addEventListener('click', () => {
      this.callbacks.onFullBurst();
      this.refreshTelemetry();
    });
    root.querySelector('[data-dbg="unlock-all"]')?.addEventListener('click', () => {
      this.callbacks.onUnlockAll();
      this.refreshTelemetry();
    });
    root.querySelector('[data-dbg="test-touch"]')?.addEventListener('click', () => {
      this.callbacks.onTestTouchOverlay?.();
      this.refreshTelemetry();
    });
    root.querySelector('[data-dbg="test-pad"]')?.addEventListener('click', () => {
      this.callbacks.onTestXboxGamepad?.();
      this.refreshTelemetry();
    });

    this.armorButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.dbgArmor) as ArmorPaintId;
        this.callbacks.onEquipArmor(id);
        this.refreshTelemetry();
      });
    });
  }

  public refreshTelemetry(): void {
    if (!this.open || !this.statsEl) return;
    const d = this.callbacks.getDiagnostics();

    this.statsEl.textContent = [
      `FPS: ${Math.round(d.fps)} | TICK: ${d.tick} | ${d.rendererBackend ?? 'webgl2'}`,
      `HASH: ${d.hash}`,
      `STAGE: ${d.stageId}${d.remix ? ' [REMIX]' : ''} | ART: ${d.assetMode}`,
      `INPUT: ${d.modality.toUpperCase()} | TOUCH: ${d.touchState.visible ? 'VISIBLE' : 'HIDDEN'}`,
      `POS: (${Math.round(d.playerX)}, ${Math.round(d.playerY)}) HP: ${Math.ceil(d.playerHp)}/${d.playerMaxHp} B: ${Math.floor(d.burstEnergy)}`,
    ].join('\n');

    if (this.stageSelectEl && this.stageSelectEl.value !== d.stageId && document.activeElement !== this.stageSelectEl) {
      this.stageSelectEl.value = d.stageId;
    }
    if (this.remixCheckEl && document.activeElement !== this.remixCheckEl) {
      this.remixCheckEl.checked = d.remix;
    }
    for (let i = 0; i < this.armorButtons.length; i++) {
      this.armorButtons[i].classList.toggle('is-selected', i === d.activeArmorId);
    }
  }

  public dispose(): void {
    if (this.pollTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('keydown', this.handleKeyDown);
    }
    if (this.container) {
      this.container.innerHTML = '';
      this.container.classList.add('hidden');
    }
  }
}
