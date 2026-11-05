import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
let checked = 0;
for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
  new Script(match[1], { filename: `trading-room-inline-${++checked}.js` });
}
if (!checked) throw new Error('no inline scripts found');
console.log(`Parsed ${checked} inline scripts`);
