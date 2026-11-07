import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as risk from '../web/public/ranger-auto-risk.js';
import * as timing from '../web/public/ranger-auto-timing.js';

const html = readFileSync(new URL('../web/public/trading-room.html', import.meta.url), 'utf8');
const script = html.split('<script>')[1]?.split('</script>')[0];
assert.ok(script, 'the pasture script exists');
const suiteStart = script.indexOf('let rangerRiskPreviewOpen=false');
const suiteEnd = script.indexOf("$('rangerAutoToggle').addEventListener", suiteStart);
assert.ok(suiteStart >= 0 && suiteEnd > suiteStart, 'the risk preview suite exists');

type Element = {
  id: string;
  className: string;
  textContent: string;
  title: string;
  hidden: boolean;
  disabled: boolean;
  value: string;
  dataset: Record<string, string>;
  style: Record<string, string>;
  children: Element[];
  append: (...nodes: Element[]) => void;
  replaceChildren: (...nodes: Element[]) => void;
  addEventListener: () => void;
};

const defaults: Record<string, string> = {
  rangerAutoLossLimit: '2',
  rangerAutoCooldownSeconds: '45',
  rangerAutoTakeProfit: '0',
  rangerAutoMaxRunLoss: '0',
  rangerAutoStake: '1',
};

function element(id: string): Element {
  const node: Element = {
    id,
    className: '',
    textContent: '',
    title: '',
    hidden: true,
    disabled: false,
    value: defaults[id] ?? '',
    dataset: {},
    style: {},
    children: [],
    append: (...nodes: Element[]) => { node.children.push(...nodes); },
    replaceChildren: (...nodes: Element[]) => { node.children = [...nodes]; },
    addEventListener: () => {},
  };
  return node;
}

function text(node: Element | undefined): string {
  if (!node) return '';
  const own = typeof node.textContent === 'string' ? node.textContent : '';
  const nested = (node.children || []).map((child) => text(child)).join(' ');
  return `${own} ${nested}`.replace(/\s+/g, ' ').trim();
}

type PreviewContext = {
  card: () => Element;
  body: () => Element;
  confirmButton: () => Element;
  model: () => { error?: string; ladder: { exposure: number; steps: Array<{ lossNumber: number; stake: number | null; status: string }> }; config: { maxRunLoss: number; takeProfit: number } } | null;
  open: () => void;
  confirm: () => void;
  begin: () => void;
  finish: (outcome: string, message: string) => Record<string, unknown> | null;
  run: () => { runId: string; startedAt: number; timeToTargetMs: number | null };
  report: () => Record<string, any> | null;
  reportCard: () => Element;
  reportBody: () => Element;
  stopReason: (profit: number) => string;
  setLimits: (takeProfit: number, maxRunLoss: number) => void;
  setState: (state: Record<string, unknown>) => void;
  setStyle: (style: string) => void;
  setStake: (value: string) => void;
  setTimeToTarget: (value: number | null) => void;
  restore: () => void;
  status: () => string;
  started: string[];
  notices: string[];
  posted: Array<Record<string, any>>;
  tradeIds: (ids: number[]) => void;
  timerText: () => string;
};

