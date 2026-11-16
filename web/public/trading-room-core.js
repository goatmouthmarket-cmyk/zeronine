(()=>{const report=(message)=>{let panel=document.getElementById('pasture-runtime-error');if(!panel){panel=document.createElement('div');panel.id='pasture-runtime-error';panel.setAttribute('role','alert');panel.style.cssText='position:fixed;z-index:2147483647;left:12px;right:12px;top:72px;padding:12px 14px;background:#fff1d1;color:#542a18;border:2px solid #c54b37;border-radius:8px;font:700 13px/1.4 system-ui,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;box-shadow:0 8px 28px #0008';(document.body||document.documentElement).append(panel)}panel.textContent='Pasture startup error: '+String(message||'Unknown error');try{parent.postMessage({type:'zeronine:room-runtime-error',message:String(message||'Unknown error')},location.origin)}catch{}};window.addEventListener('error',event=>{const file=String(event.filename||'');if(file&&!file.includes('trading-room-core.js')&&!file.includes('pasture-frame.html')&&!file.includes('trading-room.html'))return;report(event.message||'Pasture script failed')})})();

(()=>{'use strict';const canvas=document.querySelector('canvas'),$=id=>document.getElementById(id);let c=canvas.getContext('2d');let W=0,H=0,dpr=1;function resize(){dpr=Math.min(devicePixelRatio||1,2);W=innerWidth;H=innerHeight;canvas.width=W*dpr;canvas.height=H*dpr;c.setTransform(dpr,0,0,dpr,0,0)}addEventListener('resize',resize);resize();let zoom=innerWidth<=700?.85:1,zoomGoal=zoom;const spawnX=380+Math.random()*330,spawnY=390+Math.random()*240;const world={w:1300,h:850}, player={x:spawnX,y:spawnY,tx:spawnX,ty:spawnY,dir:0},cows=Array.from({length:8},(_,i)=>({x:190+i%4*225+Math.random()*70,y:170+Math.floor(i/4)*310+Math.random()*70,hp:4,max:4,alive:true,respawn:0,roam:0,tx:0,ty:0}));let lastToastText='',lastToastAt=0,lastRoomState=null,recoveryRecommendation=null,recoveryWinsEstimate=0,sessionRecovery={amount:0,planDebt:0,winsApplied:0,processed:[],cowTradeIds:[]};let target=null,hoverCow=null,hoverPoint=null,shots=[],fx=[],xp=0,kills=0,lastShot=0,bet=null,pending=null,lockUntil=0,toastTimer=0,lossCooldownStreak=0,attemptsSinceLoss=6,cooldownTradeId=null,cooldownAttemptRegistered=false,cooldownReason="MARKET",wins=0,losses=0,liveMarkets=[],attackCow=null,attackUntil=0,playerHp=3,ghost={x:780,y:650,target:null,lastShot:0,kills:0,bets:0,serverTrades:0};let ghostArrows=[],ghostCow=null,ghostTargetCow=null,ghostPaperState=null,ghostPaperInitialized=false,ghostPaperContractId=null,ghostPaperResultId=null,ghostPaperResultUntil=0,ghostLastTickSeq=0,ghostPatrol=null,ghostWalkPhase=0,ghostWalkDir=1,ghostRemote=null,rangerBet=null,rangerBubbleDismissed=false,knownTradeIds=new Set(),trackedTradeId=null,rangerBetSerial=0,betCurrency='USD',connectedAccount=false,activeAccountId=null;let aimStartedAt=0,aimLastProgressAt=0,lastCowClickAt=0,apiPingMs=null,derivPingMs=null,healthRequestActive=false,healthApiError='',healthIssue='',healthChecked=false,lastHealthCheckAt=0,roomHealth={owner:false,feed:{connected:false,pingMs:null},derivAccountConnected:false};let rangerAutoActive=false,rangerAutoServerOwned=false,rangerAutoServerState=null,rangerAutoServerVisualTarget=null,rangerAutoServerVisualConsumedId="",rangerAutoArmedUntil=0,rangerAutoArmBusy=false,rangerAutoReviewPending=false,rangerAutoProgress={key:null,lastSeq:-1,confirmations:0},rangerAutoStatus='Off',rangerAutoTradeIds=new Set(),rangerAutoRunTradeIds=new Set(),rangerAutoRunSettledTrades=new Map(),rangerAutoRunProfitTotal=0,rangerAutoRunId=0,rangerAutoMenuOpen=false,rangerAutoPatrolAt=0,brainAutoSnipe=false;let rangerAutoLossLimit=2,rangerAutoCooldownSeconds=45,rangerAutoTakeProfit=0,rangerAutoMaxRunLoss=0,rangerAutoLossStreak=0,rangerAutoMinEdge=0,rangerManualShots=3,rangerAutoShots=3,rangerPaperCount=20,rangerPaperWinTarget=55,rangerPaperEnabled=false,rangerRingGreen=true,rangerRingGold=true,rangerRingRed=true;const missionTypes=[{title:'Defeat 3 cows',goal:3,type:'kills'},{title:'Defeat 5 cows',goal:5,type:'kills'},{title:'Defeat 4 cows',goal:4,type:'kills'},{title:'Defeat 2 cows during a break',goal:2,type:'breakKills'}];let missionIndex=0,missionCount=0,lastLossAttackId=null,progressReady=false,pendingProgressEvents=[];function paintProgress(){const next=missionTypes[missionIndex%missionTypes.length];$("missionTitle").textContent=next.title;$("missionProgress").textContent=missionCount+" / "+next.goal;$("kills").textContent=kills;$("xptext").textContent=xp;$("nextLevelXp").textContent=150-(xp%150);$("lvl").textContent=1+Math.floor(xp/150);$("xpbar").style.width=`${xp%150/150*100}%`}function applySavedKill(duringBreak,quiet=true){kills++;xp+=25;const oldIndex=missionIndex;function step(type){const m=missionTypes[missionIndex%missionTypes.length];if(m.type!==type)return;missionCount++;if(missionCount>=m.goal){missionIndex++;missionCount=0;if(!quiet)notify("Mission complete! New mission ready.")}}step("kills");if(duringBreak)step("breakKills");paintProgress();return oldIndex!==missionIndex}let progressRetryTimer=0,progressLoading=false,progressSaving=false;
function scheduleProgressRetry(){if(!progressRetryTimer)progressRetryTimer=setTimeout(()=>{progressRetryTimer=0;if(progressReady)void flushProgressEvents();else void loadGameProgress()},5000)}
async function flushProgressEvents(){if(progressSaving||!progressReady)return;progressSaving=true;try{while(pendingProgressEvents.length){const ev=pendingProgressEvents[0],response=await fetch("/api/game/progress",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({eventId:ev.eventId,eventType:"cow_killed",duringBreak:ev.duringBreak})});if(!response.ok)throw new Error("progress unavailable");pendingProgressEvents.shift()}}catch{scheduleProgressRetry()}finally{progressSaving=false}}
function persistKill(duringBreak){pendingProgressEvents.push({eventId:crypto.randomUUID(),duringBreak});if(progressReady)void flushProgressEvents()}
async function loadGameProgress(){if(progressLoading||progressReady)return;progressLoading=true;try{const response=await fetch("/api/game/progress");if(!response.ok)throw new Error("progress unavailable");const data=await response.json();if(!data?.progress)throw new Error("invalid progress");xp=Number(data.progress.xp)||0;kills=Number(data.progress.kills)||0;missionIndex=Number(data.progress.missionIndex)||0;missionCount=Number(data.progress.missionCount)||0;for(const ev of pendingProgressEvents)applySavedKill(ev.duringBreak);progressReady=true;paintProgress();void flushProgressEvents()}catch{scheduleProgressRetry()}finally{progressLoading=false}}
void loadGameProgress();const heldKeys=new Set(),touchMove={x:0,y:0};function recordMission(type){const mission=missionTypes[missionIndex%missionTypes.length];if(mission.type!==type)return;missionCount++;if(missionCount>=mission.goal){missionIndex++;missionCount=0;/* Brain teaching tasks now replace this pasture mission toast. */}const next=missionTypes[missionIndex%missionTypes.length];$('missionTitle').textContent=next.title;$('missionProgress').textContent=missionCount+' / '+next.goal}
let marketTickSequences=new Map(),marketTickCursors=new Map();let contracts=[{market:'Volatility 75',kind:'OVER',barrier:1,p:.8},{market:'Volatility 100',kind:'UNDER',barrier:8,p:.8},{market:'Volatility 10',kind:'OVER',barrier:2,p:.7},{market:'Volatility 50',kind:'UNDER',barrier:7,p:.7}];
cows.forEach((v,i)=>{v.contract={...contracts[i%4]};v.hp=3;v.max=3;});function updateMarketTickSequences(markets){for(const m of markets){if(!m?.symbol)continue;const raw=Array.isArray(m.recentTicks)?m.recentTicks:[];const ticks=raw.filter(t=>Number.isFinite(t?.epoch)&&Number.isFinite(t?.quote)).slice(-60);if(!ticks.length&&Number.isFinite(m.lastEpoch)&&Number.isFinite(m.lastQuote))ticks.push({epoch:m.lastEpoch,quote:m.lastQuote,digit:m.lastDigit});const keys=ticks.map(t=>String(t.epoch)+'|'+String(t.quote)+'|'+String(t.digit??''));const prior=marketTickCursors.get(m.symbol)||[];let overlap=0;for(let k=Math.min(prior.length,keys.length);k>0;k--){let same=true;for(let j=0;j<k;j++)if(prior[prior.length-k+j]!==keys[j]){same=false;break}if(same){overlap=k;break}}let sequence=marketTickSequences.get(m.symbol)||0;if(prior.length)sequence+=Math.max(0,keys.length-overlap);marketTickSequences.set(m.symbol,sequence);marketTickCursors.set(m.symbol,keys)}}
const marketFreshnessObserved=new Map();function observeMarketFreshness(markets){const now=performance.now();for(const m of markets){if(!m?.symbol||!Number.isFinite(Number(m.lastEpoch))||Number(m.lastEpoch)<=0)continue;const prior=marketFreshnessObserved.get(m.symbol);if(!prior||prior.epoch!==Number(m.lastEpoch))marketFreshnessObserved.set(m.symbol,{epoch:Number(m.lastEpoch),at:now})}}function applyMarkets(markets,candidates,paperTrades,scoutSamples,accountEvidence){liveMarkets=Array.isArray(markets)?markets:[];observeMarketFreshness(liveMarkets);updateMarketTickSequences(liveMarkets);const scout=Array.isArray(scoutSamples)?scoutSamples:[],model=Array.isArray(candidates)?candidates:[],papers=Array.isArray(paperTrades)?paperTrades:[],plays=[['OVER',1,.8],['OVER',2,.7],['UNDER',7,.7],['UNDER',8,.8]];const next=liveMarkets.slice(0,8).map(m=>{const options=model.filter(c=>c&&c.market===m.symbol&&Number.isFinite(c.estWin)&&Number.isInteger(c.barrier)&&c.barrier>=1&&c.barrier<=8).sort((a,b)=>(b.expectedROI??-Infinity)-(a.expectedROI??-Infinity)||(b.estWin??0)-(a.estWin??0));const trendQuotes=(Array.isArray(m.recentQuotes)?m.recentQuotes:[]).filter(Number.isFinite).slice(-24);let trendRise=0,trendFall=0;for(let i=1;i<trendQuotes.length;i++){if(trendQuotes[i]>trendQuotes[i-1])trendRise++;else if(trendQuotes[i]<trendQuotes[i-1])trendFall++}const trendSamples=trendRise+trendFall,trendDirection=trendSamples>=12&&trendRise/trendSamples>=.75?'over':trendSamples>=12&&trendFall/trendSamples>=.75?'under':null,chosen=(trendDirection&&options.find(option=>option.direction===trendDirection))||options[0],digits=(Array.isArray(m.recentDigits)?m.recentDigits:[]).filter(x=>Number.isInteger(x)&&x>=0&&x<=9).slice(-50),high=digits.filter(x=>x>=5).length,low=digits.length-high,quotes=(Array.isArray(m.recentQuotes)?m.recentQuotes:[]).filter(Number.isFinite).slice(-24);let rises=0,falls=0;for(let i=1;i<quotes.length;i++){if(quotes[i]>quotes[i-1])rises++;else if(quotes[i]<quotes[i-1])falls++}const riseSamples=Math.max(0,quotes.length-1),riseRate=riseSamples?rises/riseSamples:.5,fallRate=riseSamples?falls/riseSamples:.5;const fallback=plays.map(([kind,barrier,base])=>{const wins=digits.length?digits.filter(x=>kind==='OVER'?x>barrier:x<barrier).length:0;const p=digits.length?(wins+base*20)/(digits.length+20):base;return{kind,barrier,base,p,edge:p-base}}).sort((a,b)=>b.edge-a.edge||b.p-a.p)[0];const kind=chosen?(chosen.direction==='over'?'OVER':'UNDER'):fallback.kind,barrier=chosen?.barrier??fallback.barrier,base=chosen?.baseWin??(chosen?(kind==='OVER'?(9-barrier)/10:barrier/10):fallback.base),rawP=chosen?.estWin??fallback.p,alignedRate=digits.length?(kind==='OVER'?high:low)/digits.length:.5,empiricalWins=digits.filter(x=>kind==='OVER'?x>barrier:x<barrier).length,empiricalP=digits.length?(empiricalWins+rawP*10)/(digits.length+10):rawP,empiricalWeight=digits.length?Math.min(.3,digits.length/(digits.length+18)*.3):0,hlAdjustment=digits.length>=20?(alignedRate-.5)*.12:0,alignedRise=kind==='OVER'?riseRate:fallRate,riseAdjustment=riseSamples>=8?(alignedRise-.5)*.10:0,p=Math.max(.01,Math.min(.99,rawP*(1-empiricalWeight)+empiricalP*empiricalWeight+hlAdjustment+riseAdjustment)),paper=papers.filter(t=>t.market===m.symbol&&t.direction===(kind==='OVER'?'over':'under')&&t.barrier===barrier&&['won','lost'].includes(t.status)),paperAll=paper,payout=Number.isFinite(chosen?.estPayout)?chosen.estPayout:null,edge=p-(payout&&payout>0?1/payout:base),score=payout?p*payout-1:chosen?(chosen.expectedROI??0)+(p-rawP):p-base,scoutRow=scout.find(t=>t.market===m.symbol&&t.direction===(kind==='OVER'?'over':'under')&&t.barrier===barrier),accountRow=(Array.isArray(accountEvidence)?accountEvidence:[]).find(t=>t.market===m.symbol&&t.contract_type===(kind==='OVER'?'DIGITOVER':'DIGITUNDER')&&t.barrier===barrier),display=(m.display||m.symbol||'Market').split('(')[0].trim(),fresh=m.fresh===true&&Number.isFinite(m.lastEpoch)&&Math.abs(Date.now()/1000-m.lastEpoch)<15,hitSignal=fresh&&digits.length>=30&&riseSamples>=12&&alignedRise>=.65&&alignedRate>=.55&&p>=.70&&edge>0;return{market:display,symbol:m.symbol,kind,barrier,base,p,rawP,edge,score,payout,high,low,digitSamples:digits.length,riseRate,fallRate,riseSamples,alignedRate,alignedRise,hitSignal,fresh,tickSeq:marketTickSequences.get(m.symbol)||0,scoutWins:scoutRow?.wins??0,scoutSamples:scoutRow?.samples??0,accountWins:accountRow?.wins??0,accountLosses:accountRow?.losses??0,roi:score,paperWins:paperAll.filter(t=>t.status==='won').length,paperLosses:paperAll.filter(t=>t.status==='lost').length,reason:chosen?.reason||'Recent digit and quote observations',live:true}});if(next.length)contracts=next;cows.forEach((v,i)=>{v.contract=v===target&&v.tradeIntent&&!v.tradeIntent.rangerAutomation?(contracts.find(item=>item.symbol===v.tradeIntent.contract.symbol)||v.contract):contracts[i%contracts.length]});rank();updatePastureHighlightTargets()}
function splitDigits(values){const digits=Array.isArray(values)?values.slice(-50).filter(v=>Number.isInteger(v)&&v>=0&&v<=9):[];const high=digits.filter(v=>v>=5).length;return{high,low:digits.length-high,n:digits.length}}function renderDigitFlow(state){const root=$('digitFlow');if(!root)return;root.replaceChildren();const rows=(Array.isArray(state.markets)?state.markets:[]).map(m=>({name:String(m.display||m.symbol||'Market').split('(')[0].trim(),fresh:m.fresh===true&&Number.isFinite(m.lastEpoch)&&Math.abs(Date.now()/1000-m.lastEpoch)<15,...splitDigits(m.recentDigits)})).filter(m=>m.n===50&&m.fresh);if(state.feedConnected===false||!rows.length){const note=document.createElement('small');note.textContent=state.feedConnected===false?'Feed offline - rankings paused':'Waiting for 50 fresh digits per market';root.appendChild(note);return}for(const side of ['high','low']){const sorted=rows.filter(row=>row[side]>row[side==='high'?'low':'high']).sort((a,b)=>b[side]/b.n-a[side]/a.n||b.n-a.n||a.name.localeCompare(b.name)).slice(0,3);const group=document.createElement('div');group.className='digit-flow-group '+side;const title=document.createElement('b');title.textContent=side==='high'?'HIGH 5-9':'LOW 0-4';group.appendChild(title);if(!sorted.length){const empty=document.createElement('small');empty.textContent='No markets ahead';group.appendChild(empty)}for(const row of sorted){const item=document.createElement('div');const name=document.createElement('span');name.textContent=row.name;const count=document.createElement('strong');count.textContent=side==='high'?row.high+'/'+row.n:row.low+'/'+row.n;item.appendChild(name);item.appendChild(count);group.appendChild(item)}root.appendChild(group)}}function marketName(symbol,state){const raw=String(symbol||'').trim(),m=(state?.markets||liveMarkets).find(item=>item.symbol===raw),display=String(m?.display||'').trim();if(display&&display.toUpperCase()!==raw.toUpperCase())return display;const oneSecond=/^1HZ(\d+(?:\.\d+)?)V$/i.exec(raw);if(oneSecond)return 'Volatility '+oneSecond[1]+' (1s)';const standard=/^R_(\d+(?:\.\d+)?)$/i.exec(raw);if(standard)return 'Volatility '+standard[1];return display||raw||'Market'}function ghostContractKey(contract){return contract?String(contract.runId||'')+':'+String(contract.id):''}let ghostPanelOpen=false,ghostReplayPending=false;
function ghostPaperStats(paper){const wins=Math.max(0,Number(paper?.wins)||0),losses=Math.max(0,Number(paper?.losses)||0),settled=wins+losses;return{wins,losses,rate:settled?Math.round(wins/settled*100):null}}
function renderGhostPanel(){
  const panel=$('ghostTraderPanel');if(!panel||panel.hidden!==false)return;
  const paper=ghostPaperState,stats=ghostPaperStats(paper),open=paper?.openContract,last=paper?.lastSettled,research=lastRoomState?.research,run=research?.latest,active=research?.active;
  const recent=(Array.isArray(paper?.recentTrades)?paper.recentTrades:(last?[last]:[])).filter(trade=>trade&&['won','lost'].includes(trade.status)).slice(0,10);
  const key=JSON.stringify([paper?.phase,paper?.reason,paper?.netPnl,stats,open,last,recent,research,(lastRoomState?.markets||[]).map(m=>[m.symbol,m.display])]);
  if(renderGhostPanel.lastKey===key)return;renderGhostPanel.lastKey=key;
  $('ghostPanelWins').textContent=String(stats.wins);$('ghostPanelLosses').textContent=String(stats.losses);$('ghostPanelRate').textContent=stats.rate===null?'--':stats.rate+'%';
  const contractLabel=trade=>marketName(trade.market,lastRoomState)+' '+String(trade.direction||'').toUpperCase()+' '+String(trade.barrier??'');
  const virtual=Number.isFinite(paper?.netPnl)?(paper.netPnl>=0?'+':'')+paper.netPnl.toFixed(2)+' virtual':'--';
  $('ghostPanelStatus').textContent=!paper?'Waiting for paper research.':open?'OPEN: '+contractLabel(open)+' | '+virtual:((paper.phase||'idle').toUpperCase()+' | P&L '+virtual);
  $('ghostReplayStatus').textContent=active?(active.message||'Replaying historical ticks...'):run?`${run.strategy_mode} / ${run.bot_mode}: ${run.wins}W / ${run.losses}L | ${run.trades} simulated trades | ${Number.isFinite(run.win_rate)?run.win_rate.toFixed(1)+'% wins':'win rate unavailable'}`:'No completed replay yet.';
  $('ghostReplayRun').disabled=!!active||!research?.canRun||ghostReplayPending;
  $('ghostReplayRun').title=!research?.canRun?'Connect an owner account to run a replay.':active||ghostReplayPending?'Replay in progress':'Replay past ticks without using account funds';
  $('ghostReplayRun').textContent=active||ghostReplayPending?'Replaying...':'Run replay';
  $('ghostTraderPanel').classList.toggle('is-replaying',!!active||ghostReplayPending);
  const list=$('ghostPanelTrades');list.replaceChildren();
  if(!recent.length){const empty=document.createElement('li');empty.textContent='No settled paper trades yet.';list.append(empty)}
  for(const trade of recent){const row=document.createElement('li'),name=document.createElement('span'),result=document.createElement('b'),digits=document.createElement('small');row.dataset.status=trade.status;name.textContent=contractLabel(trade);const profit=Number.isFinite(trade.profit)?' '+(trade.profit>=0?'+':'')+trade.profit.toFixed(2):'';result.textContent=trade.status.toUpperCase()+profit;digits.textContent='Entry '+(Number.isInteger(trade.entryDigit)?trade.entryDigit:'--')+' -> exit '+(Number.isInteger(trade.exitDigit)?trade.exitDigit:'--')+' | virtual';row.append(name,result,digits);list.append(row)}
  const detail=open||last;
  if(!detail){$('ghostPanelVerbose').textContent=paper?.reason||'Waiting for a paper signal.';return}
  const pieces=[contractLabel(detail)];if(Number.isFinite(detail.estWin))pieces.push('Estimated confidence '+(detail.estWin*100).toFixed(1)+'%');if(Number.isFinite(detail.edge))pieces.push('Estimated edge '+(detail.edge>=0?'+':'')+(detail.edge*100).toFixed(1)+'%');if(Number.isFinite(detail.stake))pieces.push('Virtual stake '+detail.stake.toFixed(2));if(detail.candidateReason)pieces.push(String(detail.candidateReason));else if(paper?.reason)pieces.push(String(paper.reason));$('ghostPanelVerbose').textContent=pieces.join(' | ')+'. Virtual evidence, not an account trade.';
}
renderGhostPanel.lastKey=null;
function positionGhostPanel(){const panel=$('ghostTraderPanel'),hud=$('playerHud');if(!panel||panel.hidden||!hud||typeof panel.getBoundingClientRect!=='function')return;if(innerWidth<=700){for(const property of ['top','left','right','bottom'])panel.style.removeProperty(property);return}const rect=hud.getBoundingClientRect(),width=panel.getBoundingClientRect().width;if(!rect.width||!width)return;panel.style.left=Math.max(8,Math.min(innerWidth-width-8,rect.right-width))+'px';panel.style.top=Math.max(60,Math.min(innerHeight-panel.offsetHeight-8,rect.top))+'px';panel.style.right='auto'}
function setGhostPanelOpen(open){const panel=$('ghostTraderPanel');if(!panel)return;ghostPanelOpen=!!open;panel.hidden=!ghostPanelOpen;document.body?.classList?.toggle('ghost-details-open',ghostPanelOpen);$('ghostPanelShortcut')?.setAttribute('aria-expanded',String(ghostPanelOpen));if(ghostPanelOpen){const marketMenu=document.querySelector('#inspector .target-menu');if(marketMenu?.open)marketMenu.open=false;if(rangerAutoMenuOpen)parent.postMessage({type:'zeronine:room-auto-dismiss'},location.origin);renderGhostPanel.lastKey=null;renderGhostPanel();positionGhostPanel();$('ghostPanelClose')?.focus?.({preventScroll:true})}}
function ghostTraderAtClientPoint(clientX,clientY){const cam=camera(),x=clientX/zoom+cam.x,y=clientY/zoom+cam.y;return Math.hypot(x-ghost.x,y-(ghost.y-8))<48}
function makeGhostPaperCow(contract){return cows.find(v=>v.alive&&v.contract?.symbol===contract?.market)||null}
function syncGhostPaper(state){
  ghostPaperState=state.paperSimulation||null;
  const paper=ghostPaperState,open=paper?.openContract,last=paper?.lastSettled,wasInitialized=ghostPaperInitialized;
  if(paper)ghostPaperInitialized=true;
  renderGhostPanel();
  if(open){
    const key=ghostContractKey(open);
    if(key!==ghostPaperContractId){
      ghostPaperContractId=key;ghostPaperResultId=null;ghostPatrol=null;ghostTargetCow=makeGhostPaperCow(open);ghost.target=ghostTargetCow;ghostArrows=[];ghostLastTickSeq=marketTickSequences.get(open.market)||0;
      if(ghostTargetCow){const dx=ghostTargetCow.x-ghost.x,dy=ghostTargetCow.y-ghost.y,d=Math.hypot(dx,dy)||1;ghostArrows.push({x:ghost.x,y:ghost.y-8,vx:dx/d*360,vy:dy/d*360,target:ghostTargetCow})}
    }else if(!ghostTargetCow||!ghostTargetCow.alive||ghostTargetCow.contract?.symbol!==open.market){ghostTargetCow=makeGhostPaperCow(open);ghost.target=ghostTargetCow;ghostArrows=[]}
    return;
  }
  if(last){
    const key=ghostContractKey(last);
    if(key&&key!==ghostPaperResultId){
      const tracked=key===ghostPaperContractId;ghostPaperResultId=key;ghostPaperContractId=key;
      const target=ghostTargetCow?.alive&&ghostTargetCow.contract?.symbol===last.market?ghostTargetCow:makeGhostPaperCow(last);
      if((tracked||wasInitialized)&&last.status==='won'&&target)spawnPaperGhostVisual({targetX:target.x,targetY:target.y},target,'scout');
      if((tracked||wasInitialized)&&last.status==='lost')fx.push({x:ghost.x,y:ghost.y-52,life:.9,size:14,text:'PAPER LOST',color:'#ffb1b5'});
      ghost.target=null;ghostTargetCow=null;ghostArrows=[];
    }
  }else{ghost.target=null;ghostTargetCow=null;ghostArrows=[];ghostPaperContractId=null;ghostPaperResultId=null}
}
function renderPaper(state){const paper=state.paperSimulation,box=$('paperMini'),status=$('paperMiniStatus'),stats=$('paperMiniStats');if(!box||!status||!stats)return;if(!paper){status.textContent='Scout offline';stats.textContent='Waiting for paper simulator';box.dataset.phase='offline';$('ghostStatus').textContent='Scout offline';return}const open=paper.openContract,last=paper.lastSettled,contract=open||last,side=contract?String(contract.direction||'').toUpperCase():'',symbol=String(contract?.market||''),name=contract?marketName(symbol,state):'',marketLabel=name&&name!==symbol?name:symbol,market=(state.markets||[]).find(item=>item.symbol===symbol),digit=open?(market?.fresh===true&&Number.isFinite(market.lastEpoch)&&Math.abs(Date.now()/1000-market.lastEpoch)<15?market.lastDigit:null):last?.exitDigit,stake=Number.isFinite(contract?.stake)?'$'+Number(contract.stake).toFixed(2):null,profit=Number.isFinite(last?.profit)?(last.profit>=0?'+':'-')+'$'+Math.abs(last.profit).toFixed(2):'P&L pending';if(contract){const outcome=open?'OPEN':String(last.status||'RESULT').toUpperCase();status.textContent=outcome+' | '+marketLabel+' | '+side+' '+contract.barrier;stats.textContent=marketLabel+' | ENTRY '+contract.entryDigit+' > '+(open?'LIVE '+(Number.isInteger(digit)?digit:'--'):'EXIT '+(Number.isInteger(digit)?digit:'--'))+' | '+(open?'VIRTUAL '+(stake||'stake pending'):profit+' VIRTUAL')}else{status.textContent='PAPER '+String(paper.phase||'idle').toUpperCase();stats.textContent=paper.totalTrades+' virtual trades'}box.dataset.phase=open?'open':String(last?.status||paper.phase||'idle').toLowerCase();$('ghostStatus').textContent=contract?(open?'OPEN | ':'')+marketLabel+' | '+side+' '+contract.barrier+(open?' | ENTRY '+contract.entryDigit:' | '+String(last.status||'RESULT').toUpperCase()):'Paper '+String(paper.phase||'idle')+' | '+paper.totalTrades+' trades';box.title='Virtual paper only. Right-click the ghost scout, or press and hold on touch, for details.'}function estimateRecoveryWins(contract){if(cowBetStyle==='base'||!sessionRecovery.amount||!lastRoomState||!connectedAccount)return 0;const base=selectedCowStake()||1,plan=plannedCowStake(base,contract,lastRoomState);if(!plan||plan.stake<=0)return 0;const b=Number(contract.barrier),over=String(contract.kind).toUpperCase()==='OVER',chance=over?(9-b)/10:b/10,payout=Number(contract.payout),net=payout>1?payout-1:Math.max(.05,.95/Math.max(.05,chance)-1),perWin=plan.stake*net;return perWin>0?Math.max(1,Math.ceil(sessionRecovery.amount/perWin-.000001)):0}function refreshRecoveryRecommendation(){recoveryRecommendation=sessionRecovery.amount>0?[...contracts].filter(a=>a.fresh&&a.edge>0&&a.score>0).sort((a,b)=>b.score-a.score||b.edge-a.edge)[0]||null: null;recoveryWinsEstimate=recoveryRecommendation?estimateRecoveryWins(recoveryRecommendation):0}function rank(){refreshRecoveryRecommendation();const badge=$('recoveryPlanBadge');if(badge){badge.hidden=sessionRecovery.amount<=0;badge.textContent=sessionRecovery.amount<=0?'':recoveryRecommendation?'RECOVERY PICK · '+recoveryRecommendation.market+' '+recoveryRecommendation.kind+' '+recoveryRecommendation.barrier+' · ~'+recoveryWinsEstimate+' BET WINS':'RECOVERY PAUSED · waiting for fresh positive edge';badge.classList.toggle('waiting',!!sessionRecovery.amount&&!recoveryRecommendation)}const list=[...contracts].sort((a,b)=>(b.score??-Infinity)-(a.score??-Infinity)||b.p-a.p);$('rankings').innerHTML=list.map((a,i)=>{const details=a.digitSamples?'LOW '+(a.low??0)+' / HIGH '+(a.high??0)+' | UP '+(a.riseRate*100).toFixed(0)+'% / DOWN '+(a.fallRate*100).toFixed(0)+'%':'Recent digits waiting',recoveryPick=!!recoveryRecommendation&&a.symbol===recoveryRecommendation.symbol,recoveryCue=recoveryPick?'RECOVERY PICK · ~'+recoveryWinsEstimate+' BET WINS':'',suggestion=a.hitSignal?' | Fresh entry signal':'',entryAlert=a.hitSignal?'<em class="entry-alert">BET NOW</em>':'',payout=Number.isFinite(a.payout)?' | '+a.payout.toFixed(2)+'x theoretical est. (not live quote)':'',edge=Number.isFinite(a.edge)?a.edge:0,edgeState=edge>=.05?'strong-positive':edge>=0?'positive':'negative',edgeArrow=edge>=0?'▲':'▼',edgeLabel=edge>=.05?'HIGH EDGE':edge>=0?'POSITIVE EDGE':'NEGATIVE EDGE';return '<div class="row"><span><span class="market-rank-title">'+(i+1)+'. '+a.market+' - '+a.kind+' '+a.barrier+'</span>'+entryAlert+'<b class="edge-indicator '+edgeState+'">'+edgeArrow+' '+(edge>=0?'+':'')+(edge*100).toFixed(1)+'% <small>'+edgeLabel+'</small></b>'+(recoveryPick?'<em class="recovery-pick-note">'+recoveryCue+'</em>':'')+'<small class="market-rank-details">'+(a.p*100).toFixed(1)+'% confidence'+payout+' | '+details+suggestion+'</small></span></div>'}).join('')}rank();const minZoom=()=>Math.max(.12,Math.min(.65,W/world.w,H/world.h));const camera=()=>{let vw=W/zoom,vh=H/zoom;const brainOpen=brainZoomPrev!==null,focusX=brainOpen?.4:.44,focusY=brainOpen?(W<=700?.23:.44):.57,focusWorldY=brainOpen?player.y-20:player.y;return {x:vw>=world.w?(world.w-vw)/2:Math.max(0,Math.min(world.w-vw,player.x-vw*focusX)),y:vh>=world.h?(world.h-vh)/2:Math.max(0,Math.min(world.h-vh,focusWorldY-vh*focusY))}};window.__zeronineRanger={thinking:false,screen(){const v=camera();return{x:(player.x-v.x)*zoom,y:(player.y-v.y)*zoom}},head(){const v=camera();return{x:(player.x-v.x)*zoom,y:(player.y-20-v.y)*zoom,r:11*zoom}}};
let brainSnipe=null,brainZoomPrev=null,rangerBrainPilotKey='',rangerLastPaperVisualAt=0;
function brainStakeFor(cow){let base=1;try{const raw=Number($('rangerAutoStake')?.value||$('cowStake')?.value||1);if(Number.isFinite(raw)&&raw>0)base=raw}catch{}if(!connectedAccount)return{stake:Math.round(base*100)/100,limited:false};const plan=plannedCowStake(base,cow.contract,lastRoomState,cowBetStyle);return plan&&plan.stake>0?{stake:plan.stake,limited:!!plan.recoveryLimited}:{stake:0,limited:false,reason:(plan&&plan.reason)||'Stake blocked by balance limits.'}}
function brainCowScore(cow){const tag=cow&&cow.contract;if(!tag)return -Infinity;const edge=Number(tag.edge),score=Number(tag.score),p=Number(tag.p),payout=Number(tag.payout);let value=(Number.isFinite(score)?score:0)*2+(Number.isFinite(edge)?edge:0)*3+(Number.isFinite(p)?p:0);if(Number.isFinite(payout)&&payout>1)value+=Math.min(.4,(payout-1)*.25);if(tag.hitSignal===true)value+=.45;if(tag.fresh===false)value-=.6;return value}
function brainFactorList(pick,pool){const tag=pick.tag,out=[],pct=v=>(v*100).toFixed(1)+'%';if(Number.isFinite(tag.edge)&&tag.edge>0)out.push({key:'edge',label:'Edge over cost',detail:'The payout is worth more than the chance it costs.',value:'+'+pct(tag.edge)});if(Number.isFinite(tag.p))out.push({key:'p',label:'Chance to win',detail:'How often this setup landed in finished practice games.',value:pct(tag.p)});if(Number.isFinite(tag.score)&&tag.score>0)out.push({key:'score',label:'Brain score',detail:'The brain\'s combined ranking for this setup.',value:Number(tag.score).toFixed(2)});if(Number.isFinite(tag.payout)&&tag.payout>1)out.push({key:'payout',label:'Pays',detail:'What one unit returns if this cow falls.',value:Number(tag.payout).toFixed(2)+'x'});if(tag.hitSignal===true)out.push({key:'hit',label:'HIT cue',detail:'The live ticks are lining up with this barrier.',value:'on'});if(tag.fresh===true)out.push({key:'fresh',label:'Fresh tick',detail:'The market tick for this cow is current.',value:'yes'});const others=Math.max(0,pool.length-1);out.push({key:'rank',label:'Picked over',detail:'Every other live cow the brain could read this moment.',value:others?others+' cow'+(others===1?'':'s'):'whole herd'});return out}
const BRAIN_RECORD_KEY='ranger-brain-pick-record-v1';
let brainPickRecord={};
try{const savedRecord=JSON.parse(localStorage.getItem(BRAIN_RECORD_KEY)||'{}');if(savedRecord&&typeof savedRecord==='object')brainPickRecord=savedRecord}catch{}
function brainSetupSig(source){const tag=source&&source.contract?source.contract:source||{};return [String(tag.market||tag.symbol||''),String(tag.kind||tag.direction||'').toUpperCase(),String(tag.barrier??tag.targetDigit??'')].join('|')}
function brainRecordFor(sig){const row=brainPickRecord[sig],w=Number(row&&row.w)||0,l=Number(row&&row.l)||0,total=w+l;return{w,l,total,rate:total?w/total:null}}
function brainNotePickResult(sig,won){if(!sig)return;const row=brainPickRecord[sig]||{w:0,l:0};if(won)row.w=(Number(row.w)||0)+1;else row.l=(Number(row.l)||0)+1;brainPickRecord[sig]=row;try{localStorage.setItem(BRAIN_RECORD_KEY,JSON.stringify(brainPickRecord))}catch{}}
let brainPreferences={minConfidence:55,requireSignal:false};
function brainSetPreferences(input){const value=Number(input?.minConfidence);brainPreferences={minConfidence:[55,65,75].includes(value)?value:55,requireSignal:input?.requireSignal===true};brainScanCacheKey='';brainScanCacheResult=null;}
function brainCandidateEligible(tag,opts){opts=opts||{};if(!tag)return{ok:false,code:'no_herd',reason:'There is no cow to read.'};if(opts.feedConnected===false)return{ok:false,code:'feed',reason:'The market feed is offline.'};if(tag.fresh!==true||opts.quoteFresh===false)return{ok:false,code:'stale',reason:'The latest tick for this market is stale.'};const edge=Number(tag.edge),p=Number(tag.p),payout=Number(tag.payout),score=Number(tag.score);if(!Number.isFinite(edge)||edge<=0)return{ok:false,code:'no_edge',reason:'No setup shows a positive edge right now.'};if(!Number.isFinite(p)||p<brainPreferences.minConfidence/100)return{ok:false,code:'low_chance',reason:'No setup meets your confidence setting.'};if(brainPreferences.requireSignal&&tag.hitSignal!==true)return{ok:false,code:'no_signal',reason:'Waiting for a live signal.'};if(Number.isFinite(payout)&&payout<=1)return{ok:false,code:'no_payout',reason:'The payout does not cover the risk.'};if(!Number.isFinite(score))return{ok:false,code:'no_evidence',reason:'The brain has no ranked evidence for this herd yet.'};return{ok:true}}
function brainScanUncached(entryCow){const feedConnected=lastRoomState?.feedConnected!==false,pool=cows.filter(cow=>cow!==ghostCow&&(cow.alive||cow===entryCow)&&cow.contract).map(cow=>({cow,score:brainCowScore(cow),tag:cow.contract})),ranked=pool.slice().sort((a,b)=>b.score-a.score);if(!pool.length)return{pick:null,pool,ranked,code:'no_herd',reason:'The pasture is empty right now.'};if(!feedConnected)return{pick:null,pool,ranked,code:'feed',reason:'The market feed is offline, so nothing can be checked.'};let first=null;for(const item of ranked){const check=brainCandidateEligible(item.tag,{feedConnected,quoteFresh:quoteFreshness(item.tag.symbol).fresh});if(check.ok){item.factors=brainFactorList(item,pool);item.pool=pool.length;item.rank=ranked.indexOf(item)+1;return{pick:item,pool,ranked,code:'ok',reason:''}}if(!first)first=check}return{pick:null,pool,ranked,code:(first&&first.code)||'no_edge',reason:(first&&first.reason)||'No cow qualifies right now.'}}
let brainScanCacheKey='',brainScanCacheAt=0,brainScanCacheResult=null;
function brainScan(entryCow){const key=[entryCow?cows.indexOf(entryCow):-1,activeAccountId||'',Array.from(marketTickSequences.entries()).map(([symbol,seq])=>symbol+':'+seq).join('|'),contracts.map(c=>[c.symbol,c.kind,c.barrier,c.edge,c.p].join(':')).join('|')].join('||'),now=performance.now();if(brainScanCacheResult&&key===brainScanCacheKey&&now-brainScanCacheAt<350)return brainScanCacheResult;brainScanCacheKey=key;brainScanCacheAt=now;brainScanCacheResult=brainScanUncached(entryCow);return brainScanCacheResult}
function brainSniperCandidate(entryCow){return brainScan(entryCow).pick}
function brainSuggest(){const scan=brainScan(),pick=scan.pick;if(!pick)return{status:'none',code:scan.code,reason:scan.reason};const cow=pick.cow,tag=cow.contract,plan=brainStakeFor(cow),seq=marketTickSequences.get(tag.symbol)||0,ticks=Math.max(1,Math.min(3,Number(tag.edge)>.08?1:2));brainSnipe={status:'target',cowId:cows.indexOf(cow),cow,symbol:tag.symbol,market:tag.market,kind:tag.kind,barrier:tag.barrier,stake:plan.stake,limited:plan.limited,reason:plan.reason||'',enterAt:seq+ticks,tickSeq:seq,sig:brainSetupSig(tag),record:brainRecordFor(brainSetupSig(tag)),accountId:activeAccountId,at:performance.now(),until:performance.now()+12000,edge:Number(tag.edge)||0,p:Number(tag.p)||0,payout:Number(tag.payout)||null,factors:pick.factors,pool:pick.pool,rank:pick.rank};return brainSnipe}
function brainSetupMoved(frozen,live){if(!frozen||!live)return false;return String(frozen?.symbol||'')!==String(live?.symbol||'')||String(frozen?.kind||'').toUpperCase()!==String(live?.kind||'').toUpperCase()||String(frozen?.barrier??'')!==String(live?.barrier??'')}
// A frozen contract is only permission to shoot the setup that was true when
// the pick was made. Re-read the live signal at the moment of entry.
function brainEntryCheck(cow){const intent=cow&&cow.tradeIntent;if(!intent||!intent.brainSnipe)return null;const frozen=intent.contract||{},live=cow.contract||{},at=Number(intent.brainSuggestedAt)||0,reactionMs=at?Math.max(0,performance.now()-at):0,keptStake=Math.max(0,Number(intent.stake)||0);if(brainSetupMoved(frozen,live)||brainSetupSig(frozen)!==brainSetupSig(live))return{code:'moved',reactionMs,keptStake,from:brainSetupSig(frozen),to:brainSetupSig(live)};if(live.fresh===false||!quoteFreshness(frozen.symbol||live.symbol).fresh)return{code:'stale',reactionMs,keptStake};const eligibility=brainCandidateEligible(live,{feedConnected:lastRoomState?.feedConnected!==false,quoteFresh:quoteFreshness(frozen.symbol||live.symbol).fresh});if(!eligibility.ok)return{code:eligibility.code==='stale'?'stale':'changed',reactionMs,keptStake,edge:Number.isFinite(Number(live.edge))?Number(live.edge):null};const tick=marketTickSequences.get(frozen.symbol)||0,planned=Number(intent.brainEntry)||0;return{code:'held',reactionMs,keptStake,tick,planned,late:planned>0&&tick>planned}}
function brainEntryReaction(detail){try{window.dispatchEvent(new CustomEvent('zeronine:brain-late-entry',{detail:detail||{}}))}catch{}}
function brainSnipeAlive(s){if(!s)return false;if(performance.now()>s.until)return false;if(s.accountId!==activeAccountId)return false;if(quoteFreshness(s.symbol).fresh!==true)return false;return true}
function brainSnipeFor(cow){if(!brainSnipe||brainSnipe.cowId!==cows.indexOf(cow))return null;if(!brainSnipeAlive(brainSnipe)){brainSnipe=null;return null}return brainSnipe}
function brainSnipeStillValid(cow){const s=brainSnipeFor(cow);if(!s)return null;if(brainSetupSig(s)!==brainSetupSig(cow.contract)){brainSnipe=null;return null}const live=brainScan().pick;if(!live||brainSetupSig(live.cow)!==s.sig){brainSnipe=null;return null}return s}
function brainClearSnipe(){brainSnipe=null}
function brainSetZoom(on){if(on){if(brainZoomPrev===null)brainZoomPrev=zoomGoal;zoomGoal=Math.max(zoomGoal,W<=700?1.25:1.45)}else if(brainZoomPrev!==null){zoomGoal=brainZoomPrev;brainZoomPrev=null}}
function brainSnapshot(){const cam=camera(),toScreen=(x,y)=>({x:(x-cam.x)*zoom,y:(y-cam.y)*zoom}),herd=cows.filter(cow=>cow!==ghostCow&&cow.alive&&cow.contract).map(cow=>{const s=toScreen(cow.x,cow.y);return{index:cows.indexOf(cow),x:cow.x,y:cow.y,sx:s.x,sy:s.y,market:cow.contract.market,symbol:cow.contract.symbol,kind:cow.contract.kind,barrier:cow.contract.barrier,edge:Number(cow.contract.edge)||0,p:Number(cow.contract.p)||0,score:Number(cow.contract.score)||0,payout:Number(cow.contract.payout)||null,fresh:cow.contract.fresh===true,hitSignal:cow.contract.hitSignal===true}}),head=toScreen(player.x,player.y-20),feet=toScreen(player.x,player.y);return{zoom,previewZoom:zoomGoal,head,feet,herd,tickSeq:Object.fromEntries([...marketTickSequences.entries()])}}
let replayAttempt=null;window.addEventListener('message',e=>{const m=e.data;if(e.origin!==location.origin||e.source!==parent||!['zeronine:room-trade-result','zeronine:replay-confirmed-trade'].includes(m?.type)||m.ok!==true||!replayAttempt||m.replayAttemptId!==replayAttempt.id||m.replayAccountId!==replayAttempt.accountId||activeAccountId!==replayAttempt.accountId||aimStartedAt!==replayAttempt.aim)return;if((typeof m.confirmedTradeId==='string'&&m.confirmedTradeId.length>0)||typeof m.confirmedTradeId==='number')replayAttempt.confirmedId=String(m.confirmedTradeId)});window.__zeronineBrainBridge={snapshot:brainSnapshot,suggest:brainSuggest,clearSnipe:brainClearSnipe,setZoom:brainSetZoom,setPreferences:brainSetPreferences,activeSnipe:()=>brainSnipeAlive(brainSnipe)?brainSnipe:null,account:()=>activeAccountId,freshness:symbol=>quoteFreshness(symbol).fresh,recentDigits:symbol=>{const m=liveMarkets.find(item=>item?.symbol===symbol);if(!m||!quoteFreshness(symbol).fresh||!Array.isArray(m.recentTicks))return [];const ticks=m.recentTicks.slice(-3);if(ticks.some(t=>!Number.isInteger(t?.digit)||t.digit<0||t.digit>9||!Number.isFinite(t?.epoch)))return [];return ticks.map(t=>t.digit)},snipeFor:cow=>brainSnipeFor(cow),pick:brainSniperCandidate,recordFor:source=>brainRecordFor(brainSetupSig(source)),setAutoSnipe(on){brainAutoSnipe=!!on},autoSnipe:()=>brainAutoSnipe};canvas.addEventListener('wheel',e=>{e.preventDefault();zoomGoal=Math.max(minZoom(),Math.min(1.75,zoomGoal*Math.exp(-e.deltaY*.00115)));},{passive:false});function legacyPastureNotify(s,paperTrade){const now=performance.now();if(s===lastToastText&&now-lastToastAt<1800)return;lastToastText=s;lastToastAt=now;const toast=$('toast');toast.classList.toggle('paper-toast',!!paperTrade);toast.textContent=s;if(paperTrade){toast.replaceChildren(createPaperTradeDetails(paperTrade));toast.dataset.phase=paperTrade.status}else{delete toast.dataset.phase}toast.style.opacity=1;document.body?.classList?.add('toast-active');clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.style.opacity=0;document.body?.classList?.remove('toast-active');},Math.min(6500,Math.max(3000,1200+s.length*45)))}function notify(s,paperTrade){if(typeof window.notify==="function"&&window.notify!==notify){return window.notify(s,paperTrade)}return legacyPastureNotify(s,paperTrade)}function updateSessionRecovery(state){if(!state.accountId){sessionRecovery={amount:0,planDebt:0,winsApplied:0,processed:[],cowTradeIds:[]};return}const key='deriv-cows-session-recovery-v2:'+state.accountId;let saved;try{saved=JSON.parse(sessionStorage.getItem(key)||'null')}catch{}const cowTradeIds=new Set((saved?.cowTradeIds||[]).map(String)),settled=(state.trades||[]).filter(t=>t.origin==='manual'&&cowTradeIds.has(String(t.id))&&['won','lost'].includes(t.status)&&t.id!=null);if(!saved||!Array.isArray(saved.processed))saved={amount:0,planDebt:0,winsApplied:0,processed:settled.map(t=>String(t.id)),cowTradeIds:[...cowTradeIds]};const seen=new Set(saved.processed);for(const t of settled.slice().reverse()){const id=String(t.id);if(seen.has(id))continue;const stake=Math.max(0,Number(t.stake)||0),profit=Number(t.profit)||0;if(t.status==='lost'){saved.amount+=stake;saved.planDebt=saved.amount;saved.winsApplied=0}else{saved.amount=Math.max(0,saved.amount-Math.max(0,profit));saved.winsApplied=Math.min(3,(saved.winsApplied||0)+1);if(saved.amount===0){saved.planDebt=0;saved.winsApplied=0}}seen.add(id)}saved.processed=[...seen].slice(-120);saved.cowTradeIds=[...cowTradeIds].slice(-120);sessionRecovery={amount:Math.max(0,Number(saved.amount)||0),planDebt:Math.max(0,Number(saved.planDebt)||0),winsApplied:Number(saved.winsApplied)||0,processed:saved.processed,cowTradeIds:saved.cowTradeIds};try{sessionStorage.setItem(key,JSON.stringify(sessionRecovery))}catch{}updateCowBetStyleHint()}function registerCowTrade(id){if(!activeAccountId||id==null)return;const key='deriv-cows-session-recovery-v2:'+activeAccountId;let saved;try{saved=JSON.parse(sessionStorage.getItem(key)||'null')}catch{}if(!saved||!Array.isArray(saved.processed))return;const idText=String(id),ids=new Set((saved.cowTradeIds||[]).map(String));if(ids.has(idText))return;ids.add(idText);saved.cowTradeIds=[...ids].slice(-120);saved.processed=saved.processed.filter(value=>String(value)!==idText);sessionRecovery.cowTradeIds=saved.cowTradeIds;sessionRecovery.processed=saved.processed;try{sessionStorage.setItem(key,JSON.stringify({...saved,...sessionRecovery}))}catch{}}function renderAccountHud(state){const el=$('accountBalance'),hint=$('accountRiskHint'),balance=Number(state.balance);if(el)el.textContent=connectedAccount&&Number.isFinite(balance)?(state.currency||'USD')+' '+balance.toFixed(2):'Connect Deriv';if(hint)hint.textContent='Session loss: '+sessionRecovery.amount.toFixed(2)+' '+(state.currency||'USD')+(sessionRecovery.amount?' · recovery '+Math.min(3,sessionRecovery.winsApplied+1)+'/3 wins':' · base stake')}let cowBetStyle='base';try{const saved=localStorage.getItem('pasture-manual-bet-style');if(['base','martingale','boosted','chase'].includes(saved))cowBetStyle=saved}catch{}function updateCowBetStyleHint(){const hint=$('cowBetStyleHint');if(!hint)return;const debt=sessionRecovery.amount;hint.textContent=cowBetStyle==='base'?'Flat stake every bet. Losses are tracked, but not chased.':cowBetStyle==='martingale'?debt>0?'Next loss recovery targets the full '+debt.toFixed(2)+' debt in one win.':'After a loss, target the full debt in one win.':cowBetStyle==='boosted'?debt>0?'Targets '+(debt+selectedCowStake()*.5).toFixed(2)+' (debt + half a base stake).':'After a loss, targets debt plus half a base stake.':debt>0?'Targets about 35% of the remaining '+debt.toFixed(2)+' debt per win.':'After a loss, targets about 35% of debt per win.'}const cowBetStyleSelect=$('cowBetStyle');if(cowBetStyleSelect){cowBetStyleSelect.value=cowBetStyle;cowBetStyleSelect.addEventListener('change',()=>{cowBetStyle=cowBetStyleSelect.value;if(!['base','martingale','boosted','chase'].includes(cowBetStyle))cowBetStyle='base';if($('rangerAutoStyle'))$('rangerAutoStyle').value=cowBetStyle;try{localStorage.setItem('pasture-manual-bet-style',cowBetStyle)}catch{}updateCowBetStyleHint()})}function plannedCowStake(base,contract,state,style=cowBetStyle){const balance=Number(state&&state.balance),cap=balance>0?Math.floor(balance*.9*100)/100:0;if(!Number.isFinite(base)||base<=0)return{stake:0,reason:'Enter a stake greater than zero.'};if(cap<=0)return{stake:0,reason:'Account balance is unavailable; no bet was placed.'};const debt=Math.max(0,Number(sessionRecovery.amount)||0);let target=0;if(debt>.005&&style!=='base'){if(style==='boosted')target=debt+base*.5;else if(style==='chase')target=Math.min(debt,Math.max(base*.5,debt*.35));else target=debt}const b=Number(contract.barrier),over=String(contract.kind).toUpperCase()==='OVER',chance=over?(9-b)/10:b/10,payout=Number(contract.payout),net=payout>1?payout-1:Math.max(.05,.95/Math.max(.05,chance)-1),wanted=target>0?Math.max(base,target/net):base,stake=Math.round(wanted*100)/100;if(stake>cap+.001)return{stake:0,recoveryTarget:target,recoveryLimited:true,reason:'Required '+style+' stake is '+stake.toFixed(2)+', above the 90% balance limit of '+cap.toFixed(2)+'. Increase available balance or choose a lower-stake style; no bet was placed.'};return{stake,recoveryTarget:target,recoveryLimited:false}}// The Ghost Scout patrols on its own so it never freezes between paper trades.
// Only the client that owns the shared ghost simulates it; every other client
// eases toward the owner's broadcast position, so two clients never fight over
// the same shared actor.
function ghostPatrolOwner(){return !pastureSocket||!pastureLeaderId||pastureSelfId===pastureLeaderId}
function applyRemoteGhost(x,y){if(!ghostRemote){ghost.x=x;ghost.y=y}ghostRemote={x,y}}
function nextGhostPatrolPoint(){
  const herd=cows.filter(v=>v.alive);
  const cow=herd.length?herd[Math.floor(Math.random()*herd.length)]:null;
  if(cow&&Math.random()<.6){
    const angle=Math.random()*Math.PI*2,radius=120+Math.random()*70;
    return{x:Math.max(110,Math.min(980,cow.x+Math.cos(angle)*radius)),y:Math.max(130,Math.min(760,cow.y+Math.sin(angle)*radius))};
  }
  return{x:130+Math.random()*820,y:150+Math.random()*580};
}
function advanceGhostPatrol(now,dt){
  if(!ghostPatrolOwner()){ghostPatrol=null;ghostWalkPhase=0;return}
  if(!ghostPatrol){ghostPatrol={...nextGhostPatrolPoint(),pauseUntil:now+700+Math.random()*1500};ghostWalkPhase=0;return}
  if(now<ghostPatrol.pauseUntil){ghostWalkPhase=0;return}
  const dx=ghostPatrol.x-ghost.x,dy=ghostPatrol.y-ghost.y,dist=Math.hypot(dx,dy);
  if(dist<=2){
    Object.assign(ghostPatrol,nextGhostPatrolPoint(),{pauseUntil:now+900+Math.random()*2400});
    ghostWalkPhase=0;
    return;
  }
  const step=Math.min(dist,72*dt);
  ghost.x+=dx/dist*step;ghost.y+=dy/dist*step;
  if(Math.abs(dx)>.5)ghostWalkDir=dx<0?-1:1;
  ghostWalkPhase+=dt*9;
}
function moveToward(o,x,y,s,dt){let dx=x-o.x,dy=y-o.y,d=Math.hypot(dx,dy);if(d>2){const k=Math.min(d,s*dt)/d;o.x+=dx*k;o.y+=dy*k;return d}return 0}function findGhostCowSpot(source){
  // Pick an open location, rather than putting the visual copy on the live cow.
  const occupied=cows.filter(v=>v.alive).concat([ghost,player]);
  let best=null,bestClearance=-1;
  for(let i=0;i<48;i++){
    const angle=i*Math.PI*2/12, radius=145+Math.floor(i/12)*100;
    const x=Math.max(100,Math.min(790,source.x+Math.cos(angle)*radius));
    const y=Math.max(120,Math.min(730,source.y+Math.sin(angle)*radius));
    const clearance=Math.min(...occupied.map(v=>Math.hypot(x-v.x,y-v.y)));
    if(clearance>bestClearance){best={x,y};bestClearance=clearance}
  }
  return bestClearance>=125?best:null;
}
function separatePastureActors(){
  const herd=cows.filter(v=>v.alive);
  // Resolve overlap gently, without moving the player or interrupting a charge.
  for(let pass=0;pass<3;pass++)for(let i=0;i<herd.length;i++){
    const a=herd[i];
    for(let j=i+1;j<herd.length;j++){
      const b=herd[j];let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
      if(d>=125)continue;
      if(d<.01){dx=1;dy=0;d=1}
      const push=(125-d)/2,ux=dx/d,uy=dy/d;
      a.x=Math.max(75,Math.min(world.w-75,a.x-ux*push));a.y=Math.max(110,Math.min(world.h-100,a.y-uy*push));
      b.x=Math.max(75,Math.min(world.w-75,b.x+ux*push));b.y=Math.max(110,Math.min(world.h-100,b.y+uy*push));
    }
  }
}
function poly(points,fill,stroke){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=2;c.stroke()}}function rect(x,y,w,h,col){c.fillStyle=col;c.fillRect(x,y,w,h)}function circle(x,y,r,col){c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fillStyle=col;c.fill()}function trendArrow(x,y,up,color){c.fillStyle=color;c.beginPath();if(up){c.moveTo(x,y-6);c.lineTo(x+6,y);c.lineTo(x+2,y);c.lineTo(x+2,y+6);c.lineTo(x-2,y+6);c.lineTo(x-2,y);c.lineTo(x-6,y)}else{c.moveTo(x,y+6);c.lineTo(x+6,y);c.lineTo(x+2,y);c.lineTo(x+2,y-6);c.lineTo(x-2,y-6);c.lineTo(x-2,y);c.lineTo(x-6,y)}c.closePath();c.fill()}function tree(x,y){circle(x+8,y+13,24,'#213e26aa');rect(x-7,y-34,14,48,'#765039');poly([[x-48,y-44],[x-34,y-91],[x,y-114],[x+40,y-94],[x+52,y-45],[x+12,y-25],[x-27,y-28]],'#427e3e');poly([[x-36,y-53],[x-18,y-99],[x+11,y-107],[x+10,y-45]],'#57924a');poly([[x+10,y-105],[x+42,y-85],[x+50,y-45],[x+10,y-45]],'#356c37');poly([[x-48,y-44],[x-34,y-91],[x-3,y-73],[x-13,y-35]],'#659a4b');circle(x-21,y-70,6,'#7fac5d');circle(x+22,y-77,5,'#70a556')}; // Ranger visual state is derived from real movement, not destination distance.
// This avoids walking-in-place and rapid facing changes when auto mode waits.
const rangerAnim = {
  state: 'idle',
  previousX: player.x,
  previousY: player.y,
  speed: 0,
  facing: 1,
  headFacing: 1,
  walkTime: 0,
  idleStart: performance.now(),
  nextPatrol: 0,
  patrolWaiting: false,
  inspectUntil: 0,
  inspectCow: null,
  lookX: 0,
  lookY: 0,
  paperFocus: null,
  paperFocusUntil: 0
};

