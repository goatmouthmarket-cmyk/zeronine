import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import WebSocket from 'ws';
import { Hub } from '../src/api/hub.ts';
import { registerWs } from '../src/api/ws.ts';
import { MarketRegistry } from '../src/core/marketState.ts';
import { config } from '../src/config.ts';

test('unauthenticated websocket never receives account events', async () => {
  const oldToken = config.dashboardAdminToken;
  const oldEnv = config.nodeEnv;
  config.dashboardAdminToken = 'test-owner-token';
  config.nodeEnv = 'production';
  const app = Fastify();
  const hub = new Hub();
  await app.register(cookie, { secret: 'local-test-secret-long-enough' });
  await registerWs(app, hub, new MarketRegistry({ onTick() {} }));
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
  const received: Array<Record<string, unknown>> = [];
  try {
    await new Promise<void>((resolve, reject) => {
      socket.on('message', data => {
        const event = JSON.parse(data.toString()) as Record<string, unknown>;
        received.push(event);
        if (event.type === 'hello') resolve();
      });
      socket.once('error', reject);
    });
    hub.emit({ type: 'session', ts: Date.now(), session: { balance: 123, loginid: 'private' } });
    hub.emit({ type: 'balance', ts: Date.now(), balance: 123 });
    hub.emit({ type: 'trade', ts: Date.now(), trade: { stake: 25 } });
    hub.emit({ type: 'hold', ts: Date.now(), reason: 'private decision' });
    hub.emit({ type: 'tick', ts: Date.now(), symbol: 'R_10', quote: 100 });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('public tick not received')), 2000);
      socket.on('message', data => { if (JSON.parse(data.toString()).type === 'tick') { clearTimeout(timer); resolve(); } });
    });
    assert.deepEqual(received.map(event => event.type), ['hello', 'tick']);
  } finally {
    socket.close();
    await app.close();
    config.dashboardAdminToken = oldToken;
    config.nodeEnv = oldEnv;
  }
});

test('private pasture websocket requires room membership and a signed player session', async () => {
  const app = Fastify();
  const hub = new Hub();
  const roomId = '11111111-1111-4111-8111-111111111111';
  await app.register(cookie, { secret: 'local-test-secret-long-enough' });
  await registerWs(app, hub, new MarketRegistry({ onTick() {} }), {
    resolveSession: async (secret: string | null) => secret === 'alice-secret' ? { accountId: 'VRTC111', token: 'token' } : secret === 'bob-secret' ? { accountId: 'VRTC222', token: 'token' } : null,
    isRoomMember: async (accountId: string, room: string) => accountId === 'VRTC111' && room === roomId,
  } as never);
  app.get('/test/cookie/:name', (req, reply) => { reply.setCookie('deriv_cows_session', `${(req.params as { name: string }).name}-secret`, { signed: true, path: '/' }); return { ok: true }; });
  const aliceCookie = String((await app.inject('/test/cookie/alice')).headers['set-cookie']).split(';', 1)[0];
  const bobCookie = String((await app.inject('/test/cookie/bob')).headers['set-cookie']).split(';', 1)[0];
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  const open = (cookieHeader?: string) => new WebSocket(`ws://127.0.0.1:${address.port}/pasture-ws?room=${roomId}`, { headers: cookieHeader ? { cookie: cookieHeader } : {} });
  const alice = open(aliceCookie), bob = open(bobCookie), guest = open();
  try {
    const rejected = (socket: WebSocket) => new Promise<number>((resolve, reject) => { socket.once('close', code => resolve(code)); socket.once('error', reject); });
    const bobRejected = rejected(bob), guestRejected = rejected(guest);
    const welcome = await new Promise<Record<string, unknown>>((resolve, reject) => {
      alice.on('message', data => { const event = JSON.parse(data.toString()); if (event.type === 'welcome') resolve(event); });
      alice.once('error', reject);
    });
    assert.equal(welcome.type, 'welcome');
    assert.equal(await bobRejected, 1008);
    assert.equal(await guestRejected, 1008);
  } finally {
    alice.close(); bob.close(); guest.close();
    await app.close();
  }
});
