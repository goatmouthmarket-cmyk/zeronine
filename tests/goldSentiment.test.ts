import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreSentimentText,
  buildSentimentSnapshot,
  type GoldSentimentItem,
  type GoldSentimentSourceStatus,
} from '../src/gold/sentiment.ts';
import type { GoldSentimentFeedConfig } from '../src/gold/sentimentWorker.ts';

const NOW = 1_750_000_000_000;

test('scoreSentimentText returns bullish score for rate-cut language', () => {
  const result = scoreSentimentText('Fed signals rate cuts as inflation cools');
  assert.ok(result.score > 0.5);
  assert.ok(result.drivers.includes('rate cuts'));
});

test('scoreSentimentText returns bearish score for hawkish language', () => {
  const result = scoreSentimentText('Strong dollar and rising yields pressure gold');
  assert.ok(result.score < -0.5);
  assert.ok(result.drivers.includes('strong dollar') || result.drivers.includes('rising yields'));
});

test('scoreSentimentText returns neutral for unrelated text', () => {
  const result = scoreSentimentText('Apple releases new iPhone');
  assert.equal(result.score, 0);
  assert.equal(result.drivers.length, 0);
});

test('scoreSentimentText handles mixed bullish and bearish phrases', () => {
  const result = scoreSentimentText('Rate cuts expected but strong dollar persists');
  assert.ok(result.drivers.includes('rate cuts'));
  assert.ok(result.drivers.includes('strong dollar'));
});

test('buildSentimentSnapshot aggregates news and social with recency decay', () => {
  const recentNews: GoldSentimentItem = {
    id: 'src:recent', kind: 'news', source: 'google-news', title: 'Rate cut coming', url: null,
    publishedAt: NOW - 60_000, score: 1, drivers: ['rate cut'], fetchedAt: NOW,
  };
  const oldNews: GoldSentimentItem = {
    id: 'src:old', kind: 'news', source: 'google-news', title: 'Gold rallied last week', url: null,
    publishedAt: NOW - 10 * 60 * 60_000, score: 1, drivers: ['gold rallies'], fetchedAt: NOW,
  };
  const recentSocial: GoldSentimentItem = {
    id: 'src:social', kind: 'social', source: 'stocktwits', title: 'Bullish on gold', url: null,
    publishedAt: NOW - 30_000, score: 0.8, drivers: ['bullish gold'], fetchedAt: NOW,
  };
  const sources: GoldSentimentSourceStatus[] = [
    { kind: 'news', source: 'google-news', ok: true, items: 2, lastFetchAt: NOW, error: null },
    { kind: 'social', source: 'stocktwits', ok: true, items: 1, lastFetchAt: NOW, error: null },
  ];

  const snap = buildSentimentSnapshot([recentNews, oldNews, recentSocial], sources, { now: NOW });

  assert.ok(snap.newsScore > 0.5, 'recent news dominates');
  assert.ok(snap.socialScore > 0);
  assert.ok(snap.combinedScore > 0);
  assert.equal(snap.newsCount, 2);
  assert.equal(snap.socialCount, 1);
  assert.ok(snap.drivers.includes('rate cut'));
});

test('buildSentimentSnapshot returns neutral when no items', () => {
  const sources: GoldSentimentSourceStatus[] = [
    { kind: 'news', source: 'google-news', ok: true, items: 0, lastFetchAt: NOW, error: null },
  ];
  const snap = buildSentimentSnapshot([], sources, { now: NOW });
  assert.equal(snap.newsScore, 0);
  assert.equal(snap.socialScore, 0);
  assert.equal(snap.combinedScore, 0);
  assert.equal(snap.newsCount, 0);
  assert.equal(snap.socialCount, 0);
});

test('buildSentimentSnapshot respects windowMs and drops stale items', () => {
  const veryOld: GoldSentimentItem = {
    id: 'src:old', kind: 'news', source: 'test', title: 'Old news', url: null,
    publishedAt: NOW - 100 * 60 * 60_000, score: 1, drivers: ['rate cut'], fetchedAt: NOW,
  };
  const sources: GoldSentimentSourceStatus[] = [
    { kind: 'news', source: 'test', ok: true, items: 1, lastFetchAt: NOW, error: null },
  ];
  const snap = buildSentimentSnapshot([veryOld], sources, { now: NOW, windowMs: 48 * 60 * 60_000 });
  assert.equal(snap.newsCount, 0);
  assert.equal(snap.combinedScore, 0);
});

test('buildSentimentSnapshot blends news and social with configured weight', () => {
  const news: GoldSentimentItem = { id: 'n', kind: 'news', source: 'n', title: 'Rate cut', url: null, publishedAt: NOW, score: 1, drivers: [], fetchedAt: NOW };
  const social: GoldSentimentItem = { id: 's', kind: 'social', source: 's', title: 'Bullish', url: null, publishedAt: NOW, score: -1, drivers: [], fetchedAt: NOW };
  const sources: GoldSentimentSourceStatus[] = [
    { kind: 'news', source: 'n', ok: true, items: 1, lastFetchAt: NOW, error: null },
    { kind: 'social', source: 's', ok: true, items: 1, lastFetchAt: NOW, error: null },
  ];
  const snap = buildSentimentSnapshot([news, social], sources, { now: NOW, newsBlend: 0.65 });
  assert.ok(snap.combinedScore > 0 && snap.combinedScore < 1, 'blend respects news weight');
});

