import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('pasture header controls bracket navigation and reach the iframe safely', () => {
  const app = readFileSync(new URL('../web/src/App.tsx', import.meta.url), 'utf8');
  const playButton = app.indexOf('class={`room-header-action room-header-play');
  const hamburger = app.indexOf('class={`header-nav-toggle');
  const howToPlayButton = app.indexOf('class="room-header-action room-header-how-to"');

  assert.ok(playButton >= 0 && playButton < hamburger && hamburger < howToPlayButton);
  assert.match(app, /if \(window\.matchMedia\('\(min-width: 1000px\)'\)\.matches\)/);
  assert.match(app, /type: 'zeronine:room-auto-menu',\s*open: rangerAutoMenuOpen,\s*controls: true/);

  const room = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
  assert.match(room, /event\.origin!==location\.origin\|\|event\.source!==parent/);
  assert.match(room, /dispatchEvent\(new PointerEvent\('pointerdown'/);
  assert.match(room, /body\.ranger-auto-menu-open #playerHud/);
  assert.match(room, /body\.room-header-controls #rangerAutoToggle/);
  assert.match(room, /healthButton\.append\(ping\)/);
  assert.match(room, /ping\.textContent\.slice\(2\)/);
});
