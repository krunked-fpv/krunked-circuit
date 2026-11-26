# Krunked Circuit

A standalone, 60 Hz TypeScript + WebGL2 + Web Audio action-platformer built for crisp 400×240 pixel-art combat, 8-directional hookshot grappling and grab-throw chain combos, 20 Burst Techniques, 20 Booster Chips, 12 functional Armor Paints, 15 stages (+12 Master Remix layouts), 12 multi-phase bosses, 3 minibosses, 42 enemy archetypes, Boss Rush, and dual-mode Built-In / Owned Custom Pack rendering.

## Features
- **Exact 60 Hz Action-Platformer Feel**: Crisp walk/sprint momentum, 4-tick coyote time, jump buffering, sticky wall-slide & wall-jumps, automatic 1-tile ceiling-safe slide wedges, ledge grabs, and flowing multi-node scarf physics.
- **8-Directional Hookshot Grapple & Throw**: Sub-stepped high-speed grapple chain for wall zips, pendulum swings, switch triggers, and grabbing stunned foes, shattered shields, or explosive crates to hurl in 8 directions for explosive chain kills.
- **Full Arsenal & Progression**: 3 instant-swappable loadouts, 20 Burst Techniques, 20 Booster Chips, 12 functional Armor Paints with 6-color GPU palette swapping, 64 Rescuable Units, 53 Challenges, 100 Bestiary Data Chips, 3 Difficulties, 6 Modifiers, Circuit Mode, Speedrun Mode, and Boss Rush.
- **30 / 60 / 120 FPS Decoupled WebGL2 Renderer**: Integer/nearest-neighbor 400×240 pixel framebuffer with interpolation (`classicSnap60` option), custom palette/flash/heat-haze shaders, and Canvas2D fallback.
- **First-Class Multi-Modal Controls**:
  - Rebindable Keyboard presets.
  - Full Xbox, PlayStation, Switch Pro, Tesla In-Car USB/BT, and standard W3C Gamepad support with two presets, analog deadzone, trigger thresholds, hot-plug detection, dynamic button glyphs, and dual-rumble.
  - Touch-activated transparent mobile/tablet/Tesla touchscreen controls that stay strictly hidden until genuine touch input is detected and disappear immediately when keyboard or gamepad input resumes.
- **Dual Asset & Audio Modes**: Ships 100% self-contained with original 16-bit procedural pixel art and Web Audio FM/chiptune soundtrack, plus optional local Owned Custom Pack loading via IndexedDB or local dev extraction.

## Quick Start
```bash
npm install
npm run dev
```

## Verification & Build
```bash
npm run typecheck
npm run test
npm run verify:assets
npm run verify:sim
npm run build
```
