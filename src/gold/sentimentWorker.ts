import {
  buildSentimentSnapshot,
  scoreSentimentText,
  type GoldSentimentItem,
  type GoldSentimentKind,
  type GoldSentimentScoreOptions,
  type GoldSentimentSnapshot,
  type GoldSentimentSourceStatus,
} from './sentiment.ts';

export type GoldSentimentResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

export type GoldSentimentFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<GoldSentimentResponse>;

export interface GoldSentimentFeedConfig {
  kind: GoldSentimentKind;
  /** Stable source label used in evidence and per-source diagnostics. */
  source: string;
  url: string;
  format: 'rss' | 'stocktwits' | 'reddit';
}

export interface GoldSentimentWorkerOptions {
  fetchImpl?: GoldSentimentFetch;
  intervalMs?: number;
  timeoutMs?: number;
  windowMs?: number;
  newsHalfLifeMs?: number;
  socialHalfLifeMs?: number;
  feeds?: GoldSentimentFeedConfig[];
  now?: () => number;
  /** Receives every snapshot the worker produces. Never throws outward. */
  onSnapshot?: (snapshot: GoldSentimentSnapshot) => void;
}

export interface GoldSentimentWorkerState {
  running: boolean;
  intervalMs: number;
  lastPollAt: number;
  nextPollAt: number;
  sources: GoldSentimentSourceStatus[];
  snapshot: GoldSentimentSnapshot | null;
}

const USER_AGENT = 'zeronine-gold-research/0.1 (news and social sentiment evidence)';

export const DEFAULT_GOLD_SENTIMENT_FEEDS: readonly GoldSentimentFeedConfig[] = [
  {
    kind: 'news',
    source: 'google-news-gold',
    url: 'https://news.google.com/rss/search?q=gold+price+OR+XAUUSD+when:2d&hl=en-US&gl=US&ceid=US:en',
    format: 'rss',
  },
  {
    kind: 'news',
    source: 'google-news-macro',
    url: 'https://news.google.com/rss/search?q=%22federal+reserve%22+OR+%22us+dollar%22+gold+when:2d&hl=en-US&gl=US&ceid=US:en',
    format: 'rss',
  },
  {
    kind: 'news',
    source: 'fxstreet',
    url: 'https://www.fxstreet.com/rss/news',
    format: 'rss',
  },
  {
    kind: 'social',
    source: 'stocktwits',
    url: 'https://api.stocktwits.com/api/2/streams/symbol/XAUUSD.json',
    format: 'stocktwits',
  },
  {
    kind: 'social',
    source: 'reddit',
    url: 'https://www.reddit.com/search.json?q=gold%20price&sort=new&t=day&limit=50',
    format: 'reddit',
  },
];

const MAX_ITEMS_PER_FEED = 40;
const MAX_TOTAL_ITEMS = 400;

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function stripCdata(text: string): string {
  return text.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
}

function tagValue(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? decodeXmlEntities(stripCdata(match[1]!.trim())) : null;
}

/**
 * Minimal RSS item extraction. Gold news sources publish standard RSS 2.0;
 * a regex extractor avoids pulling an XML dependency into the service.
 */
export function parseRssItems(xml: string): Array<{ title: string; link: string | null; publishedAt: number; publisher: string | null }> {
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  const items: Array<{ title: string; link: string | null; publishedAt: number; publisher: string | null }> = [];
  for (const block of blocks) {
    const rawTitle = tagValue(block, 'title');
    if (!rawTitle) continue;
    const rawLink = tagValue(block, 'link');
    const rawDate = tagValue(block, 'pubDate') ?? tagValue(block, 'published') ?? tagValue(block, 'updated');
    const publishedAt = rawDate ? Date.parse(rawDate) : Number.NaN;
    // Google News titles look like "Headline - Publisher". Keep both parts.
    const split = rawTitle.match(/^(.*) - ([^-]{2,40})$/);
    const title = split ? split[1]!.trim() : rawTitle.trim();
    const publisher = tagValue(block, 'source') ?? (split ? split[2]!.trim() : null);
    items.push({
      title,
      link: rawLink,
      publishedAt: Number.isFinite(publishedAt) ? publishedAt : 0,
      publisher,
    });
    if (items.length >= MAX_ITEMS_PER_FEED) break;
  }
  return items;
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
}

