/*
 * TikTok Studio automation — the bulk publish table.
 *
 * The Studio upload page is a table, not a form:
 *
 *   Upload video | Caption | Scheduled | Visibility | Action
 *     Replace file   01 ✓     Post now    Public     ✎ 🗑
 *                                                    [ Post (N) ]
 *
 * So a batch is one shot: hand every file to the single hidden
 * `input[type=file][multiple]`, TikTok appends one row per file, then each row
 * gets its caption and its own schedule, and one "Post (N)" button publishes
 * the lot. Nothing here reloads the page per video.
 *
 * Everything is driven through TikTok's real widgets — the caption Draft.js
 * editor, the calendar and the hour/minute scroll columns — because the page
 * is React: injecting values into hidden state is invisible to it, clicking
 * its own controls is not.
 *
 * Every failure names the widget it could not find, so a broken selector is a
 * one-line fix instead of a guessing game.
 */
(function (global) {
  'use strict';

  const A = {};

  const UPLOAD_PATH = /\/tiktokstudio\/upload|^\/upload/;
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

  /* Selectors, all verified against the live page. */
  const SEL = {
    row: 'tr.task-draggable-row',
    rowIndex: '.row-index',
    captionIcon: '.editor-icon',
    captionBox: '.editor-container',
    captionEditor: '.editor-container .public-DraftEditor-content',
    captionText: '.caption-text-content',
    captionSave: 'button.TUXButton--primary',
    rowMark: 'data-ttbulk-row',
    rowOperation: '.task-operation-icon',
    picker: '.scheduler-picker-container',
    pickerDialog: '[role="dialog"]',
    monthTitle: '.month-header-wrapper .title-wrapper',
    monthArrow: '.month-header-wrapper span.arrow',
    day: '.days-wrapper span.day',
    timeColumn: '.tiktok-timer-time-scroll-container',
    timeOption: 'span.tiktok-timer-option-text',
    timeActive: 'tiktok-timer-is-active',
    footer: '.picker-footer'
  };

  /* ------------------------------------------------------------------ *
   * helpers
   * ------------------------------------------------------------------ */

  A.onStep = () => {};
  const step = (message, kind = '') => A.onStep(message, kind);

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const norm = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const escapeRe = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
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

  function clickEl(el) {
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
    el.dispatchEvent(new PointerEvent('pointerdown', base));
    el.dispatchEvent(new MouseEvent('mousedown', base));
    el.dispatchEvent(new PointerEvent('pointerup', base));
    el.dispatchEvent(new MouseEvent('mouseup', base));
    if (typeof el.click === 'function') el.click();
    else el.dispatchEvent(new MouseEvent('click', base));
    return true;
  }

  const isDisabled = (el) =>
    Boolean(el) && (el.disabled || el.getAttribute('aria-disabled') === 'true' || /\bdisabled\b/i.test(el.className || ''));

  /* ------------------------------------------------------------------ *
   * page
   * ------------------------------------------------------------------ */

  A.onUploadPage = () => UPLOAD_PATH.test(location.pathname);

  /** Navigation is the panel's job: it flushes state to storage first. */
  A.goToUpload = () => {
    location.href = 'https://www.tiktok.com/tiktokstudio/upload';
  };

  /** TikTok Studio's own error boundary — the table is simply not there. */
  const PAGE_ERROR = /^(something went wrong|please try again|terjadi kesalahan|maaf, terjadi kesalahan)/i;

  A.pageError = () => {
    for (const selector of ['h1', 'h2', 'h3', 'h4', 'p', '[role="alert"]']) {
      for (const el of document.querySelectorAll(selector)) {
        if (!isVisible(el)) continue;
        const text = norm(el.textContent);
        if (!text || text.length > 80) continue;
        if (PAGE_ERROR.test(text)) return text;
      }
    }
    return null;
  };

  function findFileInput() {
    const inputs = [...document.querySelectorAll('input[type="file"]')];
    const video = inputs.filter((el) => /video|mp4|quicktime/i.test(el.accept || ''));
    // Every row also carries a hidden “Replace file” input, so the batch input
    // is the one that is not inside a <tr>.
    return (
      video.find((el) => el.multiple && !el.closest(SEL.row)) ||
      video.find((el) => !el.closest(SEL.row)) ||
      video.find((el) => el.multiple) ||
      video[0] ||
      null
    );
  }

  /** @returns {Promise<boolean>} false when the panel should reload / navigate. */
  A.prepare = async () => {
    if (A.pageError()) {
      step('TikTok Studio is showing an error page — reloading the upload form.', 'warn');
      return false;
    }
    if (!A.onUploadPage()) return false;

    const input = await waitFor(() => (A.pageError() ? null : findFileInput()), {
      timeout: 30000,
      interval: 300,
      label: 'the video upload input'
    }).catch(() => null);

    if (!input) {
      const broken = A.pageError();
      if (broken) {
        step(`TikTok Studio is showing “${broken}” — reloading the upload form.`, 'warn');
        return false;
      }
      throw new Error('The bulk publish table never appeared — no file input on the page. Press Diagnose and send the JSON.');
    }
    return true;
  };

  /* ------------------------------------------------------------------ *
   * the table
   * ------------------------------------------------------------------ */

  const rows = () => [...document.querySelectorAll(SEL.row)];

  A.rowCount = () => rows().length;

  /** The caption cell shows the text when the editor is closed. */
  function shownCaption(row) {
    const node = row && row.querySelector(SEL.captionText);
    return node ? norm(node.textContent) : '';
  }

  function captionBoxOpen(row) {
    const box = row && row.querySelector(SEL.captionBox);
    return Boolean(box) && isVisible(box) && box.getBoundingClientRect().height > 4;
  }

  function editorText(row) {
    if (!row) return '';
    const editor = row.querySelector(SEL.captionEditor);
    if (editor && captionBoxOpen(row)) return norm(editor.innerText || editor.textContent);
    return shownCaption(row);
  }

  /** The "Scheduled" cell: "Post now" until a date is set, then "11/18/2026 06:15". */
  function scheduledButton(row) {
    if (!row) return null;
    return (
      [...row.querySelectorAll('button')].find((el) => /^(post now|\d{1,2}\/\d{1,2}\/\d{4})/i.test(norm(el.textContent))) || null
    );
  }

  A.rowScheduled = (index) => {
    const row = rows()[index];
    const button = scheduledButton(row);
    return button ? norm(button.textContent) : '';
  };

  A.rowCaptions = () => rows().map((row) => editorText(row));

  /**
   * After a batch is attached TikTok pre-fills every caption with the file
   * name, which is exactly the key needed to match a row to a CSV line —
   * before any caption is overwritten.
   */
  const stem = (value) =>
    norm(value)
      .replace(/^["']|["']$/g, '')
      .replace(/\s*\(\d+\)\s*$/, '')
      .replace(/\.(mp4|mov|m4v|webm|avi)$/i, '')
      .trim()
      .toLowerCase();

  A.rowStems = () => rows().map((row) => stem(shownCaption(row)));

  /**
   * Which row belongs to this file name.
   *
   * The caption TikTok seeds with the file name is the only file identity the
   * row carries, and it disappears the moment the caption is overwritten. So
   * the first time a row is resolved it is stamped with the file stem, and
   * every later lookup uses that stamp. Rows are re-read from the live table
   * each time, because TikTok re-renders and reorders them while uploading.
   */
  A.findRowIndex = (filename) => {
    const want = stem(filename);
    if (!want) return -1;
    const list = rows();
    const marked = list.findIndex((row) => row.getAttribute(SEL.rowMark) === want);
    if (marked >= 0) return marked;

    const stems = list.map((row) => stem(shownCaption(row)));
    const exact = stems.findIndex((value) => value === want);
    const found = exact >= 0 ? exact : stems.findIndex((value) => value && (value.startsWith(want) || want.startsWith(value)));
    if (found >= 0) list[found].setAttribute(SEL.rowMark, want);
    return found;
  };

  const findPicker = () => {
    const box = document.querySelector(SEL.picker);
    if (box) {
      const dialog = box.closest(SEL.pickerDialog);
      return dialog && isVisible(dialog) ? dialog : box;
    }
    return [...document.querySelectorAll(SEL.pickerDialog)].find((el) => isVisible(el) && el.querySelector(SEL.day)) || null;
  };

  function findPostAllButton() {
    const candidates = [...document.querySelectorAll('button')].filter((el) => /^post( \(\d+\))?$/i.test(norm(el.textContent)));
    return candidates[candidates.length - 1] || null;
  }

  /* ------------------------------------------------------------------ *
   * attach the batch
   * ------------------------------------------------------------------ */

  /**
   * Files go in small, spaced batches: the first two together (a single file
   * opens the normal post editor instead of the table), then one by one, each
   * waiting for its row to mount and start uploading. Two files landing within
   * a second or two of each other is what takes the page down: TikTok goes to
   * “Something went wrong” and every row disappears. Paced like this the rows
   * accumulate normally, and one “Post (N)” still publishes the whole table.
   */
  const ROW_APPEAR_TIMEOUT = 90000;
  const SETTLE_MIN_MS = 3000;
  const SETTLE_MAX_MS = 20000;

  const crashError = (broken) => {
    const error = new Error(`TikTok Studio crashed while taking the videos (“${broken}”).`);
    error.reload = true;
    return error;
  };

  const isBusyRow = (row) => /\b\d{1,3}%/.test(norm(row && row.textContent));

  /** Let TikTok mount the row and register the upload before the next file. */
  async function settleLastRow() {
    const started = Date.now();
    while (Date.now() - started < SETTLE_MAX_MS) {
      const broken = A.pageError();
      if (broken) throw crashError(broken);
      if (Date.now() - started >= SETTLE_MIN_MS && isBusyRow(rows()[rows().length - 1])) return;
      await sleep(250);
    }
  }

  /** The table opens on two files; after that each file is appended alone. */
  function planBatches(list) {
    if (list.length <= 2) return [list];
    return [list.slice(0, 2), ...list.slice(2).map((file) => [file])];
  }

  A.attachFiles = async (files) => {
    const list = [...files];
    if (!list.length) throw new Error('There is no video to attach.');
    if (list.length === 1 && !rows().length) {
      throw new Error(
        'TikTok only opens the bulk table for two or more videos — one file goes to the normal post editor. Add another row to the queue.'
      );
    }
    if (!findFileInput()) throw new Error('The video upload input disappeared. Reload the page and press Start again.');

    const before = rows().length;
    const megabytes = list.reduce((sum, file) => sum + (file.size || 0), 0) / 1048576;
    const batches = planBatches(list);
    step(`Handing ${list.length} video(s) to TikTok in ${batches.length} step(s) — ${megabytes.toFixed(0)} MB`, 'ok');

    for (let index = 0; index < batches.length; index++) {
      const batch = batches[index];
      const input = findFileInput();
      if (!input) throw new Error('The video upload input disappeared mid-batch. Reload the page and press Start again.');

      const target = rows().length + batch.length;
      const transfer = new DataTransfer();
      for (const file of batch) transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      const deadline = Date.now() + ROW_APPEAR_TIMEOUT;
      while (Date.now() < deadline && rows().length < target) {
        const broken = A.pageError();
        if (broken) throw crashError(broken);
        await sleep(300);
      }

      if (rows().length < target) {
        const broken = A.pageError();
        if (broken) throw crashError(broken);
        throw new Error(
          `TikTok made ${rows().length - before} of ${list.length} row(s) — it stopped accepting “${batch[0].name}”.`
        );
      }

      await settleLastRow();
      step(`${index + 1}/${batches.length} step(s) — ${rows().length} row(s) in the table`, '');
    }

    const added = rows().length - before;

    // TikTok pre-fills each caption with the file name; waiting for it lets the
    // panel match rows to CSV lines instead of trusting the order.
    await waitFor(() => rows().every((row) => shownCaption(row)), {
      timeout: 20000,
      interval: 300,
      label: 'the row captions to be seeded with the file names'
    }).catch(() => null);

    step(`${rows().length} row(s) ready.`, 'ok');
    return added;
  };

  /* ------------------------------------------------------------------ *
   * caption
   * ------------------------------------------------------------------ */

  /**
   * Draft.js only accepts text the way a person puts it there.
   *
   * Measured on the live table: `execCommand('insertText')` with newlines tears
   * Draft's state apart and the whole table dies with “Something went wrong”.
   * Clearing the content with `execCommand('delete')` is no better — it leaves
   * Draft with zero blocks and the next paste crashes it too.
   *
   * What does work is what a human produces: put the caret at the end, press
   * Backspace until the seeded file name is gone, then paste the caption in one
   * go. Draft splits the pasted lines into proper blocks and the row keeps it.
   */
  function clearEditor(editor) {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const existing = String(editor.textContent || '').length;
    for (let i = 0; i < existing + 1; i++) {
      editor.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Backspace',
          code: 'Backspace',
          keyCode: 8,
          which: 8,
          bubbles: true,
          cancelable: true
        })
      );
    }
  }

  function writeIntoEditor(editor, text) {
    editor.focus();
    clearEditor(editor);

    const transfer = new DataTransfer();
    transfer.setData('text/plain', String(text));
    editor.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
    );
  }

  /** The row for this file, re-read from the live table every time. */
  const rowMaybe = (index, filename) => {
    const live = filename ? A.findRowIndex(filename) : -1;
    return rows()[live >= 0 ? live : index] || null;
  };

  const rowNow = (index, filename) => {
    const row = rowMaybe(index, filename);
    if (!row) {
      throw new Error(
        `Row ${index + 1}${filename ? ` (${filename})` : ''} is no longer in the table (${rows().length} row(s) left). ` +
          'TikTok may have crashed — reload the page and press Start again.'
      );
    }
    return row;
  };

  A.fillCaptionAt = async (index, caption, filename) => {
    const text = String(caption || '');
    if (!text) throw new Error(`Row ${index + 1} has an empty caption — skipping would post the file name.`);
    rowNow(index, filename);

    if (!captionBoxOpen(rowMaybe(index, filename))) {
      const icon = rowNow(index, filename).querySelector(SEL.captionIcon);
      if (!icon) throw new Error(`Row ${index + 1} has no caption edit icon. Press Diagnose and send the JSON.`);
      clickEl(icon);
      await waitFor(() => captionBoxOpen(rowMaybe(index, filename)), {
        timeout: 8000,
        interval: 150,
        label: `the caption editor of row ${index + 1}`
      });
    }

    const editor = rowNow(index, filename).querySelector(SEL.captionEditor);
    if (!editor) throw new Error(`Row ${index + 1} opened no caption editor.`);

    writeIntoEditor(editor, text);
    await waitFor(() => editorText(rowMaybe(index, filename)) === norm(text), {
      timeout: 8000,
      interval: 150,
      label: `row ${index + 1}'s caption to take the text`
    });

    // The row's own primary button (arrow icon) commits and closes the editor.
    const row = rowNow(index, filename);
    const save = row.querySelector(`${SEL.captionBox} ${SEL.captionSave}`) || row.querySelector(SEL.captionSave);
    if (!save) throw new Error(`Row ${index + 1} has no caption save button. Press Diagnose and send the JSON.`);
    clickEl(save);

    await waitFor(() => !captionBoxOpen(rowMaybe(index, filename)), {
      timeout: 15000,
      interval: 200,
      label: `row ${index + 1}'s caption editor to close`
    });

    // The cell is re-rendered from TikTok's own state a few seconds after the
    // commit, so give it a moment before calling the caption wrong.
    await waitFor(() => norm(shownCaption(rowMaybe(index, filename))) === norm(text), {
      timeout: 20000,
      interval: 400,
      label: `row ${index + 1}'s caption to show in the cell`
    }).catch(() => null);

    const kept = shownCaption(rowNow(index, filename));
    if (norm(kept) !== norm(text)) {
      throw new Error(`Row ${index + 1} kept a different caption than the CSV (${kept.length} vs ${text.length} chars).`);
    }
    return text.length;
  };

  /* ------------------------------------------------------------------ *
   * schedule — the calendar and the two time columns
   * ------------------------------------------------------------------ */

  function parseMonthYear(text) {
    const lower = norm(text).toLowerCase();
    const month = MONTHS.findIndex((name) => lower.includes(name));
    const year = Number((lower.match(/(\d{4})/) || [])[1]);
    if (month < 0 || !year) return null;
    return { month, year };
  }

  const parseISODate = (value) => {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  /**
   * The grid is a flat list of 35 cells, so the cell for a day is offset by the
   * weekday of the 1st. That beats matching the printed number, which repeats
   * for the previous and next month's filler days.
   */
  function pickDayCell(popover, target) {
    const cells = [...popover.querySelectorAll(SEL.day)];
    if (!cells.length) return { error: 'the calendar has no day cells' };

    const head = popover.querySelector(SEL.monthTitle) || popover.querySelector('.month-header-wrapper');
    const current = parseMonthYear(head ? head.textContent : '');
    if (!current) return { error: 'the calendar header could not be read' };

    const offset = new Date(current.year, current.month, 1).getDay();
    const cell = cells[offset + target.getDate() - 1];
    const label = String(target.getDate());

    if (cell && norm(cell.textContent) === label) {
      return cell.classList.contains('valid') ? { cell } : { blocked: true };
    }

    // Fallback for a grid that does not start on the 1st's weekday.
    const matches = cells.filter((el) => norm(el.textContent) === label && el.classList.contains('valid'));
    if (!matches.length) return { blocked: true };
    return { cell: target.getDate() > 15 ? matches[matches.length - 1] : matches[0] };
  }

  const timeColumns = (popover) => [...popover.querySelectorAll(SEL.timeColumn)];

  const activeTime = (column) => {
    const option = column && [...column.querySelectorAll(SEL.timeOption)].find((el) => el.classList.contains(SEL.timeActive));
    return option ? norm(option.textContent) : '';
  };

  function pickTimeOption(column, wanted, nearest) {
    const options = [...column.querySelectorAll(SEL.timeOption)];
    let target = options.find((el) => norm(el.textContent) === wanted);
    if (!target && Number.isFinite(nearest)) {
      let best = null;
      let bestDelta = Infinity;
      for (const option of options) {
        const value = Number(norm(option.textContent));
        if (!Number.isFinite(value)) continue;
        const delta = Math.abs(value - nearest);
        if (delta < bestDelta) {
          best = option;
          bestDelta = delta;
        }
      }
      target = best;
    }
    if (!target) return '';
    clickEl(target);
    return norm(target.textContent);
  }

  function scheduleMatches(shown, target, hour, minute) {
    const match = norm(shown).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
    if (!match) return false;
    return (
      Number(match[1]) === target.getMonth() + 1 &&
      Number(match[2]) === target.getDate() &&
      Number(match[3]) === target.getFullYear() &&
      Number(match[4]) === Number(hour) &&
      Number(match[5]) === Number(minute)
    );
  }

  A.setScheduleAt = async (index, dateISO, timeHHMM, filename) => {
    const target = parseISODate(dateISO);
    if (!target) throw new Error(`“${dateISO}” is not a valid date.`);

    const [hourRaw, minuteRaw] = String(timeHHMM || '').split(':');
    const hour = Math.min(23, Math.max(0, Number(hourRaw)));
    const minute = Math.min(55, Math.max(0, Number(minuteRaw)));
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) throw new Error(`“${timeHHMM}” is not a valid time.`);

    const row = rowNow(index, filename);
    if (!row) throw new Error(`Row ${index + 1} is no longer in the table.`);

    const trigger = scheduledButton(row);
    if (!trigger) throw new Error(`Row ${index + 1} has no schedule cell. Press Diagnose and send the JSON.`);
    clickEl(trigger);

    const popover = await waitFor(findPicker, { timeout: 8000, interval: 150, label: `row ${index + 1}'s schedule picker` });

    for (let hop = 0; hop < 14; hop++) {
      const head = popover.querySelector(SEL.monthTitle) || popover.querySelector('.month-header-wrapper');
      const current = parseMonthYear(head ? head.textContent : '');
      if (!current) throw new Error('The calendar header could not be read.');
      const delta = (target.getFullYear() - current.year) * 12 + (target.getMonth() - current.month);
      if (!delta) break;
      const arrows = popover.querySelectorAll(SEL.monthArrow);
      const arrow = delta > 0 ? arrows[arrows.length - 1] : arrows[0];
      if (!arrow) throw new Error('The calendar month arrows are missing.');
      clickEl(arrow);
      await sleep(320);
    }

    const picked = pickDayCell(popover, target);
    if (picked.error) throw new Error(`The calendar shows no days (${picked.error}).`);
    if (picked.blocked) {
      throw new Error(
        `TikTok's calendar will not accept ${dateISO} — it only offers about 30 days ahead. Schedule this clip in a later batch.`
      );
    }
    clickEl(picked.cell);
    await sleep(280);

    const [hourColumn, minuteColumn] = timeColumns(popover);
    if (!hourColumn || !minuteColumn) throw new Error('The time columns are missing from the schedule popover.');

    const hourText = pickTimeOption(hourColumn, String(hour).padStart(2, '0'), hour);
    if (!hourText) throw new Error('The hour column is empty.');
    const roundedMinute = Math.round(minute / 5) * 5 === 60 ? 0 : Math.round(minute / 5) * 5;
    const minuteText = pickTimeOption(minuteColumn, String(roundedMinute).padStart(2, '0'), roundedMinute);
    if (!minuteText) throw new Error('The minute column is empty.');

    await waitFor(() => activeTime(hourColumn) === hourText && activeTime(minuteColumn) === minuteText, {
      timeout: 5000,
      interval: 150,
      label: 'the picker to settle on the requested time'
    });

    const confirm = [...popover.querySelectorAll(`${SEL.footer} button`)].find((el) => /^scheduled$/i.test(norm(el.textContent)));
    if (!confirm) throw new Error('The “Scheduled” button is missing from the schedule popover.');
    clickEl(confirm);

    await waitFor(() => !findPicker(), { timeout: 8000, interval: 150, label: 'the schedule popover to close' }).catch(() => null);

    const shownButton = scheduledButton(rowNow(index, filename));
    const shown = shownButton ? norm(shownButton.textContent) : '';
    if (!scheduleMatches(shown, target, hourText, minuteText)) {
      throw new Error(
        `Row ${index + 1} shows “${shown || 'no date'}” instead of the requested ${dateISO} ${hourText}:${minuteText} — nothing was posted.`
      );
    }
    return shown;
  };

  /* ------------------------------------------------------------------ *
   * submit the whole table
   * ------------------------------------------------------------------ */

  A.waitForTableReady = async (timeoutMs) => {
    return waitFor(
      () => {
        const button = findPostAllButton();
        if (!button || isDisabled(button)) return null;
        // Rows still uploading print a percentage; the button lets you click too early.
        const busy = rows().some((row) => /\b\d{1,3}%/.test(norm(row.textContent)));
        return busy ? null : button;
      },
      { timeout: timeoutMs, interval: 1000, label: 'TikTok to finish uploading every row' }
    );
  };

  A.submitAll = async () => {
    const button = findPostAllButton();
    if (!button) throw new Error('The “Post” button under the table is missing.');
    if (isDisabled(button)) throw new Error('The “Post” button is still disabled.');
    const label = norm(button.textContent);
    clickEl(button);
    step(`Clicked “${label}”`, 'ok');
    return label;
  };

  A.confirmBatch = async (timeoutMs = 180000) => {
    const started = Date.now();
    const before = A.rowCount();
    while (Date.now() - started < timeoutMs) {
      if (!A.onUploadPage()) return true;
      if (A.rowCount() === 0 && before > 0) return true;
      const toast = [...document.querySelectorAll('div, span, p')].find((el) => {
        if (!isVisible(el)) return false;
        const text = norm(el.textContent);
        return text.length > 0 && text.length < 120 && /(posted|scheduled|being uploaded|uploaded successfully|publishing)/i.test(text);
      });
      if (toast) return true;
      await sleep(1200);
    }
    return false;
  };

  /* ------------------------------------------------------------------ *
   * clearing the table
   * ------------------------------------------------------------------ */

  A.clearTable = async () => {
    let removed = 0;
    for (let guard = 0; guard < 40; guard++) {
      const list = rows();
      if (!list.length) return removed;

      const row = list[list.length - 1];
      const operations = row.querySelectorAll(SEL.rowOperation);
      if (operations.length < 2) throw new Error('The delete icon is missing from the last row.');
      clickEl(operations[1]);

      const confirm = await waitFor(
        () => {
          const dialog = [...document.querySelectorAll(SEL.pickerDialog)].find(
            (el) => isVisible(el) && /confirm to remove/i.test(norm(el.textContent))
          );
          if (!dialog) return null;
          return [...dialog.querySelectorAll('button')].find((el) => /^confirm$/i.test(norm(el.textContent))) || null;
        },
        { timeout: 6000, interval: 150, label: 'the remove confirmation' }
      );
      clickEl(confirm);

      await waitFor(() => rows().length < list.length, { timeout: 10000, interval: 200, label: 'the row to disappear' });
      removed++;
    }
    throw new Error(`Could not clear the table (${removed} row(s) left).`);
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

  A.diagnose = () => {
    const list = rows();
    const post = findPostAllButton();
    return {
      when: new Date().toISOString(),
      panel: globalThis.__TTBULK_VERSION__ || 'unknown',
      url: location.href,
      onUploadPage: A.onUploadPage(),
      pageError: A.pageError(),
      fileInputs: [...document.querySelectorAll('input[type="file"]')].map((el) => ({
        accept: el.accept || '',
        multiple: Boolean(el.multiple),
        hidden: !isVisible(el)
      })),
      rows: list.length,
      postButton: post ? { text: norm(post.textContent), disabled: isDisabled(post) } : null,
      table: list.slice(0, 10).map((row, index) => ({
        index: index + 1,
        caption: shownCaption(row).slice(0, 80),
        captionChars: shownCaption(row).length,
        editorOpen: captionBoxOpen(row),
        scheduled: A.rowScheduled(index),
        percentages: (norm(row.textContent).match(/\b\d{1,3}%/g) || []).join(','),
        operations: row.querySelectorAll(SEL.rowOperation).length
      })),
      picker: (() => {
        const popover = findPicker();
        if (!popover) return null;
        const head = popover.querySelector(SEL.monthTitle) || popover.querySelector('.month-header-wrapper');
        const columns = timeColumns(popover);
        return {
          month: head ? norm(head.textContent) : null,
          days: popover.querySelectorAll(SEL.day).length,
          validDays: [...popover.querySelectorAll(`${SEL.day}.valid`)].map((el) => norm(el.textContent)),
          arrows: popover.querySelectorAll(SEL.monthArrow).length,
          hours: columns[0] ? columns[0].querySelectorAll(SEL.timeOption).length : 0,
          minutes: columns[1] ? columns[1].querySelectorAll(SEL.timeOption).length : 0,
          footer: [...popover.querySelectorAll(`${SEL.footer} button`)].map((el) => norm(el.textContent))
        };
      })(),
      captionIcon: describe(list[0] && list[0].querySelector(SEL.captionIcon)),
      captionSave: describe(list[0] && list[0].querySelector(SEL.captionSave)),
      scheduleCell: describe(list[0] && scheduledButton(list[0]))
    };
  };

  Object.defineProperty(global, '__TTBULK_AUTOMATION__', { value: A, enumerable: false });
})(globalThis);
