import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const fixture = (name) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
export const demoEffect = () => readFileSync(fileURLToPath(new URL('../src/app/demo/campfire.pkfx', import.meta.url)), 'utf8');

/** Deterministic uniform [0, 1) source. */
export function seededRandom(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
