// ============================================================================
// Krunked Circuit — Touch-Activated Semi-Transparent Overlay Controls
// NON-NEGOTIABLE TASTE_NOTES MANDATE:
//  - STRICTLY HIDDEN BY DEFAULT (`class="touch-hidden"`, `aria-hidden="true"`,
//    `visible === false`) on boot & whenever Keyboard, Mouse, or Gamepad is used.
//  - Reveals ONLY on genuine touch (`pointerdown` with `pointerType === 'touch'`
//    or `touchstart`).
//  - Hides IMMEDIATELY when `setVisible(false)` is triggered by any keyboard key
//    or gamepad input.
//  - Ultra-clean translucent pixel-outline controls (0.32 idle / 0.62 active),
//    8-dir thumbstick with glowing directional wedge + diagonal slide gesture,
//    full multi-touch pointerId tracking, safe-area inset responsive layout.
// ============================================================================

import {
  GAMEPAD_CONSTANTS,
  type TouchOverlayState,
} from '../contracts/index';

export interface TouchPollResult {
  active: boolean;
  moveX: -1 | 0 | 1;
  moveY: -1 | 0 | 1;
  aimX: -1 | 0 | 1;
  aimY: -1 | 0 | 1;
  jump: boolean;
  attack: boolean;
  hookshot: boolean;
  burst: boolean;
  sprint: boolean;
  slide: boolean;
  swapLoadout: boolean;
  pause: boolean;
  accept: boolean;
  cancel: boolean;
}

export interface TouchOverlayOptions {
  onTouchDetected?: () => void;
}

type TouchButtonId = 'jump' | 'attack' | 'hookshot' | 'burst' | 'sprint' | 'slide' | 'swap' | 'pause';

const STICK_RADIUS = 52;
const STICK_DEADZONE = 0.2;
const OCTANT_SIN = Math.sin(Math.PI / 8);

export class TouchOverlay {
  private readonly container: HTMLElement | null;
  private readonly onTouchDetected?: () => void;

  // STRICTLY HIDDEN BY DEFAULT
  private visible = false;
  private stickDx = 0;
  private stickDy = 0;
  private stickPointerId: number | null = null;
  private stickOriginX = 0;
  private stickOriginY = 0;
  private diagonalSlideGesture = false;
  private sprintToggled = false;

  private readonly activeButtons: Record<TouchButtonId, boolean> = {
    jump: false,
    attack: false,
    hookshot: false,
    burst: false,
    sprint: false,
    slide: false,
    swap: false,
    pause: false,
  };

  private readonly pointerButtonMap = new Map<number, TouchButtonId>();
  private readonly buttonElements = new Map<TouchButtonId, HTMLElement>();

  private stickZoneEl: HTMLElement | null = null;
  private stickNubEl: HTMLElement | null = null;
  private stickWedgeEl: HTMLElement | null = null;

