/*
 * CSV parsing for the panel. Kept as its own file so the parsing rules live in
 * one place and can be tested with plain Node (see README).
 *
 * Columns: filename, caption, date, time. A header row is detected with
 * aliases; without one, positional order is used.
 */
(function (global) {
  'use strict';

  const HEADER_ALIASES = {
    filename: ['filename', 'file', 'file name', 'video', 'video file', 'name', 'video name', 'path'],
    caption: ['caption', 'description', 'desc', 'text', 'title', 'copy', 'content'],
    date: ['date', 'schedule date', 'publish date', 'day'],
    time: ['time', 'hour', 'schedule time', 'publish time', 'at']
  };

  const POSITIONAL = { filename: 0, caption: 1, date: 2, time: 3 };

  function parse(text) {
    const clean = String(text || '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      if (inQuotes) {
        if (ch === '"') {
          if (clean[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
        continue;
      }
      if (ch === '"') inQuotes = true;
      else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (ch !== '\r') {
        field += ch;
      }
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((cells) => cells.some((cell) => String(cell).trim() !== ''));
  }

  const headerKey = (cell) => String(cell).toLowerCase().replace(/[^a-z0-9]/g, '');
  const pad2 = (n) => String(n).padStart(2, '0');

  function mapHeader(cells) {
    const map = { filename: -1, caption: -1, date: -1, time: -1 };
    cells.forEach((cell, index) => {
      const key = headerKey(cell);
      for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
        if (map[field] !== -1) continue;
        if (aliases.some((alias) => headerKey(alias) === key)) map[field] = index;
      }
    });
    return map;
  }

  /** YYYY-MM-DD, YYYY/MM/DD, MM/DD/YYYY, or anything Date can parse. */
  function normalizeDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (match) return `${match[1]}-${pad2(match[2])}-${pad2(match[3])}`;

    match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
    if (match) {
      const year = match[3].length === 2 ? `20${match[3]}` : match[3];
      return `${year}-${pad2(match[1])}-${pad2(match[2])}`;
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
    }
    return '';
  }

  /** 14:30, 14.30, 2:30 PM, 9pm, or a bare hour like 9. */
  function normalizeTime(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';

    const withMinutes = raw.match(/^(\d{1,2})[:.](\d{1,2})\s*(am|pm)?$/);
    if (withMinutes) {
      let hour = Number(withMinutes[1]);
      const minute = Number(withMinutes[2]);
      const suffix = withMinutes[3];
      if (suffix === 'pm' && hour < 12) hour += 12;
      if (suffix === 'am' && hour === 12) hour = 0;
      if (hour > 23 || minute > 59) return '';
      return `${pad2(hour)}:${pad2(minute)}`;
    }

    const hourOnly = raw.match(/^(\d{1,2})$/);
    if (hourOnly) {
      const hour = Number(hourOnly[1]);
      return hour > 23 ? '' : `${pad2(hour)}:00`;
    }

    const hourSuffix = raw.match(/^(\d{1,2})\s*(am|pm)$/);
    if (hourSuffix) {
      const hour = (Number(hourSuffix[1]) % 12) + (hourSuffix[2] === 'pm' ? 12 : 0);
      return `${pad2(hour)}:00`;
    }

    return '';
  }

  function readRows(text) {
    const rows = parse(text);
    if (!rows.length) throw new Error('That file has no rows.');

    const mapping = mapHeader(rows[0]);
    const hasHeader = Object.values(mapping).some((index) => index >= 0);
    const columns = hasHeader ? mapping : POSITIONAL;
    const body = hasHeader ? rows.slice(1) : rows;

    const entries = [];
    let skipped = 0;

    for (const row of body) {
      const cell = (field) => (columns[field] >= 0 ? String(row[columns[field]] ?? '').trim() : '');
      const filename = cell('filename');
      const caption = cell('caption');
      const date = normalizeDate(cell('date'));
      const time = normalizeTime(cell('time'));

      if (!filename && !caption) {
        skipped++;
        continue;
      }
      entries.push({ filename, caption, date, time });
    }

    if (!entries.length) throw new Error('No usable rows. Expected columns: filename, caption, date, time.');
    return { entries, skipped };
  }

  Object.defineProperty(global, '__TTBULK_CSV__', {
    value: { parse, readRows, mapHeader, normalizeDate, normalizeTime, pad2 },
    enumerable: false
  });
})(globalThis);