function makeContext(options: { session?: Record<string, string>; startBlocker?: string } = {}): PreviewContext {
  const elements = new Map<string, Element>();
  const $ = (id: string) => {
    if (!elements.has(id)) elements.set(id, element(id));
    return elements.get(id)!;
  };
  const session = options.session ?? {};
  const posted: Array<Record<string, any>> = [];
  const context = {
    __rangerAutoTools: { risk, timing },
    $,
    document: { createElement: (tag: string) => element(`<${tag}>`) },
    sessionStorage: {
      getItem: (key: string) => (key in session ? session[key]! : null),
      setItem: (key: string, value: string) => { session[key] = value; },
      removeItem: (key: string) => { delete session[key]; },
    },
    crypto: { randomUUID: () => `uuid-${Math.random().toString(16).slice(2, 10)}` },
    performance: { now: () => 1000 },
    fetch: (url: string, init?: { body?: string }) => {
      if (init?.body) posted.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ runs: [] }), catch: () => null };
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
    notify: (message: string) => { notices.push(message); },
    console,
  };
  const notices: string[] = [];
  const started: string[] = [];
  const prelude = `
    let betCurrency='USD', cowBetStyle='martingale';
    let lastRoomState=null, sessionRecovery={amount:0};
    let rangerAutoActive=false, lockUntil=0, target=null, pending=null;
    let rangerAutoLossLimit=2, rangerAutoCooldownSeconds=45, rangerAutoTakeProfit=0, rangerAutoMaxRunLoss=0, rangerAutoMinEdge=0;
    let rangerAutoRunId=0, rangerAutoRunProfitTotal=0;
    let rangerAutoRunTradeIds=new Set(), rangerAutoRunSettledTrades=new Map(), rangerAutoMenuOpen=false;
    let rangerAutoStatus='Off';
    const rangerBet={};
    let rangerRun={runId:'',finished:true,active:false,restored:false,startedAt:0,currency:'USD',accountId:null,accountMode:'unknown',startingBalance:null,settings:null,engagedMs:0,waitingMs:0,cooldownMs:0,cooldownOpenedAt:0,cooldowns:0,timeToTargetMs:null,estimateMs:null,events:[],phase:'idle',phaseSince:0,lastPersistAt:0};
    let startBlocker=${JSON.stringify(options.startBlocker ?? '')};
    const started=[], notices=[];
    function rangerAutoSettingsFromInputs(){
      const maxRunLossRaw=$('rangerAutoMaxRunLoss').value;
      return {lossLimit:Number($('rangerAutoLossLimit').value),cooldownSeconds:Number($('rangerAutoCooldownSeconds').value),takeProfit:Number($('rangerAutoTakeProfit').value),maxRunLoss:Number(maxRunLossRaw===''?0:maxRunLossRaw),minEdge:0,error:''};
    }
    function rangerAutoStartBlocker(){return startBlocker}
    function startRangerAuto(){started.push('start');rangerAutoActive=true}
    function stopRangerAuto(message,outcome){started.push('stop:'+outcome);rangerAutoActive=false}
    function renderRangerAutoHud(){}
    function notify(text){notices.push(text)}
    function rangerAutoTakeProfitReached(profit,target){return target>0&&profit+1e-9>=target}
    function rangerAutoRunProfit(){return 0}
    function rangerAutoTrackedTrades(trades,ids){return (Array.isArray(trades)?trades:[]).filter(trade=>ids.has(trade.id))}
  `;
  const exposed = `
    ({
      card:()=>$('rangerAutoRiskPreview'),
      body:()=>$('rangerRiskPreviewBody'),
      confirmButton:()=>$('rangerRiskPreviewConfirm'),
      model:()=>rangerRiskPreviewModel,
      open:rangerRiskOpenPreview,
      confirm:rangerRiskConfirmStart,
      begin:rangerRiskBeginRun,
      finish:rangerRiskFinishRun,
      run:()=>rangerRun,
      report:()=>rangerRiskLastReport,
      reportCard:()=>$('rangerAutoRunReport'),
      reportBody:()=>$('rangerAutoRunReportBody'),
      stopReason:rangerRiskStopReason,
      setLimits:(takeProfit,maxRunLoss)=>{rangerAutoTakeProfit=takeProfit;rangerAutoMaxRunLoss=maxRunLoss},
      setState:(state)=>{lastRoomState=state},
      setStyle:(style)=>{cowBetStyle=style},
      setStake:(value)=>{$('rangerAutoStake').value=value},
      setTimeToTarget:(value)=>{rangerRun.timeToTargetMs=value},
      restore:rangerRiskRestoreRun,
      status:()=>rangerAutoStatus,
      started,
      notices,
      tradeIds:(ids)=>{rangerAutoRunTradeIds=new Set(ids)},
      timerText:()=>$('rangerAutoElapsed').textContent,
    })
  `;
  const api = runInNewContext(`${prelude}\n${script.slice(suiteStart, suiteEnd)}\n${exposed}`, context) as PreviewContext;
  api.posted = posted;
  return api;
}

const demoState = {
  accountId: 'demo-1',
  accountMode: 'demo',
  currency: 'USD',
  balance: 100,
  candidates: [{ fresh: true, payout: 4 }],
  trades: [],
};

test('starting Ranger Auto opens the risk preview instead of activating it', () => {
  const pasture = makeContext();
  pasture.setStake('1');
  pasture.setState(demoState);
  pasture.open();

  assert.equal(pasture.card().hidden, false, 'the preview card is visible');
  assert.equal(pasture.started.join(','), '', 'the preview alone never starts automation');
  const body = text(pasture.body());
  assert.match(body, /Consecutive losses · Martingale/);
  assert.match(body, /Maximum run loss/);
  assert.match(body, /Take-profit progress/);
  assert.match(body, /Largest possible loss/);
  const model = pasture.model();
  assert.ok(model && model.ladder.steps.length >= 2, 'the ladder projects consecutive losses');
  assert.ok(model.ladder.exposure > 0, 'the projected exposure is reported');
});

test('confirming the preview starts automation only for the reviewed snapshot', () => {
  const pasture = makeContext();
  pasture.setStake('1');
  pasture.setState(demoState);
  pasture.open();
  pasture.confirm();
  assert.equal(pasture.started.join(','), 'start', 'an unchanged preview confirms exactly once');

  const changed = makeContext();
  changed.setStake('1');
  changed.setState(demoState);
  changed.open();
  changed.setState({ ...demoState, balance: 101 });
  changed.confirm();
  assert.equal(changed.started.length, 0, 'a changed balance invalidates the reviewed preview');
  assert.equal(changed.notices.length, 1, 'the player is told to review the recalculated preview');
  assert.equal(changed.card().hidden, false, 'the preview stays open for review');
});

