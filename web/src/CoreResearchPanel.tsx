import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import './coreResearch.css';

interface ResearchRun {
  id: string; startingBalance: number; balance: number; stake: number; takeProfit: number; maxLoss: number;
  startedAt: number; settled: number; wins: number; losses: number; netProfit: number; maxDrawdown: number; phase: string;
}
interface ResearchTrade {
  id: string; market: string; direction: string; barrier: number; status: string; stake: number;
  profit: number | null; entryDigit: number | null; exitDigit: number | null; quotedPayout: number | null; settledAt: number | null;
}
interface ResearchState {
  engineVersion: string; available: boolean; running: boolean; canActivate?: boolean; autoEnabled?: boolean; run: ResearchRun | null;
  recent: ResearchTrade[]; coverage: { complete: number; missing: number }; reason?: string;
  readiness?: { settled: number; target: number; reason?: string };
}
const money = (value: unknown): string => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '—';
const signed = (value: number): string => (value > 0 ? '+' : '') + money(value);
const marketName = (symbol: string): string => {
  const fast = /^1HZ(\d+)V$/.exec(symbol), regular = /^R_(\d+)$/.exec(symbol);
  return fast ? 'Volatility ' + fast[1] + ' (1s)' : regular ? 'Volatility ' + regular[1] : symbol;
};
const stageLabel = (phase?: string): string => {
  const labels: Record<string, string> = {
    scanning: 'Scouting the pasture', quoting: 'Checking a live quote', open: 'Virtual trade open',
    'waiting-settlement': 'Waiting for the next result', waiting: 'Watching for a setup',
    'take-profit': 'Target reached', take_profit: 'Target reached', 'max-loss': 'Loss limit reached',
    max_run_loss: 'Loss limit reached', stopped: 'Research paused', paused: 'Research paused', idle: 'Ready to scout',
  };
  return labels[phase || ''] || 'Watching the pasture';
};

