import { randomUUID } from 'node:crypto';

type Send = (event: Record<string, unknown>) => void;
type Appearance = { outfit: string; color: string; accent: string; headwear: string; accessory: string };
type Player = { id: string; name: string; x: number; y: number; facing: number; action: string; appearance: Appearance; lastUpdate: number; lastChat: number; lastKill: number; lastShot: number; send: Send };
const initialAppearance: Appearance = { outfit: 'classic', color: '#326db1', accent: '#a65b38', headwear: 'none', accessory: 'none' };
const colors = (value: unknown, fallback: string): string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
function appearance(input: unknown): Appearance {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const choose = (key: string, options: string[], fallback: string): string => typeof value[key] === 'string' && options.includes(value[key] as string) ? value[key] as string : fallback;
  return { outfit: choose('outfit', ['classic', 'vest', 'scout'], 'classic'), color: colors(value.color, initialAppearance.color), accent: colors(value.accent, initialAppearance.accent), headwear: choose('headwear', ['none', 'cap', 'bandana'], 'none'), accessory: choose('accessory', ['none', 'scarf', 'badge'], 'none') };
}
function cleanText(value: unknown, limit: number): string { return typeof value === 'string' ? Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, limit).join('') : ''; }
function publicPlayer(player: Player): Record<string, unknown> { return { id: player.id, name: player.name, x: player.x, y: player.y, facing: player.facing, action: player.action, appearance: player.appearance }; }

/** Ephemeral visual presence only; never carries account or trade data. */
export class PastureRoom {
  private players = new Map<string, Player>();
  private messages: Array<Record<string, unknown>> = [];
  private ghost = { x: 780, y: 650 };
  private now: () => number;
  private capacity: number;
  constructor(now: () => number = Date.now, capacity = 100) { this.now = now; this.capacity = capacity; }
  get size(): number { return this.players.size; }
  join(send: Send, playerId?: string): string | null {
    if (this.players.size >= this.capacity) return null;
    // Reuse existing player ID if provided (for reconnects)
    if (playerId && this.players.has(playerId)) {
      const existing = this.players.get(playerId)!;
      existing.send({ type: 'welcome', id: playerId, players: [...this.players.values()].map(publicPlayer), messages: this.messages, leader: this.players.keys().next().value, ghost: this.ghost });
      this.broadcast({ type: 'player', player: publicPlayer(existing) }, playerId);
      return playerId;
    }
    const id = playerId || randomUUID(), name = `Ranger ${id.slice(0, 4).toUpperCase()}`;
    const player: Player = { id, name, x: 480, y: 560, facing: 1, action: 'idle', appearance: { ...initialAppearance }, lastUpdate: 0, lastChat: 0, lastKill: 0, lastShot: 0, send };
    this.players.set(id, player);
    send({ type: 'welcome', id, players: [...this.players.values()].map(publicPlayer), messages: this.messages, leader: this.players.keys().next().value, ghost: this.ghost });
    this.broadcast({ type: 'player', player: publicPlayer(player) }, id);
    return id;
  }
  leave(id: string): void { const wasLeader = this.players.keys().next().value === id; if (this.players.delete(id)) { this.broadcast({ type: 'leave', id }); if (wasLeader) this.broadcast({ type: 'leader', id: this.players.keys().next().value ?? null }); } }
  receive(id: string, raw: unknown): void {
    const p = this.players.get(id);
    if (!p || !raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    const v = raw as Record<string, unknown>, now = this.now();
    if (v.type === 'move') {
      if (now - p.lastUpdate < 180 || typeof v.x !== 'number' || !Number.isFinite(v.x) || typeof v.y !== 'number' || !Number.isFinite(v.y)) return;
      p.lastUpdate = now; p.x = Math.max(0, Math.min(1300, v.x)); p.y = Math.max(0, Math.min(850, v.y)); p.facing = v.facing === -1 ? -1 : 1; p.action = ['walking', 'aiming', 'idle', 'inspecting'].includes(String(v.action)) ? String(v.action) : 'idle';
      p.appearance = appearance(v.appearance);
      const name = cleanText(v.name, 24); if (name) p.name = name;
      this.broadcast({ type: 'player', player: publicPlayer(p) }, id);
      const g = v.ghost as Record<string, unknown> | undefined;
      if (this.players.keys().next().value === id && g && typeof g.x === 'number' && Number.isFinite(g.x) && typeof g.y === 'number' && Number.isFinite(g.y)) { const x = Math.max(0, Math.min(1300, g.x)), y = Math.max(0, Math.min(850, g.y)); if (x !== this.ghost.x || y !== this.ghost.y) { this.ghost = { x, y }; this.broadcast({ type: 'ghost', x, y }, id); } }
    } else if (v.type === 'chat') {
      if (now - p.lastChat < 1500) { p.send({ type: 'notice', message: 'Please wait a moment before sending another message.' }); return; }
      const text = cleanText(v.text, 160); if (!text) return;
      p.lastChat = now;
      const name = cleanText(v.name, 24); if (name && name !== p.name) { p.name = name; this.broadcast({ type: 'player', player: publicPlayer(p) }, id); }
      const message = { id: randomUUID(), playerId: id, name: p.name, text, ts: now };
      this.messages.push(message); if (this.messages.length > 50) this.messages.shift();
      this.broadcast({ type: 'chat', message });
    } else if (v.type === 'shot') {
      if (now - p.lastShot < 180 || typeof v.x !== 'number' || !Number.isFinite(v.x) || typeof v.y !== 'number' || !Number.isFinite(v.y)) return;
      p.lastShot = now;
      this.broadcast({ type: 'shot', playerId: id, x: Math.max(0, Math.min(1300, v.x)), y: Math.max(0, Math.min(850, v.y)) }, id);
    } else if (v.type === 'kill') {
      if (now - p.lastKill < 500 || typeof v.x !== 'number' || !Number.isFinite(v.x) || typeof v.y !== 'number' || !Number.isFinite(v.y)) return;
      p.lastKill = now;
      this.broadcast({ type: 'kill', playerId: id, x: Math.max(0, Math.min(1300, v.x)), y: Math.max(0, Math.min(850, v.y)) }, id);
    }
  }
  private broadcast(event: Record<string, unknown>, except?: string): void { for (const [id, player] of this.players) if (id !== except) player.send(event); }
}

/** Room state is ephemeral and scoped to a single room identifier. */
export class PastureRooms {
  private rooms = new Map<string, PastureRoom>();
  private readonly maxRooms: number;
  constructor(maxRooms = 256) { this.maxRooms = maxRooms; }

  join(roomId: string, send: Send): { id: string; room: PastureRoom } | null {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(roomId)) return null;
    let room = this.rooms.get(roomId);
    if (!room) {
      if (this.rooms.size >= this.maxRooms) return null;
      room = new PastureRoom();
      this.rooms.set(roomId, room);
    }
    const id = room.join(send);
    if (!id) return null;
    return { id, room };
  }

  leave(roomId: string, room: PastureRoom, id: string): void {
    room.leave(id);
    if (room.size === 0 && this.rooms.get(roomId) === room) this.rooms.delete(roomId);
  }
}