function rangerLookDirection(from, point) {
  if (!point) return { x: 0, y: 0 };
  const dx = point.x - from.x, dy = point.y - (from.y - 20);
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return { x: 0, y: 0 };
  return { x: dx / distance, y: dy / distance };
}

function rangerHeadFacing(current, horizontal) {
  return horizontal > .12 ? 1 : horizontal < -.12 ? -1 : current;
}

function updateRangerAnimation(now, dt) {
  const dx = player.x - rangerAnim.previousX;
  const dy = player.y - rangerAnim.previousY;
  const speed = Math.hypot(dx, dy) / Math.max(dt, 0.001);
  rangerAnim.speed += (speed - rangerAnim.speed) * Math.min(1, dt * 12);

  // Aiming takes priority only when the ranger has stopped moving.
  const moving = rangerAnim.speed > 8;
  const visualTarget = target && target.alive ? target : (rangerAutoServerOwned && rangerAutoServerVisualTarget && rangerAutoServerVisualTarget.alive ? rangerAutoServerVisualTarget : null); const aiming = !!visualTarget;
  const inspecting = !aiming && !moving && rangerAutoActive &&
    rangerAnim.inspectCow?.alive && now < rangerAnim.inspectUntil;
  const nextState = moving ? 'walking' : aiming ? 'aiming' : inspecting ? 'inspecting' : 'idle';

  if (nextState !== rangerAnim.state) {
    rangerAnim.state = nextState;
    if (nextState === 'idle' || nextState === 'inspecting') rangerAnim.idleStart = now;
  }

  if (aiming) {
    rangerAnim.facing = visualTarget.x < player.x ? -1 : 1;
  } else if (inspecting) {
    rangerAnim.facing = rangerAnim.inspectCow.x < player.x ? -1 : 1;
  } else if (moving && Math.abs(dx) > 0.2) {
    rangerAnim.facing = dx < 0 ? -1 : 1;
  }

  if (moving) rangerAnim.walkTime += dt * 10;
  const cam = camera();
  const pointer = hoverPoint ? { x: hoverPoint.x / zoom + cam.x, y: hoverPoint.y / zoom + cam.y } : null;
  const focus = now < rangerAnim.paperFocusUntil ? rangerAnim.paperFocus :
    aiming ? visualTarget : pointer || (inspecting ? rangerAnim.inspectCow : null);
  const look = rangerLookDirection(player, focus);
  const blend = Math.min(1, Math.max(0, dt) * 12);
  rangerAnim.lookX += (look.x - rangerAnim.lookX) * blend;
  rangerAnim.lookY += (look.y - rangerAnim.lookY) * blend;
  rangerAnim.headFacing = !focus && moving ? rangerAnim.facing : rangerHeadFacing(rangerAnim.headFacing, rangerAnim.lookX);
  rangerAnim.previousX = player.x;
  rangerAnim.previousY = player.y;
}
const manualPaperTrades = [];
const paperTelemetrySession = crypto.randomUUID();
const paperTelemetryQueue = [];
let paperTelemetryTimer = null, paperTelemetrySending = false, paperTelemetryOwner = false, paperTelemetryBlocked = false;
function flushPaperTelemetry() {
  paperTelemetryTimer = null;
  if (paperTelemetrySending || !paperTelemetryQueue.length || !paperTelemetryOwner || paperTelemetryBlocked || typeof fetch !== 'function') return;
  const events = paperTelemetryQueue.splice(0, 40);
  paperTelemetrySending = true;
  try {
    Promise.resolve(fetch('/api/telemetry/paper', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ events }) }))
      .then(response => {
        if (response.status === 401 || response.status === 403) {
          paperTelemetryBlocked = true;
          paperTelemetryQueue.length = 0;
        }
      })
      .catch(() => {}).finally(() => { paperTelemetrySending = false; if (paperTelemetryOwner && !paperTelemetryBlocked && paperTelemetryQueue.length && paperTelemetryTimer === null) paperTelemetryTimer = setTimeout(flushPaperTelemetry, 1000); });
  } catch { paperTelemetrySending = false; }
}
function sendPaperTelemetry(trade, source) {
  if (!paperTelemetryOwner || paperTelemetryBlocked || paperTelemetryQueue.length >= 200) return;
  paperTelemetryQueue.push({ eventId: `${paperTelemetrySession}:${trade.id}`, source, market: trade.symbol, direction: trade.direction, barrier: trade.barrier, status: trade.status, entryDigit: trade.entryDigit, exitDigit: trade.exitDigit, entryEpoch: trade.entryEpoch, entryQuote: trade.entryQuote, estWin: trade.estWin, edge: trade.edge, exitEpoch: trade.exitEpoch });
  if (paperTelemetryTimer === null) paperTelemetryTimer = setTimeout(flushPaperTelemetry, 1000);
}
const autoPaperStudies = new Map();
const manualPaperVisuals = [];
let manualPaperTradeSerial = 0;
let manualPaperNoticeId = null;
let manualPaperNoticeUntil = 0;
const paperVisualRoot = document.createElement('div');
paperVisualRoot.className = 'paper-visual-root';
paperVisualRoot.setAttribute('aria-hidden', 'true');
document.body.appendChild(paperVisualRoot);
const paperRangerBet = document.createElement('div');
paperRangerBet.className = 'paper-ranger-bet';
paperRangerBet.setAttribute('aria-live', 'polite');
paperRangerBet.setAttribute('aria-atomic', 'true');
paperRangerBet.hidden = true;
document.body.appendChild(paperRangerBet);
function paperTickKey(tick) {
  return `${tick.epoch}|${tick.quote}`;
}

function createManualPaperEntry(contract, tick, id, stake = 1, currency = 'USD') {
  const direction = String(contract?.kind || '').toLowerCase();
  if (!contract?.symbol || !['over', 'under'].includes(direction) ||
      !Number.isInteger(contract.barrier) || contract.barrier < 0 || contract.barrier > 9 ||
      !Number.isFinite(tick?.epoch) || !Number.isFinite(tick?.quote) ||
      !Number.isInteger(tick?.digit) || tick.digit < 0 || tick.digit > 9) return null;
  const quotedPayout = Number(contract.payout);
  const payoutMultiplier = Number.isFinite(quotedPayout) && quotedPayout > 1 ? quotedPayout : 2;
  return {
    id,
    virtualStake: Number.isFinite(stake) && stake > 0 ? stake : 1,
    virtualCurrency: currency || 'USD',
    virtualPayout: payoutMultiplier,
    virtualPayoutModelled: !(Number.isFinite(quotedPayout) && quotedPayout > 1),
    market: contract.market || contract.symbol,
    symbol: contract.symbol,
    direction,
    barrier: contract.barrier,
    entryEpoch: tick.epoch,
    entryQuote: tick.quote,
    estWin: Number.isFinite(contract.p) && contract.p >= 0 && contract.p <= 1 ? contract.p : null,
    edge: Number.isFinite(contract.edge) ? contract.edge : null,
    entryDigit: tick.digit,
    entryTickKey: paperTickKey(tick),
    status: 'open',
    exitDigit: null,
    exitEpoch: null,
  };
}

function manualPaperDigitWins(direction, barrier, digit) {
  return direction === 'over' ? digit > barrier : direction === 'under' ? digit < barrier : false;
}

function settleManualPaperTrades(trades, markets) {
  const settled = [];
  for (const trade of trades) {
    if (trade.status !== 'open') continue;
    const market = markets.find((item) => item.symbol === trade.symbol);
    const ticks = Array.isArray(market?.recentTicks) ? market.recentTicks : [];
    let entryIndex = -1;
    for (let index = ticks.length - 1; index >= 0; index--) {
      if (paperTickKey(ticks[index]) === trade.entryTickKey) {
        entryIndex = index;
        break;
      }
    }
    const nextTick = entryIndex >= 0
      ? ticks[entryIndex + 1]
      : ticks.find((tick) => tick.epoch > trade.entryEpoch);
    if (!Number.isInteger(nextTick?.digit) || nextTick.digit < 0 || nextTick.digit > 9) continue;
    trade.exitDigit = nextTick.digit;
    trade.exitEpoch = nextTick.epoch;
    trade.status = manualPaperDigitWins(trade.direction, trade.barrier, nextTick.digit) ? 'won' : 'lost';
    trade.profit = trade.status === 'won'
      ? trade.virtualStake * (trade.virtualPayout - 1)
      : -trade.virtualStake;
    settled.push(trade);
  }
  return settled;
}

function latestManualPaperTrade() {
  return manualPaperTrades[manualPaperTrades.length - 1] || null;
}

function createPaperTradeDetails(trade) {
  const details = document.createElement('div');
  details.className = 'paper-trade-details';
  const heading = document.createElement('strong');
  heading.className = 'paper-trade-heading';
  heading.textContent = trade.status === 'open' ? 'PAPER TRADE OPEN' : trade.status === 'won' ? 'PAPER WIN' : 'PAPER LOSS';
  const market = document.createElement('span');
  market.className = 'paper-trade-market';
  market.textContent = marketName(trade.symbol, lastRoomState);
  const prediction = document.createElement('span');
  prediction.className = 'paper-trade-prediction';
  prediction.textContent = `${trade.direction.toUpperCase()} ${trade.barrier}`;
  const digits = document.createElement('span');
  digits.className = 'paper-trade-digits';
  digits.textContent = trade.status === 'open' ? `Entry ${trade.entryDigit} · waiting for next tick` : `Entry ${trade.entryDigit} → exit ${trade.exitDigit}`;
  const pnl = document.createElement('strong');
  pnl.className = 'paper-trade-pnl';
  pnl.textContent = trade.status === 'open'
    ? `Virtual stake ${Number(trade.virtualStake || 0).toFixed(2)} ${trade.virtualCurrency || 'USD'}`
    : `Virtual P&L ${trade.profit >= 0 ? '+' : '−'}${Math.abs(Number(trade.profit || 0)).toFixed(2)} ${trade.virtualCurrency || 'USD'}`;
  const note = document.createElement('small');
  note.className = 'paper-trade-note';
  note.textContent = trade.virtualPayoutModelled ? 'REAL MARKET TICK · SIMULATED 1:1 PAYOUT · NO MONEY USED' : `REAL MARKET TICK · SIMULATED ${trade.virtualPayout.toFixed(2)}× PAYOUT · NO MONEY USED`;
  details.append(heading, market, prediction, digits, pnl, note);
  return details;
}

