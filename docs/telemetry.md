# Pasture telemetry

The service keeps its existing trading database at `DATA_DIR/overunder.db`. It already contains saved digit history, scanner logs, decision evidence, test runs, account trade and virtual-paper ledger entries. Existing digit retention is bounded; this is not an archive of every tick since launch.

Production research telemetry is written in batches to the private `research_telemetry.events` schema in the configured Supabase database (`MULTIPLAYER_DATABASE_URL`). The schema is created by the telemetry worker and is not exposed to the browser API roles. Local development without a Supabase connection keeps using `DATA_DIR/telemetry.db` SQLite. The worker uses a small independent pool and bounded queue; a write failure does not block quotes, purchases, settlements, or stops.

Telemetry limits default to a 7-day retention window, one public tick per market every 10 seconds, and scanner/intelligence observations per setup every 60 seconds. Override these with `TELEMETRY_RETENTION_DAYS` (1–30 days), `TELEMETRY_TICK_INTERVAL_MS` (1–60 seconds), and `TELEMETRY_SCAN_INTERVAL_MS` (5–300 seconds). The existing SQLite telemetry file is left untouched during cutover; new production events go to Supabase, while legacy rows remain on the Railway volume until a verified historical migration is performed.

The versioned `telemetry_events` table includes observation time, event type, market, source and an allowlisted JSON payload. It records public ticks, scanner candidates, market health and regime snapshots, quotes and decisions, account trade events, server paper-scout events, historical replay progress, and browser paper-trade open/settled events. Browser events are best effort, rate limited, require owner access when the dashboard is protected, and are not guaranteed to survive an offline browser or reload. They start only after this change is deployed; previous browser-only paper studies cannot be recovered from this store. Account and virtual events have different sources and must be analyzed separately.

The collector excludes tokens, login IDs, balance snapshots, cookies and arbitrary request data. This is not a general page analytics tracker; it does not collect every click or mouse movement. Research evidence is not automatically promoted to a live trading rule.

`TELEMETRY_ENABLED=0` disables collection. `TELEMETRY_RETENTION_DAYS` defaults to 7 and is clamped to 1–30 days to keep the research store bounded. Pruning is incremental. Watch disk use: full tick collection can grow quickly. Retention applies to telemetry, not the existing trading database.

The endpoints require owner access when `DASHBOARD_ADMIN_TOKEN` is configured. Without that setting, the existing application treats requests as owner requests, so configure it before exposing these endpoints publicly.

Endpoints:

- `GET /api/telemetry/status` shows current worker state, queued, written, dropped and failed event counts since process start, plus retention days. These counters reset on restart.
- `GET /api/telemetry/events?after=0&limit=200` returns rows in ID order, at most 1000 at a time, with `nextAfter` for the next page. `data_json` is a JSON string; parse it when analyzing. Pagination describes observed writes, not a guarantee that no events were dropped.

For offline analysis, make a consistent SQLite backup of `telemetry.db` with SQLite's backup API while the service runs, or stop the service before copying. The database uses WAL; copying only the main file while it is active can omit recent writes. Back up the Railway volume separately and check volume usage. Do not commit database files.
