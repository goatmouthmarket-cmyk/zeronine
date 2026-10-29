import test from 'node:test';
import assert from 'node:assert/strict';
import { maySkipCowReview } from '../web/src/realCowConsent.ts';

test('remembered cow consent applies only to the same real account and real quote', () => {
  const real = { loginid: 'REAL1', mode: 'real' };
  assert.equal(maySkipCowReview('REAL1', real, real, 'real'), true);
  assert.equal(maySkipCowReview(null, real, real, 'real'), false);
  assert.equal(maySkipCowReview('REAL2', real, real, 'real'), false);
  assert.equal(maySkipCowReview('REAL1', real, { loginid: 'REAL2', mode: 'real' }, 'real'), false);
  assert.equal(maySkipCowReview('REAL1', real, { loginid: 'REAL1', mode: 'demo' }, 'real'), false);
  assert.equal(maySkipCowReview('REAL1', real, real, 'demo'), false);
});
