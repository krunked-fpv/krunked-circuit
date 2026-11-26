import './ui/styles.css';
import { GameApp } from './app/GameApp';

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    throw new Error('Krunked Circuit: missing #game-canvas element');
  }

  const app = new GameApp({
    canvas,
    uiRoot: document.getElementById('ui-layer'),
    touchRoot: document.getElementById('touch-layer'),
    toastRoot: document.getElementById('toast-layer'),
    debugRoot: document.getElementById('debug-drawer'),
  });

  await app.boot();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void bootstrap();
  });
} else {
  void bootstrap();
}
