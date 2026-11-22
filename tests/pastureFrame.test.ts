import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { inlinePastureRenderer } from '../src/api/pastureFrame.ts';

test('pasture renderer supports changed cache versions and script attributes', () => {
  for (const tag of [
    '<script src="/trading-room-core.js?v=20261116-server-ranger-sync"></script>',
    '<script src="/trading-room-core.js?v=20261122-setup1"></script>',
    "<script defer src='/trading-room-core.js'></script>",
  ]) assert.equal(inlinePastureRenderer('<body>'+tag+'</body>', 'window.ready=true;'), '<body><script>window.ready=true;</script></body>');
});
test('renderer source is inserted literally including replacement dollar tokens', () => {
  const renderer = 'const dollar = "$& $' + "'" + ' $$";';
  assert.equal(inlinePastureRenderer('<script src="/trading-room-core.js?v=new"></script>', renderer), '<script>'+renderer+'</script>');
});
test('missing, duplicate or unsafe renderer input is rejected explicitly', () => {
  const tag = '<script src="/trading-room-core.js"></script>';
  assert.throws(() => inlinePastureRenderer('<body></body>', ''), /exactly one/);
  assert.throws(() => inlinePastureRenderer(tag+tag, ''), /exactly one/);
  assert.throws(() => inlinePastureRenderer(tag, 'const bad="</script>";'), /terminator/);
});
test('the runtime pasture source HTML and renderer inline into syntactically valid scripts', () => {
  const html = readFileSync(new URL('../web/public/trading-room.html',import.meta.url),'utf8');
  const renderer = readFileSync(new URL('../web/public/trading-room-core.js',import.meta.url),'utf8');
  const inline = inlinePastureRenderer(html, renderer); let parsed=0;
  for (const match of inline.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/src=|type="(?:application\/json|importmap)"/.test(match[1])) continue;
    new Script(match[2]); parsed++;
  }
  assert.ok(parsed>0);
  assert.ok(inline.includes(renderer));
});
