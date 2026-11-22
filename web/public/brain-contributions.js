(() => {
  'use strict';
  const host = document.getElementById('brainContributionApp');
  if (!host || window.__brainContributionTasksV1) return;
  window.__brainContributionTasksV1 = true;
  const $ = id => document.getElementById(id);
  const svgNs = 'http://www.w3.org/2000/svg';
  let state = null, loading = false, note = '', formDirty = false;
  let awaitingGrowthLessonId = null, growthCelebrationTimer = 0;
  let reloadQueued = false, recentTradeSignature = null, recentTradeAccount = null;
  let refreshTimers = [], pendingAnimationTimer = 0;
  let preferredTradeId = null, seenMemoryTradeIds = null;
  let lastGrowthTradeCount = null;
  const sheet=document.createElement('style');
  sheet.textContent=`
    .brain-review-card{background:#fff8e9;border:1px solid #d2b88c;border-radius:16px;padding:16px;color:#3d3022;display:grid;gap:14px}
    .brain-review-overview{display:grid;grid-template-columns:minmax(90px,130px) 1fr;align-items:center;gap:12px}
    .brain-review-network svg{display:block;width:100%;height:auto}.brain-review-summary h3{margin:4px 0;color:#294f34;font-size:22px}.brain-review-summary strong{color:#285638}.brain-review-metrics{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.brain-review-metrics span{padding:4px 7px;background:#e7efdc;border-radius:6px;font-size:11px;font-weight:750;color:#31583d}
    .brain-review-form h4{margin:0 0 9px;color:#294f34;font-size:16px}.brain-review-fields{display:grid;gap:10px}.brain-review-trades{display:grid;gap:6px;max-height:200px;overflow:auto}.brain-review-trade{display:flex;align-items:center;gap:9px;width:100%;padding:9px;border:1px solid #decaa8;border-radius:9px;background:#fffdf5;color:#3d3022;text-align:left;cursor:pointer}.brain-review-trade[aria-pressed=true]{border:2px solid #388553;background:#e9f4e5}.brain-review-result{display:grid;place-items:center;width:27px;height:27px;border-radius:50%;background:#e8c9be;color:#8a302c;font-weight:900}.brain-review-trade[data-result=won] .brain-review-result{background:#cee9cd;color:#25713d}.brain-review-trade-copy{display:grid;gap:2px;flex:1;min-width:0}.brain-review-trade-copy small{color:#776b5a}.brain-review-trade strong{color:#31583d}.brain-review-label{display:grid;gap:5px;font-size:12px;font-weight:800}.brain-review-label textarea,.brain-review-label select{width:100%;min-width:0;padding:9px;border:1px solid #c8b08c;border-radius:8px;background:#fffdf7;color:#30291f;font:inherit}.brain-review-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}.brain-review-save{width:100%}.brain-review-details{border-top:1px solid #e2d2b9;padding-top:10px}.brain-review-details summary{cursor:pointer;font-weight:800;color:#31583d}.brain-review-evidence:empty{display:none}.brain-evidence-compact{border-top:1px solid #e2d2b9;padding-top:10px}.brain-evidence-compact__top{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:800;color:#31583d}.brain-evidence-compact__stats{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.brain-evidence-compact__stats>*{background:#e7efdc;border-radius:6px;padding:5px 7px;color:#31583d;font-size:11px}.brain-evidence-compact__details{font-size:12px;color:#665a48}.brain-review-empty{font-size:13px;color:#665a48}

    .brain-goals{background:#eaf2df;border-radius:10px;padding:11px;display:grid;gap:7px;color:#234c32}.brain-goals h4{font-size:14px;margin:0}.brain-goals-list{display:grid;gap:6px}.brain-goal{display:grid;grid-template-columns:1fr auto;gap:4px;font-size:12px;font-weight:750}.brain-goal progress{grid-column:1/-1;width:100%;height:6px;accent-color:#438659}.brain-goals button{justify-self:start;border:0;border-radius:7px;background:#245d39;color:#fff;padding:7px 10px;font:700 12px system-ui;cursor:pointer}.brain-review-stance{display:flex;gap:8px;margin:4px 0 6px;padding:0;border:0;min-width:0}.brain-review-stance legend{font-size:14px;font-weight:900;margin-bottom:9px;color:#284d35}.brain-review-stance label{position:relative;flex:1;min-width:0;cursor:pointer}.brain-review-stance input{position:absolute;width:1px;height:1px;opacity:0}.brain-review-stance label span{display:flex;min-height:58px;align-items:center;justify-content:center;padding:14px 8px;border:0;border-radius:4px;background:#eee7d6;color:#344d36;text-align:center;font:900 clamp(15px,2.4vw,18px)/1.15 system-ui,sans-serif;transition:background .16s,color .16s,transform .16s}.brain-review-stance input:checked+span{background:#277845;color:#fff}.brain-review-stance label:last-child input:checked+span{background:#b8403c;color:#fff}.brain-review-stance input:focus-visible+span{outline:3px solid #235c38;outline-offset:2px}@media (hover:hover) and (pointer:fine){.brain-review-stance label:hover input[value="good"]+span{background:#277845;color:#fff}.brain-review-stance label:hover input[value="warning"]+span{background:#b8403c;color:#fff}}
    .brain-trade-detail{padding:10px;border-radius:10px;background:#f0ead8;border:1px solid #d7c5a2;display:grid;gap:8px}.brain-trade-detail h5{margin:0;color:#31583d;font-size:13px}.brain-trade-facts{display:flex;gap:6px;flex-wrap:wrap}.brain-trade-facts span{background:#fffaf0;border-radius:6px;padding:5px 8px;color:#36543b;font-weight:800;font-size:11px}.brain-tick-row{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}.brain-tick{min-width:0;text-align:center;padding:5px 2px;background:#fffaf0;border-radius:5px;color:#554a3b;font-size:clamp(8px,1.6vw,11px);overflow-wrap:anywhere}.brain-tick small{display:block;font-size:9px;color:#7e725f}.brain-tick.is-entry{background:#dbeed8;box-shadow:inset 0 0 0 1px #629369}.brain-tick b{color:#bc3039;font-size:1.15em}.brain-tick-missing{color:#887c69}.brain-trade-note{margin:0;color:#776b5a;font-size:11px;line-height:1.35}
    .brain-confidence-slider{width:100%;accent-color:#267b48}.brain-confidence-value{color:#31583d;font-size:12px}.brain-trade-facts span{overflow-wrap:anywhere}

    .brain-trade-detail{padding:14px;background:#fffdf5;border:1px solid #dfcfad;border-radius:12px;gap:12px;box-shadow:0 3px 12px #44351c0a}.brain-entry-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.brain-entry-title small{display:block;color:#89765b;font-size:9px;font-weight:800;letter-spacing:.08em}.brain-entry-title h5{margin:2px 0 0;color:#294f34;font-size:15px}.brain-entry-outcome{padding:4px 9px;border-radius:6px;background:#eee7d8;color:#665640;font-size:11px;font-weight:800}.brain-entry-outcome[data-result=won]{background:#e0f1df;color:#246339}.brain-entry-outcome[data-result=lost]{background:#f8e4df;color:#9a3336}.brain-entry-summary,.brain-trade-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.brain-entry-metric{min-width:0;padding:8px;background:#f4f1e5;border-radius:7px}.brain-entry-metric small,.brain-entry-metric strong{display:block;overflow-wrap:anywhere}.brain-entry-metric small{font-size:10px;color:#756b58}.brain-entry-metric strong{margin-top:2px;color:#294f34;font-size:12px;font-variant-numeric:tabular-nums}.brain-entry-metric.is-negative strong{color:#a33338}.brain-entry-sequence{min-width:0}.brain-entry-sequence-heading{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:6px}.brain-entry-sequence-heading strong{font-size:11px;color:#35553a}.brain-entry-sequence-heading small{font-size:10px;color:#82745d}.brain-tick-row{display:grid;grid-template-columns:repeat(7,minmax(64px,1fr));gap:4px;overflow-x:auto;padding-bottom:3px}.brain-tick{padding:7px 4px;background:#f4f1e5;font-size:11px;white-space:nowrap;overflow-wrap:normal}.brain-tick small{margin-bottom:3px;font-size:9px}.brain-tick.is-entry{background:#ddf0dc}.brain-entry-more{border-top:1px solid #eadfc9;padding-top:9px}.brain-entry-more summary{cursor:pointer;color:#31583d;font-size:11px;font-weight:800}.brain-entry-more .brain-trade-facts{margin-top:8px}.brain-entry-metric.is-id{grid-column:span 2}.brain-trade-note{margin:5px 0 0}@media(max-width:430px){.brain-trade-detail{padding:10px}.brain-entry-summary{gap:4px}.brain-entry-metric{padding:6px}.brain-entry-metric strong{font-size:11px}.brain-entry-sequence-heading{display:block}.brain-entry-sequence-heading small{display:block;margin-top:2px}.brain-entry-more .brain-trade-facts{grid-template-columns:repeat(2,minmax(0,1fr))}}

    /* The teaching view uses the width of the Brain panel, not the viewport. */
    #brainContributionApp { container-type: inline-size; min-width: 0; }
    .brain-review-card { padding: 10px; gap: 9px; border: 0; border-radius: 12px; min-width: 0; }
    .brain-review-card > * { min-width: 0; }
    .brain-review-overview { grid-template-columns: 56px minmax(0, 1fr); gap: 9px; }
    .brain-review-summary h3 { font-size: 16px; margin: 1px 0; line-height: 1.15; }
    .brain-review-summary strong { font-size: 12px; }
    .brain-review-metrics { margin-top: 4px; gap: 4px; }
    .brain-review-metrics span { padding: 3px 6px; font-size: 10px; }
    .brain-goals { padding: 8px 10px; gap: 4px; }
    .brain-goals-list { gap: 3px; }
    .brain-review-form { min-width: 0; }
    .brain-review-form h4 { margin: 0 0 6px; font-size: 14px; }
    .brain-review-fields { min-width: 0; gap: 7px; }
    .brain-review-fields > * { min-width: 0; }
    .brain-review-trades { max-height: 142px; gap: 4px; overscroll-behavior: contain; }
    .brain-review-trade { min-height: 44px; padding: 6px 8px; gap: 7px; }
    .brain-review-trade[aria-pressed=true] { border-width: 1px; box-shadow: inset 0 0 0 1px #388553; }
    .brain-review-result { width: 25px; height: 25px; flex: 0 0 25px; }
    .brain-review-trade-copy b { overflow-wrap: anywhere; font-size: 11px; }
    .brain-review-trade-copy small { font-size: 10px; }
    .brain-review-trade strong { font-size: 11px; }
    .brain-trade-detail { padding: 9px; gap: 7px; box-shadow: none; }
    .brain-entry-metric { padding: 6px; }
    .brain-review-stance { margin: 0; gap: 6px; }
    .brain-review-stance legend { margin-bottom: 4px; font-size: 12px; }
    .brain-review-stance label span { min-height: 44px; padding: 8px; font-size: 14px; }
    .brain-review-label { gap: 4px; font-size: 11px; }
    .brain-review-label textarea, .brain-review-label select { padding: 7px 8px; min-height: 40px; }
    .brain-review-note textarea { min-height: 54px; resize: vertical; }
    .brain-review-row { gap: 6px; }
    .brain-review-save { min-height: 44px; }
    .brain-review-details, .brain-evidence-compact { padding-top: 7px; }
    .brain-note-interpretation:empty, .brain-contribution-status:empty { display: none; }
    @container (min-width: 650px) {
      .brain-review-card { grid-template-columns: minmax(0, 1fr) minmax(220px, .8fr); align-items: start; }
      .brain-review-overview { grid-column: 1; }
      .brain-review-card > .brain-goals { grid-column: 2; grid-row: 1; }
      .brain-review-card > .brain-review-form,
      .brain-review-card > .brain-contribution-status,
      .brain-review-card > .brain-review-details,
      .brain-review-card > .brain-review-evidence { grid-column: 1 / -1; }
      .brain-review-fields { grid-template-columns: minmax(200px, .9fr) minmax(0, 1.2fr); align-items: start; }
      .brain-review-trades { grid-column: 1; grid-row: 1; max-height: 210px; }
      .brain-review-selected { grid-column: 2; grid-row: 1 / span 4; }
      .brain-review-stance, .brain-review-note, .brain-note-interpretation, .brain-review-row { grid-column: 1; }
      .brain-review-save { grid-column: 1 / -1; }
    }
    @container (max-width: 420px) {
      .brain-review-card { padding: 8px; gap: 8px; }
      .brain-review-overview { grid-template-columns: 46px minmax(0, 1fr); }
      .brain-review-trades { max-height: 120px; }
      .brain-review-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
      .brain-review-stance label span { font-size: 13px; }
    }

    /* Fit the teaching surface without scroll regions inside individual cards. */
    .brain-entry-sent{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 9px;border-radius:8px;background:#e8f2df;color:#24583a}
    .brain-entry-sent>span{display:grid;gap:2px}.brain-entry-sent small{font-size:10px;color:#596b4c}.brain-entry-sent strong{font-size:13px}.brain-entry-sent strong b{color:#185c34}
    .brain-review-trades { display:grid; gap:4px; max-height:none; overflow:visible; min-width:0; }
    .brain-review-picker-label { font-size:11px; font-weight:800; color:#405c40; }
    .brain-review-picker { display:grid; grid-template-columns:36px minmax(0,1fr) 36px; gap:5px; align-items:stretch; min-width:0; }
    .brain-review-page { min-width:36px; min-height:40px; border:0; border-radius:7px; background:#e1ecda; color:#245d39; font:800 22px/1 system-ui,sans-serif; cursor:pointer; }
    .brain-review-page:disabled { opacity:.4; cursor:default; }
    .brain-review-page:focus-visible { outline:3px solid #235c38; outline-offset:2px; }
    .brain-review-current { display:flex; align-items:center; gap:7px; padding:5px 7px; border-radius:7px; background:#f1f4e9; min-width:0; }
    .brain-review-current .brain-review-result[data-result=won] { background:#cee9cd; color:#25713d; }
    .brain-review-current .brain-review-trade-copy b { overflow-wrap:anywhere; }
    .brain-review-count { justify-self:center; color:#776b5a; font-size:10px; line-height:1; }
    .brain-tick-row { grid-template-columns:repeat(7,minmax(0,1fr)); overflow:visible; padding:0; }
    .brain-tick { min-width:0; white-space:normal; overflow-wrap:anywhere; word-break:break-word; font-size:clamp(9px,1.1vw,11px); line-height:1.25; }
    .brain-entry-summary,.brain-trade-facts { min-width:0; }
    .brain-trade-detail,.brain-review-selected,.brain-entry-sequence { min-width:0; max-width:100%; }
    .brain-review-network svg { width:100%; max-width:160px; height:auto; }
    @container (min-width:650px) { .brain-review-trades { max-height:none; overflow:visible; } .brain-review-overview { grid-template-columns:minmax(72px,110px) minmax(0,1fr); } }
    @container (max-width:520px) { .brain-tick-row { grid-template-columns:repeat(4,minmax(0,1fr)); } .brain-tick { font-size:10px; } .brain-review-overview { grid-template-columns:minmax(56px,76px) minmax(0,1fr); } }
    @container (min-width:650px) {
      .brain-review-selected { grid-column:2; grid-row:1 / span 3; }
      .brain-review-save { grid-column:2; grid-row:4; justify-self:end; align-self:start; width:min(220px,100%); min-height:44px; }
    }
    .brain-pattern-comparison{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
    .brain-pattern-group{display:grid;gap:3px;min-width:0;padding:8px;border-radius:8px;background:#f2f5e9;color:#294b34;font-size:11px}
    .brain-pattern-group b,.brain-pattern-group strong,.brain-pattern-group span,.brain-pattern-group small{overflow-wrap:anywhere}
    .brain-pattern-trades,.brain-pattern-trade{min-width:0;margin-top:4px}
    .brain-pattern-trades summary,.brain-pattern-trade summary{cursor:pointer;color:#1e6840;font-weight:800;padding:4px 0}
    @container (max-width:420px){.brain-pattern-comparison{grid-template-columns:minmax(0,1fr)}}
    /* Keep the teaching inputs in their own flow so the taller snapshot
       cannot stretch the rows and create blank gaps. */
    .brain-review-input-column { display:grid; align-content:start; gap:8px; min-width:0; }
    @container (min-width:650px) {
      .brain-review-fields { grid-template-columns:minmax(200px,.9fr) minmax(0,1.2fr); grid-template-rows:auto auto; align-items:start; }
      .brain-review-input-column { grid-column:1; grid-row:1 / span 2; }
      .brain-review-input-column > * { grid-column:auto; grid-row:auto; }
      .brain-review-selected { grid-column:2; grid-row:1; }
      .brain-review-save { grid-column:2; grid-row:2; justify-self:end; align-self:start; width:min(220px,100%); min-height:44px; }
    }
    @container (max-width:300px) { .brain-tick-row { grid-template-columns:repeat(2,minmax(0,1fr)); } .brain-entry-summary { grid-template-columns:repeat(2,minmax(0,1fr)); } }
    .brain-trade-sync { display:flex; align-items:center; gap:8px; margin:4px 0 8px; padding:7px 10px; border-radius:9px; color:#245d39; background:#e5f1df; font:700 12px/1.35 system-ui,sans-serif; }
    .brain-trade-sync[hidden] { display:none; }
    .brain-trade-sync-dot { width:10px; height:10px; border-radius:50%; background:#4e9d68; flex:none; animation:brainTradeSyncPulse 1.2s ease-in-out infinite; }
    .brain-snapshot-updated { animation:brainSnapshotUpdate .8s ease-out; }
    @keyframes brainTradeSyncPulse { 50% { opacity:.35; transform:scale(.72) } }
    @keyframes brainSnapshotUpdate { from { box-shadow:0 0 0 3px #75bc81; } to { box-shadow:0 0 0 0 transparent; } }
    @media (prefers-reduced-motion:reduce) { .brain-trade-sync-dot,.brain-snapshot-updated { animation:none; } }

    /* Account memory: fill is an illustration of growth, not a storage quota. */
    .brain-memory-meter{display:flex;align-items:center;gap:8px;min-width:0;padding:7px 9px;border-radius:9px;background:#e8f0df;color:#28573a}
    .brain-memory-cylinder{position:relative;flex:none;width:22px;height:29px;overflow:hidden;border:1.5px solid #527e57;border-radius:50% / 18%;background:#f8faed}
    .brain-memory-cylinder::before{content:'';position:absolute;inset:auto 0 0;height:var(--memory-fill,12%);background:linear-gradient(#9ed995,#4b9b62);transition:height .7s ease}
    .brain-memory-cylinder::after{content:'';position:absolute;left:0;right:0;top:0;height:6px;border-bottom:1px solid #527e57;border-radius:50%;background:#d8ecd0}
    .brain-memory-copy{display:grid;gap:1px;min-width:0;line-height:1.2}.brain-memory-copy strong{font-size:11px}.brain-memory-copy small{font-size:10px;color:#566c4e}
    @media(max-width:420px){.brain-memory-meter{padding:5px 7px;gap:6px}.brain-memory-cylinder{width:19px;height:25px}.brain-memory-copy strong,.brain-memory-copy small{font-size:9px;overflow-wrap:anywhere}}

    .brain-review-card > .brain-goals { grid-column:1 / -1 !important; grid-row:auto !important; }
    .brain-memory-meter{border:0;width:100%;text-align:left;cursor:pointer;font:inherit;position:relative}
    .brain-memory-meter:hover{background:#d9ebd2}
    .brain-memory-meter:focus-visible{outline:3px solid #246b45;outline-offset:2px}
    .brain-memory-popup{position:fixed;z-index:2147483000;width:min(260px,calc(100vw - 24px));padding:12px;border-radius:12px;background:#fff8e9;color:#344a32;box-shadow:0 10px 32px #183b2f66;font:500 12px/1.4 system-ui,sans-serif}
    .brain-memory-popup[hidden]{display:none}
    .brain-memory-popup strong{font-size:14px}.brain-memory-popup p{margin:6px 0 0}.brain-memory-popup small{display:block;margin-top:6px;color:#66583e}
    @media(prefers-reduced-motion:reduce){.brain-memory-cylinder::before{transition:none}}

    /* Make saved memory a prominent part of the Brain, with room for counts. */
    #rangerBrainPanel .brain-growth-card .brain-memory-meter{
      display:grid;grid-template-columns:62px minmax(0,1fr) auto;align-items:center;
      gap:12px;min-height:94px;margin:4px 0 0;padding:10px 14px;border:0;border-radius:14px;
      background:linear-gradient(120deg,#e5f2d8,#f6eed6);color:#244e35;text-align:left;cursor:pointer;
    }
    #rangerBrainPanel .brain-growth-card .brain-memory-cylinder{
      width:52px;height:72px;border:2px solid #51815c;border-radius:50% / 13%;
      background:#fbfff5;box-shadow:inset 0 0 0 2px #fff8,0 3px 8px #284c2b20;
    }
    #rangerBrainPanel .brain-growth-card .brain-memory-cylinder::before{
      height:var(--memory-fill,0%);background:linear-gradient(#b9e99f,#53a56b);transition:height .7s ease;
    }
    #rangerBrainPanel .brain-growth-card .brain-memory-cylinder::after{
      height:12px;background:#e3f4da;border-bottom:1px solid #80aa82;
    }
    #rangerBrainPanel .brain-growth-card .brain-memory-copy{display:grid;gap:5px;min-width:0;line-height:1.2}
    #rangerBrainPanel .brain-growth-card .brain-memory-copy strong{font-size:clamp(15px,1.5vw,20px);overflow-wrap:anywhere}
    #rangerBrainPanel .brain-growth-card .brain-memory-copy small{font-size:clamp(10px,1vw,12px);color:#53674d;overflow-wrap:anywhere}
    #rangerBrainPanel .brain-growth-card .brain-memory-meter::after{content:'›';font:700 24px/1 system-ui;color:#447d50}
    #rangerBrainPanel .brain-growth-card .brain-memory-meter:hover{filter:brightness(.97)}
    #rangerBrainPanel .brain-growth-card .brain-memory-meter:focus-visible{outline:3px solid #246b45;outline-offset:2px}
    #rangerBrainPanel .brain-growth-card .brain-growth-copy{display:flex;align-items:center;gap:8px;min-width:0}
    #rangerBrainPanel .brain-growth-card .brain-growth-copy .brain-eyebrow,
    #rangerBrainPanel .brain-growth-card .brain-growth-copy h3,
    #rangerBrainPanel .brain-growth-card .brain-growth-copy p{display:none}
    #rangerBrainPanel .brain-growth-card .brain-growth-xp{flex:1;min-width:0;margin:0}
    #rangerBrainPanel .brain-growth-card .brain-growth-results{display:none}
    @media(max-width:520px){
      #rangerBrainPanel .brain-growth-card .brain-memory-meter{grid-template-columns:46px minmax(0,1fr) auto;min-height:72px;gap:8px;padding:8px 10px}
      #rangerBrainPanel .brain-growth-card .brain-memory-cylinder{width:38px;height:54px}
      #rangerBrainPanel .brain-growth-card .brain-memory-cylinder::after{height:9px}
    }
    @media(prefers-reduced-motion:reduce){#rangerBrainPanel .brain-growth-card .brain-memory-cylinder::before{transition:none}}

    /* Compact teaching flow; expand tasks or prices only when needed. */
    .brain-review-card { gap:6px; padding:8px; }
    .brain-review-form h4 { font-size:14px; margin:0 0 5px; }
    .brain-goals { padding:7px 9px; gap:5px; }
    .brain-goals-summary { cursor:pointer; font:800 12px/1.3 system-ui,sans-serif; color:#245b3a; }
    .brain-goals-list { margin-top:7px; }
    .brain-review-input-column { gap:5px; }
    .brain-review-stance { margin:0; gap:5px; }
    .brain-review-stance legend { font-size:12px; margin-bottom:4px; }
    .brain-review-stance label span { min-height:44px; padding:8px 6px; font-size:14px; }
    .brain-review-label { gap:3px; font-size:11px; }
    .brain-review-note textarea { min-height:44px; padding:6px 8px; resize:vertical; }
    .brain-review-row { gap:5px; }
    .brain-review-label select { min-height:40px; padding:6px; }
    .brain-trade-detail { padding:8px; gap:6px; }
    .brain-entry-heading, .brain-entry-summary { min-width:0; }
    .brain-entry-metric { padding:5px 6px; }
    .brain-review-price-details { min-width:0; }
    .brain-review-price-details > summary { cursor:pointer; color:#285a3b; font:800 11px/1.3 system-ui,sans-serif; padding:5px 0; }
    .brain-review-price-details .brain-entry-sequence + .brain-entry-sequence { margin-top:6px; }
    .brain-review-details, .brain-evidence-compact { padding-top:5px; }
    @container (max-width:650px) {
      .brain-review-fields { gap:6px; }
      .brain-review-save { width:100%; min-height:44px; }
      .brain-entry-summary { grid-template-columns:repeat(3,minmax(0,1fr)); }
      .brain-entry-metric small { font-size:9px; }
      .brain-entry-metric strong { font-size:11px; overflow-wrap:anywhere; }
    }
    @media(max-height:600px) {
      .brain-review-card { gap:4px; padding:6px; }
      .brain-review-stance label span { min-height:40px; }
      .brain-review-note textarea { min-height:40px; }
    }

    .brain-hud-goals[hidden]{display:none!important}
    .brain-hud-goals{position:fixed;z-index:120;box-sizing:border-box;max-width:calc(100vw - 16px);max-height:min(65dvh,420px);overflow:auto;padding:12px;background:#fff6e4;color:#294b32;border-radius:12px;box-shadow:0 8px 28px #10281f55;font:600 12px/1.3 system-ui,sans-serif}
    .brain-hud-goals-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;font-size:14px}
    .brain-hud-goals-close{border:0;background:transparent;color:#294b32;font-size:24px;line-height:1;min-width:38px;min-height:38px;cursor:pointer}
    .brain-hud-goal{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 8px;margin:8px 0}
    .brain-hud-goal progress{grid-column:1/-1;width:100%;height:7px;accent-color:#438659}
    .brain-hud-goals-open{width:100%;min-height:42px;margin-top:8px;border:0;border-radius:8px;background:#245d39;color:#fff9ec;font:800 12px system-ui;cursor:pointer}
    .brain-hud-goals button:focus-visible{outline:3px solid #d69f43;outline-offset:2px}
    /* Keep full prices together; wrap the tiles, not digits within a price. */
    .brain-tick-row { grid-template-columns:repeat(auto-fit,minmax(min(100%, 100px),1fr)); gap:4px; }
    .brain-tick { min-width:0; white-space:nowrap; overflow-wrap:normal; word-break:normal; font-variant-numeric:tabular-nums; }
    .brain-tick small { white-space:normal; overflow-wrap:normal; }
    .brain-tick-price { display:inline-block; white-space:nowrap; letter-spacing:-.02em; }
  `;
  sheet.textContent += "\n    @container (min-width:650px) {\n      .brain-review-input-column .brain-review-save {\n        grid-column:auto; grid-row:auto; justify-self:start; align-self:start;\n        width:min(220px,100%); min-height:42px; margin:0;\n      }\n    }\n    @container (max-width:649px) {\n      .brain-review-input-column .brain-review-save {\n        grid-column:auto; grid-row:auto; justify-self:start;\n        width:min(260px,100%); min-height:42px; margin:0;\n      }\n    }\n  ";
  sheet.textContent += "\n    .brain-rule-options{border:0;padding:0;margin:0;min-width:0}\n    .brain-rule-options legend{font-size:11px;font-weight:800;color:#285638;margin-bottom:4px}\n    .brain-rule-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}\n    .brain-rule-choice{position:relative;cursor:pointer;min-width:0}\n    .brain-rule-choice input{position:absolute;opacity:0;width:1px;height:1px}\n    .brain-rule-choice span{display:grid;place-items:center;min-height:32px;padding:5px;border-radius:7px;background:#ecead9;color:#36563c;font-size:10px;font-weight:800;text-align:center}\n    .brain-rule-choice input:checked+span{background:#246742;color:#fff}\n    .brain-rule-choice input:focus-visible+span{outline:2px solid #e4ab40;outline-offset:2px}\n    .brain-rule-choice input:disabled+span{opacity:.5;cursor:default}\n    .brain-rule-ranges{font-size:10px;margin-top:5px;color:#345a3c}\n    .brain-rule-ranges summary{cursor:pointer;font-weight:800;padding:3px 0}\n    .brain-rule-range{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:5px;align-items:center;margin-top:4px}\n    .brain-rule-range small{font-size:9px;font-variant-numeric:tabular-nums}\n    .brain-rule-note{display:block;margin-top:4px;color:#70624b;font-size:9px;line-height:1.3}\n    .brain-task-memory-card[data-learning=\"helping\"] .brain-task-memory-result{background:#d9eed8;color:#245f37}\n    .brain-task-memory-card[data-learning=\"not_helping_yet\"] .brain-task-memory-result{background:#f3e0d4;color:#8a4534}\n";
  document.head.append(sheet);


  const node = (tag, cls, text) => {
    const item = document.createElement(tag);
    if (cls) item.className = cls;
    if (text != null) item.textContent = String(text);
    return item;
  };
  const request = async (url, init) => {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.error || 'The Brain could not complete that task.'), { status: response.status });
    return body;
  };
  const option = (select, value, label) => {
    const item = node('option', '', label);
    item.value = value;
    select.append(item);
  };

  function setMessage(message, tone) {
    const target = $('brainTaskStatus');
    if (!target) return;
    target.textContent = message || '';
    target.dataset.tone = tone || 'quiet';
  }

  function drawNetwork(insights) {
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 260 160');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Your Brain memory network');
    const title = document.createElementNS(svgNs, 'title');
    title.textContent = 'Human insight memory network';
    svg.append(title);
    const desc = document.createElementNS(svgNs, 'desc');
    desc.textContent = insights.length
      ? insights.length + ' saved human memories are connected. Green nodes align with a later settled win, rust nodes with a loss, and gold nodes are still waiting for a matching trade.'
      : 'Your first saved memory will add a node to this brain.';
    svg.append(desc);
    const silhouette = document.createElementNS(svgNs, 'path');
    silhouette.setAttribute('class', 'brain-task-silhouette');
    silhouette.setAttribute('d', 'M129 27c-9-14-32-12-39 4-19-6-35 8-32 27-15 9-16 32-2 42-4 19 11 33 28 31 8 13 25 14 37 5 11 10 28 8 36-4 18 2 31-13 27-30 14-11 11-32-3-41 1-18-15-31-32-27-7-14-22-18-34-7-4 0-7 0-11 0z');
    svg.append(silhouette);
    const spine = document.createElementNS(svgNs, 'path');
    spine.setAttribute('class', 'brain-task-spine');
    spine.setAttribute('d', 'M130 34v90M90 49c20 8 18 22 40 27m39-28c-21 7-19 22-39 28M64 78c24 0 35 4 66 0m60 0c-24 0-35 4-60 0M81 119c20-13 30-28 49-41m48 41c-19-13-30-28-48-41');
    svg.append(spine);
    const hub = document.createElementNS(svgNs, 'circle');
    hub.setAttribute('class', 'brain-task-hub');
    hub.setAttribute('cx', '130');
    hub.setAttribute('cy', '78');
    hub.setAttribute('r', '5');
    svg.append(hub);

    const points = [
      [72,43],[99,31],[130,25],[160,35],[187,49],[201,73],
      [190,105],[168,127],[137,137],[106,128],[78,113],[59,84],
      [93,57],[165,59],[90,94],[164,94],[112,108],[148,108],
      [111,45],[148,45]
    ];
    const visible = insights.slice(0, points.length);
    visible.forEach((insight, index) => {
      const [x,y] = points[index];
      const link = document.createElementNS(svgNs, 'line');
      link.setAttribute('class', 'brain-task-link');
      link.setAttribute('x1', '130'); link.setAttribute('y1', '78');
      link.setAttribute('x2', String(x)); link.setAttribute('y2', String(y));
      if (visible.slice(index + 1).some(next => samePattern(insight, next))) link.classList.add('is-pattern');
      svg.append(link);
    });
    visible.forEach((insight, index) => {
      const [x,y] = points[index];
      const circle = document.createElementNS(svgNs, 'circle');
      circle.setAttribute('class', 'brain-task-node' + (index === 0 ? ' is-new' : ''));
      circle.setAttribute('cx', String(x)); circle.setAttribute('cy', String(y));
      circle.setAttribute('r', insight.outcome === 'pending' ? '4.2' : '5.2');
      circle.dataset.result = insight.outcome;
      const tip = document.createElementNS(svgNs, 'title');
      tip.textContent = insight.marketName + ' · ' + (insight.expectedDirection === 'none' ? 'observation' : insight.expectedDirection.toUpperCase() + ' ' + insight.barrier) + ' · ' + statusLabel(insight);
      circle.append(tip);
      svg.append(circle);
    });
    return svg;
  }

  function samePattern(a, b) {
    return a.marketSymbol === b.marketSymbol && a.category === b.category
      && a.expectedDirection === b.expectedDirection && a.barrier === b.barrier;
  }
  function statusLabel(insight) {
    if (insight.outcome === 'matched') return 'matched a settled win';
    if (insight.outcome === 'unmatched') return 'matched a settled loss';
    return insight.expectedDirection === 'none' ? 'saved human observation' : 'waiting for a matching settled trade';
  }
  function directionLabel(insight) {
    if (insight.expectedDirection === 'none') return 'Observation only';
    return (insight.expectedDirection === 'over' ? 'Over ' : 'Under ') + insight.barrier;
  }

  function tradeDetail(trade) {
    const detail=node('section','brain-trade-detail');
    detail.setAttribute('aria-label','Trade details');
    const context=trade && trade.context && typeof trade.context==='object' ? trade.context : {};
    const amount=value => value == null || !Number.isFinite(Number(value)) ? 'Not recorded' : Number(value).toFixed(2);
    const percent=value => value != null && Number.isFinite(Number(value)) ? (Number(value)*100).toFixed(1)+'%' : 'Not recorded';
    const heading=node('div','brain-entry-heading');
    const title=node('div','brain-entry-title');
    title.append(node('small','','TRADE SNAPSHOT'),node('h5','','At entry'));
    const result=String(trade.status||'').toLowerCase();
    const badge=node('span','brain-entry-outcome',result==='won'?'Won':result==='lost'?'Lost':'Result');
    badge.dataset.result=result; heading.append(title,badge); detail.append(heading);

    const summary=node('div','brain-entry-summary');
    const metric=(label,value,cls='')=>{const item=node('div','brain-entry-metric '+cls);item.append(node('small','',label),node('strong','',value));return item;};
    summary.append(metric('Cow edge at shot',percent(context.cowEdge)),metric('Cow confidence',percent(context.cowConfidence)),metric('Profit / loss',amount(trade.profit),Number(trade.profit)<0?'is-negative':''));
    detail.append(summary);

    // On compact screens keep the trade summary visible and make the full
    // seven-tick sequences available with one tap rather than clipping them.
    const priceSection=node('details','brain-review-price-details');
    priceSection.open = !window.matchMedia('(max-width: 700px), (max-height: 600px)').matches;
    priceSection.append(node('summary','','Entry & exit prices'));
    detail.append(priceSection);

    // The last feed price seen when the app sent the order is a separate
    // event from Deriv's contract entry and settlement. Never infer it from
    // either provider spot if the snapshot wasn't captured.
    const sent = context.shot && typeof context.shot === 'object' ? context.shot :
      context.shotTick && typeof context.shotTick === 'object' ? context.shotTick : {};
    const sentQuote = sent.quote == null ? '' : String(sent.quote).trim();
    const sentRow = node('div', 'brain-entry-sent');
    const sentPrice = node('strong', '');
    if (sentQuote && /\d$/.test(sentQuote)) {
      sentPrice.append(document.createTextNode(sentQuote.slice(0, -1)), node('b', '', sentQuote.slice(-1)));
    } else sentPrice.textContent = 'Not recorded';
    const sentEpoch = Number(sent.epoch);
    const sentTime = sent.epoch != null && Number.isFinite(sentEpoch) && sentEpoch > 0
      ? new Date(sentEpoch * 1000).toLocaleTimeString(undefined, {hour:'numeric',minute:'2-digit',second:'2-digit'}) : '';
    const sentCopy = node('span', '');
    sentCopy.append(node('small', '', 'App price when sent'), sentPrice);
    sentRow.append(sentCopy, node('small', '', sentTime || 'Time not recorded'));
    priceSection.append(sentRow);
    priceSection.append(node('p', 'brain-trade-note', 'The app price is the last tick seen when the order was sent. Entry and exit below are reported by Deriv.'));
    const addPriceSequence = (label, quote, digit, preceding, following) => {
      const before = Array.isArray(preceding) ? preceding.slice(-3) : [];
      const after = Array.isArray(following) ? following.slice(0, 3) : [];
      const sequence = node('div', 'brain-entry-sequence');
      const sequenceHeading = node('div', 'brain-entry-sequence-heading');
      sequenceHeading.append(node('strong', '', 'Price around ' + label.toLowerCase()), node('small', '', 'Final digit highlighted'));
      sequence.append(sequenceHeading);
      const ticks = node('div', 'brain-tick-row');
      ticks.setAttribute('aria-label', 'Three ticks before ' + label.toLowerCase() + ', the ' + label.toLowerCase() + ' tick, and three ticks after ' + label.toLowerCase());
      const slots = [...Array(Math.max(0, 3 - before.length)).fill(null), ...before,
        { quote, digit }, ...after, ...Array(Math.max(0, 3 - after.length)).fill(null)];
      slots.forEach((tick, index) => {
        const cell = node('div', 'brain-tick' + (index === 3 ? ' is-entry' : ''));
        cell.append(node('small', '', index === 3 ? label.toUpperCase() : index < 3 ? String(index - 3) : '+' + String(index - 3)));
        const price = typeof tick?.quote === 'string' ? tick.quote.trim() : '';
        if (price && /\d$/.test(price)) {
          const value = node('span', 'brain-tick-price');
          if (price.length > 12) value.style.fontSize = Math.max(8, Math.min(11, 120 / price.length)).toFixed(1) + 'px';
          value.append(document.createTextNode(price.slice(0, -1)), node('b', '', price.slice(-1)));
          cell.append(value);
        } else cell.append(node('span', 'brain-tick-missing', '—'));
        ticks.append(cell);
      });
      sequence.append(ticks);
      if (!quote || before.length < 3 || after.length < 3) sequence.append(node('p', 'brain-trade-note', 'Some prices were not recorded.'));
      priceSection.append(sequence);
    };
    const exit = context.exit && typeof context.exit === 'object' ? context.exit : {};
    const entryTime = Number(context.entryEpoch), exitTime = Number(exit.epoch);
    const sameRecordedPoint = context.entryEpoch != null && exit.epoch != null && Number.isFinite(entryTime) && Number.isFinite(exitTime) && entryTime === exitTime && context.entryQuote != null && exit.quote != null && String(context.entryQuote) === String(exit.quote);
    if (sameRecordedPoint) {
      addPriceSequence('Deriv entry / exit', context.entryQuote, context.entryDigit, context.before, context.after);
      priceSection.append(node('p', 'brain-trade-note', 'Deriv recorded the same price and second for entry and exit. More than one tick can share a second.'));
    } else {
      addPriceSequence('Deriv entry', context.entryQuote, context.entryDigit, context.before, context.after);
      addPriceSequence('Deriv exit', exit.quote, exit.digit, exit.before, exit.after);
    }


    const more=node('details','brain-entry-more');
    more.append(node('summary','','Trade details'));
    const facts=node('div','brain-trade-facts');
    facts.append(metric('Buy price',amount(trade.askPrice)),metric('Payout',amount(trade.payout)),
      metric('Quote edge',percent(context.edge)),metric('Stake',amount(trade.stake)),metric('Account',String(trade.accountMode || 'Not recorded')),
      metric('Contract ID',String(trade.providerContractId || 'Not recorded'),'is-id'));
    more.append(facts);detail.append(more);
    return detail;
  }

  // Interpret only the explicitly supported phrase; everything else stays a note.
  function notePattern(text) {
    const match = /^\s*(?:after|following)\s+(?:the\s+)?(two|three|four|2|3|4)\s+(high|low)\s+digits?[.!]?\s*$/i.exec(text);
    if (!match) return null;
    const numbers = { two: 2, three: 3, four: 4 };
    const count = numbers[match[1].toLowerCase()] || Number(match[1]);
    return { count, side: match[2].toLowerCase() };
  }

  function makeForm(trades) {
    const card = node('section','brain-review-form');
    card.append(node('h4','','Teach from a trade'));
    const reviewedTradeIds = new Set((state?.insights || [])
      .map(insight => insight.assessment?.sourceTradeId)
      .filter(Boolean)
      .map(String));
    const availableTrades = (Array.isArray(trades) ? trades : [])
      .filter(trade => !reviewedTradeIds.has(String(trade.id)));
    if (!availableTrades.length) {
      card.append(node('p','brain-review-empty',trades?.length
        ? 'All caught up. Each settled trade can only be taught once.'
        : 'Your settled trades will appear here. Choose one to teach the Brain what you noticed.'));
      return card;
    }
    const form=node('form','brain-review-fields'); form.id='brainInsightForm';
    const choices=node('div','brain-review-trades');
    const details=node('div','brain-review-selected');
    const showDetail=trade=>{details.replaceChildren(tradeDetail(trade));details.dataset.snapshotSignature=JSON.stringify([trade.id,trade.status,trade.profit,trade.askPrice,trade.payout,trade.context]);};
    const selected=node('input',''); selected.type='hidden'; selected.name='sourceTradeId'; form.append(selected);
    let list=availableTrades.slice(0,100);
    let current=Math.max(0,list.findIndex(trade=>String(trade.id)===String(preferredTradeId)));
    let refreshRuleControls=()=>{};
    const drawChoice=()=>{
      const trade=list[current], result=String(trade.status||'').toLowerCase();
      choices.replaceChildren();
      const label=node('span','brain-review-picker-label','Choose a trade');
      const picker=node('div','brain-review-picker');
      const previous=node('button','brain-review-page','‹');previous.type='button';previous.setAttribute('aria-label','Previous trade');previous.disabled=current===0;
      const next=node('button','brain-review-page','›');next.type='button';next.setAttribute('aria-label','Next trade');next.disabled=current===list.length-1;
      const when=trade.settledAt||trade.createdAt, date=when?new Date(when):null;
      const dateLabel=date&&!Number.isNaN(date.getTime())?date.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'';
      const selectedTrade=node('div','brain-review-current');
      const indicator=node('span','brain-review-result',result==='won'?'✓':'×');
      indicator.dataset.result=result;
      const copy=node('span','brain-review-trade-copy');
      copy.append(node('b','',String(trade.marketName||trade.marketSymbol||'Market')+' · '+(String(trade.direction||'').toLowerCase()==='over'?'Over ':'Under ')+trade.barrier),node('small','',dateLabel));
      selectedTrade.append(indicator,copy);
      const move=delta=>{current=Math.max(0,Math.min(list.length-1,current+delta));selected.value=String(list[current].id);preferredTradeId=selected.value;showDetail(list[current]);drawChoice();formDirty=true;};
      previous.addEventListener('click',()=>move(-1));next.addEventListener('click',()=>move(1));
      picker.append(previous,selectedTrade,next);
      choices.append(label,picker,node('small','brain-review-count',(current+1)+' / '+list.length));
      refreshRuleControls();
    };
    selected.value=String(list[current].id); preferredTradeId=selected.value; showDetail(list[current]); drawChoice();
    // Preserve the selected trade and unsaved lesson fields while new trades arrive.
    form.refreshTradeChoices=nextTrades=>{
      if(!Array.isArray(nextTrades))return;
      const reviewed = new Set((state?.insights || []).map(insight => insight.assessment?.sourceTradeId).filter(Boolean).map(String));
      const next=nextTrades.filter(trade=>!reviewed.has(String(trade.id))).slice(0,100);
      if(!next.length)return;
      const index=next.findIndex(trade=>String(trade.id)===selected.value);
      if(index<0)return;
      const changed=JSON.stringify(list.map(item=>[item.id,item.status,item.profit]))!==JSON.stringify(next.map(item=>[item.id,item.status,item.profit]));
      list=next; current=index; if(changed)drawChoice();
    };
    const inputColumn=node('div','brain-review-input-column');
    inputColumn.append(choices); form.append(inputColumn,details);
    const stance=node('fieldset','brain-review-stance');
    stance.append(node('legend','','What did this tell you?'));
    [['good','Good call'],['warning','Bad call']].forEach(([value,label])=>{
      const choice=node('label','');const input=node('input','');input.type='radio';input.name='stance';input.value=value;input.required=true;
      choice.append(input,node('span','',label));stance.append(choice);
    });
    inputColumn.append(stance);
    const topic=node('label','brain-review-label brain-review-note','What did you notice?');
    const observation=node('textarea','');observation.name='observation';observation.rows=2;observation.maxLength=350;observation.required=false;observation.placeholder='Optional note about this trade';topic.append(observation);inputColumn.append(topic);
    const patternBox=node('fieldset','brain-rule-options');
    patternBox.append(node('legend','','Check this on later trades'));
    const ruleGrid=node('div','brain-rule-grid');
    for(const [value,label] of [['','Note only'],['high:2','2 high digits'],['high:3','3 high digits'],['low:2','2 low digits'],['low:3','3 low digits']]){
      const choice=node('label','brain-rule-choice'),input=node('input','');input.type='radio';input.name='ruleSequence';input.value=value;input.checked=value==='';
      choice.append(input,node('span','',label));ruleGrid.append(choice);
    }
    patternBox.append(ruleGrid);
    const rangeBox=node('details','brain-rule-ranges');rangeBox.append(node('summary','','Entry conditions'));
    const rangeFields={};
    for(const [key,label] of [['edge','Similar entry edge'],['confidence','Similar cow confidence']]){
      const choice=node('label','brain-rule-range'),input=node('input','');input.type='checkbox';input.name='ruleRange_'+key;
      const copy=node('span','',label),value=node('small','');
      choice.append(input,copy,value);rangeBox.append(choice);rangeFields[key]={input,value};
    }
    patternBox.append(rangeBox);
    const ruleNote=node('small','brain-rule-note',state?.coreAvailable===false?'Lesson checks are unavailable. You can still save a note.':'High = 5–9 · Low = 0–4. Your call and the trade result are separate.');
    patternBox.append(ruleNote);
    inputColumn.insertBefore(patternBox,topic);
    refreshRuleControls=()=>{
      const context=list[current]?.context||{};
      for(const [key,field] of Object.entries(rangeFields)){
        const raw=context[key==='edge'?'cowEdge':'cowConfidence'],value=raw==null?NaN:Number(raw),width=key==='edge'?.02:.05,floor=key==='edge'?-1:0;
        const available=Number.isFinite(value)&&state?.coreAvailable!==false;
        field.input.disabled=!available;
        if(!available){field.input.checked=false;field.value.textContent='Not recorded';delete field.input.dataset.min;delete field.input.dataset.max;continue;}
        const min=Math.max(floor,value-width),max=Math.min(1,value+width);
        field.input.dataset.min=String(min);field.input.dataset.max=String(max);
        field.value.textContent=(min*100).toFixed(1)+'–'+(max*100).toFixed(1)+'%';
      }
      patternBox.querySelectorAll('[name="ruleSequence"]').forEach(input=>{input.disabled=state?.coreAvailable===false&&input.value!=='';if(input.disabled)input.checked=false;});
      if(!patternBox.querySelector('[name="ruleSequence"]:checked'))patternBox.querySelector('[name="ruleSequence"][value=""]').checked=true;
    };
    refreshRuleControls();

    const row=node('div','brain-review-row');
    const categoryLabel=node('label','brain-review-label','Your observation');
    const category=node('select','');category.name='category';
    [['setup','Pattern'],['market_behavior','Market movement'],['entry_timing','Entry timing'],['risk','Risk or warning']].forEach(([value,label])=>option(category,value,label));categoryLabel.append(category);
    const confidenceLabel=node('label','brain-review-label','Your confidence');
    const confidence=node('input','brain-confidence-slider');confidence.type='range';confidence.name='confidence';confidence.min='1';confidence.max='5';confidence.step='1';confidence.value='3';confidence.setAttribute('aria-label','Your confidence, from 1 to 5');const confidenceValue=node('output','brain-confidence-value','3 / 5');confidence.addEventListener('input',()=>{confidenceValue.textContent=confidence.value+' / 5'});confidenceLabel.append(confidence,confidenceValue);
    row.append(categoryLabel,confidenceLabel);inputColumn.append(row);
    const submit=node('button','brain-task-primary brain-review-save','Save lesson');submit.type='submit';inputColumn.append(submit);
    const horizon=node('input','');horizon.type='hidden';horizon.name='horizon';horizon.value='next_session';form.append(horizon);
    form.addEventListener('input',()=>{formDirty=true});form.addEventListener('change',()=>{formDirty=true});form.addEventListener('submit',submitInsight);
    card.append(form);return card;
  }

  async function submitInsight(event) {
    event.preventDefault();
    const form=event.currentTarget, data=new FormData(form), submit=form.querySelector('button[type="submit"]');
    if(!data.get('sourceTradeId')){setMessage('Choose a settled trade first.','bad');return;}
    submit.disabled=true;submit.textContent='Saving…';setMessage('Saving your lesson…','busy');
    const savedAccount = recentTradeAccount;
    const conditions={};
    const sequence=String(data.get('ruleSequence')||'');
    if(sequence){const [side,count]=sequence.split(':');conditions.digitSequence={side,count:Number(count)};}
    for(const key of ['edge','confidence']){
      const input=form.querySelector('[name="ruleRange_'+key+'"]');
      if(input?.checked&&!input.disabled)conditions[key]={min:Number(input.dataset.min),max:Number(input.dataset.max)};
    }
    if(!Object.keys(conditions).length&&String(data.get('observation')||'').trim().length<8){
      submit.disabled=false;submit.textContent='Save lesson';setMessage('Choose a pattern or add a short note of at least 8 characters.','bad');return;
    }
    try {
      const saved = await request('/api/ranger-brain/contributions',{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({
        sourceTradeId:String(data.get('sourceTradeId')),category:data.get('category'),observation:data.get('observation'),stance:data.get('stance'),
        confidence:Number(data.get('confidence')),horizon:data.get('horizon'), conditions:Object.keys(conditions).length?conditions:null
      })});
      // The lesson is already saved. Switch tabs immediately, then animate only
      // after an account-scoped refresh confirms the new lesson is present.
      if (savedAccount !== recentTradeAccount) return;
      note='Lesson saved'; formDirty=false;
      awaitingGrowthLessonId = saved?.insight?.id == null ? null : String(saved.insight.id);
      $('brainTabMind')?.click();
      await load();
      setMessage(note,'good');
    } catch(error) {
      setMessage(error.message||'Could not save your lesson. Try again.','bad');submit.disabled=false;submit.textContent='Save lesson';
    }
  }

  function renderCombinedRead(data) {
    const card=node('article','brain-task-combined');
    const head=node('div','brain-task-section-head');
    head.append(node('span','brain-task-eyebrow','HUMAN IDEA + PRACTICE'));
    head.append(node('h4','','The Brain’s combined read'));
    card.append(head);
    const insight=data.insights.find(item=>item.expectedDirection!=='none');
    const evidence=data.practiceEvidence;
    let title,copy,tone='learning';
    if(!insight){
      title='Teach me a trade idea';
      copy='I will compare your Over/Under digit idea with matching site practice, then check any later settled Deriv trade that lines up with it.';
    } else if(!evidence){
      title='Practice comparison is unavailable';
      copy='Your saved idea is safe. I could not read matching practice results just now, so I will not guess.';
    } else if(evidence.verdict==='favorable'){
      title='The practice sample supports watching this idea';
      copy='For '+insight.marketName+' '+directionLabel(insight)+', shared site practice recorded '+evidence.wins+' wins from '+evidence.outcomes+' matching settled results. This is historical practice evidence, not a prediction of the next result.';
      tone='watch';
    } else if(evidence.verdict==='unfavorable'){
      title='Past practice has not supported this idea';
      copy='For '+insight.marketName+' '+directionLabel(insight)+', matching practice was '+evidence.wins+' wins from '+evidence.outcomes+' settled results. Your note is still saved; the record does not back it so far.';
      tone='wait';
    } else if(evidence.outcomes < evidence.minimumOutcomes){
      title='Still collecting matching practice';
      copy='I have '+evidence.outcomes+' of '+evidence.minimumOutcomes+' matching settled site practice results for '+insight.marketName+' '+directionLabel(insight)+'. I need more before judging the idea.';
    } else {
      title='Practice has not found a clear pattern';
      copy='The '+evidence.outcomes+' matching practice results for '+insight.marketName+' '+directionLabel(insight)+' do not show a dependable advantage. Keep the idea as a hypothesis.';
    }
    card.dataset.state=tone;
    card.append(node('strong','brain-task-combined-title',title));
    card.append(node('p','',copy));
    const source=node('small','','Shared site paper practice + your private lesson + later settled trades from your connected Deriv account.');
    card.append(source);
    return card;
  }

  function renderProgress(progress, insights) {
    const card=node('section','brain-task-progress');
    const left=node('div','brain-task-network-wrap');
    left.append(drawNetwork(insights));
    const right=node('div','brain-task-progress-copy');
    right.append(node('span','brain-task-eyebrow','YOUR BRAIN'));
    const summary=node('div','brain-task-level');
    summary.append(node('strong','',String(progress.level)));
    const levelCopy=node('div','');
    levelCopy.append(node('b','','Level '+progress.level+' Ranger'));
    levelCopy.append(node('small','',progress.xp+' total XP · '+progress.linkedWins+' wins matched to your lessons'));
    summary.append(levelCopy); right.append(summary);
    const bar=node('div','brain-task-xpbar'); bar.setAttribute('role','progressbar');
    bar.setAttribute('aria-valuemin','0'); bar.setAttribute('aria-valuemax','100'); bar.setAttribute('aria-valuenow',String(progress.levelXp));
    const fill=node('i',''); fill.style.width=progress.levelXp+'%'; bar.append(fill); right.append(bar);
    right.append(node('small','brain-task-next-level',progress.levelXp+' / 100 XP to Level '+(progress.level+1)));
    const stats=node('div','brain-task-stats');
    const total=node('span',''); const totalStrong=node('b','',String(progress.total)); total.append(totalStrong,document.createTextNode(' lessons')); stats.replaceChildren(total);
    const reviewed=node('span',''); reviewed.append(node('b','',String(progress.reviewed)),document.createTextNode(' checked trades')); stats.append(reviewed);
    const patterns=node('span',''); patterns.append(node('b','',String(progress.patterns)),document.createTextNode(' repeated patterns')); stats.append(patterns);
    card.append(left,right,stats);
    return card;
  }

  function renderTasks(progress, insights) {
    const wrap=node('div','brain-task-board');
    const teach=node('article','brain-task-tile');
    teach.append(node('span','brain-task-tile-icon','✦'));
    const teachCopy=node('div',''); teachCopy.append(node('b','','Teach one lesson'),node('small','',progress.total?'You added '+progress.total+' memories.':'Share a real setup you noticed.'));
    teach.append(teachCopy,node('em','',progress.total?'+10 XP each':'START'));
    const check=node('article','brain-task-tile');
    check.append(node('span','brain-task-tile-icon','◎'));
    const waiting=insights.filter(item=>item.expectedDirection!=='none'&&item.outcome==='pending').length;
    const checkCopy=node('div',''); checkCopy.append(node('b','','Let the Brain check it'),node('small','',waiting?waiting+' lesson'+(waiting===1?' is':'s are')+' waiting for a matching settled trade.':'Your next matching settled trade will check a lesson.'));
    check.append(checkCopy,node('em','',waiting?'IN PROGRESS':'READY'));
    const win=node('article','brain-task-tile');
    win.append(node('span','brain-task-tile-icon','★'));
    const winCopy=node('div',''); winCopy.append(node('b','','A lesson lines up with a win'),node('small','','A verified matching win adds 25 XP. A matching loss removes the lesson’s 10 XP and costs 10 more.'));
    win.append(winCopy,node('em','',progress.linkedWins+' WINS'));
    wrap.append(teach,check,win);
    const noteLine=node('p','brain-task-rules','Teaching earns 10 XP. A later matching settled Deriv win adds 25 XP; a matching loss removes that 10 XP and deducts 10 more from your progress. Total XP cannot fall below zero. XP never changes your balance or stake, and placing trades alone earns no points.');
    wrap.append(noteLine);
    return wrap;
  }

  function renderInsights(insights, trades) {
    const section=node('section','brain-task-insights');
    section.setAttribute('aria-labelledby','brainTaskMemoryTitle');
    const head=node('div','brain-task-section-head brain-task-memory-head');
    const title=node('h4','','Saved lessons'); title.id='brainTaskMemoryTitle';
    head.append(title,node('span','brain-task-memory-count',insights.length+' stored'));
    section.append(head);
    if(!insights.length){
      const empty=node('div','brain-task-memory-empty');
      empty.append(node('span','brain-task-empty-network','✦'));
      const copy=node('div',''); copy.append(node('strong','','No lessons yet'),node('small','','Choose a trade above to teach your first lesson.'));
      const teach=node('button','brain-task-empty-action','Teach a lesson');teach.type='button';teach.addEventListener('click',openTeachingTask);
      empty.append(copy,teach);section.append(empty);return section;
    }
    const tradeById = new Map((Array.isArray(trades)?trades:[]).map(trade=>[String(trade.id),trade]));
    const list=node('div','brain-task-memory-grid');
    for(const insight of insights.slice(0,24)){
      const evidence=insight.patternEvidence && typeof insight.patternEvidence==='object' ? insight.patternEvidence : null;
      const matched=evidence?.matched || null, comparable=evidence?.comparable || null;
      const seen=Math.max(0,Number(matched?.trades)||0), wins=Math.max(0,Number(matched?.wins)||0);
      const pattern=insight.confirmedPattern;
      const patternText=pattern && (pattern.side==='high'||pattern.side==='low') && [2,3].includes(Number(pattern.count))
        ? 'After '+pattern.count+' '+pattern.side+' digits' : insight.coreLesson ? [insight.conditions?.edge?'Similar edge':'',insight.conditions?.confidence?'Similar confidence':''].filter(Boolean).join(' · ') : '';
      const card=node('details','brain-task-memory-card');card.dataset.result='pending';
      const summary=node('summary','brain-task-memory-summary');
      const mark=node('span','brain-task-memory-mark',patternText?'✦':'•');
      const copy=node('span','brain-task-memory-copy');
      copy.append(node('b','',insight.marketName+' · '+directionLabel(insight)),
        node('small','',patternText || 'Personal note'));
      const badge=node('em','brain-task-memory-result',insight.coreLesson?({helping:'HELPING',not_helping_yet:'NOT HELPING YET',needs_examples:'NEEDS EXAMPLES'}[insight.coreLesson.status]||'NEEDS EXAMPLES'): 'SAVED NOTE');
      if(insight.coreLesson)card.dataset.learning=insight.coreLesson.status;
      summary.append(mark,copy,badge);card.append(summary);
      const detail=node('div','brain-task-memory-detail');
      detail.append(node('p','',String(insight.observation || '').replace(/\n\[Trade reference: [^\]]+\]$/, '')));
      if(insight.assessment?.call || insight.stance){
        const call=(insight.assessment?.call==='bad'||insight.stance==='warning')?'Bad call':'Good call';
        const result=insight.assessment?.tradeResult;
        detail.append(node('small','',call+(result==='won'?' · Trade won':result==='lost'?' · Trade lost':'')));
      }
      if(patternText){
        if(!evidence){
          detail.append(node('small','','Pattern comparison is unavailable right now.'));
        }else if(evidence.supported === false){
          detail.append(node('small','','This pattern needs four earlier digits. Current trade records keep three, so it cannot be checked yet.'));
        }else{
          const comparison=node('div','brain-pattern-comparison');
          const makeGroup=(group,label)=>{
            const count=Math.max(0,Number(group?.trades)||0), groupWins=Math.max(0,Number(group?.wins)||0);
            const result=node('section','brain-pattern-group');
            result.append(node('b','',label),node('strong','',count+' trade'+(count===1?'':'s')));
            const hasMoney=group?.profit != null && group?.stake != null && Number.isFinite(Number(group.profit)) && Number(group.stake)>0;
            result.append(node('span','',count?Math.round(groupWins/count*100)+'% won':'Waiting for trades'),
              node('small','',hasMoney ? ((Number(group.profit)>=0?'+':'')+Number(group.profit).toFixed(2)+' net · '+(Number(group.profit)/Number(group.stake)*100).toFixed(1)+'% of stakes') : 'Return unavailable'));
            const ids=Array.isArray(group?.tradeIds)?group.tradeIds.map(String):[];
            const known=ids.map(id=>tradeById.get(id)).filter(Boolean);
            if(known.length){
              const entries=node('details','brain-pattern-trades');
              entries.append(node('summary','','View trades · '+known.length));
              for(const trade of known){
                const entry=node('details','brain-pattern-trade');
                const when=trade.settledAt||trade.createdAt, date=when?new Date(when):null;
                const time=date&&!Number.isNaN(date.getTime())?date.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'';
                entry.append(node('summary','',(trade.status==='won'?'Won':'Lost')+(time?' · '+time:'')),tradeDetail(trade));entries.append(entry);
              }
              if(known.length<count)entries.append(node('small','','Showing recent trades available here.'));
              result.append(entries);
            } else if(count && Array.isArray(group?.tradeIds)) {
              result.append(node('small','','Older trades are not shown in this list.'));
            }
            return result;
          };
          comparison.append(makeGroup(matched,'Pattern appeared'),makeGroup(comparable,'Pattern did not appear'));
          detail.append(comparison);
          detail.append(node('small','',evidence.pending ? 'Collecting later examples. Matched trades and comparison trades stay saved.' : 'Recorded later trades. These results do not guarantee the next trade.'));
          if(Number(evidence.skipped)>0)detail.append(node('small','','Missing entry details · '+Number(evidence.skipped)+' trades not counted'));
          if(insight.coreLesson?.status==='helping')detail.append(node('small','',insight.stance==='warning'?'This condition has performed worse than comparison trades.':'This condition has performed better than comparison trades. It still needs ongoing checks.'));
        }
      }else{
        detail.append(node('small','','Saved note. It does not change predictions until a checkable condition is confirmed.'));
      }
      const when=insight.createdAt?new Date(insight.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';
      detail.append(node('small','',when+(insight.confidence?' · Your confidence '+insight.confidence+'/5':'')));
      card.append(detail);list.append(card);
    }
    section.append(list);
    if(insights.length>24)section.append(node('small','brain-task-memory-more',(insights.length-24)+' older lessons are stored in your Brain.'));
    return section;
  }

  function renderLeaderboard(rows) {
    const section=node('section','brain-task-leaderboard');
    const head=node('div','brain-task-section-head');
    head.append(node('span','brain-task-eyebrow','PASTURE RANGERS'));
    head.append(node('h4','','Brain builders'));
    head.append(node('p','','Ranked by lessons taught and verified results, not by money or trade size.'));
    section.append(head);
    if(!rows.length){section.append(node('p','brain-contribution-empty','The leaderboard grows as Rangers teach the Brain and verify their ideas.'));return section;}
    const list=node('ol','brain-task-rank-list');
    rows.forEach((entry,index)=>{
      const row=node('li','brain-task-rank');
      const rank=node('span','brain-task-rank-number',String(index+1).padStart(2,'0'));
      const who=node('div',''); who.append(node('b','',entry.displayName),node('small','','Level '+entry.level+' · '+entry.contributions+' lessons · '+entry.linkedWins+' matched wins'));
      row.append(rank,who,node('strong','',entry.xp+' XP'));
      list.append(row);
    });
    section.append(list);
    return section;
  }

  const researchHudEnabled = document.documentElement.dataset.coreResearchHud === 'true';
  const missionHud = researchHudEnabled ? null : $('missionHud');
  let hudGoalsPanel = null;
  function goalLabel(goal) {
    const labels = {reviews:'Review your trades',pattern:'Confirm a pattern',matches:'See the pattern again',comparison:'Compare other trades'};
    return labels[goal.key] || String(goal.label || 'Brain task');
  }
  function positionHudGoals() {
    if (!missionHud || !hudGoalsPanel || hudGoalsPanel.hidden) return;
    const rect = missionHud.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 16);
    hudGoalsPanel.style.width = width + 'px';
    hudGoalsPanel.style.left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left)) + 'px';
    hudGoalsPanel.style.top = Math.max(8, Math.min(window.innerHeight - hudGoalsPanel.offsetHeight - 8, rect.bottom + 8)) + 'px';
  }
  function ensureHudGoals() {
    if (hudGoalsPanel) return hudGoalsPanel;
    const panel = node('section', 'brain-hud-goals');
    panel.id = 'brainHudGoals';
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Brain tasks');
    panel.setAttribute('role', 'region');
    document.body.append(panel);
    hudGoalsPanel = panel;
    missionHud?.setAttribute('aria-controls', panel.id);
    missionHud?.setAttribute('aria-expanded', 'false');
    return panel;
  }
  function syncHudTask(progress, insights, guest) {
    if (researchHudEnabled) return;
    const card = $('missionHud'), title = $('missionTitle'), count = $('missionProgress');
    if (!card || !title || !count) return;
    const goals = Array.isArray(state?.training?.goals) ? state.training.goals : [];
    const next = goals.find(goal => Math.max(0, Number(goal.current) || 0) < Math.max(1, Number(goal.target) || 1));
    const label = card.querySelector('.mission-copy small');
    if (label && label.textContent !== 'BRAIN TASK') label.textContent = 'BRAIN TASK';
    let titleText, countText;
    if (guest) { titleText='Connect to teach'; countText='OPEN'; }
    else if (!progress) { titleText='Brain tasks unavailable'; countText='RETRY'; }
    else if (next) {
      titleText=goalLabel(next);
      countText=Math.min(Math.max(0,Number(next.current)||0),Math.max(1,Number(next.target)||1))+' / '+Math.max(1,Number(next.target)||1);
    } else if (goals.length) { titleText='Brain tasks complete'; countText='READY'; }
    else { titleText='Brain tasks unavailable'; countText='RETRY'; }
    if (title.textContent !== titleText) title.textContent=titleText;
    if (count.textContent !== countText) count.textContent=countText;
    card.setAttribute('aria-label','Brain task: '+titleText+'. '+countText+'. View tasks.');
    if (hudGoalsPanel && !hudGoalsPanel.hidden) renderHudGoals();
  }
  function renderHudGoals() {
    const panel=ensureHudGoals();
    panel.replaceChildren();
    const head=node('div','brain-hud-goals-head');
    head.append(node('strong','','Brain tasks'));
    const dismiss=node('button','brain-hud-goals-close','×');
    dismiss.type='button'; dismiss.setAttribute('aria-label','Close Brain tasks');
    dismiss.addEventListener('click',()=>closeHudGoals(true)); head.append(dismiss); panel.append(head);
    if (!state) panel.append(node('p','',note==='guest'?'Connect Deriv to save your progress.':'Progress is temporarily unavailable.'));
    else {
      const goals=Array.isArray(state.training?.goals)?state.training.goals:[];
      if (!goals.length) panel.append(node('p','','Progress is temporarily unavailable.'));
      for (const goal of goals) {
        const row=node('div','brain-hud-goal');
        const current=Math.max(0,Number(goal.current)||0), target=Math.max(1,Number(goal.target)||1);
        row.append(node('span','',goalLabel(goal)),node('strong','',Math.min(current,target)+' / '+target));
        const bar=node('progress',''); bar.max=target; bar.value=Math.min(current,target); bar.setAttribute('aria-label',goalLabel(goal)); row.append(bar);
        panel.append(row);
      }
    }
    const open=node('button','brain-hud-goals-open','Teach the Brain');
    open.type='button'; open.addEventListener('click',()=>{
      closeHudGoals();
      const menu=window.__zeronineBrainMenu;
      if (menu && typeof menu.open==='function') menu.open();
      else $('rangerBrainGlyph')?.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
      setTimeout(()=>$('brainTabMemory')?.click(),80);
    });
    panel.append(open);
    requestAnimationFrame(positionHudGoals);
  }
  function closeHudGoals(restoreFocus=false) {
    if (!hudGoalsPanel) return;
    hudGoalsPanel.hidden=true; missionHud?.setAttribute('aria-expanded','false');
    if (restoreFocus) missionHud?.focus({preventScroll:true});
  }
  if (missionHud) {
    missionHud.addEventListener('click',event=>{
      event.stopPropagation();
      const panel=ensureHudGoals();
      if (!panel.hidden) { closeHudGoals(); return; }
      panel.hidden=false; missionHud.setAttribute('aria-expanded','true'); renderHudGoals(); void load();
    });
    document.addEventListener('pointerdown',event=>{
      if (hudGoalsPanel && !hudGoalsPanel.hidden && !hudGoalsPanel.contains(event.target) && !missionHud.contains(event.target)) closeHudGoals();
    });
    document.addEventListener('keydown',event=>{ if(event.key==='Escape' && hudGoalsPanel && !hudGoalsPanel.hidden){event.preventDefault();closeHudGoals(true);} });
    window.addEventListener('resize',positionHudGoals);
    const title=$('missionTitle'), count=$('missionProgress');
    if(title && count && typeof MutationObserver==='function') {
      new MutationObserver(()=>syncHudTask(state?.progress||null,state?.insights||[],note==='guest')).observe(title.parentElement,{childList:true,subtree:true,characterData:true});
      new MutationObserver(()=>syncHudTask(state?.progress||null,state?.insights||[],note==='guest')).observe(count,{childList:true,subtree:true,characterData:true});
    }
  }

  function renderUnlockHero(data) {
    const title=$('brainUnlockTitle'), message=$('brainUnlockText'), list=$('brainUnlockGoals'), action=$('brainUnlockAction');
    if(!title || !message || !list || !action) return;
    const mode = window.__brainSuggestionMode === 'training' ? 'training' : 'normal';
    const training=data?.training, unlocked=mode==='normal' || training?.unlocked===true;
    title.textContent=mode==='normal'?'Normal mode ready':unlocked?'Suggestions unlocked':'Unlock Brain suggestions';
    message.textContent=mode==='normal'?'Left-click the Brain to find a setup.':unlocked?'Left-click the Brain to find a setup.':data?'Teach the Brain, then let it learn from recorded trades.':note==='guest'?'Connect Deriv to start teaching.':'Training progress is unavailable right now.';
    list.replaceChildren();
    const labels={reviews:'Review trades',pattern:'Confirm a pattern',matches:'Matching trades',comparison:'Other trades'};
    for(const goal of Array.isArray(training?.goals)?training.goals:[]) {
      const current=Math.max(0,Number(goal.current)||0), target=Math.max(1,Number(goal.target)||1);
      const row=node('div','brain-unlock-goal');
      row.append(node('span','',labels[goal.key]||String(goal.label||'Training')),node('strong','',Math.min(current,target)+' / '+target));
      const bar=node('progress','');bar.max=target;bar.value=Math.min(current,target);bar.setAttribute('aria-label',labels[goal.key]||String(goal.label||'Training'));row.append(bar);list.append(row);
    }
    const perf=$('brainUnlockPerformance');
    if(perf) {
      perf.replaceChildren(); perf.hidden=!unlocked;
      if(unlocked) {
        const results=data?.brainPerformance;
        const settled=Math.max(0,Number(results?.settled)||0), wins=Math.max(0,Number(results?.wins)||0);
        if(settled && results?.complete===true) {
          const currency=String(results.currency||'');
          const pnl=results.netProfit == null ? NaN : Number(results.netProfit);
          const pnlText=Number.isFinite(pnl)?(pnl>=0?'+':'−')+Math.abs(pnl).toFixed(2)+(currency?' '+currency:''):'—';
          perf.append(node('small','','Recorded manual Brain picks'),node('strong','',wins+' / '+settled+' won'),node('span','','Net '+pnlText));
          const grossWon=results.grossWon == null ? NaN : Number(results.grossWon), grossLost=results.grossLost == null ? NaN : Number(results.grossLost);
          if(Number.isFinite(grossWon)&&Number.isFinite(grossLost)) perf.append(node('small','','Won '+grossWon.toFixed(2)+' · Lost '+grossLost.toFixed(2)));
        } else perf.append(node('small','',results?.complete===false?'Results are temporarily unavailable.':'No recorded suggestion results yet.'));
      }
    }
    action.textContent=unlocked?'Find a setup':'See your tasks →';
    action.onclick=()=>{if(unlocked) $('brainFindCow')?.click();else $('brainTabMemory')?.click();};
  }

  function formatMemoryBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return Math.round(bytes) + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }
  let latestMemory = null, memoryPopup = null, memoryAnchor = null;
  function closeMemoryPopup() {
    if (memoryPopup) memoryPopup.hidden = true;
    if (memoryAnchor) memoryAnchor.setAttribute('aria-expanded', 'false');
    memoryAnchor = null;
  }
  function positionMemoryPopup() {
    if (!memoryPopup || memoryPopup.hidden || !memoryAnchor) return;
    const anchor = memoryAnchor.getBoundingClientRect();
    const width = memoryPopup.offsetWidth, height = memoryPopup.offsetHeight;
    const left = Math.max(8, Math.min(innerWidth - width - 8, anchor.left));
    const below = anchor.bottom + 8;
    const top = below + height <= innerHeight - 8 ? below : Math.max(8, anchor.top - height - 8);
    memoryPopup.style.left = Math.round(left) + 'px'; memoryPopup.style.top = Math.round(top) + 'px';
  }
  function renderMemoryPopup() {
    if (!memoryPopup) return;
    memoryPopup.replaceChildren(node('strong', '', 'Saved memory'));
    if (!latestMemory) memoryPopup.append(node('p', '', 'Memory size is temporarily unavailable.'));
    else {
      memoryPopup.append(node('p', '', formatMemoryBytes(latestMemory.bytes) + ' saved'),
        node('p', '', latestMemory.lessons + ' lessons · ' + latestMemory.trades + ' trades · ' + latestMemory.snapshots + ' snapshots'),
        node('small', '', 'Approximate saved data. The fill is a visual guide, not a storage limit.'));
    }
    positionMemoryPopup();
  }
  function toggleMemoryPopup(anchor) {
    if (memoryPopup && !memoryPopup.hidden && memoryAnchor === anchor) { closeMemoryPopup(); return; }
    document.dispatchEvent(new CustomEvent('brain:close-detail', { detail: { source: 'storage' } }));
    if (!memoryPopup) {
      memoryPopup = node('div', 'brain-memory-popup'); memoryPopup.id = 'brainMemoryPopup';
      memoryPopup.setAttribute('role', 'dialog'); memoryPopup.setAttribute('aria-label', 'Saved memory details');
      document.body.append(memoryPopup);
    }
    memoryAnchor = anchor; memoryPopup.hidden = false; anchor.setAttribute('aria-expanded', 'true'); renderMemoryPopup();
  }
  document.addEventListener('brain:close-detail', event => { if (event.detail?.source !== 'storage') closeMemoryPopup(); });
  document.addEventListener('pointerdown', event => { if (memoryPopup && !memoryPopup.hidden && !memoryPopup.contains(event.target) && !memoryAnchor?.contains(event.target)) closeMemoryPopup(); }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMemoryPopup(); });
  window.addEventListener('resize', positionMemoryPopup);
  document.addEventListener('visibilitychange', () => { if (document.hidden) closeMemoryPopup(); });
  const brainPanelForMemory = $('rangerBrainPanel');
  if (brainPanelForMemory) new MutationObserver(() => { if (brainPanelForMemory.hidden) closeMemoryPopup(); }).observe(brainPanelForMemory, { attributes: true, attributeFilter: ['hidden'] });

  function updateMemoryGrowth(card, data) {
    const visual = card.querySelector('.brain-growth-visual');
    const storage = data?.storage;
    const available = storage && storage.measurement === 'estimated_row_bytes' && Number.isFinite(Number(storage.bytes)) && Number.isFinite(Number(storage.lessons)) && Number.isFinite(Number(storage.trades));
    // Progress is refreshed with lessons; the byte estimate may be cached briefly.
    const lessons = available ? Math.max(0, Math.floor(Number(storage.lessons)), Math.floor(Number(data?.progress?.total) || 0)) : 0;
    const trades = available ? Math.max(0, Math.floor(Number(storage.trades))) : 0;
    // The count comes from saved account records, so never animate a speculative trade.
    if (available) {
      if (lastGrowthTradeCount !== null && trades > lastGrowthTradeCount) {
        card.classList.remove('brain-growth-celebrate');
        void card.offsetWidth;
        card.classList.add('brain-growth-celebrate');
        clearTimeout(growthCelebrationTimer);
        growthCelebrationTimer = setTimeout(() => card.classList.remove('brain-growth-celebrate'), 1800);
      }
      lastGrowthTradeCount = trades;
    }
    // Visual stages represent saved activity; they are not an intelligence score.
    const growth = available ? Math.min(1, Math.log1p(lessons * 8 + trades) / Math.log1p(1000)) : 0;
    if (visual) { visual.style.setProperty('--neural-growth', growth.toFixed(3)); visual.dataset.neuralStage = String(Math.min(5, Math.floor(growth * 6))); }
    let meter = $('brainMemoryMeter');
    if (!meter) {
      meter = node('button', 'brain-memory-meter'); meter.id = 'brainMemoryMeter'; meter.type = 'button'; meter.setAttribute('aria-expanded', 'false'); meter.setAttribute('aria-controls', 'brainMemoryPopup');
      meter.addEventListener('click', () => toggleMemoryPopup(meter));
      const cylinder = node('span', 'brain-memory-cylinder'); cylinder.setAttribute('aria-hidden', 'true');
      const copy = node('span', 'brain-memory-copy');
      const title = node('strong', ''); title.id = 'brainMemorySize';
      const sub = node('small', ''); sub.id = 'brainMemoryCounts';
      copy.append(title, sub); meter.append(cylinder, copy);
      const hero = $('brainHeroCard');
      if (hero) hero.insertAdjacentElement('afterend', meter); else card.append(meter);
    }
    // Place storage after the info card, including if it was mounted earlier.
    const hero = $('brainHeroCard');
    if (hero && meter.previousElementSibling !== hero) hero.insertAdjacentElement('afterend', meter);
    // This monotonic scale visualizes actual estimated bytes and is not a quota.
    const memoryBytes = available ? Math.max(0, Number(storage.bytes)) : 0;
    const memoryFill = available ? Math.min(100, Math.log1p(memoryBytes) / Math.log1p(1073741824) * 100) : 0;
    meter.style.setProperty('--memory-fill', memoryFill.toFixed(3) + '%');
    latestMemory = available ? { bytes: memoryBytes, lessons, trades, snapshots: Math.max(0, Math.floor(Number(storage.snapshots) || 0)) } : null;
    if (memoryPopup && !memoryPopup.hidden) renderMemoryPopup();
    $('brainMemorySize').textContent = available ? formatMemoryBytes(storage.bytes) + ' saved' : 'Memory size unavailable';
    $('brainMemoryCounts').textContent = available ? lessons + ' lessons · ' + trades + ' trades · tap for details' : 'Saved memory is temporarily unavailable';
    meter.title = available ? 'Approximate saved data. Fill is a visual guide, not a storage limit.' : 'Saved memory could not be measured.';
    meter.setAttribute('aria-label', available ? 'Saved memory: about ' + formatMemoryBytes(storage.bytes) + ', ' + lessons + ' lessons, ' + trades + ' trades. Select for details.' : 'Saved memory temporarily unavailable');
  }

  function renderMainGrowth(data) {
    const card = $('brainGrowthCard');
    if (!card) return;
    updateMemoryGrowth(card, data);
    const progress=data?.progress || {level:1,xp:0,levelXp:0,total:0};
    const insights=Array.isArray(data?.insights)?data.insights:[];
    const good=insights.filter(item=>item.stance==='good').length;
    const bad=insights.filter(item=>item.stance==='warning').length;
    const waiting=insights.filter(item=>item.confirmedPattern && (!item.patternEvidence || item.patternEvidence.pending)).length;
    const level=Number(progress.level)||1,xp=Number(progress.xp)||0,levelXp=Math.max(0,Math.min(100,Number(progress.levelXp)||0));
    card.dataset.state=data?(waiting?'waiting':'learning'):note==='guest'?'guest':'offline';
    $('brainGrowthLevel').textContent='LV '+level;
    $('brainGrowthXP').textContent=xp+' XP';
    $('brainGrowthNext').textContent=levelXp+' / 100 XP to Level '+(level+1);
    $('brainGrowthProgress').setAttribute('aria-valuenow',String(levelXp));
    $('brainGrowthFill').style.width=levelXp+'%';
    for(const [id,value,label] of [['brainGrowthWins',good,'Your good calls'],['brainGrowthLosses',bad,'Your bad calls'],['brainGrowthWaiting',waiting,'Still learning'],['brainGrowthLessons',Number(progress.total)||0,'Lessons']]){
      const el=$(id);el.textContent=String(value);const caption=el.parentElement?.querySelector('span');if(caption)caption.textContent=label;
    }
    $('brainGrowthText').textContent=!data
      ? note==='guest'?'Connect Deriv to save lessons.':'Your lessons are temporarily unavailable.'
      : waiting?waiting+' pattern'+(waiting===1?' is':'s are')+' still collecting examples.'
      : insights.length?'Your lessons are saved. Review their progress in Memories.':'Choose a trade and teach your first lesson.';
    const feed=$('brainGrowthActivity');feed.replaceChildren();
    if(!insights.length)feed.append(node('li','is-empty',data?'Your lessons will appear here.':'Connect Deriv to begin.'));
    else for(const insight of insights.slice(0,3)){
      const row=node('li','');row.dataset.result='pending';
      const mark=node('span','brain-growth-mark','·');
      const copy=node('span','brain-growth-outcome');
      copy.append(node('b','',insight.marketName+' · '+directionLabel(insight)),
        node('small','',String(insight.observation||'').replace(/\n\[Trade reference: [^\]]+\]$/,'').slice(0,110)));
      const seen=Math.max(0,Number(insight.patternEvidence?.matched?.trades)||0);
      const status=node('strong','',insight.confirmedPattern?(seen?'Seen '+seen+' times':'Waiting for examples'):'Saved note');
      row.append(mark,copy,status);feed.append(row);
    }
    const explanation=card.querySelector('.brain-growth-actions p');
    if(explanation)explanation.textContent='Review a trade, then teach a pattern. Later recorded prices help check it.';
    const heading=card.querySelector('.brain-growth-trail-heading strong');
    if(heading)heading.textContent='Recent lessons';
    const teach=$('brainGrowthTeach');if(teach)teach.textContent=note==='guest'?'Connect Deriv to teach':'Teach the Brain';
  }

  function openTeachingTask() {
    document.getElementById('brainTabMemory')?.click();
    let attempts = 0;
    const reveal = () => {
      const form = $('brainInsightForm');
      if (form) {
        form.hidden = false;
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        (form.querySelector('.brain-review-trade') || form.querySelector('textarea'))?.focus({ preventScroll: true });
        return;
      }
      if (attempts++ === 0) void load();
      if (attempts < 30) setTimeout(reveal, 100);
    };
    setTimeout(reveal, 120);
  }
  $('brainGrowthTeach')?.addEventListener('click', openTeachingTask);
  $('brainGrowthAllTasks')?.addEventListener('click', () => document.getElementById('brainTabMemory')?.click());
  document.addEventListener('zeronine:brain-teach', openTeachingTask);

  function renderTraining(training) {
    const card=node('details','brain-goals');
    const unlocked=training?.unlocked === true;
    card.append(node('summary','brain-goals-summary',unlocked?'Brain suggestions ready · Tasks':'Brain tasks · View progress'));
    const list=node('div','brain-goals-list');
    const goals=Array.isArray(training?.goals)?training.goals:[];
    if (!goals.length) {
      card.append(node('small','','Training progress is unavailable right now.'));
      return card;
    }
    for(const goal of goals){
      const row=node('div','brain-goal');
      const current=Math.max(0,Number(goal.current)||0),target=Math.max(1,Number(goal.target)||1);
      const labels={reviews:'Review your trades',pattern:'Confirm a pattern',matches:'See the pattern again',comparison:'Compare other trades'};
      const label=labels[goal.key] || String(goal.label||'Training');
      row.append(node('span','',label),node('strong','',Math.min(current,target)+' / '+target));
      const bar=node('progress','');bar.max=target;bar.value=Math.min(current,target);bar.setAttribute('aria-label',label);row.append(bar);list.append(row);
    }
    card.append(list);
    return card;
  }

  function render() {
    formDirty = false;
    host.replaceChildren();
    const data=state;
    syncHudTask(data?.progress || null,data?.insights || [],note==='guest');
    renderMainGrowth(data);
    if(!data){
      const card=node('section','brain-task-login');
      card.append(node('span','brain-task-eyebrow','BRAIN MEMORY'));
      card.append(node('h4','',note==='guest'?'Connect Deriv to save lessons':'Memory store unavailable'));
      card.append(node('p','',note==='guest'?'Connect your Deriv account to teach and keep your Brain lessons.':'Could not load your saved lessons. Try again in a moment.'));
      if(note==='migration')card.append(node('p','brain-task-migration','Supabase memory tables need to be enabled before lessons can be saved.'));
      host.append(card);return;
    }
    const insights=data.insights||[],progress=data.progress||{total:0,reviewed:0,matched:0,unmatched:0,patterns:0,xp:0,level:1,levelXp:0,linkedWins:0};
    const card=node('section','brain-review-card');
    card.append(makeForm(Array.isArray(data.trades)?data.trades:[]));
    const status=node('p','brain-contribution-status',note);
    status.id='brainTaskStatus';status.setAttribute('role','status');status.setAttribute('aria-live','polite');card.append(status);
    const memories=node('details','brain-review-details');
    memories.append(node('summary','','Saved lessons · '+insights.length),renderInsights(insights,data.trades));card.append(memories);
    const practice=node('details','brain-review-details brain-review-practice');
    practice.append(node('summary','','Practice snapshot'));
    const evidence=node('div','brain-review-evidence');evidence.id='brainEvidenceSlot';practice.append(evidence);card.append(practice);
    host.append(card);
  }
  async function load() {
    if(document.hidden) return;
    if(loading) { reloadQueued=true; return; }
    loading=true;
    const requestedAccount=recentTradeAccount;
    try {
      const response=await request('/api/ranger-brain/contributions');
      if(requestedAccount!==recentTradeAccount) return;
      const freshTrades=Array.isArray(response.trades)?response.trades:[];
      const arrived=seenMemoryTradeIds && freshTrades.some(trade=>!seenMemoryTradeIds.has(String(trade.id)));
      seenMemoryTradeIds=new Set(freshTrades.map(trade=>String(trade.id)));
      if(arrived) { if(!formDirty)preferredTradeId=null; showTradeSync('Trade added to Memories · gathering prices'); }
      state=response;
      document.dispatchEvent(new CustomEvent('brain:lessons-updated',{detail:{insights:Array.isArray(response.insights)?response.insights:[]}}));
      renderUnlockHero(response);
      syncHudTask(response.progress || null, response.insights || [], false);
      const growthCard = $('brainGrowthCard');
      if (growthCard) updateMemoryGrowth(growthCard, response);
      if(response.markets?.length) {
        try {
          const market=typeof lastRoomState!=='undefined'&&lastRoomState?lastRoomState.selected:'';
          if(market) response.markets.sort((a,b)=>a.symbol===market?-1:b.symbol===market?1:a.name.localeCompare(b.name));
        } catch {}
      }
      if(formDirty) {
        const form=host.querySelector('#brainInsightForm');
        if(typeof form?.refreshTradeChoices==='function') form.refreshTradeChoices(response.trades);
        // The server can finish gathering entry ticks while the player is
        // reviewing a trade. Refresh only its snapshot, never the form fields.
        const selectedId=host.querySelector('[name="sourceTradeId"]')?.value;
        const trade=Array.isArray(response.trades) ? response.trades.find(item=>String(item.id)===String(selectedId)) : null;
        const detail=host.querySelector('.brain-review-selected');
        if(trade && detail) {
          const signature=JSON.stringify([trade.id,trade.status,trade.profit,trade.askPrice,trade.payout,trade.context]);
          if(detail.dataset.snapshotSignature!==signature) {
            const openStates=Array.from(detail.querySelectorAll('details'),item=>item.open);
            detail.replaceChildren(tradeDetail(trade));
            detail.querySelectorAll('details').forEach((item,index)=>{item.open=Boolean(openStates[index]);});
            detail.dataset.snapshotSignature=signature;
            detail.classList.remove('brain-snapshot-updated');
            void detail.offsetWidth;
            detail.classList.add('brain-snapshot-updated');
          }
        }
        return;
      }
      render();
      if (awaitingGrowthLessonId && Array.isArray(response.insights) && response.insights.some(item => String(item.id) === awaitingGrowthLessonId)) {
        awaitingGrowthLessonId = null;
        const card = $('brainGrowthCard');
        if (card) {
          card.classList.remove('brain-growth-celebrate');
          void card.offsetWidth;
          card.classList.add('brain-growth-celebrate');
          clearTimeout(growthCelebrationTimer);
          growthCelebrationTimer = setTimeout(() => card.classList.remove('brain-growth-celebrate'), 1800);
        }
      }
    } catch(error) {
      // A transient refresh must not erase an unsaved lesson.
      if(formDirty) return;
      state=null;
      note=error.status===401?'guest':error.status===503?'migration':'error';
      renderUnlockHero(null);
      render();
    } finally {
      loading=false;
      if(reloadQueued) { reloadQueued=false; setTimeout(load,250); }
    }
  }

  function syncBanner() {
    let banner=$('brainTradeSync');
    if(!banner) {
      banner=node('div','brain-trade-sync'); banner.id='brainTradeSync'; banner.setAttribute('role','status'); banner.setAttribute('aria-live','polite'); banner.hidden=true;
      const dot=node('span','brain-trade-sync-dot'); dot.setAttribute('aria-hidden','true');
      const message=node('span','brain-trade-sync-text'); banner.append(dot,message);
      host.before(banner);
    }
    return banner;
  }
  function showTradeSync(message) {
    const banner=syncBanner(); banner.querySelector('.brain-trade-sync-text').textContent=message; banner.hidden=false;
    clearTimeout(pendingAnimationTimer);
    pendingAnimationTimer=setTimeout(()=>{ banner.hidden=true; },35000);
  }
  function scheduleTradeRefresh(message) {
    showTradeSync(message);
    for(const timer of refreshTimers) clearTimeout(timer);
    refreshTimers=[];
    // Entry and exit prices arrive after settlement. Bound retries to this trade
    // event so market ticks never trigger additional requests.
    for(const delay of [300,1800,5000,12000,22000,34000]) {
      refreshTimers.push(setTimeout(()=>{ if(!document.hidden) void load(); },delay));
    }
  }
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin || event.source!==parent) return;
    const message=event.data;
    if(message?.type==='zeronine:room-trade-result' && message.ok===true && message.phase!=='review' && message.confirmedTradeId) {
      scheduleTradeRefresh('Trade placed · waiting for its result');
      return;
    }
    if(message?.type!=='zeronine:room-state') return;
    const account=String(message.state?.accountId||'');
    const trades=Array.isArray(message.state?.trades) ? message.state.trades : [];
    const signature=JSON.stringify(trades.map(trade=>[String(trade.id),String(trade.status||'')]));
    if(account!==recentTradeAccount) {
      const hadAccount=recentTradeAccount!==null;
      recentTradeAccount=account; recentTradeSignature=signature; seenMemoryTradeIds=null; lastGrowthTradeCount=null;
      document.dispatchEvent(new CustomEvent('brain:lessons-updated',{detail:{insights:[]}}));
      awaitingGrowthLessonId=null; clearTimeout(growthCelebrationTimer); $('brainGrowthCard')?.classList.remove('brain-growth-celebrate');
      for(const timer of refreshTimers) clearTimeout(timer); refreshTimers=[];
      clearTimeout(pendingAnimationTimer); const banner=$('brainTradeSync'); if(banner)banner.hidden=true;
      preferredTradeId=null;
      if(hadAccount) {
        // A draft belongs to the prior Deriv account and must not cross accounts.
        formDirty=false; state=null; note=account?'':'guest'; render();
      }
      void load();
      return;
    }
    if(recentTradeSignature===null) { recentTradeSignature=signature; return; }
    if(signature===recentTradeSignature) return;
    let previous=[];
    try { previous=JSON.parse(recentTradeSignature); } catch {}
    const old=new Map(previous);
    recentTradeSignature=signature;
    const changes=trades.filter(trade=>old.get(String(trade.id))!==String(trade.status||''));
    if(!changes.length)return;
    const settled=changes.some(trade=>['won','lost'].includes(String(trade.status||'').toLowerCase()));
    scheduleTradeRefresh(settled?'Adding trade to Memories · gathering prices':'Trade placed · waiting for its result');
  });

  document.addEventListener('zeronine:brain-mode-change',()=>renderUnlockHero(state));
  document.getElementById('brainTabMemory')?.addEventListener('click',()=>setTimeout(load,100));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
  document.addEventListener('zeronine:brain-report',()=>load());
  setInterval(()=>{if(!$('brainPaneMemory')?.hidden)load();},30000);
  load();
})();
