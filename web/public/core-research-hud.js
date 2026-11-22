/* Account-scoped, virtual-only Core scout. Closing this view never stops research. */
(() => {
  'use strict';
  const host = document.getElementById('coreResearchHud');
  if (!host || host.dataset.ready) return;
  host.dataset.ready = 'true';
  host.innerHTML = `<button type="button" class="crh-banner" aria-expanded="false" aria-controls="coreResearchDropdown"><span class="crh-mini" aria-hidden="true"><img src="/brain-pasture-scene.svg" alt=""><i></i></span><span class="crh-banner-copy"><strong>Research scout</strong><small class="crh-mini-status">Checking research</small><span class="crh-mini-results">Virtual only</span></span><span class="crh-chevron" aria-hidden="true">⌄</span></button>
    <section id="coreResearchDropdown" class="crh-panel" aria-label="Research scout" hidden>
      <header><div><strong>Research scout</strong><small>Virtual only · no account funds</small></div><button type="button" class="crh-close" aria-label="Close research">×</button></header>
      <div class="crh-scene"><img src="/brain-pasture-scene.svg" alt="The game's ranger scouting a cow"><i class="crh-scan" aria-hidden="true"></i><i class="crh-shot" aria-hidden="true">➜</i><span class="crh-scene-status">Scout resting</span></div>
      <div class="crh-score"><div><small>VIRTUAL PROFIT / LOSS</small><strong class="crh-profit">+0.00</strong></div><span class="crh-balance">Balance 100.00</span></div>
      <div class="crh-stats"><span><b class="crh-results">0</b> results</span><span><b class="crh-wins">0 / 0</b> wins / losses</span><span><b class="crh-drop">0.00</b> largest drop</span></div>
      <div class="crh-goals"><div class="crh-goal-title"><strong>Core record</strong><span class="crh-progress-label">0 / 200</span></div><progress class="crh-progress" max="200" value="0" aria-label="Results toward the Core Auto trial"></progress><div class="crh-checks"><span class="crh-quality">Prices saved<b>Waiting</b></span><span class="crh-return">Virtual result<b>Waiting</b></span><span class="crh-strength">Prediction check<b>Waiting</b></span></div><small class="crh-readiness">Collect results before the Auto trial.</small></div>
      <div class="crh-latest" aria-label="Latest virtual results"></div>
      <div class="crh-footer"><form class="crh-form"><details class="crh-settings"><summary>Virtual run settings</summary><div><label>Balance<input name="startingBalance" type="number" min="0.01" step="0.01" inputmode="decimal" value="100"></label><label>Stake<input name="stake" type="number" min="0.01" step="0.01" inputmode="decimal" value="1"></label><label>Profit target<input name="takeProfit" type="number" min="0.01" step="0.01" inputmode="decimal" value="5"></label><label>Loss limit<input name="maxLoss" type="number" min="0.01" step="0.01" inputmode="decimal" value="10"></label></div></details><button type="submit" class="crh-run" disabled>Start research</button></form>
      <button type="button" class="crh-connect crh-activate" hidden>Connect Deriv</button><button type="button" class="crh-activate crh-enable" hidden>Use Core for Auto</button><p class="crh-status" role="status" aria-live="polite">Checking research</p></div>
    </section>`;
  const $ = selector => host.querySelector(selector), panel = $('.crh-panel'), banner = $('.crh-banner');
  let state = null, opened = false, busy = false, stoppedForAuth = false, connected = false, identity = null, generation = 0, activeGet = null, activePost = null, lastTrade = null, shotTimer = 0;
  const amount = n => Number.isFinite(Number(n)) ? Number(n).toFixed(2) : '—';
  const signed = n => (Number(n) >= 0 ? '+' : '') + amount(n);
  const name = s => /^1HZ(\d+)V$/.test(s) ? 'Volatility ' + /^1HZ(\d+)V$/.exec(s)[1] + ' (1s)' : /^R_(\d+)$/.test(s) ? 'Volatility ' + /^R_(\d+)$/.exec(s)[1] : String(s || 'Market');
  const phase = () => {
    if (state && !connected) return 'Reconnecting';
    const labels = {'Target reached':'Target reached','Loss limit reached':'Loss limit reached','take-profit':'Target reached','max-loss':'Loss limit reached','Virtual stake limit reached':'Virtual stake limit reached','Remaining loss budget is smaller than the stake':'Loss budget reached','Saving unavailable · research paused':'Saving unavailable · paused','Saved run · paused':'Saved run · paused','Paused':'Research paused','Paused · finishing virtual trade':'Paused · finishing trade','Reconnect to continue research':'Reconnect to continue','Looking for a cow':'Scouting the pasture','Waiting for fresh prices':'Waiting for fresh prices','Checking a live quote':'Checking a live quote','Virtual trade open':'Virtual trade open','Quote unavailable · waiting':'Quote unavailable · waiting','Price gap · waiting':'Waiting for prices',open:'Virtual trade open',quoting:'Checking a quote','waiting-settlement':'Waiting for a result',scanning:'Scouting the pasture'};
    return labels[state?.run?.phase] || (state?.running ? 'Watching the pasture' : state?.run ? 'Research paused' : 'Scout resting');
  };
  function place() {
    if (!opened) return;
    const height = Math.min(innerHeight, window.visualViewport?.height || innerHeight), rect = banner.getBoundingClientRect(), width = Math.min(350, innerWidth - 16), top = Math.max(8, Math.min(rect.bottom + 6, height - 180)), left = Math.max(8, Math.min(rect.left, innerWidth - width - 8));
    let bottom = height - (innerWidth <= 700 ? 128 : 36);
    document.querySelectorAll('#chatToggle,#chatForm').forEach(element => { const r = element.getBoundingClientRect(); if (r.width && r.height && getComputedStyle(element).visibility !== 'hidden' && r.top > top + 100 && r.left < left + width && r.right > left) bottom = Math.min(bottom,r.top - 8); });
    panel.style.width = width + 'px'; panel.style.left = left + 'px'; panel.style.top = top + 'px';
    panel.style.maxHeight = Math.max(140, bottom - top) + 'px';
  }
  function toggle(value, restoreFocus = false) {
    opened = value; panel.hidden = !value; banner.setAttribute('aria-expanded', String(value)); host.classList.toggle('is-open', value); place();
    if (restoreFocus) banner.focus({preventScroll:true});
    if (value) void refresh();
  }
  function status(text) { $('.crh-status').textContent = text; if (!state) $('.crh-mini-status').textContent = text; }
  function render() {
    const run = state?.run, ready = state?.readiness, settled = Math.max(0, Number(ready?.settled ?? run?.settled) || 0), target = Math.max(1, Number(ready?.target) || 200), running = state?.running === true;
    host.classList.toggle('is-running', running && connected); $('.crh-mini-status').textContent = phase(); $('.crh-scene-status').textContent = phase();
    $('.crh-mini-results').textContent = state ? 'Core ' + settled + '/' + target + (run ? ' · run ' + signed(run.netProfit || 0) : ' · virtual') : 'Virtual only';
    $('.crh-profit').textContent = signed(run?.netProfit || 0); $('.crh-profit').classList.toggle('is-loss', Number(run?.netProfit) < 0);
    $('.crh-balance').textContent = 'Balance ' + amount(run?.balance ?? $('.crh-form [name="startingBalance"]').value);
    $('.crh-results').textContent = String(run?.settled || 0); $('.crh-wins').textContent = (run?.wins || 0) + ' / ' + (run?.losses || 0); $('.crh-drop').textContent = amount(run?.maxDrawdown || 0);
    $('.crh-progress-label').textContent = settled + ' / ' + target; $('.crh-progress').max = target; $('.crh-progress').value = Math.min(settled, target);
    const fills = Math.max(0, Number(ready?.fills ?? run?.fills) || 0), missing = Math.max(0, Number(ready?.missing ?? state?.coverage?.missing) || 0), quality = fills > 0 && missing / fills <= .05;
    $('.crh-quality b').textContent = fills ? Math.max(0,Math.round((fills-missing)/fills*100)) + '%' : 'Waiting'; $('.crh-quality').classList.toggle('is-complete', quality);
    const recordNet = ready?.netProfit ?? run?.netProfit;
    $('.crh-return b').textContent = settled ? signed(recordNet || 0) : 'Waiting'; $('.crh-return').classList.toggle('is-complete', settled > 0 && recordNet > 0);
    const compared = typeof ready?.modelBrier === 'number' && typeof ready?.baselineBrier === 'number', stronger = compared && ready.modelBrier <= ready.baselineBrier + 1e-12;
    $('.crh-strength b').textContent = !compared ? 'Waiting' : stronger ? 'Keeping up' : 'Needs work'; $('.crh-strength').classList.toggle('is-complete', stronger);
    const reason = String(ready?.reason || '');
    $('.crh-readiness').textContent = state?.autoEnabled ? 'Auto trial enabled. Start Auto when you choose.' : state?.canActivate ? 'Checks passed. You can enable the Auto trial.' : /baseline|calibrat|brier|prediction/i.test(reason) ? 'Predictions need a stronger record.' : /profit|return|net|ahead/i.test(reason) ? 'Research needs a positive overall result.' : /missing|coverage|complete|data/i.test(reason) ? 'Some trade details are still missing.' : /fresh/i.test(reason) ? 'Collect fresh results for the current Core.' : 'Collect more virtual results to check the record.';
    const action = $('.crh-run'); action.textContent = busy ? 'Updating…' : running ? 'Pause research' : run ? 'Start a new run' : 'Start research'; action.disabled = busy || !state || (!running && state.available !== true);
    action.hidden = stoppedForAuth; $('.crh-connect').hidden = !stoppedForAuth;
    $('.crh-form').querySelectorAll('input').forEach(input => { input.disabled = running || busy; });
    const activate = $('.crh-enable'); activate.hidden = !(state?.canActivate || state?.autoEnabled); activate.disabled = busy || state?.autoEnabled === true; activate.textContent = state?.autoEnabled ? 'Core enabled for Auto' : 'Use Core for Auto';
    const recent = Array.isArray(state?.recent) ? state.recent.slice(0, 2) : []; $('.crh-latest').replaceChildren();
    for (const trade of recent) { const row = document.createElement('div'), label = document.createElement('span'), result = document.createElement('b'); label.textContent = name(trade.market) + ' · ' + (trade.direction === 'under' ? 'Under ' : 'Over ') + trade.barrier; result.textContent = trade.status === 'open' ? 'Open' : trade.profit == null ? 'Missing price' : signed(trade.profit); result.className = trade.status === 'lost' ? 'is-loss' : ''; row.append(label,result); $('.crh-latest').append(row); }
    if (recent[0]?.id && lastTrade && recent[0].id !== lastTrade && running) { host.classList.add('is-shooting'); clearTimeout(shotTimer); shotTimer = setTimeout(() => host.classList.remove('is-shooting'), 1000); }
    lastTrade = recent[0]?.id || null;
    status(state?.available === false ? state.reason || 'Saved research is not ready yet.' : (run && !running ? phase() + '. ' : '') + 'Research checks Core. Your reviewed trades teach it.');
    place();
  }
  function clearAccount() { generation++; activeGet?.abort(); activePost?.abort(); activeGet = null; activePost = null; state = null; connected = false; busy = false; lastTrade = null; clearTimeout(shotTimer); host.classList.remove('is-running','is-shooting'); render(); status('Connect Deriv to keep your research.'); }
  function account(data) {
    const next = [data?.accountId || '', data?.accountMode || '', data?.authStatus || ''].join('|');
    if (identity === next) return;
    const connectedAccount = !!data?.accountId && (data?.accountMode === 'demo' || data?.accountMode === 'real');
    identity = next; stoppedForAuth = data?.authStatus === 'signed-out' && !connectedAccount; clearAccount(); if (!stoppedForAuth) void refresh();
  }
  async function refresh() {
    if (activeGet || busy || document.hidden || stoppedForAuth || !host.isConnected) return;
    const controller = new AbortController(), version = generation; activeGet = controller; const timeout = setTimeout(() => controller.abort(), 8000);
    try { const response = await fetch('/api/core/research',{credentials:'same-origin',cache:'no-store',signal:controller.signal}); const body = await response.json().catch(() => ({})); if (version !== generation) return;
      if (response.status === 401) { stoppedForAuth = true; clearAccount(); return; }
      if (!response.ok) throw Error(body.error || 'Research is temporarily unavailable.'); connected = true; state = body; render();
    } catch (error) { if (version === generation && (error.name !== 'AbortError' || !busy)) { connected = false; render(); status('Reconnecting. Last saved results are shown.'); $('.crh-mini-status').textContent = 'Reconnecting'; } }
    finally { clearTimeout(timeout); if (activeGet === controller) activeGet = null; }
  }
  async function act(action) {
    if (busy || !state || (action === 'start' && !state.available) || (action === 'activate' && !state.canActivate)) return;
    const values = Object.fromEntries(Array.from($('.crh-form').querySelectorAll('input')).map(input => [input.name,Number(input.value)]));
    if (action === 'start' && (!Object.values(values).every(Number.isFinite) || values.stake <= 0 || values.startingBalance < values.stake || values.takeProfit <= 0 || values.maxLoss <= 0 || values.maxLoss > values.startingBalance)) { status('Choose a positive stake and limits within the virtual balance.'); return; }
    const version = generation, controller = new AbortController(); activePost = controller; activeGet?.abort(); activeGet = null; busy = true; render(); const timeout = setTimeout(() => controller.abort(), 10000);
    try { const response = await fetch('/api/core/research/' + action,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(action === 'start' ? values : {}),signal:controller.signal}); const body = await response.json().catch(() => ({})); if (version !== generation) return; if (response.status === 401) { stoppedForAuth = true; clearAccount(); return; } if (!response.ok) throw Error(body.error || 'Research could not be updated.'); busy = false; await refresh(); }
    catch (error) { if (version === generation) { busy = false; render(); status(error.name === 'AbortError' ? 'Request timed out. Checking the saved run.' : error.message); } }
    finally { clearTimeout(timeout); if (activePost === controller) activePost = null; if (version === generation) { busy = false; $('.crh-run').disabled = !state || (!state.running && !state.available); } }
  }
  banner.addEventListener('click',() => toggle(!opened)); $('.crh-close').addEventListener('click',() => toggle(false,true));
  $('.crh-form').addEventListener('submit',event => {event.preventDefault(); void act(state?.running ? 'stop' : 'start');}); $('.crh-enable').addEventListener('click',() => void act('activate')); $('.crh-connect').addEventListener('click',() => parent.postMessage({type:'zeronine:room-navigate',page:'account'},location.origin));
  document.addEventListener('pointerdown',event => {if (opened && !host.contains(event.target)) toggle(false);});
  document.addEventListener('keydown',event => {if (opened && event.key === 'Escape') {event.preventDefault(); toggle(false,true);}});
  host.addEventListener('keydown',event => {if (event.key !== 'Escape' && event.target.closest('button,input,summary,select,textarea')) event.stopPropagation();});
  addEventListener('resize',place); window.visualViewport?.addEventListener('resize',place); document.addEventListener('visibilitychange',() => {host.classList.toggle('is-sleeping',document.hidden); if (!document.hidden) void refresh();});
  addEventListener('message',event => {if (event.origin === location.origin && event.source === parent && event.data?.type === 'zeronine:room-state') account(event.data.state);});
  addEventListener('zeronine:core-research-account',event => account(event.detail));
  setInterval(() => void refresh(),1500); void refresh();
})();