function renderManualPaperNotice(trade) {
  if (!trade) {
    paperRangerBet.hidden = true;
    return;
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', trade.status === 'open' ? 'M10 4h12M10 28h12M12 5c0 5 2 7 4 9 2-2 4-4 4-9M12 27c0-5 2-7 4-9 2 2 4 4 4 9' : trade.status === 'won' ? 'M5 16l7 7L27 8' : 'M8 8l16 16M24 8 8 24');
  svg.append(path);
  paperRangerBet.replaceChildren(svg);
  paperRangerBet.setAttribute('aria-label', trade.status === 'open' ? 'Paper trade waiting for result' : trade.status === 'won' ? 'Paper trade won' : 'Paper trade lost');
  paperRangerBet.dataset.phase = trade.status;
  paperRangerBet.hidden = false;
  scheduleManualPaperVisuals();
}

function paperFreshEntryTick(symbol) {
  const market = liveMarkets.find((item) => item.symbol === symbol);
  const age = Number.isFinite(market?.lastEpoch) ? Date.now() / 1000 - market.lastEpoch : Infinity;
  if (!market || market.fresh !== true || age < 0 || age >= 15) return null;
  const ticks = Array.isArray(market.recentTicks) ? market.recentTicks : [];
  const last = ticks[ticks.length - 1];
  if (last && last.epoch === market.lastEpoch && last.quote === market.lastQuote &&
      Number.isInteger(last.digit) && last.digit >= 0 && last.digit <= 9) return last;
  if (Number.isInteger(market.lastDigit) && market.lastDigit >= 0 && market.lastDigit <= 9) {
    return { epoch: market.lastEpoch, quote: market.lastQuote, digit: market.lastDigit };
  }
  return null;
}

function spawnPaperGhostVisual(trade, cowTarget, source) {
  const ghost = document.createElement('span');
  ghost.className = 'paper-ghost-cow';
  ghost.dataset.facing = (cowTarget.tx || cowTarget.x) < cowTarget.x ? 'left' : 'right';
  ghost.innerHTML = `<svg viewBox="-58 -40 120 92" aria-hidden="true" focusable="false">
    <path d="M-38 -4 Q-54 -10 -47 12" fill="none" stroke="#cbb99b" stroke-width="3" stroke-linecap="round"/>
    <path d="M-30 5h9v34h-9zM18 5h10v34H18z" fill="#b9ac97"/>
    <path d="M-30 35h11v5h-11zM17 35h12v5H17z" fill="#645044"/>
    <ellipse cx="-2" cy="-4" rx="38" ry="23" fill="#f0e4ce"/>
    <path d="M-30-15-16-25-3-19-6-4-20 5-33-3z" fill="#765140"/>
    <path d="M8-24 30-16 26 3 15 8 4-7z" fill="#654638"/>
    <path d="M34 1A36 36 0 0 1-35 6" fill="none" stroke="#c6bba9" stroke-width="2"/>
    <ellipse cx="36" cy="-8" rx="19" ry="18" transform="rotate(-11 36 -8)" fill="#e9ddc6"/>
    <path d="M25-21 16-27 19-12z" fill="#bc9e7d"/><path d="M43-20 53-27 52-10z" fill="#b9a187"/>
    <ellipse cx="45" cy="0" rx="13" ry="9" transform="rotate(9 45 0)" fill="#d9aaa2"/>
    <g fill="#775b55"><circle cx="40" cy="0" r="1.7"/><circle cx="48" cy="0" r="1.7"/></g>
    <g fill="#2a2823"><circle cx="38" cy="-14" r="2"/><circle cx="47" cy="-14" r="2"/></g>
  </svg>`;
  const arrow = document.createElement('span');
  arrow.className = 'paper-ghost-arrow';
  paperVisualRoot.append(arrow, ghost);
  manualPaperVisuals.push({ trade, ghost, arrow, source, target: cowTarget, startedAt: performance.now(), hit: false });
  scheduleManualPaperVisuals();
}

function beginManualPaperTrade(cowTarget, paperSource = 'manual_paper') {
  const contract = cowTarget?.contract;
  const tick = paperFreshEntryTick(contract?.symbol);
  if (!tick) {
    notify(`Paper trade unavailable: no fresh tick for ${contract?.symbol ? marketName(contract.symbol, lastRoomState) : 'this market'}. No trade opened.`);
    return false;
  }
  const trade = createManualPaperEntry(contract, tick, `manual-paper-${++manualPaperTradeSerial}`, selectedCowStake() || 1, betCurrency);
  if (!trade) {
    notify('Paper trade unavailable: this cow has no valid digit target. No trade opened.');
    return false;
  }
  if (manualPaperTrades.length >= 100) {
    const settledIndex = manualPaperTrades.findIndex((entry) => entry.status !== 'open');
    if (settledIndex < 0) {
      notify('Paper trade limit reached. Wait for a result before trying again.');
      return false;
    }
    manualPaperTrades.splice(settledIndex, 1);
  }
  trade.paperSource = paperSource === 'auto_paper' ? 'auto_paper' : 'manual_paper';
  trade.targetX = cowTarget.x;
  trade.targetY = cowTarget.y;
  rangerAnim.paperFocus = { x: cowTarget.x, y: cowTarget.y };
  rangerAnim.paperFocusUntil = performance.now() + 1200;
  const paperLook = rangerLookDirection(player, rangerAnim.paperFocus);
  rangerAnim.lookX = paperLook.x;
  rangerAnim.lookY = paperLook.y;
  rangerAnim.headFacing = rangerHeadFacing(rangerAnim.headFacing, paperLook.x);
  manualPaperTrades.push(trade);
  sendPaperTelemetry(trade, trade.paperSource || 'manual_paper');
  manualPaperNoticeId = trade.id;
  manualPaperNoticeUntil = 0;
  spawnPaperGhostVisual(trade, cowTarget, 'player');
  renderManualPaperNotice(trade);
  notify(`Paper trade open · ${marketName(trade.symbol, lastRoomState)} ${trade.direction.toUpperCase()} ${trade.barrier}. Waiting for the next tick. No money used.`, trade);
  return true;
}

function findCowAtClientPoint(clientX, clientY) {
  const cam = camera();
  const x = clientX / zoom + cam.x;
  const y = clientY / zoom + cam.y;
  return cows.filter((cow) => cow.alive && Math.hypot(x - cow.x, y - cow.y) < 55)
    .sort((a, b) => Math.hypot(x - a.x, y - a.y) - Math.hypot(x - b.x, y - b.y))[0] || null;
}

canvas.addEventListener('contextmenu', (event) => {
  if (ghostTraderAtClientPoint(event.clientX, event.clientY)) { event.preventDefault(); setGhostPanelOpen(!ghostPanelOpen); return; }
  const cowTarget = findCowAtClientPoint(event.clientX, event.clientY);
  if (!cowTarget) return;
  event.preventDefault();
  beginManualPaperTrade(cowTarget);
});

let paperLongPress = null;
const cancelPaperLongPress = () => {
  if (!paperLongPress) return;
  clearTimeout(paperLongPress.timer);
  paperLongPress = null;
};
canvas.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'touch') return;
  cancelPaperLongPress();
  const ghostTarget = ghostTraderAtClientPoint(event.clientX, event.clientY);
  const cowTarget = ghostTarget ? null : findCowAtClientPoint(event.clientX, event.clientY);
  if (!ghostTarget && !cowTarget) return;
  paperLongPress = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    timer: setTimeout(() => {
      if (!paperLongPress || (!ghostTarget && !cowTarget?.alive)) return;
      paperLongPress = null;
      suppressCanvasClickUntil = performance.now() + 850;
      if (ghostTarget) setGhostPanelOpen(!ghostPanelOpen); else beginManualPaperTrade(cowTarget);
    }, 650),
  };
});
canvas.addEventListener('pointermove', (event) => {
  if (!paperLongPress || event.pointerId !== paperLongPress.pointerId) return;
  if (Math.hypot(event.clientX - paperLongPress.x, event.clientY - paperLongPress.y) > 14) cancelPaperLongPress();
});
for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(eventName, cancelPaperLongPress);
}

function updateAutoPaperResearch(state) {
  paperTelemetryOwner = state?.owner === true;
  if (!paperTelemetryOwner) {
    paperTelemetryQueue.length = 0;
    if (paperTelemetryTimer !== null) { clearTimeout(paperTelemetryTimer); paperTelemetryTimer = null; }
  }
  const markets = Array.isArray(state.markets) ? state.markets : [];
  for (const study of autoPaperStudies.values()) {
    for (const trade of settleManualPaperTrades(study.trades, markets)) if (typeof sendPaperTelemetry === 'function') sendPaperTelemetry(trade, 'auto_paper');
  }
  if (rangerAutoActive && rangerPaperEnabled) {
    for (const contract of contracts) {
      if (!contract?.fresh || !Number.isFinite(contract.edge) || contract.edge <= 0 || contract.edge < rangerAutoMinEdge / 100 || Number(contract.p) < .70) continue;
      const market = markets.find(item => item.symbol === contract.symbol);
      const age = Date.now() / 1000 - Number(market?.lastEpoch);
      if (!market?.fresh || !Number.isFinite(age) || age < 0 || age >= 15) continue;
      const ticks = Array.isArray(market.recentTicks) ? market.recentTicks : [];
      const tick = ticks[ticks.length - 1];
      if (!tick || tick.epoch !== market.lastEpoch || tick.quote !== market.lastQuote) continue;
      const key = `${contract.symbol}|${contract.kind}|${contract.barrier}`;
      let study = autoPaperStudies.get(key);
      if (!study) {
        if (autoPaperStudies.size >= 24) continue;
        study = { market: contract.symbol, kind: contract.kind, barrier: contract.barrier, trades: [], lastTickKey: '' };
        autoPaperStudies.set(key, study);
      }
      const tickKey = paperTickKey(tick);
      if (study.trades.length >= rangerPaperCount || study.lastTickKey === tickKey || study.trades.some(trade => trade.status === 'open')) continue;
      const trade = createManualPaperEntry(contract, tick, `auto-research-${key}-${tickKey}`);
      if (!trade) continue;
      if (rangerAutoActive && rangerPaperEnabled && performance.now() - rangerLastPaperVisualAt >= 18000) {
        const targetCow = cows.filter(cow => cow !== ghostCow && cow.alive && cow.contract?.symbol === contract.symbol && cow.contract?.kind === contract.kind && cow.contract?.barrier === contract.barrier).sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y))[0];
        if (targetCow) { trade.targetX = targetCow.x; trade.targetY = targetCow.y; spawnPaperGhostVisual(trade, targetCow, 'player'); rangerLastPaperVisualAt = performance.now(); }
      }
      study.trades.push(trade);
      if (typeof sendPaperTelemetry === 'function') sendPaperTelemetry(trade, 'auto_paper');
      study.lastTickKey = tickKey;
    }
  }
  const studies = [...autoPaperStudies.values()];
  const settled = studies.flatMap(study => study.trades.filter(trade => trade.status !== 'open'));
  const wins = settled.filter(trade => trade.status === 'won').length;
  const qualified = studies.filter(study => {
    const results = study.trades.filter(trade => trade.status !== 'open');
    return results.length >= rangerPaperCount && results.filter(trade => trade.status === 'won').length / results.length * 100 >= rangerPaperWinTarget;
  }).length;
  const summary = !rangerPaperEnabled ? 'Paper testing is off.' : `${settled.length} settled across ${studies.length} setups | ${wins} wins | ${qualified} meet the research target (${rangerPaperCount} samples, ${rangerPaperWinTarget}% wins). Research only.`;
  const status = $('rangerPaperResearch'); if (status) status.textContent = summary;
  const ghostStatus = $('ghostAutoResearch'); if (ghostStatus) ghostStatus.textContent = summary;
  const list = $('ghostAutoResearchMarkets');
  if (list && !$('ghostTraderPanel')?.hidden) {
    const display = studies.slice(0, 24).map(study => {
      const results = study.trades.filter(trade => trade.status !== 'open');
      const winCount = results.filter(trade => trade.status === 'won').length;
      const rate = results.length ? Math.round(winCount * 100 / results.length) : null;
      const assessment = results.length < rangerPaperCount ? 'collecting' : rate >= rangerPaperWinTarget ? 'met research target' : 'below research target';
      return `${marketName(study.market, state)} ${study.kind} ${study.barrier}: ${winCount}W / ${results.length - winCount}L, ${results.length}/${rangerPaperCount} samples${rate === null ? '' : `, ${rate}% wins`} - ${assessment}`;
    });
    const key = JSON.stringify(display);
    if (updateAutoPaperResearch.lastDisplay !== key) {
      list.replaceChildren();
      for (const text of display) { const row = document.createElement('li'); row.textContent = text; list.append(row); }
      updateAutoPaperResearch.lastDisplay = key;
    }
  }

}

window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.source !== parent || !['zeronine:room-state', 'zeronine:room-market-state'].includes(event.data?.type)) return;
  const state = Object.assign({}, lastRoomState || {}, event.data.state || {});
  updateAutoPaperResearch(state);
  const settled = settleManualPaperTrades(manualPaperTrades, state.markets || []);
  if (!settled.length) return;
  const latest = latestManualPaperTrade();
  if (latest && settled.some((trade) => trade.id === latest.id)) {
    manualPaperNoticeId = latest.id;
    manualPaperNoticeUntil = performance.now() + 4200;
    renderManualPaperNotice(latest);
  }
  for (const trade of settled) {
    sendPaperTelemetry(trade, trade.paperSource || 'manual_paper');
    notify(`Paper ${trade.status === 'won' ? 'WIN' : 'LOSS'} · ${marketName(trade.symbol, lastRoomState)} ${trade.direction.toUpperCase()} ${trade.barrier} · ${trade.entryDigit} → ${trade.exitDigit}. No money used.`, trade);
  }
});

function paperResultPosition(anchorX, anchorY, width, height, bubble, viewWidth, viewHeight) {
  const margin = 8, gap = 8;
  const clampX = (x) => Math.max(margin, Math.min(viewWidth - width - margin, x));
  const clampY = (y) => Math.max(margin, Math.min(viewHeight - height - margin, y));
  let left = clampX(anchorX - width / 2);
  let top = clampY(anchorY - height);
  if (bubble && left < bubble.right + gap && left + width > bubble.left - gap && top < bubble.bottom + gap && top + height > bubble.top - gap) {
    const right = bubble.right + gap;
    const leftSide = bubble.left - gap - width;
    if (right + width <= viewWidth - margin) left = right;
    else if (leftSide >= margin) left = leftSide;
    else if (bubble.top - gap - height >= margin) top = bubble.top - gap - height;
    else top = clampY(bubble.bottom + gap);
  }
  return { left: left + width / 2, top: top + height };
}

let manualPaperVisualFrame = 0;
function scheduleManualPaperVisuals() {
  if (!manualPaperVisualFrame) manualPaperVisualFrame = requestAnimationFrame(renderManualPaperVisuals);
}
function renderManualPaperVisuals(now) {
  manualPaperVisualFrame = 0;
  const cam = camera();
  for (let index = manualPaperVisuals.length - 1; index >= 0; index--) {
    const visual = manualPaperVisuals[index];
    const actor = visual.source === 'scout' ? ghost : player;
    const playerX = (actor.x - cam.x) * zoom;
    const playerY = (actor.y - cam.y) * zoom;
    const elapsed = now - visual.startedAt;
    const targetX = visual.source === 'scout' && visual.target?.alive ? visual.target.x : visual.trade.targetX;
    const targetY = visual.source === 'scout' && visual.target?.alive ? visual.target.y : visual.trade.targetY;
    const cowX = (targetX - cam.x) * zoom;
    const cowY = (targetY - cam.y) * zoom;
    visual.ghost.style.left = `${cowX}px`;
    visual.ghost.style.top = `${cowY}px`;
    visual.ghost.style.width = `${120 * zoom}px`;
    if (!visual.hit) {
      const dx = cowX - playerX;
      const dy = cowY - playerY;
      visual.arrow.style.left = `${playerX}px`;
      visual.arrow.style.top = `${playerY - 8}px`;
      visual.arrow.style.width = `${Math.hypot(dx, dy)}px`;
      const progress = Math.min(1, Math.max(0, elapsed / 360));
      const eased = 1 - (1 - progress) ** 3;
      visual.arrow.style.transform = `rotate(${Math.atan2(dy, dx)}rad) scaleX(${eased})`;
      if (elapsed >= 360) {
        visual.hit = true;
        visual.arrow.classList.add('paper-arrow-hit');
        visual.ghost.classList.add('paper-ghost-killed');
      }
    }
    if (elapsed >= 1200) {
      visual.ghost.remove();
      visual.arrow.remove();
      manualPaperVisuals.splice(index, 1);
    }
  }
  const trade = manualPaperTrades.find((entry) => entry.id === manualPaperNoticeId);
  if (trade?.status !== 'open' && trade && now >= manualPaperNoticeUntil) {
    paperRangerBet.hidden = true;
    const open = manualPaperTrades.slice().reverse().find((entry) => entry.status === 'open');
    if (open) {
      manualPaperNoticeId = open.id;
      renderManualPaperNotice(open);
    }
  }
  if (trade || manualPaperTrades.some((entry) => entry.status === 'open')) {
    const visibleTrade = manualPaperTrades.find((entry) => entry.id === manualPaperNoticeId) || latestManualPaperTrade();
    const anchorX = (player.x - cam.x) * zoom;
    const anchorY = (player.y - 52 - cam.y) * zoom;
    const bubble = $('rangerBet');
    const bubbleRect = bubble?.classList.contains('visible') ? bubble.getBoundingClientRect() : null;
    const position = paperResultPosition(anchorX, anchorY, paperRangerBet.offsetWidth, paperRangerBet.offsetHeight, bubbleRect, W, H);
    paperRangerBet.style.left = `${position.left}px`;
    paperRangerBet.style.top = `${position.top}px`;
    if (visibleTrade?.status === 'open') paperRangerBet.hidden = false;
  }
  if (manualPaperVisuals.length || manualPaperTrades.some((entry) => entry.status === 'open') || (trade && now < manualPaperNoticeUntil)) scheduleManualPaperVisuals();
}

