import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

// The pasture shares Core candidates in multiplayer. Publishing market data
// must not restart the archived account scanner or private order lane.
test('multiplayer publishes canonical Core candidates without starting the archived scanner', () => {
  assert.match(main, /if \(multiplayerStore\) \{\s*const publishCore =/);
  assert.match(main, /rankCoreCandidates\(registry\.coreMarkets\(\)\)\.filter\(isCorePastureCandidate\)/);
  assert.match(main, /coreSignalTimer=setInterval\(publishCore,1000\)/);
  assert.doesNotMatch(main, /^\s*automation\.watch\(\);$/m, 'archived watch mode is not started unconditionally');
  assert.match(main, /automation\.stop\('multiplayer account isolation'\)/, 'account isolation stop is retained');
  assert.match(main, /paperSimulator\.start\(\)/, 'the virtual paper simulator still starts for every mode');
});

test('paper research stays isolated from account execution', () => {
  assert.match(main, /paperSimulator\.onTick\(/, 'the simulator settles from public ticks only');
  assert.doesNotMatch(main, /paperSimulator[\s\S]{0,400}client\.(getQuote|buy)\(/, 'the simulator never touches the private trading lane');
});
