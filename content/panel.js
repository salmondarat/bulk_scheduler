/*
 * The panel: queue UI + run loop, rendered inside the site tab it automates.
 *
 * There is no separate extension page and no cross-tab messaging. The panel
 * talks to automation.js (TikTok) or fb-automation.js (Facebook) in the same
 * document, so a job cannot hang waiting for another tab to answer.
 */
(function (global) {
  'use strict';

  /**
   * One panel, two sites. TikTok keeps the bulk uploader it always was;
   * on business.facebook.com the same panel becomes a scheduler that drives
   * the bulk upload composer through the proven routine and never publishes.
   */
  const SITE = /(^|\.)business\.facebook\.com$/i.test(location.hostname) ? 'facebook' : 'tiktok';
  const FB = SITE === 'facebook';
  const A = FB ? global.__FBBULK_AUTOMATION__ : global.__TTBULK_AUTOMATION__;
  const Store = global.__TTBULK_STORE__;
  const CSV = global.__TTBULK_CSV__;

  const STORAGE_KEY = FB ? 'fbbulk.v1' : 'ttbulk.v2';
  const PANEL_KEY = FB ? 'fbbulk.panelOpen' : 'ttbulk.panelOpen';
  const SAVE_DEBOUNCE_MS = 250;
  const LOG_LIMIT = 250;
  const VERSION = '1.0.0';

  const DEFAULT_SETTINGS = { reviewMode: true, keepFiles: false, uploadTimeoutMin: 10, pauseSeconds: 20 };

  const STATUS_LABEL = {
    queued: 'Queued',
    needs_file: 'No video',
    uploading: 'Working',
    review: 'Review',
    done: 'Done',
    error: 'Error',
    skipped: 'Skipped',
    needs_review: 'Check'
  };

  const state = {
    jobs: [],
    settings: { ...DEFAULT_SETTINGS },
    run: { active: false, jobId: null, stop: false }
  };

  const cards = new Map();
  const memFiles = new Map();
  let refs = null;
  let shadow = null;
  let mounted = false;
  let saveTimer = null;
  let reviewResolve = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Missing nodes must never take the panel down; a UI update is not worth a crash. */
  const setHidden = (node, value) => {
    if (node) node.hidden = Boolean(value);
  };

  /** Clicking anywhere in the field opens the native picker, not just the small icon. */
  function clickToPick(input) {
    input.addEventListener('click', (event) => {
      if (event.target !== input) return;
      try {
        input.showPicker();
      } catch {
        /* older Chrome, or the picker is already open */
      }
    });
  }

  const h = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  };

  /* ------------------------------------------------------------------ *
   * persistence
   * ------------------------------------------------------------------ */

  function snapshot() {
    return {
      jobs: state.jobs,
      settings: state.settings,
      run: { active: state.run.active, jobId: state.run.jobId }
    };
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      chrome.storage.local.set({ [STORAGE_KEY]: snapshot() }).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  }

  async function saveNow() {
    clearTimeout(saveTimer);
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: snapshot() });
    } catch {
      /* ignore */
    }
  }

  async function load() {
    let stored = null;
    try {
      stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    } catch {
      stored = null;
    }
    if (stored && Array.isArray(stored.jobs)) {
      state.jobs = stored.jobs.map((job) => ({ ...job }));
      state.settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
      state.run.active = Boolean(stored.run && stored.run.active);
      state.run.jobId = (stored.run && stored.run.jobId) || null;
    }
    await reconcileFiles();
  }

  async function reconcileFiles() {
    if (FB) return; // the Facebook scheduler never handles video files
    let keys;
    try {
      keys = new Set(await Store.keys());
    } catch {
      keys = new Set();
    }
    for (const job of state.jobs) {
      const exists = keys.has(job.id);
      if (job.hasFile && !exists) {
        job.hasFile = false;
        job.size = 0;
        if (!['done', 'error', 'skipped', 'needs_review'].includes(job.status)) job.status = 'needs_file';
      } else if (!job.hasFile && exists) {
        job.hasFile = true;
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * log
   * ------------------------------------------------------------------ */

  function log(message, kind = '') {
    if (!refs) return;
    const time = new Date().toLocaleTimeString(undefined, { hour12: false });
    refs.log.appendChild(h('div', {}, h('span', { class: 't', text: `${time} ` }), h('span', { class: kind, text: message })));
    while (refs.log.childElementCount > LOG_LIMIT) refs.log.firstElementChild.remove();
    refs.log.scrollTop = refs.log.scrollHeight;
  }

  function setSub(text) {
    if (refs) refs.sub.textContent = text;
  }

  function setDot(kind) {
    if (refs) refs.dot.className = `dot ${kind}`;
  }

  /* ------------------------------------------------------------------ *
   * rendering
   * ------------------------------------------------------------------ */

  function formatSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / 1048576).toFixed(1)} MB`;
  }

  function paint(job) {
    const card = cards.get(job.id);
    if (!card) return;
    const status = STATUS_LABEL[job.status] ? job.status : 'queued';
    card.badge.className = `badge s-${status}`;
    card.badge.textContent = STATUS_LABEL[status];
    card.badge.title = job.message || '';

    if (FB) {
      // Facebook rows have no video file in the panel; the meta line carries
      // the schedule and the last message instead.
      card.meta.className = 'meta';
      card.meta.textContent = job.message || (job.date && job.time ? `${job.date} ${job.time}` : '');
      setHidden(card.review, true);
      setHidden(card.retry, !['error', 'needs_review', 'skipped'].includes(job.status));
      return;
    }

    if (job.hasFile) {
      card.meta.className = 'meta';
      card.meta.textContent = `${formatSize(job.size)} stored`;
    } else if (job.status === 'done') {
      card.meta.className = 'meta';
      card.meta.textContent = 'local copy deleted';
    } else {
      card.meta.className = 'meta missing';
      card.meta.textContent = 'no video file';
    }
    setHidden(card.review, job.status !== 'review');
    setHidden(card.retry, !(job.hasFile && ['error', 'needs_review', 'skipped'].includes(job.status)));
  }

  function setStatus(job, status, message = '') {
    job.status = status;
    job.message = message;
    paint(job);
    if (status === 'review') {
      const card = cards.get(job.id);
      if (card) card.root.scrollIntoView({ block: 'nearest' });
    }
    syncControls();
    save();
  }

  function buildCard(job) {
    const badge = h('span', { class: 'badge' });
    const name = h('span', { class: 'name', text: job.filename || 'untitled', title: job.filename || '' });
    const retry = h('button', {
      class: 'retry',
      type: 'button',
      text: 'Retry',
      hidden: true,
      title: 'Put this row back in the queue',
      onclick: () => retryJob(job)
    });
    const remove = h('button', {
      class: 'x',
      type: 'button',
      'aria-label': `Remove ${job.filename || 'row'}`,
      text: '×',
      onclick: () => removeJob(job)
    });

    const meta = h('div', { class: 'meta' });

    const caption = h('textarea', { class: 'caption', rows: '2', placeholder: 'Caption / hashtags', spellcheck: 'false' });
    caption.value = job.caption || '';
    caption.addEventListener('input', () => {
      job.caption = caption.value;
      save();
    });

    const date = h('input', { class: 'when-date', type: 'date', 'aria-label': 'Publish date' });
    date.value = job.date || '';
    date.addEventListener('change', () => {
      job.date = date.value;
      save();
      syncControls();
    });

    const time = h('input', { class: 'when-time', type: 'time', step: '60', 'aria-label': 'Publish time' });
    time.value = job.time || '';
    time.addEventListener('change', () => {
      job.time = time.value;
      save();
      syncControls();
    });

    clickToPick(date);
    clickToPick(time);

    const postNow = h('button', {
      class: 'primary',
      type: 'button',
      text: 'Post now',
      onclick: () => resolveReview('post')
    });
    const skip = h('button', { type: 'button', text: 'Skip', onclick: () => resolveReview('skip') });
    const review = h('div', { class: 'review', hidden: true }, postNow, skip);

    const root = h('article', { class: 'card', 'data-id': job.id },
      h('div', { class: 'card-head' }, badge, name, retry, remove),
      meta,
      caption,
      h('div', { class: 'when' }, date, time),
      review
    );

    return { root, badge, meta, caption, date, time, review, retry };
  }

  function renderList() {
    if (!refs) return;
    cards.clear();
    refs.list.textContent = '';

    if (!state.jobs.length) {
      refs.list.append(
        h('div', { class: 'empty' },
          h('p', { text: FB ? 'Belum ada baris antre.' : 'Nothing queued yet.' }),
          h('p', {
            class: 'dim',
            text: FB
              ? 'Import CSV (filename, caption, date, time). Caption dipakai untuk mencocokkan baris di composer; tanggal/jam wajib.'
              : 'Import a CSV, or press “Add videos” (or drop the files here) and fill captions and times right here.'
          })
        )
      );
    } else {
      for (const job of state.jobs) {
        const card = buildCard(job);
        cards.set(job.id, card);
        refs.list.append(card.root);
        paint(job);
      }
    }
    syncControls();
  }

  function syncControls() {
    if (!refs) return;
    const runnable = state.jobs.filter((job) => job.status === 'queued' && (FB || job.hasFile)).length;
    refs.start.disabled = state.run.active || runnable === 0;
    refs.start.textContent = state.run.active ? 'Running…' : `Start${runnable ? ` (${runnable})` : ''}`;
    setHidden(refs.stop, !state.run.active);
    refs.count.textContent = state.jobs.length ? `${runnable} ready` : '';
    refs.review.checked = Boolean(state.settings.reviewMode);
    refs.keep.checked = Boolean(state.settings.keepFiles);
    refs.import.disabled = state.run.active;
    refs.addVideos.disabled = state.run.active;
    refs.applyAll.disabled = state.run.active || !state.jobs.length;
    if (refs.clearQueue) refs.clearQueue.disabled = state.run.active || !state.jobs.length;
    if (refs.clearTable) refs.clearTable.disabled = state.run.active;
    if (!state.run.active) {
      setDot('idle');
      setSub(state.jobs.length ? `${state.jobs.length} row(s)` : 'Ready');
    }
  }

  /* ------------------------------------------------------------------ *
   * jobs
   * ------------------------------------------------------------------ */

  /** "C:\\Users\\me\\Downloads\\clip.mp4" -> "clip.mp4"; browsers never see a path. */
  const baseFile = (value) =>
    String(value || '')
      .replace(/^["']|["']$/g, '')
      .split(/[\\/]/)
      .pop()
      .trim();

  const nameKey = (value) => baseFile(value).toLowerCase();

  const stemKey = (value) => nameKey(value).replace(/\.[^.]+$/, '').replace(/\s*\(\d+\)$/, '');

  function findJobByFilename(filename) {
    const key = nameKey(filename);
    return (
      state.jobs.find((job) => job.filename && nameKey(job.filename) === key) ||
      state.jobs.find((job) => job.filename && stemKey(job.filename) === stemKey(filename)) ||
      null
    );
  }

  function jobForFile(file) {
    const key = nameKey(file.name);
    const stem = stemKey(file.name);
    return (
      state.jobs.find((job) => !job.hasFile && job.filename && nameKey(job.filename) === key) ||
      state.jobs.find((job) => !job.hasFile && job.filename && stemKey(job.filename) === stem) ||
      state.jobs.find((job) => !job.hasFile && !job.filename) ||
      null
    );
  }

  function newJob(partial = {}) {
    return {
      id: crypto.randomUUID(),
      filename: '',
      caption: '',
      date: '',
      time: '',
      hasFile: false,
      size: 0,
      status: 'needs_file',
      message: '',
      reloaded: false,
      ...partial
    };
  }

  async function importCsv(text) {
    const { entries, skipped } = CSV.readRows(text);
    let created = 0;
    let updated = 0;
    let incomplete = 0;
    let trimmed = 0;
    const seen = new Set();

    for (const entry of entries) {
      if (Boolean(entry.date) !== Boolean(entry.time)) incomplete++;
      const filename = baseFile(entry.filename);
      if (filename !== entry.filename) trimmed++;
      if (filename) seen.add(filename.toLowerCase());
      const existing = filename ? findJobByFilename(filename) : null;
      if (existing) {
        if (entry.caption) existing.caption = entry.caption;
        if (entry.date) existing.date = entry.date;
        if (entry.time) existing.time = entry.time;
        // Re-importing a CSV is the natural "try again": a failed row that still
        // has its video goes back into the queue instead of staying stuck.
        if (existing.hasFile && existing.status !== 'done') {
          existing.status = 'queued';
          existing.message = '';
          existing.reloaded = false;
        }
        updated++;
        continue;
      }
      state.jobs.push(
        newJob({
          filename,
          caption: entry.caption,
          date: entry.date,
          time: entry.time,
          status: FB ? 'queued' : 'needs_file'
        })
      );
      created++;
    }

    // Rows left over from a failed run that this CSV does not mention are
    // dropped here: otherwise the broken attempt rides along into the new batch.
    const stale = state.jobs.filter(
      (job) => ['error', 'needs_review', 'skipped'].includes(job.status) && !seen.has(String(job.filename || '').toLowerCase())
    );
    if (stale.length) {
      state.jobs = state.jobs.filter((job) => !stale.includes(job));
      for (const job of stale) {
        memFiles.delete(job.id);
        try {
          await Store.del(job.id);
        } catch {
          /* ignore */
        }
      }
    }

    renderList();
    save();
    log(`CSV imported — ${created} new, ${updated} updated${skipped ? `, ${skipped} skipped` : ''}.`, 'ok');
    if (stale.length) log(`${stale.length} failed row(s) from the previous CSV were removed.`, 'warn');
    if (trimmed) log(`${trimmed} filename(s) had a folder path — using just the file name.`, 'warn');
    if (incomplete) log(`${incomplete} row(s) have only half a schedule and will post immediately.`, 'warn');

    const waiting = state.jobs.filter((job) => !job.hasFile && job.status !== 'done').length;
    if (!FB && waiting) {
      log(`${waiting} row(s) still need a video. Press “Add videos” (or drop the files on this panel) — a browser cannot open a path from a CSV.`, 'warn');
    }
  }

  async function addVideoFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;

    let attached = 0;
    let created = 0;

    for (const file of files) {
      let job = jobForFile(file);
      if (!job) {
        job = newJob({ filename: file.name });
        state.jobs.push(job);
        created++;
      }
      try {
        await Store.put(job.id, file, { name: file.name, type: file.type });
      } catch (error) {
        log(`Could not store ${file.name}: ${error.message || error}`, 'err');
        continue;
      }
      memFiles.set(job.id, file);
      job.hasFile = true;
      job.size = file.size;
      if (!job.filename) job.filename = file.name;
      if (job.status === 'needs_file' || ['done', 'skipped', 'error', 'needs_review'].includes(job.status)) job.status = 'queued';
      attached++;
    }

    renderList();
    save();
    log(`Added ${attached} video(s)${created ? `, ${created} new row(s)` : ''}.`, 'ok');
  }

  function retryJob(job) {
    if (state.run.active) return;
    if (!job.hasFile) {
      log(`${job.filename} has no video file — press “Add videos” and pick it again.`, 'warn');
      return;
    }
    setStatus(job, 'queued', '');
    job.reloaded = false;
    log(`Re-queued ${job.filename}.`, 'ok');
  }

  async function removeJob(job) {    if (state.run.active) return;
    state.jobs = state.jobs.filter((entry) => entry.id !== job.id);
    memFiles.delete(job.id);
    try {
      await Store.del(job.id);
    } catch {
      /* ignore */
    }
    renderList();
    save();
  }

  async function getFile(job) {
    if (memFiles.has(job.id)) return memFiles.get(job.id);
    const record = await Store.get(job.id);
    if (!record) return null;
    const file = new File([record.blob], record.name || job.filename || 'video.mp4', { type: record.type || 'video/mp4' });
    memFiles.set(job.id, file);
    return file;
  }

  /* ------------------------------------------------------------------ *
   * run loop
   * ------------------------------------------------------------------ */

  function resolveReview(decision) {
    const resolve = reviewResolve;
    reviewResolve = null;
    if (resolve) resolve(decision);
  }

  function askReview(job) {
    return new Promise((resolve) => {
      reviewResolve = resolve;
      const card = cards.get(job.id);
      if (card) {
        setHidden(card.review, false);
        card.root.scrollIntoView({ block: 'nearest' });
      }
      setSub('Waiting for your review');
      setDot('warn');
    });
  }

  /** Flush the queue to storage, then reload the upload page; boot resumes the run. */
  async function navigateAndStop() {
    state.run.active = true;
    state.run.jobId = null;
    await saveNow();
    log('Reloading the upload page to continue…');
    A.goToUpload();
  }

  function batchStem(name) {
    return String(name || '')
      .replace(/\s*\(\d+\)\s*$/, '')
      .replace(/\.(mp4|mov|m4v|webm|avi)$/i, '')
      .trim()
      .toLowerCase();
  }

  /**
   * Rows are appended in attachment order, but TikTok pre-fills every caption
   * with the file name, so the row and its CSV line can be matched on that and
   * the order stops mattering.
   */
  function mapRowsToJobs(batch) {
    const stems = A.rowStems();
    const used = new Set();
    const pairs = [];

    batch.forEach((job, position) => {
      const want = batchStem(job.filename);
      let index = stems.findIndex((stem, i) => !used.has(i) && stem === want);
      if (index < 0) index = !used.has(position) && position < stems.length ? position : stems.findIndex((_, i) => !used.has(i));
      if (index < 0) throw new Error(`TikTok made fewer rows than videos — ${job.filename} has no row.`);
      used.add(index);
      pairs.push({ job, index });
    });

    return pairs;
  }

  function setBatchStatus(batch, status, message) {
    for (const job of batch) setStatus(job, status, message);
  }

  const normLine = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

  /**
   * The Facebook run: schedule every queued CSV line onto its composer row,
   * then stop. Nothing is published here — no code path reaches a Publish
   * button, so the rows stay for human verification after the run.
   */
  async function runFbBatch(batch) {
    state.run.active = true;
    state.run.stop = false;
    state.run.jobId = batch[0].id;
    syncControls();

    setDot('busy');
    setSub('Menyiapkan composer');
    setBatchStatus(batch, 'uploading', 'Menyiapkan halaman');

    let ready;
    try {
      ready = await A.prepare();
    } catch (error) {
      ready = null;
      globalThis.__ttLastError = {
        when: new Date().toISOString(),
        message: String((error && error.message) || error),
        stack: (error && error.stack) || null
      };
    }
    if (!ready) {
      setBatchStatus(batch, 'queued', '');
      state.run.active = false;
      syncControls();
      setDot('err');
      log('Composer tidak siap — pastikan halaman bulk upload composer terbuka dan videonya sudah masuk.', 'err');
      return 'next';
    }

    // Rows beyond the 29-day window (or with half a schedule) never go out;
    // scheduling them would only end in a Facebook rejection mid-run.
    const runnable = [];
    for (const job of batch) {
      if (!job.date || !job.time) {
        setStatus(job, 'skipped', 'Jadwal belum diisi (tanggal/jam kosong)');
        log(`${job.filename || 'Baris'}: lewat — tanggal/jamnya masih kosong.`, 'warn');
        continue;
      }
      const reason = A.windowCheck ? A.windowCheck(job.date, job.time) : null;
      if (reason) {
        setStatus(job, 'skipped', `${job.date} ${job.time}: ${reason}`);
        log(`${job.filename || job.date}: ${reason} — jadwal tidak diisi.`, 'warn');
        continue;
      }
      runnable.push(job);
    }

    if (!runnable.length) {
      state.run.active = false;
      syncControls();
      setSub('Tidak ada baris yang bisa dijadwalkan');
      log('Tidak ada jadwal yang diisi pada ronde ini.', 'warn');
      return 'next';
    }

    setSub(`Menjadwalkan ${runnable.length} baris`);
    const wants = runnable.map((job) => ({ filename: job.filename, caption: job.caption }));
    let pairs;
    try {
      pairs = A.mapRows(wants);
    } catch (error) {
      setBatchStatus(runnable, 'error', String((error && error.message) || error));
      log(`✕ ${(error && error.message) || error}`, 'err');
      setDot('err');
      state.run.active = false;
      syncControls();
      return 'next';
    }

    let completed = 0;
    let failure = null;

    for (let i = 0; i < pairs.length; i++) {
      if (state.run.stop) {
        failure = Object.assign(new Error('Dihentikan sebelum selesai.'), { stopped: true });
        break;
      }
      const job = runnable[i];
      const index = pairs[i].index;
      state.run.jobId = job.id;
      setSub(`${i + 1}/${pairs.length} · ${job.filename || `baris ${index + 1}`}`);
      save();

      try {
        if (job.caption && A.fillDescriptionAt) {
          setStatus(job, 'uploading', 'Memeriksa deskripsi');
          const current = A.rowText(index);
          if (normLine(current) !== normLine(job.caption)) {
            const chars = await A.fillDescriptionAt(index, job.caption);
            log(`Baris ${index + 1} (${job.filename || 'tanpa nama'}) deskripsi → ${chars} karakter${pairs[i].way === 'order' ? ' [cocok urutan]' : ''}`, 'ok');
          }
        }

        setStatus(job, 'uploading', 'Menyetel jadwal');
        const shown = await A.setScheduleAt(index, job.date, job.time);
        log(`✓ Baris ${index + 1} (${job.filename || 'tanpa nama'}) → ${shown}`, 'ok');
        setStatus(job, 'done', `Scheduled · ${job.date} ${job.time}`);
        completed++;
      } catch (error) {
        const message = String((error && error.message) || error);
        setStatus(job, 'error', message);
        log(`✕ Baris ${index + 1} (${job.filename || 'tanpa nama'}): ${message}`, 'err');
        globalThis.__ttLastError = {
          when: new Date().toISOString(),
          message,
          stack: (error && error.stack) || null
        };
        // One failed row should not strand the rest: keep going.
        if (state.run.stop) {
          failure = Object.assign(new Error('Dihentikan di tengah ronde.'), { stopped: true });
          break;
        }
      }
    }

    setSub(`Selesai — ${completed}/${runnable.length} jadwal tersimpan`);
    if (completed) {
      log(`Ronde selesai: ${completed} dari ${runnable.length} jadwal tersimpan. Tidak ada tombol Terbitkan yang disentuh — silakan verifikasi manual.`, 'ok');
    }
    if (runnable.length > completed && !failure) {
      setDot('warn');
    }
    if (!completed && !failure) {
      setDot('err');
    }
    return 'next';
  }

  async function runBatch(batch) {
    state.run.active = true;
    state.run.stop = false;
    state.run.jobId = batch[0].id;
    syncControls();

    const label = batch.length === 1 ? batch[0].filename || 'video' : `${batch.length} videos`;
    setDot('busy');
    setSub(`Preparing · ${label}`);
    setBatchStatus(batch, 'uploading', 'Preparing the page');

    const ready = await A.prepare();
    if (!ready) {
      setBatchStatus(batch, 'queued', '');
      await navigateAndStop();
      return 'navigate';
    }

    const leftover = A.rowCount();
    if (leftover) {
      setSub(`Clearing ${leftover} leftover row(s)`);
      log(`TikTok's table still had ${leftover} row(s) — removing them before this batch.`, 'warn');
      await A.clearTable();
    }

    const files = [];
    for (const job of batch) {
      const file = await getFile(job);
      if (!file) throw new Error(`The video for ${job.filename} is missing from storage. Add it again.`);
      files.push(file);
    }

    setSub(`Uploading ${batch.length} video(s)`);
    await A.attachFiles(files);

    const pairs = mapRowsToJobs(batch);
    for (let i = 0; i < pairs.length; i++) {
      if (state.run.stop) throw Object.assign(new Error('Stopped before publishing.'), { stopped: true });

      const { job } = pairs[i];
      // Re-resolve the row every time: TikTok re-renders the table while the
      // videos upload, so an index taken once can point at the wrong row.
      const live = A.findRowIndex(job.filename);
      const index = live >= 0 ? live : pairs[i].index;
      state.run.jobId = job.id;
      setSub(`${i + 1}/${pairs.length} · ${job.filename || 'video'}`);
      save();

      setStatus(job, 'uploading', 'Filling the caption');
      const chars = await A.fillCaptionAt(index, job.caption, job.filename);
      log(`Row ${index + 1} (${job.filename}) caption → ${chars} chars`, 'ok');

      if (job.date && job.time) {
        setStatus(job, 'uploading', 'Setting the schedule');
        const shown = await A.setScheduleAt(index, job.date, job.time, job.filename);
        log(`Row ${index + 1} (${job.filename}) scheduled → ${shown}`, 'ok');
      } else {
        log(`Row ${index + 1} (${job.filename}) has no schedule — it posts the moment you press Post.`, 'warn');
      }
    }

    setSub('Waiting for TikTok to finish uploading');
    await A.waitForTableReady(Math.max(2, state.settings.uploadTimeoutMin) * 60 * 1000);

    if (state.settings.reviewMode) {
      setBatchStatus(batch, 'review', 'Waiting for your review');
      setSub(`Waiting for your review · ${label}`);
      const decision = await askReview(batch[0]);
      if (decision !== 'post') {
        setBatchStatus(batch, 'skipped', 'Skipped during review');
        log(`Skipped ${label} during review — the rows stay in TikTok's table.`, 'warn');
        return 'next';
      }
    }

    setBatchStatus(batch, 'uploading', 'Publishing');
    setSub(`Publishing · ${label}`);
    await A.submitAll();

    const confirmed = await A.confirmBatch(180000);
    if (confirmed) {
      for (const job of batch) {
        setStatus(job, 'done', job.date ? 'Scheduled' : 'Posted');
        job.reloaded = false;
      }
      log(`✓ ${label} — ${batch[0].date ? 'scheduled' : 'posted'}`, 'ok');
      if (!state.settings.keepFiles) {
        for (const job of batch) {
          try {
            await Store.del(job.id);
          } catch {
            /* ignore */
          }
          memFiles.delete(job.id);
          job.hasFile = false;
          job.size = 0;
          paint(job);
        }
      }
    } else {
      setBatchStatus(batch, 'needs_review', 'Submitted, but no confirmation was detected — check TikTok');
      log(`? ${label} — submitted, confirmation not detected`, 'warn');
    }

    return 'next';
  }

  async function startQueue() {
    if (state.run.active) return;

    const queued = state.jobs.filter((job) => job.status === 'queued' && (FB || job.hasFile));
    if (!queued.length) {
      log(
        FB
          ? 'Tidak ada baris untuk dijalankan — import CSV dulu atau re-queue baris yang gagal.'
          : 'Nothing to run — rows need a video file and a Queued status.',
        'warn'
      );
      return;
    }

    // TikTok's bulk table takes 30 rows; the Facebook composer has held 50.
    const batch = queued.slice(0, FB ? 50 : 30);
    if (queued.length > batch.length) {
      log(`${batch.length} baris dijalankan dulu — ${queued.length - batch.length} lainnya tetap antre.`, 'warn');
    }

    syncControls();
    log(FB ? `Memulai ${batch.length} baris jadwal Facebook.` : `Starting ${batch.length} video(s) as one batch.`, 'ok');

    let navigating = false;
    try {
      const outcome = FB ? await runFbBatch(batch) : await runBatch(batch);
      if (outcome === 'navigate') navigating = true;
    } catch (error) {
      const message = String((error && error.message) || error);

      // Keep the stack around: the panel log only has room for the message.
      globalThis.__ttLastError = {
        when: new Date().toISOString(),
        message,
        stack: (error && error.stack) || null
      };
      if (error && error.stack) console.warn('[bulk] batch failed', error);

      // A cracked page is worth one automatic reload even when the failure came
      // from the table emptying under us. Facebook is not reloaded mid-run:
      // the composer holds uploaded rows that a reload would not restore.
      if (!FB && error && typeof error === 'object' && !error.reload && !error.stopped && A.pageError()) error.reload = true;

      // A broken TikTok page is worth one automatic reload; the queue resumes
      // by itself because the run state is already flushed to storage.
      if (!FB && error && error.reload && !batch.every((job) => job.reloaded)) {
        for (const job of batch) job.reloaded = true;
        setBatchStatus(batch, 'queued', '');
        log(`↻ ${message}`, 'warn');
        await navigateAndStop();
        navigating = true;
      } else if (error && error.stopped) {
        setBatchStatus(batch, 'queued', '');
        log(message, 'warn');
      } else if (FB) {
        // Rows the FB loop already finished keep their Done status; only the
        // rows it was still working on are marked.
        for (const job of batch) {
          if (['queued', 'uploading'].includes(job.status)) setStatus(job, 'error', message);
        }
        log(`✕ ${message}`, 'err');
        log('Perbaiki baris yang gagal lalu tekan Start lagi — baris yang sudah Done tidak akan disentuh ulang.', 'warn');
        setDot('err');
      } else {
        setBatchStatus(batch, 'error', message);
        log(`✕ ${message}`, 'err');
        log('Press “Clear queue” to wipe this batch (videos included) before importing the CSV again.', 'warn');
        setDot('err');
      }
    } finally {
      if (navigating) return;
      const stopped = state.run.stop;
      state.run.active = false;
      state.run.stop = false;
      state.run.jobId = null;
      syncControls();
      setDot(stopped ? 'warn' : 'ok');
      setSub(stopped ? 'Stopped' : 'Finished');
      log(stopped ? 'Run stopped.' : 'Run finished.', stopped ? 'warn' : 'ok');
      save();
    }
  }

  function stopQueue() {
    state.run.stop = true;
    log('Stop requested — finishing the current step.', 'warn');
    resolveReview('skip');
  }

  /* ------------------------------------------------------------------ *
   * diagnostics
   * ------------------------------------------------------------------ */

  async function diagnose() {
    const snapshot = A.diagnose();
    const text = JSON.stringify(snapshot, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      log('Diagnostics copied to the clipboard — paste them into the issue.', 'ok');
    } catch {
      log('Clipboard blocked. Diagnostics:', 'warn');
      for (const line of text.split('\n')) log(line);
    }
    console.info('[ttbulk] diagnostics', snapshot);
  }

  /* ------------------------------------------------------------------ *
   * mount
   * ------------------------------------------------------------------ */

  const SHELL = `
    <div class="shell">
      <header class="head">
        <span class="dot" data-ref="dot"></span>
        <div class="titles">
          <strong>Bulk uploader</strong>
          <span class="sub" data-ref="sub">Ready</span>
        </div>
        <button class="mini" data-ref="diag" type="button" title="Copy what the automation can see on this page">Diagnose</button>
        <button class="mini close" data-ref="close" type="button" aria-label="Hide panel">×</button>
      </header>

      <div class="bar">
        <button class="primary" data-ref="import" type="button">Import CSV</button>
        <button data-ref="addVideos" type="button">Add videos</button>
        <input data-ref="csvInput" type="file" accept=".csv,text/csv" hidden />
        <input data-ref="videoInput" type="file" accept="video/*" multiple hidden />
      </div>

      <div class="bar minor">
        <button class="ghost" data-ref="clearTable" type="button" title="Remove every row from TikTok's bulk table">Clear table</button>
        <button class="ghost" data-ref="clearQueue" type="button" title="Remove every row in this queue and delete the videos stored for them">Clear queue</button>
        <button class="ghost" data-ref="sample" type="button" title="Download an example CSV">Sample</button>
      </div>

      <div class="sched">
        <span class="sched-label">Schedule empty rows</span>
        <input data-ref="bulkDate" type="date" aria-label="Date for rows without a schedule" />
        <input data-ref="bulkTime" type="time" step="60" aria-label="Time for rows without a schedule" />
        <button class="mini" data-ref="applyAll" type="button">Apply</button>
        <button class="mini" data-ref="randomize" type="button" hidden title="Isi jam acak 06:00–18:00 untuk baris yang masih kosong (jam pagi di tanggal batas 29 hari)">Acak</button>
      </div>

      <div class="list" data-ref="list"></div>

      <footer class="foot">
        <label class="switch"><input data-ref="review" type="checkbox" checked /><span>Review</span></label>
        <label class="switch" title="Keep the local copy of each video after a successful post"><input data-ref="keep" type="checkbox" /><span>Keep files</span></label>
        <span class="count" data-ref="count"></span>
        <button class="primary" data-ref="start" type="button">Start</button>
        <button class="danger" data-ref="stop" type="button" hidden>Stop</button>
      </footer>

      <div class="log" data-ref="log"></div>
    </div>
    <button class="launcher" data-ref="launcher" type="button">Bulk</button>
  `;

  const FALLBACK_CSS = `
    .shell { position: fixed; right: 16px; top: 72px; width: 440px; max-height: calc(100vh - 96px);
      display: flex; flex-direction: column; gap: 10px; padding: 12px; background: #0e1117;
      color: #e8ecf3; border: 1px solid #262d3a; border-radius: 12px; font: 12px/1.5 system-ui, sans-serif; }
    .list { overflow: auto; max-height: 40vh; }
  `;

  async function loadCss() {
    try {
      const response = await fetch(chrome.runtime.getURL('content/panel.css'));
      if (response.ok) return await response.text();
    } catch {
      /* fall through */
    }
    return FALLBACK_CSS;
  }

  async function mount() {
    if (mounted) return api;
    mounted = true;

    await load();
    const css = await loadCss();

    // A previous injection can leave a dead panel behind after an extension
    // reload or a SPA navigation; never stack two.
    document.getElementById('ttbulk-host')?.remove();

    const host = document.createElement('div');
    host.id = 'ttbulk-host';
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    shadow.append(style);

    const template = document.createElement('div');
    template.innerHTML = SHELL;
    while (template.firstChild) shadow.append(template.firstChild);

    refs = {};
    for (const node of shadow.querySelectorAll('[data-ref]')) refs[node.dataset.ref] = node;
    refs.shell = shadow.querySelector('.shell');
    refs.log = shadow.querySelector('.log');

    // Automation progress lands in the panel's own log.
    A.onStep = (message, kind) => log(message, kind);

    const missing = ['shell', 'log', 'close', 'launcher', 'start', 'stop', 'diag', 'review', 'keep'].filter((key) => !refs[key]);
    if (missing.length) {
      mounted = false;
      throw new Error(`panel markup is missing: ${missing.join(', ')} — the extension files are out of sync, reload it from chrome://extensions.`);
    }

    refs.close.addEventListener('click', () => hide());
    refs.launcher.addEventListener('click', () => show());
    refs.import.addEventListener('click', () => refs.csvInput.click());
    refs.addVideos.addEventListener('click', () => refs.videoInput.click());
    refs.sample.addEventListener('click', downloadSample);
    refs.start.addEventListener('click', startQueue);
    refs.stop.addEventListener('click', stopQueue);
    refs.diag.addEventListener('click', diagnose);
    refs.applyAll.addEventListener('click', applyScheduleToRows);
    refs.randomize.addEventListener('click', randomizeTimes);
    if (refs.clearTable) refs.clearTable.addEventListener('click', clearTableRows);
    if (refs.clearQueue) refs.clearQueue.addEventListener('click', clearQueue);

    if (FB) {
      // The Facebook panel is a scheduler: no files are handled here, nothing
      // publishes, so the video controls and the review gate go away.
      const title = shadow.querySelector('.titles strong');
      if (title) title.textContent = 'Bulk scheduler · Facebook';
      setHidden(refs.addVideos, true);
      setHidden(refs.clearTable, true);
      const reviewWrap = refs.review.closest('.switch');
      if (reviewWrap) reviewWrap.hidden = true;
      const keepWrap = refs.keep.closest('.switch');
      if (keepWrap) keepWrap.hidden = true;
      setHidden(refs.randomize, false);
    }

    refs.review.addEventListener('change', () => {
      state.settings.reviewMode = refs.review.checked;
      save();
    });
    refs.keep.addEventListener('change', () => {
      state.settings.keepFiles = refs.keep.checked;
      save();
    });

    refs.csvInput.addEventListener('change', async () => {
      const file = refs.csvInput.files && refs.csvInput.files[0];
      refs.csvInput.value = '';
      if (!file) return;
      try {
        await importCsv(await file.text());
      } catch (error) {
        log(`CSV import failed: ${(error && error.message) || error}`, 'err');
      }
    });

    refs.videoInput.addEventListener('change', async () => {
      const files = refs.videoInput.files ? [...refs.videoInput.files] : [];
      refs.videoInput.value = '';
      if (!files.length) return;
      try {
        await addVideoFiles(files);
      } catch (error) {
        log(`Could not add the video(s): ${(error && error.message) || error}`, 'err');
      }
    });

    // Clicking the field itself should open the calendar / clock, not just the icon.
    clickToPick(refs.bulkDate);
    clickToPick(refs.bulkTime);

    // Dropping files onto the panel is quicker than the picker.
    refs.shell.addEventListener('dragover', (event) => {
      event.preventDefault();
      refs.shell.classList.add('dropping');
    });
    refs.shell.addEventListener('dragleave', (event) => {
      if (event.target === refs.shell) refs.shell.classList.remove('dropping');
    });
    refs.shell.addEventListener('drop', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      refs.shell.classList.remove('dropping');
      if (FB) {
        log('Mode Facebook tidak memakai file di panel — unggah videonya langsung di composer.', 'warn');
        return;
      }
      const dropped = [...((event.dataTransfer && event.dataTransfer.files) || [])];
      const videos = dropped.filter((file) => /^video\//i.test(file.type) || /\.(mp4|mov|m4v|webm|avi)$/i.test(file.name));
      if (!videos.length) {
        log('Those files are not videos.', 'warn');
        return;
      }
      try {
        await addVideoFiles(videos);
      } catch (error) {
        log(`Could not add the video(s): ${(error && error.message) || error}`, 'err');
      }
    });

    // The Facebook panel must not leak its own clicks into the page: FB closes
    // its schedule dropdown on any outside mousedown — including one on this
    // panel — which used to shut the dropdown the moment Diagnose was pressed.
    // Bubble phase, not capture: the panel's own buttons handle their events
    // first, then the leak to the page is cut at the host boundary.
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel']) {
      host.addEventListener(type, (event) => event.stopPropagation());
    }

    // Diagnose without touching the mouse at all — the only reliable way to
    // snapshot the schedule panel while it is open.
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.altKey && !event.ctrlKey && !event.metaKey && String(event.key).toLowerCase() === 'd') {
          event.preventDefault();
          event.stopPropagation();
          diagnose();
        }
      },
      true
    );

    document.documentElement.append(host);
    renderList();

    let open = true;
    try {
      const stored = await chrome.storage.local.get(PANEL_KEY);
      open = stored[PANEL_KEY] !== false;
    } catch {
      open = true;
    }
    if (open) show();
    else hide();

    log(`Panel ready (v${VERSION}).`);
    if (FB) log('Tip: Alt+D menjalankan Diagnose tanpa klik — dropdown FB tetap terbuka.', '');
    return api;
  }

  function show() {
    if (!refs || !refs.shell) return;
    setHidden(refs.shell, false);
    setHidden(refs.launcher, true);
    setRefPanelOpen(true);
  }

  function hide() {
    if (!refs || !refs.shell) return;
    setHidden(refs.shell, true);
    setHidden(refs.launcher, false);
    setRefPanelOpen(false);
  }

  function toggle() {
    if (!refs || !refs.shell) return;
    if (refs.shell.hidden) show();
    else hide();
  }

  function setRefPanelOpen(open) {
    try {
      // A stale extension context makes this reject; a panel toggle must not care.
      chrome.storage.local.set({ [PANEL_KEY]: open }).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  async function clearTableRows() {
    if (state.run.active) return;
    if (FB) return; // no TikTok table here; the button is hidden anyway
    if (!A.rowCount()) {
      log('TikTok has no rows to clear.', 'warn');
      return;
    }
    try {
      const removed = await A.clearTable();
      log(`Removed ${removed} row(s) from TikTok's table.`, 'ok');
    } catch (error) {
      log(`Could not clear the table: ${(error && error.message) || error}`, 'err');
    }
  }

  /**
   * Wipes the queue itself, not just TikTok's table: a failed CSV leaves rows
   * behind that would otherwise merge into the next import and block it.
   */
  async function clearQueue() {
    if (state.run.active) {
      log('A run is going — press Stop first.', 'warn');
      return;
    }
    const total = state.jobs.length;
    if (!total) {
      log('The queue is already empty.', 'warn');
      return;
    }

    const withFiles = state.jobs.filter((job) => job.hasFile).length;
    const question =
      `Remove all ${total} row(s)` +
      (withFiles ? ` and delete the ${withFiles} stored video(s)` : '') +
      '? Import the CSV again afterwards.';
    if (!window.confirm(question)) {
      log('Clear queue cancelled.', 'warn');
      return;
    }

    for (const job of state.jobs) {
      memFiles.delete(job.id);
      try {
        await Store.del(job.id);
      } catch {
        /* ignore */
      }
    }

    state.jobs = [];
    renderList();
    save();
    syncControls();
    log(`Queue cleared — ${total} row(s) removed${withFiles ? `, ${withFiles} video(s) deleted` : ''}.`, 'ok');
  }

  function applyScheduleToRows() {
    const date = refs.bulkDate.value;
    const time = refs.bulkTime.value;
    if (!date || !time) {
      log('Pick a date and a time first.', 'warn');
      return;
    }
    let count = 0;
    for (const job of state.jobs) {
      if (job.date && job.time) continue;
      job.date = date;
      job.time = time;
      const card = cards.get(job.id);
      if (card) {
        card.date.value = date;
        card.time.value = time;
      }
      count++;
    }
    save();
    log(`Schedule applied to ${count} row(s).`, count ? 'ok' : 'warn');
  }

  /**
   * Fill empty times with random hours inside 06:00–18:00, the posting window
   * the queue was built around. Rows dated on the last day Facebook still
   * accepts (now + 29 days) get a morning hour, because the 29-day boundary is
   * measured against the moment the run presses Perbarui, not the date alone.
   */
  function randomizeTimes() {
    if (!state.jobs.length) {
      log('Belum ada baris — import CSV dulu.', 'warn');
      return;
    }
    const hi = new Date(Date.now() + 29 * 24 * 60 * 60 * 1000);
    const hiKey = `${hi.getFullYear()}-${CSV.pad2(hi.getMonth() + 1)}-${CSV.pad2(hi.getDate())}`;
    let count = 0;
    for (const job of state.jobs) {
      if (job.time) continue;
      const boundary = job.date === hiKey;
      const hour = boundary ? 6 + Math.floor(Math.random() * 5) : 6 + Math.floor(Math.random() * 12);
      const minute = Math.floor(Math.random() * 60);
      job.time = `${CSV.pad2(hour)}:${CSV.pad2(minute)}`;
      const card = cards.get(job.id);
      if (card) card.time.value = job.time;
      count++;
    }
    save();
    log(
      count
        ? `Jam acak diisi untuk ${count} baris (06:00–18:00${hi ? '; tanggal batas pakai 06:00–10:00' : ''}).`
        : 'Semua baris sudah punya jam.',
      count ? 'ok' : 'warn'
    );
  }

  function sampleCsv() {
    const today = new Date();
    const dates = [0, 1, 2].map((offset) => {
      const day = new Date(today.getTime() + offset * 86400000);
      return `${day.getFullYear()}-${CSV.pad2(day.getMonth() + 1)}-${CSV.pad2(day.getDate())}`;
    });
    return [
      'filename,caption,date,time',
      `clip-01.mp4,"Morning routine #morning",${dates[0]},09:00`,
      `clip-02.mp4,"Three things I learned #creator",${dates[1]},13:30`,
      `clip-03.mp4,"Behind the scenes #bts",${dates[2]},18:00`
    ].join('\n');
  }

  function downloadSample() {
    const blob = new Blob([sampleCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = FB ? 'facebook-schedule.csv' : 'tiktok-schedule.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /** Continue a queue that was interrupted by a page reload between posts. */
  async function resumeIfNeeded() {
    if (!mounted || !refs) return;
    if (!state.run.active) {
      syncControls();
      return;
    }

    const interrupted = state.run.jobId ? state.jobs.find((job) => job.id === state.run.jobId) : null;
    if (interrupted && interrupted.status === 'uploading') {
      interrupted.status = 'needs_review';
      interrupted.message = 'The page reloaded mid-post — check TikTok before retrying this one.';
      paint(interrupted);
    }

    state.run.active = false;
    state.run.jobId = null;
    state.run.stop = false;
    syncControls();

    log('Resuming the queue after a page reload.', 'warn');
    await startQueue();
  }

  const api = { mount, show, hide, toggle, resumeIfNeeded, version: VERSION };

  Object.defineProperty(global, '__TTBULK_VERSION__', { value: VERSION, enumerable: false });
  Object.defineProperty(global, '__TTBULK_PANEL__', { value: api, enumerable: false });
})(globalThis);