let pastureBestEdgeCow = null, pastureBestScoreCow = null;
function updatePastureHighlightTargets() {
  const bestEdge = contracts.reduce((best, item) => item.fresh === true && Number.isFinite(item.edge) && item.edge > 0 && (!best || item.edge > best.edge) ? item : best, null);
  const bestScore = contracts.reduce((best, item) => Number.isFinite(item.score) && Number.isFinite(item.payout) && (!best || item.score > best.score || (item.score === best.score && Number(item.p) > Number(best.p))) ? item : best, null);
  pastureBestEdgeCow = bestEdge ? cows.find(item => item !== ghostCow && item.alive && item.contract === bestEdge) || null : null;
  pastureBestScoreCow = bestScore ? cows.find(item => item !== ghostCow && item.alive && item.contract === bestScore) || null : null;
}
scheduleManualPaperVisuals();
function cow(v){if(!v.alive)return;const {x,y}=v;const bounce=Math.sin(performance.now()/850+x)*1.2;
c.save();c.translate(x,y+bounce);if(v===hoverCow&&v!==ghostCow){c.save();c.strokeStyle='#fff1a8';c.lineWidth=3;c.shadowColor='#ffe879';c.shadowBlur=12;c.beginPath();c.ellipse(0,18,53,22,0,0,Math.PI*2);c.stroke();c.restore()}c.fillStyle='#1a36236b';c.beginPath();c.ellipse(2,23,43,13,0,0,Math.PI*2);c.fill();
const edgeFeatured=v===pastureBestEdgeCow,signalFeatured=v!==ghostCow&&v.contract?.hitSignal===true,confidenceFeatured=v===pastureBestScoreCow,recoveryPick=v!==ghostCow&&!!recoveryRecommendation&&v.contract.symbol===recoveryRecommendation.symbol;
if(confidenceFeatured){c.save();c.strokeStyle='#ffe37b';c.lineWidth=4;c.shadowColor='#ffe37b';c.shadowBlur=12;c.beginPath();c.ellipse(0,20,51,19,0,0,Math.PI*2);c.stroke();c.restore();}if(signalFeatured){c.save();c.strokeStyle='#ff4057';c.lineWidth=4;c.shadowColor='#ff4057';c.shadowBlur=9;c.beginPath();c.ellipse(0,20,65,31,0,0,Math.PI*2);c.stroke();c.restore();}if(edgeFeatured){c.save();c.strokeStyle='#38ed86';c.lineWidth=4;c.shadowColor='#38ed86';c.shadowBlur=16;c.beginPath();c.ellipse(0,20,57,25,0,0,Math.PI*2);c.stroke();c.restore();}
c.save();c.scale(v===attackCow?(player.x<x?-1:1):((v.tx||x)<x?-1:1),1);
// legs behind body
const gait=(v===attackCow||Math.hypot((v.tx||v.x)-v.x,(v.ty||v.y)-v.y)>4)?Math.sin(performance.now()/140+x)*4:0;
rect(-30,5,9,34+gait,'#b9ac97');rect(18,5,10,34-gait,'#b9ac97');rect(-30,35+gait,11,5,'#645044');rect(17,35-gait,12,5,'#645044');
// rounded body
c.fillStyle=edgeFeatured?'#c8f2a7':confidenceFeatured?'#ffe28a':'#f0e4ce';c.beginPath();c.ellipse(-2,-4,38,23,0,0,Math.PI*2);c.fill();
poly([[-30,-15],[-16,-25],[-3,-19],[-6,-4],[-20,5],[-33,-3]],'#765140');poly([[8,-24],[30,-16],[26,3],[15,8],[4,-7]],'#654638');
// belly shade
c.strokeStyle='#c6bba9';c.lineWidth=2;c.beginPath();c.arc(-1,-4,36,.15,2.85);c.stroke();
// neck head, muzzle, horns and ears
c.fillStyle='#e9ddc6';c.beginPath();c.ellipse(36,-8,19,18,-.2,0,Math.PI*2);c.fill();
poly([[25,-21],[16,-27],[19,-12]],'#bc9e7d');poly([[43,-20],[53,-27],[52,-10]],'#b9a187');
c.fillStyle='#d9aaa2';c.beginPath();c.ellipse(45,0,13,9,.15,0,Math.PI*2);c.fill();circle(40,0,1.7,'#775b55');circle(48,0,1.7,'#775b55');circle(38,-14,2,'#2a2823');circle(47,-14,2,'#2a2823');
// tail
c.strokeStyle='#cbb99b';c.lineWidth=3;c.beginPath();c.moveTo(-38,-4);c.quadraticCurveTo(-54,-10,-47,12);c.stroke();
c.restore();
if(target===v){c.strokeStyle='#e9c15c';c.lineWidth=2;c.beginPath();c.ellipse(0,23,45,16,0,0,Math.PI*2);c.stroke()}
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           
const tag=v.contract,level=1+Math.floor(xp/150),damage=(v.entryStartHp||v.max)/(v.entryShots||rangerManualShots),ticksToTrade=Math.ceil(v.hp/damage),width=Math.min(184,Math.max(150,170/zoom)),trendUp=(tag.riseRate??.5)>=(tag.fallRate??.5),trendPct=Math.round((trendUp?tag.riseRate:tag.fallRate)*100),edge=Number.isFinite(tag.edge)?tag.edge:0,edgePositive=edge>=0,edgeStrong=edge>=.05,edgeColor=edgePositive?(edgeStrong?'#63ff9b':'#b7f2c3'):'#ff7a80',edgeBg=edgePositive?'rgba(22,83,49,.97)':'rgba(116,35,42,.97)',left=-width/2+7,right=width/2-7;const fit=(text,max,font=8)=>{c.font='800 '+font+'px Inter, system-ui';while(c.measureText(text).width>max&&font>6){font-=.25;c.font='800 '+font+'px Inter, system-ui'}return font};c.fillStyle='#312d28';c.fillRect(-25,-44,50,5);c.fillStyle=v.hp<=1?'#dd6862':'#76cb78';c.fillRect(-24,-43,48*v.hp/v.max,3);c.fillStyle=edgeFeatured?'rgba(15,91,54,.97)':confidenceFeatured?'rgba(105,73,22,.96)':tag.hitSignal?'rgba(96,31,36,.97)':'rgba(16,39,30,.94)';c.beginPath();c.roundRect(-width/2,-105,width,61,8);c.fill();c.strokeStyle=edgeFeatured?'#38ed86':confidenceFeatured?'#ffe37b':'rgba(237,220,185,.28)';c.lineWidth=edgeFeatured||confidenceFeatured?1.5:1;c.stroke();const marker=tag.hitSignal?'BET NOW':recoveryPick?'RECOV ~'+recoveryWinsEstimate+'W':'',marketText=v===ghostCow&&tag.symbol?marketName(tag.symbol,lastRoomState):String(tag.market||'Market'),markerW=marker?Math.max(30,marker.length*5+8):0;c.textAlign='left';c.fillStyle='#fff4cf';c.font='900 '+fit(marketText,width-(marker?markerW+20:14),8.5)+'px Inter, system-ui';c.fillText(marketText,left,-91);if(marker){c.fillStyle=tag.hitSignal?'#b42336':'#246847';c.beginPath();c.roundRect(right-markerW,-100,markerW,13,5);c.fill();c.textAlign='center';c.font='900 7px Inter, system-ui';c.fillStyle='#fff';c.fillText(marker,right-markerW/2,-91)}c.textAlign='left';c.font='900 8px Inter, system-ui';c.fillStyle=trendUp?'#55e38e':'#ff727a';trendArrow(left,-76,trendUp,c.fillStyle);c.fillStyle='#fff4cf';c.fillText(tag.kind+' '+tag.barrier,left+12,-73);c.textAlign='right';c.fillStyle='#e8eddf';c.font='800 7.5px Inter, system-ui';c.fillText(Math.round(tag.p*100)+'% CONF'+(v===target?' · '+(tag.fresh?'~'+ticksToTrade+' T':'TICK?'):''),right,-73);c.fillStyle=edgeBg;c.beginPath();c.roundRect(left,-67,48,15,5);c.fill();c.textAlign='center';c.font='900 8px Inter, system-ui';c.fillStyle=edgeColor;c.fillText((edgePositive?'+':'')+(edge*100).toFixed(1)+'% EDGE',left+24,-57);c.textAlign='left';c.fillStyle=trendUp?'#55e38e':'#ff727a';c.font='900 8px Inter, system-ui';c.fillText((trendUp?'↑':'↓')+' '+trendPct+'%',left+55,-57);c.textAlign='right';c.fillStyle='#d9e5d3';c.font='800 7.5px Inter, system-ui';c.fillText('L '+(tag.low??0)+' · H '+(tag.high??0),right,-57);c.restore();}const rangerAppearanceDefaults={outfit:'classic',color:'#326db1',accent:'#a65b38',headwear:'none',accessory:'none'};
function normalizeRangerAppearance(value){return{outfit:['classic','vest','scout','jacket','hoodie'].includes(value?.outfit)?value.outfit:'classic',color:/^#[0-9a-f]{6}$/i.test(value?.color)?value.color:rangerAppearanceDefaults.color,accent:/^#[0-9a-f]{6}$/i.test(value?.accent)?value.accent:rangerAppearanceDefaults.accent,headwear:['none','cap','bandana','hat','hood'].includes(value?.headwear)?value.headwear:'none',accessory:['none','scarf','badge','glasses','cape'].includes(value?.accessory)?value.accessory:'none'}}
let rangerAppearance={...rangerAppearanceDefaults};try{rangerAppearance=normalizeRangerAppearance(JSON.parse(localStorage.getItem('pasture-ranger-appearance')||'{}'))}catch{}
window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===parent&&event.data?.type==='zeronine:ranger-appearance')rangerAppearance=normalizeRangerAppearance(event.data.appearance)});
window.addEventListener('storage',event=>{if(!connectedAccount&&event.key==='pasture-ranger-appearance'){try{rangerAppearance=normalizeRangerAppearance(JSON.parse(event.newValue||'{}'))}catch{rangerAppearance={...rangerAppearanceDefaults}}}});
function avatar(){
  const {x,y}=player;
  const thinking=typeof window!=='undefined'&&!!window.__zeronineRanger?.thinking;
  const aiming=rangerAnim.state==='aiming';
  const walking=rangerAnim.state==='walking';
  const step=walking?Math.sin(rangerAnim.walkTime)*5:0;
  const face=rangerAnim.facing;
c.save();c.translate(x,y);c.scale(face,1);c.translate(-x,-y);
circle(x+2,y+21,18,'#14362570');
// boots and walking gait
rect(x-10,y+20+step,7,18,'#393a3d');rect(x+3,y+20-step,7,18,'#393a3d');rect(x-12,y+34+step,10,5,'#5d4530');rect(x+3,y+34-step,10,5,'#5d4530');
// Upper body rises gently while the feet remain grounded.
const breathe=(rangerAnim.state==='idle'||rangerAnim.state==='inspecting')&&!pastureReducedMotion?.matches?Math.sin((performance.now()-rangerAnim.idleStart)/700)*.8:0;c.save();c.translate(0,breathe);
// torso, belt, quiver
if(rangerAppearance.accessory==='cape')poly([[x-11,y-8],[x-19,y+25],[x+15,y+25],[x+10,y-8]],rangerAppearance.accent);
poly([[x-13,y-9],[x+11,y-9],[x+13,y+22],[x-12,y+22]],rangerAppearance.color,'#224470');if(rangerAppearance.outfit==='vest')poly([[x-12,y-8],[x-6,y-8],[x,y+13],[x+6,y-8],[x+11,y-8],[x+9,y+16],[x-10,y+16]],rangerAppearance.accent);if(rangerAppearance.outfit==='jacket')rect(x-1,y-8,3,24,rangerAppearance.accent);if(rangerAppearance.outfit==='hoodie')poly([[x-9,y-8],[x,y-2],[x+9,y-8],[x+6,y+1],[x,y+4],[x-6,y+1]],rangerAppearance.accent);if(rangerAppearance.outfit==='scout'){c.strokeStyle=rangerAppearance.accent;c.lineWidth=4;c.beginPath();c.moveTo(x-11,y-7);c.lineTo(x+10,y+14);c.stroke()}if(rangerAppearance.accessory==='scarf'){poly([[x-12,y-8],[x,y-4],[x+11,y-8],[x+11,y-4],[x,y],[x-12,y-4]],rangerAppearance.accent);rect(x+3,y-3,4,10,rangerAppearance.accent)}else if(rangerAppearance.accessory==='badge')circle(x+7,y-2,2.5,rangerAppearance.accent);rect(x-12,y+17,25,5,'#866338');
poly([[x-15,y-15],[x-21,y-27],[x-14,y-36],[x-7,y-25]],'#7c4934');for(let i=0;i<4;i++){c.strokeStyle='#d2c096';c.lineWidth=2;c.beginPath();c.moveTo(x-18+i*2,y-32);c.lineTo(x-21+i*2,y-43);c.stroke()}
// Counter the body's mirror so the head can face either direction independently.
const lookX=rangerAnim.lookX*face,lookY=rangerAnim.lookY,headFace=rangerAnim.headFacing,eyeX=rangerAnim.lookX*headFace;
c.save();c.translate(x+lookX*2,y-20+lookY);c.scale(headFace*face,1);c.rotate(eyeX*.12+(thinking?.2:0));
circle(0,0,11,'#cba17d');poly([[-11,-3],[-9,-11],[2,-15],[11,-10],[11,-3],[4,-8],[-5,-4]],'#4d3729');if(rangerAppearance.headwear==='cap'){poly([[-12,-8],[-9,-16],[2,-19],[10,-15],[12,-8]],rangerAppearance.accent);rect(-14,-9,28,3,rangerAppearance.accent)}else if(rangerAppearance.headwear==='bandana')poly([[-11,-8],[0,-11],[11,-8],[11,-4],[0,-7],[-11,-4]],rangerAppearance.accent);if(rangerAppearance.headwear==='hat'){rect(-15,-13,30,3,rangerAppearance.accent);rect(-9,-19,18,7,rangerAppearance.accent)}else if(rangerAppearance.headwear==='hood'){c.strokeStyle=rangerAppearance.accent;c.lineWidth=4;c.beginPath();c.arc(0,-1,12,Math.PI,Math.PI*2);c.stroke()}circle(2+eyeX*2,lookY*1.5,1.3,'#271f1d');circle(7+eyeX*2,lookY*1.5,1.3,'#271f1d');if(rangerAppearance.accessory==='glasses'){c.strokeStyle=rangerAppearance.accent;c.lineWidth=1.5;c.strokeRect(-1+eyeX*2,-3+lookY*1.5,7,6);c.strokeRect(6+eyeX*2,-3+lookY*1.5,7,6)}c.restore();
if(aiming&&!walking){c.strokeStyle='#c69b75';c.lineWidth=6;c.lineCap='round';c.beginPath();c.moveTo(x-9,y-4);c.lineTo(x+3,y+1);c.lineTo(x+12,y-6);c.moveTo(x+9,y-5);c.lineTo(x+22,y-8);c.stroke()}else if(thinking&&!walking){rect(x-16,y-3,6,20,'#c69b75');c.save();c.strokeStyle='#c69b75';c.lineWidth=6;c.lineCap='round';c.beginPath();c.moveTo(x+11,y+3);c.lineTo(x+16,y-7);c.lineTo(x+9,y-16);c.stroke();c.restore();c.fillStyle='#ffe19a';c.globalAlpha=.55+Math.sin(performance.now()/260)*.35;c.beginPath();c.arc(x+20,y-30,2,0,Math.PI*2);c.arc(x+26,y-36,1.6,0,Math.PI*2);c.arc(x+31,y-44,1.2,0,Math.PI*2);c.fill();c.globalAlpha=1}else{rect(x-16,y-3+step*.35,6,20,'#c69b75');rect(x+11,y-3-step*.35,6,18,'#c69b75')}
c.save();c.translate(x+15,y-5);c.rotate(target&&target.alive?Math.atan2(target.y-y,Math.abs(target.x-x)):0);c.strokeStyle='#bb874e';c.lineWidth=3;c.beginPath();c.arc(0,0,19,-Math.PI*.57,Math.PI*.57);c.stroke();c.strokeStyle='#f5e8c8';c.lineWidth=1;c.beginPath();c.moveTo(0,-19);c.lineTo(0,19);c.stroke();c.restore();c.restore();c.restore();}function ghostAvatar(){
  c.save();c.translate(ghost.x,ghost.y-(ghostWalkPhase?Math.sin(ghostWalkPhase)*1.6:0));c.scale(ghost.target?(ghost.target.x<ghost.x?-1:1):ghostWalkDir,1);c.globalAlpha=.78;if(hoverPoint&&ghostTraderAtClientPoint(hoverPoint.x,hoverPoint.y)){c.save();c.strokeStyle='#d6ffca';c.lineWidth=2;c.shadowColor='#a4ffc1';c.shadowBlur=12;c.beginPath();c.ellipse(0,35,27,10,0,0,Math.PI*2);c.stroke();c.restore()}
  c.shadowColor='#d7f5c4';c.shadowBlur=8;
  c.fillStyle='#c6e9bd';c.strokeStyle='#769f82';c.lineWidth=1.5;c.beginPath();c.moveTo(-13,-8);c.lineTo(12,-8);c.quadraticCurveTo(16,7,13,20);c.quadraticCurveTo(19,29,14,35);c.quadraticCurveTo(8,29,3,35);c.quadraticCurveTo(-2,28,-7,35);c.quadraticCurveTo(-15,29,-12,19);c.closePath();c.fill();c.stroke();
  c.shadowBlur=0;circle(0,-20,11,'#e4f4d5');poly([[-11,-23],[-9,-31],[2,-35],[11,-30],[11,-23],[4,-28],[-5,-24]],'#8aac85');circle(2,-20,1.3,'#315747');circle(7,-20,1.3,'#315747');
  c.strokeStyle='#a8d4a7';c.lineWidth=5;c.lineCap='round';c.beginPath();c.moveTo(-12,-3);c.lineTo(-14,12);c.moveTo(11,-3);c.lineTo(18,4);c.stroke();
  c.strokeStyle='#476b52';c.lineWidth=5;c.beginPath();c.arc(15,-5,19,-Math.PI*.57,Math.PI*.57);c.stroke();c.strokeStyle='#f5e5b6';c.lineWidth=2.5;c.beginPath();c.arc(15,-5,19,-Math.PI*.57,Math.PI*.57);c.stroke();c.strokeStyle='#f8f8de';c.lineWidth=1.5;c.beginPath();c.moveTo(11,-24);c.lineTo(11,14);c.stroke();c.restore();
}
let ghostWaitPath=null;
function drawGhostPaperWait(t){
  if(!ghostPaperState?.openContract)return;
  if(!ghostWaitPath)ghostWaitPath=new Path2D('M10 4h12M10 28h12M12 5c0 5 2 7 4 9 2-2 4-4 4-9M12 27c0-5 2-7 4-9 2 2 4 4 4 9');
  const overCow=Boolean(ghostTargetCow?.alive),anchor=overCow?ghostTargetCow:ghost;
  const bob=pastureReducedMotion?.matches?0:Math.sin(t/420)*2.2;
  c.save();c.translate(anchor.x-22,(anchor.y-(overCow?70:122))+bob);c.scale(1.35,1.35);c.strokeStyle='#ffe19a';c.lineWidth=3.2;c.lineCap='round';c.lineJoin='round';c.shadowColor='#5e4325';c.shadowBlur=3;c.stroke(ghostWaitPath);c.restore();
}
function drawGhostPaperBadge(){
  const paper=ghostPaperState,active=paper?.openContract,last=paper?.lastSettled,stats=ghostPaperStats(paper);
  const phase=active?'OPEN':last?.status==='won'?'WON':last?.status==='lost'?'LOST':paper?.phase==='running'?'SCANNING':'WAITING';
  const ratio=stats.rate===null?'--':stats.rate+'%';
  let badgeX=ghost.x,badgeY=ghost.y;
  // The badge is drawn in world space and can overlap the ranger when the
  // two characters are close. Keep the face clear while the Brain is open.
  if(brainZoomPrev!==null && Math.abs(badgeX-player.x)<78 && badgeY-77<player.y-8 && badgeY-48>player.y-32){
    badgeX=player.x+(ghost.x<player.x?-90:90);
  }
  c.save();c.fillStyle='rgba(22,53,39,.92)';c.strokeStyle='rgba(214,231,189,.55)';c.lineWidth=1;c.beginPath();c.roundRect(badgeX-63,badgeY-77,126,29,7);c.fill();c.stroke();c.textAlign='center';c.font='900 8px Inter, system-ui';c.fillStyle=phase==='WON'?'#a4f0b5':phase==='LOST'?'#ffb1b5':'#f7e8bb';c.fillText('PAPER SCOUT | '+phase,badgeX,badgeY-65,116);c.font='800 8px Inter, system-ui';c.fillStyle='#f4f1df';c.fillText(stats.wins+'W / '+stats.losses+'L | '+ratio+' WIN',badgeX,badgeY-54,116);c.restore();
}
let pastureBackground=null;function paintPastureBackground(ctx){const previousContext=c;c=ctx;try{c.fillStyle='#53894b';c.fillRect(0,0,world.w,world.h);rect(0,0,world.w,world.h,'#53894b');for(let y=0;y<world.h;y+=90)for(let x=0;x<world.w;x+=90){circle(x+(y%3)*12,y+10,2,'#7fa65d');circle(x+23,y+30,2,'#84a96a');rect(x+42,y+59,8,2,'#76a45d');if((x*3+y*7)%11<4){circle(x+32,y+18,2.5,'#f6e3ab');circle(x+35,y+18,2,'#f9b9a8');circle(x+33,y+21,1,'#fff6d6')}if((x+y)%4===0){c.strokeStyle='#3b7742';c.lineWidth=2;c.beginPath();c.moveTo(x+62,y+70);c.lineTo(x+60,y+61);c.lineTo(x+66,y+66);c.stroke()}}poly([[850,0],[1050,0],[1050,world.h],[840,world.h],[805,600],[840,380]],'#ba9b6d');for(let x=45;x<world.w;x+=77){rect(x,68,7,35,'#7a5137');rect(x,world.h-80,7,35,'#7a5137')}rect(35,75,world.w-70,8,'#946847');rect(35,world.h-70,world.w-70,8,'#946847');for(let y=105;y<world.h-72;y+=76){rect(55,y,8,38,'#7a5137');rect(world.w-70,y,8,38,'#7a5137')}rect(55,118,7,world.h-210,'#946847');rect(world.w-65,118,7,world.h-210,'#946847');[[95,160],[1155,165],[145,730],[1205,705],[720,90],[340,90]].forEach(([x,y])=>tree(x,y));[[390,165],[740,540],[320,680],[550,350],[1010,715]].forEach(([x,y])=>poly([[x-15,y+13],[x-22,y],[x-10,y-13],[x+12,y-9],[x+19,y+6]],'#8d988b'));}finally{c=previousContext}}function getPastureBackground(){if(pastureBackground)return pastureBackground;const background=document.createElement('canvas');background.width=world.w;background.height=world.h;const context=background.getContext('2d');if(!context)return null;paintPastureBackground(context);pastureBackground=background;return pastureBackground}function advanceFloatingEffects(now,dt){for(const effect of fx){if(!Number.isFinite(effect.expiresAt))effect.expiresAt=now+effect.life*1000;effect.y-=22*dt;effect.life=Math.max(0,(effect.expiresAt-now)/1000)}fx=fx.filter(effect=>effect.life>0)}function pastureWeatherTargets(isDay,code){return{night:isDay===0?1:0,rain:(code>=51&&code<=67)||(code>=80&&code<=82)||(code>=95&&code<=99)?1:0}}
const pastureReducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)');
let pastureNight=0,pastureRain=0,pastureWeatherLastFrame=0,pastureWeatherTarget=pastureWeatherTargets(Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Jamaica',hour:'numeric',hourCycle:'h23'}).format(new Date()))>=6&&Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Jamaica',hour:'numeric',hourCycle:'h23'}).format(new Date()))<18?1:0,0);
function drawPastureWeather(t){const elapsed=pastureWeatherLastFrame?Math.min(1000,Math.max(0,t-pastureWeatherLastFrame)):16;pastureWeatherLastFrame=t;const blend=1-Math.exp(-elapsed/1200);pastureNight+=(pastureWeatherTarget.night-pastureNight)*blend;pastureRain+=(pastureWeatherTarget.rain-pastureRain)*blend;c.save();if(pastureNight>.001){c.fillStyle='rgba(12, 27, 60, '+(pastureNight*.38)+')';c.fillRect(0,0,world.w,world.h)}if(pastureRain>.001){c.fillStyle='rgba(39, 68, 78, '+(pastureRain*.12)+')';c.fillRect(0,0,world.w,world.h);c.globalAlpha=pastureRain*.42;c.strokeStyle='#d5f4ff';c.lineWidth=1.4;c.beginPath();const motion=pastureReducedMotion?.matches?0:t*.24;for(let i=0;i<60;i++){const x=(i*193+37)%world.w,y=(i*137+motion)%world.h;c.moveTo(x,y);c.lineTo(x-5,y+13)}c.stroke()}c.restore()}
let pastureDrawDurationMs = 0;
function draw(t){const drawStartedAt=pasturePerfEnabled?performance.now():0;const cam=camera();if(hoverPoint&&t-lastHoverResolveAt>=80){lastHoverResolveAt=t;const hx=hoverPoint.x/zoom+cam.x,hy=hoverPoint.y/zoom+cam.y;hoverCow=cows.filter(v=>v.alive&&Math.hypot(hx-v.x,hy-v.y)<55).sort((a,b)=>Math.hypot(hx-a.x,hy-a.y)-Math.hypot(hx-b.x,hy-b.y))[0]||null}else if(!hoverPoint)hoverCow=null;const cursor=hoverPoint&&(ghostTraderAtClientPoint(hoverPoint.x,hoverPoint.y)||hoverCow)?'pointer':'default';if(canvas.style.cursor!==cursor)canvas.style.cursor=cursor;c.fillStyle='#53894b';c.fillRect(0,0,W,H);c.save();c.scale(zoom,zoom);c.translate(-cam.x,-cam.y);const background=getPastureBackground();if(background)c.drawImage(background,0,0);else paintPastureBackground(c);drawPastureWeather(t);cows.forEach(cow);if(ghostCow&&ghostCow.alive){c.save();c.globalAlpha=.38;cow(ghostCow);c.restore()}ghostArrows.forEach(s=>{c.strokeStyle='#d6fdf3';c.lineWidth=3;c.beginPath();c.moveTo(s.x,s.y);c.lineTo(s.x-s.vx*.04,s.y-s.vy*.04);c.stroke()});shots.forEach(s=>{c.strokeStyle='#fff2c9';c.lineWidth=3;c.beginPath();c.moveTo(s.x,s.y);c.lineTo(s.x-s.vx*.035,s.y-s.vy*.035);c.stroke()});fx.forEach(f=>{c.globalAlpha=Math.max(0,f.life/.65);c.textAlign='center';c.font='bold '+(f.size||18)+'px Inter, system-ui';c.fillStyle=f.color||'#fff5a9';c.fillText(f.text,f.x,f.y);c.globalAlpha=1});avatar();drawRemoteShots(t);drawRemoteKills(t);drawRemotePlayers(t);ghostAvatar();drawGhostPaperWait(t);drawGhostPaperBadge();drawPastureSpeech(t);c.restore();positionRangerBet(cam, t);if(pasturePerfEnabled)pastureDrawDurationMs=performance.now()-drawStartedAt;requestAnimationFrame(frame)}
const pasturePerfEnabled=new URLSearchParams(location.search).get('perf')==='1';
let pasturePerfFrames=0,pasturePerfSlowFrames=0,pasturePerfFrameTotal=0,pasturePerfFrameMax=0,pasturePerfDrawTotal=0,pasturePerfLastAt=0,pasturePerfLastLogAt=0;
function recordPasturePerformance(startedAt,now){const frameMs=performance.now()-startedAt,frameGap=pasturePerfLastAt?now-pasturePerfLastAt:0;pasturePerfLastAt=now;pasturePerfFrames++;pasturePerfFrameTotal+=frameMs;pasturePerfDrawTotal+=pastureDrawDurationMs;pasturePerfFrameMax=Math.max(pasturePerfFrameMax,frameMs);if(frameGap>24||frameMs>24)pasturePerfSlowFrames++;if(now-pasturePerfLastLogAt>=5000){const stats={frames:pasturePerfFrames,avgFrameMs:+(pasturePerfFrameTotal/Math.max(1,pasturePerfFrames)).toFixed(2),avgDrawMs:+(pasturePerfDrawTotal/Math.max(1,pasturePerfFrames)).toFixed(2),maxFrameMs:+pasturePerfFrameMax.toFixed(2),slowFrames:pasturePerfSlowFrames};window.__pasturePerf=stats;console.info('[Pasture performance]',stats);pasturePerfFrames=0;pasturePerfSlowFrames=0;pasturePerfFrameTotal=0;pasturePerfDrawTotal=0;pasturePerfFrameMax=0;pasturePerfLastLogAt=now}}
let prev=performance.now(),lastUiWorkAt=0,lastHoverResolveAt=0,lastCooldownSecond=-1;function frame(now){const perfStartedAt=pasturePerfEnabled?performance.now():0;zoom+=(zoomGoal-zoom)*.16;let dt=Math.min(.05,(now-prev)/1000);prev=now;if(now-lastUiWorkAt>=100){lastUiWorkAt=now;refreshBetIndicator();watchAim(now);updateHealthUi();if(rangerAutoActive)updateRangerAutomation()}if(!connectedAccount&&target){target=null;shots=[]}const levelNow=1+Math.floor(xp/150);for(const v of cows){if(!v.alive){if(now>=v.respawn){v.alive=true;v.max=3+Math.min(2,Math.floor(xp/150));v.hp=v.max;updatePastureHighlightTargets()}continue}if(now>v.roam){v.roam=now+2000+Math.random()*2500;v.tx=Math.max(100,Math.min(790,v.x+(Math.random()-.5)*100));v.ty=Math.max(120,Math.min(730,v.y+(Math.random()-.5)*110))}moveToward(v,v.tx,v.ty,12,dt)}if(attackCow&&attackCow.alive){moveToward(attackCow,player.x,player.y,125,dt);if(Math.hypot(attackCow.x-player.x,attackCow.y-player.y)<40){playerHp=Math.max(0,playerHp-1);$('hearts').textContent=playerHp+' hearts';fx.push({x:player.x,y:player.y-48,life:.9,text:'HIT!'});attackCow=null}else if(now>=attackUntil){recordMission('dodges');fx.push({x:player.x,y:player.y-48,life:.9,text:'DODGED'});attackCow=null}}if(heldKeys.size||touchMove.x||touchMove.y){const kx=(heldKeys.has('arrowright')||heldKeys.has('d')?1:0)-(heldKeys.has('arrowleft')||heldKeys.has('a')?1:0)+touchMove.x,ky=(heldKeys.has('arrowdown')||heldKeys.has('s')?1:0)-(heldKeys.has('arrowup')||heldKeys.has('w')?1:0)+touchMove.y,len=Math.hypot(kx,ky);if(len){target=null;player.x=Math.max(65,Math.min(world.w-65,player.x+kx/len*245*dt));player.y=Math.max(110,Math.min(world.h-100,player.y+ky/len*245*dt));player.tx=player.x+kx;player.ty=player.y+ky}}if(target&&target.alive){let d=Math.hypot(target.x-player.x,target.y-player.y);if(d>175){const moved=moveToward(player,target.x,target.y,rangerAutoActive?420:200,dt);if(moved>0)aimLastProgressAt=now}const tickSequence=marketTickSequences.get(target.contract.symbol)||0,brainWait=Number.isFinite(target.tradeIntent?.brainEntry)&&tickSequence<target.tradeIntent.brainEntry;if(d>175){target.lastShotTickSeq=tickSequence}else if(!brainWait&&rangerShotReady(!!connectedAccount,tickSequence,target.lastShotTickSeq,now,lastShot)){if(connectedAccount)target.lastShotTickSeq=tickSequence;if(connectedAccount&&target.tradeIntent&&!target.tradeIntent.rangerAutomation&&!target.tradeIntent.locked){const reason=lockManualFirstTick(target);if(reason){rangerBet={...rangerBet,phase:'rejected',reason};renderRangerBet();notify(reason+' No trade placed.');target=null}else{rangerBet={...rangerBet,market:target.tradeIntent.contract.market,symbol:target.tradeIntent.contract.symbol,direction:target.tradeIntent.contract.kind,barrier:target.tradeIntent.contract.barrier,edge:target.tradeIntent.contract.edge};renderRangerBet()}}if(target){lastShot=now;aimLastProgressAt=now;let dx=target.x-player.x,dy=target.y-player.y,dist=Math.hypot(dx,dy)||1;player.dir=Math.atan2(dy,dx);sendPasture({type:'shot',x:target.x,y:target.y});shots.push({x:player.x,y:player.y-8,vx:dx/dist*430,vy:dy/dist*430,target,edge:Number(target.contract.edge)||0})}}}else{target=null;if(rangerAutoActive&&!heldKeys.size&&!touchMove.x&&!touchMove.y){
  const distance=Math.hypot(player.tx-player.x,player.ty-player.y);
  if(distance<18&&!rangerAnim.patrolWaiting){
    // Arrived: stop, look at a nearby cow sometimes, then resume patrol.
    rangerAnim.patrolWaiting=true;
    rangerAutoPatrolAt=now+2000+Math.random()*3000;
    rangerAnim.inspectCow=Math.random()<0.45
      ? cows.find(cow=>cow.alive&&cow!==ghostCow&&Math.hypot(cow.x-player.x,cow.y-player.y)<150)||null
      : null;
    rangerAnim.inspectUntil=rangerAutoPatrolAt;
  }
  if(rangerAnim.patrolWaiting&&now>=rangerAutoPatrolAt){
    const nearCow=cows.find(cow=>cow.alive&&cow!==ghostCow&&Math.hypot(cow.x-player.x,cow.y-player.y)<130);
    const waypoint=rangerPatrolPoint(player,cows,world,nearCow||ghostCow);
    player.tx=waypoint.x;
    player.ty=waypoint.y;
    rangerAnim.patrolWaiting=false;
    rangerAnim.inspectCow=null;
  }
}moveToward(player,player.tx,player.ty,rangerAutoActive?360:175,dt)}for(let i=shots.length-1;i>=0;i--){let s=shots[i];s.x+=s.vx*dt;s.y+=s.vy*dt;if(!s.target.alive||Math.hypot(s.x-s.target.x,s.y-s.target.y)<18){shots.splice(i,1);if(!s.target.alive||!connectedAccount)continue;aimLastProgressAt=now;const highEdge=Number(s.edge)>=.06;const damage=rangerDamageForShots(s.target.hp,s.target.entryStartHp||s.target.max,s.target.entryShots||rangerManualShots);s.target.hp-=damage;fx.push({x:s.target.x,y:s.target.y-38,life:.65,text:s.target.hp<=0?'KILL':'HIT'});if(s.target.hp<=0.000001){s.target.alive=false;s.target.respawn=now+2600;updatePastureHighlightTargets();if(s.target.serverAutoVisual)rangerAutoServerVisualConsumedId=String(rangerAutoServerState?.lastSubmittedTrade?.contractId||'');target=null;sendPasture({type:"kill",x:s.target.x,y:s.target.y});applySavedKill(now<lockUntil);persistKill(now<lockUntil);if(!s.target.serverAutoVisual)onCowDefeated(s.target);$('kills').textContent=kills;$('xptext').textContent=xp;$('nextLevelXp').textContent=150-(xp%150);const lv=1+Math.floor(xp/150);$('lvl').textContent=lv;$('xpbar').style.width=`${xp%150/150*100}%`}}else if(s.x<0||s.x>world.w||s.y<0||s.y>world.h)shots.splice(i,1)}advanceFloatingEffects(now,dt);if(ghostPatrolOwner()){if(ghostPaperState?.openContract&&ghostTargetCow?.alive){ghostWalkPhase=0;moveToward(ghost,ghostTargetCow.x-96,ghostTargetCow.y+9,240,dt);const seq=marketTickSequences.get(ghostPaperState.openContract.market)||0;if(seq>ghostLastTickSeq){ghostLastTickSeq=seq;const dx=ghostTargetCow.x-ghost.x,dy=ghostTargetCow.y-ghost.y,d=Math.hypot(dx,dy)||1;ghostArrows.push({x:ghost.x,y:ghost.y-8,vx:dx/d*360,vy:dy/d*360,target:ghostTargetCow})}}else advanceGhostPatrol(now,dt);}else if(ghostRemote){const k=Math.min(1,dt*9);ghost.x+=(ghostRemote.x-ghost.x)*k;ghost.y+=(ghostRemote.y-ghost.y)*k;ghostWalkDir=ghostRemote.x<ghost.x?-1:1}if(!ghostPaperState?.openContract&&now>ghostPaperResultUntil)ghostCow=null;for(let i=ghostArrows.length-1;i>=0;i--){const arrow=ghostArrows[i];arrow.x+=arrow.vx*dt;arrow.y+=arrow.vy*dt;if(!arrow.target.alive||Math.hypot(arrow.x-arrow.target.x,arrow.y-arrow.target.y)<20){ghostArrows.splice(i,1);if(arrow.target.alive)fx.push({x:arrow.target.x,y:arrow.target.y-42,life:.48,size:9,text:'PAPER'})}else if(arrow.x<0||arrow.x>world.w||arrow.y<0||arrow.y>world.h)ghostArrows.splice(i,1)} separatePastureActors();updateRangerAnimation(now,dt);const rem=Math.max(0,Math.ceil((lockUntil-now)/1000));if(rem!==lastCooldownSecond){lastCooldownSecond=rem;$('cooldown').textContent=rem?`${rem}s ${cooldownReason}`:'READY';const timerWasVisible=$('breakTimer').classList.contains('visible');$('breakTimer').classList.toggle('visible',rem>0);if(rem&&!timerWasVisible)restoreHud();$('breakSeconds').textContent=`${Math.floor(rem/60)}:${String(rem%60).padStart(2,'0')}`;}draw(now);if(pasturePerfEnabled)recordPasturePerformance(perfStartedAt,now)}requestAnimationFrame(frame);function selectedManualMinEdge(){const raw=$('manualMinEdge')?.value?.trim()??'';if(!raw)return null;const value=Number(raw);return Number.isFinite(value)&&value>=0&&value<=100?value/100:NaN}const manualEdgeInput=$('manualMinEdge');if(manualEdgeInput){try{const saved=localStorage.getItem('pasture-manual-min-edge');if(saved!==null&&Number.isFinite(Number(saved))&&Number(saved)>=0&&Number(saved)<=100)manualEdgeInput.value=saved}catch{}manualEdgeInput.addEventListener('change',()=>{const value=selectedManualMinEdge();if(Number.isNaN(value)){notify('Minimum edge must be between 0 and 100%, or blank to turn it off.');return}try{if(value===null)localStorage.removeItem('pasture-manual-min-edge');else localStorage.setItem('pasture-manual-min-edge',manualEdgeInput.value)}catch{}})}function selectedCowStake(){const raw=$('cowStake').value;const amount=Number(raw);return typeof raw==='string'&&raw.trim()!==''&&Number.isFinite(amount)&&amount>0?amount:null}
function marketCooldownSeconds(probability){const p=Number.isFinite(probability)?Math.max(0,Math.min(1,probability)):.5;return Math.round(Math.max(10,Math.min(45,10+(.8-p)*50)))}
function startTradeCooldown(){
  // Automated trades pause only after the configured consecutive-loss threshold.
  // Preserve the existing submission cooldown for manual trades.
  if(rangerBet?.rangerAutomation)return;
  const p=rangerBet?.hitProbability??.5;
  const seconds=marketCooldownSeconds(p);
  cooldownReason=p>=.75?'HIGH':p<.55?'LOW':'MARKET';
  lockUntil=Math.max(lockUntil,performance.now()+seconds*1000);
}
function noteCooldownAttempt(){if(cooldownAttemptRegistered)return;if(lossCooldownStreak>0)attemptsSinceLoss++;cooldownAttemptRegistered=true}
function settleCooldown(trade){
  if(!['won','lost'].includes(trade.status)||cooldownTradeId===trade.id)return;
  cooldownTradeId=trade.id;

  // Automation: only cool down after the configured consecutive-loss threshold.
  const automated=rangerAutoTradeIds.has(trade.id)||rangerBet?.rangerAutomation===true;
  if(automated){
    if(trade.status==='won'){
      rangerAutoLossStreak=0;
      cooldownReason='MARKET';
      return;
    }
    rangerAutoLossStreak+=1;
    if(rangerAutoLossStreak>=rangerAutoLossLimit){
      const seconds=rangerAutoCooldownSeconds;
      cooldownReason=rangerAutoLossLimit+' CONSECUTIVE LOSSES';
      lockUntil=Math.max(lockUntil,performance.now()+seconds*1000);
      rangerRiskNoteCooldown(seconds);
      rangerAutoLossStreak=0;
    }
    return;
  }

  // Keep the original manual-trading cooldown behavior.
  if(trade.status==='won'){
    lossCooldownStreak=0;
    attemptsSinceLoss=6;
    cooldownReason='MARKET';
    return;
  }
  lossCooldownStreak=lossCooldownStreak>0&&attemptsSinceLoss>=1&&attemptsSinceLoss<=5?lossCooldownStreak+1:1;
  attemptsSinceLoss=0;
  const seconds=marketCooldownSeconds(rangerBet?.hitProbability)+15*lossCooldownStreak;
  cooldownReason='LOSS '+lossCooldownStreak;
  lockUntil=Math.max(lockUntil,performance.now()+seconds*1000);
}
function submitContract(contract,stakeOverride,styleOverride=cowBetStyle,rangerAutomation=false,minEdge=null,brainPick=false){const automationRunId=rangerAutomation?(rangerBet?.rangerAutoRunId??rangerAutoRunId):null;rangerBetSerial++;cooldownAttemptRegistered=false;$('rangerBet').classList.remove('fade-out');const stake=stakeOverride===undefined?selectedCowStake():stakeOverride;rangerBubbleDismissed=false;rangerBet={phase:stake===null?'rejected':'submitting',market:contract?.market,symbol:contract?.symbol,direction:contract?.kind,barrier:contract?.barrier,stake,betStyle:styleOverride,hitProbability:contract?.p,edge:contract?.edge,recoveryWins:estimateRecoveryWins(contract),rangerAutomation,rangerAutoRunId:automationRunId};trackedTradeId=null;renderRangerBet();if(stake===null){pending=null;notify('Enter a stake greater than zero in Markets. No trade placed.');const serial=rangerBetSerial;setTimeout(()=>{if(serial===rangerBetSerial&&rangerBet?.phase==='rejected'){rangerBet=null;renderRangerBet()}},10000);return;}if(!contract?.symbol){pending=null;rangerBet={...rangerBet,phase:'rejected'};renderRangerBet();notify('No live market symbol - no bet was placed. You can keep playing.');return;}const quote=quoteFreshness(contract.symbol);if(!quote.fresh){pending=null;rangerBet={...rangerBet,phase:'rejected',stale:true,edge:contract.edge};renderRangerBet();notify('Market feed stale - no bet placed. Select the cow again after a fresh tick.');const serial=rangerBetSerial;setTimeout(()=>{if(serial===rangerBetSerial&&rangerBet?.phase==='rejected'){rangerBet=null;renderRangerBet()}},10000);return;}const pendingNode=$('pendingBet'),meta=$('pendingMeta');if(pendingNode)pendingNode.textContent=`${contract.kind} ${contract.barrier} - ${contract.market}`;if(meta)meta.textContent='Submitting trade request';document.querySelector('.bet-state')?.classList.add('pending');parent.postMessage({type:'zeronine:room-select-market',payload:{market:contract.symbol}},location.origin);replayAttempt={id:String(aimStartedAt)+'-'+String(rangerBetSerial)+'-'+Math.random().toString(36).slice(2),accountId:activeAccountId,aim:aimStartedAt,confirmedId:null};parent.postMessage({type:'zeronine:room-trade',payload:{replayAttemptId:replayAttempt.id,direction:contract.kind==='OVER'?'over':'under',barrier:contract.barrier,stake,market:contract.symbol,rangerAutomation,minEdge,cowDisplay:{edge:contract.edge,confidence:contract.p,shownAt:Date.now(),brainPick:brainPick===true,shotTick:(liveMarkets.find(m=>m.symbol===contract.symbol)?.recentTicks||[]).slice(-1)[0]||null}}},location.origin);}function lockManualFirstTick(cow){const intent=cow?.tradeIntent,locked=cow?.contract;if(!intent||!locked?.symbol||!quoteFreshness(locked.symbol).fresh||lastRoomState?.feedConnected!==true)return 'Market feed is stale';if(Number(intent.minEdge)>0&&(!Number.isFinite(locked.edge)||locked.edge<Number(intent.minEdge)))return 'Cow edge is below your manual minimum';intent.contract={...locked};intent.locked=true;return ''}function onCowDefeated(v){if(!connectedAccount){rangerBubbleDismissed=false;rangerBet={phase:'practice',market:v.contract.market,direction:v.contract.kind,barrier:v.contract.barrier};renderRangerBet();notify('Guest play: no bet placed. Connect Deriv to trade.');return}if(pending||performance.now()<lockUntil){if(rangerBet?.phase==='aiming'){rangerBet={phase:'rejected',market:v.contract.market,direction:v.contract.kind,barrier:v.contract.barrier,stake:v.tradeIntent?.stake};renderRangerBet()}notify(pending?'Trade already sending - no additional bet placed.':'Cooldown active - cow defeated, no bet placed.');return}const intent=v.tradeIntent;if(!intent||intent.accountId!==activeAccountId){pending=null;rangerBet={...rangerBet,phase:'rejected'};renderRangerBet();notify('Account changed or target not selected. No trade placed.');return;}if(!intent.rangerAutomation&&!intent.locked){rangerBet={...rangerBet,phase:'rejected',reason:'No fresh shooting tick'};renderRangerBet();notify('No fresh shooting tick. No trade placed.');return}const brainCheck=brainEntryCheck(v);
if(brainCheck&&brainCheck.code!=='held'&&!(intent.rangerAutomation&&brainCheck.code!=='stale')){brainSnipe=null;rangerBet={...rangerBet,phase:'rejected',reason:brainCheck.code==='stale'?'Market feed stale. No trade placed.':'Setup changed — no trade placed.'};rangerBubbleDismissed=window.__brainEntryStatusReady===true;renderRangerBet();brainEntryReaction(brainCheck);if(!window.__brainEntryStatusReady)notify(rangerBet.reason);return}
if(brainCheck&&brainCheck.code==='held'&&brainCheck.late&&!intent.rangerAutomation)brainEntryReaction(brainCheck);
if(intent.rangerAutomation){const minEdge=rangerAutoMinEdge/100,eligible=item=>item&&item.fresh===true&&quoteFreshness(item.symbol||item.market).fresh&&Number.isFinite(Number(item.edge))&&Number(item.edge)>0&&Number(item.edge)>=minEdge&&Number.isFinite(Number(item.score))&&Number(item.score)>0&&Number(item.p)>=.70&&Number(item.digitSamples)>=30&&Number(item.riseSamples)>=12&&(rangerRingRed&&item.hitSignal===true||rangerRingGreen||rangerRingGold),exact=contracts.find(item=>String(item.symbol||item.market)===String(intent.contract.symbol||intent.contract.market)&&String(item.kind||'').toUpperCase()===String(intent.contract.kind||'').toUpperCase()&&String(item.barrier??'')===String(intent.contract.barrier??'')),chosen=exact&&eligible(exact)?exact:contracts.filter(eligible).sort((a,b)=>Number(b.score)-Number(a.score)||Number(b.edge)-Number(a.edge))[0];if(!chosen){rangerBet=null;rangerBubbleDismissed=true;renderRangerBet();rangerAutoStatus='Waiting for the next eligible signal';renderRangerAutoHud();return}intent.contract={...chosen}}pending={...intent.contract};submitContract(pending,intent.stake,intent.style,intent.rangerAutomation===true,null,intent.brainSnipe===true&&!intent.rangerAutomation&&brainCheck?.code==='held');}
function clearPending(){pending=null;$('confirm').classList.remove('active')}
$('skipDemo').onclick=()=>{clearPending();notify('Trade skipped; keep playing')};
$('buyDemo').onclick=()=>{if(!pending||performance.now()<lockUntil)return;const contract={...pending},stake=selectedCowStake();if(stake===null){clearPending();notify('Enter a stake greater than zero in Markets. No trade placed.');return}clearPending();parent.postMessage({type:'zeronine:room-select-market',payload:{market:contract.symbol||contract.market}},location.origin);parent.postMessage({type:'zeronine:room-trade',payload:{direction:contract.kind==='OVER'?'over':'under',barrier:contract.barrier,stake,market:contract.symbol}},location.origin);};
let rangerBubbleExpiryTimer=0,rangerBubbleExpiryKey='';
function syncRangerBubbleExpiry(){
  const phase=rangerBet?.phase;
  const key=rangerBet&&['won','lost','rejected'].includes(phase)?String(rangerBetSerial)+':'+phase:'';
  if(key===rangerBubbleExpiryKey)return;
  clearTimeout(rangerBubbleExpiryTimer);rangerBubbleExpiryKey=key;
  if(!key||rangerBubbleDismissed)return;
  const serial=rangerBetSerial;
  rangerBubbleExpiryTimer=setTimeout(()=>{
    if(rangerBetSerial===serial&&rangerBet?.phase===phase){rangerBubbleDismissed=true;renderRangerBet()}
  },10000);
}
function renderRangerBet(){syncRangerBubbleExpiry();const el=$('rangerBet');if(!el)return;if(!rangerBet){el.className='ranger-bet';el.setAttribute('aria-hidden','true');return}if(rangerBubbleDismissed){el.className='ranger-bet dismissed';el.setAttribute('aria-hidden','true');return}el.setAttribute('aria-hidden','false');const b=rangerBet,phase=b.phase;el.className='ranger-bet visible '+phase;el.replaceChildren();const add=(parent,tag,cls,value)=>{const n=document.createElement(tag);n.className=cls;n.textContent=value;parent.appendChild(n);return n};const top=add(el,'div','bet-top','');const label=phase==='aiming'?'AIMING':phase==='review'?'REVIEW':phase==='practice'?'PRACTICE':phase==='submitting'?'SENDING':phase==='open'?'LIVE':phase==='won'?'WON':phase==='lost'?'LOST':phase==='rejected'?'NOT PLACED':'WAITING';add(top,'span','bet-caption',label);if(b.digit!=null)add(top,'strong','bet-digit',String(b.digit));if((phase==='won'||phase==='lost')&&Number.isFinite(b.profit))add(top,'strong','bet-profit',(b.profit>=0?'+':'-')+Math.abs(b.profit).toFixed(2)+' '+betCurrency);add(el,'span','bet-line',(b.market||'Market')+' / '+(b.direction||'')+' '+(b.barrier??'')+(Number.isFinite(b.stake)?' / '+b.stake.toFixed(2)+' '+betCurrency:'')+(b.betStyle?' / '+b.betStyle.toUpperCase():''));if(b.reason)add(el,'span','bet-warning',b.reason);if(phase==='won'||phase==='lost')add(el,'span','bet-loss',Number.isFinite(b.remainingLoss)?'Session loss left: '+b.remainingLoss.toFixed(2)+' '+betCurrency:'Session loss left: updating...');if(Number.isFinite(b.edge)){const edge=add(el,'span','bet-edge '+(b.edge>=0?'positive':'negative'),(b.edge>=0?'▲ +':'▼ ')+(b.edge*100).toFixed(1)+'% EDGE');edge.setAttribute('aria-label','Estimated payout edge '+(b.edge*100).toFixed(1)+' percent')}if(['aiming','practice','review'].includes(phase)){const freshness=add(el,'span','bet-freshness','Checking quote…');freshness.id='betFreshness'};if(b.recoveryTarget>0)add(el,'span','bet-loss','Recovery target: '+b.recoveryTarget.toFixed(2)+(b.recoveryLimited?' · stake capped':''));if(b.recoveryWins>0)add(el,'span','recovery-count','Estimated recovery: ~'+b.recoveryWins+' bet wins')}const rangerBubble=$('rangerBet');const dismissRangerBubble=event=>{if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;if(event.type==='keydown')event.preventDefault();rangerBubbleDismissed=true;rangerBubble.classList.add('dismissed');rangerBubble.setAttribute('aria-hidden','true')};rangerBubble.addEventListener('click',dismissRangerBubble);rangerBubble.addEventListener('keydown',dismissRangerBubble);function quoteFreshness(symbol){const m=liveMarkets.find(x=>x.symbol===symbol),observed=marketFreshnessObserved.get(symbol),age=observed&&observed.epoch===Number(m?.lastEpoch)?Math.max(0,(performance.now()-observed.at)/1000):Infinity,seconds=Number.isFinite(age)?Math.max(0,Math.ceil(15-age)):0;return{fresh:!!m&&m.fresh===true&&age<15,seconds,age}}function refreshBetIndicator(){const b=rangerBet;if(!b)return;const q=b.symbol?quoteFreshness(b.symbol):{fresh:false,seconds:0},timer=$('betFreshness');if(timer&&['aiming','practice','review'].includes(b.phase)){timer.textContent=q.fresh?'FEED '+q.seconds+'s':'WAITING FOR FEED';timer.classList.toggle('stale',!q.fresh);timer.classList.toggle('fresh',q.fresh)}}let rangerBetBox={width:0,height:0},rangerBetBoxElement=$('rangerBet');
function refreshRangerBetBox(){if(!rangerBetBoxElement)return;rangerBetBox.width=rangerBetBoxElement.offsetWidth;rangerBetBox.height=rangerBetBoxElement.offsetHeight;positionRangerBet.serial=-1}
if(rangerBetBoxElement&&typeof ResizeObserver!=='undefined'){new ResizeObserver(refreshRangerBetBox).observe(rangerBetBoxElement);refreshRangerBetBox()}else addEventListener('resize',refreshRangerBetBox);
function positionRangerBet(cam,now=performance.now()){const el=$('rangerBet');if(!el||!rangerBet||el.getAttribute('aria-hidden')==='true')return;const anchorX=(player.x-cam.x)*zoom,anchorY=(player.y-52-cam.y)*zoom,serialChanged=positionRangerBet.serial!==rangerBetSerial,anchor=positionRangerBet.anchor;if(!serialChanged&&anchor&&Math.abs(anchor.x-anchorX)<1&&Math.abs(anchor.y-anchorY)<1&&positionRangerBet.width===W&&positionRangerBet.height===H)return;if(!serialChanged&&now-(positionRangerBet.lastAt??-Infinity)<32)return;positionRangerBet.lastAt=now;positionRangerBet.serial=rangerBetSerial;positionRangerBet.anchor={x:anchorX,y:anchorY};positionRangerBet.width=W;positionRangerBet.height=H;if(!rangerBetBox.width||!rangerBetBox.height)refreshRangerBetBox();const half=rangerBetBox.width/2,mobile=W<=700,bottomSafe=mobile?Math.min(H*.38,260):8,topSafe=mobile?Math.min(150,H*.22):8,low=rangerBetBox.height+topSafe,high=Math.max(low,H-bottomSafe-8);el.style.left=Math.max(half+7,Math.min(W-half-7,anchorX))+'px';el.style.top=Math.max(low,Math.min(high,anchorY))+'px'}function updateRangerBet(state){const trades=Array.isArray(state.trades)?state.trades:[],markets=Array.isArray(state.markets)?state.markets:[];betCurrency=state.currency||'USD';$('cowStakeCurrency').textContent=betCurrency;if(rangerBet&&rangerBet.phase!=='rejected'){let t=trackedTradeId!=null?trades.find(t=>t.id===trackedTradeId):trades.find(t=>!knownTradeIds.has(t.id)&&t.market===rangerBet.symbol&&String(t.direction).toUpperCase()===rangerBet.direction&&t.barrier===rangerBet.barrier);if(t){if(rangerBet.rangerAutomation){rangerAutoTradeIds.add(t.id);if(rangerBet.rangerAutoRunId===rangerAutoRunId)rangerAutoRunTradeIds.add(t.id)}if(t.origin==='manual'){registerCowTrade(t.id);if(['won','lost'].includes(t.status))updateSessionRecovery(state)}settleCooldown(t);if(t.status==='lost'&&t.id!==lastLossAttackId){lastLossAttackId=t.id;attackCow=cows.filter(v=>v.alive).sort((a,b)=>Math.hypot(a.x-player.x,a.y-player.y)-Math.hypot(b.x-player.x,b.y-player.y))[0]||null;attackUntil=performance.now()+6500;if(attackCow)notify('A cow is charging! Move to dodge.')}if(['won','lost'].includes(t.status)&&rangerBet&&rangerBet.brainSnipe&&!rangerBet.brainPickCounted){rangerBet.brainPickCounted=true;brainNotePickResult(rangerBet.brainSnipeSig,t.status==='won')}trackedTradeId=t.id;const phase=['pending','purchasing'].includes(t.status)?'submitting':t.status==='open'?'open':['won','lost'].includes(t.status)?t.status:'waiting';rangerBet={...rangerBet,phase,profit:t.profit,stake:t.stake,remainingLoss:sessionRecovery.amount,digit:phase==='open'?(markets.find(m=>m.symbol===t.market)?.lastDigit??null):(t.exitDigit??null)}}else if(rangerBet.phase==='open'){rangerBet.digit=markets.find(m=>m.symbol===rangerBet.symbol)?.lastDigit??null}renderRangerBet()}knownTradeIds=new Set(trades.map(t=>t.id))}function updateLiveRangerBetDigit(markets){const bet=rangerBet;if(!bet||bet.phase!=='open')return;const digit=markets.find(m=>m.symbol===bet.symbol)?.lastDigit??null;if(bet.digit===digit)return;bet.digit=digit;const bubble=$('rangerBet');if(!bubble||bubble.getAttribute('aria-hidden')==='true')return;let node=bubble.querySelector('.bet-digit');if(digit===null){node?.remove();return}if(!node){const top=bubble.querySelector('.bet-top');if(!top)return;node=document.createElement('strong');node.className='bet-digit';top.appendChild(node)}node.textContent=String(digit)}
function renderTradeState(state){const trades=Array.isArray(state.trades)?state.trades:[];wins=trades.filter(t=>t.status==='won').length;losses=trades.filter(t=>t.status==='lost').length;$('results').textContent=`${wins}W / ${losses}L`;const open=trades.find(t=>['pending','purchasing','open'].includes(t.status)),box=document.querySelector('.bet-state'),pending=$('pendingBet'),meta=$('pendingMeta');if(open){const label=`${String(open.direction||'').toUpperCase()} ${open.barrier} - ${open.market||'Market'}`;if(pending)pending.textContent=label;if(meta)meta.textContent=open.status==='open'?'Contract open - waiting for result':'Order is being submitted';box?.classList.remove('lost','won');box?.classList.add(open.status==='open'?'open':'pending')}else if(pending&&pending.textContent!=='None'&&pending.textContent!=='SUBMITTED'){pending.textContent='No active bet';if(meta)meta.textContent='Ready for the next cow';box?.classList.remove('pending','open')}const history=$('history');if(!history)return;const recent=trades.filter(t=>!['pending','purchasing','open'].includes(t.status)).slice(0,4);history.innerHTML=recent.length?recent.map(t=>{const status=String(t.status||'').toLowerCase(),profit=t.profit==null?'':` ${Number(t.profit)>=0?'+':''}${Number(t.profit).toFixed(2)}`;return`<div class="history-row ${status}"><div><strong>${String(t.market||'Market').replace(/[&<>]/g,'')}</strong><small>${String(t.direction||'').toUpperCase()} ${t.barrier} - ${Number(t.stake||0).toFixed(2)}</small></div><b>${status}${profit}</b></div>`}).join(''):'<div class="history-empty">No settled bets yet</div>';}window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==parent)return;const m=e.data||{};if(m.type==='zeronine:room-health-refresh-result'){if(!m.ok)setHealthIssue(m.message||'Connection refresh failed');else{healthIssue='';healthApiError='';void checkGameHealth()}updateHealthUi()}if(m.type==='zeronine:room-auto-server-status'){const state=m.state&&typeof m.state==='object'?m.state:{};const running=m.running===true||state.running===true;rangerAutoServerState=state;if(m.ok&&running){rangerAutoServerOwned=true;rangerAutoActive=true;rangerAutoStatus='Running on Railway · '+(state.phase||'scanning');renderRangerAutoHud();renderRangerAutoActivity(lastRoomState||{})}else if(!m.ok){rangerAutoServerOwned=false;rangerAutoActive=false;rangerAutoStatus=m.message||'Railway could not start Ranger Auto';rangerRiskFinishRun('start_failed',rangerAutoStatus);renderRangerAutoHud()}else if(rangerAutoServerOwned||rangerAutoActive){rangerAutoServerOwned=false;rangerAutoActive=false;clearRangerServerVisual();rangerAutoStatus=m.message||state.reason||'Railway bot stopped';rangerRiskFinishRun('server_stop',rangerAutoStatus);renderRangerAutoHud()}return}if(m.type==='zeronine:room-auto-arm-result'){rangerAutoArmBusy=false;if(m.ok&&Number.isFinite(m.armedUntil)&&m.armedUntil>Date.now()){rangerAutoArmedUntil=m.armedUntil;rangerAutoStatus='Real trading armed for 10 minutes'}else{rangerAutoArmedUntil=0;rangerAutoStatus=m.message||'The server did not confirm the real-money arm'}renderRangerAutoHud();return}if(m.type==='zeronine:room-state'){const state=Object.assign({},lastRoomState||{},m.state||{});if(activeAccountId!==state.accountId){pastureAuthRejected=false;pastureReconnectAttempts=0;clearPasturePresence();if(activeAccountId!==null&&rangerAutoActive)stopRangerAuto('Account changed; ranger automation stopped.','authorization');rangerAutoArmedUntil=0;rangerAutoArmBusy=false;rangerAutoReviewPending=false;activeAccountId=state.accountId??null;$('cowStake').value='1';rangerAutoTradeIds=new Set();rangerBet=null;trackedTradeId=null;knownTradeIds=new Set();renderRangerBet()}connectedAccount=state.accountMode==='demo'||state.accountMode==='real';const guestBanner=$('guestBanner'),guestBannerMessage=$('guestBannerMessage'),connectDeriv=$('connectDeriv');if(connectedAccount){const newlyConnected=guestBanner.dataset.authState!=='connected';guestBanner.dataset.authState='connected';guestBannerMessage.innerHTML='<strong>Deriv connected</strong>';connectDeriv.hidden=true;if(newlyConnected){try{window.dispatchEvent(new CustomEvent('zeronine:brain-connection',{detail:{connected:true,mode:state.accountMode||'',loginid:state.accountId||''}}))}catch{}}if(newlyConnected){guestBanner.hidden=false;clearTimeout(window.__guestBannerTimer);window.__guestBannerTimer=setTimeout(()=>{guestBanner.hidden=true},900)}else guestBanner.hidden=true}else if(state.authStatus==='signed-out'){try{window.dispatchEvent(new CustomEvent('zeronine:brain-connection',{detail:{connected:false}}))}catch{}clearTimeout(window.__guestBannerTimer);guestBanner.dataset.authState='guest';guestBannerMessage.innerHTML='<strong>Guest play</strong>';connectDeriv.hidden=false;guestBanner.hidden=false}else{clearTimeout(window.__guestBannerTimer);guestBanner.dataset.authState='checking';guestBannerMessage.innerHTML='<i class="guest-auth-spinner" aria-hidden="true"></i><strong>Checking your Deriv account?</strong>';connectDeriv.hidden=true;guestBanner.hidden=false}lastRoomState=state;rangerRiskOnRoomState(state);updateSessionRecovery(state);renderAccountHud(state);$('resultsLabel').textContent=state.accountMode==='real'?'Real results':state.accountMode==='demo'?'Demo results':'Account results';syncGhostPaper(state);renderPaper(state);renderTradeState(state);updateRangerBet(state);if(state.paperSimulation){ghost.serverTrades=state.paperSimulation.totalTrades||0;}$('cooldown').textContent=state.feedConnected===false?'FEED OFFLINE':'READY';}if(m.type==='zeronine:room-review-purchased'){rangerAutoReviewPending=false;noteCooldownAttempt();startTradeCooldown();rangerAutoStatus='Review confirmed; waiting for cooldown';renderRangerAutoHud()}if(m.type==='zeronine:room-review-cancelled'){if(rangerAutoActive)stopRangerAuto('Quote cancelled; ranger automation stopped.','manual_stop');rangerBet=null;trackedTradeId=null;renderRangerBet();notify('Quote cancelled. No bet placed.')}if(m.type==='zeronine:room-trade-result'){if(!m.ok&&rangerAutoActive)stopRangerAuto('Trade rejected; ranger automation stopped.','market_safety');if(m.ok&&m.phase==='review'&&rangerAutoActive){rangerAutoReviewPending=true;rangerAutoStatus='Review the live quote before automation resumes';renderRangerAutoHud()}if(!m.ok)setHealthIssue(m.message||'Trade was not submitted');else healthIssue='';if(!m.ok&&rangerBet){rangerBet.reason=m.message||'Trade was not submitted; the reason is unavailable.';document.querySelector('.bet-state')?.classList.remove('pending','open');$('pendingBet').textContent='No active bet';$('pendingMeta').textContent='No bet submitted';rangerBet.phase='rejected';renderRangerBet();notify(rangerBet.reason);const serial=rangerBetSerial;setTimeout(()=>{if(serial===rangerBetSerial&&rangerBet?.phase==='rejected')$('rangerBet').classList.add('fade-out')},9600);setTimeout(()=>{if(serial===rangerBetSerial&&rangerBet?.phase==='rejected'){rangerBet=null;trackedTradeId=null;renderRangerBet();$('rangerBet').classList.remove('fade-out')}},10000)}if(m.ok){if(m.phase==='review'){if(rangerBet){rangerBet.phase='review';renderRangerBet()}notify('Quote ready for review. No bet placed yet.')}else{noteCooldownAttempt();startTradeCooldown();}}else{notify(m.message||'Trade was not submitted');}pending=null;renderRangerAutoHud();}});
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==parent||event.data?.type!=='zeronine:room-market-state')return;
  const state=Object.assign({},lastRoomState||{},event.data.state||{});
  lastRoomState=state;
  rangerRiskOnRoomState(state);
  applyMarkets(state.markets||[],state.candidates||[],state.paperTrades||[],state.marketScout||[],state.digitTradeEvidence||[]);
  renderDigitFlow(state);
  syncGhostPaper(state);
  renderPaper(state);
  updateLiveRangerBetDigit(state.markets||[]);
});
$('stakeDown').addEventListener('click',()=>{const current=selectedCowStake()??1;$('cowStake').value=String(Math.max(.01,Math.round((current-.1)*100)/100))});$('stakeUp').addEventListener('click',()=>{const current=selectedCowStake()??1;$('cowStake').value=String(Math.round((current+.1)*100)/100)});$('connectDeriv').addEventListener('click',()=>parent.postMessage({type:'zeronine:room-navigate',page:'account'},location.origin));function updateHealthUi(){
  const dock=$('healthDock');
  if(!dock)return;
  const phase=rangerBet?.phase||'';
  const tradeBusy=!!pending||['submitting','review','open','waiting'].includes(phase);
  const feedOk=!!roomHealth.feed?.connected;
  const accountOffline=connectedAccount&&roomHealth.owner&&!roomHealth.derivAccountConnected;
  const wsOffline=lastRoomState?.wsStatus==='closed';
  let status='good',title='PASTURE READY',message='Game, server, and Deriv market feed are responding.';
  if(!healthChecked&&!healthApiError){status='busy';title='CHECKING PASTURE';message='Checking the game server and market feed.'}
  else if(healthApiError){status='issue';title='SERVER OFFLINE';message=healthApiError}
  else if(!feedOk){status='issue';title='DERIV FEED OFFLINE';message='Deriv market feed is disconnected. The server will retry automatically.'}
  else if(connectedAccount&&!roomHealth.owner){status='issue';title='ACCOUNT SESSION LOST';message='The game server no longer recognizes the connected account session.'}
  else if(accountOffline){status='issue';title='DERIV ACCOUNT OFFLINE';message='The Deriv account socket is disconnected. Use Reconnect Deriv to restore it.'}
  else if(wsOffline){status='issue';title='APP CONNECTION LOST';message='The game connection is down. Reconnecting automatically.'}
  else if(healthIssue){status='issue';title='GAME ISSUE';message=healthIssue}
  else if(!connectedAccount){status='guest';title='GUEST PLAY';message='Choose a cow to practise a paper trade. Cows stay unharmed; no account orders are placed.'}
  else if(connectedAccount&&lastRoomState?.canTrade===false&&!tradeBusy&&performance.now()>=lockUntil){status='busy';title='BETTING PAUSED';message='A Deriv account gate or server activity is temporarily blocking new bets.'}
  else if(tradeBusy||performance.now()<lockUntil){status='busy';title='TRADE IN PROGRESS';message=tradeBusy?'A submitted or open bet is being tracked safely.':'Cooldown is active; shooting remains available.'}
  const p=Number.isFinite(derivPingMs)?Math.round(derivPingMs)+' ms':'-- ms';
  const apiPing=Number.isFinite(apiPingMs)?Math.round(apiPingMs)+' ms':'-- ms';
  const checkedAt=lastHealthCheckAt?Math.floor(lastHealthCheckAt/1000):0;
  const safeToReset=!tradeBusy&&performance.now()>=lockUntil;
  const resetDisabled=!safeToReset||(!target&&!['aiming','practice'].includes(phase));
  const reconnectHidden=!connectedAccount||(roomHealth.owner&&roomHealth.derivAccountConnected);
  const key=[status,title,message,p,apiPing,checkedAt,resetDisabled,reconnectHidden,tradeBusy].join('|');
  if(updateHealthUi.lastKey===key)return;
  updateHealthUi.lastKey=key;
  dock.dataset.status=status;
  $('healthTitle').textContent=title;
  $('healthMessage').textContent=message;
  $('derivPing').textContent='D '+p;
  $('healthPingDetails').textContent='App '+apiPing+' · Deriv '+p;
  $('healthCheckedAt').textContent=lastHealthCheckAt?'Last successful check '+new Date(lastHealthCheckAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'}):'Waiting for first check';
  $('healthButton').setAttribute('aria-label',title+'; open pasture health controls');
  $('resetStuckAim').disabled=resetDisabled;
  $('reconnectDeriv').hidden=reconnectHidden;
  $('reloadPasture').disabled=tradeBusy;
}
function setHealthIssue(message){healthIssue=String(message||'Game issue');updateHealthUi()}function clearAimState(){target=null;shots.length=0;aimStartedAt=0;aimLastProgressAt=0;player.tx=player.x;player.ty=player.y;if(rangerBet&&['aiming','practice'].includes(rangerBet.phase)){rangerBet=null;trackedTradeId=null;renderRangerBet()}refreshBetIndicator();updateHealthUi()}function resetStuckAim(manual=false){const phase=rangerBet?.phase||'';if(pending||['submitting','review','open','waiting'].includes(phase)||performance.now()<lockUntil){if(manual)notify('A submitted bet or cooldown is protected; aim was not reset.');return false}const hadAim=!!target||['aiming','practice'].includes(phase);if(!hadAim&&manual){notify('No stuck aim to reset.');return false}clearAimState();healthIssue='';updateHealthUi();if(manual)notify('Aim reset. Shooting is available again.');return true}function watchAim(now){if(!rangerBet||rangerBet.phase!=='aiming'||pending||now<lockUntil)return;const baseline=aimLastProgressAt||aimStartedAt||lastCowClickAt;if(baseline&&now-baseline>18000)resetStuckAim(false)}const weatherButton=$('weatherButton'),weatherText=$('weatherText'),weatherTime=$('weatherTime');let weatherCoords={latitude:18.0179,longitude:-76.8099},weatherBusy=false,weatherLastSuccess=0,weatherKind="sun",weatherTemperature="",weatherDescription="Weather loading";
const weatherPaths={sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',night:'<path d="M20 15.3A8.5 8.5 0 0 1 8.7 4a8.5 8.5 0 1 0 11.3 11.3Z"/><path d="M17 3v3m-1.5-1.5h3"/>',cloud:'<path d="M6 16a4 4 0 0 1-.2-8 6 6 0 0 1 11.6 1.5A3.5 3.5 0 0 1 18 16H6Z"/>',rain:'<path d="M6 15a4 4 0 0 1-.2-8 6 6 0 0 1 11.6 1.5A3.5 3.5 0 0 1 18 15H6Z"/><path d="m8 18-1 2m6-2-1 2m6-2-1 2"/>'};
function renderWeather(kind,text,description){weatherButton.dataset.weather=kind;const icon=weatherButton.querySelector('svg');if(icon)icon.innerHTML=weatherPaths[kind];weatherText.textContent=text;weatherButton.setAttribute('aria-label',description);weatherButton.title=description}
function jamaicaTime(){return new Intl.DateTimeFormat('en-US',{timeZone:'America/Jamaica',hour:'numeric',minute:'2-digit'}).format(new Date())}
function renderJamaicaWeather(){const time=jamaicaTime();weatherTime.textContent=time;renderWeather(weatherKind,weatherTemperature,'Kingston, Jamaica: '+weatherDescription+'; '+time+'; tap to refresh weather')}
async function refreshLocalWeather(){if(!weatherCoords||weatherBusy||document.hidden)return;weatherBusy=true;const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);try{const url=new URL('https://api.open-meteo.com/v1/forecast');url.search=new URLSearchParams({latitude:String(weatherCoords.latitude),longitude:String(weatherCoords.longitude),current:'temperature_2m,is_day,weather_code',timezone:'America/Jamaica'}).toString();const response=await fetch(url,{signal:controller.signal,credentials:'omit'});if(!response.ok)throw new Error('Weather unavailable');const data=await response.json(),current=data.current;if(!current||!Number.isFinite(current.temperature_2m)||!Number.isFinite(current.weather_code)||![0,1].includes(current.is_day))throw new Error('Weather unavailable');const code=current.weather_code,rain=(code>=51&&code<=67)||(code>=80&&code<=82)||(code>=95&&code<=99),snow=(code>=71&&code<=77)||(code>=85&&code<=86),cloud=(code>=1&&code<=3)||(code>=45&&code<=48),kind=rain||snow?'rain':cloud?'cloud':current.is_day?'sun':'night',label=rain?'Rain':snow?'Snow':cloud?'Cloudy':current.is_day?'Daytime':'Nighttime',temp=Math.round(current.temperature_2m)+'\u00b0C';weatherLastSuccess=Date.now();pastureWeatherTarget=pastureWeatherTargets(current.is_day,code);weatherKind=kind;weatherTemperature=temp;weatherDescription=label+', '+temp;renderJamaicaWeather()}catch{weatherDescription='Weather unavailable';renderJamaicaWeather()}finally{clearTimeout(timeout);weatherBusy=false}}
weatherButton.addEventListener('click',()=>void refreshLocalWeather());renderJamaicaWeather();void refreshLocalWeather();setInterval(()=>{renderJamaicaWeather();if(Date.now()-weatherLastSuccess>=900000)void refreshLocalWeather()},60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden){renderJamaicaWeather();if(Date.now()-weatherLastSuccess>=900000)void refreshLocalWeather()}});
const remotePlayers=new Map(),chatBubbles=new Map(),remoteKillEffects=[],remoteShotEffects=[];let pastureSocket=null,pastureSelfId='',pastureLeaderId='',pastureReconnectTimer=null,pastureLastState='',pastureLastSent=0,pastureConnectionGeneration=0,pastureReconnectAttempts=0,pastureAuthRejected=false;
const chatPanel=$('chatPanel'),chatToggle=$('chatToggle'),chatMessages=$('chatMessages'),chatInput=$('chatInput'),chatName=$('chatName'),chatStatus=$('chatStatus');
window.__applyRangerProfile=profile=>{rangerAppearance=normalizeRangerAppearance(profile?.appearance||{});chatName.value=typeof profile?.name==='string'?profile.name.slice(0,24):'';sendPastureState(true)};
function sendPasture(value){if(pastureSocket?.readyState===1)pastureSocket.send(JSON.stringify(value))}
function addChatMessage(message,showBubble){if(!message||typeof message.text!=='string'||typeof message.name!=='string')return;const row=document.createElement('p'),name=document.createElement('strong'),text=document.createElement('span');name.textContent=message.name;text.textContent=message.text;row.append(name,text);chatMessages.appendChild(row);while(chatMessages.children.length>50)chatMessages.removeChild(chatMessages.firstChild);chatMessages.scrollTop=chatMessages.scrollHeight;if(showBubble&&typeof message.playerId==='string')chatBubbles.set(message.playerId,{text:message.text,until:performance.now()+6500})}
function clearPasturePresence(){remotePlayers.clear();chatBubbles.clear();pastureSelfId='';pastureLeaderId='';pastureLastState=''}
function pastureReconnectDelayMs(attempts){return Math.min(15000,1000*Math.pow(2,Math.max(0,attempts)))}
function pastureClosePlan(code){if(code===1008)return{stop:true,status:'Pasture access ended. Sign in again to reconnect.'};if(code===4001)return{stop:true,status:'This pasture is open in another tab; your Ranger moved there.'};return{stop:false,status:'Reconnecting...'}}
function connectPasture(){
  if(typeof WebSocket!=='function'||document.hidden||pastureSocket||pastureAuthRejected)return;
  const roomId=(new URLSearchParams(location.search).get('room')||'').toLowerCase();
  const protocol=location.protocol==='https:'?'wss:':'ws:';
  const generation=++pastureConnectionGeneration;
  let socket;
  try{socket=new WebSocket(protocol+'//'+location.host+'/pasture-ws'+(roomId?'?room='+encodeURIComponent(roomId):''))}catch{schedulePastureReconnect(true);return}
  pastureSocket=socket;
  chatStatus.textContent='Connecting...';
  const current=()=>generation===pastureConnectionGeneration&&pastureSocket===socket;
  socket.onopen=()=>{
    if(!current()){try{socket.close()}catch{}return}
    pastureReconnectAttempts=0;pastureAuthRejected=false;chatStatus.textContent='Connected';pastureLastState='';
    sendPastureState(true)
  };
  socket.onmessage=event=>{
    // A callback from a replaced socket must never touch the new session.
    if(!current())return;
    let data;try{data=JSON.parse(event.data)}catch{return}if(data.type==='welcome'){pastureSelfId=data.id;pastureLeaderId=data.leader||'';if(data.ghost&&pastureLeaderId!==pastureSelfId&&Number.isFinite(data.ghost.x)&&Number.isFinite(data.ghost.y)){applyRemoteGhost(data.ghost.x,data.ghost.y)}remotePlayers.clear();for(const item of data.players||[])if(item.id!==pastureSelfId)remotePlayers.set(item.id,{...item,drawX:item.x,drawY:item.y});chatMessages.replaceChildren();for(const message of data.messages||[])addChatMessage(message,false);const me=(data.players||[]).find(item=>item.id===pastureSelfId);if(!chatName.value&&me)chatName.value=me.name;sendPastureState(true)}else if(data.type==='player'&&data.player?.id!==pastureSelfId){const old=remotePlayers.get(data.player.id);remotePlayers.set(data.player.id,{...data.player,drawX:old?.drawX??data.player.x,drawY:old?.drawY??data.player.y})}else if(data.type==='leave'){remotePlayers.delete(data.id);chatBubbles.delete(data.id)}else if(data.type==='leader'){pastureLeaderId=data.id||'';pastureLastState=''}else if(data.type==='ghost'&&pastureLeaderId!==pastureSelfId&&Number.isFinite(data.x)&&Number.isFinite(data.y)){applyRemoteGhost(data.x,data.y)}else if(data.type==='chat')addChatMessage(data.message,true);else if(data.type==='shot'&&Number.isFinite(data.x)&&Number.isFinite(data.y)){const shooter=remotePlayers.get(data.playerId);if(shooter){remoteShotEffects.push({x:shooter.drawX,y:shooter.drawY,x2:data.x,y2:data.y,at:performance.now()});if(remoteShotEffects.length>60)remoteShotEffects.shift()}}else if(data.type==='kill'&&Number.isFinite(data.x)&&Number.isFinite(data.y)){remoteKillEffects.push({x:data.x,y:data.y,playerId:data.playerId,at:performance.now()});if(remoteKillEffects.length>50)remoteKillEffects.shift()}else if(data.type==='notice')chatStatus.textContent=String(data.message||'');
  };
  socket.onclose=event=>{
    if(pastureSocket!==socket)return;
    pastureSocket=null;
    const plan=pastureClosePlan(event&&event.code);
    clearPasturePresence();
    chatStatus.textContent=plan.status;
    if(plan.stop){pastureAuthRejected=true;return}
    schedulePastureReconnect(true)
  };
  socket.onerror=()=>{try{socket.close()}catch{}}
}
function schedulePastureReconnect(resetDelay=false){
  if(pastureReconnectTimer!==null||document.hidden||pastureAuthRejected)return;
  if(resetDelay)pastureReconnectAttempts=0;
  const delay=pastureReconnectDelayMs(pastureReconnectAttempts);
  pastureReconnectAttempts+=1;
  pastureReconnectTimer=setTimeout(()=>{pastureReconnectTimer=null;connectPasture()},delay)
}
function sendPastureState(force=false){const now=performance.now();if(!force&&now-pastureLastSent<250)return;const state={type:'move',x:Math.round(player.x),y:Math.round(player.y),facing:rangerAnim.facing,headFacing:rangerAnim.headFacing,lookX:Math.round(rangerAnim.lookX*10)/10,lookY:Math.round(rangerAnim.lookY*10)/10,action:rangerAnim.state,name:chatName.value.trim().slice(0,24),appearance:rangerAppearance,...(pastureSelfId&&pastureSelfId===pastureLeaderId?{ghost:{x:Math.round(ghost.x),y:Math.round(ghost.y)}}:{})},key=JSON.stringify(state);if(!force&&key===pastureLastState)return;pastureLastState=key;pastureLastSent=now;sendPasture(state)}
chatToggle.addEventListener('click',()=>{chatPanel.hidden=!chatPanel.hidden;chatToggle.setAttribute('aria-expanded',String(!chatPanel.hidden));if(!chatPanel.hidden)chatInput.focus()});chatName.addEventListener('change',()=>{try{localStorage.setItem('pasture-chat-name',chatName.value.trim().slice(0,24))}catch{}sendPastureState(true)});try{chatName.value=localStorage.getItem('pasture-chat-name')||''}catch{}$('chatForm').addEventListener('submit',event=>{event.preventDefault();const text=chatInput.value.trim();if(!text)return;if(!pastureSocket||pastureSocket.readyState!==1){chatStatus.textContent='Chat disconnected; try again shortly.';return}sendPastureState(true);sendPasture({type:'chat',text,name:chatName.value.trim().slice(0,24)});chatInput.value=''});document.addEventListener('visibilitychange',()=>{if(!document.hidden)connectPasture()});window.addEventListener('pagehide',()=>{try{pastureSocket&&pastureSocket.close()}catch{}});connectPasture();setInterval(()=>sendPastureState(),250);
function drawRemoteShots(t){for(let i=remoteShotEffects.length-1;i>=0;i--){const a=remoteShotEffects[i],progress=Math.min(1,(t-a.at)/450);if(progress>=1){remoteShotEffects.splice(i,1);continue}const x=a.x+(a.x2-a.x)*progress,y=a.y+(a.y2-a.y)*progress,dx=a.x2-a.x,dy=a.y2-a.y,length=Math.hypot(dx,dy)||1;c.save();c.strokeStyle='#ffeab4';c.lineWidth=2;c.beginPath();c.moveTo(x-dx/length*15,y-dy/length*15);c.lineTo(x,y);c.stroke();c.restore()}}
function drawRemoteKills(t){for(let i=remoteKillEffects.length-1;i>=0;i--){const effect=remoteKillEffects[i],age=t-effect.at;if(age>1500){remoteKillEffects.splice(i,1);continue}const fade=Math.max(0,1-age/1500),other=remotePlayers.get(effect.playerId);c.save();c.globalAlpha=fade*.7;if(other){c.strokeStyle='#ffe2a0';c.lineWidth=2;c.beginPath();c.moveTo(other.drawX,other.drawY);c.lineTo(effect.x,effect.y);c.stroke()}c.translate(effect.x,effect.y-age*.012);c.fillStyle='#f6e7ca';c.beginPath();c.ellipse(0,0,25,15,0,0,Math.PI*2);c.fill();circle(-20,-6,9,'#f6e7ca');circle(-23,-2,5,'#e7aeb0');poly([[-11,-14],[-2,-15],[5,-6],[-2,3],[-12,-2]],'#765140');c.textAlign='center';c.fillStyle='#fff0bf';c.font='900 10px Inter, system-ui';c.fillText('RANGER HIT',0,-23);c.restore()}}
function drawRemotePlayers(t){for(const other of remotePlayers.values()){if(!Number.isFinite(other.x)||!Number.isFinite(other.y))continue;const elapsed=Math.max(0,Math.min(.25,(t-(other.lastDrawAt??(t-16.667)))/1000)),alpha=1-Math.exp(-12*elapsed);other.lastDrawAt=t;other.drawX+=(other.x-other.drawX)*alpha;other.drawY+=(other.y-other.drawY)*alpha;if(other._appearanceSource!==other.appearance){other._appearanceSource=other.appearance;other._normalizedAppearance=normalizeRangerAppearance(other.appearance)}const x=other.drawX,y=other.drawY,a=other._normalizedAppearance||normalizeRangerAppearance(other.appearance),step=other.action==='walking'?Math.sin(t/150)*5:0;c.save();c.translate(x,y);c.scale(other.facing===-1?-1:1,1);circle(2,21,18,'#14362570');rect(-10,20+step,7,18,'#393a3d');rect(3,20-step,7,18,'#393a3d');rect(-12,34+step,10,5,'#5d4530');rect(3,34-step,10,5,'#5d4530');if(a.accessory==='cape')poly([[-11,-8],[-19,25],[15,25],[10,-8]],a.accent);poly([[-13,-9],[11,-9],[13,22],[-12,22]],a.color,'#224470');if(a.outfit==='jacket')rect(-1,-8,3,24,a.accent);if(a.outfit==='hoodie')poly([[-9,-8],[0,-2],[9,-8],[6,1],[0,4],[-6,1]],a.accent);if(a.outfit==='vest')poly([[-12,-8],[-6,-8],[0,13],[6,-8],[11,-8],[9,16],[-10,16]],a.accent);if(a.outfit==='scout'){c.strokeStyle=a.accent;c.lineWidth=4;c.beginPath();c.moveTo(-11,-7);c.lineTo(10,14);c.stroke()}if(a.accessory==='scarf')rect(-10,-8,20,4,a.accent);if(a.accessory==='badge')circle(7,-2,2.5,a.accent);rect(-12,17,25,5,'#866338');const bodyFace=other.facing===-1?-1:1,headFace=other.headFacing===-1?-1:other.headFacing===1?1:bodyFace,lookX=Number.isFinite(other.lookX)?Math.max(-1,Math.min(1,other.lookX)):0,lookY=Number.isFinite(other.lookY)?Math.max(-1,Math.min(1,other.lookY)):0,eyeX=lookX*headFace;c.save();c.translate(lookX*bodyFace*2,-20+lookY);c.scale(headFace*bodyFace,1);c.rotate(eyeX*.12);circle(0,0,11,'#cba17d');poly([[-11,-3],[-9,-11],[2,-15],[11,-10],[11,-3],[4,-8],[-5,-4]],'#4d3729');if(a.headwear==='cap')rect(-12,-15,24,5,a.accent);if(a.headwear==='bandana')rect(-10,-8,20,4,a.accent);if(a.headwear==='hat'){rect(-15,-13,30,3,a.accent);rect(-9,-19,18,7,a.accent)}if(a.headwear==='hood'){c.strokeStyle=a.accent;c.lineWidth=4;c.beginPath();c.arc(0,-1,12,Math.PI,Math.PI*2);c.stroke()}circle(2+eyeX*2,lookY*1.5,1.3,'#271f1d');circle(7+eyeX*2,lookY*1.5,1.3,'#271f1d');if(a.accessory==='glasses'){c.strokeStyle=a.accent;c.lineWidth=1.5;c.strokeRect(-1+eyeX*2,-3+lookY*1.5,7,6);c.strokeRect(6+eyeX*2,-3+lookY*1.5,7,6)}c.restore();if(other.action==='aiming'){c.strokeStyle='#c69b75';c.lineWidth=6;c.beginPath();c.moveTo(-9,-4);c.lineTo(3,1);c.lineTo(12,-6);c.moveTo(9,-5);c.lineTo(20,-8);c.stroke()}else{rect(-16,-3+step*.35,6,20,'#c69b75');rect(11,-3-step*.35,6,18,'#c69b75')}c.strokeStyle='#bb874e';c.lineWidth=3;c.beginPath();c.arc(15,-5,19,-Math.PI*.57,Math.PI*.57);c.stroke();c.restore();c.save();c.textAlign='center';c.font='800 9px Inter, system-ui';const displayName=other.guest?'GUEST · '+String(other.name||'Ranger').slice(0,15):String(other.name||'Ranger').slice(0,24);c.fillStyle=other.guest?'#ffe29a':'#fff4cf';c.strokeStyle='#203c2b';c.lineWidth=3;c.strokeText(displayName,x,y+52);c.fillText(displayName,x,y+52);c.restore()}}
function drawPastureSpeech(now){const own=chatBubbles.get(pastureSelfId);document.body?.classList?.toggle('chat-speaking',!!own&&own.until>now);for(const [id,bubble] of chatBubbles){if(bubble.until<=now){chatBubbles.delete(id);continue}const actor=id===pastureSelfId?player:remotePlayers.get(id);if(!actor)continue;const x=id===pastureSelfId?actor.x:actor.drawX,y=id===pastureSelfId?actor.y:actor.drawY;if(id!==pastureSelfId&&Math.hypot(x-player.x,y-player.y)>380)continue;const words=bubble.text.split(' '),lines=[];let line='';c.save();c.font='700 10px Inter, system-ui';for(const word of words){const next=line?line+' '+word:word;if(c.measureText(next).width>150&&line){lines.push(line);line=word}else line=next;if(lines.length===3)break}if(line&&lines.length<3)lines.push(line);const height=lines.length*13;c.textAlign='center';c.textBaseline='bottom';c.lineJoin='round';c.lineWidth=3;c.strokeStyle='#172319';c.fillStyle='#ffec75';lines.forEach((value,index)=>{const baseline=y-64-height+13+index*13;c.strokeText(value,x,baseline,150);c.fillText(value,x,baseline,150)});c.restore()}}
async function checkGameHealth(){if(healthRequestActive||document.hidden)return;healthRequestActive=true;const wasOffline=!!healthApiError;const started=performance.now(),controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),4500);try{const response=await fetch('/api/game/health',{cache:'no-store',credentials:'same-origin',signal:controller.signal});if(!response.ok)throw new Error('Server HTTP '+response.status);const health=await response.json();apiPingMs=performance.now()-started;roomHealth=health;healthChecked=true;lastHealthCheckAt=Date.now();derivPingMs=Number.isFinite(health.feed?.pingMs)?health.feed.pingMs:null;healthApiError='';if(wasOffline)parent.postMessage({type:'zeronine:room-health-refresh'},location.origin);if(healthIssue.startsWith('Health check failed:'))healthIssue=''}catch(error){apiPingMs=null;derivPingMs=null;healthApiError=error?.name==='AbortError'?'Game server health check timed out':'Game server unavailable'+(error?.message?': '+error.message:'')}finally{clearTimeout(timeout);healthRequestActive=false;updateHealthUi()}}$('healthButton').addEventListener('click',()=>{const panel=$('healthPanel'),open=panel.hidden;panel.hidden=!open;$('healthButton').setAttribute('aria-expanded',String(open));if(open)void checkGameHealth()});$('resetStuckAim').addEventListener('click',()=>resetStuckAim(true));$('refreshHealth').addEventListener('click',()=>{healthIssue='';parent.postMessage({type:'zeronine:room-health-refresh'},location.origin);void checkGameHealth()});$('reconnectDeriv').addEventListener('click',()=>{healthIssue='';parent.postMessage({type:'zeronine:room-health-refresh',payload:{action:'reconnect-deriv'}},location.origin);setTimeout(()=>void checkGameHealth(),1500)});$('reloadPasture').addEventListener('click',()=>{if(pending||['submitting','review','open','waiting'].includes(rangerBet?.phase))return;location.reload()});document.addEventListener('pointerdown',event=>{if(!$('healthDock').contains(event.target)&&!$('healthPanel').hidden){$('healthPanel').hidden=true;$('healthButton').setAttribute('aria-expanded','false')}});void checkGameHealth();setInterval(checkGameHealth,12000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)void checkGameHealth()});window.addEventListener('online',()=>void checkGameHealth());parent.postMessage({type:'zeronine:room-ready'},location.origin);window.addEventListener('keydown',e=>{if(/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName||''))return;const key=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(key)){heldKeys.add(key);e.preventDefault()}});window.addEventListener('keyup',e=>heldKeys.delete(e.key.toLowerCase()));const pad=$('movePad'),knob=$('moveKnob');let movePointer=null;function resetMove(){movePointer=null;touchMove.x=0;touchMove.y=0;knob.style.transform='translate(0,0)'}function updateMove(e){const r=pad.getBoundingClientRect(),dx=e.clientX-(r.left+r.width/2),dy=e.clientY-(r.top+r.height/2),max=r.width*.32,d=Math.hypot(dx,dy),scale=d>max?max/d:1;touchMove.x=d<5?0:dx*scale/max;touchMove.y=d<5?0:dy*scale/max;knob.style.transform='translate('+dx*scale+'px,'+dy*scale+'px)'}pad.addEventListener('pointerdown',e=>{if(movePointer!==null)return;movePointer=e.pointerId;pad.setPointerCapture(e.pointerId);target=null;updateMove(e);e.preventDefault()});pad.addEventListener('pointermove',e=>{if(e.pointerId===movePointer){updateMove(e);e.preventDefault()}});for(const event of ['pointerup','pointercancel','lostpointercapture'])pad.addEventListener(event,e=>{if(e.pointerId===movePointer)resetMove()});$('zoomOut').addEventListener('click',()=>{zoomGoal=Math.max(minZoom(),zoomGoal-.15)});$('zoomIn').addEventListener('click',()=>{zoomGoal=Math.min(1.75,zoomGoal+.15)});
const hudItems=['playerHud','inspector','breakTimer'],hudKey='deriv-cows-hud-layout-v1';let hudLayout={};try{hudLayout=JSON.parse(localStorage.getItem(hudKey)||'{}')||{}}catch{}function syncPlayerBelowMarkets(){const panel=$('inspector'),hud=$('playerHud');if(!panel||!hud||hudLayout.playerHud||!document.documentElement?.style||typeof panel.getBoundingClientRect!=='function'||typeof hud.getBoundingClientRect!=='function')return;const rect=panel.getBoundingClientRect(),hudRect=hud.getBoundingClientRect();if(!rect.width||!rect.height)return;const top=Math.max(60,Math.min(innerHeight-hudRect.height-8,rect.bottom+8));document.documentElement.style.setProperty('--player-hud-top',top+'px')}function placeHud(el,x,y){const r=el.getBoundingClientRect(),w=innerWidth,h=innerHeight;if(!r.width||!r.height)return;const left=Math.max(4,Math.min(w-r.width-4,x)),top=Math.max(52,Math.min(h-r.height-4,y));el.style.left=left+'px';el.style.top=top+'px';el.style.right='auto';el.style.bottom='auto';el.style.transform='none';if(el.id==='inspector')requestAnimationFrame(syncPlayerBelowMarkets)}function restoreHud(){if(innerWidth>999.98)return;for(const id of hudItems){const pos=hudLayout[id],el=$(id);if(!pos||!Number.isFinite(pos.x)||!Number.isFinite(pos.y))continue;const r=el.getBoundingClientRect();if(r.width&&r.height)placeHud(el,pos.x*Math.max(1,innerWidth-r.width),pos.y*Math.max(1,innerHeight-r.height))}}function saveHud(el){const r=el.getBoundingClientRect();hudLayout[el.id]={x:r.left/Math.max(1,innerWidth-r.width),y:r.top/Math.max(1,innerHeight-r.height)};try{localStorage.setItem(hudKey,JSON.stringify(hudLayout))}catch{}}$('arrangeHud').addEventListener('click',()=>{const on=document.body.classList.toggle('hud-arranging');$('arrangeHud').setAttribute('aria-pressed',String(on));notify(on?'Drag the red handles to move the HUD':'HUD positions saved')});$('resetHud').addEventListener('click',()=>{hudLayout={};try{localStorage.removeItem(hudKey)}catch{}for(const id of hudItems){const el=$(id);for(const key of ['left','top','right','bottom','transform'])el.style.removeProperty(key)}syncPlayerBelowMarkets();notify('HUD positions reset')});for(const id of hudItems){const el=$(id),handle=el.querySelector?.('.hud-drag-handle');if(!handle)continue;let drag=null;handle.addEventListener('pointerdown',e=>{if(!document.body.classList.contains('hud-arranging'))return;const r=el.getBoundingClientRect();drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top};handle.setPointerCapture(e.pointerId);e.preventDefault();e.stopPropagation()});handle.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;placeHud(el,drag.left+e.clientX-drag.x,drag.top+e.clientY-drag.y);e.preventDefault();e.stopPropagation()});for(const event of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(event,e=>{if(drag&&drag.id===e.pointerId){saveHud(el);drag=null}e.stopPropagation()});handle.addEventListener('keydown',e=>{const delta={ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]}[e.key];if(!delta)return;const r=el.getBoundingClientRect();placeHud(el,r.left+delta[0],r.top+delta[1]);saveHud(el);e.preventDefault();e.stopPropagation()})}addEventListener('resize',()=>{restoreHud();syncPlayerBelowMarkets()});document.querySelector('.target-menu').addEventListener('toggle',()=>{restoreHud();syncPlayerBelowMarkets()});if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(syncPlayerBelowMarkets);observer.observe($('inspector'));observer.observe($('playerHud'))}restoreHud();syncPlayerBelowMarkets();
window.addEventListener('blur',()=>{heldKeys.clear();resetMove()});canvas.addEventListener('pointermove',e=>{if(e.pointerType!=='touch')hoverPoint={x:e.clientX,y:e.clientY}});canvas.addEventListener('pointerleave',()=>{hoverPoint=null;hoverCow=null});canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'){hoverPoint=null;hoverCow=null}});const pinchPointers=new Map();let pinchStartDistance=0,pinchStartZoom=zoomGoal,pinchDidZoom=false,suppressCanvasClickUntil=0;const pinchDistance=()=>{const points=[...pinchPointers.values()];return points.length<2?0:Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y)};canvas.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch')return;pinchPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pinchPointers.size===2){pinchStartDistance=pinchDistance();pinchStartZoom=zoomGoal;pinchDidZoom=false;e.preventDefault()}});canvas.addEventListener('pointermove',e=>{if(e.pointerType!=='touch'||!pinchPointers.has(e.pointerId))return;pinchPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pinchPointers.size<2||pinchStartDistance<=0)return;const distance=pinchDistance();if(distance>0){zoomGoal=Math.max(minZoom(),Math.min(1.75,pinchStartZoom*distance/pinchStartDistance));if(Math.abs(distance-pinchStartDistance)>4){pinchDidZoom=true;suppressCanvasClickUntil=performance.now()+650}e.preventDefault()}});for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,e=>{if(!pinchPointers.has(e.pointerId))return;pinchPointers.delete(e.pointerId);if(pinchDidZoom)suppressCanvasClickUntil=performance.now()+650;if(pinchPointers.size<2){pinchStartDistance=0;pinchDidZoom=false}});canvas.addEventListener('click',e=>{if(performance.now()<suppressCanvasClickUntil){e.preventDefault();return}if(ghostTraderAtClientPoint(e.clientX,e.clientY)){setGhostPanelOpen(!ghostPanelOpen);return}const cam=camera(),x=e.clientX/zoom+cam.x,y=e.clientY/zoom+cam.y;let hit=cows.filter(v=>v.alive&&Math.hypot(x-v.x,y-v.y)<55).sort((a,b)=>Math.hypot(x-a.x,y-a.y)-Math.hypot(x-b.x,y-b.y))[0];if(hit){if(!connectedAccount){beginManualPaperTrade(hit);return}const minEdge=selectedManualMinEdge();if(Number.isNaN(minEdge)){notify('Set minimum edge between 0 and 100%, or leave it blank. No trade placed.');return}const baseStake=selectedCowStake();if(connectedAccount&&baseStake===null){notify('Enter a stake greater than zero in Markets. No trade placed.');return}const snipe=brainSnipeStillValid(hit),plan=snipe?{stake:snipe.stake,recoveryTarget:0,recoveryLimited:!!snipe.limited}:connectedAccount?plannedCowStake(baseStake,hit.contract,lastRoomState):{stake:baseStake,recoveryTarget:0,recoveryLimited:false};const brainEntry=snipe?snipe.enterAt:null;if(connectedAccount&&(!plan||plan.stake<=0)){const reason=plan?.reason||'The stake could not be calculated; no bet was placed.';rangerBet={phase:'rejected',market:hit.contract.market,symbol:hit.contract.symbol,direction:hit.contract.kind,barrier:hit.contract.barrier,stake:baseStake,betStyle:cowBetStyle,reason};renderRangerBet();notify(reason);return}const stake=plan?.stake??baseStake;hit.tradeIntent={accountId:activeAccountId,minEdge,stake,style:cowBetStyle,recoveryTarget:plan?.recoveryTarget||0,recoveryLimited:!!plan?.recoveryLimited,brainSnipe:!!snipe,brainEntry,brainSuggestedAt:snipe?snipe.at:null,contract:{...hit.contract}};const canStartAim=!pending&&performance.now()>=lockUntil&&(!rangerBet||['aiming','won','lost','rejected','practice'].includes(rangerBet.phase));if(target&&target!==hit)shots=shots.filter(arrow=>arrow.target!==target);if(canStartAim&&rangerBet&&['won','lost','rejected','practice'].includes(rangerBet.phase)){rangerBetSerial++;rangerBet=null;trackedTradeId=null;renderRangerBet();$('rangerBet').classList.remove('fade-out')}hit.entryShots=rangerManualShots;hit.entryStartHp=hit.hp;target=hit;aimStartedAt=performance.now();aimLastProgressAt=aimStartedAt;lastCowClickAt=aimStartedAt;healthIssue="";updateHealthUi();hit.lastShotTickSeq=marketTickSequences.get(hit.contract.symbol)||0;lastShot=aimStartedAt-850;if(canStartAim){rangerBubbleDismissed=false;rangerBet={phase:'aiming',brainSnipe:!!snipe,brainSnipeSig:snipe?brainSetupSig(hit.contract):null,market:hit.contract.market,symbol:hit.contract.symbol,direction:hit.contract.kind,barrier:hit.contract.barrier,stake:hit.tradeIntent?.stake,recoveryTarget:hit.tradeIntent?.recoveryTarget,recoveryLimited:hit.tradeIntent?.recoveryLimited,betStyle:hit.tradeIntent?.style,edge:hit.contract.edge,recoveryWins:estimateRecoveryWins(hit.contract)};renderRangerBet()}}else{target=null;player.tx=Math.max(65,Math.min(world.w-65,x));player.ty=Math.max(110,Math.min(world.h-100,y))}});function selectRangerAutoCandidate(items,rules={minEdge:0,green:true,gold:true,red:true}){const candidates=Array.isArray(items)?items.filter(Boolean):[],bestEdge=candidates.filter(item=>item.fresh===true&&Number.isFinite(Number(item.edge))&&Number(item.edge)>0).sort((a,b)=>Number(b.edge)-Number(a.edge)||Number(b.score)-Number(a.score))[0],bestScore=candidates.filter(item=>item.fresh===true&&Number.isFinite(Number(item.edge))&&Number(item.edge)>0&&Number.isFinite(Number(item.score))&&Number.isFinite(Number(item.payout))).sort((a,b)=>Number(b.score)-Number(a.score)||Number(b.p)-Number(a.p))[0],eligible=candidates.filter(item=>item.fresh===true&&Number.isFinite(Number(item.edge))&&Number(item.edge)>0&&Number(item.edge)>=rules.minEdge&&Number.isFinite(Number(item.score))&&Number(item.score)>0&&Number(item.p)>=.70&&Number(item.digitSamples)>=30&&Number(item.riseSamples)>=12&&((rules.red&&item.hitSignal===true)||(rules.green&&item===bestEdge)||(rules.gold&&item===bestScore)));return eligible.sort((a,b)=>Number(b.score)-Number(a.score)||Number(b.edge)-Number(a.edge)||Number(b.p)-Number(a.p))[0]||null}function rangerAutoLatchedCandidate(items,key,rules){if(!key)return null;const [symbol,kind,barrier]=String(key).split('|');return(Array.isArray(items)?items:[]).find(item=>item&&String(item.symbol||item.market)===symbol&&String(item.kind||'').toUpperCase()===kind.toUpperCase()&&String(item.barrier)===barrier&&item.fresh===true&&Number.isFinite(Number(item.edge))&&Number(item.edge)>0&&Number(item.edge)>=rules.minEdge&&Number.isFinite(Number(item.score))&&Number(item.score)>0&&Number(item.p)>=.70&&Number(item.digitSamples)>=30&&Number(item.riseSamples)>=12&&((rules.red&&item.hitSignal===true)||rules.green||rules.gold))||null}function updateRangerAutoProgress(progress,candidate){if(!candidate)return{key:null,lastSeq:-1,confirmations:0};const key=String(candidate.symbol||candidate.market)+'|'+String(candidate.kind)+'|'+String(candidate.barrier),seq=Number(candidate.tickSeq);if(!Number.isFinite(seq))return{key:null,lastSeq:-1,confirmations:0};if(progress?.key!==key)return{key,lastSeq:seq,confirmations:1};if(seq<=progress.lastSeq)return progress;const delta=Math.max(1,Math.min(3,seq-progress.lastSeq));return{key,lastSeq:seq,confirmations:Math.min(3,progress.confirmations+delta)}}function rangerAutoSettingsFromInputs(){const lossLimit=Number($('rangerAutoLossLimit')?.value),cooldownSeconds=Number($('rangerAutoCooldownSeconds')?.value),takeProfit=Number($('rangerAutoTakeProfit')?.value),maxRunLoss=Number($('rangerAutoMaxRunLoss')?.value??0),minEdge=Number($('rangerAutoMinEdge')?.value??0),manualShots=Number($('rangerManualShots')?.value??3),autoShots=Number($('rangerAutoShots')?.value??3),paperCount=Number($('rangerPaperCount')?.value??20),paperWinTarget=Number($('rangerPaperWinTarget')?.value??55),green=$('rangerRingGreen')?.checked??true,gold=$('rangerRingGold')?.checked??true,red=$('rangerRingRed')?.checked??true,paperEnabled=$('rangerPaperEnabled')?.checked??false;if(!Number.isInteger(lossLimit)||lossLimit<2||lossLimit>20)return{error:'Set the loss cooldown threshold from 2 to 20 consecutive losses.'};if(!Number.isInteger(cooldownSeconds)||cooldownSeconds<1||cooldownSeconds>3600)return{error:'Set cooldown duration from 1 to 3600 seconds.'};if(!Number.isFinite(takeProfit)||takeProfit<0)return{error:'Take profit must be zero (off) or a positive amount.'};if(!Number.isFinite(maxRunLoss)||maxRunLoss<0||maxRunLoss>1000000)return{error:'Maximum run loss must be zero (off) or a positive amount.'};if(!Number.isFinite(minEdge)||minEdge<0||minEdge>100)return{error:'Set minimum edge between 0 and 100%.'};if(!Number.isInteger(manualShots)||manualShots<1||manualShots>5||!Number.isInteger(autoShots)||autoShots<1||autoShots>5)return{error:'Set manual and Auto shots from 1 to 5.'};if(!Number.isInteger(paperCount)||paperCount<1||paperCount>100||!Number.isFinite(paperWinTarget)||paperWinTarget<0||paperWinTarget>100)return{error:'Set paper tests from 1 to 100 and a win target from 0 to 100%.'};if(!green&&!gold&&!red)return{error:'Select at least one ring for Ranger Auto.'};return{lossLimit,cooldownSeconds,takeProfit,maxRunLoss,minEdge,manualShots,autoShots,paperCount,paperWinTarget,green,gold,red,paperEnabled,error:''}}function saveRangerAutoSettings(){const settings=rangerAutoSettingsFromInputs();if(settings.error){rangerAutoStatus=settings.error;renderRangerAutoHud();return}rangerAutoLossLimit=settings.lossLimit;rangerAutoCooldownSeconds=settings.cooldownSeconds;rangerAutoTakeProfit=settings.takeProfit;rangerAutoMaxRunLoss=settings.maxRunLoss;rangerAutoMinEdge=settings.minEdge;rangerManualShots=settings.manualShots;rangerAutoShots=settings.autoShots;rangerPaperCount=settings.paperCount;rangerPaperWinTarget=settings.paperWinTarget;rangerRingGreen=settings.green;rangerRingGold=settings.gold;rangerRingRed=settings.red;rangerPaperEnabled=settings.paperEnabled;try{localStorage.setItem('ranger-auto-settings-v1',JSON.stringify({lossLimit:rangerAutoLossLimit,cooldownSeconds:rangerAutoCooldownSeconds,takeProfit:rangerAutoTakeProfit,maxRunLoss:rangerAutoMaxRunLoss,minEdge:rangerAutoMinEdge,manualShots:rangerManualShots,autoShots:rangerAutoShots,paperCount:rangerPaperCount,paperWinTarget:rangerPaperWinTarget,green:rangerRingGreen,gold:rangerRingGold,red:rangerRingRed,paperEnabled:rangerPaperEnabled}))}catch{notify('Settings apply for this page but could not be saved.')}rangerAutoStatus='Automation settings saved';renderRangerAutoHud()}function loadRangerAutoSettings(){try{const raw=localStorage.getItem('ranger-auto-settings-v1');if(!raw)return;const saved=JSON.parse(raw);if(Number.isInteger(saved?.lossLimit)&&saved.lossLimit>=2&&saved.lossLimit<=20)rangerAutoLossLimit=saved.lossLimit;if(Number.isInteger(saved?.cooldownSeconds)&&saved.cooldownSeconds>=1&&saved.cooldownSeconds<=3600)rangerAutoCooldownSeconds=saved.cooldownSeconds;if(Number.isFinite(saved?.takeProfit)&&saved.takeProfit>=0)rangerAutoTakeProfit=saved.takeProfit;if(Number.isFinite(saved?.maxRunLoss)&&saved.maxRunLoss>=0)rangerAutoMaxRunLoss=saved.maxRunLoss;if(Number.isFinite(saved.minEdge)&&saved.minEdge>=0&&saved.minEdge<=100)rangerAutoMinEdge=saved.minEdge;if(Number.isInteger(saved.manualShots)&&saved.manualShots>=1&&saved.manualShots<=5)rangerManualShots=saved.manualShots;if(Number.isInteger(saved.autoShots)&&saved.autoShots>=1&&saved.autoShots<=5)rangerAutoShots=saved.autoShots;if(Number.isInteger(saved.paperCount)&&saved.paperCount>=1&&saved.paperCount<=100)rangerPaperCount=saved.paperCount;if(Number.isFinite(saved.paperWinTarget)&&saved.paperWinTarget>=0&&saved.paperWinTarget<=100)rangerPaperWinTarget=saved.paperWinTarget;for(const [name,set] of [['green',v=>rangerRingGreen=v],['gold',v=>rangerRingGold=v],['red',v=>rangerRingRed=v],['paperEnabled',v=>rangerPaperEnabled=v]])if(typeof saved[name]==='boolean')set(saved[name])}catch{notify('Saved Ranger Auto settings could not be loaded; using defaults.')}}function rangerAutoStartBlocker(){const baseStake=Number($('rangerAutoStake')?.value);if(!Number.isFinite(baseStake)||baseStake<=0)return'Enter a positive base stake before starting Ranger Auto.';const settings=rangerAutoSettingsFromInputs();if(settings.error)return settings.error;if(connectedAccount&&lastRoomState?.playerConnectionReady!==true)return'Connecting the authenticated player session. Wait a moment, then start Ranger Auto.';if(lastRoomState?.accountMode==='real'&&!lastRoomState.owner)return'Unlock owner controls before using Ranger Auto on a real account.';if(lastRoomState?.accountMode==='real'&&rangerAutoArmedUntil<=Date.now())return'Arm real trading with the ARM REAL button before starting.';return''}function rangerAutoTrackedTrades(trades,ids){return(Array.isArray(trades)?trades:[]).filter(trade=>ids.has(trade.id))}function rangerAutoRunProfit(state){for(const trade of rangerAutoTrackedTrades(state?.trades,rangerAutoRunTradeIds)){if(trade.status!=='won'&&trade.status!=='lost')continue;const profit=Number.isFinite(Number(trade.profit))?Number(trade.profit):0,previous=rangerAutoRunSettledTrades.get(trade.id);if(previous===undefined){rangerAutoRunSettledTrades.set(trade.id,profit);rangerAutoRunProfitTotal+=profit}else if(previous!==profit){rangerAutoRunSettledTrades.set(trade.id,profit);rangerAutoRunProfitTotal+=profit-previous}}return rangerAutoRunProfitTotal}function rangerAutoTakeProfitReached(profit,target){return Number.isFinite(profit)&&Number.isFinite(target)&&target>0&&profit>=target}function rangerAutoRecentTrades(trades,ids){return rangerAutoTrackedTrades(trades,ids).slice(0,5)}function rangerPatrolPoint(player,cows,world,exclude){const herd=(Array.isArray(cows)?cows:[]).filter(cow=>cow&&cow.alive&&cow!==exclude);if(!herd.length)return{x:world.w*.5,y:world.h*.5};const cow=herd.reduce((best,item)=>Math.hypot(item.x-player.x,item.y-player.y)<Math.hypot(best.x-player.x,best.y-player.y)?item:best);return{x:Math.max(65,Math.min(world.w-65,cow.x+(player.x<cow.x?-105:105))),y:Math.max(110,Math.min(world.h-100,cow.y+70))}}function rangerShotReady(connected,tickSequence,lastShotTickSeq,now,lastShot){return connected?tickSequence>(lastShotTickSeq??0):now-lastShot>=850}function rangerDamageForShots(hp,max,shots){return Math.min(hp,max/Math.max(1,Math.min(5,Number(shots)||3)))}function positionRangerAutoMobilePnl(){}function renderRangerAutoActivity(state){const panel=$('rangerAutoActivity'),pnl=$('rangerAutoPnl'),list=$('rangerAutoRecent'),mobilePnl=$('rangerAutoMobilePnl'),mobileValue=$('rangerAutoMobilePnlValue');if(!panel||!pnl||!list)return;panel.hidden=!rangerAutoActive;if(mobilePnl)mobilePnl.hidden=!rangerAutoActive;if(rangerAutoActive)positionRangerAutoMobilePnl();if(!rangerAutoActive){renderRangerAutoActivity.lastKey=null;return}const serverState=rangerAutoServerState&&typeof rangerAutoServerState==='object'?rangerAutoServerState:null,serverProfit=serverState?Number(serverState.runProfit):NaN,allTrades=serverState?(Array.isArray(state.trades)?state.trades.filter(trade=>trade&&trade.origin==='bot'&&Number(trade.ts)>=Number(serverState.startedAt||0)).sort((a,b)=>Number(b.ts)-Number(a.ts)):[]):rangerAutoTrackedTrades(state.trades,rangerAutoTradeIds),trades=allTrades.slice(0,5),total=Number.isFinite(serverProfit)?serverProfit:rangerAutoRunProfit(state),currency=state.currency||'USD',pnlText=(total>0?'+':'')+total.toFixed(2)+' '+currency;let rows;if(serverState){const settled=Number(serverState.tradesDone)||0,wins=Number(serverState.wins)||0,losses=Number(serverState.losses)||0,phase=String(serverState.phase||'running').replace(/-/g,' ');rows=trades.map(trade=>{const status=String(trade.status||'pending').toLowerCase(),profit=Number(trade.profit)||0;return{label:String(trade.market||'Market')+' '+String(trade.direction||'').toUpperCase()+' '+String(trade.barrier??'')+' · '+Number(trade.stake||0).toFixed(2),status,result:['won','lost'].includes(status)?(profit>0?'+':'')+profit.toFixed(2)+' '+currency:status}});if(!rows.length)rows=[{label:'Railway · '+phase,status:'pending',result:settled+' settled · '+wins+'W / '+losses+'L'+(serverState.phase==='waiting-settlement'?' · contract open':'')}]}else{rows=trades.map(trade=>{const status=String(trade.status||'pending').toLowerCase(),profit=Number(trade.profit)||0;return{label:marketName(trade.market,state)+' '+String(trade.direction||'').toUpperCase()+' '+String(trade.barrier??''),status,result:status==='won'||status==='lost'?(profit>0?'+':'')+profit.toFixed(2)+' '+currency:status}})}const renderKey=JSON.stringify([pnlText,total<0,rows.length===0,rows.map(row=>[row.label,row.status,row.result])]);pnl.textContent=pnlText;pnl.dataset.negative=String(total<0);if(mobileValue){mobileValue.textContent=pnlText;mobileValue.dataset.negative=String(total<0)}if(rangerAutoActive)positionRangerAutoMobilePnl();if(renderKey===renderRangerAutoActivity.lastKey){positionRangerAutoActivity();return}list.replaceChildren();if(!rows.length){const empty=document.createElement('li');empty.className='ranger-auto-empty';empty.textContent='No Ranger trades yet';list.append(empty);positionRangerAutoActivity();renderRangerAutoActivity.lastKey=renderKey;return}for(const item of rows){const row=document.createElement('li'),label=document.createElement('span'),result=document.createElement('strong');row.dataset.status=item.status;label.textContent=item.label;result.textContent=item.result;row.append(label,result);list.append(row)}positionRangerAutoActivity();renderRangerAutoActivity.lastKey=renderKey}renderRangerAutoActivity.lastKey=null;function positionRangerAutoActivity(){const panel=$('rangerAutoActivity'),anchor=rangerAutoMenuOpen?$('rangerAutoHud'):$('playerHud');if(!panel||panel.hidden||!anchor)return;const rect=anchor.getBoundingClientRect(),anchorVisible=rect.width>0&&rect.height>0,minimumTop=anchorVisible?8:108,anchorBottom=anchorVisible?rect.bottom:minimumTop-8,top=Math.min(Math.max(minimumTop,anchorBottom+8),Math.max(minimumTop,innerHeight-panel.offsetHeight-8));const left=rangerAutoMenuOpen&&anchorVisible?rect.left:Math.max(8,innerWidth-panel.offsetWidth-12),topValue=top+'px',leftValue=left+'px';if(panel.style.top!==topValue)panel.style.top=topValue;if(panel.style.left!==leftValue)panel.style.left=leftValue}function renderRangerAutoHud(){const root=$('rangerAutoHud'),toggle=$('rangerAutoToggle'),start=$('rangerAutoStart'),startLabel=$('rangerAutoStartLabel'),armButton=$('rangerAutoArm'),state=$('rangerAutoState'),details=$('rangerAutoDetails'),autoStake=$('rangerAutoStake'),autoCurrency=$('rangerAutoCurrency'),autoStyle=$('rangerAutoStyle'),lossLimitInput=$('rangerAutoLossLimit'),cooldownInput=$('rangerAutoCooldownSeconds'),takeProfitInput=$('rangerAutoTakeProfit'),profitCurrency=$('rangerAutoProfitCurrency'),blocker=rangerAutoStartBlocker();if(renderRangerAutoHud.lastRunning!==rangerAutoActive||renderRangerAutoHud.lastStatus!==rangerAutoStatus){parent.postMessage({type:'zeronine:room-auto-status',running:rangerAutoActive,status:rangerAutoStatus},location.origin);renderRangerAutoHud.lastRunning=rangerAutoActive;renderRangerAutoHud.lastStatus=rangerAutoStatus}if(root){root.dataset.active=String(rangerAutoActive);root.hidden=!rangerAutoMenuOpen}if(toggle){toggle.setAttribute('aria-expanded',String(rangerAutoMenuOpen));toggle.setAttribute('aria-label',rangerAutoActive?'Ranger Auto running - show controls':'Show Ranger Auto controls');toggle.title=rangerAutoActive?'Ranger Auto running':'Ranger Auto controls';toggle.dataset.active=String(rangerAutoActive);toggle.querySelector('svg path')?.setAttribute('d',rangerAutoActive?'M8 5v14M16 5v14':'M7 4.5v15L19 12 7 4.5Z')}if(state){state.textContent=rangerAutoArmBusy?'ARMING':rangerAutoActive?'ACTIVE':'OFF';state.dataset.active=String(rangerAutoActive)}if(details)details.textContent=rangerAutoActive?rangerAutoStatus:blocker||(rangerAutoStatus&&rangerAutoStatus!=='Off'?rangerAutoStatus:'Set your stake and recovery style, then start Ranger Auto.');if(autoStake){const stake=$('cowStake');if(document.activeElement!==autoStake&&autoStake.value!==stake.value)autoStake.value=stake.value;if(stake.max)autoStake.max=stake.max;else autoStake.removeAttribute('max')}if(autoCurrency)autoCurrency.textContent=betCurrency;if(profitCurrency)profitCurrency.textContent=betCurrency;if(lossLimitInput){if(document.activeElement!==lossLimitInput)lossLimitInput.value=String(rangerAutoLossLimit);lossLimitInput.disabled=rangerAutoActive}if(cooldownInput){if(document.activeElement!==cooldownInput)cooldownInput.value=String(rangerAutoCooldownSeconds);cooldownInput.disabled=rangerAutoActive}if(takeProfitInput){if(document.activeElement!==takeProfitInput)takeProfitInput.value=String(rangerAutoTakeProfit);takeProfitInput.disabled=rangerAutoActive}const maxLossInput=$('rangerAutoMaxRunLoss');if(maxLossInput){if(document.activeElement!==maxLossInput)maxLossInput.value=String(rangerAutoMaxRunLoss);maxLossInput.disabled=rangerAutoActive}const maxLossCurrency=$('rangerAutoMaxLossCurrency');if(maxLossCurrency)maxLossCurrency.textContent=betCurrency;rangerRiskRenderTimer();for(const [id,value] of [['rangerAutoMinEdge',rangerAutoMinEdge],['rangerManualShots',rangerManualShots],['rangerAutoShots',rangerAutoShots],['rangerPaperCount',rangerPaperCount],['rangerPaperWinTarget',rangerPaperWinTarget]]){const input=$(id);if(input){if(document.activeElement!==input)input.value=String(value);input.disabled=id==='rangerManualShots'?false:rangerAutoActive}}for(const [id,value] of [['rangerRingGreen',rangerRingGreen],['rangerRingGold',rangerRingGold],['rangerRingRed',rangerRingRed],['rangerPaperEnabled',rangerPaperEnabled]]){const input=$(id);if(input){input.checked=value;input.disabled=rangerAutoActive}}if(autoStyle&&document.activeElement!==autoStyle)autoStyle.value=cowBetStyle;if(start){start.dataset.active=String(rangerAutoActive);start.setAttribute('aria-label',rangerAutoActive?'Pause Ranger Auto':'Start Ranger Auto');start.title=blocker||(rangerAutoActive?'Pause Ranger Auto':'Start Ranger Auto');start.disabled=!rangerAutoActive&&!!blocker;start.querySelector('svg path')?.setAttribute('d',rangerAutoActive?'M6 4h4v16H6zM14 4h4v16h-4z':'M6 3.5 20 12 6 20.5z');if(startLabel)startLabel.textContent=rangerAutoActive?'PAUSE AUTO':'START AUTO'}if(armButton){const real=lastRoomState?.accountMode==='real';armButton.hidden=!real;armButton.disabled=rangerAutoArmBusy;armButton.textContent=rangerAutoArmBusy?'ARMING...':rangerAutoArmedUntil>Date.now()?'ARMED - '+Math.max(1,Math.ceil((rangerAutoArmedUntil-Date.now())/60000))+' MIN':'ARM REAL 10 MIN'}renderRangerAutoActivity(lastRoomState||{})}function stopRangerAuto(message,outcome){const wasRunning=rangerAutoActive||rangerRun.active;if(rangerAutoServerOwned)parent.postMessage({type:'zeronine:room-auto-stop'},location.origin);rangerAutoServerOwned=false;rangerAutoActive=false;clearRangerServerVisual();rangerAutoReviewPending=false;rangerAutoProgress={key:null,lastSeq:-1,confirmations:0};if(target?.tradeIntent?.rangerAutomation&&!pending){shots=shots.filter(shot=>shot.target!==target);target=null;rangerBet=null;trackedTradeId=null;renderRangerBet()}rangerAutoStatus=message||'Off';if(message)notify(message);if(wasRunning)rangerRiskFinishRun(outcome||'manual_stop',message||'');renderRangerAutoHud()}function rangerPastureContracts(){return[...new Map(cows.filter(cow=>cow!==ghostCow&&cow.contract).map(cow=>{const contract=cow.contract,market=String(contract.symbol||contract.market||""),direction=String(contract.kind||"").toLowerCase(),barrier=Number(contract.barrier);return[`${market}|${direction}|${barrier}`,{market,direction,barrier}]}).filter(([,contract])=>contract.market&&["over","under"].includes(contract.direction)&&Number.isInteger(contract.barrier))).values()]}function startRangerAuto(){const blocker=rangerAutoStartBlocker();if(blocker){rangerAutoStatus=blocker;renderRangerAutoHud();return}rangerAutoServerState=null;rangerAutoServerVisualTarget=null;rangerAutoServerVisualConsumedId="";const resumed=rangerRiskResumeRun();if(!resumed)rangerRiskBeginRun();rangerAutoProgress={key:null,lastSeq:-1,confirmations:0};rangerAutoReviewPending=false;rangerAutoPatrolAt=0;rangerAutoLossStreak=0;if(!resumed){autoPaperStudies.clear();updateAutoPaperResearch.lastDisplay=null}rangerAutoActive=true;if(connectedAccount){const config=rangerAutoSettingsFromInputs();if(config.error){rangerAutoActive=false;rangerAutoStatus=config.error;renderRangerAutoHud();return}const pastureContracts=rangerPastureContracts();if(!pastureContracts.length){rangerAutoActive=false;rangerAutoStatus="Waiting for pasture market cows to load";renderRangerAutoHud();return}rangerAutoServerOwned=true;rangerAutoStatus='Starting Railway bot…';renderRangerAutoHud();parent.postMessage({type:'zeronine:room-auto-start',payload:{stake:selectedCowStake()||1,minEdge:config.minEdge/100,minWin:.70,maxTrades:0,shots:1,takeProfit:config.takeProfit,maxRunLoss:config.maxRunLoss,lossLimit:config.lossLimit,cooldownSeconds:config.cooldownSeconds,green:config.green,gold:config.gold,red:config.red,pastureContracts}},location.origin);return}rangerAutoStatus='Practice auto running';renderRangerAutoHud();updateRangerAutomation()}const guestAutoPaperLastTicks=new Map();let guestAutoPaperRetryAt=0;
function beginGuestAutoPaper(hit){
  const now=performance.now(),symbol=hit?.contract?.symbol;
  if(now<guestAutoPaperRetryAt)return;
  if(manualPaperTrades.some(trade=>trade.status==='open')){rangerAutoStatus='Practice paper trade waiting for the next tick';return}
  const tick=paperFreshEntryTick(symbol);
  if(!tick){rangerAutoStatus='Practice Auto waiting for a fresh market tick';guestAutoPaperRetryAt=now+1000;return}
  const key=paperTickKey(tick);
  if(guestAutoPaperLastTicks.get(symbol)===key)return;
  guestAutoPaperRetryAt=now+1000;
  if(beginManualPaperTrade(hit,'auto_paper')){
    guestAutoPaperLastTicks.set(symbol,key);
    rangerAutoStatus='Practice paper · '+(hit.contract.market||symbol)+' · waiting for the next tick';
    renderRangerAutoHud();
  }
}
function beginRangerAutoAim(hit,candidate){if(!connectedAccount){beginGuestAutoPaper(hit);return}const baseStake=selectedCowStake()||1;let snipe=brainSnipeStillValid(hit);if(!snipe&&brainAutoSnipe){const autoPlan=brainStakeFor(hit);snipe={stake:autoPlan.stake,limited:!!autoPlan.limited,reason:autoPlan.reason||'',enterAt:(marketTickSequences.get(hit.contract?.symbol)||0)+1}}const plan=snipe?{stake:snipe.stake,recoveryTarget:0,recoveryLimited:!!snipe.limited}:connectedAccount?plannedCowStake(baseStake,hit.contract,lastRoomState,cowBetStyle):{stake:baseStake,recoveryTarget:0,recoveryLimited:false};if(connectedAccount&&(!plan||plan.stake<=0)){stopRangerAuto(plan?.reason||'The automatic stake could not be calculated; no bet was placed.','risk_gate');return}if(pending||performance.now()<lockUntil||target||rangerBet&&!['won','lost','rejected','practice'].includes(rangerBet.phase))return;rangerBetSerial++;trackedTradeId=null;$('rangerBet').classList.remove('fade-out');hit.entryShots=rangerAutoShots;hit.entryStartHp=hit.hp;hit.tradeIntent={accountId:activeAccountId,stake:plan.stake,style:cowBetStyle,recoveryTarget:plan.recoveryTarget||0,recoveryLimited:!!plan.recoveryLimited,brainSnipe:!!snipe,brainEntry:snipe?snipe.enterAt:null,brainSuggestedAt:snipe?snipe.at:null,rangerAutomation:true,rangerAutoRunId:rangerAutoRunId,contract:{...hit.contract}};target=hit;rangerAutoProgress={key:null,lastSeq:-1,confirmations:0};aimStartedAt=performance.now();aimLastProgressAt=aimStartedAt;lastCowClickAt=aimStartedAt;healthIssue='';updateHealthUi();hit.lastShotTickSeq=marketTickSequences.get(hit.contract?.symbol)||0;lastShot=aimStartedAt-850;rangerBubbleDismissed=false;rangerBet={phase:connectedAccount?'aiming':'practice',brainSnipe:!!snipe,brainSnipeSig:snipe?brainSetupSig(hit.contract):null,market:hit.contract.market,symbol:hit.contract.symbol,direction:hit.contract.kind,barrier:hit.contract.barrier,stake:plan.stake,recoveryTarget:plan.recoveryTarget,recoveryLimited:!!plan.recoveryLimited,betStyle:cowBetStyle,edge:candidate.edge,recoveryWins:estimateRecoveryWins(hit.contract),rangerAutomation:true,rangerAutoRunId:rangerAutoRunId};renderRangerBet();rangerAutoStatus=(connectedAccount?'Ranger moving to ':'Practice Auto · ')+hit.contract.market+' · '+hit.contract.kind+' '+hit.contract.barrier;renderRangerAutoHud()}function clearRangerServerVisual(){if(target?.serverAutoVisual){shots=shots.filter(shot=>shot.target!==target);target=null}rangerAutoServerVisualTarget=null}function updateRangerServerVisual(){const state=rangerAutoServerState||{},trade=state.lastSubmittedTrade,tradeId=String(trade?.contractId||'');if(!state.running||!tradeId||tradeId===rangerAutoServerVisualConsumedId){if(target?.serverAutoVisual){shots=shots.filter(shot=>shot.target!==target);target=null}rangerAutoServerVisualTarget=null;return}const candidate=trade,hit=cows.filter(cow=>cow!==ghostCow&&cow.alive&&cow.contract?.symbol===candidate.market&&cow.contract?.kind===candidate.direction&&cow.contract?.barrier===candidate.barrier).sort((a,b)=>Math.hypot(a.x-player.x,a.y-player.y)-Math.hypot(b.x-player.x,b.y-player.y))[0]||null;if(!hit){if(target?.serverAutoVisual){shots=shots.filter(shot=>shot.target!==target);target=null}rangerAutoServerVisualTarget=null;return}if(target&&target!==hit&&!target.serverAutoVisual)return;if(target?.serverAutoVisual&&target!==hit){shots=shots.filter(shot=>shot.target!==target);target=null}rangerAutoServerVisualTarget=hit;hit.serverAutoVisual=true;if(!Number.isFinite(hit.entryStartHp))hit.entryStartHp=hit.max;if(!Number.isFinite(hit.entryShots))hit.entryShots=rangerAutoShots;target=hit;const desiredX=Math.max(65,Math.min(world.w-65,hit.x+(player.x<hit.x?-105:105))),desiredY=Math.max(110,Math.min(world.h-100,hit.y+70));if(Math.hypot(player.tx-desiredX,player.ty-desiredY)>35){player.tx=desiredX;player.ty=desiredY}rangerAnim.patrolWaiting=false;rangerAnim.inspectCow=null}
function updateRangerAutomation(){if(!rangerAutoActive)return;if(rangerAutoServerOwned){updateRangerServerVisual();return};rangerRiskTickClock();if(lastRoomState?.accountMode==='real'&&!lastRoomState.owner){stopRangerAuto('Real-account owner authorization changed; automation stopped.','authorization');return}if(lastRoomState?.accountMode==='real'&&rangerAutoArmedUntil<=Date.now()){stopRangerAuto('Real-money arm expired; automation stopped.','authorization');return}if(!pending&&!['submitting','open','waiting'].includes(rangerBet?.phase)){const runProfit=rangerAutoRunProfit(lastRoomState||{});const limitStop=rangerRiskStopReason(runProfit);if(limitStop==='take_profit'){rangerRun.timeToTargetMs=Date.now()-rangerRun.startedAt;stopRangerAuto('Take profit reached: '+runProfit.toFixed(2)+' '+(lastRoomState?.currency||'USD')+'. Automation stopped.','take_profit');return}if(limitStop==='max_run_loss'){stopRangerAuto('Maximum run loss reached: '+runProfit.toFixed(2)+' '+(lastRoomState?.currency||'USD')+'. No new trades.','max_run_loss');return}}if(connectedAccount&&lastRoomState?.feedConnected===false){rangerAutoStatus='Waiting for the live market feed';renderRangerAutoHud();return}if(rangerAutoReviewPending){rangerAutoStatus='Review the live quote before automation resumes';renderRangerAutoHud();return}if(target||pending||['aiming','submitting','open','waiting'].includes(rangerBet?.phase)){rangerAutoStatus=target?'Ranger is tracking the selected cow':pending?'Waiting for the current bet':'Waiting for the current contract to settle';renderRangerAutoHud();return}if(performance.now()<lockUntil){rangerAutoStatus='Cooldown · '+Math.ceil((lockUntil-performance.now())/1000)+'s';renderRangerAutoHud();return}if(connectedAccount&&lastRoomState?.canTrade===false){rangerAutoStatus='Waiting for account and open-contract safeguards';renderRangerAutoHud();return}let brainScanResult=brainAutoSnipe?brainScan():null,brainPick=brainScanResult?.pick||null,brainWait=brainAutoSnipe&&!brainPick?(brainScanResult?.reason||'no eligible cow'):'',candidate=brainPick?brainPick.tag:brainAutoSnipe?null:selectRangerAutoCandidate(contracts,{minEdge:rangerAutoMinEdge/100,green:rangerRingGreen,gold:rangerRingGold,red:rangerRingRed});if(!brainAutoSnipe&&connectedAccount&&rangerAutoProgress.key){const latched=rangerAutoLatchedCandidate(contracts,rangerAutoProgress.key,{minEdge:rangerAutoMinEdge/100,green:rangerRingGreen,gold:rangerRingGold,red:rangerRingRed});if(latched)candidate=latched}if(brainAutoSnipe&&brainPick){const pilotKey=brainSetupSig(brainPick.tag)+'|'+activeAccountId;if(pilotKey!==rangerBrainPilotKey){rangerBrainPilotKey=pilotKey;if(typeof window.__zeronineBrainSuggest==='function')window.__zeronineBrainSuggest()}}else if(!brainAutoSnipe)rangerBrainPilotKey='';if(!candidate&&!connectedAccount){const aliveCows=cows.filter(c=>c!==ghostCow&&c.alive&&c.contract);const bestCow=aliveCows.slice().sort((a,b)=>(Number(b.contract.score)||0)-(Number(a.contract.score)||0)||(Number(b.contract.edge)||0)-(Number(a.contract.edge)||0))[0];if(bestCow)candidate=bestCow.contract}rangerAutoProgress=updateRangerAutoProgress(rangerAutoProgress,candidate);if(!candidate){rangerAutoStatus=brainWait?'Brain is waiting: '+brainWait:'Waiting for positive edge and a highlighted signal';renderRangerAutoHud();return}if(connectedAccount&&rangerAutoProgress.confirmations<3){rangerAutoStatus='Confirming '+candidate.market+' '+candidate.kind+' '+candidate.barrier+' · '+rangerAutoProgress.confirmations+'/3 fresh ticks';renderRangerAutoHud();const hit=cows.filter(cow=>cow!==ghostCow&&cow.alive&&cow.contract?.symbol===candidate.symbol&&cow.contract?.kind===candidate.kind&&cow.contract?.barrier===candidate.barrier).sort((a,b)=>Math.hypot(a.x-player.x,a.y-player.y)-Math.hypot(b.x-player.x,b.y-player.y))[0];if(hit&&!heldKeys.size&&!touchMove.x&&!touchMove.y){
  const desiredX=Math.max(65,Math.min(world.w-65,hit.x+(player.x<hit.x?-105:105)));
  const desiredY=Math.max(110,Math.min(world.h-100,hit.y+70));
  // Keep a stable approach side; only change the destination meaningfully.
  if(Math.hypot(player.tx-desiredX,player.ty-desiredY)>35){
    player.tx=desiredX;
    player.ty=desiredY;
  }
  rangerAnim.patrolWaiting=false;
  rangerAnim.inspectCow=null;
  rangerAutoPatrolAt=performance.now()+1200;
}return}const hit=cows.filter(cow=>cow!==ghostCow&&cow.alive&&(candidate.symbol?cow.contract?.symbol===candidate.symbol:true)&&cow.contract?.kind===candidate.kind&&cow.contract?.barrier===candidate.barrier).sort((a,b)=>Math.hypot(a.x-player.x,a.y-player.y)-Math.hypot(b.x-player.x,b.y-player.y))[0];if(!hit){rangerAutoStatus='Signal confirmed; waiting for its cow';renderRangerAutoHud();return}beginRangerAutoAim(hit,candidate)}/* ===== Ranger Auto risk, timing and run-report suite ===== */
// Presentation, reporting and discretionary stop logic around the existing
// Ranger Auto loop. Wager sizing still comes from plannedCowStake() and the
// server's risk gates stay authoritative.
const rangerRun={active:false,restored:false,finished:false,runId:null,startedAt:0,accountId:null,accountMode:null,currency:'USD',settings:null,startingBalance:null,engagedMs:0,waitingMs:0,cooldownMs:0,cooldownOpenedAt:0,cooldowns:0,events:[],timeToTargetMs:null,estimateMs:null,phase:'idle',phaseSince:0,lastPersistAt:0};
let rangerRiskPreviewOpen=false,rangerRiskPreviewSnapshot='',rangerRiskPreviewModel=null,rangerRiskPreviewBlocker='';
let rangerRiskEstimate=null,rangerRiskEstimateToken=0,rangerRiskEstimateTimer=0;
let rangerRiskEvidence=null,rangerRiskEvidenceAt=0,rangerRiskRuns=[];
let rangerRiskLastReport=null,rangerRiskTimerAt=0;

