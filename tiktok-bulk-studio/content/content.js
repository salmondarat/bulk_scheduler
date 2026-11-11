/*
 * Boot. Runs after store.js, csv.js, automation.js and panel.js.
 */
(() => {
  'use strict';

  if (globalThis.__TTBULK_BOOTED__) return;
  Object.defineProperty(globalThis, '__TTBULK_BOOTED__', { value: true });

  const TAG = location.hostname.includes('business.facebook') ? '[fbbulk]' : '[ttbulk]';
  const panel = globalThis.__TTBULK_PANEL__;
  if (!panel) {
    console.warn(`${TAG} panel module missing — the extension files are out of sync.`);
    return;
  }

  // Makes it obvious in the console which build a tab is actually running.
  console.info(`${TAG} content scripts loaded, panel v${panel.version || '?'} on ${location.hostname}`);

  panel
    .mount()
    .then(() => panel.resumeIfNeeded())
    .catch((error) => {
      console.warn('[ttbulk] could not mount the panel', error);
      // The panel is the only UI; if it cannot render, say why in the open.
      const reason = document.createElement('div');
      reason.textContent = `Bulk uploader failed to start: ${(error && error.message) || error}`;
      reason.style.cssText =
        'position:fixed;right:16px;top:72px;z-index:2147483000;max-width:360px;padding:10px 12px;' +
        'background:#241213;color:#ff9aa9;border:1px solid #3d1e21;border-radius:10px;' +
        'font:12px/1.5 system-ui,sans-serif';
      document.documentElement.append(reason);
    });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message.type !== 'string') return;
    if (message.type !== 'ttbulk:show') return;
    try {
      panel.show();
    } catch (error) {
      console.warn('[ttbulk] could not show the panel', error);
    }
  });
})();
