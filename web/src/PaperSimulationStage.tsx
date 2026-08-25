import type { JSX } from 'preact';
import type { Market, PaperSimulationContract, SignalCandidate } from './store';

export type PaperSimulationPhase = 'idle' | 'scanning' | 'signal-locked' | 'open' | 'settled';

export interface PaperSimulationStageProps {
  market: Market | null;
  candidate: Pick<SignalCandidate, 'direction' | 'barrier' | 'estWin'> | null;
  phase: PaperSimulationPhase;
  equity: number[];
  latestContract?: PaperSimulationContract | null;
  virtualBalance?: number | null;
}

function shortMarketName(display: string): string {
  return display.split('(')[0].trim().replace(/\s*Index$/, '');
}

function signalLabel(candidate: Pick<SignalCandidate, 'direction' | 'barrier'> | null): string {
  if (!candidate) return 'Watching market';
  return `${candidate.direction === 'under' ? 'Under' : 'Over'} ${candidate.barrier}`;
}

function quotePath(quotes: number[], width: number, height: number): string {
  if (quotes.length < 2) return '';
  const pad = 7;
  const min = Math.min(...quotes);
  const max = Math.max(...quotes);
  const range = max - min || 1;
  const step = (width - pad * 2) / (quotes.length - 1);
  return quotes
    .map((quote, index) => {
      const x = pad + index * step;
      const y = height - pad - ((quote - min) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' L');
}

function equityPath(points: number[], width: number, height: number): string {
  return quotePath(points, width, height);
}

export function PaperSimulationStage({
  market,
  candidate,
  phase,
  equity,
  latestContract,
  virtualBalance,
}: PaperSimulationStageProps): JSX.Element {
  const quotes = (market?.recentQuotes ?? []).filter((quote) => Number.isFinite(quote)).slice(-40);
  const quoteLine = quotePath(quotes, 320, 94);
  const equityLine = equityPath(equity.slice(-36), 132, 30);
  const isLocked = phase === 'signal-locked' || phase === 'open' || phase === 'settled';
  const isOpen = phase === 'open';
  const isSettled = phase === 'settled' && latestContract != null;
  const profit = latestContract?.profit ?? 0;
  const outcome = profit > 0 ? 'won' : profit < 0 ? 'lost' : 'push';
  const latestQuote = quotes[quotes.length - 1];

  return (
    <section
      class={`paper-stage paper-stage--${phase}${isSettled ? ` paper-stage--${outcome}` : ''}`}
      aria-label="Paper simulation visualizer"
    >
      <div class="paper-stage-head">
        <div>
          <span class="paper-stage-kicker">Paper simulator</span>
          <span class="paper-stage-market">{shortMarketName(market?.display ?? 'Selected market')}</span>
        </div>
        <span class={`paper-stage-state ${isOpen ? 'live' : isSettled ? outcome : ''}`}>
          <i></i>
          {isOpen ? 'Virtual contract open' : isSettled ? `Virtual ${outcome}` : phase === 'scanning' ? 'Scanning live ticks' : 'Ready'}
        </span>
      </div>

      <div class="paper-stage-chart" aria-label="Live public market tick chart">
        {quoteLine ? (
          <svg viewBox="0 0 320 94" preserveAspectRatio="none" aria-hidden="true">
            <path class="paper-stage-quote-line" d={`M${quoteLine}`} />
            <circle class="paper-stage-quote-dot" cx={quoteLine.split(' L').at(-1)?.split(',')[0]} cy={quoteLine.split(' L').at(-1)?.split(',')[1]} r="2.8" />
          </svg>
        ) : (
          <span class="paper-stage-empty">Waiting for public ticks</span>
        )}
        <span class="paper-stage-quote">{latestQuote?.toFixed(2) ?? '--'}</span>
      </div>

      <div class="paper-stage-lane">
        <div class={`paper-stage-signal${isLocked ? ' locked' : ''}`}>
          <span class="paper-stage-step">01</span>
          <div>
            <span class="paper-stage-label">Signal</span>
            <strong>{signalLabel(candidate)}</strong>
          </div>
          {candidate && <span class="paper-stage-rate">{Math.round(candidate.estWin * 100)}%</span>}
        </div>
        <div class="paper-stage-connector" aria-hidden="true"><span></span></div>
        <div class={`paper-stage-order${isOpen ? ' moving' : ''}${isSettled ? ' settled' : ''}`}>
          <span class="paper-stage-step">02</span>
          <div>
            <span class="paper-stage-label">Virtual order</span>
            <strong>{isOpen ? 'Next tick pending' : isSettled ? 'Settled from tick' : 'On standby'}</strong>
          </div>
          <span class="paper-stage-order-mark">P</span>
        </div>
      </div>

      <div class="paper-stage-foot">
        <div class="paper-stage-balance">
          <span>Virtual equity</span>
          <strong>{virtualBalance == null ? '--' : `$${virtualBalance.toFixed(2)}`}</strong>
          {equityLine && (
            <svg class="paper-stage-equity" viewBox="0 0 132 30" preserveAspectRatio="none" aria-label="Virtual equity curve">
              <path d={`M${equityLine}`} />
            </svg>
          )}
        </div>
        <div class={`paper-stage-outcome${isSettled ? ' show' : ''}`} aria-live="polite">
          <span>{isSettled ? (outcome === 'push' ? 'Virtual push' : `Virtual ${outcome}`) : 'No account funds used'}</span>
          {isSettled && <strong class={outcome}>{profit >= 0 ? '+' : '-'}${Math.abs(profit).toFixed(2)}</strong>}
        </div>
      </div>
    </section>
  );
}
