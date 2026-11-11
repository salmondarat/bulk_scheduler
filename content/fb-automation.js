/*
 * Facebook bulk composer automation — scheduling only.
 *
 * The bulk upload composer (business.facebook.com/latest/bulk_upload_composer)
 * shows one row per uploaded video, each with a description editor and its own
 * publish-mode dropdown. Opening that dropdown shows the panel with the tabs
 * "Terbitkan sekarang | Jadwal | Simpan sebagai Draf"; everything is set through
 * the panel's own widgets — the date field, the hidden hour/minute spinbuttons
 * and the "Perbarui" button — because the page is React: values injected
 * behind its events are invisible to it.
 *
 * This module never publishes. No code path here touches "Terbitkan"; the run
 * stops after every schedule is saved and verified, so a human can check the
 * rows before anything goes out.
 *
 * Input quirks that cost real attempts before this routine worked, kept as
 * rules rather than options:
 *   - The date field is filled by selecting its text and inserting the new
 *     value as text; a plain `value =` assignment is eaten by React.
 *   - The hour/minute spinbuttons are invisible (opacity 0) and only take
 *     input after a programmatic focus; digits go in one keyDown/keyUp pair
 *     each, never as a bulk insert.
 *   - Facebook rejects anything beyond 20 minutes..29 days from "now" — the
 *     boundary is checked before a panel is even opened.
 */
