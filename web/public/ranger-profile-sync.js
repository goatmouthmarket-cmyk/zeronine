(() => {
  let account;
  let generation = 0;
  let loaded = false;
  let lastAttempt = 0;
  function guestProfile() {
    let appearance = {};
    let name = '';
    try { appearance = JSON.parse(localStorage.getItem('pasture-ranger-appearance') || '{}'); } catch {}
    try { name = localStorage.getItem('pasture-chat-name') || ''; } catch {}
    return { name, appearance };
  }
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== parent) return;
    if (event.data?.type === 'zeronine:ranger-profile') {
      generation++;
      loaded = true;
      window.__applyRangerProfile?.(event.data.profile || {});
      return;
    }
    if (event.data?.type !== 'zeronine:room-state') return;
    const state = event.data.state || {};
    const next = state.accountId && (state.accountMode === 'demo' || state.accountMode === 'real') ? String(state.accountId) : null;
    if (account !== next) {
      account = next;
      generation++;
      loaded = !account;
      lastAttempt = 0;
      window.__applyRangerProfile?.(account ? {} : guestProfile());
    }
    if (!account || loaded || Date.now() - lastAttempt < 10000) return;
    const expected = account, current = generation;
    lastAttempt = Date.now();
    fetch('/api/player/ranger-profile', { credentials: 'same-origin', cache: 'no-store' })
      .then(response => { if (!response.ok) throw new Error('Profile unavailable'); return response.json(); })
      .then(data => {
        if (generation !== current || account !== expected || data.accountId !== expected) return;
        loaded = true;
        window.__applyRangerProfile?.(data.profile || {});
      }).catch(() => {});
  });
})();
