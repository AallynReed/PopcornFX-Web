import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import { listPack } from './scripts/pack-index.mjs';

// PKFX_PACK_DIR (from the environment or .env.local) makes the dev server serve that
// folder at /@pack/, and the app opens it on startup, so a local game pack can be
// browsed without picking it on every reload.
function localPack(dir) {
  return {
    name: 'pkfx-local-pack',
    apply: 'serve',
    configureServer(server) {
      if (!dir) return;
      const root = path.resolve(dir);
      let index = null;
      server.middlewares.use('/@pack', (req, res) => {
        const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
        if (rel === 'index.json') {
          index ||= listPack(root);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(index));
          return;
        }
        const file = path.resolve(root, rel);
        if (!file.startsWith(root + path.sep)) { res.statusCode = 403; res.end(); return; }
        let st;
        try { st = statSync(file); } catch { st = null; }
        if (!st || !st.isFile()) { res.statusCode = 404; res.end(); return; }
        res.setHeader('Content-Length', st.size);
        createReadStream(file).pipe(res);
      });
      server.httpServer?.once('listening', () => server.config.logger.info(`  Serving the pack at ${root} under /@pack/`));
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [localPack(process.env.PKFX_PACK_DIR || loadEnv(mode, process.cwd(), 'PKFX_').PKFX_PACK_DIR)],
  build: { target: 'es2022', sourcemap: true },
}));
