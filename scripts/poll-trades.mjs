import { getDb } from '../src/db/store.ts';
const db = getDb();
const poll = async (n) => {
  const rows = db.prepare('SELECT id, ts, contract_id, status, profit, reason FROM trades ORDER BY id DESC LIMIT 4').all();
  for (const t of rows)
    console.log(
      `t=${n}s id=${t.id} cid=${t.contract_id || '-'} status=${t.status} profit=${t.profit} age=${Math.round((Date.now() - t.ts) / 1000)}s`,
    );
  console.log('---');
};
for (let i = 0; i <= 75; i += 5) {
  await poll(i);
  await new Promise((r) => setTimeout(r, 5000));
}
db.close();
process.exit(0);