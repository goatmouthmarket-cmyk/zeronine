/* Actual on-device canvas recordings. Capture never participates in trading. */
(() => {
  'use strict';
  if (window.__pastureReplay) return;
  const DB = 'pasture-play-recordings-v1', MAX_RECORDS = 12, MAX_DURATION = 120000, MAX_BYTES = 10000000;
  const read = () => { try { return window.__zeronineReplaySnapshot?.() || null; } catch { return null; } };
  const mimeType = () => {
    try {
      if (typeof window.MediaRecorder?.isTypeSupported !== 'function') return '';
      const ua = window.navigator?.userAgent || '';
      const apple = /iPhone|iPad|iPod/.test(ua) || (/Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg/.test(ua));
      const mp4 = ['video/mp4;codecs=avc1.42E01E', 'video/mp4'];
      const webm = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'];
      const video = document.createElement?.('video');
      return (apple ? [...mp4, ...webm] : [...webm, ...mp4]).find(type =>
        window.MediaRecorder.isTypeSupported(type) && (typeof video?.canPlayType !== 'function' || !!video.canPlayType(type))
      ) || '';
    } catch { return ''; }
  };
  const supported = () => !!(window.indexedDB && window.crypto?.subtle && typeof window.crypto.randomUUID === 'function' && window.MediaRecorder && document.getElementById('game')?.captureStream && mimeType());
  let lastError = '';
  function issue(message) { lastError = message; window.dispatchEvent(new CustomEvent('zeronine:replay-updated')); }
  const scope = async (snapshot) => {
    if (!snapshot?.connected || !snapshot.accountId) return null;
    const bytes = new TextEncoder().encode('pasture-replay-v1:' + snapshot.accountId);
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  };
  let dbPromise;
  function db() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('recordings', { keyPath: 'id' }); const meta = request.result.createObjectStore('metadata', { keyPath: 'id' }); meta.createIndex('scope', 'scope'); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch(error => { dbPromise = null; throw error; });
    return dbPromise;
  }
  function requestResult(request) { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
  async function visibleScope() {
    const before = read(), key = await scope(before), after = read();
    return key && after?.connected && after.accountId === before.accountId ? key : null;
  }
  async function list() {
    if (!supported()) return [];
    const key = await visibleScope(); if (!key) return [];
    const store = (await db()).transaction('metadata', 'readonly').objectStore('metadata');
    const rows = await requestResult(store.index('scope').getAll(key));
    if (await visibleScope() !== key) return [];
    return rows.sort((a, b) => b.startedAt - a.startedAt).map(({ video, scope: hidden, ...metadata }) => metadata);
  }
  async function get(id) {
    if (!supported()) return null;
    const key = await visibleScope(); if (!key) return null;
    const store = (await db()).transaction('recordings', 'readonly').objectStore('recordings');
    const row = await requestResult(store.get(id));
    if (!row || row.scope !== key || await visibleScope() !== key) return null;
    const { scope: hidden, ...result } = row; return result;
  }
  async function put(row) {
    const database = await db();
    const { video, ...metadata } = row;
    await new Promise((resolve, reject) => { const tx = database.transaction(['recordings', 'metadata'], 'readwrite'); tx.objectStore('recordings').put(row); tx.objectStore('metadata').put(metadata); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
    const store = database.transaction('metadata', 'readonly').objectStore('metadata');
    const rows = await requestResult(store.index('scope').getAll(row.scope));
    const obsolete = rows.sort((a, b) => b.startedAt - a.startedAt).slice(MAX_RECORDS);
    if (obsolete.length) await new Promise((resolve, reject) => { const tx = database.transaction(['recordings', 'metadata'], 'readwrite'); for (const item of obsolete) { tx.objectStore('recordings').delete(item.id); tx.objectStore('metadata').delete(item.id); } tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    window.dispatchEvent(new CustomEvent('zeronine:replay-updated'));
  }
  let current = null, lastAim = null, recoveryBusy = false, lastRecovery = 0;
  async function reconcile() {
    if (recoveryBusy || !supported() || typeof window.__zeronineReplayResolve !== 'function') return;
    recoveryBusy = true;
    try {
      const key = await visibleScope(); if (!key) return;
      const database = await db();
      const meta = database.transaction('metadata', 'readonly').objectStore('metadata');
      const rows = await requestResult(meta.index('scope').getAll(key));
      for (const entry of rows) {
        if (entry.outcome !== 'pending' || !entry.tradeId) continue;
        const result = window.__zeronineReplayResolve(entry.tradeId);
        if (!result || !['won', 'lost'].includes(result.outcome) || String(result.tradeId) !== entry.tradeId || await visibleScope() !== key) continue;
        const stored = await requestResult(database.transaction('recordings', 'readonly').objectStore('recordings').get(entry.id));
        if (!stored || stored.scope !== key || await visibleScope() !== key) continue;
        stored.outcome = result.outcome; stored.profit = Number.isFinite(result.profit) ? result.profit : null;
        stored.stake = Number.isFinite(result.stake) && result.stake > 0 ? result.stake : null; stored.currency = result.currency || '';
        await put(stored);
      }
    } catch {} finally { recoveryBusy = false; }
  }
  function stop(session, reason) {
    if (!session || session.stopped) return;
    session.stopped = true;
    clearTimeout(session.deadline);
    if (reason) session.row.partialReason = reason;
    // Let MediaRecorder flush and finalize its container before ending tracks.
    try {
      if (session.recorder.state !== 'inactive') {
        session.releaseTimer = setTimeout(() => { for (const track of session.stream.getTracks()) track.stop(); }, 1500);
        session.recorder.stop();
        return;
      }
    } catch { clearTimeout(session.releaseTimer); }
    for (const track of session.stream.getTracks()) track.stop();
  }
  function begin(snapshot) {
    if (!supported()) return;
    let stream;
    try {
      const canvas = document.getElementById('game'); stream = canvas.captureStream(15);
      const type = mimeType();
      if (!type) { stream.getTracks().forEach(track => track.stop()); return; }
      const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 700000 });
      const session = { accountId: snapshot.accountId, aim: snapshot.aim, recorder, stream, chunks: [], bytes: 0, stopped: false, complete: false, saving: false, needsSave: false, verifiedOpen: false, openSaved: false, boundTradeId: null, sawSubmission: false, unverifiedAt: 0, row: {
        id: crypto.randomUUID(), scope: '', startedAt: Date.now(), endedAt: null, market: snapshot.market || '', direction: snapshot.direction || '', barrier: snapshot.barrier ?? null,
        mode: snapshot.mode, outcome: 'pending', partialReason: '', mimeType: type,
      } };
      current = session;
      const scoped = scope(snapshot).then(key => { session.row.scope = key; return key; }).catch(() => { issue('Recording storage is unavailable.'); return null; });
      recorder.ondataavailable = event => { if (!event.data?.size) return; session.bytes += event.data.size; session.chunks.push(event.data); if (session.bytes > MAX_BYTES) stop(session, 'Recording reached its size limit.'); };
      recorder.onerror = () => { issue('Recording was interrupted.'); stop(session, 'Recording interrupted.'); };
      session.persist = () => {
        if ((!session.complete && !(session.verifiedOpen && session.row.partialReason)) || !session.row.video?.size) return;
        if (session.saving) { session.needsSave = true; return; }
        session.saving = true;
        scoped.then(key => key ? put({ ...session.row }).then(() => { lastError = ''; }) : undefined).catch(() => issue('Recording could not be saved on this device.')).finally(() => { session.saving = false; if (session.needsSave) { session.needsSave = false; session.persist(); } });
      };
      recorder.onstop = () => {
        clearTimeout(session.releaseTimer);
        for (const track of session.stream.getTracks()) track.stop();
        if (current === session && session.complete) current = null;
        session.row.endedAt = Date.now();
        const video = new Blob(session.chunks, { type }); session.chunks = [];
        if (!video.size) return;
        session.row.video = video;
        session.persist();
      };
      recorder.start(1000);
      session.deadline = setTimeout(() => stop(session, 'Recording reached its time limit.'), MAX_DURATION);
    } catch { try { stream?.getTracks().forEach(track => track.stop()); } catch {} issue('Recording is unavailable on this device.'); /* Never affect a trade. */ }
  }
  function tick() {
    try {
      const s = read();
      if (s?.connected && Date.now() - lastRecovery >= 5000) { lastRecovery = Date.now(); reconcile().catch(() => {}); }
      if (current && (!s?.connected || s.accountId !== current.accountId)) { stop(current, current.complete ? '' : 'Account changed or signed out.'); current = null; lastAim = null; }
      if (current && s?.aim === current.aim && s.confirmedTradeId != null) {
        if (current.boundTradeId === null) current.boundTradeId = String(s.confirmedTradeId);
        else if (current.boundTradeId !== String(s.confirmedTradeId)) { stop(current, 'Trade identity changed.'); current = null; }
        if (current) { current.verifiedOpen = true; current.row.tradeId = current.boundTradeId; if (current.stopped && !current.openSaved) { current.openSaved = true; current.persist(); } }
      }
      if (current && (s?.aim !== current.aim || !s?.phase || s.phase === 'rejected')) {
        const session = current;
        if (!session.complete && session.sawSubmission && !session.boundTradeId) { session.row.outcome = 'unverified'; session.row.partialReason = 'Result could not be matched to this recording.'; session.complete = true; }
        stop(session, session.complete ? '' : 'Play ended before a confirmed result.');
        if (session.stopped) session.persist();
        current = null;
      }
      if (current && ['submitting', 'review', 'open', 'waiting', 'won', 'lost'].includes(s.phase)) current.sawSubmission = true;
      const resolved = current?.boundTradeId && typeof window.__zeronineReplayResolve === 'function' ? window.__zeronineReplayResolve(current.boundTradeId) : null;
      if (current && !current.complete && resolved && ['won', 'lost'].includes(resolved.outcome) && String(resolved.tradeId) === current.boundTradeId) {
        const session = current; session.row.outcome = resolved.outcome; session.row.profit = Number.isFinite(resolved.profit) ? resolved.profit : null; session.row.stake = Number.isFinite(resolved.stake) && resolved.stake > 0 ? resolved.stake : null; session.row.currency = resolved.currency || ''; session.complete = true;
        if (!session.stopped) setTimeout(() => stop(session), 250); else { session.persist(); current = null; }
      }
      if (current && !current.complete && !current.boundTradeId && current.sawSubmission && ['won', 'lost'].includes(s?.phase)) {
        if (!current.unverifiedAt) current.unverifiedAt = Date.now();
        if (Date.now() - current.unverifiedAt >= 5000) { const session = current; session.row.outcome = 'unverified'; session.row.partialReason = 'Result could not be matched to this recording.'; session.complete = true; if (!session.stopped) setTimeout(() => stop(session), 250); else { session.persist(); current = null; } }
      }
      if (s?.connected && s.accountId && s.phase === 'aiming' && s.aim && s.aim !== lastAim && !current) { lastAim = s.aim; begin(s); }
    } catch { /* Never interfere with the game loop or execution. */ }
  }
  window.__pastureReplay = { supported, list, get, status: () => lastError };
  setInterval(tick, 100);
  window.addEventListener('pagehide', () => { try { stop(current, 'Page closed before recording finished.'); } catch {} });
})();
