import assert from 'node:assert/strict';
import test from 'node:test';
import { goldDiagnostics, loadGoldConfig } from '../src/gold/config.ts';
import { CTraderGoldClient, GoldAdapterUnavailableError } from '../src/gold/ctrader.ts';

test('Gold configuration defaults to disabled, demo-first, and unconfigured', () => {
  const config = loadGoldConfig({});
  const diagnostics = goldDiagnostics(config);
  assert.equal(config.accountMode, 'demo');
  assert.equal(config.liveEnabled, false);
  assert.equal(diagnostics.status, 'unconfigured');
  assert.equal(diagnostics.executionCapable, false);
  assert.equal(diagnostics.marketDataCapable, false);
  assert.ok(diagnostics.missing.includes('CTRADER_ACCESS_TOKEN'));
});

test('Gold configuration rejects accidental live and malformed provider settings', () => {
  const malformed = loadGoldConfig({
    GOLD_LIVE_ENABLED: 'true',
    CTRADER_ACCOUNT_MODE: 'production',
    CTRADER_API_URL: 'ws://not-https.example',
  });
  const diagnostics = goldDiagnostics(malformed);
  assert.equal(malformed.liveEnabled, false);
  assert.equal(diagnostics.status, 'invalid_configuration');
  assert.match(diagnostics.validationErrors.join(' '), /GOLD_LIVE_ENABLED/);
  assert.match(diagnostics.validationErrors.join(' '), /CTRADER_ACCOUNT_MODE/);
  assert.match(diagnostics.validationErrors.join(' '), /https/);
});

test('live opt-in is still execution-locked and requires a live account mode', () => {
  const invalid = loadGoldConfig({ GOLD_LIVE_ENABLED: '1', CTRADER_ACCOUNT_MODE: 'demo' });
  assert.equal(goldDiagnostics(invalid).status, 'invalid_configuration');

  const configured = loadGoldConfig({
    GOLD_LIVE_ENABLED: '1',
    CTRADER_ACCOUNT_MODE: 'live',
    CTRADER_API_URL: 'https://openapi.ctrader.com',
    CTRADER_CLIENT_ID: 'client',
    CTRADER_CLIENT_SECRET: 'secret',
    CTRADER_ACCESS_TOKEN: 'token',
    CTRADER_ACCOUNT_ID: 'account',
  });
  const diagnostics = goldDiagnostics(configured);
  assert.equal(diagnostics.status, 'disabled');
  assert.equal(diagnostics.executionCapable, false);
  assert.match(diagnostics.reason, /locked/i);
});

test('the cTrader client is an unavailable market-data stub with no order method', async () => {
  const client = new CTraderGoldClient(loadGoldConfig({}));
  assert.equal('placeOrder' in client, false);
  assert.equal('buy' in client, false);
  await assert.rejects(client.listInstruments(), GoldAdapterUnavailableError);
  await assert.rejects(client.subscribePrices('XAUUSD', () => undefined), GoldAdapterUnavailableError);
  await client.close();
});
