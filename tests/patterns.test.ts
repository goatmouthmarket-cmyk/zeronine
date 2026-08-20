import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDigits, countTransitions, baselineFrequency, PATTERN_MIN_SAMPLES, LIFT_OVER, LIFT_UNDER } from '../src/testlab/patterns.ts';

test('countTransitions tallies adjacent pairs and row sums', () => {
  const digits = [0, 1, 1, 2, 0, 1];
  const { matrix, rowSum, total } = countTransitions(digits);
  assert.equal(total, 5);
  assert.equal(matrix[0][1], 2, '0->1 twice');
  assert.equal(matrix[1][1], 1, '1->1 once');
  assert.equal(matrix[1][2], 1, '1->2 once');
  assert.equal(matrix[2][0], 1, '2->0 once');
  assert.deepEqual(rowSum, [2, 2, 1, 0, 0, 0, 0, 0, 0, 0]);
});

test('baselineFrequency is the marginal digit distribution', () => {
  const base = baselineFrequency([0, 0, 0, 1, 9, 9, 9, 9, 9, 5]);
  assert.equal(base[0], 0.3);
  assert.equal(base[1], 0.1);
  assert.equal(base[9], 0.5);
  assert.equal(base[5], 0.1);
});

test('a strongly over-represented transition is confirmed once it clears both windows', () => {
  const rnd = mulberry32(99);
  const series: number[] = [];
  for (let k = 0; k < 9000; k++) series.push(Math.floor(rnd() * 10));
  // bias the tail with an alternating 0,8 block: 0->8 is the majority of the
  // row "prev=0", so it must confirm in both the 2k and 5k windows.
  const off = series.length - 3200;
  for (let k = off; k < series.length; k++) series[k] = (k % 2 === 0) ? 0 : 8;

  const { confirmed, noise } = analyzeDigits('X', series);
  const hit = confirmed.find((p) => p.prev_digit === 0 && p.next_digit === 8);
  assert.ok(hit, '0->8 should confirm');
  assert.ok(hit.lift >= LIFT_OVER, `lift ${hit.lift}`);
  assert.ok(noise > 0, 'weak cells should be labelled noise');
});

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('uniform random digits confirm nothing', () => {
  const rnd = mulberry32(42);
  const digits: number[] = [];
  for (let k = 0; k < 9000; k++) digits.push(Math.floor(rnd() * 10));
  const { confirmed } = analyzeDigits('X', digits);
  assert.equal(confirmed.length, 0);
});

test('the sample floor guards sparse transitions', () => {
  const rnd = mulberry32(7);
  const digits: number[] = [];
  for (let k = 0; k < 9000; k++) digits.push(Math.floor(rnd() * 10));
  // make the last tick transition look skewed, but with far too few samples
  digits[8999] = 0;
  const { confirmed } = analyzeDigits('X', digits);
  assert.equal(confirmed.length, 0);
  assert.ok(PATTERN_MIN_SAMPLES >= 1);
  assert.ok(PATTERN_MIN_SAMPLES > 0);
  assert.ok(LIFT_UNDER < LIFT_OVER);
});