test('the preview never bypasses the start blockers that guard real accounts', () => {
  const pasture = makeContext({ startBlocker: 'Real accounts need a 10-minute owner arm before Ranger Auto can start.' });
  pasture.setState({ ...demoState, accountMode: 'real', balance: 100 });
  pasture.open();

  assert.match(text(pasture.body()), /10-minute owner arm/);
  assert.equal(pasture.confirmButton().disabled, true, 'confirm is disabled while a blocker applies');
  pasture.confirm();
  assert.equal(pasture.started.length, 0, 'a blocked account never starts from the preview');
});

test('take profit and maximum run loss are independent stop reasons', () => {
  const pasture = makeContext();
  pasture.setLimits(5, 0);
  assert.equal(pasture.stopReason(5), 'take_profit');
  assert.equal(pasture.stopReason(1), '', 'maximum run loss stays off while it is zero');
  pasture.setLimits(5, 3);
  assert.equal(pasture.stopReason(-3), 'max_run_loss', 'the run stops exactly at the maximum run loss');
  assert.equal(pasture.stopReason(-2.99), '', 'profit above the boundary continues');
  pasture.setLimits(5, 3);
  assert.equal(pasture.stopReason(5), 'take_profit', 'take profit is evaluated first');
});

test('a finished run reports its trades, averages, timing and resulting stop', () => {
  const pasture = makeContext();
  pasture.setStake('1');
  pasture.begin();
  assert.ok(pasture.run().runId.startsWith('run:'), 'starting a run stamps a run id');
  pasture.tradeIds([1, 2]);
  pasture.setState({
    ...demoState,
    balance: 101.25,
    trades: [
      { id: 1, status: 'won', profit: 2.5, stake: 1, ts: 1_000 },
      { id: 2, status: 'lost', profit: -1.25, stake: 1.25, ts: 2_000 },
    ],
  });
  pasture.setTimeToTarget(90_000);
  const report = pasture.finish('take_profit', 'Take profit reached');
  assert.ok(report, 'the run produces a report');

  assert.equal(report.trades, 2);
  assert.equal(report.wins, 1);
  assert.equal(report.losses, 1);
  assert.equal(report.realizedProfit, 1.25);
  assert.equal(report.avgWinProfit, 2.5);
  assert.equal(report.avgLossProfit, -1.25);
  assert.equal(report.endingBalance, 101.25);
  assert.equal(report.targetReached, true);
  assert.equal(report.timeToTargetMs, 90_000);
  assert.deepEqual((report.tradeRows as Array<Record<string, unknown>>).map((row) => row.tradeId), ['1', '2']);

  const body = text(pasture.reportBody());
  assert.match(body, /Take profit reached/);
  assert.match(body, /Average winning profit 2\.50 USD/);
  assert.match(body, /Average losing amount -1\.25 USD/);
  assert.match(body, /Actual time to take profit 1m 30s/);
  assert.equal(pasture.reportCard().hidden, false, 'the report is shown to the player');

  assert.equal(pasture.posted.length, 1, 'the run report is sent to the server');
  assert.deepEqual((pasture.posted[0]!.tradeRows as unknown[]).length, 2);
  assert.equal(pasture.posted[0]!.avgWinProfit, 2.5);
  assert.equal(pasture.finish('take_profit', 'again'), null, 'a finished run is not reported twice');
});

test('a run that never reached take profit reports it as not reached', () => {
  const pasture = makeContext();
  pasture.setStake('1');
  pasture.begin();
  pasture.tradeIds([1]);
  pasture.setState({ ...demoState, trades: [{ id: 1, status: 'lost', profit: -1, stake: 1, ts: 1_000 }] });
  const report = pasture.finish('max_run_loss', 'Maximum run loss reached: -1.00 USD. No new trades.');

  assert.ok(report);
  assert.equal(report.targetReached, false);
  assert.equal(report.timeToTargetMs, null);
  const body = text(pasture.reportBody());
  assert.match(body, /Maximum run loss reached/);
  assert.match(body, /Actual time to take profit Not reached/);
});

test('a restored run keeps its elapsed clock and waits for the player to resume', () => {
  const session: Record<string, string> = {};
  const first = makeContext({ session });
  first.setStake('1');
  first.setState(demoState);
  first.begin();
  const original = first.run();

  const reloaded = makeContext({ session });
  reloaded.setState(demoState);
  reloaded.restore();

  assert.equal(reloaded.run().runId, original.runId, 'the same run continues after a reload');
  assert.equal(reloaded.run().startedAt, original.startedAt);
  assert.match(reloaded.status(), /^Run restored \(paused\) · \d\d:\d\d:\d\d elapsed · START AUTO to review and resume$/);
  assert.match(reloaded.timerText(), /^\d\d:\d\d:\d\d$/, 'the restored clock keeps counting from the original start');
  assert.equal(reloaded.started.length, 0, 'a restored run stays paused until the player confirms the preview');
});
