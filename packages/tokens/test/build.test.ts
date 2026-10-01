import { describe, it, expect, beforeAll } from 'vitest';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from '../build.mjs';

let out: string;
beforeAll(async () => {
  out = await build(await mkdtemp(path.join(tmpdir(), 'fgg-tokens-')));
});

describe('tokens build', () => {
  it('emits CSS variables with resolved references and units', async () => {
    const css = await readFile(path.join(out, 'css/tokens.css'), 'utf8');
    expect(css).toContain('--color-yellow: #FFE15A;');
    expect(css).toContain('--status-open: #33EEDC;'); // reference resolved
    expect(css).toContain('--radius-card: 22px;');
    expect(css).toContain('--shadow-button: 3px 3px 0px 0px #141414;');
    expect(css).toContain('--type-hero-font-size: 84px;');
    expect(css).toContain('--type-hero-font-size-phone: 44px;');
    expect(css).toContain('--type-eyebrow-text-transform: uppercase;');
    expect(css).toContain('--motion-press: 120ms;');
    expect(css).toContain("--font-family-display: 'Fredoka'");
  });

  it('emits a nested TS theme with raw numbers', async () => {
    const ts = await readFile(path.join(out, 'ts/theme.ts'), 'utf8');
    expect(ts).toContain('export const theme = {');
    expect(ts).toMatch(/"card": 22[,\n]/);
    expect(ts).toContain('"color": "#141414"'); // shadow color resolved
    expect(ts).toContain('as const;');
  });

  it('emits a flat JSON map keyed by dotted path', async () => {
    const json = JSON.parse(await readFile(path.join(out, 'json/tokens.json'), 'utf8'));
    expect(json['color.ink'].value).toBe('#141414');
    expect(json['space.48'].value).toBe(48);
    expect(json['type.body'].value.fontFamily).toBe('Nunito');
  });
});
