/** Persist observations of the shared, paper-only Brain report. Never called by execution. */
import { getDb } from '../db/store.ts';
import type { RangerBrainReport } from './service.ts';

export interface BrainMemoryEvent {
  market: string;
  lessonId: string;
  topic: string;
  finding: string;
  validity: 'validated' | 'provisional';
  outcomes: number;
  observedAt: number;
  evidenceAt: number;
}

// Count and percentage movement alone is not a new type of finding.
export function brainFindingShape(finding: string): string {
  return finding.replace(/\d+(?:[.,]\d+)?%?/g, '#');
}

let schemaReady = false;

/** Records only what the server has actually observed, then returns recent changes. */
export function observeBrainMemory(report: RangerBrainReport, observedAt = Date.now()): BrainMemoryEvent[] {
  if (report.mode !== 'paper') throw new Error('Brain memory accepts paper reports only');
  const db = getDb();
  if (!schemaReady) db.exec(`CREATE TABLE IF NOT EXISTS brain_memory_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market TEXT NOT NULL,
    lesson_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    finding TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    validity TEXT NOT NULL,
    outcomes INTEGER NOT NULL,
    observed_at INTEGER NOT NULL,
    evidence_at INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS idx_brain_memory_market_lesson ON brain_memory_events(market, lesson_id, id DESC);`);
  schemaReady = true;
  if (!report.market) return [];
  const market = report.market;
  // Different windows cannot overwrite one another's interpretation. The
  // long-term journal is exclusively the standard 30-day paper report.
  if (report.lookbackDays === 30) {
    const latest = db.prepare('SELECT fingerprint FROM brain_memory_events WHERE market = ? AND lesson_id = ? ORDER BY id DESC LIMIT 1');
    const insert = db.prepare('INSERT INTO brain_memory_events(market, lesson_id, topic, finding, fingerprint, validity, outcomes, observed_at, evidence_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const changed = report.lessons.filter(lesson => {
      if (!lesson.id || !lesson.finding || !Number.isFinite(lesson.outcomes) || lesson.outcomes <= 0) return false;
      const fingerprint = lesson.validity + '|' + brainFindingShape(lesson.finding);
      const previous = latest.get(market, lesson.id) as { fingerprint: string } | undefined;
      return previous?.fingerprint !== fingerprint;
    });
    // Unchanged polling remains read-only. The short write transaction is
    // independent of quote, purchase, settlement, and recovery processing.
    if (changed.length) {
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const lesson of changed) {
          const fingerprint = lesson.validity + '|' + brainFindingShape(lesson.finding);
          const previous = latest.get(market, lesson.id) as { fingerprint: string } | undefined;
          if (previous?.fingerprint === fingerprint) continue;
          insert.run(market, lesson.id, lesson.topic, lesson.finding, fingerprint, lesson.validity, lesson.outcomes, observedAt, report.updatedAt || 0);
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
  }
  const rows = db.prepare('SELECT market, lesson_id, topic, finding, validity, outcomes, observed_at, evidence_at FROM brain_memory_events WHERE market = ? ORDER BY id DESC LIMIT 40').all(market) as Array<{ market: string; lesson_id: string; topic: string; finding: string; validity: 'validated' | 'provisional'; outcomes: number; observed_at: number; evidence_at: number }>;
  return rows.map(row => ({ market: row.market, lessonId: row.lesson_id, topic: row.topic, finding: row.finding, validity: row.validity, outcomes: row.outcomes, observedAt: row.observed_at, evidenceAt: row.evidence_at }));
}
