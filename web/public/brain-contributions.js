(() => {
  'use strict';
  const host = document.getElementById('brainContributionApp');
  if (!host || window.__brainContributionTasksV1) return;
  window.__brainContributionTasksV1 = true;
  const $ = id => document.getElementById(id);
  const svgNs = 'http://www.w3.org/2000/svg';
  let state = null, loading = false, note = '', formDirty = false;
  const sheet=document.createElement('style');
  sheet.textContent=`
    .brain-review-card{background:#fff8e9;border:1px solid #d2b88c;border-radius:16px;padding:16px;color:#3d3022;display:grid;gap:14px}
    .brain-review-overview{display:grid;grid-template-columns:minmax(90px,130px) 1fr;align-items:center;gap:12px}
    .brain-review-network svg{display:block;width:100%;height:auto}.brain-review-summary h3{margin:4px 0;color:#294f34;font-size:22px}.brain-review-summary strong{color:#285638}.brain-review-metrics{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.brain-review-metrics span{padding:4px 7px;background:#e7efdc;border-radius:6px;font-size:11px;font-weight:750;color:#31583d}
    .brain-review-form h4{margin:0 0 9px;color:#294f34;font-size:16px}.brain-review-fields{display:grid;gap:10px}.brain-review-trades{display:grid;gap:6px;max-height:200px;overflow:auto}.brain-review-trade{display:flex;align-items:center;gap:9px;width:100%;padding:9px;border:1px solid #decaa8;border-radius:9px;background:#fffdf5;color:#3d3022;text-align:left;cursor:pointer}.brain-review-trade[aria-pressed=true]{border:2px solid #388553;background:#e9f4e5}.brain-review-result{display:grid;place-items:center;width:27px;height:27px;border-radius:50%;background:#e8c9be;color:#8a302c;font-weight:900}.brain-review-trade[data-result=won] .brain-review-result{background:#cee9cd;color:#25713d}.brain-review-trade-copy{display:grid;gap:2px;flex:1;min-width:0}.brain-review-trade-copy small{color:#776b5a}.brain-review-trade strong{color:#31583d}.brain-review-label{display:grid;gap:5px;font-size:12px;font-weight:800}.brain-review-label textarea,.brain-review-label select{width:100%;min-width:0;padding:9px;border:1px solid #c8b08c;border-radius:8px;background:#fffdf7;color:#30291f;font:inherit}.brain-review-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}.brain-review-save{width:100%}.brain-review-details{border-top:1px solid #e2d2b9;padding-top:10px}.brain-review-details summary{cursor:pointer;font-weight:800;color:#31583d}.brain-review-evidence:empty{display:none}.brain-evidence-compact{border-top:1px solid #e2d2b9;padding-top:10px}.brain-evidence-compact__top{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:800;color:#31583d}.brain-evidence-compact__stats{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.brain-evidence-compact__stats>*{background:#e7efdc;border-radius:6px;padding:5px 7px;color:#31583d;font-size:11px}.brain-evidence-compact__details{font-size:12px;color:#665a48}.brain-review-empty{font-size:13px;color:#665a48}

    .brain-goals{background:#eaf2df;border-radius:10px;padding:11px;display:grid;gap:7px;color:#234c32}.brain-goals h4{font-size:14px;margin:0}.brain-goals-list{display:grid;gap:6px}.brain-goal{display:grid;grid-template-columns:1fr auto;gap:4px;font-size:12px;font-weight:750}.brain-goal progress{grid-column:1/-1;width:100%;height:6px;accent-color:#438659}.brain-goals button{justify-self:start;border:0;border-radius:7px;background:#245d39;color:#fff;padding:7px 10px;font:700 12px system-ui;cursor:pointer}.brain-review-stance{display:flex;gap:7px;margin:0;padding:0;border:0}.brain-review-stance legend{font-size:12px;font-weight:800;margin-bottom:5px}.brain-review-stance label{flex:1;display:flex;align-items:center;gap:5px;padding:9px;border:1px solid #c8b08c;border-radius:8px;background:#fffdf7;font-size:12px;font-weight:750}.brain-review-stance input{accent-color:#28794f}
  `;document.head.append(sheet);


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

  function makeForm(trades) {
    const card = node('section','brain-review-form');
    card.append(node('h4','','Teach from a trade'));
    if (!trades.length) {
      card.append(node('p','brain-review-empty','Your settled trades will appear here. Choose one to teach the Brain what you noticed.'));
      return card;
    }
    const form=node('form','brain-review-fields'); form.id='brainInsightForm';
    const choices=node('div','brain-review-trades');
    const selected=node('input',''); selected.type='hidden'; selected.name='sourceTradeId'; form.append(selected);
    trades.slice(0,12).forEach((trade,index)=>{
      const button=node('button','brain-review-trade'); button.type='button';
      const result=String(trade.status||'').toLowerCase();
      button.dataset.result=result;
      const when=trade.settledAt||trade.createdAt;
      const date=when?new Date(when):null;
      const dateLabel=date&&!Number.isNaN(date.getTime())?date.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'';
      const profit=Number(trade.profit);
      button.append(node('span','brain-review-result',result==='won'?'✓':'×'));
      const copy=node('span','brain-review-trade-copy');
      copy.append(node('b','',String(trade.marketName||trade.marketSymbol||'Market')+' · '+(String(trade.direction||'').toLowerCase()==='over'?'Over ':'Under ')+trade.barrier),node('small','',dateLabel));
      button.append(copy,node('strong','',Number.isFinite(profit)?(profit>=0?'+':'')+profit.toFixed(2):result.toUpperCase()));
      button.addEventListener('click',()=>{selected.value=String(trade.id);choices.querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));formDirty=true});
      choices.append(button);
      if(index===0){selected.value=String(trade.id);button.setAttribute('aria-pressed','true')}else button.setAttribute('aria-pressed','false');
    });
    form.append(choices);
    const topic=node('label','brain-review-label','What did you notice?');
    const observation=node('textarea','');observation.name='observation';observation.rows=2;observation.minLength=8;observation.maxLength=500;observation.required=true;observation.placeholder='What made this trade look good or risky?';topic.append(observation);form.append(topic);
    const stance=node('fieldset','brain-review-stance');
    stance.append(node('legend','','What did this tell you?'));
    [['good','Good sign'],['warning','Warning']].forEach(([value,label])=>{
      const choice=node('label','');const input=node('input','');input.type='radio';input.name='stance';input.value=value;input.required=true;
      choice.append(input,node('span','',label));stance.append(choice);
    });
    form.append(stance);
    const row=node('div','brain-review-row');
    const categoryLabel=node('label','brain-review-label','Your observation');
    const category=node('select','');category.name='category';
    [['setup','Pattern'],['market_behavior','Market movement'],['entry_timing','Entry timing'],['risk','Risk or warning']].forEach(([value,label])=>option(category,value,label));categoryLabel.append(category);
    const confidenceLabel=node('label','brain-review-label','Your confidence');
    const confidence=node('select','');confidence.name='confidence';for(let n=1;n<=5;n++)option(confidence,String(n),n+' / 5');confidence.value='3';confidenceLabel.append(confidence);
    row.append(categoryLabel,confidenceLabel);form.append(row);
    const horizon=node('input','');horizon.type='hidden';horizon.name='horizon';horizon.value='next_session';form.append(horizon);
    const submit=node('button','brain-task-primary brain-review-save','Save lesson');submit.type='submit';form.append(submit);
    form.addEventListener('input',()=>{formDirty=true});form.addEventListener('change',()=>{formDirty=true});form.addEventListener('submit',submitInsight);
    card.append(form);return card;
  }

  async function submitInsight(event) {
    event.preventDefault();
    const form=event.currentTarget, data=new FormData(form), submit=form.querySelector('button[type="submit"]');
    if(!data.get('sourceTradeId')){setMessage('Choose a settled trade first.','bad');return;}
    submit.disabled=true;submit.textContent='Saving…';setMessage('Saving your lesson…','busy');
    try {
      await request('/api/ranger-brain/contributions',{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({
        sourceTradeId:String(data.get('sourceTradeId')),category:data.get('category'),observation:data.get('observation'),stance:data.get('stance'),
        confidence:Number(data.get('confidence')),horizon:data.get('horizon')
      })});
      note='Lesson saved';formDirty=false;await load();setMessage(note,'good');
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

  function renderInsights(insights) {
    const section=node('section','brain-task-insights');
    section.setAttribute('aria-labelledby','brainTaskMemoryTitle');
    const head=node('div','brain-task-section-head brain-task-memory-head');
    const title=node('h4','','Saved lessons'); title.id='brainTaskMemoryTitle';
    const count=node('span','brain-task-memory-count',String(insights.length)+' stored');
    head.append(title,count);
    section.append(head);
    if(!insights.length){
      const empty=node('div','brain-task-memory-empty');
      empty.append(node('span','brain-task-empty-network','✦'));
      const copy=node('div',''); copy.append(node('strong','','Your Brain store is empty'),node('small','','Add a lesson above. It will appear here as a connected memory.'));
      const teach=node('button','brain-task-empty-action','Teach a lesson'); teach.type='button';
      teach.addEventListener('click',openTeachingTask);
      empty.append(copy,teach); section.append(empty); return section;
    }
    const list=node('div','brain-task-memory-grid');
    for(const insight of insights.slice(0,24)){
      const card=node('details','brain-task-memory-card'); card.dataset.result=insight.outcome||'pending';
      const summary=node('summary','brain-task-memory-summary');
      const mark=node('span','brain-task-memory-mark',insight.outcome==='matched'?'✓':insight.outcome==='unmatched'?'×':'•');
      const copy=node('span','brain-task-memory-copy');
      copy.append(node('b','',insight.marketName+' · '+directionLabel(insight)));
      copy.append(node('small','',insight.category||'Market lesson'));
      const badge=node('em','brain-task-memory-result',insight.outcome==='matched'?'SIMILAR WIN':insight.outcome==='unmatched'?'SIMILAR LOSS':'WAITING');
      summary.append(mark,copy,badge); card.append(summary);
      const detail=node('div','brain-task-memory-detail');
      detail.append(node('p','',String(insight.observation || '').replace(/\n\[Trade reference: [^\]]+\]$/, '')));
      const status=insight.outcome==='matched'?'+25 XP · Your call matched a settled win':insight.outcome==='unmatched'?'−20 XP · A settled result challenged this call':insight.expectedDirection==='none'?'+10 XP · Observation saved':'Waiting for a matching settled result';
      const similar=Number(insight.similarTrades)||0;
      detail.append(node('strong','',similar ? (Number(insight.similarWins)||0)+' wins · '+(Number(insight.similarLosses)||0)+' losses in similar trades' : 'Waiting for similar trades'));
      if(insight.stance)detail.append(node('small','',insight.stance==='warning'?'Your note: warning':'Your note: good sign'));
      const when=insight.createdAt?new Date(insight.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';
      detail.append(node('small','',when+(insight.confidence?' · Confidence '+insight.confidence+'/5':'')));
      card.append(detail); list.append(card);
    }
    section.append(list);
    if(insights.length>24) section.append(node('small','brain-task-memory-more',(insights.length-24)+' older lessons are stored in your Brain.'));
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

  function syncHudTask(progress, insights, guest) {
    const card = $('missionHud');
    const title = $('missionTitle');
    const count = $('missionProgress');
    if (!card || !title || !count) return;
    const label = card.querySelector('.mission-copy small');
    if (label && label.textContent !== 'BRAIN TASK') label.textContent = 'BRAIN TASK';
    const pending = insights.filter(item => item.expectedDirection !== 'none' && item.outcome === 'pending').length;
    if (guest) {
      if (title.textContent !== 'Connect to teach') title.textContent = 'Connect to teach';
      if (count.textContent !== 'OPEN BRAIN') count.textContent = 'OPEN BRAIN';
    } else if (!progress) {
      if (title.textContent !== 'Brain task unavailable') title.textContent = 'Brain task unavailable';
      if (count.textContent !== 'RETRY') count.textContent = 'RETRY';
    } else if (progress.total === 0) {
      if (title.textContent !== 'Teach your first lesson') title.textContent = 'Teach your first lesson';
      if (count.textContent !== '0 / 1') count.textContent = '0 / 1';
    } else if (pending > 0) {
      if (title.textContent !== 'Check a lesson') title.textContent = 'Check a lesson';
      if (count.textContent !== pending + ' TO CHECK') count.textContent = pending + ' TO CHECK';
    } else if (progress.linkedWins > 0) {
      if (title.textContent !== 'Build on your insight') title.textContent = 'Build on your insight';
      if (count.textContent !== progress.linkedWins + ' WINS') count.textContent = progress.linkedWins + ' WINS';
    } else {
      if (title.textContent !== 'Teach another lesson') title.textContent = 'Teach another lesson';
      if (count.textContent !== progress.total + ' SAVED') count.textContent = progress.total + ' SAVED';
    }
    card.setAttribute('aria-label', 'Brain task: ' + title.textContent + '. ' + count.textContent + '. Open Brain Tasks.');
  }

  const missionHud = $('missionHud');
  if (missionHud) {
    missionHud.addEventListener('click', () => {
      const menu = window.__zeronineBrainMenu;
      if (menu && typeof menu.open === 'function') menu.open();
      else $('rangerBrainGlyph')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      setTimeout(() => $('brainTabMemory')?.click(), 80);
    });
    const title = $('missionTitle'), count = $('missionProgress');
    if (title && count && typeof MutationObserver === 'function') {
      new MutationObserver(() => syncHudTask(state?.progress || null, state?.insights || [], note === 'guest'))
        .observe(title.parentElement, { childList: true, subtree: true, characterData: true });
      new MutationObserver(() => syncHudTask(state?.progress || null, state?.insights || [], note === 'guest'))
        .observe(count, { childList: true, subtree: true, characterData: true });
    }
  }

  function renderMainGrowth(data) {
    const card = $('brainGrowthCard');
    if (!card) return;
    const progress = data?.progress || { level: 1, xp: 0, levelXp: 0, linkedWins: 0, total: 0 };
    const insights = Array.isArray(data?.insights) ? data.insights : [];
    const wins = insights.filter(item => item.outcome === 'matched').length;
    const losses = insights.filter(item => item.outcome === 'unmatched').length;
    const waiting = insights.filter(item => item.expectedDirection !== 'none' && item.outcome === 'pending').length;
    const level = Number(progress.level) || 1, xp = Number(progress.xp) || 0, levelXp = Math.max(0, Math.min(100, Number(progress.levelXp) || 0));
    card.dataset.state = data ? (waiting ? 'waiting' : wins ? 'growing' : 'learning') : note === 'guest' ? 'guest' : 'offline';
    $('brainGrowthLevel').textContent = 'LV ' + level;
    $('brainGrowthXP').textContent = xp + ' XP';
    $('brainGrowthNext').textContent = levelXp + ' / 100 XP to Level ' + (level + 1);
    $('brainGrowthProgress').setAttribute('aria-valuenow', String(levelXp));
    $('brainGrowthFill').style.width = levelXp + '%';
    $('brainGrowthWins').textContent = String(wins);
    $('brainGrowthLosses').textContent = String(losses);
    $('brainGrowthWaiting').textContent = String(waiting);
    $('brainGrowthLessons').textContent = String(Number(progress.total) || 0);
    $('brainGrowthText').textContent = !data
      ? note === 'guest' ? 'Connect Deriv to save lessons to your Ranger Brain.' : 'The Brain could not load its saved lessons. Try again in a moment.'
      : waiting ? waiting + ' lesson' + (waiting === 1 ? ' is' : 's are') + ' waiting for matching settled results.'
        : wins || losses ? 'See how later similar trades turned out.'
          : progress.total ? 'Your lessons are saved. Later similar trades will appear with them.'
            : 'Teach it what you notice. Follow later similar trades.';
    const feed = $('brainGrowthActivity');
    feed.replaceChildren();
    if (!insights.length) {
      const empty = node('li', 'is-empty', data ? 'No lessons yet. Add one and start the Brain’s growth.' : 'Connect Deriv to begin a private lesson trail.');
      feed.append(empty);
    } else {
      for (const insight of insights.slice(0, 3)) {
        const row = node('li', '');
        row.dataset.result = insight.outcome || 'pending';
        const mark = node('span', 'brain-growth-mark', insight.outcome === 'matched' ? '✓' : insight.outcome === 'unmatched' ? '×' : '·');
        const copy = node('span', 'brain-growth-outcome');
        copy.append(node('b', '', insight.marketName + ' · ' + directionLabel(insight)));
        copy.append(node('small', '', String(insight.observation || '').replace(/\n\[Trade reference: [^\]]+\]$/, '').slice(0, 110)));
        const status = node('strong', '', insight.outcome === 'matched' ? 'Similar trade won' : insight.outcome === 'unmatched' ? 'Similar trade lost' : insight.expectedDirection === 'none' ? 'Lesson saved · +10 XP' : 'Waiting for a result');
        row.append(mark, copy, status);
        feed.append(row);
      }
    }
    const teach = $('brainGrowthTeach');
    if (teach) teach.textContent = note === 'guest' ? 'Connect Deriv to teach' : 'Teach the Brain a lesson';
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
    const card=node('section','brain-goals');
    const unlocked=training?.unlocked === true;
    card.append(node('h4','',unlocked?'Brain suggestions unlocked':'Unlock Brain suggestions'));
    const list=node('div','brain-goals-list');
    const goals=Array.isArray(training?.goals)?training.goals:[];
    if (!goals.length) {
      card.append(node('small','','Training progress is unavailable right now.'));
      return card;
    }
    for(const goal of goals){
      const row=node('div','brain-goal');
      const current=Math.max(0,Number(goal.current)||0),target=Math.max(1,Number(goal.target)||1);
      const label=goal.key==='lessons'?'Teach from your trades':goal.key==='trades'?'See similar trades settle':String(goal.label||'Training');
      row.append(node('span','',label),node('strong','',Math.min(current,target)+' / '+target));
      const bar=node('progress','');bar.max=target;bar.value=Math.min(current,target);bar.setAttribute('aria-label',label);row.append(bar);list.append(row);
    }
    card.append(list);
    if(!unlocked){const action=node('button','','Teach a lesson');action.type='button';action.addEventListener('click',()=>{const field=$('brainInsightForm')?.querySelector('textarea');field?.scrollIntoView({behavior:'smooth',block:'center'});field?.focus({preventScroll:true})});card.append(action)}
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
    const overview=node('div','brain-review-overview');
    const visual=node('div','brain-review-network');visual.append(drawNetwork(insights));
    const copy=node('div','brain-review-summary');
    copy.append(node('span','brain-task-eyebrow','YOUR BRAIN'),node('h3','','Teach & memories'));
    copy.append(node('strong','','Level '+progress.level+' · '+progress.xp+' XP'));
    const metrics=node('div','brain-review-metrics');
    metrics.append(node('span','',insights.length+' lessons'),node('span','',insights.filter(item=>item.outcome==='pending').length+' waiting'),node('span','',progress.linkedWins+' similar wins'));
    copy.append(metrics);overview.append(visual,copy);card.append(overview);
    card.append(renderTraining(data.training));
    card.append(makeForm(Array.isArray(data.trades)?data.trades:[]));
    const status=node('p','brain-contribution-status',note);
    status.id='brainTaskStatus';status.setAttribute('role','status');status.setAttribute('aria-live','polite');card.append(status);
    const memories=node('details','brain-review-details');
    memories.append(node('summary','','Saved lessons · '+insights.length),renderInsights(insights));card.append(memories);
    const evidence=node('div','brain-review-evidence');evidence.id='brainEvidenceSlot';card.append(evidence);
    host.append(card);
  }
  async function load() {
    if(loading || document.hidden || formDirty) return;
    loading=true;
    try {
      const response=await request('/api/ranger-brain/contributions');
      state=response;
      if(response.markets?.length) {
        try {
          const market=typeof lastRoomState!=='undefined'&&lastRoomState?lastRoomState.selected:'';
          if(market) response.markets.sort((a,b)=>a.symbol===market?-1:b.symbol===market?1:a.name.localeCompare(b.name));
        } catch {}
      }
      render();
    } catch(error) {
      state=null;
      note=error.status===401?'guest':error.status===503?'migration':'error';
      render();
    } finally {loading=false;}
  }

  document.getElementById('brainTabMemory')?.addEventListener('click',()=>setTimeout(load,100));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
  document.addEventListener('zeronine:brain-report',()=>load());
  setInterval(()=>{if(!$('brainPaneMemory')?.hidden)load();},30000);
  load();
})();