export function CoreResearchPanel({ onBack }: { onBack: () => void }): JSX.Element {
  const [state, setState] = useState<ResearchState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [stake, setStake] = useState('1');
  const [startingBalance, setStartingBalance] = useState('100');
  const [takeProfit, setTakeProfit] = useState('5');
  const [maxLoss, setMaxLoss] = useState('10');
  const mounted = useRef(false), revision = useRef(0), refreshing = useRef(false);
  const requestController = useRef<AbortController | null>(null);
  const [shot, setShot] = useState(false);
  const seenTrade = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    const controller = new AbortController();
    requestController.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    const serial = ++revision.current;
    try {
      const response = await fetch('/api/core/research', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || (response.status === 401 ? 'Connect Deriv to keep your research.' : 'Research is temporarily unavailable.'));
      if (mounted.current && serial === revision.current) {
        setState(body as ResearchState);
        setMessage('');
      }
    } catch (error) {
      if (mounted.current && serial === revision.current) setMessage(error instanceof Error ? error.message : 'Could not load research.');
    } finally {
      clearTimeout(timeout);
      refreshing.current = false;
      if (requestController.current === controller) requestController.current = null;
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const visibleRefresh = () => { if (!document.hidden) void refresh(); };
    const timer = window.setInterval(visibleRefresh, 3000);
    document.addEventListener('visibilitychange', visibleRefresh);
    return () => { mounted.current = false; revision.current++; requestController.current?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visibleRefresh); };
  }, [refresh]);

  const newest = state?.recent?.[0];
  useEffect(() => {
    const next = newest?.id ?? null;
    if (next && next !== seenTrade.current) {
      setShot(true);
      const timer = window.setTimeout(() => setShot(false), 1200);
      seenTrade.current = next;
      return () => clearTimeout(timer);
    }
    seenTrade.current = next;
  }, [newest?.id]);
  const act = async (action: 'start' | 'stop' | 'activate'): Promise<void> => {
    if (busy) return;
    const values = { stake: Number(stake), startingBalance: Number(startingBalance), takeProfit: Number(takeProfit), maxLoss: Number(maxLoss) };
    if (action === 'start' && (!Object.values(values).every(Number.isFinite) || values.stake <= 0 || values.startingBalance < values.stake || values.takeProfit <= 0 || values.maxLoss <= 0 || values.maxLoss > values.startingBalance)) {
      setMessage('Choose a positive stake, target and loss limit within the virtual balance.');
      return;
    }
    setBusy(true); setMessage('');
    revision.current++;
    try {
      const response = await fetch('/api/core/research/' + action, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action === 'start' ? values : {}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Research could not ' + action + '.');
      await refresh();
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : 'Research could not be updated.');
    } finally { if (mounted.current) setBusy(false); }
  };

  const run = state?.run, running = state?.running === true;
  const net = Number(run?.netProfit) || 0;
  const target = Number(run?.takeProfit) || Number(takeProfit) || 1;
  const progress = Math.max(0, Math.min(100, net / target * 100));
  const trialCount = Math.max(0, state?.readiness?.settled ?? run?.settled ?? 0);
  const trialTarget = Math.max(1, state?.readiness?.target ?? 200);
  const trialProgress = Math.min(100, trialCount / trialTarget * 100);
  const trialReason = /baseline|calibrat|prediction|brier/i.test(state?.readiness?.reason || '') ? 'Predictions need a stronger record.'
    : /profit|return|net/i.test(state?.readiness?.reason || '') ? 'Research needs a positive overall result.'
    : /missing|complete|coverage|data/i.test(state?.readiness?.reason || '') ? 'Some trade details are still missing.'
    : trialCount < trialTarget ? 'Keep research running to collect more results.' : 'Checking the research record.';
  return <article class="core-research" aria-labelledby="core-research-title">
    <header class="core-research-heading">
      <button type="button" class="core-research-back" onClick={onBack} aria-label="Back to the pasture">←</button>
      <img src="/research-logbook.svg" alt="" />
      <div><small>CORE · OVER / UNDER</small><h1 id="core-research-title">Research pasture</h1></div>
      <span class="core-research-virtual">Virtual only</span>
    </header>
    <div class="core-research-grid">
      <section class="core-research-field" aria-label="Ghost scout virtual trading">
        <div class="core-research-field-top"><span class={running ? 'is-running' : ''}>{running ? 'Scout active' : 'Scout resting'}</span><strong>{stageLabel(run?.phase)}</strong></div>
        <div class={'core-research-scene' + (shot ? ' is-shooting' : '')}>
          <img class="core-research-pasture-art" src="/research-scanner.svg" alt="The game's ranger scouting a cow for a virtual trade" />
          <span class="core-research-scan" aria-hidden="true" />
          <span class="core-research-arrow" aria-hidden="true">➜</span>
          <span class="core-research-ghost-label">GHOST SCOUT</span>
        </div>
        <div class="core-research-target">
          {newest ? <><strong>{marketName(newest.market)}</strong><span>{newest.direction === 'under' ? 'Under ' : 'Over '}{newest.barrier} · {newest.status === 'open' ? 'Virtual trade open' : newest.status === 'won' ? 'Won ' + signed(Number(newest.profit) || 0) : newest.status === 'lost' ? 'Lost ' + signed(Number(newest.profit) || 0) : 'Checking result'}</span></> : <><strong>One engine. One pasture.</strong><span>{running ? 'Watching for the first setup.' : 'Start a run to watch Core choose cows.'}</span></>}
        </div>
      </section>
      <section class="core-research-run" aria-label="Virtual run results">
        <div class="core-research-profit"><small>VIRTUAL PROFIT / LOSS</small><strong data-negative={net < 0}>{signed(net)}</strong><span>Balance {money(run?.balance ?? Number(startingBalance))}</span></div>
        <div class="core-research-stats"><div><strong>{run?.settled ?? 0}</strong><span>Results</span></div><div><strong>{run?.wins ?? 0} / {run?.losses ?? 0}</strong><span>Wins / losses</span></div><div><strong>{money(run?.maxDrawdown ?? 0)}</strong><span>Largest drop</span></div></div>
        <div class="core-research-goal"><div><span>Target {money(target)}</span><strong>{Math.round(progress)}%</strong></div><progress value={progress} max="100" aria-label="Progress toward virtual profit target" /></div>
        <form class="core-research-controls" onSubmit={event => { event.preventDefault(); void act(running ? 'stop' : 'start'); }}>
          <label>Virtual balance<input type="number" inputMode="decimal" min="0.01" step="0.01" value={startingBalance} disabled={running || busy} onInput={event => setStartingBalance(event.currentTarget.value)} /></label>
          <label>Stake<input type="number" inputMode="decimal" min="0.01" step="0.01" value={stake} disabled={running || busy} onInput={event => setStake(event.currentTarget.value)} /></label>
          <label>Profit target<input type="number" inputMode="decimal" min="0.01" step="0.01" value={takeProfit} disabled={running || busy} onInput={event => setTakeProfit(event.currentTarget.value)} /></label>
          <label>Loss limit<input type="number" inputMode="decimal" min="0.01" step="0.01" value={maxLoss} disabled={running || busy} onInput={event => setMaxLoss(event.currentTarget.value)} /></label>
          <button class="core-research-action" type="submit" disabled={busy || !state || (!running && state.available !== true)}>{busy ? 'Updating…' : running ? 'Pause research' : run ? 'Start a new run' : 'Start research'}</button>
        </form>
        <p class="core-research-status" role="status">{message || (state?.available === false ? state.reason || 'Research needs its saved records enabled.' : running ? 'The scout keeps working on the server.' : 'Virtual results use market prices. No account funds are used.')}</p>
      </section>
    </div>
    <section class="core-research-activation" aria-label="Core Auto trial"><div><strong>{state?.autoEnabled ? 'Core ready for Auto' : 'Try Core with Auto'}</strong><div class="core-research-readiness"><span>{trialCount} / {trialTarget} results</span><progress value={trialProgress} max="100" aria-label="Research results toward Auto trial" /></div><p>{state?.autoEnabled ? 'Start Auto from the pasture when you are ready.' : state?.canActivate ? 'Research checks passed. You choose when to enable the trial.' : trialReason}</p></div><button type="button" disabled={busy || state?.canActivate !== true || state?.autoEnabled === true} onClick={() => { void act('activate'); }}>{state?.autoEnabled ? 'Core enabled' : busy ? 'Updating…' : 'Use Core for Auto'}</button></section>
    <section class="core-research-recent" aria-labelledby="core-research-recent-title"><h2 id="core-research-recent-title">Latest results</h2>
      {state?.recent?.length ? <ol>{state.recent.slice(0, 5).map(trade => <li key={trade.id}><span class={'core-research-result-mark ' + trade.status} aria-label={trade.status}>{trade.status === 'won' ? '✓' : trade.status === 'lost' ? '×' : '…'}</span><div><strong>{marketName(trade.market)}</strong><small>{trade.direction === 'under' ? 'Under ' : 'Over '}{trade.barrier} · virtual stake {money(trade.stake)}</small></div><b>{trade.profit == null ? 'Open' : signed(trade.profit)}</b></li>)}</ol> : <p>Settled virtual trades will appear here.</p>}
    </section>
    <details class="core-research-details"><summary>About these results</summary><p>Paper fills estimate a trade using an available quote and later ticks. They can differ from a Deriv purchase.</p><div><span>{state?.coverage?.complete ?? 0} complete records</span><span>{state?.coverage?.missing ?? 0} missing details</span><span>Engine {state?.engineVersion || 'core-v1'}</span></div><p>A trial result, not proof of future profits. Enabling Core does not start Auto or place a trade.</p></details>
  </article>;
}

