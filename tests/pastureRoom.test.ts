import test from 'node:test';
import assert from 'node:assert/strict';
import { PastureRoom, PastureRooms, guestPresenceId, authenticatedPresenceId } from '../src/api/pastureRoom.ts';

let sequence = 0;
type Connection = Parameters<PastureRoom['join']>[0];
function connection(presenceId: string, events: Array<Record<string, unknown>> = [], closed: number[] = []): Connection {
  sequence += 1;
  return {
    presenceId,
    connectionId: `conn-${sequence}`,
    send: (event) => events.push(event),
    close: (code) => closed.push(code),
  };
}

test('room registry isolates presence and chat and discards empty rooms', () => {
  const rooms = new PastureRooms(2);
  const a: Record<string, unknown>[] = [], b: Record<string, unknown>[] = [], other: Record<string, unknown>[] = [];
  const aliceConnection = connection('r-alice', a), bobConnection = connection('r-bob', b), isolatedConnection = connection('r-isolated', other);
  const first = rooms.join('one', aliceConnection)!;
  const second = rooms.join('one', bobConnection)!;
  const isolated = rooms.join('two', isolatedConnection)!;
  assert.equal(rooms.join('three', connection('r-carol')), null, 'the room cap is enforced');
  assert.equal(rooms.join('../bad', connection('r-dave')), null, 'room ids are validated');
  first.room.receive(first.id, aliceConnection.connectionId, { type: 'chat', text: 'hello' });
  assert.ok(b.some(event => event.type === 'chat'));
  assert.ok(!other.some(event => event.type === 'chat' || event.type === 'player'));
  rooms.leave('one', first.room, first.id, aliceConnection.connectionId);
  rooms.leave('one', second.room, second.id, bobConnection.connectionId);
  const fresh: Record<string, unknown>[] = [];
  const replacement = rooms.join('one', connection('r-alice', fresh))!;
  assert.deepEqual(fresh[0]!.messages, [], 'an emptied room starts clean');
  assert.equal(replacement.id, 'r-alice');
  rooms.leave('one', replacement.room, replacement.id, replacement.id);
  rooms.leave('two', isolated.room, isolated.id, isolatedConnection.connectionId);
});

test('pasture shares bounded public presence and chat without sharing account data', () => {
  let now = 10_000;
  const room = new PastureRoom(() => now, 2);
  const a: Record<string, unknown>[] = [], b: Record<string, unknown>[] = [];
  const alice = connection('r-alice', a), bob = connection('r-bob', b);
  const first = room.join(alice)!;
  const second = room.join(bob)!;
  assert.equal(room.join(connection('r-carol')), null, 'capacity still rejects new presence');
  room.receive(first, alice.connectionId, { type: 'move', name: '  Cow  Ranger  ', x: 200, y: 300, facing: -1, action: 'walking', appearance: { color: '#aabbcc' }, ghost: { x: 620, y: 410 }, accountId: 'private', balance: 42 });
  const peer = b.find(event => event.type === 'player' && (event.player as { id: string }).id === first)!.player as Record<string, unknown>;
  assert.equal(peer.name, 'Cow Ranger');
  assert.equal(peer.x, 200);
  assert.equal(peer.action, 'walking');
  assert.equal('accountId' in peer, false);
  assert.equal('balance' in peer, false);
  assert.ok(b.some(event => event.type === 'ghost' && event.x === 620 && event.y === 410));
  room.receive(second, bob.connectionId, { type: 'move', x: 200, y: 300, ghost: { x: 1, y: 1 } });
  assert.equal(a.some(event => event.type === 'ghost' && event.x === 1), false, 'only the shared scout leader can update its position');
  room.receive(first, alice.connectionId, { type: 'chat', text: 'hello <img>\n friend' });
  const chat = b.find(event => event.type === 'chat')!.message as Record<string, unknown>;
  assert.equal(chat.text, 'hello <img> friend');
  room.receive(first, alice.connectionId, { type: 'chat', text: 'spam' });
  assert.ok(a.some(event => event.type === 'notice'));
  now += 2000;
  room.receive(first, alice.connectionId, { type: 'shot', x: 250, y: 310, stake: 100 });
  assert.ok(b.some(event => event.type === 'shot' && event.playerId === first && !('stake' in event)));
  room.receive(first, alice.connectionId, { type: 'kill', x: 250, y: 310, stake: 100 });
  const effect = b.find(event => event.type === 'kill')!;
  assert.equal(effect.playerId, first);
  assert.equal('stake' in effect, false);
  assert.equal(room.leave(second, bob.connectionId), true);
  assert.ok(a.some(event => event.type === 'leave' && event.id === second));
});

