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

test('signed players automatically share pasture presence, chat, and cow kills', async () => {
  const oldToken = config.dashboardAdminToken;
  const oldEnv = config.nodeEnv;
  config.dashboardAdminToken = 'test-owner-token';
  config.nodeEnv = 'production';
  const app = Fastify();
  await app.register(cookie, { secret: 'local-test-secret-long-enough' });
  await registerWs(app, new Hub(), new MarketRegistry({ onTick() {} }), {
    resolveSession: async (secret: string | null) => secret === 'alice-secret' ? { accountId: 'VRTC111' } : secret === 'bob-secret' ? { accountId: 'VRTC222' } : null,
    isRoomMember: async () => false,
  } as never);
  app.get('/test/cookie/:name', (req, reply) => { reply.setCookie('deriv_cows_session', `${(req.params as { name: string }).name}-secret`, { signed: true, path: '/' }); return { ok: true }; });
  const aliceCookie = String((await app.inject('/test/cookie/alice')).headers['set-cookie']).split(';', 1)[0];
  const bobCookie = String((await app.inject('/test/cookie/bob')).headers['set-cookie']).split(';', 1)[0];
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  const open = (cookieHeader?: string) => {
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/pasture-ws?room=main`, { headers: cookieHeader ? { cookie: cookieHeader } : {} });
    const events: Array<Record<string, any>> = [];
    socket.on('message', data => events.push(JSON.parse(data.toString())));
    return { socket, events };
  };
  const waitFor = async (events: Array<Record<string, any>>, type: string): Promise<Record<string, any>> => {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const event = events.find(item => item.type === type);
      if (event) return event;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`${type} event not received`);
  };
  const alice = open(aliceCookie);
  let bob: ReturnType<typeof open> | null = null;
  let guest: ReturnType<typeof open> | null = null;
  try {
    await waitFor(alice.events, 'welcome');
    bob = open(bobCookie);
    const bobWelcome = await waitFor(bob.events, 'welcome');
    assert.equal(bobWelcome.players.length, 2);
    assert.equal((await waitFor(alice.events, 'player')).player.id, bobWelcome.id);
    assert.doesNotMatch(JSON.stringify(bobWelcome), /VRTC111|VRTC222|balance|token/);
    bob.socket.send(JSON.stringify({ type: 'chat', text: 'Hello pasture' }));
    assert.equal((await waitFor(alice.events, 'chat')).message.text, 'Hello pasture');
    bob.socket.send(JSON.stringify({ type: 'kill', x: 120, y: 240 }));
    assert.equal((await waitFor(alice.events, 'kill')).playerId, bobWelcome.id);
    guest = open();
    const closed = await new Promise<number>((resolve, reject) => { guest!.socket.once('close', resolve); guest!.socket.once('error', reject); });
    assert.equal(closed, 1008);
  } finally {
    alice.socket.terminate(); bob?.socket.terminate(); guest?.socket.terminate();
    await app.close();
    config.dashboardAdminToken = oldToken;
    config.nodeEnv = oldEnv;
  }
});

test('reconnecting reuses one authenticated Ranger and stale sockets cannot remove it', async () => {
  const oldToken = config.dashboardAdminToken;
  const oldEnv = config.nodeEnv;
  config.dashboardAdminToken = 'test-owner-token';
  config.nodeEnv = 'production';
  const app = Fastify();
  await app.register(cookie, { secret: 'local-test-secret-long-enough' });
  await registerWs(app, new Hub(), new MarketRegistry({ onTick() {} }), {
    resolveSession: async (secret: string | null) => secret === 'alice-secret' ? { accountId: 'VRTC111' } : secret === 'bob-secret' ? { accountId: 'VRTC222' } : null,
    isRoomMember: async () => false,
  } as never);
  app.get('/test/cookie/:name', (req, reply) => { reply.setCookie('deriv_cows_session', `${(req.params as { name: string }).name}-secret`, { signed: true, path: '/' }); return { ok: true }; });
  const aliceCookie = String((await app.inject('/test/cookie/alice')).headers['set-cookie']).split(';', 1)[0];
  const bobCookie = String((await app.inject('/test/cookie/bob')).headers['set-cookie']).split(';', 1)[0];
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  type Session = { socket: WebSocket; events: Array<Record<string, any>>; closed: Array<number> };
  const open = (cookieHeader?: string, room = 'main'): Session => {
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/pasture-ws?room=${room}`, { headers: cookieHeader ? { cookie: cookieHeader } : {} });
    const events: Array<Record<string, any>> = []; const closed: number[] = [];
    socket.on('message', data => events.push(JSON.parse(data.toString())));
    socket.on('close', code => closed.push(code));
    return { socket, events, closed };
  };
  const waitFor = async (events: Array<Record<string, any>>, type: string): Promise<Record<string, any>> => {
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      const event = events.find(item => item.type === type);
      if (event) return event;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`${type} event not received`);
  };
  const bob = open(bobCookie);
  const aliceFirst = open(aliceCookie);
  const aliceSecond = open(aliceCookie);
  try {
    const bobWelcome = await waitFor(bob.events, 'welcome');
    const firstWelcome = await waitFor(aliceFirst.events, 'welcome');
    const secondWelcome = await waitFor(aliceSecond.events, 'welcome');
    assert.equal(secondWelcome.id, firstWelcome.id, 'a reconnect keeps the same server-issued presence');
    assert.equal(bobWelcome.id === secondWelcome.id, false, 'players never share a presence id');
    const deadline = Date.now() + 2500;
    while (!aliceFirst.closed.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(aliceFirst.closed, [4001], 'the replaced socket is closed so it cannot keep controlling the Ranger');

    // The replaced socket is gone; its cleanup must not delete the live presence.
    const chatBefore = bob.events.filter(event => event.type === 'chat').length;
    aliceSecond.socket.send(JSON.stringify({ type: 'chat', text: 'still here' }));
    const chat = await waitFor(bob.events, 'chat');
    assert.equal(bob.events.filter(event => event.type === 'chat').length, chatBefore + 1);
    assert.equal(chat.message.playerId, secondWelcome.id, 'the replacement connection keeps ownership');

    // A browser cannot claim another Ranger's identity, even by asking.
    bob.socket.send(JSON.stringify({ type: 'set-pasture-self-id', id: secondWelcome.id }));
    bob.socket.send(JSON.stringify({ type: 'kill', x: 400, y: 400 }));
    const kill = await waitFor(aliceSecond.events, 'kill');
    assert.equal(kill.playerId, bobWelcome.id, 'the forged identity claim is ignored');

    // Guest presence is always fresh and cannot reclaim an authenticated Ranger.
    const guestOne = open(undefined, 'public'), guestTwo = open(undefined, 'public');
    try {
      const firstGuest = await waitFor(guestOne.events, 'welcome');
      const secondGuest = await waitFor(guestTwo.events, 'welcome');
      assert.notEqual(firstGuest.id, secondGuest.id, 'guests never share a reclaimable presence');
      assert.notEqual(firstGuest.id, firstWelcome.id);
    } finally { guestOne.socket.terminate(); guestTwo.socket.terminate(); }
    assert.doesNotMatch(JSON.stringify(secondWelcome), /VRTC111|VRTC222|alice-secret|bob-secret/);
  } finally {
    bob.socket.terminate(); aliceFirst.socket.terminate(); aliceSecond.socket.terminate();
    await app.close();
    config.dashboardAdminToken = oldToken;
    config.nodeEnv = oldEnv;
  }
});
