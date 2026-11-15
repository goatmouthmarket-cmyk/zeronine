(() => {
  'use strict';
  const host = document.getElementById('brainContributionApp');
  if (!host || window.__brainContributionTasksV1) return;
  window.__brainContributionTasksV1 = true;
  const $ = id => document.getElementById(id);
  const svgNs = 'http://www.w3.org/2000/svg';
  let state = null, loading = false, note = '';

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

  function makeForm(markets) {
    const card = node('section', 'brain-task-form-card');
    card.setAttribute('aria-labelledby', 'brainTaskFormTitle');
    const head = node('div', 'brain-task-section-head');
    head.append(node('span','brain-task-eyebrow','YOUR NEXT TASK'));
    head.append(node('h4','','Teach the Brain one thing you noticed'));
    head.append(node('p','','Write what you saw and what you think may happen. Your note stays tied to this Deriv account.'));
    card.append(head);

    const form = node('form','brain-task-form');
    form.id = 'brainInsightForm';
    const marketLabel = node('label','brain-task-field','Market');
    const market = node('select',''); market.id='brainInsightMarket'; market.name='marketSymbol'; market.required=true;
    option(market,'','Choose a market');
    const current = typeof lastRoomState !== 'undefined' && lastRoomState ? lastRoomState.selected : '';
    for (const item of markets) {
      const label = node('option','',item.name || 'Market');
      label.value = item.symbol;
      if (item.symbol === current) label.selected = true;
      market.append(label);
    }
    marketLabel.append(market); form.append(marketLabel);

    const categoryLabel = node('label','brain-task-field','What kind of lesson is this?');
    const category = node('select',''); category.name='category'; category.required=true;
    option(category,'setup','A setup I noticed');
    option(category,'market_behavior','How this market moves');
    option(category,'entry_timing','When I would enter');
    option(category,'risk','A risk or warning sign');
    categoryLabel.append(category); form.append(categoryLabel);

    const observationLabel = node('label','brain-task-field brain-task-field-wide','What did you notice?');
    const observation = node('textarea',''); observation.name='observation'; observation.rows=3; observation.maxLength=500; observation.minLength=8; observation.required=true;
    observation.placeholder='Example: after several small digits, I often see a larger digit within the next few ticks.';
    observationLabel.append(observation); form.append(observationLabel);

    const predictionRow = node('div','brain-task-prediction-row');
    const directionLabelEl = node('label','brain-task-field','Your idea');
    const direction = node('select',''); direction.id='brainInsightDirection'; direction.name='expectedDirection'; direction.required=true;
    option(direction,'over','Over a digit');
    option(direction,'under','Under a digit');
    option(direction,'none','Observation only');
    directionLabelEl.append(direction); predictionRow.append(directionLabelEl);
    const barrierLabel = node('label','brain-task-field','Target digit');
    const barrier = node('select',''); barrier.id='brainInsightBarrier'; barrier.name='barrier';
    for(let n=0;n<=9;n++) option(barrier,String(n),String(n));
    barrierLabel.append(barrier); predictionRow.append(barrierLabel);
    const horizonLabel = node('label','brain-task-field','Check within');
    const horizon = node('select',''); horizon.name='horizon';
    option(horizon,'next_5','5 minutes');
    option(horizon,'next_20','20 minutes');
    option(horizon,'next_session','12 hours');
    horizonLabel.append(horizon); predictionRow.append(horizonLabel);
    form.append(predictionRow);

    const confidenceField = node('fieldset','brain-task-confidence');
    confidenceField.append(node('legend','','How sure are you?'));
    const confidence = node('div','brain-task-confidence-options');
    for(let n=1;n<=5;n++){
      const label=node('label','');
      const input=node('input',''); input.type='radio'; input.name='confidence'; input.value=String(n); input.required=n===1; input.checked=n===3;
      label.append(input,node('span','',String(n)));
      confidence.append(label);
    }
    confidenceField.append(confidence); form.append(confidenceField);
    const help=node('small','brain-task-form-help','Only a later settled trade on this market and exact Over/Under digit can test your idea. Never place a bet to earn points.');
    form.append(help);
    const submit=node('button','brain-task-primary','Save this lesson · +10 XP'); submit.type='submit';
    form.append(submit);
    form.addEventListener('submit', submitInsight);
    direction.addEventListener('change',()=>{ const off=direction.value==='none'; barrier.disabled=off; barrierLabel.hidden=off; });
    direction.dispatchEvent(new Event('change'));
    card.append(form);
    return card;
  }

  async function submitInsight(event) {
    event.preventDefault();
    const form=event.currentTarget;
    const data=new FormData(form);
    const direction=String(data.get('expectedDirection'));
    const submit=form.querySelector('button[type="submit"]');
    submit.disabled=true; submit.textContent='Saving to your Brain…';
    setMessage('Saving your lesson securely to Supabase…','busy');
    try {
      const result=await request('/api/ranger-brain/contributions',{
        method:'POST',
        headers:{'content-type':'application/json',accept:'application/json'},
        body:JSON.stringify({
          marketSymbol:data.get('marketSymbol'),
          category:data.get('category'),
          observation:data.get('observation'),
          expectedDirection:direction,
          barrier:direction==='none'?null:Number(data.get('barrier')),
          horizon:data.get('horizon'),
          confidence:Number(data.get('confidence'))
        })
      });
      note='Lesson saved in your Brain · +10 XP';
      await load();
      setMessage(note,'good');
    } catch(error) {
      setMessage(error.message || 'The Brain could not save your note. It was not saved.','bad');
      submit.disabled=false; submit.textContent='Save this lesson · +10 XP';
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
    const head=node('div','brain-task-section-head');
    head.append(node('span','brain-task-eyebrow','MEMORY TRAIL'));
    head.append(node('h4','','Your lessons'));
    section.append(head);
    if(!insights.length){ section.append(node('p','brain-contribution-empty','No lessons yet. Your first saved idea will appear here and add a new connection to the Brain.')); return section; }
    const list=node('ol','brain-task-list');
    for(const insight of insights.slice(0,12)){
      const item=node('li','brain-task-memory'); item.dataset.result=insight.outcome;
      const mark=node('span','brain-task-memory-mark',insight.outcome==='matched'?'✓':insight.outcome==='unmatched'?'↗':'•');
      const copy=node('div','brain-task-memory-copy');
      const title=node('b','',insight.marketName+' · '+directionLabel(insight));
      const description=node('p','',insight.observation);
      const meta=node('small','',new Date(insight.createdAt).toLocaleString()+' · '+insight.confidence+'/5 confidence · '+(insight.horizon==='next_5'?'5 min':insight.horizon==='next_20'?'20 min':'12 hours'));
      const status=node('em','',insight.outcome==='matched'?'Matched a later settled win · +25 XP':insight.outcome==='unmatched'?'Matching settled loss · −20 XP':insight.expectedDirection==='none'?'Saved human observation · +10 XP':'Waiting for a later matching settled trade');
      copy.append(title,description,meta,status);
      item.append(mark,copy);
      list.append(item);
    }
    section.append(list);
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
        : wins || losses ? 'Your settled results are strengthening or correcting the lessons you taught.'
          : progress.total ? 'Your lessons are saved. A matching settled trade will test each prediction.'
            : 'Teach it what you notice. A later settled result will show whether your lesson helped.';
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
        copy.append(node('small', '', String(insight.observation || '').slice(0, 110)));
        const status = node('strong', '', insight.outcome === 'matched' ? 'Good call · +25 XP' : insight.outcome === 'unmatched' ? 'Missed call · −20 XP' : insight.expectedDirection === 'none' ? 'Lesson saved · +10 XP' : 'Waiting for a result');
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
        form.querySelector('textarea')?.focus({ preventScroll: true });
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

  function render() {
    host.replaceChildren();
    const data=state;
    syncHudTask(data?.progress || null, data?.insights || [], note === 'guest');
    renderMainGrowth(data);
    if(!data){
      const card=node('section','brain-task-login');
      card.append(node('span','brain-task-eyebrow','PERSONAL BRAIN TASKS'));
      card.append(node('h4','',note==='guest'?'Connect Deriv to start teaching':'Brain tasks are temporarily unavailable'));
      card.append(node('p','',note==='guest'?'Sign in to save your lessons to your Deriv-linked Brain and appear on the private-memory leaderboard.':'Your notes are never shown as saved until Supabase confirms them. Try again in a moment.'));
      if(note==='migration') card.append(node('p','brain-task-migration','The Brain memory tables need the Supabase migration before this feature can save contributions.'));
      host.append(card);
      return;
    }
    const insights=data.insights||[], progress=data.progress||{total:0,reviewed:0,matched:0,unmatched:0,patterns:0,xp:0,level:1,levelXp:0,linkedWins:0};
    host.append(renderProgress(progress,insights));
    host.append(renderTasks(progress,insights));
    host.append(renderCombinedRead(data));
    const action=node('button','brain-task-primary brain-task-open','Teach the Brain a lesson · +10 XP');
    action.type='button'; action.addEventListener('click',()=>{const form=$('brainInsightForm');form.hidden=!form.hidden;if(!form.hidden)form.querySelector('textarea').focus();});
    host.append(action);
    const form=makeForm(data.markets||[]); form.hidden=true; host.append(form);
    host.append(node('p','brain-contribution-status',note)); host.lastChild.id='brainTaskStatus'; host.lastChild.setAttribute('role','status'); host.lastChild.setAttribute('aria-live','polite');
    host.append(renderInsights(insights));
    host.append(renderLeaderboard(data.leaderboard||[]));
  }

  async function load() {
    if(loading || document.hidden) return;
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