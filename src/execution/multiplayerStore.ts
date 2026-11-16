import { Pool, type PoolClient } from 'pg';
import { createHash, randomBytes } from 'node:crypto';
import { decryptToken, encryptToken } from '../db/crypto.ts';
import { nextRecovery } from '../strategy/risk.ts';

export type BrainInsightCategory = 'market_behavior' | 'setup' | 'entry_timing' | 'risk';
export type BrainExpectedDirection = 'over' | 'under' | 'none';
export type BrainInsightOutcome = 'pending' | 'matched' | 'unmatched';
export type BrainInsightInput = { marketSymbol: string; marketName: string; category: BrainInsightCategory; observation: string; expectedDirection: BrainExpectedDirection; barrier: number | null; horizon: 'next_5' | 'next_20' | 'next_session'; confidence: number };
export type BrainInsight = BrainInsightInput & { id: string; outcome: BrainInsightOutcome; linkedTradeId: string | null; linkedTradeOutcome: 'won' | 'lost' | null; xpEarned: number; createdAt: number; reviewedAt: number | null };
export type BrainInsightProgress = { total: number; reviewed: number; matched: number; unmatched: number; patterns: number; xp: number; level: number; levelXp: number; linkedWins: number };
export type BrainLeaderboardEntry = { displayName: string; xp: number; level: number; linkedWins: number; contributions: number };
type BrainInsightRow = { id: string; market_symbol: string; market_name: string; category: BrainInsightCategory; observation: string; expected_direction: BrainExpectedDirection; barrier: number | null; horizon: BrainInsightInput['horizon']; confidence: number; outcome: BrainInsightOutcome; linked_trade_id: string | null; linked_trade_outcome: 'won' | 'lost' | null; xp_earned: number; created_at: number | string; reviewed_at: number | string | null };
const brainInsightFromRow = (row: BrainInsightRow): BrainInsight => ({ id: row.id, marketSymbol: row.market_symbol, marketName: row.market_name, category: row.category, observation: row.observation, expectedDirection: row.expected_direction, barrier: row.barrier == null ? null : Number(row.barrier), horizon: row.horizon, confidence: Number(row.confidence), outcome: row.outcome, linkedTradeId: row.linked_trade_id, linkedTradeOutcome: row.linked_trade_outcome, xpEarned: Number(row.xp_earned), createdAt: Number(row.created_at), reviewedAt: row.reviewed_at == null ? null : Number(row.reviewed_at) });

export type AccountRisk = { mode: 'base' | 'recovering'; streak: number; debt: number; attempts: number; cycleStake: number; peakBalance: number };

const sessionHash = (secret: string): string => createHash('sha256').update(secret).digest('hex');
const validSecret = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const validRoomId = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Change only the endpoint and project-qualified login; keep the secret in Railway. */
export function multiplayerConnectionString(connectionString: string, poolerHost?: string, poolerUser?: string): string {
  if (!connectionString) throw new Error('multiplayer database connection is required');
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.searchParams.get('sslmode') === 'disable') throw new Error('encrypted PostgreSQL connection is required');
  if (poolerHost || poolerUser) {
    const projectRef = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(url.hostname)?.[1];
    if (!projectRef || !poolerHost || !/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(poolerHost) || poolerUser !== `postgres.${projectRef}`) {
      throw new Error('valid Supabase session pooler host and project user required');
    }
    url.hostname = poolerHost;
    url.username = poolerUser;
    url.port = '5432';
  }
  return url.toString();
}