test('GoldSentimentWorker polls feeds and publishes snapshot', async () => {
  const fetched: string[] = [];
  const fakeFetch = async (url: string) => {
    fetched.push(url);
    if (url.includes('rss')) {
      return {
        ok: true, status: 200,
        text: async () => `<?xml version="1.0"?><rss><channel><item><title>Gold surges on rate cut fears - Publisher</title><link>https://example.com/1</link><pubDate>${new Date(NOW).toUTCString()}</pubDate></item></channel></rss>`,
      };
    }
    if (url.includes('stocktwits')) {
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({
          messages: [{ body: 'Gold to the moon!', created_at: new Date(NOW).toISOString(), entities: { sentiment: { basic: 'Bullish' } } }],
        }),
      };
    }
    return { ok: true, status: 200, text: async () => '{}' };
  };

  const { GoldSentimentWorker } = await import('../src/gold/sentimentWorker.ts');
  // Include one news RSS and the stocktwits feed
  const testFeeds: GoldSentimentFeedConfig[] = [
    { kind: 'news', source: 'test-news', url: 'https://example.com/rss', format: 'rss' },
    { kind: 'social', source: 'test-social', url: 'https://api.example.com/stocktwits', format: 'stocktwits' },
  ];
  const worker = new GoldSentimentWorker({
    fetchImpl: fakeFetch as any,
    intervalMs: 0,
    feeds: testFeeds,
    now: () => NOW,
  });

  const snapshots: any[] = [];
  worker.setOnSnapshot((snap) => snapshots.push(snap));

  await worker.poll();
  assert.ok(snapshots.length >= 1);
  const snap = snapshots[snapshots.length - 1];
  assert.ok(snap.newsCount >= 1);
  assert.ok(snap.socialCount >= 1);
  assert.ok(snap.sources.some((src: any) => src.ok === true));

  worker.stop();
  assert.equal(worker.state().running, false);
});

test('GoldSentimentWorker records per-source errors without throwing', async () => {
  const fakeFetch = async (url: string) => {
    if (url.includes('fxstreet')) throw new Error('fetch failed');
    if (url.includes('stocktwits')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ messages: [] }) };
    }
    return { ok: true, status: 200, text: async () => '<?xml version="1.0"?><rss><channel></channel></rss>' };
  };

  const { GoldSentimentWorker } = await import('../src/gold/sentimentWorker.ts');
  // Use a subset of feeds that includes fxstreet to test error handling
  const testFeeds: GoldSentimentFeedConfig[] = [
    { kind: 'news' as const, source: 'fxstreet', url: 'https://www.fxstreet.com/rss/news', format: 'rss' as const },
    { kind: 'news' as const, source: 'google-news', url: 'https://news.google.com/rss', format: 'rss' as const },
    { kind: 'social' as const, source: 'stocktwits', url: 'https://api.stocktwits.com/api/2/streams/symbol/XAUUSD.json', format: 'stocktwits' as const },
  ];
  const worker = new GoldSentimentWorker({
    fetchImpl: fakeFetch as any,
    intervalMs: 0,
    feeds: testFeeds,
    now: () => NOW,
  });

  const snapshots: any[] = [];
  worker.setOnSnapshot((snap) => snapshots.push(snap));

  await worker.poll();
  assert.ok(snapshots.length >= 1);
  const snap = snapshots[snapshots.length - 1];
  const fxstreet = snap.sources.find((s: any) => s.source === 'fxstreet');
  assert.ok(fxstreet);
  assert.equal(fxstreet.ok, false);
  assert.ok(fxstreet.error && fxstreet.error.includes('fetch failed'));

  worker.stop();
});

test('GoldSentimentWorker dedupes items by stable id across polls', async () => {
  let callCount = 0;
  const fakeFetch = async () => {
    callCount++;
    return { ok: true, status: 200, text: async () => `<?xml version="1.0"?><rss><channel><item><title>Rate cut coming - Source</title><link>https://example.com</link><pubDate>${new Date(NOW).toUTCString()}</pubDate></item></channel></rss>` };
  };

  const { GoldSentimentWorker } = await import('../src/gold/sentimentWorker.ts');
  const worker = new GoldSentimentWorker({
    fetchImpl: fakeFetch as any,
    intervalMs: 0,
    feeds: [{ kind: 'news', source: 'test', url: 'https://example.com/rss', format: 'rss' }],
    now: () => NOW,
  });

  const snapshots: any[] = [];
  worker.setOnSnapshot((snap) => snapshots.push(snap));

  await worker.poll();
  await worker.poll();
  const firstSnap = snapshots[0];
  const secondSnap = snapshots[1];
  assert.equal(secondSnap.newsCount, firstSnap.newsCount, 'deduped: item count stable across polls');
  assert.equal(callCount, 2);

  worker.stop();
});