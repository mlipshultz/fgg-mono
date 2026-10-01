// Builds the design tokens into web CSS variables and a platform-neutral TS theme.
// Run: node build.mjs  (then tsc emits dist/theme.js + .d.ts from dist/ts/theme.ts)
import StyleDictionary from 'style-dictionary';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @param {any} token */
const valueOf = (token) => token.$value ?? token.value;
/** @param {any} token */
const typeOf = (token) => token.$type ?? token.type;

/** @param {string} family */
const fontStack = (family) => `'${family}', system-ui, sans-serif`;

/** @param {any} s */
const cssShadow = (s) => `${s.offsetX}px ${s.offsetY}px ${s.blur}px ${s.spread}px ${s.color}`;

/**
 * CSS custom properties. Dimensions get px, durations get ms, typography expands
 * into one variable per property, shadows become box-shadow shorthand.
 * @param {{ dictionary: { allTokens: any[] } }} args
 */
function cssFormat({ dictionary }) {
  const lines = [];
  for (const token of dictionary.allTokens) {
    const name = `--${token.name}`;
    const value = valueOf(token);
    switch (typeOf(token)) {
      case 'dimension':
      case 'number':
        lines.push(`  ${name}: ${typeOf(token) === 'dimension' ? `${value}px` : value};`);
        break;
      case 'duration':
        lines.push(`  ${name}: ${value}ms;`);
        break;
      case 'fontFamily':
        lines.push(`  ${name}: ${fontStack(value)};`);
        break;
      case 'shadow':
        lines.push(`  ${name}: ${cssShadow(value)};`);
        break;
      case 'typography':
        lines.push(`  ${name}-font-family: ${fontStack(value.fontFamily)};`);
        lines.push(`  ${name}-font-weight: ${value.fontWeight};`);
        lines.push(`  ${name}-font-size: ${value.fontSize}px;`);
        lines.push(`  ${name}-font-size-phone: ${value.fontSizePhone}px;`);
        lines.push(`  ${name}-line-height: ${value.lineHeight};`);
        lines.push(`  ${name}-letter-spacing: ${value.letterSpacing}px;`);
        if (value.textTransform) lines.push(`  ${name}-text-transform: ${value.textTransform};`);
        break;
      default:
        lines.push(`  ${name}: ${value};`);
    }
  }
  return `/* Generated from tokens.json. Do not edit. */\n:root {\n${lines.join('\n')}\n}\n`;
}

/**
 * Nested TS object with raw values (numbers stay numbers) for React Native and
 * any JS consumer. Fonts are family names; the app maps them to loaded faces.
 * @param {{ dictionary: { allTokens: any[] } }} args
 */
function tsFormat({ dictionary }) {
  /** @type {Record<string, any>} */
  const root = {};
  for (const token of dictionary.allTokens) {
    let node = root;
    const segs = token.path;
    for (const seg of segs.slice(0, -1)) node = node[seg] ??= {};
    node[segs[segs.length - 1]] = valueOf(token);
  }
  const body = JSON.stringify(root, null, 2);
  return `// Generated from tokens.json. Do not edit.\nexport const theme = ${body} as const;\n\nexport type Theme = typeof theme;\nexport type ColorName = keyof Theme['color'];\nexport type SpaceKey = keyof Theme['space'];\nexport type TypeStyle = keyof Theme['type'];\n`;
}

/** @param {{ dictionary: { allTokens: any[] } }} args */
function flatJsonFormat({ dictionary }) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const token of dictionary.allTokens)
    out[token.path.join('.')] = { type: typeOf(token), value: valueOf(token) };
  return JSON.stringify(out, null, 2) + '\n';
}

export async function build(outDir = path.join(here, 'dist')) {
  StyleDictionary.registerFormat({ name: 'fgg/css', format: cssFormat });
  StyleDictionary.registerFormat({ name: 'fgg/ts', format: tsFormat });
  StyleDictionary.registerFormat({ name: 'fgg/json-flat', format: flatJsonFormat });

  const sd = new StyleDictionary({
    source: [path.join(here, 'tokens.json')],
    log: { verbosity: 'silent' },
    platforms: {
      css: {
        transforms: ['name/kebab'],
        buildPath: path.join(outDir, 'css') + '/',
        files: [{ destination: 'tokens.css', format: 'fgg/css' }],
      },
      ts: {
        transforms: ['name/camel'],
        buildPath: path.join(outDir, 'ts') + '/',
        files: [{ destination: 'theme.ts', format: 'fgg/ts' }],
      },
      json: {
        buildPath: path.join(outDir, 'json') + '/',
        files: [{ destination: 'tokens.json', format: 'fgg/json-flat' }],
      },
    },
  });
  await sd.buildAllPlatforms();
  return outDir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await build();
  console.log('tokens built → dist/');
}
