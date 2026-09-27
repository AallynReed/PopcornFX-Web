// A self-contained pack for first-time visitors: an effect authored for this project
// plus textures drawn at load time, so the repository ships no binary art.
import { Pack } from '../../io/pack.js';
import campfire from './campfire.pkfx?raw';

const DEMO_EFFECT = 'Particles/campfire.pkfx';

async function paint(width, height, draw) {
  const canvas = new OffscreenCanvas(width, height);
  draw(canvas.getContext('2d'), width, height);
  return canvas.convertToBlob({ type: 'image/png' });
}

// soft round glow, white so the particle colour tints it
const glow = () => paint(128, 128, (cx, w, h) => {
  const g = cx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  cx.fillStyle = g;
  cx.fillRect(0, 0, w, h);
});

// ribbon strip: constant along U, soft across V
const streak = () => paint(16, 64, (cx, w, h) => {
  const g = cx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  cx.fillStyle = g;
  cx.fillRect(0, 0, w, h);
});

export function demoPack() {
  const text = new Blob([campfire], { type: 'text/plain' });
  const lazy = (make) => { let p; return () => (p ||= make()); };
  return new Pack([
    { path: 'Demo/popcornproject.xml', blob: async () => new Blob(['<PopcornProject />']) },
    { path: `Demo/${DEMO_EFFECT}`, size: text.size, blob: async () => text },
    { path: 'Demo/Textures/demo_glow.png', blob: lazy(glow) },
    { path: 'Demo/Textures/demo_streak.png', blob: lazy(streak) },
  ], { name: 'Demo' });
}
