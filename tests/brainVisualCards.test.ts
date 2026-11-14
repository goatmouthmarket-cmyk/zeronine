import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web/public/pasture-brain-refine.css', import.meta.url), 'utf8');
const journal = readFileSync(new URL('../web/public/pasture-brain-refine.js', import.meta.url), 'utf8');
const recordedReplay = readFileSync(new URL('../web/public/brain-recorded-replay.js', import.meta.url), 'utf8');

test('the Brain overview owns four visual cards and no duplicate data view', () => {
  for (const id of ['brainHeroCard', 'brainLearningCard', 'brainPatternsCard', 'brainDiscoveryCard']) {
    assert.ok(html.includes(`id="${id}"`), `${id} exists`);
  }
  assert.ok(html.includes('id="brainHeroScene"'));
  assert.ok(html.includes('id="brainLearnScene"'));
  assert.ok(html.includes('id="brainPatternScene"'));
  assert.ok(html.includes('id="brainMemoryScene"'));
  assert.equal(html.includes('brainOverviewLessons'), false);
  assert.equal(journal.includes('syncOverview'), false);
  assert.equal(journal.includes("observe(lessonsList"), false);
});

test('the single report renderer writes card counts, hours, discovery and lessons', () => {
  const start = html.indexOf('function renderReport()');
  const end = html.indexOf('function renderDecisionThoughts(', start);
  const render = html.slice(start, end);
  assert.ok(start >= 0 && end > start);
  for (const marker of ['brainLearnCount', 'brainLearnTarget', 'brainLearnStatus', 'brain-hour-bar', 'brainDiscoveryTitle', 'brain-lesson-card', 'brainLessonBody']) {
    assert.ok(render.includes(marker), `renderReport owns ${marker}`);
  }
  assert.ok(render.includes("createElement('button')"));
  assert.ok(render.includes("zeronine:brain-report"));
  assert.ok(render.includes("data-now"));
  assert.ok(render.includes("dataset.reason"));
  assert.equal(render.includes('brainPips.append'), false);
});

test('hour bars expose evidence for a tap and do not claim proof', () => {
  assert.ok(journal.includes('function showHourDetail('));
  assert.ok(journal.includes("barEl.dataset.outcomes"));
  assert.ok(journal.includes("aria-pressed"));
  assert.ok(html.includes('brainHourDetail'));
  const mind = html.slice(html.indexOf('id="brainPaneMind"'), html.indexOf('id="brainPaneLearned"'));
  assert.equal(/proven|guaranteed/i.test(mind), false);
});

test('card scenes only paint while visible and honor reduced motion', () => {
  assert.ok(journal.includes('document.hidden'));
  assert.ok(journal.includes('getClientRects().length'));
  assert.ok(journal.includes("const bob = reduce() ? 0"));
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));
  assert.ok(css.includes('.brain-hour-bar i { transition: none; }'));
  assert.ok(css.includes('grid-template-columns: minmax(0, 1fr)'));
  assert.ok(css.includes('@media (max-width: 999.98px)'));
});

test('lessons and recorded memories are read-only interactions', () => {
  assert.ok(journal.includes('toggleLessonCard('));
  assert.ok(journal.includes('See why'));
  assert.ok(recordedReplay.includes('window.__pastureReplay?.get(row.id)'));
  assert.ok(recordedReplay.includes('Earlier plays without recordings cannot be replayed'));
  assert.equal(journal.includes('paintMemoryThumb('), false);
  assert.equal(journal.includes('function playReplay('), false);
});

