import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCTraderAuthorizeUrl,
  createCTraderOAuthState,
  createCTraderPkce,
  isCTraderTokenExpired,
  normalizeCTraderTokenPayload,
  shouldRefreshCTraderToken,
  validateAndConsumeCTraderOAuthState,
} from '../src/gold/oauth.ts';

test('Gold cTrader OAuth creates a S256 PKCE authorization URL without secrets', () => {
  const pkce = createCTraderPkce();
  assert.match(pkce.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.match(pkce.challenge, /^[A-Za-z0-9_-]{43}$/);
  const state = createCTraderOAuthState('user-1', { now: 1_000, pkce });
  const url = new URL(buildCTraderAuthorizeUrl({
    authorizationEndpoint: 'https://id.ctrader.com/my/oauth2/authorize',
    clientId: 'gold-client',
    redirectUri: 'https://zeronine.example/api/gold/oauth/callback',
    scopes: ['trading', 'accounts'],
  }, state));
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'gold-client');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://zeronine.example/api/gold/oauth/callback');
  assert.equal(url.searchParams.get('state'), state.state);
  assert.equal(url.searchParams.get('code_challenge'), pkce.challenge);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('scope'), 'trading accounts');
  assert.equal(url.toString().includes(pkce.verifier), false);
});

test('Gold cTrader OAuth state is user-bound, short-lived, and single-use', () => {
  const state = createCTraderOAuthState('owner-1', { now: 1_000, ttlMs: 100 });
  assert.deepEqual(validateAndConsumeCTraderOAuthState(state, { state: 'wrong', userId: 'owner-1', now: 1_010 }), { ok: false, reason: 'invalid' });
  assert.deepEqual(validateAndConsumeCTraderOAuthState(state, { state: state.state, userId: 'owner-2', now: 1_010 }), { ok: false, reason: 'wrong_user' });
  assert.deepEqual(validateAndConsumeCTraderOAuthState(state, { state: state.state, userId: 'owner-1', now: 1_101 }), { ok: false, reason: 'expired' });
  const accepted = validateAndConsumeCTraderOAuthState(state, { state: state.state, userId: 'owner-1', now: 1_050 });
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.equal(accepted.record.usedAt, 1_050);
  assert.deepEqual(validateAndConsumeCTraderOAuthState(accepted.record, { state: state.state, userId: 'owner-1', now: 1_060 }), { ok: false, reason: 'replayed' });
});

test('Gold cTrader OAuth token payloads receive explicit safe expiry handling', () => {
  const token = normalizeCTraderTokenPayload({
    access_token: 'short-lived-access-token',
    refresh_token: 'server-only-refresh-token',
    token_type: 'Bearer',
    expires_in: '3600',
    scope: 'trading',
  }, 10_000);
  assert.equal(token.expiresAt, 3_610_000);
  assert.equal(isCTraderTokenExpired(token, 3_609_999), false);
  assert.equal(isCTraderTokenExpired(token, 3_610_000), true);
  assert.equal(shouldRefreshCTraderToken(token, 3_310_000), true);
  assert.equal(shouldRefreshCTraderToken(token, 3_200_000), false);
  assert.throws(() => normalizeCTraderTokenPayload({ access_token: 'x', expires_in: 0 }, 10_000), /expires_in/);
});
