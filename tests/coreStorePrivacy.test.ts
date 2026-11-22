import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../web/src/store.ts', import.meta.url), 'utf8');
const start = source.indexOf('function set(patch:');
const end = source.indexOf('export function useStore()', start);
assert.ok(start >= 0 && end > start);
const setter = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture(owner = false) {
 const candidates = [{ lessonMatches: [{ id: 'private-lesson', state: 'matched' }] }];
 const context: any = { state: { owner, session: owner ? { loginid: 'OWNER_A', balance: 50 } : null, playerSession: owner ? null : { loginid: 'PLAYER_A', balance: 50 }, coreCandidates: candidates, coreAutoEnabled: true }, notifications: 0 };
 context.notifyListeners = () => context.notifications++;
 runInNewContext(setter, context);
 return { context, candidates };
}
test('switching players clears private lesson matches and Auto readiness immediately', () => {
 const { context } = fixture();
 context.set({ playerSession: { loginid: 'PLAYER_B', balance: 100 } });
 assert.equal(context.state.coreCandidates.length, 0);
 assert.equal(context.state.coreAutoEnabled, false);
 assert.equal(context.notifications, 1);
});
test('balance and connection updates for the same account keep current Core data', () => {
 const { context, candidates } = fixture();
 context.set({ playerSession: { loginid: 'PLAYER_A', balance: 70 }, playerConnectionOpen: true });
 assert.equal(context.state.coreCandidates, candidates);
 assert.equal(context.state.coreAutoEnabled, true);
});
test('owner account switches and player sign-out clear previous private Core data', () => {
 const owner = fixture(true).context;
 owner.set({ session: { loginid: 'OWNER_B', balance: 100 } });
 assert.equal(owner.state.coreCandidates.length, 0);
 assert.equal(owner.state.coreAutoEnabled, false);
 const guest = fixture().context;
 guest.set({ playerSession: null, playerAuthStatus: 'signed-out' });
 assert.equal(guest.state.coreCandidates.length, 0);
 assert.equal(guest.state.coreAutoEnabled, false);
});