function itemFromText(input: {
  kind: GoldSentimentKind;
  source: string;
  title: string;
  url: string | null;
  publishedAt: number;
  fetchedAt: number;
  scoreOverride?: number;
}): GoldSentimentItem | null {
  const normalized = normalizeTitle(input.title);
  if (!normalized) return null;
  const scored = input.scoreOverride != null && Number.isFinite(input.scoreOverride) && Math.abs(input.scoreOverride) <= 1
    ? { score: Math.sign(input.scoreOverride) as number, drivers: [] }
    : scoreSentimentText(input.title);
  return {
    id: `${input.source}:${normalized}`,
    kind: input.kind,
    source: input.source,
    title: input.title.trim().slice(0, 300),
    url: input.url,
    publishedAt: Number.isFinite(input.publishedAt) && input.publishedAt > 0 ? input.publishedAt : input.fetchedAt,
    score: scored.score,
    drivers: scored.drivers,
    fetchedAt: input.fetchedAt,
  };
}

/**
 * Background news/social sentiment worker for the Gold module. It polls
 * keyless public sources on a fixed interval, scores headlines/posts, and
 * publishes an aggregated snapshot. It is research-only evidence: it never
 * gates, places, or blocks an order, and a total fetch failure leaves the
 * existing snapshot (or none) in place without throwing anywhere.
 */
export class GoldSentimentWorker {
  private readonly fetchImpl: GoldSentimentFetch;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;
  private readonly feeds: GoldSentimentFeedConfig[];
  private readonly now: () => number;
  private onSnapshot?: (snapshot: GoldSentimentSnapshot) => void;
  private readonly snapshotOptions: Pick<GoldSentimentScoreOptions, 'windowMs' | 'newsHalfLifeMs' | 'socialHalfLifeMs'>;
  private readonly items = new Map<string, GoldSentimentItem>();
  private readonly sourceStatus = new Map<string, GoldSentimentSourceStatus>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastPollAt = 0;
  private snapshot: GoldSentimentSnapshot | null = null;

  constructor(options: GoldSentimentWorkerOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? (async (url, init) => fetch(url, init));
    this.intervalMs = Math.max(30_000, options.intervalMs ?? 300_000);
    this.timeoutMs = Math.max(1_000, options.timeoutMs ?? 10_000);
    this.feeds = options.feeds ? [...options.feeds] : [...DEFAULT_GOLD_SENTIMENT_FEEDS];
    this.now = options.now ?? Date.now;
    this.onSnapshot = options.onSnapshot;
    this.snapshotOptions = {
      windowMs: options.windowMs,
      newsHalfLifeMs: options.newsHalfLifeMs,
      socialHalfLifeMs: options.socialHalfLifeMs,
    };
  }

  /** Registers (or replaces) the snapshot consumer, e.g. the Gold runtime. */
  setOnSnapshot(consumer: (snapshot: GoldSentimentSnapshot) => void): void {
    this.onSnapshot = consumer;
  }