  private readonly handleWindowPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      this.revealFromTouch();
    }
  };

  private readonly handleWindowTouchStart = (): void => {
    this.revealFromTouch();
  };

  constructor(container: HTMLElement | null, options: TouchOverlayOptions = {}) {
    this.container = container;
    this.onTouchDetected = options.onTouchDetected;

    if (this.container) {
      this.mountDom(this.container);
      // Enforce strict hidden initial state immediately
      this.applyVisibilityClasses(false);
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pointerdown', this.handleWindowPointerDown, { passive: true });
      window.addEventListener('touchstart', this.handleWindowTouchStart, { passive: true });
    }
  }

  private revealFromTouch(): void {
    if (!this.visible) {
      this.setVisible(true);
    }
    this.onTouchDetected?.();
  }

  private applyVisibilityClasses(show: boolean): void {
    if (!this.container) return;
    if (show) {
      this.container.classList.remove('touch-hidden');
      this.container.classList.add('touch-visible');
      this.container.setAttribute('aria-hidden', 'false');
    } else {
      this.container.classList.add('touch-hidden');
      this.container.classList.remove('touch-visible');
      this.container.setAttribute('aria-hidden', 'true');
    }
  }

  public setVisible(v: boolean): void {
    this.visible = Boolean(v);
    this.applyVisibilityClasses(this.visible);
    if (!this.visible) {
      this.clearAllInputs();
    }
  }

  public isVisible(): boolean {
    return this.visible;
  }

  public getState(): TouchOverlayState {
    return {
      visible: this.visible,
      opacityIdle: GAMEPAD_CONSTANTS.TOUCH_IDLE_OPACITY,
      opacityActive: GAMEPAD_CONSTANTS.TOUCH_ACTIVE_OPACITY,
      stickDx: this.stickDx,
      stickDy: this.stickDy,
      activeButtons: { ...this.activeButtons },
    };
  }

  private clearAllInputs(): void {
    this.stickPointerId = null;
    this.stickDx = 0;
    this.stickDy = 0;
    this.diagonalSlideGesture = false;
    this.pointerButtonMap.clear();
    const keys = Object.keys(this.activeButtons) as TouchButtonId[];
    for (let i = 0; i < keys.length; i++) {
      this.activeButtons[keys[i]] = false;
      this.buttonElements.get(keys[i])?.classList.remove('is-active');
    }
    this.updateStickVisuals();
  }

  private mountDom(root: HTMLElement): void {
    if (typeof document === 'undefined') return;
    root.innerHTML = '';

    // Top-corner subtle low-opacity utility pills (SWAP & PAUSE)
    const topBar = document.createElement('div');
    topBar.className = 'touch-top-bar';

    const swapPill = this.createButtonEl('swap', 'SWAP', 'touch-control touch-pill touch-swap');
    const pausePill = this.createButtonEl('pause', 'PAUSE', 'touch-control touch-pill touch-pause');
    topBar.appendChild(swapPill);
    topBar.appendChild(pausePill);
    root.appendChild(topBar);

    // Bottom interactive clusters
    const bottomRow = document.createElement('div');
    bottomRow.className = 'touch-bottom-row';

    // Left: 8-dir translucent thumbstick / D-pad ring with glowing directional wedge
    const leftZone = document.createElement('div');
    leftZone.className = 'touch-left-zone';

    const stickBase = document.createElement('div');
    stickBase.className = 'touch-control touch-stick-base';
    stickBase.setAttribute('data-touch-control', 'stick');

    const ring = document.createElement('div');
    ring.className = 'touch-stick-ring';

    const wedge = document.createElement('div');
    wedge.className = 'touch-stick-wedge';

    const nub = document.createElement('div');
    nub.className = 'touch-stick-nub';

    stickBase.appendChild(ring);
    stickBase.appendChild(wedge);
    stickBase.appendChild(nub);
    leftZone.appendChild(stickBase);

    this.stickZoneEl = stickBase;
    this.stickWedgeEl = wedge;
    this.stickNubEl = nub;
    this.bindStickEvents(stickBase);

    // Right: Ergonomic thumb cluster (JUMP, ATK, HOOK, BURST, SPRINT, SLIDE)
    const rightZone = document.createElement('div');
    rightZone.className = 'touch-right-zone';

    const btnBurst = this.createButtonEl('burst', 'BURST', 'touch-control touch-btn touch-btn-burst');
    const btnHook = this.createButtonEl('hookshot', 'HOOK', 'touch-control touch-btn touch-btn-hook');
    const btnSprint = this.createButtonEl('sprint', 'SPR', 'touch-control touch-btn touch-btn-sprint');
    const btnAtk = this.createButtonEl('attack', 'ATK', 'touch-control touch-btn touch-btn-atk');
    const btnJump = this.createButtonEl('jump', 'JUMP', 'touch-control touch-btn touch-btn-jump');
    const btnSlide = this.createButtonEl('slide', 'SLD', 'touch-control touch-btn touch-btn-slide');

    rightZone.appendChild(btnBurst);
    rightZone.appendChild(btnHook);
    rightZone.appendChild(btnSprint);
    rightZone.appendChild(btnAtk);
    rightZone.appendChild(btnJump);
    rightZone.appendChild(btnSlide);

    bottomRow.appendChild(leftZone);
    bottomRow.appendChild(rightZone);
    root.appendChild(bottomRow);
  }

  private createButtonEl(id: TouchButtonId, label: string, className: string): HTMLElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = className;
    el.textContent = label;
    el.setAttribute('data-touch-btn', id);
    el.setAttribute('aria-label', label);
    el.tabIndex = -1;

    el.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      e.preventDefault();
      e.stopPropagation();
      this.revealFromTouch();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Ignore capture failures on synthetic events
      }
      this.pointerButtonMap.set(e.pointerId, id);
      if (id === 'sprint') {
        this.sprintToggled = !this.sprintToggled;
        this.activeButtons.sprint = true;
      } else {
        this.activeButtons[id] = true;
      }
      el.classList.add('is-active');
    });

    const release = (e: PointerEvent): void => {
      const mapped = this.pointerButtonMap.get(e.pointerId);
      if (mapped !== id) return;
      this.pointerButtonMap.delete(e.pointerId);

      // Only release if no other pointer is still pressing this button
      let stillHeld = false;
      for (const btn of this.pointerButtonMap.values()) {
        if (btn === id) {
          stillHeld = true;
          break;
        }
      }
      if (!stillHeld) {
        this.activeButtons[id] = id === 'sprint' ? this.sprintToggled : false;
        if (!this.activeButtons[id]) {
          el.classList.remove('is-active');
        }
      }
    };

    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);

    this.buttonElements.set(id, el);
    return el;
  }

  private bindStickEvents(el: HTMLElement): void {
    el.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      e.preventDefault();
      e.stopPropagation();
      this.revealFromTouch();
      if (this.stickPointerId !== null) return;
      this.stickPointerId = e.pointerId;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Ignore capture failure
      }
      const rect = el.getBoundingClientRect();
      this.stickOriginX = rect.left + rect.width * 0.5;
      this.stickOriginY = rect.top + rect.height * 0.5;
      this.updateStickFromPoint(e.clientX, e.clientY);
      el.classList.add('is-active');
    });

    el.addEventListener('pointermove', (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointerId) return;
      e.preventDefault();
      this.updateStickFromPoint(e.clientX, e.clientY);
    });

    const endStick = (e: PointerEvent): void => {
      if (e.pointerId !== this.stickPointerId) return;
      this.stickPointerId = null;
      this.stickDx = 0;
      this.stickDy = 0;
      this.diagonalSlideGesture = false;
      el.classList.remove('is-active');
      this.updateStickVisuals();
    };

    el.addEventListener('pointerup', endStick);
    el.addEventListener('pointercancel', endStick);
    el.addEventListener('lostpointercapture', endStick);
  }

  private updateStickFromPoint(clientX: number, clientY: number): void {
    const rawX = clientX - this.stickOriginX;
    const rawY = clientY - this.stickOriginY;
    const dist = Math.hypot(rawX, rawY);
    const clampedDist = Math.min(dist, STICK_RADIUS);
    const angle = Math.atan2(rawY, rawX);

    if (dist < 4) {
      this.stickDx = 0;
      this.stickDy = 0;
      this.diagonalSlideGesture = false;
    } else {
      const normMag = clampedDist / STICK_RADIUS;
      this.stickDx = Math.cos(angle) * normMag;
      this.stickDy = Math.sin(angle) * normMag;
      // Diagonal down-left or down-right push near outer rim triggers smooth slide gesture
      this.diagonalSlideGesture =
        normMag > 0.86 && this.stickDy > 0.52 && Math.abs(this.stickDx) > 0.42;
    }

    this.updateStickVisuals();
  }

  private updateStickVisuals(): void {
    if (this.stickNubEl) {
      const ox = Math.round(this.stickDx * 30);
      const oy = Math.round(this.stickDy * 30);
      this.stickNubEl.style.transform = `translate(${ox}px, ${oy}px)`;
    }
    if (this.stickWedgeEl) {
      const mag = Math.hypot(this.stickDx, this.stickDy);
      if (mag < STICK_DEADZONE) {
        this.stickWedgeEl.style.opacity = '0';
      } else {
        const deg = Math.round((Math.atan2(this.stickDy, this.stickDx) * 180) / Math.PI / 45) * 45;
        this.stickWedgeEl.style.opacity = '0.9';
        this.stickWedgeEl.style.transform = `rotate(${deg + 90}deg)`;
      }
    }
    if (this.stickZoneEl) {
      this.stickZoneEl.classList.toggle('is-active', this.stickPointerId !== null);
    }
  }

  public pollTouchInput(): TouchPollResult {
    if (!this.visible) {
      return {
        active: false,
        moveX: 0,
        moveY: 0,
        aimX: 0,
        aimY: 0,
        jump: false,
        attack: false,
        hookshot: false,
        burst: false,
        sprint: false,
        slide: false,
        swapLoadout: false,
        pause: false,
        accept: false,
        cancel: false,
      };
    }

    const mag = Math.hypot(this.stickDx, this.stickDy);
    let moveX: -1 | 0 | 1 = 0;
    let moveY: -1 | 0 | 1 = 0;
    if (mag >= STICK_DEADZONE) {
      const nx = this.stickDx / mag;
      const ny = this.stickDy / mag;
      moveX = Math.abs(nx) >= OCTANT_SIN ? (nx > 0 ? 1 : -1) : 0;
      moveY = Math.abs(ny) >= OCTANT_SIN ? (ny > 0 ? 1 : -1) : 0;
    }

    const jump = this.activeButtons.jump;
    const attack = this.activeButtons.attack;
    const hookshot = this.activeButtons.hookshot;
    const burst = this.activeButtons.burst;
    const sprint = this.activeButtons.sprint || this.sprintToggled;
    const slide = this.activeButtons.slide || this.diagonalSlideGesture;
    const swapLoadout = this.activeButtons.swap;
    const pause = this.activeButtons.pause;

    const active =
      this.stickPointerId !== null ||
      jump ||
      attack ||
      hookshot ||
      burst ||
      this.activeButtons.sprint ||
      slide ||
      swapLoadout ||
      pause;

    return {
      active,
      moveX,
      moveY,
      aimX: moveX,
      aimY: moveY,
      jump,
      attack,
      hookshot,
      burst,
      sprint,
      slide,
      swapLoadout,
      pause,
      accept: jump,
      cancel: attack,
    };
  }

  public dispose(): void {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('pointerdown', this.handleWindowPointerDown);
      window.removeEventListener('touchstart', this.handleWindowTouchStart);
    }
    this.clearAllInputs();
    if (this.container) {
      this.container.innerHTML = '';
      this.applyVisibilityClasses(false);
    }
  }
}
