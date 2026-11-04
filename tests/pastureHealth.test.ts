import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('pasture health checks avoid overlapping and hidden requests and refresh after recovery', async () => {
  const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
  const start = html.indexOf('async function checkGameHealth()');
  const end = html.indexOf("$('healthButton').addEventListener", start);
  assert.ok(start >= 0 && end > start);
  let resolveFetch: (value: unknown) => void = () => {};
  let requests = 0;
  const messages: unknown[] = [];
  const document = { hidden: true };
  const context = {
    document, AbortController, setTimeout, clearTimeout, performance, Date, Number,
    location: { origin: 'https://example.test' },
    parent: { postMessage: (message: unknown) => messages.push(message) },
    fetch: () => { requests++; return new Promise((resolve) => { resolveFetch = resolve; }); },
    updateHealthUi: () => {}, healthRequestActive: false, healthApiError: 'offline',
    healthIssue: '', apiPingMs: null, derivPingMs: null, roomHealth: {}, healthChecked: false, lastHealthCheckAt: 0,
  };
  const check = runInNewContext(`${html.slice(start, end)}; checkGameHealth`, context) as () => Promise<void>;
  await check();
  assert.equal(requests, 0);
  document.hidden = false;
  const pending = check();
  await check();
  assert.equal(requests, 1);
  resolveFetch({ ok: true, json: async () => ({ feed: { pingMs: 42 } }) });
  await pending;
  assert.equal(context.healthApiError, '');
  assert.equal(context.derivPingMs, 42);
  assert.equal(context.healthChecked, true);
  assert.ok(context.lastHealthCheckAt > 0);
  assert.equal(messages.length, 1);
  assert.equal((messages[0] as { type: string }).type, 'zeronine:room-health-refresh');
});
