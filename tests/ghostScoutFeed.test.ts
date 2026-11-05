import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

// The Ghost Scout only trades what the public scanner publishes, so the scanner
// must keep running in multiplayer mode. Watch mode is scan-only (it returns
// before quoting while no bot run is active; see automationReconcile.test.ts),
// and the account-isolation stop must stay in place.
test('the public scanner feeds the ghost scout in multiplayer without account orders', () => {
  assert.match(main, /^\s*automation\.watch\(\);$/m, 'watch mode starts unconditionally');
  assert.doesNotMatch(main, /if \(!multiplayerStore\) automation\.watch\(\)/, 'multiplayer no longer skips the scanner');
  assert.match(main, /automation\.stop\('multiplayer account isolation'\)/, 'account isolation stop is retained');
  assert.match(main, /paperSimulator\.start\(\)/, 'the virtual paper simulator still starts for every mode');
});

test('paper research stays isolated from account execution', () => {
  assert.match(main, /paperSimulator\.onTick\(/, 'the simulator settles from public ticks only');
  assert.doesNotMatch(main, /paperSimulator[\s\S]{0,400}client\.(getQuote|buy)\(/, 'the simulator never touches the private trading lane');
});
