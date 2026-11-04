import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let db;
try {
  mkdirSync(dirname(workerData.path), { recursive: true });
  db = new DatabaseSync(workerData.path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=1000;
    CREATE TABLE IF NOT EXISTS telemetry_events (
      id INTEGER PRIMARY KEY, schema_version INTEGER NOT NULL, observed_at INTEGER NOT NULL,
      event_type TEXT NOT NULL, market TEXT, source TEXT NOT NULL, data_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS telemetry_events_time ON telemetry_events(observed_at, id);
    CREATE INDEX IF NOT EXISTS telemetry_events_market_time ON telemetry_events(market, observed_at, id);
    CREATE INDEX IF NOT EXISTS telemetry_events_type_id ON telemetry_events(event_type, id);`);
  const insert = db.prepare('INSERT INTO telemetry_events (schema_version, observed_at, event_type, market, source, data_json) VALUES (?, ?, ?, ?, ?, ?)');
  const prune = db.prepare('DELETE FROM telemetry_events WHERE id IN (SELECT id FROM telemetry_events WHERE observed_at < ? LIMIT 5000)');
  let lastPrune = 0;
  parentPort.postMessage({ type: 'ready' });
  parentPort.on('message', (message) => {
    if (message.type === 'batch') {
      try {
        db.exec('BEGIN');
        for (const event of message.events) insert.run(1, event.observedAt, event.type, event.market, event.source, JSON.stringify(event.data));
        db.exec('COMMIT');
        if (workerData.retentionDays > 0 && Date.now() - lastPrune > 60_000) {
          prune.run(Date.now() - workerData.retentionDays * 86400000);
          lastPrune = Date.now();
        }
        parentPort.postMessage({ type: 'written', count: message.events.length });
      } catch {
        try { db.exec('ROLLBACK'); } catch {}
        parentPort.postMessage({ type: 'failed', count: message.events.length });
      }
    } else if (message.type === 'query') {
      try {
        const rows = db.prepare('SELECT id, schema_version, observed_at, event_type, market, source, data_json FROM telemetry_events WHERE id > ? ORDER BY id LIMIT ?').all(message.after, message.limit);
        parentPort.postMessage({ type: 'query-result', requestId: message.requestId, rows });
      } catch {
        parentPort.postMessage({ type: 'query-result', requestId: message.requestId, error: 'Telemetry database unavailable' });
      }
    } else if (message.type === 'close') {
      db.close();
      parentPort.postMessage({ type: 'closed' });
      parentPort.close();
    }
  });
} catch {
  try { db?.close(); } catch {}
  parentPort.postMessage({ type: 'startup-failed' });
  parentPort.close();
}