(function (global) {
  'use strict';

  const F = {};

  const COMPOSER_RE = /\/latest\/(bulk_upload_composer|composer)/;

  /* Text matchers, Indonesian first (the account UI), English as fallback. */
  const TXT = {
    publishNow: /^(terbitkan sekarang|publish now)$/i,
    scheduled: /jadwal|scheduled/i,
    scheduleTab: /^jadwal|^schedule/i,
    draft: /^(simpan sebagai draf|save as draft)$/i,
    options: /^(opsi penjadwalan|scheduling options)$/i,
    update: /^(perbarui|update)$/i,
    hour: /^(jam|hour)$/i,
    minute: /^(menit|minute)$/i
  };

  const MONTH_WORDS = {
    januari: 0, februari: 1, maret: 2, april: 3, mei: 4, juni: 5,
    juli: 6, agustus: 7, september: 8, oktober: 9, november: 10, desember: 11,
    january: 0, february: 1, march: 2, may: 4, june: 5, july: 6,
    august: 7, october: 9, december: 11
  };

  /* ------------------------------------------------------------------ *
   * helpers
   * ------------------------------------------------------------------ */

  F.onStep = () => {};
  const step = (message, kind = '') => F.onStep(message, kind);

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const norm = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const pad2 = (n) => String(n).padStart(2, '0');

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  /** Like isVisible but tolerant of the opacity:0 spinbuttons. */
  function isReachable(el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  async function waitFor(fn, { timeout = 20000, interval = 200, label = 'element' } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      let value = null;
      try {
        value = fn();
      } catch {
        value = null;
      }
      if (value) return value;
      await sleep(interval);
    }
    throw new Error(`Timed out after ${Math.round(timeout / 1000)}s waiting for ${label}.`);
  }

  function clickEl(el, offsetX = 0) {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
    } catch {
      /* ignore */
    }
    const rect = el.getBoundingClientRect();
    const base = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2 + offsetX,
      clientY: rect.top + rect.height / 2
    };
    el.dispatchEvent(new PointerEvent('pointerdown', base));
    el.dispatchEvent(new MouseEvent('mousedown', base));
    el.dispatchEvent(new PointerEvent('pointerup', base));
    el.dispatchEvent(new MouseEvent('mouseup', base));
    if (typeof el.click === 'function') el.click();
    else el.dispatchEvent(new MouseEvent('click', base));
    return true;
  }

  const isDisabled = (el) =>
    Boolean(el) && (el.disabled || el.getAttribute('aria-disabled') === 'true');

  /** React keeps its own value, so writes go through the prototype setter. */
  function setNativeValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** Close any open schedule panel without saving anything pending. */
  function pressEscape() {
    const active = document.activeElement;
    const target = active && active !== document.body && active instanceof HTMLElement ? active : document.body;
    for (const type of ['keydown', 'keyup']) {
      target.dispatchEvent(
        new KeyboardEvent(type, {
          key: 'Escape',
          code: 'Escape',
          keyCode: 27,
          which: 27,
          bubbles: true,
          cancelable: true
        })
      );
    }
  }

  /**
   * Trusted typing over CDP, via the background worker. Meta's schedule panel
   * ignores every synthetic event on its hour/minute spinbuttons — only real
   * key events change them, and content scripts cannot reach chrome.debugger.
   * Event format proven live in the earlier session: per character a
   * keyDown + keyUp pair with code "Digit<k>" / windowsVirtualKeyCode 48+k
   * ("keyChar" is rejected by the protocol with -32602).
   */
  async function trustedType(text) {
    const events = [];
    for (const ch of String(text)) {
      const digit = /^[0-9]$/.test(ch);
      const code = digit ? `Digit${ch}` : ch === '/' ? 'Slash' : `Key${ch.toUpperCase()}`;
      const vk = digit ? 48 + Number(ch) : ch === '/' ? 191 : 0;
      events.push({ type: 'keyDown', key: ch, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: ch, unmodifiedText: ch });
      events.push({ type: 'keyUp', key: ch, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    }
    const res = await chrome.runtime.sendMessage({ kind: 'fbbulk:keys', events });
    if (!res || !res.ok) throw new Error(`Ketik trusted (CDP) gagal: ${(res && res.error) || 'tidak ada jawaban dari background'}`);
  }

  /** Trusted Escape — the synthetic one sometimes does not close the panel. */
  async function pressEscapeTrusted() {
    const esc = { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
    await chrome.runtime.sendMessage({ kind: 'fbbulk:keys', events: [esc, { ...esc, type: 'keyUp' }] });
  }

  /** One keyDown/keyUp pair, the way the hour/minute digits go in. */
  function pressKey(el, key, keyCode) {
    for (const type of ['keydown', 'keyup']) {
      el.dispatchEvent(
        new KeyboardEvent(type, {
          key,
          code: key === ' ' ? 'Space' : key === 'Enter' ? 'Enter' : key,
          keyCode,
          which: keyCode,
          bubbles: true,
          cancelable: true
        })
      );
    }
  }

  /* ------------------------------------------------------------------ *
   * page
   * ------------------------------------------------------------------ */

  F.onUploadPage = () => COMPOSER_RE.test(location.pathname);

  F.pageError = () => {
    for (const el of document.querySelectorAll('[role="alert"], h1, h2, h3')) {
      if (!isVisible(el)) continue;
      const text = norm(el.textContent);
      if (text && text.length < 80 && /(terjadi kesalahan|something went wrong|coba lagi|n?try again)/i.test(text)) {
        return text;
      }
    }
    return null;
  };

  F.prepare = async () => {
    if (F.pageError()) {
      step('Halaman composer menampilkan pesan kesalahan — muat ulang dulu.', 'warn');
      return false;
    }
    if (!F.onUploadPage()) return false;

    await waitFor(() => (F.editors().length ? true : null), {
      timeout: 30000,
      interval: 400,
      label: 'baris unggahan di composer'
    }).catch(() => null);

    if (!F.editors().length) {
      throw new Error(
        'Tidak ada baris unggahan yang terlihat. Pastikan halaman ini adalah bulk upload composer dan videonya sudah ditambahkan.'
      );
    }
    return true;
  };

  /* ------------------------------------------------------------------ *
   * rows — identified by their description editors
   * ------------------------------------------------------------------ */

  /**
   * Each upload row carries a description contenteditable, and document order
   * matches the row order, so the editor doubles as the row handle. Rows are
   * re-read on every lookup: the composer re-renders while uploads finish.
   */
  F.editors = () => [...document.querySelectorAll('div[contenteditable="true"]')].filter((el) => isVisible(el));

  const editorText = (editor) => (editor ? norm(editor.innerText || editor.textContent) : '');

  F.rowText = (index) => editorText(F.editors()[index]);

  F.rowCount = () => F.editors().length;

  /**
   * The publish-mode dropdown lives somewhere up the tree from the editor.
   * The first ancestor holding exactly one matching button is the row.
   */
  function findModeButton(editor) {
    let node = editor;
    for (let level = 0; level < 12; level++) {
      node = node.parentElement;
      if (!node || node === document.body) break;
      const matches = [...node.querySelectorAll('button,[role="button"]')].filter((el) => {
        const text = norm(el.textContent);
        // "Opsi penjadwalan" is what the same button reads while its panel is
        // open — it is still the row's mode control.
        return TXT.publishNow.test(text) || TXT.options.test(text) || (TXT.scheduled.test(text) && text.length < 30);
      });
      const usable = matches.filter((el) => isVisible(el) && !isDisabled(el));
      if (usable.length === 1) return { button: usable[0], level };
    }
    return null;
  }

  /**
   * Which row belongs to which CSV line. The description already holds the
   * caption, so captions are matched first.
   *
   * Positional order is only trusted when the composer is silent (all
   * descriptions empty — then order is all there is) or for lines without a
   * caption. A composer that shows description text while a captioned CSV
   * line finds no match means the two disagree, and guessing would write the
   * wrong caption onto the wrong reel — that is an abort, not a fallback.
   */
  F.mapRows = (wants) => {
    const editors = F.editors();
    const texts = editors.map((el) => editorText(el).toLowerCase());
    const anyText = texts.some((text) => text.length >= 4);
    const used = new Set();
    const pairs = [];

    for (const want of wants) {
      const cap = norm(want.caption || '').toLowerCase();
      let index = -1;
      let way = null;
      if (cap.length >= 4) {
        index = texts.findIndex(
          (text, i) => !used.has(i) && text.length >= 4 && (text === cap || text.includes(cap) || cap.includes(text))
        );
        if (index >= 0) way = 'caption';
      }
      if (index >= 0) used.add(index);
      pairs.push({ want, index, way });
    }

    const captionedMiss = pairs.filter(
      (pair) => norm(pair.want.caption || '').length >= 4 && pair.index < 0
    ).length;
    if (anyText && captionedMiss > 0) {
      throw new Error(
        `${captionedMiss} baris CSV tidak menemukan deskripsi yang cocok di composer, tapi composer memuat teks deskripsi. ` +
          'Kosongkan deskripsi composer agar diisi dari CSV, atau samakan kolom caption CSV dengan isinya — urutan tidak ditebak agar reel tidak tertukar caption.'
      );
    }

    return pairs.map((pair, position) => {
      if (pair.index >= 0) return { index: pair.index, way: pair.way, filename: pair.want.filename };
      let index = -1;
      if (!used.has(position) && position < texts.length) index = position;
      else index = texts.findIndex((_, i) => !used.has(i));
      if (index < 0) {
        throw new Error(
          `Composer hanya menampilkan ${texts.length} baris — "${pair.want.filename || 'baris ' + (position + 1)}" tidak punya baris.`
        );
      }
      used.add(index);
      return { index, way: 'order', filename: pair.want.filename };
    });
  };

  /* ------------------------------------------------------------------ *
   * description
   * ------------------------------------------------------------------ */

  /**
   * Same rule as TikTok's Draft.js: text goes in the way a person puts it
   * there — select all, delete, then one paste event. Multi-line captions
   * survive as paragraphs.
   */
  F.fillDescriptionAt = async (index, text) => {
    const value = String(text || '');
    if (!value) throw new Error(`Baris ${index + 1} menerima deskripsi kosong dari CSV.`);
    let editor = F.editors()[index];
    if (!editor) throw new Error(`Baris ${index + 1} tidak punya editor deskripsi.`);
    if (editorText(editor) === norm(value)) return value.length;

    clickEl(editor);
    await sleep(150);
    editor = F.editors()[index] || editor;
    editor.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
    if (editor.textContent.trim()) document.execCommand('delete');

    let guard = 0;
    while (editor.textContent.trim() && guard++ < 120) {
      editor.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true, cancelable: true })
      );
      await sleep(20);
      if (editor.textContent.trim()) {
        const sweep = document.createRange();
        sweep.selectNodeContents(editor);
        selection.removeAllRanges();
        selection.addRange(sweep);
        document.execCommand('delete');
      }
    }

    const transfer = new DataTransfer();
    transfer.setData('text/plain', value);
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));

    await waitFor(
      () => (editorText(F.editors()[index] || editor) === norm(value) ? true : null),
      { timeout: 8000, interval: 200, label: `deskripsi baris ${index + 1} mengambil teks` }
    );
    return value.length;
  };

  /* ------------------------------------------------------------------ *
   * the schedule panel
   * ------------------------------------------------------------------ */

  /* The panel's tabs are div[role=button], not <button> — verified live. */
  const TAB_LIKE = 'button,[role="button"],[role="tab"],[role="menuitem"],[role="menuitemradio"],[role="option"],li';

  function hasDraftText(scope) {
    return [...scope.querySelectorAll('button,div,span,li,a')].some(
      (el) => TXT.draft.test(norm(el.textContent)) && norm(el.textContent).length < 40
    );
  }

  function panelHasTab(panel) {
    return [...panel.querySelectorAll(TAB_LIKE)].some((el) => TXT.scheduleTab.test(norm(el.textContent)) && norm(el.textContent).length < 30);
  }

  function findPanel() {
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"]')].filter(isVisible);
    const found =
      dialogs.find((d) => panelHasTab(d) || hasDraftText(d)) ||
      dialogs.find((d) => [...d.querySelectorAll('input')].some((el) => dateLike(el.value)));
    if (found) return found;

    // Anchor fallback: whatever its roles, the schedule panel is the visible
    // container that holds "Simpan sebagai draf" together with a "Jadwal"
    // tab. A composer row never carries both, so this cannot match a row.
    const draft = [...document.querySelectorAll('button,div,span,li,a')].find(
      (el) => TXT.draft.test(norm(el.textContent)) && norm(el.textContent).length < 40 && isVisible(el)
    );
    if (!draft) return null;
    let node = draft;
    for (let level = 0; level < 10 && node && node !== document.body; level++) {
      node = node.parentElement;
      if (!node) break;
      if (panelHasTab(node) && hasDraftText(node)) return node;
      if ([...node.querySelectorAll('input')].some((el) => dateLike(el.value))) return node;
    }
    return null;
  }

  function dateLike(value) {
    const text = norm(value);
    return /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(text) || /^\d{1,2}\s+[a-z]+\.?\s+\d{4}$/i.test(text);
  }

  function parseShownDate(value) {
    const text = norm(value);
    let match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (match) return { day: Number(match[1]), month: Number(match[2]) - 1, year: Number(match[3]) };
    match = text.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})/i);
    if (match && MONTH_WORDS[match[2].toLowerCase()] !== undefined) {
      return { day: Number(match[1]), month: MONTH_WORDS[match[2].toLowerCase()], year: Number(match[3]) };
    }
    return null;
  }

  const sameDate = (shown, target) => {
    const parsed = parseShownDate(shown);
    return Boolean(parsed) && parsed.day === target.getDate() && parsed.month === target.getMonth() && parsed.year === target.getFullYear();
  };

  function findDateInput() {
    const panel = findPanel();
    const scopes = panel ? [panel, document] : [document];
    for (const scope of scopes) {
      const inputs = [...scope.querySelectorAll('input')].filter(
        (el) => isVisible(el) && !['checkbox', 'radio', 'hidden', 'button', 'submit'].includes(el.type)
      );
      const byValue = inputs.find((el) => dateLike(el.value));
      if (byValue) return byValue;
      const byPlaceholder = inputs.find((el) => dateLike(el.placeholder));
      if (byPlaceholder) return byPlaceholder;
    }
    return null;
  }

  function findSpinbutton(which) {
    const re = which === 'hour' ? TXT.hour : TXT.minute;
    const panel = findPanel();
    const scopes = panel ? [panel, document] : [document];
    for (const scope of scopes) {
      const found = [...scope.querySelectorAll('input')].find((el) => {
        if (!el.isConnected || !isReachable(el)) return false;
        const type = String(el.type || 'text').toLowerCase();
        if (['checkbox', 'radio', 'hidden', 'button', 'submit'].includes(type)) return false;
        return re.test(norm(el.getAttribute('aria-label') || ''));
      });
      if (found) return found;
    }
    return null;
  }

  async function fillDate(input, target) {
    const value = `${pad2(target.getDate())}/${pad2(target.getMonth() + 1)}/${target.getFullYear()}`;
    clickEl(input);
    await sleep(120);
    input = findDateInput() || input;
    input.focus();
    input.select && input.select();
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, value);
    } catch {
      inserted = false;
    }
    await sleep(150);
    if (!inserted || !sameDate(findDateInput()?.value ?? input.value, target)) {
      const live = findDateInput() || input;
      setNativeValue(live, value);
      await sleep(150);
    }
    if (!sameDate((findDateInput() || input).value, target)) {
      // Trusted fallback: type the date digit by digit over CDP, the way the
      // hour/minute spinbuttons have to be filled.
      try {
        const live = findDateInput() || input;
        live.focus();
        await sleep(80);
        await trustedType(value);
        await sleep(200);
      } catch (error) {
        step(String((error && error.message) || error), 'warn');
      }
    }
    const shown = (findDateInput() || input).value;
    if (!sameDate(shown, target)) {
      throw new Error(`Tanggal tidak diterima — panel menampilkan "${shown || 'kosong'}" bukan ${value}.`);
    }
    return value;
  }

  const sameSpin = (input, digits) => {
    const value = Number(String(input.value ?? '').trim());
    const aria = Number(input.getAttribute('aria-valuenow'));
    return value === Number(digits) || aria === Number(digits);
  };

  async function setSpin(input, digits) {
    input.focus();
    await sleep(80);
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, digits);
    } catch {
      inserted = false;
    }
    await sleep(100);
    if (!inserted || !sameSpin(input, digits)) {
      input.focus();
      input.select && input.select();
      for (const ch of digits) {
        const opts = {
          key: ch,
          code: `Digit${ch}`,
          keyCode: 48 + Number(ch),
          which: 48 + Number(ch),
          bubbles: true,
          cancelable: true
        };
        input.dispatchEvent(new KeyboardEvent('keydown', opts));
        input.dispatchEvent(new KeyboardEvent('keyup', opts));
      }
      setNativeValue(input, digits);
      await sleep(120);
    }
    if (!sameSpin(input, digits)) {
      // The synthetic routes failed — as expected for Meta's spinbuttons.
      // Trusted CDP key events are what changed them in the manual session.
      try {
        input.focus();
        await sleep(80);
        await trustedType(digits);
        await sleep(200);
      } catch (error) {
        step(String((error && error.message) || error), 'warn');
      }
    }
    if (!sameSpin(input, digits)) {
      throw new Error(`Nilai "${digits}" tidak masuk ke input (panel menampilkan "${input.value || input.getAttribute('aria-valuenow') || 'kosong'}").`);
    }
  }

  async function fillTime(hour, minute) {
    const hourInput = await waitFor(() => findSpinbutton('hour'), {
      timeout: 6000,
      interval: 200,
      label: 'input jam di panel'
    });
    await setSpin(hourInput, pad2(hour));

    const minuteInput = await waitFor(() => findSpinbutton('minute'), {
      timeout: 6000,
      interval: 200,
      label: 'input menit di panel'
    });
    await setSpin(minuteInput, pad2(minute));

    const panel = findPanel();
    const liveHour = findSpinbutton('hour');
    const liveMinute = findSpinbutton('minute');
    if (!sameSpin(liveHour || hourInput, pad2(hour)) || !sameSpin(liveMinute || minuteInput, pad2(minute))) {
      if (panel) step('Nilai jam/menit berubah sendiri — dibaca ulang sebelum menyimpan.', 'warn');
    }
    return `${pad2(hour)}:${pad2(minute)}`;
  }

  /** Half a click: the press without its release, or the release without the press. */
  function halfClick(el, press) {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
    } catch {
      /* ignore */
    }
    const rect = el.getBoundingClientRect();
    const base = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    };
    if (press) {
      el.dispatchEvent(new PointerEvent('pointerdown', base));
      el.dispatchEvent(new MouseEvent('mousedown', base));
    } else {
      el.dispatchEvent(new PointerEvent('pointerup', base));
      el.dispatchEvent(new MouseEvent('mouseup', base));
      el.dispatchEvent(new MouseEvent('click', base));
    }
    return true;
  }

  /**
   * Opening the row's dropdown took several tries to make reliable: a plain
   * click sometimes does not register on Meta's div[role=button] — or opens
   * the menu and immediately toggles it shut again — so the open walks through
   * a full click, keyboard activation, a click on the label's left edge,
   * space, a press-only mousedown, and a release-only click, stopping at the
   * first attempt that produces the panel.
   */
  async function openPanel(found) {
    const attempts = [
      () => clickEl(found.button),
      () => {
        found.button.focus();
        pressKey(found.button, 'Enter', 13);
      },
      () => clickEl(found.button, -21),
      () => {
        found.button.focus();
        pressKey(found.button, ' ', 32);
      },
      () => halfClick(found.button, true),
      () => halfClick(found.button, false)
    ];
    for (let i = 0; i < attempts.length; i++) {
      try {
        attempts[i]();
      } catch {
        /* try the next way */
      }
      const panel = await waitFor(() => findPanel(), { timeout: 2200, interval: 150, label: 'panel jadwal' }).catch(() => null);
      if (panel) {
        if (i > 0) step(`Dropdown terbuka pada cara ke-${i + 1}.`, '');
        return panel;
      }
    }
    return null;
  }

  async function clickUpdate() {
    const panel = findPanel();
    const scopes = panel ? [panel, document] : [document];
    for (const scope of scopes) {
      // "Perbarui" is a div[role=button] in this panel, like every control
      // in it — a bare 'button' selector never finds it.
      const button = [...scope.querySelectorAll('button,div[role="button"]')].find(
        (el) => TXT.update.test(norm(el.textContent)) && isVisible(el) && !isDisabled(el)
      );
      if (button) {
        clickEl(button);
        return norm(button.textContent);
      }
    }
    throw new Error('Tombol "Perbarui" tidak ditemukan di panel jadwal.');
  }

  /* ------------------------------------------------------------------ *
   * schedule one row
   * ------------------------------------------------------------------ */

  F.windowCheck = (dateISO, timeHHMM) => {
    const match = String(dateISO || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return `"${dateISO}" bukan tanggal yang valid`;
    const [h, m] = String(timeHHMM || '').split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return `"${timeHHMM}" bukan jam yang valid`;
    const target = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), h, m, 0, 0);
    if (Number.isNaN(target.getTime())) return `"${dateISO} ${timeHHMM}" tidak bisa dibaca`;
    const now = Date.now();
    if (target.getTime() < now + 20 * 60 * 1000) return 'jadwalnya lebih awal dari 20 menit dari sekarang';
    if (target.getTime() > now + 29 * 24 * 60 * 60 * 1000) return 'melewati jendela 29 hari Facebook';
    return null;
  };

  const parseISODate = (value) => {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  };

  /**
   * The proven routine, one row at a time:
   * open the row's dropdown → tab "Jadwal" → date via select-all + insert →
   * hour/minute via focus + one key pair per digit → "Perbarui" → verify the
   * row now reads "Jadwal" and the description did not move.
   */
  F.setScheduleAt = async (index, dateISO, timeHHMM) => {
    const target = parseISODate(dateISO);
    if (!target) throw new Error(`"${dateISO}" bukan tanggal yang valid.`);
    const [hourRaw, minuteRaw] = String(timeHHMM || '').split(':');
    const hour = Math.min(23, Math.max(0, Number(hourRaw)));
    const minute = Math.min(59, Math.max(0, Number(minuteRaw)));
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) throw new Error(`"${timeHHMM}" bukan jam yang valid.`);

    const early = F.windowCheck(dateISO, timeHHMM);
    if (early) {
      throw new Error(`Facebook akan menolak jadwal ini: ${early}.`);
    }

    let editor = F.editors()[index];
    if (!editor) throw new Error(`Baris ${index + 1} sudah tidak ada di composer.`);
    const before = editorText(editor);

    const found = findModeButton(editor);
    if (!found) {
      throw new Error(`Baris ${index + 1}: tombol dropdown jadwal tidak ditemukan. Tekan Diagnose dan kirim JSON-nya.`);
    }

    let panel = await openPanel(found);
    if (!panel) {
      pressEscape();
      throw new Error(
        `Panel penjadwalan tidak muncul setelah dropdown dibuka (6 cara dicoba). ` +
          `Buka dropdown baris ${index + 1} manual, biarkan panel terbuka, lalu tekan Alt+D dan kirim JSON-nya.`
      );
    }
    // Snapshot the panel the moment automation opens it — if anything later
    // in the routine fails, the next Diagnose still carries what was inside.
    F.__lastPanelProbe = probePanel();

    try {
      const tab = [...panel.querySelectorAll(TAB_LIKE)].find(
        (el) => TXT.scheduleTab.test(norm(el.textContent)) && norm(el.textContent).length < 30 && isVisible(el) && !isDisabled(el)
      );
      if (tab) {
        clickEl(tab);
        await sleep(350);
        F.__lastPanelProbe = probePanel();
      }

      panel = findPanel() || panel;
      const dateInput = await waitFor(() => findDateInput(), { timeout: 6000, interval: 200, label: 'input tanggal di panel' });
      await fillDate(dateInput, target);
      const timeShown = await fillTime(hour, minute);
      await clickUpdate();

      await waitFor(() => (findPanel() ? null : true), { timeout: 10000, interval: 200, label: 'panel menutup setelah Perbarui' });
      await sleep(600);

      editor = F.editors()[index];
      if (!editor) throw new Error(`Baris ${index + 1} hilang dari composer setelah menyimpan.`);
      const found2 = findModeButton(editor);
      const label = found2 ? norm(found2.button.textContent) : '';
      if (!TXT.scheduled.test(label)) {
        throw new Error(`Jadwal belum terbaca tersimpan — tombol baris masih "${label || 'kosong'}".`);
      }
      if (before && editorText(editor) !== norm(before)) {
        throw new Error('Deskripsi berubah setelah jadwal disimpan — periksa baris ini manual.');
      }
      step(`Baris ${index + 1} tersimpan: ${label}`, 'ok');
      return `${dateISO} ${timeShown}`;
    } catch (error) {
      pressEscape();
      await sleep(250);
      if (findPanel()) {
        // The synthetic Escape did not land — Meta closes the panel on the
        // trusted one (proven in the manual session).
        try {
          await pressEscapeTrusted();
          await sleep(250);
        } catch {
          /* best effort */
        }
        if (findPanel()) pressEscape();
      }
      throw error;
    }
  };

  /* ------------------------------------------------------------------ *
   * diagnostics
   * ------------------------------------------------------------------ */

  const describe = (el) => {
    if (!el) return null;
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || undefined,
      ariaLabel: el.getAttribute('aria-label') || undefined,
      className: typeof el.className === 'string' ? el.className.slice(0, 90) || undefined : undefined,
      size: `${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`,
      text: norm(el.textContent).slice(0, 60) || undefined,
      visible: isVisible(el)
    };
  };

  /** Dumps the open schedule panel's internals, or null when it is closed. */
  function probePanel() {
    const tabs = [...document.querySelectorAll(TAB_LIKE)]
      .filter((el) => TXT.scheduleTab.test(norm(el.textContent)) && norm(el.textContent).length < 30 && isVisible(el))
      .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width);
    const tab = tabs[0];
    if (!tab) return null;

    const TAB_TEXT = /^(jadwal|terbitkan sekarang|simpan sebagai draf|schedule|publish now|save as draft)$/i;
    const summarize = (node) => {
      const inputs = [...node.querySelectorAll('input,textarea')].map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.type || 'text',
        ariaLabel: el.getAttribute('aria-label') || undefined,
        placeholder: el.placeholder || undefined,
        value: el.value,
        ariaValueNow: el.getAttribute('aria-valuenow') || undefined,
        visible: isVisible(el)
      }));
      const buttons = [...node.querySelectorAll('button,div[role="button"]')]
        .map((el) => ({
          text: norm(el.textContent).slice(0, 40),
          size: `${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`,
          ariaLabel: el.getAttribute('aria-label') || undefined
        }))
        .slice(0, 24);
      return {
        hasDateLikeInput: inputs.some((el) => dateLike(el.value) || dateLike(el.placeholder)),
        hasUpdateButton: buttons.some((el) => TXT.update.test(el.text)),
        inputs,
        buttons
      };
    };

    // The smallest "Jadwal" element is the tab strip; the real panel — with the
    // date/time fields and "Perbarui" — is one of its ancestors. Walk up
    // summarizing every level, keep the first level that holds actual panel
    // content, and ship all levels so nothing is ever invisible to Diagnose.
    let node = tab;
    const levels = [];
    let best = null;
    for (let level = 0; level < 12 && node && node !== document.body; level++) {
      node = node.parentElement;
      if (!node) break;
      const texts = [...node.querySelectorAll(TAB_LIKE)].map((el) => norm(el.textContent)).filter(Boolean);
      const tabCount = texts.filter((t) => TAB_TEXT.test(t)).length;
      if (tabCount < 3) break;
      const info = summarize(node);
      levels.push({ level, tabCount, ...info });
      if (!best && (info.hasDateLikeInput || info.hasUpdateButton)) {
        best = { foundAtLevel: level, tabs: texts.slice(0, 12), ...info };
      }
    }
    if (!best && levels.length) {
      const { level, tabCount, ...info } = levels[levels.length - 1];
      best = { foundAtLevel: level, tabs: null, ...info };
    }
    if (best) best.levels = levels.map(({ level, tabCount, hasDateLikeInput, hasUpdateButton }) => ({ level, tabCount, hasDateLikeInput, hasUpdateButton }));
    return best;
  }

  F.diagnose = () => {
    const editors = F.editors();
    const panelProbe = probePanel();

    return {
      when: new Date().toISOString(),
      url: location.href,
      onUploadPage: F.onUploadPage(),
      pageError: F.pageError(),
      rows: editors.length,
      panelProbe,
      lastPanelProbe: F.__lastPanelProbe || null,
      rowsSample: editors.slice(0, 10).map((editor, index) => {
        const found = findModeButton(editor);
        return {
          index: index + 1,
          description: editorText(editor).slice(0, 60),
          descriptionChars: editorText(editor).length,
          modeButton: found ? describe(found.button) : null,
          modeButtonLevel: found ? found.level : null
        };
      }),
      modeLikeButtons: [...document.querySelectorAll('button,[role="button"]')]
        .filter((el) => isVisible(el) && (TXT.publishNow.test(norm(el.textContent)) || TXT.scheduled.test(norm(el.textContent))))
        .slice(0, 12)
        .map((el) => describe(el)),
      dialogs: [...document.querySelectorAll('[role="dialog"], [role="menu"]')]
        .filter(isVisible)
        .slice(0, 4)
        .map((dialog) => ({
          tabs: [...dialog.querySelectorAll('button,[role="tab"],[role="menuitem"]')]
            .map((el) => norm(el.textContent))
            .filter(Boolean)
            .slice(0, 10),
          inputs: [...dialog.querySelectorAll('input')].slice(0, 12).map((el) => ({
            type: el.type || 'text',
            ariaLabel: el.getAttribute('aria-label') || undefined,
            value: el.value,
            ariaValueNow: el.getAttribute('aria-valuenow') || undefined,
            visible: isVisible(el),
            reachable: isReachable(el)
          }))
        }))
    };
  };

  Object.defineProperty(global, '__FBBULK_AUTOMATION__', { value: F, enumerable: false });
})(globalThis);