  state(): GoldSentimentWorkerState {
    return {
      running: this.running,
      intervalMs: this.intervalMs,
      lastPollAt: this.lastPollAt,
      nextPollAt: this.running ? this.lastPollAt + this.intervalMs : 0,
      sources: this.feeds.map((feed) => this.statusFor(feed)),
      snapshot: this.snapshot ? { ...this.snapshot, topItems: [...this.snapshot.topItems], sources: [...this.snapshot.sources] } : null,
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One polling pass across every feed. Failures are per-feed and recorded. */
  async poll(): Promise<GoldSentimentSnapshot | null> {
    this.lastPollAt = this.now();
    await Promise.all(this.feeds.map((feed) => this.pollFeed(feed)));
    this.pruneItems();
    this.snapshot = buildSentimentSnapshot([...this.items.values()], this.feeds.map((feed) => this.statusFor(feed)), {
      ...this.snapshotOptions,
      now: this.lastPollAt,
    });
    if (this.onSnapshot) {
      try {
        this.onSnapshot(this.snapshot);
      } catch (error) {
        console.warn(`[gold-sentiment] snapshot consumer failed: ${String(error)}`);
      }
    }
    return this.snapshot;
  }

  private async pollFeed(feed: GoldSentimentFeedConfig): Promise<void> {
    const fetchedAt = this.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      timeout.unref?.();
      let response: GoldSentimentResponse;
      try {
        response = await this.fetchImpl(feed.url, { headers: { 'user-agent': USER_AGENT, accept: feed.format === 'rss' ? 'application/rss+xml, application/xml' : 'application/json' }, signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      const parsed = feed.format === 'rss' ? this.parseRssFeed(feed, body, fetchedAt)
        : feed.format === 'stocktwits' ? this.parseStockTwitsFeed(feed, body, fetchedAt)
          : this.parseRedditFeed(feed, body, fetchedAt);
      for (const item of parsed) this.items.set(item.id, item);
      this.sourceStatus.set(feed.source, { kind: feed.kind, source: feed.source, ok: true, items: parsed.length, lastFetchAt: fetchedAt, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.sourceStatus.set(feed.source, { kind: feed.kind, source: feed.source, ok: false, items: 0, lastFetchAt: fetchedAt, error: message.slice(0, 200) });
      console.warn(`[gold-sentiment] ${feed.source} fetch failed: ${message}`);
    }
  }

  private parseRssFeed(feed: GoldSentimentFeedConfig, body: string, fetchedAt: number): GoldSentimentItem[] {
    return parseRssItems(body)
      .map((row) => itemFromText({
        kind: feed.kind, source: feed.source, title: row.title, url: row.link, publishedAt: row.publishedAt, fetchedAt,
      }))
      .filter((item): item is GoldSentimentItem => item !== null);
  }

  private parseStockTwitsFeed(feed: GoldSentimentFeedConfig, body: string, fetchedAt: number): GoldSentimentItem[] {
    const parsed = JSON.parse(body) as { messages?: Array<{ body?: unknown; created_at?: unknown; entities?: { sentiment?: { basic?: unknown } } }> };
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    return messages
      .map((message) => {
        const text = typeof message.body === 'string' ? message.body : '';
        const createdAt = typeof message.created_at === 'string' ? Date.parse(message.created_at) : Number.NaN;
        const basic = message.entities?.sentiment?.basic;
        // StockTwits already carries an explicit crowd label per message; trust
        // it over the lexical scorer when present.
        const scoreOverride = basic === 'Bullish' ? 1 : basic === 'Bearish' ? -1 : undefined;
        return itemFromText({ kind: feed.kind, source: feed.source, title: text, url: null, publishedAt: createdAt, fetchedAt, scoreOverride });
      })
      .filter((item): item is GoldSentimentItem => item !== null)
      .slice(0, MAX_ITEMS_PER_FEED);
  }

  private parseRedditFeed(feed: GoldSentimentFeedConfig, body: string, fetchedAt: number): GoldSentimentItem[] {
    const parsed = JSON.parse(body) as { data?: { children?: Array<{ data?: { title?: unknown; created_utc?: unknown; permalink?: unknown } }> } };
    const children = Array.isArray(parsed.data?.children) ? parsed.data!.children : [];
    return children
      .map((child) => {
        const row = child.data ?? {};
        const title = typeof row.title === 'string' ? row.title : '';
        const createdAt = Number(row.created_utc);
        const permalink = typeof row.permalink === 'string' ? `https://www.reddit.com${row.permalink}` : null;
        return itemFromText({ kind: feed.kind, source: feed.source, title, url: permalink, publishedAt: Number.isFinite(createdAt) ? createdAt * 1000 : Number.NaN, fetchedAt });
      })
      .filter((item): item is GoldSentimentItem => item !== null)
      .slice(0, MAX_ITEMS_PER_FEED);
  }

  private statusFor(feed: GoldSentimentFeedConfig): GoldSentimentSourceStatus {
    return this.sourceStatus.get(feed.source)
      ?? { kind: feed.kind, source: feed.source, ok: false, items: 0, lastFetchAt: 0, error: 'not fetched yet' };
  }

  private pruneItems(): void {
    const windowMs = this.snapshotOptions.windowMs ?? 48 * 60 * 60_000;
    const cutoff = this.now() - windowMs;
    for (const [id, item] of this.items) {
      if (item.publishedAt < cutoff) this.items.delete(id);
    }
    if (this.items.size > MAX_TOTAL_ITEMS) {
      const keep = [...this.items.values()]
        .sort((left, right) => right.publishedAt - left.publishedAt)
        .slice(0, MAX_TOTAL_ITEMS);
      this.items.clear();
      for (const item of keep) this.items.set(item.id, item);
    }
  }
}
