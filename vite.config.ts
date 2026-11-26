import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

const MIME_MAP: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ttf': 'font/ttf',
  '.csv': 'text/csv; charset=utf-8',
  '.gcl': 'application/octet-stream',
};

function customPackMiddleware(): Plugin {
  const packRoot = path.resolve(__dirname, '.krunked-circuit-assets');
  const prefix = '/__custom_pack__/';

  return {
    name: 'krunked-circuit-custom-pack',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith(prefix)) {
          next();
          return;
        }
        const relPath = decodeURIComponent(req.url.slice(prefix.length).split('?')[0]);
        const normalized = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
        const fullPath = path.resolve(packRoot, normalized);
        if (!fullPath.startsWith(packRoot)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }
        if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ available: false, path: relPath }));
          return;
        }
        const ext = path.extname(fullPath).toLowerCase();
        res.statusCode = 200;
        res.setHeader('Content-Type', MIME_MAP[ext] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        fs.createReadStream(fullPath).pipe(res);
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [customPackMiddleware()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          'sim-core': ['./src/sim/runtime.ts'],
          'assets-audio': ['./src/assets/AssetRegistry.ts', './src/audio/AudioEngine.ts'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
