/* Forward an unclaimed Enter from the game page to its same-origin chat. */
(() => {
  'use strict';
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
    if (!(event.target === document.body || event.target === document.documentElement)) return;
    if (!document.querySelector('.app[data-page="home"]')) return;
    const dialogOpen = Array.from(document.querySelectorAll('dialog[open], [role="dialog"]:not([hidden]), [aria-modal="true"]'))
      .some((el) => el.getClientRects().length > 0);
    if (dialogOpen) return;
    const frame = document.querySelector('iframe.trading-room-frame');
    if (!frame || !frame.getClientRects().length || !frame.contentWindow) return;
    frame.contentWindow.postMessage({ type: 'zeronine:focus-chat' }, location.origin);
    event.preventDefault();
  });
})();
