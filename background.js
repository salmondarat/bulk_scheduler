/*
 * The panel lives inside the page it automates, so the worker only has to
 * surface it. Clicking the toolbar button shows the panel on the current
 * Studio / composer tab, or opens one of them if the user is not there yet.
 *
 * No job data ever passes through here — that is what removes the possibility
 * of a queue waiting on a tab that never answers.
 */

const TIKTOK_URL = 'https://www.tiktok.com/tiktokstudio/upload';
const FACEBOOK_URL = 'https://business.facebook.com/latest/bulk_upload_composer';
const IS_TIKTOK = /^https:\/\/www\.tiktok\.com\/(tiktokstudio|\/?upload)/;
const IS_FACEBOOK = /^https:\/\/business\.facebook\.com\/latest\/(bulk_upload_composer|composer)/;
const STORAGE_KEYS = ['ttbulk.v2', 'fbbulk.v1'];

async function showPanel(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ttbulk:show' });
    return true;
  } catch {
    return false;
  }
}

/** True while a panel is mid-queue, where a reload would interrupt a run. */
async function isRunning() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS);
    for (const key of STORAGE_KEYS) {
      if (stored[key] && stored[key].run && stored[key].run.active) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

async function focusTab(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

chrome.action.onClicked.addListener(async (tab) => {
  const active = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  const activeUrl = (active && active.url) || '';

  if (IS_TIKTOK.test(activeUrl) || IS_FACEBOOK.test(activeUrl)) {
    if (await showPanel(active.id)) return;
    // Script not injected yet (page loaded before the extension was installed).
    // Reload only when nothing is running — a reload mid-run costs a row.
    if (await isRunning()) {
      console.warn('[bulk] panel is running but not answering; reload the tab by hand once the queue stops.');
      return;
    }
    await chrome.tabs.reload(active.id);
    return;
  }

  // Not on either site: reuse an open tab (Facebook composer first, then
  // TikTok Studio) or open the Facebook composer, which is the busier flow.
  const fbTabs = await chrome.tabs.query({ url: 'https://business.facebook.com/latest/*' });
  if (fbTabs.length) {
    await focusTab(fbTabs[0]);
    if (await showPanel(fbTabs[0].id)) return;
    // Script not injected yet (stale tab from before the extension reloaded).
    if (await isRunning()) {
      console.warn('[bulk] panel is running but not answering; reload the tab by hand once the queue stops.');
      return;
    }
    await chrome.tabs.reload(fbTabs[0].id);
    return;
  }

  const ttTabs = await chrome.tabs.query({ url: 'https://www.tiktok.com/tiktokstudio/*' });
  if (ttTabs.length) {
    await focusTab(ttTabs[0]);
    if (await showPanel(ttTabs[0].id)) return;
    if (await isRunning()) {
      console.warn('[bulk] panel is running but not answering; reload the tab by hand once the queue stops.');
      return;
    }
    await chrome.tabs.reload(ttTabs[0].id);
    return;
  }

  await chrome.tabs.create({ url: FACEBOOK_URL, active: true });
});

/*
 * Trusted keyboard input over the Chrome DevTools Protocol. Meta's schedule
 * panel ignores every synthetic event for its hour/minute spinbuttons — only
 * real, trusted key events change them — and content scripts cannot use
 * chrome.debugger, so the content script asks this worker to type for it.
 *
 * Event format is the proven one from the manual session: per digit a
 * keyDown + keyUp pair with code "Digit<k>", text "<k>" and
 * windowsVirtualKeyCode 48+k ("keyChar" is rejected by the protocol).
 */
async function trustedKeys(tabId, events) {
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (error) {
    // Our own earlier attach (or the page's DevTools) — DevTools would make
    // the commands fail loudly below anyway, so only swallow our own.
    if (!/already attached/i.test(String(error && error.message))) throw error;
  }
  try {
    for (const event of events) {
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', event);
    }
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.kind === 'fbbulk:keys' && sender.tab && Array.isArray(msg.events)) {
    trustedKeys(sender.tab.id, msg.events)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String((error && error.message) || error) }));
    return true; // async response
  }
  return undefined;
});