test('a reconnect transfers ownership of one presence instead of adding a duplicate Ranger', () => {
  const room = new PastureRoom();
  const oldEvents: Array<Record<string, unknown>>[] = [[]];
  const closed: number[] = [];
  const firstConnection = connection('r-alice', oldEvents[0]!, closed);
  const id = room.join(firstConnection)!;
  room.receive(id, firstConnection.connectionId, { type: 'move', x: 640, y: 500, action: 'walking', appearance: { color: '#102030' } });

  const fresh: Record<string, unknown>[] = [];
  const secondConnection = connection('r-alice', fresh);
  const rejoined = room.join(secondConnection);
  assert.equal(rejoined, id, 'the same authenticated player keeps one Ranger');
  assert.equal(room.size, 1, 'no duplicate presence is created');
  assert.deepEqual(closed, [4001], 'the replaced socket is closed so it cannot keep control');
  assert.equal((fresh[0]!.players as Array<Record<string, unknown>>).length, 1);
  assert.equal((fresh[0]!.players as Array<Record<string, unknown>>)[0]!.x, 640, 'position survives the reconnect');
  assert.deepEqual((fresh[0]!.players as Array<Record<string, unknown>>)[0]!.appearance, { outfit: 'classic', color: '#102030', accent: '#a65b38', headwear: 'none', accessory: 'none' });
});

test('a stale connection cannot remove or move the Ranger that replaced it', () => {
  const room = new PastureRoom();
  const old = connection('r-alice');
  const id = room.join(old)!;
  const fresh = connection('r-alice');
  room.join(fresh);

  assert.equal(room.leave(id, old.connectionId), false, 'late cleanup from the replaced socket is ignored');
  assert.equal(room.size, 1);
  room.receive(id, old.connectionId, { type: 'move', x: 10, y: 10 });
  const probe = connection('r-bob');
  const events: Record<string, unknown>[] = [];
  const bob = { ...probe, send: (event: Record<string, unknown>) => events.push(event) };
  room.join(bob);
  const self = (events[0]!.players as Array<Record<string, unknown>>).find(player => player.id === id)!;
  assert.equal(self.x, 480, 'the stale socket cannot move the presence it no longer owns');
  assert.equal(room.leave(id, fresh.connectionId), true, 'the owning connection can still leave');
});

test('presence ids are server-derived and never expose the account id', () => {
  const alice = authenticatedPresenceId('test-secret', 'main', 'VRTC111');
  const again = authenticatedPresenceId('test-secret', 'main', 'VRTC111');
  const otherRoom = authenticatedPresenceId('test-secret', 'room-two', 'VRTC111');
  assert.equal(alice, again, 'the derived id is stable for reconnects');
  assert.notEqual(alice, otherRoom, 'rooms cannot correlate the same account');
  assert.doesNotMatch(alice, /VRTC111/);
  assert.match(alice, /^r-[0-9a-f]{20}$/);
  assert.notEqual(guestPresenceId(), guestPresenceId(), 'guests never share a reclaimable identity');
  assert.equal(new PastureRoom().join(connection('bad id with spaces')), null, 'only server-shaped ids are accepted');
});
