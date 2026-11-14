import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';

for (const file of ['web/public/pasture-replay-recorder.js', 'web/dist/pasture-replay-recorder.js']) {
  test(`${file}: captures only matched settled plays and isolates accounts`, async () => {
    const rows = new Map<string, any>(), metadata = new Map<string, any>();
    let tick = () => {}, resolvedId = 'wrong-id', state: any = { connected: true, accountId: 'A', mode: 'demo', aim: 1, phase: 'aiming', market: 'V50' };
    const request = (value: any) => { const result: any = {}; queueMicrotask(() => { result.result = value; result.onsuccess?.(); }); return result; };
    const database = {
      createObjectStore() { return { createIndex() {} }; },
      transaction() {
        const tx: any = { objectStore: (name: string) => ({
          put(row: any) { (name === 'metadata' ? metadata : rows).set(row.id, row); queueMicrotask(() => tx.oncomplete?.()); },
          delete(id: string) { (name === 'metadata' ? metadata : rows).delete(id); queueMicrotask(() => tx.oncomplete?.()); },
          get(id: string) { return request((name === 'metadata' ? metadata : rows).get(id)); },
          index() { return { getAll(key: string) { return request([...metadata.values()].filter(row => row.scope === key)); } }; },
        }) };
        return tx;
      },
    };
    const indexedDB = { open() { const r: any = {}; queueMicrotask(() => { r.result = database; r.onupgradeneeded?.(); r.onsuccess?.(); }); return r; } };
    class FakeRecorder {
      static isTypeSupported() { return true; }
      state = 'inactive'; ondataavailable: any; onstop: any; onerror: any;
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['actual recorded frames'], { type: 'video/webm' }) }); this.onstop?.(); }
    }
    const canvas = { captureStream: () => ({ getTracks: () => [{ stop() {} }] }) };
    const context: any = { indexedDB, crypto: webcrypto, MediaRecorder: FakeRecorder, TextEncoder, Uint8Array, Blob, JSON, Date, Number, String, Array, Map,
      document: { getElementById: () => canvas }, CustomEvent: class { type: string; constructor(type: string) { this.type = type; } },
      setInterval: (fn: () => void) => { tick = fn; }, setTimeout: (fn: () => void, ms: number) => ms < 1000 ? setTimeout(fn, 0) : 0, clearTimeout: () => {},
      __zeronineReplaySnapshot: () => ({ ...state }), dispatchEvent() {}, addEventListener() {},
      __zeronineReplayResolve: () => state.phase === 'won' ? { tradeId: resolvedId, outcome: 'won', profit: state.profit, stake: 1, currency: state.currency } : null,
    };
    context.window = context;
    runInNewContext(readFileSync(file, 'utf8'), context);
    tick(); state.phase = 'open'; state.confirmedTradeId = 'T1'; state.tradeId = 'heuristic-other'; tick();
    state.phase = 'won'; state.profit = 1.25; state.currency = 'USD'; tick();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(rows.size, 0, 'unmatched resolver result cannot be attributed to this play');
    resolvedId = 'T1'; tick();
    for (let i = 0; i < 20 && rows.size === 0; i++) await new Promise(resolve => setTimeout(resolve, 10));
    const first = await context.__pastureReplay.list();
    assert.equal(first.length, 1); assert.equal(first[0].outcome, 'won'); assert.equal(first[0].profit, 1.25);
    assert.ok((await context.__pastureReplay.get(first[0].id)).video.size > 0);
    state = { connected: true, accountId: 'B', mode: 'real', aim: 2, phase: 'aiming' }; tick();
    assert.equal((await context.__pastureReplay.list()).length, 0);
    assert.equal(await context.__pastureReplay.get(first[0].id), null);
    state.phase = 'rejected'; tick(); await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(rows.size, 1, 'unpaired rejected play is not saved');
    state = { connected: true, accountId: 'B', mode: 'real', aim: 3, phase: 'aiming' }; tick();
    state.phase = 'open'; state.tradeId = 'heuristic-other'; tick();
    state.phase = 'rejected'; state.profit = 999; tick();
    for (let i = 0; i < 20 && rows.size < 2; i++) await new Promise(resolve => setTimeout(resolve, 10));
    const unverified = await context.__pastureReplay.list();
    assert.equal(unverified.length, 1); assert.equal(unverified[0].outcome, 'unverified');
    assert.equal(unverified[0].profit, undefined, 'heuristic trade cannot supply a financial result');
    state.connected = false; tick(); assert.equal((await context.__pastureReplay.list()).length, 0);
    canvas.captureStream = () => { throw new Error('capture unavailable'); };
    state = { connected: true, accountId: 'A', aim: 4, phase: 'aiming' };
    assert.doesNotThrow(tick, 'capture failure never escapes into trading');
  });
}

for (const file of ['web/public/pasture-replay-recorder.js', 'web/dist/pasture-replay-recorder.js']) {
  test(`${file}: chooses playable iPhone MP4 and flushes before stopping the canvas track`, async () => {
    let tick = () => {}, chosen = '';
    const events: string[] = [];
    const state: any = { connected: true, accountId: 'A', mode: 'demo', aim: 1, phase: 'aiming' };
    class FakeRecorder {
      static isTypeSupported() { return true; }
      state = 'inactive'; ondataavailable: any; onstop: any;
      constructor(_stream: unknown, options: { mimeType: string }) { chosen = options.mimeType; }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        queueMicrotask(() => {
          events.push('flush');
          this.ondataavailable?.({ data: new Blob(['frames'], { type: chosen }) });
          this.onstop?.();
        });
      }
    }
    const stream = { getTracks: () => [{ stop: () => events.push('track-stop') }] };
    const context: any = {
      indexedDB: { open() { throw new Error('storage unavailable'); } }, crypto: webcrypto,
      MediaRecorder: FakeRecorder, TextEncoder, Uint8Array, Blob, JSON, Date, Number, String, Array, Map,
      navigator: { userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1' },
      document: { getElementById: () => ({ captureStream: () => stream }), createElement: () => ({ canPlayType: (type: string) => type.startsWith('video/mp4') ? 'probably' : '' }) },
      CustomEvent: class { type: string; constructor(type: string) { this.type = type; } },
      setInterval: (fn: () => void) => { tick = fn; }, setTimeout: (fn: () => void, ms: number) => ms < 1000 ? setTimeout(fn, 0) : 0, clearTimeout: () => {},
      __zeronineReplaySnapshot: () => ({ ...state }),
      __zeronineReplayResolve: (id: string) => state.phase === 'won' ? { tradeId: id, outcome: 'won', profit: 1, stake: 1, currency: 'USD' } : null,
      dispatchEvent() {}, addEventListener() {},
    };
    context.window = context;
    runInNewContext(readFileSync(file, 'utf8'), context);
    tick();
    assert.match(chosen, /^video\/mp4/, 'record a format the same browser can play');
    state.phase = 'open'; state.confirmedTradeId = 'T1'; tick();
    state.phase = 'won'; tick();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(events.slice(0, 2), ['flush', 'track-stop'], 'finish the media container before stopping the canvas stream');
  });
}