/** Private database access stays on the server; no service credentials reach browsers. */
export class MultiplayerStore {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    const effectiveConnection = multiplayerConnectionString(connectionString, process.env.MULTIPLAYER_POOLER_HOST, process.env.MULTIPLAYER_POOLER_USER);
    this.pool = new Pool({ connectionString: effectiveConnection, ssl: { rejectUnauthorized: false }, max: 8, connectionTimeoutMillis: 5000 });
    this.pool.on('error', () => { console.error('[multiplayer database] idle connection lost'); });
  }

  async close(): Promise<void> { await this.pool.end(); }

  async health(): Promise<void> {
    const result = await this.pool.query<{ contracts: string | null; sessions: string | null; risk: string | null; rooms: string | null }>(
      `select to_regclass('multiplayer_private.contracts')::text as contracts,
              to_regclass('multiplayer_private.sessions')::text as sessions,
              to_regclass('multiplayer_private.account_risk')::text as risk,
              to_regclass('multiplayer_private.rooms')::text as rooms`,
    );
    if (!result.rows[0]?.contracts || !result.rows[0]?.sessions || !result.rows[0]?.risk || !result.rows[0]?.rooms) throw new Error('multiplayer Supabase schema is missing');
    const details = await this.pool.query<{ count: string }>(
      `select count(*)::text as count from information_schema.columns
       where table_schema='multiplayer_private' and table_name='contracts'
         and column_name in ('market', 'direction', 'barrier', 'stake', 'mode', 'ask_price', 'payout', 'profit', 'settled_at')`,
    );
    if (Number(details.rows[0]?.count) !== 9) throw new Error('multiplayer contract details migration is missing');
  }

  async createBrainInsight(ownerKey: string, input: BrainInsightInput): Promise<BrainInsight | null> {
    return this.withTransaction(async client => {
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [ownerKey]);
      const rate = await client.query<{ count: string }>(
        "select count(*)::text as count from brain_private.insights where owner_key=$1 and created_at > now() - interval '24 hours'",
        [ownerKey],
      );
      if (Number(rate.rows[0]?.count || 0) >= 20) return null;
      const alias = `Ranger-${ownerKey.slice(0, 6).toUpperCase()}`;
      await client.query('insert into brain_private.profiles(owner_key, display_name) values ($1,$2) on conflict (owner_key) do nothing', [ownerKey, alias]);
      const result = await client.query<BrainInsightRow>(
        `insert into brain_private.insights
          (owner_key, market_symbol, market_name, category, observation, expected_direction, barrier, horizon, confidence, xp_earned)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,10)
         returning id, market_symbol, market_name, category, observation, expected_direction, barrier, horizon, confidence, outcome, linked_trade_id, linked_trade_outcome, xp_earned, (extract(epoch from created_at) * 1000)::bigint as created_at, (extract(epoch from reviewed_at) * 1000)::bigint as reviewed_at`,
        [ownerKey, input.marketSymbol, input.marketName, input.category, input.observation, input.expectedDirection, input.barrier, input.horizon, input.confidence],
      );
      return brainInsightFromRow(result.rows[0]!);
    });
  }

  async listBrainInsights(ownerKey: string): Promise<BrainInsight[]> {
    const result = await this.pool.query<BrainInsightRow>(
      `select id, market_symbol, market_name, category, observation, expected_direction, barrier, horizon, confidence, outcome, linked_trade_id, linked_trade_outcome, xp_earned,
        (extract(epoch from created_at) * 1000)::bigint as created_at,
        (extract(epoch from reviewed_at) * 1000)::bigint as reviewed_at
       from brain_private.insights where owner_key=$1 order by created_at desc limit 60`,
      [ownerKey],
    );
    return result.rows.map(brainInsightFromRow);
  }

  /** Link only a later, settled trade belonging to this verified Deriv account. */
  async syncBrainInsightOutcomes(ownerKey: string, accountId: string): Promise<void> {
    await this.withTransaction(async client => {
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [ownerKey]);
      await client.query(
        `with candidates as (
          select i.id as insight_id, c.id as trade_id, c.status as trade_status, c.settled_at,
            row_number() over (partition by i.id order by c.created_at asc, c.id) as insight_rank,
            row_number() over (partition by c.id order by i.created_at desc, i.id) as trade_rank
          from brain_private.insights i
          join multiplayer_private.contracts c
            on c.account_id=$2
           and c.market=i.market_symbol
           and c.direction=i.expected_direction
           and c.barrier=i.barrier
           and c.created_at > i.created_at
           and c.created_at <= i.created_at + case i.horizon
             when 'next_5' then interval '5 minutes'
             when 'next_20' then interval '20 minutes'
             else interval '12 hours' end
           and c.status in ('won','lost')
           and c.settled_at is not null
          where i.owner_key=$1 and i.outcome='pending' and i.expected_direction in ('over','under')
            and i.observation not like '%[Brain stance: good]' and i.observation not like '%[Brain stance: warning]'
            and not exists (select 1 from brain_private.insights linked where linked.linked_trade_id=c.id)
        )
        update brain_private.insights i
        set outcome=case when c.trade_status='won' then 'matched' else 'unmatched' end,
            linked_trade_id=c.trade_id,
            linked_trade_outcome=c.trade_status,
            xp_earned=case when c.trade_status='won' then i.xp_earned + 25 else i.xp_earned - 20 end,
            reviewed_at=c.settled_at
        from candidates c
        where i.id=c.insight_id and c.insight_rank=1 and c.trade_rank=1
          and not exists (select 1 from brain_private.insights linked where linked.linked_trade_id=c.trade_id)`,
        [ownerKey, accountId],
      );
    });
  }

  /** Count settled contracts with the same market and contract after a structured lesson.
   * These are comparable outcomes, not evidence that the user's observation repeated. */
  async brainComparableOutcomes(ownerKey: string, accountId: string): Promise<{ byInsight: Record<string, { similarTrades: number; similarWins: number; similarLosses: number }>; distinctTrades: number }> {
    const result = await this.pool.query<{ insight_id: string; trades: string; wins: string; losses: string; distinct_trades: string }>(
      `with matching as (
         select i.id as insight_id, c.id as trade_id, c.status
         from brain_private.insights i
         join multiplayer_private.contracts c on c.account_id=$2 and c.market=i.market_symbol
           and c.direction=i.expected_direction and c.barrier=i.barrier
           and c.created_at > i.created_at
           and c.created_at <= i.created_at + case i.horizon
             when 'next_5' then interval '5 minutes' when 'next_20' then interval '20 minutes'
             else interval '12 hours' end
           and c.status in ('won','lost') and c.settled_at is not null
         where i.owner_key=$1 and (i.observation like '%[Brain stance: good]' or i.observation like '%[Brain stance: warning]')
       )
       select insight_id::text, count(*)::text as trades,
         count(*) filter (where status='won')::text as wins,
         count(*) filter (where status='lost')::text as losses,
         (select count(distinct trade_id)::text from matching) as distinct_trades
       from matching group by insight_id`,
      [ownerKey, accountId],
    );
    const byInsight: Record<string, { similarTrades: number; similarWins: number; similarLosses: number }> = {};
    for (const row of result.rows) byInsight[row.insight_id] = {
      similarTrades: Number(row.trades), similarWins: Number(row.wins), similarLosses: Number(row.losses),
    };
    return { byInsight, distinctTrades: Number(result.rows[0]?.distinct_trades || 0) };
  }

  // Account-scoped estimates of saved row bytes; not database quota or disk usage.
  // Cache briefly to avoid scanning the account on every Brain refresh.
  private readonly brainStorageGeneration = new Map<string, number>();
  private invalidateBrainStorage(accountId: string): void {
    // Account-specific generation also prevents an in-flight stale read being cached.
    if (this.brainStorageGeneration.size >= 1000 && !this.brainStorageGeneration.has(accountId)) this.brainStorageGeneration.clear();
    this.brainStorageGeneration.set(accountId, (this.brainStorageGeneration.get(accountId) ?? 0) + 1);
    for (const key of this.brainStorageCache.keys()) if (key.endsWith(':' + accountId)) this.brainStorageCache.delete(key);
  }
  private readonly brainStorageCache = new Map<string, { until: number; value: { bytes: number; lessons: number; trades: number; snapshots: number; measurement: 'estimated_row_bytes' } }>();
  async brainStorageUsage(ownerKey: string, accountId: string): Promise<{ bytes: number; lessons: number; trades: number; snapshots: number; measurement: 'estimated_row_bytes' }> {
    const key = ownerKey + ':' + accountId;
    const cached = this.brainStorageCache.get(key);
    if (cached && cached.until > Date.now()) return cached.value;
    const generation = this.brainStorageGeneration.get(accountId) ?? 0;
    const result = await this.pool.query<{ lessons: string; trades: string; snapshots: string; bytes: string }>(
      `select
        (select count(*) from brain_private.insights i where i.owner_key=$1)::text as lessons,
        (select count(*) from multiplayer_private.contracts c where c.account_id=$2 and c.provider_contract_id is not null)::text as trades,
        (select count(*) from multiplayer_private.trade_context x where x.account_id=$2)::text as snapshots,
        ((select coalesce(sum(pg_column_size(i)),0) from brain_private.insights i where i.owner_key=$1)
         + (select coalesce(sum(pg_column_size(c)),0) from multiplayer_private.contracts c where c.account_id=$2 and c.provider_contract_id is not null)
         + (select coalesce(sum(pg_column_size(x)),0) from multiplayer_private.trade_context x where x.account_id=$2))::text as bytes`,
      [ownerKey, accountId],
    );
    const row = result.rows[0];
    const value = { bytes: Math.max(0, Number(row?.bytes || 0)), lessons: Math.max(0, Number(row?.lessons || 0)),
      trades: Math.max(0, Number(row?.trades || 0)), snapshots: Math.max(0, Number(row?.snapshots || 0)),
      measurement: 'estimated_row_bytes' as const };
    if (this.brainStorageCache.size >= 1000) this.brainStorageCache.clear();
    if ((this.brainStorageGeneration.get(accountId) ?? 0) === generation) this.brainStorageCache.set(key, { until: Date.now() + 30000, value });
    return value;
  }

  async brainInsightProgress(ownerKey: string): Promise<BrainInsightProgress> {
    const result = await this.pool.query<{ total: string; reviewed: string; matched: string; unmatched: string; patterns: string; xp: string; linked_wins: string }>(
      `select
        (select count(*) from brain_private.insights where owner_key=$1)::text as total,
        (select count(*) from brain_private.insights where owner_key=$1 and outcome <> 'pending')::text as reviewed,
        (select count(*) from brain_private.insights where owner_key=$1 and outcome = 'matched')::text as matched,
        (select count(*) from brain_private.insights where owner_key=$1 and outcome = 'unmatched')::text as unmatched,
        (select count(*) from (
          select market_symbol, category, expected_direction, barrier from brain_private.insights where owner_key=$1
          group by market_symbol, category, expected_direction, barrier having count(*) >= 2
        ) repeated)::text as patterns,
        (select coalesce(sum(xp_earned),0) from brain_private.insights where owner_key=$1)::text as xp,
        (select count(*) from brain_private.insights where owner_key=$1 and linked_trade_outcome='won')::text as linked_wins`,
      [ownerKey],
    );
    const row = result.rows[0];
    const xp = Math.max(0, Number(row?.xp || 0));
    return { total: Number(row?.total || 0), reviewed: Number(row?.reviewed || 0), matched: Number(row?.matched || 0), unmatched: Number(row?.unmatched || 0), patterns: Number(row?.patterns || 0), xp, level: Math.floor(xp / 100) + 1, levelXp: xp % 100, linkedWins: Number(row?.linked_wins || 0) };
  }

  async brainLeaderboard(limit = 10): Promise<BrainLeaderboardEntry[]> {
    const result = await this.pool.query<{ display_name: string; xp: string; linked_wins: string; contributions: string }>(
      `select p.display_name, greatest(coalesce(sum(i.xp_earned),0),0)::text as xp,
        count(*) filter (where i.linked_trade_outcome='won')::text as linked_wins,
        count(i.id)::text as contributions
       from brain_private.profiles p
       left join brain_private.insights i on i.owner_key=p.owner_key
       group by p.owner_key, p.display_name
       order by greatest(coalesce(sum(i.xp_earned),0),0) desc, count(i.id) desc, p.display_name asc
       limit $1`,
      [Math.max(1, Math.min(20, Math.trunc(limit)))],
    );
    return result.rows.map(row => { const xp = Number(row.xp); return { displayName: row.display_name, xp, level: Math.floor(xp / 100) + 1, linkedWins: Number(row.linked_wins), contributions: Number(row.contributions) }; });
  }

  async observeBrainEvidence(report: { marketSymbol: string | null; market: string | null; lessons: Array<{ id: string; topic: string; finding: string; validity: 'provisional' | 'validated'; outcomes: number }>; updatedAt: number }, observedAt = Date.now()): Promise<Array<{ market: string; lessonId: string; topic: string; finding: string; validity: 'provisional' | 'validated'; outcomes: number; observedAt: number; evidenceAt: number }>> {
    if (!report.marketSymbol) return [];
    return this.withTransaction(async client => {
      for (const lesson of report.lessons) {
        if (!lesson.id || !lesson.finding || !Number.isFinite(lesson.outcomes) || lesson.outcomes <= 0) continue;
        const fingerprint = lesson.validity + '|' + lesson.finding.replace(/\d+(?:[.,]\d+)?%?/g, '#');
        await client.query(
          `insert into brain_private.evidence_memory_events
            (market_symbol, market_name, lesson_id, topic, finding, fingerprint, validity, outcomes, evidence_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           on conflict (market_symbol, lesson_id, fingerprint) do nothing`,
          [report.marketSymbol, report.market, lesson.id, lesson.topic, lesson.finding, fingerprint, lesson.validity, lesson.outcomes, new Date(report.updatedAt || observedAt)],
        );
      }
      const rows = await client.query<{ market_name: string; lesson_id: string; topic: string; finding: string; validity: 'provisional' | 'validated'; outcomes: number; created_at: Date; evidence_at: Date }>(
        `select market_name, lesson_id, topic, finding, validity, outcomes, created_at, evidence_at
         from brain_private.evidence_memory_events where market_symbol=$1 order by created_at desc limit 40`,
        [report.marketSymbol],
      );
      return rows.rows.map(row => ({ market: row.market_name, lessonId: row.lesson_id, topic: row.topic, finding: row.finding, validity: row.validity, outcomes: Number(row.outcomes), observedAt: new Date(row.created_at).getTime(), evidenceAt: new Date(row.evidence_at).getTime() }));
    });
  }

  async riskSnapshot(accountId: string, balance: number): Promise<AccountRisk> {
    if (!accountId || !Number.isFinite(balance) || balance < 0) throw new Error('valid account and balance required');
    // Owner accounts may enter through the legacy encrypted Deriv session rather
    // than createSession(). The verified account must exist before its risk row.
    await this.pool.query(
      'insert into multiplayer_private.accounts(account_id) values ($1) on conflict (account_id) do nothing',
      [accountId],
    );
    const result = await this.pool.query<{ mode: 'base' | 'recovering'; streak: number; debt: string; attempts: number; cycle_stake: string; peak_balance: string }>(
      `insert into multiplayer_private.account_risk(account_id, peak_balance) values ($1, $2)
       on conflict (account_id) do update set peak_balance=greatest(multiplayer_private.account_risk.peak_balance, excluded.peak_balance)
       returning mode, streak, debt, attempts, cycle_stake, peak_balance`, [accountId, balance],
    );
    const row = result.rows[0];
    return { mode: row.mode, streak: Number(row.streak), debt: Number(row.debt), attempts: Number(row.attempts), cycleStake: Number(row.cycle_stake), peakBalance: Number(row.peak_balance) };
  }

  async createRoom(accountId: string): Promise<string> {
    return this.withTransaction(async client => {
      const room = await client.query<{ id: string }>('insert into multiplayer_private.rooms default values returning id');
      await client.query('insert into multiplayer_private.room_members(room_id, account_id) values ($1, $2)', [room.rows[0].id, accountId]);
      return room.rows[0].id;
    });
  }

  async joinRoom(accountId: string, roomId: string): Promise<boolean> {
    if (!validRoomId(roomId)) return false;
    const result = await this.pool.query(
      `insert into multiplayer_private.room_members(room_id, account_id)
       select id, $2 from multiplayer_private.rooms where id=$1 and closed_at is null
       on conflict (room_id, account_id) do nothing`, [roomId, accountId],
    );
    return result.rowCount === 1 || await this.isRoomMember(accountId, roomId);
  }

  async isRoomMember(accountId: string, roomId: string): Promise<boolean> {
    if (!validRoomId(roomId)) return false;
    const result = await this.pool.query(
      `select 1 from multiplayer_private.room_members m join multiplayer_private.rooms r on r.id=m.room_id
       where m.account_id=$1 and m.room_id=$2 and r.closed_at is null`, [accountId, roomId],
    );
    return result.rowCount === 1;
  }

  async createSession(accountId: string, token: string, tokenExpiresAt: number): Promise<string> {
    const now = Date.now();
    if (!accountId || !token || !Number.isFinite(tokenExpiresAt) || tokenExpiresAt <= now) throw new Error('valid Deriv authorization required');
    const secret = randomBytes(32).toString('base64url');
    const encrypted = encryptToken(token);
    const expiresAt = new Date(Math.min(tokenExpiresAt, now + 12 * 60 * 60 * 1000));
    await this.withTransaction(async client => {
      await client.query('insert into multiplayer_private.accounts(account_id) values ($1) on conflict (account_id) do nothing', [accountId]);
      await client.query('insert into multiplayer_private.sessions(session_hash, account_id, token_cipher, expires_at) values ($1, $2, $3, $4)', [sessionHash(secret), accountId, encrypted, expiresAt]);
    });
    return secret;
  }

  async resolveSession(secret: unknown): Promise<{ accountId: string; token: string; expiresAt: number } | null> {
    if (!validSecret(secret)) return null;
    const result = await this.pool.query<{ account_id: string; token_cipher: string; expires_at: Date }>(
      'select account_id, token_cipher, expires_at from multiplayer_private.sessions where session_hash=$1 and expires_at > now()', [sessionHash(secret)],
    );
    const row = result.rows[0];
    return row ? { accountId: row.account_id, token: decryptToken(row.token_cipher), expiresAt: new Date(row.expires_at).getTime() } : null;
  }

  async revokeSession(secret: unknown): Promise<void> {
    if (validSecret(secret)) await this.pool.query('delete from multiplayer_private.sessions where session_hash=$1', [sessionHash(secret)]);
  }

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  /** Unique account and request constraints serialize even across server processes. */
  async reserve(accountId: string, requestId: string, order: { market: string; direction: 'over' | 'under'; barrier: number; stake: number; mode: 'demo' | 'real' }): Promise<string> {
    if (!accountId || !requestId || requestId.length > 128) throw new Error('account and idempotency key required');
    const result = await this.pool.query<{ id: string }>(
      `insert into multiplayer_private.contracts(account_id, idempotency_key, status, market, direction, barrier, stake, mode)
       values ($1, $2, 'purchasing', $3, $4, $5, $6, $7) returning id`,
      [accountId, requestId, order.market, order.direction, order.barrier, order.stake, order.mode],
    );
    return result.rows[0].id;
  }

  async markUnknown(accountId: string, id: string, providerContractId: string | null = null): Promise<void> {
    const result = await this.pool.query(
      `update multiplayer_private.contracts set status='unknown', provider_contract_id=coalesce($3, provider_contract_id), updated_at=now()
       where account_id=$1 and id=$2 and status='purchasing'`, [accountId, id, providerContractId],
    );
    if (result.rowCount !== 1) throw new Error('account reservation not found');
  }

  async cancelBeforeBuy(accountId: string, id: string): Promise<void> {
    await this.pool.query(
      `update multiplayer_private.contracts set status='error', updated_at=now()
       where account_id=$1 and id=$2 and status='purchasing'`, [accountId, id],
    );
  }

  async markPurchased(accountId: string, id: string, providerContractId: string, askPrice: number, payout: number): Promise<void> {
    if (!providerContractId) throw new Error('provider contract id required');
    const result = await this.pool.query(
      `update multiplayer_private.contracts set status='open', provider_contract_id=$3, ask_price=$4, payout=$5, updated_at=now()
       where account_id=$1 and id=$2 and status in ('purchasing','unknown')`, [accountId, id, providerContractId, askPrice, payout],
    );
    if (result.rowCount !== 1) throw new Error('account reservation not found');
    this.invalidateBrainStorage(accountId);
  }

  /** Release a reservation only after the matching provider contract settles. */
  async recordSettlement(accountId: string, providerContractId: string, outcome: 'won' | 'lost', profit: number): Promise<void> {
    if (!accountId || !providerContractId) throw new Error('account and provider contract required');
    if (!Number.isFinite(profit)) throw new Error('valid settlement profit required');
    await this.withTransaction(async client => {
      const result = await client.query(
        `update multiplayer_private.contracts set status=$3, profit=$4, settled_at=now(), updated_at=now()
         where account_id=$1 and provider_contract_id=$2 and status in ('open','unknown')`,
        [accountId, providerContractId, outcome, profit],
      );
      if (result.rowCount !== 1) throw new Error('matching open contract not found');
      await client.query('insert into multiplayer_private.account_risk(account_id) values ($1) on conflict (account_id) do nothing', [accountId]);
      const current = await client.query<{ mode: 'base' | 'recovering'; streak: number; debt: string; attempts: number; cycle_stake: string; peak_balance: string }>(
        'select mode, streak, debt, attempts, cycle_stake, peak_balance from multiplayer_private.account_risk where account_id=$1 for update', [accountId],
      );
      const row = current.rows[0];
      const next = nextRecovery({ mode: row.mode, streak: Number(row.streak), debt: Number(row.debt), attempts: Number(row.attempts), cycleStake: Number(row.cycle_stake), peakBalance: Number(row.peak_balance) }, outcome === 'won', profit);
      await client.query(
        `update multiplayer_private.account_risk set mode=$2, streak=$3, debt=$4, attempts=$5, cycle_stake=$6, peak_balance=$7, updated_at=now() where account_id=$1`,
        [accountId, next.mode, next.streak, next.debt, next.attempts, next.cycleStake, next.peakBalance],
      );
    });
  }

  /** Resolve an owned settled digit trade on the server; never trust client trade fields. */
  async brainSourceTrade(accountId: string, tradeId: string): Promise<{ id: string; market: string; direction: 'over' | 'under'; barrier: number } | null> {
    const result = await this.pool.query<{ id: string; market: string; direction: 'over' | 'under'; barrier: number }>(
      `select id, market, direction, barrier from multiplayer_private.contracts
       where account_id=$1 and id=$2 and status in ('won','lost') and settled_at is not null
         and direction in ('over','under') and barrier between 0 and 9 limit 1`,
      [accountId, tradeId],
    );
    const row = result.rows[0];
    return row ? { ...row, barrier: Number(row.barrier) } : null;
  }

  async saveTradeContext(accountId: string, providerContractId: string, context: Record<string, unknown>): Promise<void> {
    const result = await this.pool.query(`insert into multiplayer_private.trade_context (contract_id, account_id, context)
      select id, account_id, $3::jsonb from multiplayer_private.contracts
      where account_id=$1 and provider_contract_id=$2
      on conflict (contract_id) do update set context=trade_context.context || excluded.context, updated_at=now()`,
      [accountId, providerContractId, JSON.stringify(context)]);
    if (!result.rowCount) throw new Error('No matching contract found for trade context');
    this.invalidateBrainStorage(accountId);
  }

  /** Bounded, account-scoped samples used only by the Brain review endpoint. */
  /** Settled player trades explicitly submitted from a held Brain pick.
   * Older or uncaptured trades are not attributed. Values are account scoped.
   */
  async brainPickPerformance(accountId: string): Promise<{ settled: number; wins: number; losses: number; netProfit: number | null; grossWon: number | null; grossLost: number | null; complete: boolean } | null> {
    try {
      const result = await this.pool.query<{ settled: string; wins: string; losses: string; missing_profit: string; net_profit: string | null; gross_won: string | null; gross_lost: string | null }>(
        `select count(*)::text as settled,
          count(*) filter (where c.status='won')::text as wins,
          count(*) filter (where c.status='lost')::text as losses,
          count(*) filter (where c.profit is null)::text as missing_profit,
          sum(c.profit)::text as net_profit,
          sum(greatest(c.profit, 0))::text as gross_won,
          sum(least(c.profit, 0))::text as gross_lost
         from multiplayer_private.contracts c
         join multiplayer_private.trade_context t on t.contract_id=c.id and t.account_id=c.account_id
         where c.account_id=$1 and c.status in ('won','lost') and c.settled_at is not null
           and t.context->'brainPick' = 'true'::jsonb`, [accountId]);
      const row = result.rows[0];
      const settled = Number(row?.settled || 0), missing = Number(row?.missing_profit || 0);
      return { settled, wins: Number(row?.wins || 0), losses: Number(row?.losses || 0),
        netProfit: settled && !missing ? Number(row.net_profit) : null,
        grossWon: settled && !missing ? Number(row.gross_won) : null,
        grossLost: settled && !missing ? Math.abs(Number(row.gross_lost)) : null, complete: missing === 0 };
    } catch (error) {
      if ((error as { code?: string }).code === '42P01') return null;
      throw error;
    }
  }

  async listBrainEvaluationTrades(accountId: string): Promise<Array<Record<string, unknown>>> {
    try {
      const result = await this.pool.query(
        `select c.id, c.market, c.direction, c.barrier, c.stake, c.profit, c.mode, c.status,
                c.created_at, c.settled_at, t.context
         from multiplayer_private.contracts c
         join multiplayer_private.trade_context t on t.contract_id=c.id and t.account_id=c.account_id
         where c.account_id=$1 and c.status in ('won','lost') and c.settled_at is not null
         order by c.created_at desc, c.id desc limit 1000`, [accountId],
      );
      return result.rows;
    } catch (error) {
      // An older installation may not yet have the optional capture table.
      if ((error as { code?: string }).code === '42P01') return [];
      throw error;
    }
  }

  async listTradeContexts(accountId: string): Promise<Map<string, unknown>> {
    try {
      const result = await this.pool.query<{ contract_id: string; context: unknown }>(
        'select contract_id, context from multiplayer_private.trade_context where account_id=$1 order by updated_at desc limit 100', [accountId]);
      return new Map(result.rows.map(row => [String(row.contract_id), row.context]));
    } catch (error) {
      // Migration can be applied independently; old deployments remain readable.
      if ((error as { code?: string }).code === '42P01') return new Map();
      throw error;
    }
  }

  async listTrades(accountId: string, limit = 30): Promise<Array<Record<string, unknown>>> {
    const result = await this.pool.query(
      `select id, account_id, market, direction, barrier, stake, ask_price, payout, profit,
              mode, status, provider_contract_id, created_at, settled_at
       from multiplayer_private.contracts where account_id=$1 order by created_at desc limit $2`,
      [accountId, Math.max(1, Math.min(100, limit))],
    );
    return result.rows;
  }

  async activeContract(accountId: string): Promise<{ id: string; status: string; provider_contract_id: string | null; market: string } | null> {
    const result = await this.pool.query<{ id: string; status: string; provider_contract_id: string | null; market: string }>(
      `select id, status, provider_contract_id, market from multiplayer_private.contracts
       where account_id=$1 and status in ('purchasing','open','unknown') limit 1`, [accountId],
    );
    return result.rows[0] ?? null;
  }
}
