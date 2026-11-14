/* Login feedback is presentation only; account state remains owned by the app. */
(() => {
  'use strict';
  const origin = location.origin;
  const marker = 'zeronine:awaiting-deriv-login';
  if (window.parent !== window) {
    const banner = document.getElementById('guestBanner');
    const label = document.getElementById('guestBannerMessage');
    if (!banner || !label) return;
    let pending = false, shownUntil = 0, lastAccount = null, hideTimer = 0;
    const readPending = () => { try { return sessionStorage.getItem(marker) === '1'; } catch { return false; } };
    const writePending = (value) => { try { if (value) sessionStorage.setItem(marker, '1'); else sessionStorage.removeItem(marker); } catch {} };
    function pulseBalance() {
      const balance = document.getElementById('accountBalance');
      if (balance) { balance.classList.remove('balance-just-loaded'); void balance.offsetWidth; balance.classList.add('balance-just-loaded'); }
      window.parent.postMessage({ type: 'zeronine:balance-loaded' }, origin);
    }
    window.addEventListener('message', (event) => {
      if (event.origin !== origin || event.source !== window.parent || event.data?.type !== 'zeronine:room-state') return;
      const state = event.data.state || {};
      const authenticated = (state.accountMode === 'demo' || state.accountMode === 'real') && typeof state.accountId === 'string' && state.accountId.length > 0;
      if (state.authStatus === 'signed-out' && !authenticated) {
        pending = true; writePending(true); shownUntil = 0; lastAccount = null; clearTimeout(hideTimer);
        return;
      }
      if (!authenticated) return;
      if (lastAccount !== state.accountId) { lastAccount = state.accountId; pulseBalance(); }
      if (pending || readPending()) {
        pending = false; writePending(false); shownUntil = Date.now() + 4000;
        clearTimeout(window.__guestBannerTimer); clearTimeout(hideTimer);
        hideTimer = setTimeout(() => { shownUntil = 0; if (banner.dataset.authState === 'connected') banner.hidden = true; }, 4000);
      }
      // The game may redraw account state while the banner is shown. Keep it visible
      // until its deadline, and never show a login success on ordinary reloads.
      if (Date.now() < shownUntil) {
        clearTimeout(window.__guestBannerTimer);
        label.textContent = 'Successfully logged in to Deriv - ' + (state.accountMode === 'demo' ? 'Demo' : 'Real') + ' account';
        banner.hidden = false;
      } else {
        clearTimeout(window.__guestBannerTimer);
        banner.hidden = true;
      }
    });
    return;
  }
  let waiting = false, timer = 0;
  function applyPulse() {
    if (!waiting) return;
    const amount = document.querySelector('.app[data-page="home"] .balance-amount');
    if (!amount) return;
    waiting = false;
    amount.classList.remove('balance-just-loaded');
    void amount.offsetWidth;
    amount.classList.add('balance-just-loaded');
    clearTimeout(timer);
    timer = setTimeout(() => amount.classList.remove('balance-just-loaded'), 1200);
  }
  window.addEventListener('message', (event) => {
    if (event.origin !== origin || event.data?.type !== 'zeronine:balance-loaded') return;
    const frame = document.querySelector('iframe.trading-room-frame');
    if (!frame || event.source !== frame.contentWindow) return;
    waiting = true; applyPulse();
  });
  new MutationObserver(applyPulse).observe(document.documentElement, { childList: true, subtree: true });
})();