function rangerRiskTools(){const tools=globalThis.__rangerAutoTools;return tools&&tools.risk&&tools.timing?tools:null}
function rangerRiskAmount(value,currency){const number=Number(value);const safe=Number.isFinite(number)?number:0;return (safe<0?'-':'')+Math.abs(safe).toFixed(2)+' '+(currency||betCurrency||'USD')}
function rangerRiskStyleLabel(style){return style==='martingale'?'Martingale':style==='boosted'?'Boosted':style==='chase'?'Chase':'Base (flat stake)'}
function rangerRiskClock(ms){const tools=rangerRiskTools();if(tools)return tools.timing.formatClock(ms);const total=Math.max(0,Math.floor((Number(ms)||0)/1000)),h=Math.floor(total/3600),m=Math.floor((total%3600)/60),s=total%60;return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')}
function rangerRiskDuration(ms){const tools=rangerRiskTools();if(tools)return tools.timing.formatDuration(ms);return rangerRiskClock(ms)}
function rangerRiskNode(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node}
function rangerRiskBlock(title){const block=rangerRiskNode('div','risk-block');if(title)block.append(rangerRiskNode('h4','',title));return block}
function rangerRiskConfig(rows){const grid=rangerRiskNode('div','risk-config');for(const row of rows){const card=rangerRiskNode('div','risk-config-card');card.append(rangerRiskNode('span','',row[0]),rangerRiskNode('strong','',row[1]));grid.append(card)}return grid}
function rangerRiskLine(label,value,negative){const line=rangerRiskNode('p','risk-line');line.dataset.negative=negative?'true':'false';line.append(rangerRiskNode('span','',label),rangerRiskNode('strong','',value));return line}
function rangerRiskRunKey(accountId,accountMode){return 'ranger-auto-run-v1:'+String(accountId||'guest')+':'+String(accountMode||'unknown')}

function rangerRiskMarketFresh(state, market){
  const markets=Array.isArray(state&&state.markets)?state.markets:null;
  if(markets){
    const row=markets.find(item=>item&&String(item.symbol||'')===String(market||''));
    return !!(row&&row.fresh===true);
  }
  return null;
}
function rangerRiskCandidatePayout(item){
  const estimate=Number(item&&item.estPayout);
  if(Number.isFinite(estimate)&&estimate>1)return{value:Math.round(estimate*100)/100,source:'estimate',authoritative:false};
  const payout=Number(item&&item.payout);
  if(Number.isFinite(payout)&&payout>1)return{value:Math.round(payout*100)/100,source:'estimate',authoritative:false};
  return{value:null,source:'unavailable',authoritative:false};
}
function rangerRiskPayoutSample(state){
  const candidates=Array.isArray(state&&state.candidates)?state.candidates:[];
  const marketsPresent=Array.isArray(state&&state.markets);
  const isFresh=item=>{
    const marketFresh=rangerRiskMarketFresh(state,item&&item.market);
    if(marketFresh!==null)return marketFresh;
    return marketsPresent?false:item&&item.fresh===true;
  };
  const usable=candidates.filter(item=>{
    if(!item)return false;
    const payout=rangerRiskCandidatePayout(item);
    return payout.value!==null&&isFresh(item);
  });
  if(!usable.length)return{payout:null,estimatePayout:null,authoritative:false,source:'unavailable',count:0,market:null,symbol:null,verified:false};
  const rules={minEdge:(Number(typeof rangerAutoMinEdge!=='undefined'?rangerAutoMinEdge:0)||0)/100,green:typeof rangerRingGreen!=='undefined'?rangerRingGreen:true,gold:typeof rangerRingGold!=='undefined'?rangerRingGold:true,red:typeof rangerRingRed!=='undefined'?rangerRingRed:true};
  const eligible=usable.filter(item=>{
    const edge=Number(item.edge);
    const score=Number(item.score);
    const p=Number(item.estWin);
    return Number.isFinite(edge)&&edge>0&&edge>=rules.minEdge&&Number.isFinite(score)&&score>0&&p>=.70;
  }).sort((a,b)=>Number(b.score)-Number(a.score)||Number(b.edge)-Number(a.edge)||Number(b.estWin)-Number(a.estWin));
  const pick=eligible[0]||usable.slice().sort((a,b)=>Number(b.edge)-Number(a.edge)||Number(b.score)-Number(a.score))[0];
  const payout=rangerRiskCandidatePayout(pick);
  return{payout:null,estimatePayout:payout.value,authoritative:false,source:payout.source,verified:false,count:usable.length,market:pick.market||null,symbol:pick.market||null,direction:pick.direction||null,barrier:pick.barrier??null,label:'Theoretical estimate (not a live broker quote)'};
}
function rangerRiskFingerprint(){
  const settings=rangerAutoSettingsFromInputs(),state=lastRoomState||{},payout=rangerRiskPayoutSample(state),stake=Number($('rangerAutoStake')&&$('rangerAutoStake').value);
  return JSON.stringify([stake,settings.lossLimit,settings.cooldownSeconds,settings.takeProfit,settings.maxRunLoss,cowBetStyle,state.accountId==null?null:state.accountId,state.accountMode==null?null:state.accountMode,Math.round((Number(state.balance)||0)*100),payout.estimatePayout,payout.symbol,payout.direction,payout.barrier,Math.round((sessionRecovery.amount||0)*100)]);
}
function rangerRiskBuildModel(){
  const tools=rangerRiskTools();
  if(!tools)return{error:'The risk calculator is still loading or unavailable, so Ranger Auto will not start. Reload the pasture and try again.'};
  const settings=rangerAutoSettingsFromInputs();
  if(settings.error)return{error:settings.error};
  const state=lastRoomState||{},stake=Number($('rangerAutoStake')&&$('rangerAutoStake').value);
  if(!Number.isFinite(stake)||stake<=0)return{error:'Enter a positive base stake before starting Ranger Auto.'};
  const payout=rangerRiskPayoutSample(state);
  const model=tools.risk.buildRiskPreview({baseStake:stake,style:cowBetStyle,accountMode:state.accountMode==null?null:state.accountMode,accountId:state.accountId==null?null:state.accountId,balance:Number(state.balance)||0,currency:state.currency||betCurrency||'USD',lossesToCooldown:settings.lossLimit,cooldownSeconds:settings.cooldownSeconds,takeProfit:settings.takeProfit,maxRunLoss:settings.maxRunLoss,startDebt:sessionRecovery.amount,runProfit:rangerAutoRunProfit(state),payout:null,estimatePayout:payout.estimatePayout,payoutAuthoritative:false});
  model.payoutSample=payout;
  return model;
}

/* ---------- completed-run metrics ---------- */
function rangerRiskRunTotals(){
  const remoteRun=rangerAutoServerState;if(remoteRun&&Number.isFinite(Number(remoteRun.runProfit))){const realized=Number(remoteRun.runProfit)||0;return{trades:Number(remoteRun.tradesDone)||0,wins:Number(remoteRun.wins)||0,losses:Number(remoteRun.losses)||0,realized,peakProfit:Math.max(0,realized),maxDrawdown:Math.min(0,realized),largestLoss:null,currentStreak:0,longestStreak:0,settledStakes:0,avgWinProfit:null,avgLossProfit:null,avgTradeMs:0,settled:[]}}

  const state=lastRoomState||{};
  const settled=rangerAutoTrackedTrades(state.trades,rangerAutoRunTradeIds).filter(trade=>trade&&(trade.status==='won'||trade.status==='lost'))
    .sort((a,b)=>(Number(a.ts)||0)-(Number(b.ts)||0)||(Number(a.id)||0)-(Number(b.id)||0));
  let realized=0,peak=0,drawdown=0,wins=0,losses=0,streak=0,longest=0,largest=0,stakes=0,winSum=0,lossSum=0;
  for(const trade of settled){
    const profit=Number(trade.profit)||0,stake=Math.max(0,Number(trade.stake)||0);
    realized+=profit;peak=Math.max(peak,realized);drawdown=Math.min(drawdown,realized-peak);stakes+=stake;
    if(trade.status==='won'){wins++;winSum+=profit;streak=0}
    else{losses++;lossSum+=profit;streak++;longest=Math.max(longest,streak);largest=Math.min(largest,profit)}
  }
  const first=settled[0],last=settled[settled.length-1];
  const span=settled.length>=2?Math.max(0,(Number(last.ts)||0)-(Number(first.ts)||0))/(settled.length-1):0;
  return{trades:settled.length,wins,losses,realized,peakProfit:peak,maxDrawdown:drawdown,largestLoss:largest,currentStreak:streak,longestStreak:longest,settledStakes:stakes,avgWinProfit:wins?winSum/wins:null,avgLossProfit:losses?lossSum/losses:null,avgTradeMs:span,settled};
}

/* ---------- live clock ---------- */
function rangerRiskPhase(){
  if(!rangerAutoActive)return 'idle';
  if(performance.now()<lockUntil)return 'cooldown';
  if(target||pending||['aiming','submitting','open','waiting','review'].includes(rangerBet&&rangerBet.phase))return 'engaged';
  return 'waiting';
}
function rangerRiskStopReason(runProfit){if(rangerAutoTakeProfitReached(runProfit,rangerAutoTakeProfit))return 'take_profit';if(rangerAutoMaxRunLoss>0&&runProfit<=-rangerAutoMaxRunLoss+1e-9)return 'max_run_loss';return ''}
function rangerRiskNoteCooldown(seconds){
  if(!rangerRun.runId||rangerRun.finished)return;
  rangerRun.cooldowns+=1;rangerRun.cooldownOpenedAt=performance.now();
  rangerRun.events.push({ts:Date.now(),type:'cooldown_start',detail:String(Math.round(Number(seconds)||0))+'s'});
  while(rangerRun.events.length>80)rangerRun.events.shift();
  rangerRiskPersistRun();
}
function rangerRiskCloseCooldownClock(){
  if(!rangerRun.cooldownOpenedAt)return;
  if(performance.now()<lockUntil)return;
  rangerRun.cooldownMs+=Math.max(0,performance.now()-rangerRun.cooldownOpenedAt);
  rangerRun.cooldownOpenedAt=0;
  rangerRun.events.push({ts:Date.now(),type:'cooldown_end'});
  while(rangerRun.events.length>80)rangerRun.events.shift();
}
function rangerRiskTickClock(){
  if(!rangerRun.runId||rangerRun.finished)return;
  const now=performance.now(),phase=rangerRiskPhase();
  if(rangerRun.phase!==phase){
    const elapsed=Math.max(0,now-rangerRun.phaseSince);
    if(rangerRun.phase==='engaged')rangerRun.engagedMs+=elapsed;
    else if(rangerRun.phase==='waiting')rangerRun.waitingMs+=elapsed;
    rangerRun.phase=phase;rangerRun.phaseSince=now;
  }
  rangerRiskCloseCooldownClock();
  rangerRiskRenderTimer();
  if(Date.now()-rangerRun.lastPersistAt>5000){rangerRun.lastPersistAt=Date.now();rangerRiskPersistRun()}
}
function rangerRiskRenderTimer(){
  const now=performance.now();
  if(rangerRiskTimerAt&&now-rangerRiskTimerAt<400)return;
  rangerRiskTimerAt=now;
  const elapsed=$('rangerAutoElapsed'),active=$('rangerAutoActiveTime'),waiting=$('rangerAutoWaitTime'),count=$('rangerAutoTradeCount'),streak=$('rangerAutoStreak'),peak=$('rangerAutoPeak'),target=$('rangerAutoToTarget');
  if(!elapsed)return;
  if(!rangerRun.runId){
    elapsed.textContent='00:00:00';
    if(active)active.textContent='00:00:00';
    if(waiting)waiting.textContent='00:00:00';
    if(count)count.textContent='0 (0W/0L)';
    if(streak)streak.textContent='0 / longest 0';
    if(peak)peak.textContent='0.00 / 0.00';
    if(target)target.textContent=rangerAutoTakeProfit>0?'0.00 of '+rangerAutoTakeProfit.toFixed(2):'Take profit disabled';
    return;
  }
  const totals=rangerRiskRunTotals(),engagedNow=rangerRun.phase==='engaged'?Math.max(0,now-rangerRun.phaseSince):0,waitingNow=rangerRun.phase==='waiting'?Math.max(0,now-rangerRun.phaseSince):0,cooldownOpen=rangerRun.cooldownOpenedAt?Math.max(0,now-rangerRun.cooldownOpenedAt):0;
  elapsed.textContent=rangerRiskClock(Date.now()-rangerRun.startedAt);
  if(active)active.textContent=rangerRiskClock(rangerRun.engagedMs+engagedNow);
  if(waiting)waiting.textContent=rangerRiskClock(rangerRun.waitingMs+waitingNow)+' waiting / '+rangerRiskClock(rangerRun.cooldownMs+cooldownOpen)+' cooldown';
  if(count)count.textContent=String(totals.trades)+' ('+totals.wins+'W/'+totals.losses+'L)';
  if(streak)streak.textContent=String(totals.currentStreak)+' / longest '+totals.longestStreak;
  if(peak)peak.textContent=rangerRiskAmount(totals.peakProfit,rangerRun.currency)+' / '+rangerRiskAmount(totals.maxDrawdown,rangerRun.currency);
  if(target)target.textContent=rangerAutoTakeProfit>0?rangerRiskAmount(Math.max(0,rangerAutoTakeProfit-totals.realized),rangerRun.currency)+' left':'Take profit disabled';
}

/* ---------- run lifecycle ---------- */
function rangerRiskBeginRun(){
  const state=lastRoomState||{};
  rangerAutoRunId+=1;rangerAutoRunTradeIds.clear();rangerAutoRunSettledTrades.clear();rangerAutoRunProfitTotal=0;
  rangerRun.active=true;rangerRun.restored=false;rangerRun.finished=false;
  rangerRun.startedAt=Date.now();rangerRun.accountId=state.accountId==null?null:state.accountId;rangerRun.accountMode=state.accountMode||'unknown';
  rangerRun.currency=state.currency||betCurrency||'USD';rangerRun.startingBalance=Number.isFinite(Number(state.balance))?Number(state.balance):null;
  rangerRun.settings={baseStake:Number($('rangerAutoStake')&&$('rangerAutoStake').value)||0,style:cowBetStyle,lossesToCooldown:rangerAutoLossLimit,cooldownSeconds:rangerAutoCooldownSeconds,takeProfit:rangerAutoTakeProfit,maxRunLoss:rangerAutoMaxRunLoss,minEdge:rangerAutoMinEdge,recoveryDebt:Math.max(0,Number(sessionRecovery.amount)||0),serverStakeCap:rangerRiskPreviewModel&&rangerRiskPreviewModel.config?rangerRiskPreviewModel.config.executableLimit:null};
  const stamp=Date.now().toString(36),suffix=crypto&&typeof crypto.randomUUID==='function'?crypto.randomUUID().slice(0,8):String(Math.random()).slice(2,10);
  rangerRun.runId=('run:'+stamp+':'+(state.accountId||'guest')+':'+suffix).replace(/[^A-Za-z0-9:_-]/g,'').slice(0,72);
  rangerRun.engagedMs=0;rangerRun.waitingMs=0;rangerRun.cooldownMs=0;rangerRun.cooldownOpenedAt=0;rangerRun.cooldowns=0;rangerRun.timeToTargetMs=null;
  rangerRun.estimateMs=rangerRiskEstimate&&rangerRiskEstimate.available&&Number.isFinite(rangerRiskEstimate.medianMs)?Math.round(rangerRiskEstimate.medianMs):null;
  rangerRun.events=[{ts:rangerRun.startedAt,type:'run_start',detail:cowBetStyle}];
  rangerRun.phase='idle';rangerRun.phaseSince=performance.now();rangerRun.lastPersistAt=0;
  rangerRiskPersistRun();
}
function rangerRiskResumeRun(){
  if(!rangerRun.restored||rangerRun.finished||!rangerRun.runId)return false;
  const state=lastRoomState||{};
  if(String(rangerRun.accountId||'')!==String(state.accountId||''))return false;
  rangerRun.restored=false;rangerRun.active=true;rangerRun.phase='idle';rangerRun.phaseSince=performance.now();
  rangerRun.events.push({ts:Date.now(),type:'resume'});
  while(rangerRun.events.length>80)rangerRun.events.shift();
  rangerRiskPersistRun();
  return true;
}
function rangerRiskPersistRun(){
  if(!rangerRun.runId||rangerRun.finished)return;
  try{
    sessionStorage.setItem(rangerRiskRunKey(rangerRun.accountId,rangerRun.accountMode),JSON.stringify({runId:rangerRun.runId,startedAt:rangerRun.startedAt,accountId:rangerRun.accountId,accountMode:rangerRun.accountMode,currency:rangerRun.currency,settings:rangerRun.settings,startingBalance:rangerRun.startingBalance,engagedMs:rangerRun.engagedMs,waitingMs:rangerRun.waitingMs,cooldownMs:rangerRun.cooldownMs,cooldowns:rangerRun.cooldowns,timeToTargetMs:rangerRun.timeToTargetMs,estimateMs:rangerRun.estimateMs,events:rangerRun.events.slice(-60),tradeIds:[...rangerAutoRunTradeIds],settled:[...rangerAutoRunSettledTrades],profit:rangerAutoRunProfitTotal}));
  }catch{}
}
function rangerRiskRestoreRun(){
  const state=lastRoomState||{};
  if(!state.accountId||rangerAutoActive||rangerRun.runId)return;
  let saved=null;
  try{saved=JSON.parse(sessionStorage.getItem(rangerRiskRunKey(state.accountId,state.accountMode))||'null')}catch{}
  if(!saved||!saved.runId)return;
  rangerRun.runId=String(saved.runId).slice(0,72);rangerRun.startedAt=Number(saved.startedAt)||Date.now();
  rangerRun.accountId=state.accountId;rangerRun.accountMode=state.accountMode||'unknown';rangerRun.currency=saved.currency||state.currency||'USD';
  rangerRun.settings=saved.settings||null;rangerRun.startingBalance=Number.isFinite(Number(saved.startingBalance))?Number(saved.startingBalance):null;
  rangerRun.engagedMs=Math.max(0,Number(saved.engagedMs)||0);rangerRun.waitingMs=Math.max(0,Number(saved.waitingMs)||0);
  rangerRun.cooldownMs=Math.max(0,Number(saved.cooldownMs)||0);rangerRun.cooldowns=Math.max(0,Number(saved.cooldowns)||0);
  rangerRun.timeToTargetMs=Number(saved.timeToTargetMs)||null;rangerRun.estimateMs=Number(saved.estimateMs)||null;
  rangerRun.events=Array.isArray(saved.events)?saved.events.slice(-60):[];
  rangerRun.active=false;rangerRun.restored=true;rangerRun.finished=false;rangerRun.phase='idle';rangerRun.phaseSince=performance.now();
  rangerAutoRunTradeIds=new Set(Array.isArray(saved.tradeIds)?saved.tradeIds:[]);
  rangerAutoRunSettledTrades=new Map(Array.isArray(saved.settled)?saved.settled:[]);
  rangerAutoRunProfitTotal=Number(saved.profit)||0;
  rangerAutoStatus='Run restored (paused) · '+rangerRiskClock(Date.now()-rangerRun.startedAt)+' elapsed · START AUTO to review and resume';
  const reportButton=$('rangerAutoReportShow');
  if(reportButton)reportButton.hidden=false;
  rangerRiskRenderTimer();
  renderRangerAutoHud();
}
function rangerRiskFinishRun(outcome,message){
  if(!rangerRun.runId||rangerRun.finished)return null;
  rangerRiskTickClock();
  const totals=rangerRiskRunTotals(),state=lastRoomState||{};
  const engagedNow=rangerRun.phase==='engaged'?Math.max(0,performance.now()-rangerRun.phaseSince):0;
  const cooldownOpen=rangerRun.cooldownOpenedAt?Math.max(0,performance.now()-rangerRun.cooldownOpenedAt):0;
  const wallMs=Math.max(0,Date.now()-rangerRun.startedAt);
  rangerRun.finished=true;rangerRun.active=false;rangerRun.cooldownOpenedAt=0;
  const report={
    runId:rangerRun.runId,accountId:rangerRun.accountId,accountMode:rangerRun.accountMode,currency:rangerRun.currency,
    startedAt:rangerRun.startedAt,endedAt:Date.now(),outcome:outcome||'manual_stop',stopReason:String(message||''),targetReached:outcome==='take_profit',
    takeProfit:Number(rangerRun.settings&&rangerRun.settings.takeProfit)||0,maxRunLoss:Number(rangerRun.settings&&rangerRun.settings.maxRunLoss)||0,
    startingBalance:rangerRun.startingBalance,endingBalance:Number.isFinite(Number(state.balance))?Number(state.balance):null,
    realizedProfit:Math.round(totals.realized*100)/100,peakProfit:Math.round(totals.peakProfit*100)/100,maxDrawdown:Math.round(totals.maxDrawdown*100)/100,
    trades:totals.trades,wins:totals.wins,losses:totals.losses,avgWinProfit:totals.avgWinProfit===null?null:Math.round(totals.avgWinProfit*100)/100,
    avgLossProfit:totals.avgLossProfit===null?null:Math.round(totals.avgLossProfit*100)/100,
    largestLoss:totals.largestLoss?Math.round(totals.largestLoss*100)/100:null,longestLossStreak:totals.longestStreak,
    cooldowns:rangerRun.cooldowns,cooldownMs:Math.round(rangerRun.cooldownMs+cooldownOpen),activeMs:Math.round(rangerRun.engagedMs+engagedNow),
    waitingMs:Math.round(rangerRun.waitingMs),wallMs,avgTradeMs:Math.round(totals.avgTradeMs),
    timeToTargetMs:rangerRun.timeToTargetMs===null||rangerRun.timeToTargetMs===undefined||!Number.isFinite(Number(rangerRun.timeToTargetMs))?null:Math.round(Number(rangerRun.timeToTargetMs)),
    estimatedTimeToTargetMs:rangerRun.estimateMs===null||rangerRun.estimateMs===undefined||!Number.isFinite(Number(rangerRun.estimateMs))?null:Math.round(Number(rangerRun.estimateMs)),
    settledStakes:Math.round(totals.settledStakes*100)/100,settings:rangerRun.settings||{},
    tradeRows:rangerRiskTradesPayload(totals.settled),events:rangerRun.events.slice(-80),
  };
  try{sessionStorage.removeItem(rangerRiskRunKey(rangerRun.accountId,rangerRun.accountMode))}catch{}
  rangerRiskLastReport=report;
  void rangerRiskPostReport(report);
  rangerRiskShowReport(report);
  return report;
}
function rangerRiskTradesPayload(settled){
  return settled.slice(-200).map(trade=>({tradeId:String(trade.id),stake:Number.isFinite(Number(trade.stake))?Number(trade.stake):null,payout:Number.isFinite(Number(trade.payout))?Number(trade.payout):null,profit:Number.isFinite(Number(trade.profit))?Number(trade.profit):null,status:String(trade.status||'unknown'),purchasedAt:Number.isFinite(Number(trade.ts))?Number(trade.ts):null,settledAt:null}));
}
function rangerRiskPostReport(report){
  try{
    return fetch('/api/ranger-auto/runs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(report)}).catch(()=>null);
  }catch{return null}
}

/* ---------- preview ---------- */
function rangerRiskOpenPreview(){
  const card=$('rangerAutoRiskPreview');
  if(!card)return;
  rangerRiskPreviewOpen=true;
  rangerRiskPreviewBlocker=rangerAutoStartBlocker();
  rangerRiskPreviewModel=rangerRiskBuildModel();
  rangerRiskPreviewSnapshot=rangerRiskFingerprint();
  rangerRiskEstimate=null;
  card.hidden=false;
  rangerRiskRenderPreview();
  const model=rangerRiskPreviewModel;
  if(!rangerRiskPreviewBlocker&&model&&!model.error&&model.config.takeProfit>0)rangerRiskRequestEstimate(model);
}
function rangerRiskClosePreview(){
  rangerRiskPreviewOpen=false;
  const card=$('rangerAutoRiskPreview');
  if(card)card.hidden=true;
}
function rangerRiskRenderPreview(){
  const body=$('rangerRiskPreviewBody'),confirm=$('rangerRiskPreviewConfirm');
  if(!body)return;
  body.replaceChildren();
  if(confirm)confirm.disabled=false;
  if(rangerRiskPreviewBlocker){
    body.append(rangerRiskNode('p','risk-warn',rangerRiskPreviewBlocker));
    body.append(rangerRiskNode('p','risk-note','The risk preview never bypasses owner authorization, real-money arming or server risk limits.'));
    if(confirm)confirm.disabled=true;
    return;
  }
  const model=rangerRiskPreviewModel;
  if(!model||model.error){
    body.append(rangerRiskNode('p','risk-warn',(model&&model.error)||'The risk calculator is unavailable, so Ranger Auto will not start.'));
    if(confirm)confirm.disabled=true;
    return;
  }
  const cfg=model.config,currency=cfg.currency||'USD',mode=cfg.accountMode==='real'?'Real account':cfg.accountMode==='demo'?'Demo account':'No Deriv account connected';
  const sample=model.payoutSample||{};
  const netLabel=cfg.perWinProfit===null?'Unavailable':rangerRiskAmount(cfg.perWinProfit,currency)+(cfg.netSource==='payout'&&cfg.authoritative?' (verified live quote)':cfg.netSource==='estimate'?' (theoretical estimate, not a live quote)':cfg.netSource==='model'?' (payout model)':'');
  const payoutSampleLabel=sample.estimatePayout?sample.estimatePayout.toFixed(2)+'x theoretical estimate'+(sample.market?` for ${sample.market}${sample.direction?(' '+String(sample.direction).toUpperCase()):''}${sample.barrier!=null?(' '+sample.barrier):''}`:'')+' · '+String(sample.count||0)+' fresh candidate'+(sample.count===1?'':'s')+' (not a live broker quote)':sample.payout&&sample.verified?sample.payout.toFixed(2)+'x from '+sample.count+' quote'+(sample.count===1?'':'s'):'Unavailable';
  const hero=rangerRiskNode('div','risk-hero');
  const icon=(paths)=>`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  const heroTile=(label,value,tone,glyph)=>{const tile=rangerRiskNode('div','risk-hero-card');if(tone)tile.dataset.tone=tone;if(glyph)tile.innerHTML=glyph;tile.append(rangerRiskNode('span','',label),rangerRiskNode('strong','',value));return tile};
  const riskLadder=model.ladder||{};
  const riskToPause=Number.isFinite(riskLadder.stopExposureWithDebt)?riskLadder.stopExposureWithDebt:(Number.isFinite(riskLadder.exposureWithDebt)?riskLadder.exposureWithDebt:Number(riskLadder.exposure)||0);
  hero.append(
    heroTile('Stake',rangerRiskAmount(cfg.baseStake,currency),'stake',icon('<path d="M12 3v18M8 7h6a3 3 0 0 1 0 6H8"/><path d="M8 13h7a3 3 0 0 1 0 6H8"/>')),
    heroTile('1 win',cfg.perWinProfit===null?'--':rangerRiskAmount(cfg.perWinProfit,currency),'win',icon('<path d="M4 17 10 11l4 4 6-8"/><path d="M15 7h5v5"/>')),
    heroTile('Pause at',String(cfg.lossesToCooldown||0)+' loss'+(Number(cfg.lossesToCooldown)===1?'':'es'),'pause',icon('<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>')),
    heroTile(riskLadder.runLossStopAt?'Risk to stop':'Risk to pause',rangerRiskAmount(riskToPause,currency),'risk',icon('<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3Z"/><path d="M9 12l2 2 4-4"/>'))
  );
  body.append(hero);
  const config=rangerRiskBlock('Settings in play');
  const settings=rangerRiskNode('details','risk-settings');
  settings.append(rangerRiskNode('summary','','All settings and quotes'));
  settings.append(rangerRiskConfig([
    ['Account mode',mode],
    ['Balance',cfg.balance===null?'Unavailable':rangerRiskAmount(cfg.balance,currency)],
    ['Base stake',rangerRiskAmount(cfg.baseStake,currency)],
    ['Recovery style',rangerRiskStyleLabel(cfg.style)],
    ['Losses to cooldown',String(cfg.lossesToCooldown||0)],
    ['Cooldown',String(cfg.cooldownSeconds||0)+'s'],
    ['Take profit',cfg.takeProfit>0?rangerRiskAmount(cfg.takeProfit,currency):'Take profit disabled'],
    ['Maximum run loss',cfg.maxRunLoss>0?rangerRiskAmount(cfg.maxRunLoss,currency):'Not set (run loss unbounded)'],
    ['Tracked recovery debt',cfg.startDebt>0?rangerRiskAmount(cfg.startDebt,currency):'None'],
    ['Net per winning trade',netLabel],
    ['Executable stake cap',cfg.executableLimit>0?rangerRiskAmount(cfg.executableLimit,currency):'Unavailable'],
    ['Payout estimate',payoutSampleLabel],
  ]));
  config.append(settings);
  body.append(config);

  const ladder=model.ladder;
  const stepsBlock=rangerRiskBlock('Consecutive losses · '+rangerRiskStyleLabel(cfg.style)+(ladder.illustrative?' (illustrative estimate)':''));
  const steps=rangerRiskNode('div','risk-step-cards');
  const balance=Number(cfg.balance)>0?Number(cfg.balance):0;
  for(const step of ladder.steps){
    const card=rangerRiskNode('div','risk-step-card');
    card.dataset.status=step.status;
    card.dataset.open='false';
    card.tabIndex=0;
    const used=Math.max(0,Math.min(100,balance?((Number(step.cumulativeLoss||0)/balance)*100):0));
    const top=rangerRiskNode('div','risk-step-top');
    const isStop=ladder.runLossStopAt===step.lossNumber;
    if(isStop)card.dataset.stop='true';
    top.append(rangerRiskNode('b','','LOSS '+step.lossNumber),rangerRiskNode('strong','',step.stake===null?'--':Number(step.stake).toFixed(2)),rangerRiskNode('em','',isStop?'STOP HERE':step.status==='blocked'?'STOP':(step.illustrative?'EST':'OK')));
    const meter=rangerRiskNode('div','risk-step-meter'),fill=rangerRiskNode('i');
    fill.style.width=used.toFixed(1)+'%';
    meter.append(fill);
    const meta=rangerRiskNode('div','risk-step-meta');
    meta.append(rangerRiskNode('span','',Number(step.cumulativeLoss||0).toFixed(2)+' down'),rangerRiskNode('span','',Number(step.remainingBalance||0).toFixed(2)+' left'));
    const why=rangerRiskNode('p','risk-step-why',step.status==='blocked'?(step.reason||'This wager breaks a risk limit, so it is not placed.'):(step.illustrative?'Sized from a theoretical payout estimate, not a live quote.':'Sized from the stake plan and checked against the balance cap.'));
    card.append(top,meter,meta,why);
    card.addEventListener('click',()=>{card.dataset.open=card.dataset.open==='true'?'false':'true'});
    card.addEventListener('keydown',(event)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();card.dataset.open=card.dataset.open==='true'?'false':'true'}});
    steps.append(card);
  }
  stepsBlock.append(steps);
  const payoutWarnings=[];
  if(ladder.blockedAt){
    const blocked=ladder.steps[ladder.blockedAt-1];
    payoutWarnings.push((blocked&&blocked.reason)||'A projected wager breaches a risk limit and is not executable.');
  }else{
    stepsBlock.append(rangerRiskLine('Projected loss before the first cooldown: ',rangerRiskAmount(Number.isFinite(ladder.stopExposure)?ladder.stopExposure:ladder.exposure,currency)+(ladder.illustrative?' (illustrative)':''),true));
  }
  if(ladder.runLossStopAt)stepsBlock.append(rangerRiskNode('p','risk-note','The maximum run loss boundary is crossed by loss '+ladder.runLossStopAt+'; that trade still settles before new entries are blocked.'));
  if(ladder.payoutBlocked){
    payoutWarnings.push('Verified payout is unavailable and no valid theoretical estimate could model recovery sizing. Choose Base or wait for a fresh estimate/live quote.');
  }else if(ladder.illustrative||cfg.illustrative||(sample.estimatePayout&&!sample.verified)){
    payoutWarnings.push('Illustrative scenario only: uses a theoretical payout estimate, not a verified live broker quote. Projected recovery stakes are not claimed executable. Actual execution enforces authoritative broker pricing, account balance and all existing risk checks, and rechecks the executable stake against the actual quote.');
  }
  for(const warning of [...new Set(payoutWarnings.filter(Boolean))])stepsBlock.append(rangerRiskNode('p','risk-warn',warning));
  const shortfall=ladder.steps.filter(step=>step.status==='executable'&&step.coversTarget===false)[0];
  if(shortfall)stepsBlock.append(rangerRiskNode('p','risk-note','Step '+shortfall.lossNumber+' rounds to '+Number(shortfall.stake).toFixed(2)+' '+currency+', a cent short of the '+Number(shortfall.clearingStake||0).toFixed(2)+' needed to clear that debt. The preview shows the modeled amount; execution still rechecks the actual quote and risk limits.'));
  if(ladder.winsToRecover)stepsBlock.append(rangerRiskNode('p','risk-note','Winning bets needed to clear the tracked debt at the projected next stake: '+ladder.winsToRecover+(ladder.illustrative?' (illustrative estimate).':'.')));
  body.append(stepsBlock);

  const reward=rangerRiskBlock('Risk and reward');
  const tp=model.takeProfit;
  reward.append(rangerRiskConfig([
    ['Cooldown exposure',rangerRiskAmount(ladder.exposure,currency)],
    ['Take profit target',tp.enabled?rangerRiskAmount(tp.target,currency):'Take profit disabled'],
    ['Session loss boundary',cfg.maxRunLoss>0?rangerRiskAmount(-cfg.maxRunLoss,currency):'No enforceable boundary'],
  ]));
  body.append(reward);

  const progress=rangerRiskBlock('Take-profit progress');
  if(tp.enabled){
    progress.append(rangerRiskConfig([
      ['Run profit so far',rangerRiskAmount(tp.runProfit,currency)],
      ['Remaining to target',rangerRiskAmount(tp.remaining,currency)],
      ['Wins needed (all-wins scenario)',tp.winsNeeded===null?'Unavailable':String(tp.winsNeeded)],
      ['Progress',Math.round(tp.progressPct)+'%'],
    ]));
    progress.append(rangerRiskNode('strong','risk-progress-value',Math.round(tp.progressPct)+'%'));
    const bar=rangerRiskNode('div','risk-bar'),fill=rangerRiskNode('i');
    fill.style.width=Math.max(0,Math.min(100,tp.progressPct)).toFixed(1)+'%';
    bar.append(fill);progress.append(bar);
    if(tp.deficit>0)progress.append(rangerRiskNode('p','risk-line','Currently below break-even by '+rangerRiskAmount(tp.deficit,currency)+'.'));
    progress.append(rangerRiskNode('p','risk-note','An all-wins estimate, not an expected outcome: real runs mix wins and losses.'));
  }else{
    progress.append(rangerRiskNode('p','risk-note','Take profit disabled. Set a positive target to stop new entries after a verified settlement reaches it.'));
  }
  body.append(progress);

  const time=rangerRiskBlock('Time to take profit');
  const slot=rangerRiskNode('div');
  slot.id='rangerRiskEstimateSlot';
  slot.append(rangerRiskNode('p','risk-note',tp.enabled?'Checking completed runs for a time estimate...':'Take profit disabled, so there is no target time to estimate.'));
  time.append(slot);
  body.append(time);

  const worst=rangerRiskBlock('Largest possible loss');
  worst.append(rangerRiskNode('p','risk-line',model.worstCase.reason));
  worst.append(rangerRiskNode('p','risk-note','All figures are estimates from the settings above and live quotes. Market outcomes, payouts and settlement speed are not guaranteed.'));
  body.append(worst);

  // Only block confirmation when recovery cannot be modeled at all. Illustrative
  // estimate-based scenarios are allowed with explicit warnings; actual execution
  // still enforces authoritative broker pricing and all risk checks.
  if(ladder.payoutBlocked&&confirm)confirm.disabled=true;
  if(confirm&&ladder.illustrative&&!ladder.payoutBlocked)confirm.textContent='CONFIRM & START AUTO (ILLUSTRATIVE ESTIMATE)';
  else if(confirm)confirm.textContent='CONFIRM & START AUTO';
}
function rangerRiskEstimateNodes(estimate,tools){
  const nodes=[];
  if(!estimate||!estimate.available){
    nodes.push(rangerRiskNode('p','risk-note',(estimate&&estimate.message)||'Not enough completed Ranger runs to estimate time reliably.'));
    return nodes;
  }
  if(estimate.reason==='never_reached'){
    nodes.push(rangerRiskNode('p','risk-warn',estimate.message));
    nodes.push(rangerRiskNode('p','risk-note','Replayed from '+estimate.runs+' completed runs and '+estimate.settled+' settled trades.'));
    return nodes;
  }
  nodes.push(rangerRiskLine('Estimated median time',tools.timing.formatDuration(estimate.medianMs),false));
  nodes.push(rangerRiskLine('Slower case (9 in 10)',tools.timing.formatDuration(estimate.slowMs),false));
  nodes.push(rangerRiskConfig([
    ['Runs reaching take profit',(Math.round((estimate.reachRate||0)*1000)/10).toFixed(1)+'%'],
    ['Completed runs used',String(estimate.runs)],
    ['Settled trades used',String(estimate.settled)],
    ['Observed win rate',(Math.round((estimate.winRate||0)*1000)/10).toFixed(1)+'%'],
    ['Median cycle per trade',tools.timing.formatDuration(estimate.medianCycleMs)],
    ['Last completed run',estimate.lastRunDurationMs?tools.timing.formatDuration(estimate.lastRunDurationMs):'Unavailable'],
  ]));
  nodes.push(rangerRiskNode('p','risk-note','Estimate only. '+estimate.assumptions.join(' ')));
  return nodes;
}
async function rangerRiskLoadEvidence(force){
  const now=Date.now();
  if(!force&&rangerRiskEvidence&&now-rangerRiskEvidenceAt<120000)return rangerRiskEvidence;
  const state=lastRoomState||{};
  try{
    const response=await fetch('/api/ranger-auto/runs?limit=24',{headers:{accept:'application/json'}});
    if(!response.ok)throw new Error('history unavailable');
    const data=await response.json();
    const runs=(Array.isArray(data&&data.runs)?data.runs:[]).filter(run=>run&&String(run.accountId||'')===String(state.accountId||'')&&String(run.accountMode||'unknown')===String(state.accountMode||'unknown'));
    rangerRiskRuns=runs;
    const tools=rangerRiskTools();
    rangerRiskEvidence=tools?tools.timing.summarizeRunEvidence(runs):null;
    rangerRiskEvidenceAt=now;
  }catch{rangerRiskEvidence=rangerRiskEvidence||null}
  return rangerRiskEvidence;
}
function rangerRiskRequestEstimate(model){
  const tools=rangerRiskTools(),slot=$('rangerRiskEstimateSlot');
  if(!slot)return;
  if(!tools){slot.replaceChildren(rangerRiskNode('p','risk-note','Time estimate unavailable: the timing calculator did not load.'));return}
  const token=++rangerRiskEstimateToken;
  clearTimeout(rangerRiskEstimateTimer);
  rangerRiskEstimateTimer=setTimeout(()=>{
    void (async()=>{
      const evidence=await rangerRiskLoadEvidence();
      if(token!==rangerRiskEstimateToken)return;
      const firstStep=model.ladder.steps[0];
      const estimate=tools.timing.estimateTimeToTarget({evidence,target:model.config.takeProfit,perWinProfit:model.config.perWinProfit,avgLossAmount:firstStep&&firstStep.stake!==null?firstStep.stake:null,lossesToCooldown:model.config.lossesToCooldown,cooldownSeconds:model.config.cooldownSeconds,maxRunLoss:model.config.maxRunLoss});
      rangerRiskEstimate=estimate;
      const live=$('rangerRiskEstimateSlot');
      if(live)live.replaceChildren(...rangerRiskEstimateNodes(estimate,tools));
    })();
  },260);
}
function rangerRiskConfirmStart(){
  const model=rangerRiskBuildModel();
  rangerRiskPreviewModel=model;
  if(model.error||rangerRiskPreviewBlocker){rangerRiskRenderPreview();return}
  if(model.ladder.payoutBlocked){rangerRiskRenderPreview();return}
  if(rangerRiskFingerprint()!==rangerRiskPreviewSnapshot){
    rangerRiskPreviewSnapshot=rangerRiskFingerprint();
    rangerRiskRenderPreview();
    notify('Settings, balance or account changed. Review the recalculated preview before starting.');
    return;
  }
  rangerRiskClosePreview();
  startRangerAuto();
}

/* ---------- run report ---------- */
const rangerRiskOutcomeLabels={take_profit:'Take profit reached',max_run_loss:'Maximum run loss reached',manual_stop:'Stopped by the player',authorization:'Authorization or session ended',market_safety:'Trading or market safety stop',risk_gate:'Stake or risk gate blocked the run',session_expiry:'Session expired',other:'Run ended'};
function rangerRiskShowReport(report){
  rangerRiskLastReport=report;
  const card=$('rangerAutoRunReport'),body=$('rangerAutoRunReportBody'),button=$('rangerAutoReportShow');
  if(button)button.hidden=false;
  if(!card||!body)return;
  body.replaceChildren();
  const currency=report.currency||'USD',winRate=report.trades>0?(report.wins/report.trades)*100:null;
  const outcome=rangerRiskBlock(null);
  outcome.append(rangerRiskNode('p','risk-line','Outcome: '+(rangerRiskOutcomeLabels[report.outcome]||rangerRiskOutcomeLabels.other)));
  if(report.stopReason)outcome.append(rangerRiskNode('p','risk-note',report.stopReason));
  body.append(outcome);
  const profitBlock=rangerRiskBlock('Profitability');
  profitBlock.append(rangerRiskConfig([
    ['Starting balance',report.startingBalance===null||report.startingBalance===undefined?'Unavailable':rangerRiskAmount(report.startingBalance,currency)],
    ['Ending balance (last confirmed)',report.endingBalance===null||report.endingBalance===undefined?'Unavailable':rangerRiskAmount(report.endingBalance,currency)],
    ['Net realized run profit',rangerRiskAmount(report.realizedProfit,currency)],
    ['Take-profit target',report.takeProfit>0?rangerRiskAmount(report.takeProfit,currency):'Take profit disabled'],
    ['Maximum run loss',report.maxRunLoss>0?rangerRiskAmount(report.maxRunLoss,currency):'Not set'],
    ['Peak run profit',rangerRiskAmount(report.peakProfit,currency)],
    ['Maximum run drawdown',rangerRiskAmount(report.maxDrawdown,currency)],
  ]));
  body.append(profitBlock);
  const trades=rangerRiskBlock('Trade results');
  trades.append(rangerRiskConfig([
    ['Completed trades',String(report.trades)],
    ['Wins',String(report.wins)],
    ['Losses',String(report.losses)],
    ['Win rate',winRate===null?'Not available':winRate.toFixed(1)+'%'],
    ['Average winning profit',report.avgWinProfit===null||report.avgWinProfit===undefined?'Not available':rangerRiskAmount(report.avgWinProfit,currency)],
    ['Average losing amount',report.avgLossProfit===null||report.avgLossProfit===undefined?'Not available':rangerRiskAmount(report.avgLossProfit,currency)],
    ['Largest individual loss',report.largestLoss?rangerRiskAmount(report.largestLoss,currency):'None'],
    ['Longest losing streak',String(report.longestLossStreak)],
    ['Cooldown activations',String(report.cooldowns)],
    ['Settled stakes traded',rangerRiskAmount(report.settledStakes,currency)],
  ]));
  body.append(trades);
  const timing=rangerRiskBlock('Timing');
  timing.append(rangerRiskConfig([
    ['Started',new Date(report.startedAt).toLocaleString()],
    ['Ended',new Date(report.endedAt).toLocaleString()],
    ['Total elapsed',rangerRiskDuration(report.wallMs)],
    ['Active trading time',rangerRiskDuration(report.activeMs)],
    ['Total cooldown time',rangerRiskDuration(report.cooldownMs)],
    ['Time waiting for signals',rangerRiskDuration(report.waitingMs)],
    ['Average per completed trade',report.avgTradeMs?rangerRiskDuration(report.avgTradeMs):'No completed trades'],
  ]));
  body.append(timing);
  const target=rangerRiskBlock('Target performance');
  target.append(rangerRiskConfig([
    ['Target selected at start',report.takeProfit>0?rangerRiskAmount(report.takeProfit,currency):'Take profit disabled'],
    ['Target reached',report.targetReached?'Yes':'No'],
    ['Actual time to take profit',report.targetReached&&report.timeToTargetMs?rangerRiskDuration(report.timeToTargetMs):'Not reached'],
    ['Original time estimate',report.estimatedTimeToTargetMs?rangerRiskDuration(report.estimatedTimeToTargetMs):'No estimate was available'],
    ['Estimate vs actual',report.targetReached&&report.timeToTargetMs&&report.estimatedTimeToTargetMs?rangerRiskDuration(Math.abs(report.timeToTargetMs-report.estimatedTimeToTargetMs))+(report.timeToTargetMs>report.estimatedTimeToTargetMs?' slower':' faster'):'Not comparable'],
  ]));
  body.append(target);
  card.hidden=false;
}
function rangerRiskCloseReport(){
  const card=$('rangerAutoRunReport');
  if(card)card.hidden=true;
}
function rangerRiskOpenLastReport(){
  if(!rangerRiskLastReport){void rangerRiskShowRecentRuns();return}
  rangerRiskShowReport(rangerRiskLastReport);
}
async function rangerRiskShowRecentRuns(){
  const card=$('rangerAutoRunReport'),body=$('rangerAutoRunReportBody');
  if(!card||!body)return;
  const evidence=await rangerRiskLoadEvidence(true);
  const list=Array.isArray(rangerRiskRuns)?rangerRiskRuns:[];
  const tools=rangerRiskTools();
  body.replaceChildren();
  const heading=rangerRiskBlock('Recent Ranger Auto runs');
  if(!list.length){
    heading.append(rangerRiskNode('p','risk-note','No finished runs are stored for this account yet.'));
  }else{
    const recent=rangerRiskNode('div','risk-recent');
    for(const run of list.slice(0,12)){
      const button=rangerRiskNode('button');
      button.type='button';
      button.append(rangerRiskNode('span','',new Date(run.endedAt).toLocaleString()+' · '+(rangerRiskOutcomeLabels[run.outcome]||run.outcome)+' · '+run.trades+' trades'),rangerRiskNode('b','',rangerRiskAmount(run.realizedProfit,run.currency||'USD')));
      button.addEventListener('click',()=>rangerRiskShowReport(run));
      recent.append(button);
    }
    heading.append(recent);
  }
  const minRuns=tools&&tools.timing?tools.timing.MIN_RUNS_FOR_ESTIMATE:3;
  if(evidence&&!evidence.enoughRuns)heading.append(rangerRiskNode('p','risk-note','Not enough completed Ranger runs to estimate time reliably ('+evidence.runs+'/'+minRuns+').'));
  body.append(heading);
  card.hidden=false;
}
function rangerRiskOnRoomState(){
  rangerRiskRestoreRun();
  if(rangerRun.runId&&!rangerRun.finished)rangerRiskRenderTimer();
  if(rangerRiskPreviewOpen&&rangerRiskPreviewSnapshot&&rangerRiskFingerprint()!==rangerRiskPreviewSnapshot){
    rangerRiskPreviewModel=rangerRiskBuildModel();
    rangerRiskPreviewSnapshot=rangerRiskFingerprint();
    rangerRiskRenderPreview();
  }
}

$('rangerAutoToggle').addEventListener('click',()=>{rangerAutoMenuOpen=!rangerAutoMenuOpen;renderRangerAutoHud()});$('rangerAutoStart').addEventListener('click',()=>{if(rangerAutoActive)stopRangerAuto('Automation paused','manual_stop');else rangerRiskOpenPreview()});for(const id of ['rangerAutoLossLimit','rangerAutoCooldownSeconds','rangerAutoTakeProfit','rangerAutoMaxRunLoss','rangerAutoMinEdge','rangerManualShots','rangerAutoShots','rangerPaperCount','rangerPaperWinTarget','rangerRingGreen','rangerRingGold','rangerRingRed','rangerPaperEnabled'])$(id).addEventListener('change',saveRangerAutoSettings);$('rangerAutoStake').addEventListener('input',()=>{const stake=$('cowStake'),autoStake=$('rangerAutoStake');stake.value=autoStake.value;stake.dispatchEvent(new Event('input',{bubbles:true}));renderRangerAutoHud()});$('rangerAutoStyle').addEventListener('change',()=>{const style=$('cowBetStyle');style.value=$('rangerAutoStyle').value;style.dispatchEvent(new Event('change',{bubbles:true}));renderRangerAutoHud()});$('rangerAutoArm').addEventListener('click',()=>{if(rangerAutoArmBusy)return;if(lastRoomState?.accountMode!=='real'||!lastRoomState?.owner){rangerAutoStatus='Select an owner-authorized real account to arm';renderRangerAutoHud();return}rangerAutoArmBusy=true;rangerAutoStatus='Requesting a 10-minute real-money arm';renderRangerAutoHud();parent.postMessage({type:'zeronine:room-auto-arm'},location.origin)});if($('rangerRiskPreviewClose'))$('rangerRiskPreviewClose').addEventListener('click',rangerRiskClosePreview);
if($('rangerRiskPreviewBack'))$('rangerRiskPreviewBack').addEventListener('click',rangerRiskClosePreview);
if($('rangerRiskPreviewConfirm'))$('rangerRiskPreviewConfirm').addEventListener('click',rangerRiskConfirmStart);
if($('rangerAutoReportClose'))$('rangerAutoReportClose').addEventListener('click',rangerRiskCloseReport);
if($('rangerAutoReportHide'))$('rangerAutoReportHide').addEventListener('click',rangerRiskCloseReport);
if($('rangerAutoReportRecent'))$('rangerAutoReportRecent').addEventListener('click',()=>{void rangerRiskShowRecentRuns()});
if($('rangerAutoReportShow'))$('rangerAutoReportShow').addEventListener('click',rangerRiskOpenLastReport);
window.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(rangerRiskPreviewOpen){event.preventDefault();rangerRiskClosePreview()}else if($('rangerAutoRunReport')&&!$('rangerAutoRunReport').hidden){event.preventDefault();rangerRiskCloseReport()}});
$('ghostReplayRun').addEventListener('click',()=>{if(ghostReplayPending||!lastRoomState?.research?.canRun)return;ghostReplayPending=true;renderGhostPanel.lastKey=null;renderGhostPanel();parent.postMessage({type:'zeronine:room-research-replay'},location.origin)});$('ghostResearchMore').addEventListener('click',()=>{setGhostPanelOpen(false);parent.postMessage({type:'zeronine:room-navigate',page:'backtest'},location.origin)});window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==parent||event.data?.type!=='zeronine:room-research-result')return;ghostReplayPending=false;renderGhostPanel.lastKey=null;renderGhostPanel();notify(event.data.message||'Research updated.')});$('ghostPanelClose').addEventListener('click',()=>setGhostPanelOpen(false));$('ghostPanelShortcut').addEventListener('click',()=>setGhostPanelOpen(!ghostPanelOpen));window.addEventListener('resize',positionGhostPanel);window.addEventListener('keydown',event=>{if(event.key==='Escape'&&ghostPanelOpen)setGhostPanelOpen(false)});loadRangerAutoSettings();renderRangerAutoHud();})();
