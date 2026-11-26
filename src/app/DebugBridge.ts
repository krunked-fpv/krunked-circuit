// ============================================================================
// Krunked Circuit — Deterministic Debug & Verification Bridge
// Attaches window.__KRUNKED_DEBUG__ for live /browser QA, F9 Drawer, and tests.
// ============================================================================

import type { KrunkedDebugBridge } from '../contracts/index';

export function installDebugBridge(bridge: KrunkedDebugBridge): void {
  if (typeof window !== 'undefined') {
    window.__KRUNKED_DEBUG__ = bridge;
  }
}

export function uninstallDebugBridge(): void {
  if (typeof window !== 'undefined' && window.__KRUNKED_DEBUG__) {
    delete window.__KRUNKED_DEBUG__;
  }
}
