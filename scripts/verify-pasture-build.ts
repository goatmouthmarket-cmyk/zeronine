import { readFileSync, existsSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import { inlinePastureRenderer } from '../src/api/pastureFrame.ts';

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp('(?:^|\\s)'+name+'\\s*=\\s*(?:"([^"]*)"|\\x27([^\\x27]*)\\x27|([^\\s>]+))','i').exec(attributes);
  return match ? match[1] ?? match[2] ?? match[3] : null;
}
/** Checks the assembled files Railway will serve; no network or account access. */
export function verifyPastureBuild(directory: string, sourceDirectory?: string): { assets: number; scripts: number } {
  const root = path.resolve(directory), files = new Set<string>();
  const read = (name: string): string => {
    const full = path.join(root, name);
    if (!existsSync(full)) throw Error('Web build is missing '+name);
    return readFileSync(full, 'utf8');
  };
  const localAsset = (reference: string): string | null => {
    const url = new URL(reference, 'https://web-build.invalid/');
    if (url.origin !== 'https://web-build.invalid') return null;
    const name = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const full = path.resolve(root, name), relative = path.relative(root, full);
    if (relative.startsWith('..'+path.sep) || path.isAbsolute(relative)) throw Error('Web asset leaves build directory: '+reference);
    if (!existsSync(full) || !statSync(full).isFile()) throw Error('Web build is missing referenced asset '+reference);
    files.add(full);
    return full;
  };
  const styles = (html: string): number => {
    let count = 0;
    for (const match of html.matchAll(/<link\b([^>]*)>/gi)) {
      if (!/\bstylesheet\b/i.test(attribute(match[1], 'rel') || '')) continue;
      const href = attribute(match[1], 'href');
      if (!href) throw Error('Web stylesheet has no href');
      if (localAsset(href)) count++;
    }
    return count;
  };
  const index = read('index.html');
  let bundles = 0;
  for (const match of index.matchAll(/<script\b([^>]*)>[\s\S]*?<\/script>/gi)) {
    const src = attribute(match[1], 'src');
    if (src && localAsset(src)) bundles++;
  }
  if (!bundles || !styles(index)) throw Error('Built index must reference its JavaScript and stylesheet assets');
  const frameHtml = read('trading-room.html'), renderer = read('trading-room-core.js');
  // Fastify inlines the source pair; Vite serves its copied dependencies from dist.
  // Check both sides so a stale public copy cannot pass a production build.
  if (sourceDirectory) {
    for (const [name, built] of [['trading-room.html', frameHtml], ['trading-room-core.js', renderer]]) {
      if (readFileSync(path.join(sourceDirectory, name), 'utf8') !== built) {
        throw Error('Built '+name+' does not match the runtime source');
      }
    }
  }
  const frame = inlinePastureRenderer(frameHtml, renderer);
  styles(frame);
  let scripts = 0;
  for (const match of frame.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const type = (attribute(match[1], 'type') || '').trim().toLowerCase();
    const src = attribute(match[1], 'src');
    const asset = src ? localAsset(src) : null;
    // ESM is validated by Vite; JSON/import maps are data, never classic scripts.
    if (type && !['text/javascript','application/javascript'].includes(type)) continue;
    if (src && !asset) continue;
    const source = asset ? readFileSync(asset, 'utf8') : match[2];
    if (!source.trim()) continue;
    new Script(source, { filename: asset ? path.relative(root, asset) : 'pasture-inline-'+scripts+'.js' });
    scripts++;
  }
  if (!scripts) throw Error('Built pasture contains no executable scripts');
  return { assets: files.size, scripts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = verifyPastureBuild(path.resolve('web/dist'), path.resolve('web/public'));
    console.info('[web build] Verified matching runtime source and built pasture, '+result.assets+' local assets and '+result.scripts+' pasture scripts.');
  } catch (error) {
    console.error('[web build] '+(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}

