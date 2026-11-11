# Reels Bulk Studio (TikTok + Facebook)

One extension, two panels. It detects which site the tab is on:

- **TikTok Studio** — the bulk uploader as documented below: import a CSV, attach the
  matching videos, the panel fills every row (caption + schedule), one `Post (N)` publishes.
- **Facebook** (`business.facebook.com/latest/bulk_upload_composer`) — a **scheduler only**.
  Import a CSV, and the panel walks the bulk composer row by row with the proven routine:
  dropdown → **Jadwal** → date → hour/minute → **Perbarui** → verify. It **never touches
  "Terbitkan"** — every schedule is saved and verified, then the run stops for human review.

---

## Facebook mode: how it schedules

The composer page shows one row per uploaded video, each with a description editor and its own
publish-mode dropdown. The panel matches CSV lines to rows by the caption already in the
description (order is the fallback), then for each row:

1. Opens the row's dropdown — a plain click sometimes does not register on Meta's
   `div[role=button]`, so the open walks through **six methods** (click → Enter → click on the
   label's left edge → Space → press-only mousedown → release-only click) and stops at the one
   that produces the panel. The row's button reads **Terbitkan sekarang** when closed and
   **Opsi penjadwalan** while its panel is open — both are recognized.
2. Clicks the **Jadwal** tab. The panel has **no `role="dialog"`** — it is found by anchoring
   on *Simpan sebagai draf* together with the small `Jadwal` tab, and every control in it is a
   `div[role=button]`.
3. Fills the date by selecting the field's text and inserting `DD/MM/YYYY` — Facebook
   normalizes it to `11 November 2026` on its own (the field's placeholder is `dd/mm/yyyy`).
   A plain `value =` write is invisible to React; if the synthetic insert does not land, the
   date is retyped as trusted CDP input like the time fields.
4. Fills the hour/minute spinbuttons (`aria-label="jam"` / `"menit"`, invisible at opacity 0,
   value always empty with the real number in `aria-valuenow`). **These two fields ignore every
   synthetic event** — verified live — so after the synthetic attempts fail the extension types
   the digits as **trusted** events over `chrome.debugger` (CDP) via the background worker:
   one keyDown + keyUp pair per digit (`code: "Digit<k>"`, `windowsVirtualKeyCode: 48+k`;
   `keyChar` is rejected by the protocol, and `Input.insertText` writes into the wrong place).
   Chrome shows a *"…started debugging this browser"* banner while this happens — it is the
   extension itself, it disappears after each field, and no debugger window opens.
5. Presses **Perbarui** (also a `div[role=button]`), waits for the panel to close, and verifies
   the row's button now reads **Jadwal** and the description did not move. A failed row escapes
   the panel with `Esc` — synthetic first, then a trusted CDP Escape if the panel is still open.

**Window guard.** Facebook accepts 20 minutes to 29 days from *now*. The panel checks every
date/time before the run and skips rows outside the window with a clear reason instead of
letting Facebook reject them mid-run. Rows dated on the boundary day get a morning hour —
the **Acak** button fills empty times at random inside 06:00–18:00, with 06:00–10:00 on the
boundary date.

**Click containment.** Facebook closes its dropdown on any outside mousedown — including one on
the extension panel — so the panel stops every pointer event at its host boundary (bubble
phase, so its own buttons still work). **Alt+D** runs Diagnose without touching the mouse, which
is the reliable way to snapshot the panel while it is open; a run that fails mid-panel also
auto-snapshots the panel's last state into `lastPanelProbe`, which Diagnose then reports even
after the panel has closed.

**Verified live (1.0.0).** Three rows scheduled end-to-end: dropdown opened, Jadwal tab taken,
date shown as `11 November 2026`, hour/minute typed via trusted CDP (`aria-valuenow` updated),
Perbarui pressed, panel closed, all three row buttons reading **Jadwal** with descriptions
intact — and nothing published.

CSV columns are the same as TikTok's (`filename, caption, date, time`); `filename` is only a
label there — matching runs on the caption text.

---

# TikTok Studio Bulk Uploader

A Chrome extension that adds a **panel inside TikTok Studio** and drives its **bulk publish
table**: import a CSV, attach the matching videos, and the panel fills every row — caption and
its own scheduled date/time — then publishes the whole table with one `Post (N)`.

```
CSV  →  queue (in-page panel)  →  one attach per batch  →  N rows filled  →  Post (N)
```

Nothing here reloads the page per video: a batch of up to 30 clips goes into TikTok's table
once, and each row is then filled in place.

## What changed in 0.4.4

**Captions are pasted, not typed.** `execCommand('insertText')` with newlines tears Draft.js
apart — TikTok's table dies with *"Something went wrong"* and every row disappears. Clearing the
content with `execCommand('delete')` is worse: Draft is left with zero blocks and the next paste
crashes as well.

The caption is now written the way a person does it: caret to the end, `Backspace` until the
seeded file name is gone, then one `paste` event carrying the whole caption. Draft splits the
lines into proper blocks, and the row keeps them — verified live with a 792-character, 13-line
caption committed to the table.

**Rows are stamped instead of being recognised by their caption.** Until now a row was found by
the caption TikTok seeds from the file name — which disappears the moment the caption is
replaced. Each row now gets a `data-ttbulk-row` stamp the first time it is resolved, and every
later lookup (caption, schedule, delete) uses the stamp.

**The caption is verified with patience.** The cell re-renders from TikTok's state a few seconds
after the commit, so the check waits up to 20 s before calling a caption wrong.

## What changed in 0.4.3

**The first two files have to arrive together.** One file on an empty table does not open the
bulk table at all — TikTok opens the normal single-video editor (and removes the file input).
So the batch now starts with two files in one `DataTransfer`, then appends the rest **one at a
time**, waiting each time for the row to mount and start uploading (3 s minimum, 20 s max).

Measured on the live page: 10 files at once crashes the table, 4 + 4 + 2 within three seconds
crashes it, and two-at-once + one-by-one survives. A single-file append was verified to grow
the table without touching the existing rows.

## What changed in 0.4.2

**The batch input is found by position, not by class.** Every row carries its own hidden
“Replace file” input, so the batch input is now the video input that is *not* inside a `<tr>` —
otherwise a batch could be attached into a single row.

## What changed in 0.4.1

**TikTok crashed when ten files were handed over at once.** The page went to *“Something went
wrong / Please try again”*, the table emptied, and the automation then hit a row that no longer
existed. Attaching is now paced (see 0.4.2), and a row is re-read from the live table right
before every action.

**Rows are found again for every action.** TikTok re-renders the table while videos upload, so
an index taken once can point at the wrong row (or at nothing). Each caption and each schedule
is now looked up by the file name TikTok seeded into the caption, immediately before it is used.

**Clear queue.** A failed run used to leave its rows sitting in the panel, where the next CSV
import merged into them. The new **Clear queue** button removes every row *and* the videos
stored for them, so you can start over from a clean import.

**Failed rows are dropped on import.** Importing a CSV now deletes error / skipped / check rows
that the new CSV does not mention, and re-queues the ones it does. Importing the same CSV again
is therefore a valid “try again”.

**One video needs the normal editor.** TikTok only opens the bulk table for two or more files;
a single file goes to the ordinary post editor, which this extension does not drive. The panel
says so instead of half-running.

## What changed in 0.4.0

The automation was rewritten for the bulk table, replacing the old single-video form flow:

- **One attach per batch** (`DataTransfer` into `input[type=file][multiple]`), not one page load
  per clip.
- **Captions** are written through the row's Draft.js editor (`execCommand('insertText')`, real
  paragraphs for multi-line text) and committed with the row's own arrow button.
- **Schedules** are picked with TikTok's calendar and its two time columns — never typed.
- **Review stops before `Post (N)`**, so all rows are visible for checking first.

## Install / update

1. `chrome://extensions` → **Developer mode** on.
2. **Load unpacked** → `tiktok-bulk-studio` (folder name keeps its old name; the extension now covers both sites).
3. Open <https://www.tiktok.com/tiktokstudio/upload> or the Facebook bulk upload composer while
   logged in; the panel appears on the right and the toolbar icon toggles it. After changing the
   files, press **Reload** on the extension card, then refresh the site tab — on Facebook the
   console shows `[fbbulk] content scripts loaded, panel v1.0.0 on business.facebook.com`.
   The `debugger` permission makes Chrome mention *"Read and change your data … debug"* on the
   first reload — that is the trusted-typing channel described above.

After changing the files, press **Reload** on the extension card, then refresh the Studio tab.
The panel log starts with `Panel ready (vX.Y.Z).`, so the running build is always identifiable.

## Use

1. **Import CSV** (columns `filename, caption, date, time`).
2. **Add videos** — select the clips at once, or drag them from Explorer onto the panel. A CSV
   path cannot open a file (browser rule); the `filename` column is only the matching key, so
   files are matched by base name, ignoring case and the extension.
3. Press **Start**. The panel attaches the batch, then per row: caption, schedule, verification.
4. With **Review** on it stops before publishing — check the rows in TikTok's table, then press
   the panel's **Post now** (or `Post (N)` in the table itself).

```csv
filename,caption,date,time
clip-01.mp4,"Morning routine #morning #routine",2026-11-10,09:00
clip-02.mp4,"Three things I learned this week #creator",2026-11-11,13:30
```

Accepted: `date` as `YYYY-MM-DD`, `YYYY/MM/DD`, `MM/DD/YYYY`; `time` as `14:30`, `14.30`,
`2:30 PM`, `9pm`, or a bare hour `9`. Header aliases (`video`, `description`, `hour`,
`publish date`, …) and headerless positional files both work.

## Scheduling: pickers, not typing

Everything is set through TikTok's own widgets:

- **Day** — the calendar's `span.day.valid` cells, found by the weekday of the 1st so the
  previous month's filler days can never be clicked by mistake.
- **Time** — the hour and minute scroll columns. The grid is 5 minutes, so `09:07` becomes
  `09:05`; the log prints the value that was actually landed on.
- **Window** — TikTok currently accepts roughly today through 30 days ahead. A date outside it
  fails with *“TikTok's calendar will not accept …”* instead of silently posting now.

Each row is verified after it is filled: the caption text in the cell, and the schedule cell
showing `M/D/YYYY HH:MM`. A mismatch aborts the run before anything is published.

## Clearing

| Button | Removes |
| --- | --- |
| **Clear table** | Every row currently in TikTok's table (also happens automatically before a batch) |
| **Clear queue** | Every row in the panel, plus the videos stored in IndexedDB |

Both refuse to run mid-batch — press **Stop** first.

## Limits

- The **tab must stay open and logged in**. It is not headless and uses no private APIs.
- Up to **30 videos per table** (TikTok's own limit); a bigger queue stays queued for the next
  batch.
- Attaching is paced **one file at a time** because TikTok's table crashes when files arrive in
  bursts; a 10-video batch therefore takes a few extra seconds to set up.
- Bulk posting can hit rate limits or a captcha.
- Videos live in the page's IndexedDB so a batch survives a reload. Without **Keep files**, the
  local copy is deleted after a confirmed post.
- Automating posts may violate TikTok's Terms of Service. Use it on your own account.

## Files

```
manifest.json            MV3, two content-script blocks (TikTok + Facebook), toolbar action
background.js            opens/focuses Studio or the composer, shows the panel, and types the
                         trusted CDP key events the Facebook time fields demand
content/store.js         IndexedDB for the video blobs (TikTok only)
content/csv.js           CSV parsing (pure; testable with Node; shared by both modes)
content/automation.js    TikTok bulk table: attach, captions, calendar, Post (N), diagnose
content/fb-automation.js Facebook composer: schedule-only routine, window guard, diagnose
content/panel.js         panel UI, queue state, run loop, resume-after-reload, site switch
content/panel.css        shadow-root styles
content/content.js       boot
samples/sample-schedule.csv
```

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Panel doesn't appear | Not on a `tiktokstudio` page, or the extension needs a reload. On Facebook the panel may just be hidden — click the small **Bulk** tab on the page edge, or run `document.getElementById('ttbulk-host').shadowRoot.querySelector('.launcher').click()` in the console |
| `net::ERR_BLOCKED_BY_CLIENT` on `/ajax/bz` in the console | An ad blocker rejecting Facebook's telemetry — not the extension; safe to ignore |
| `TikTok Studio crashed while taking the videos` | The table died while a file was being handed over. The run reloads once and retries; if it repeats, raise `SETTLE_MIN_MS` in `content/automation.js` |
| `Row N is no longer in the table` | The table emptied under the run (usually a crash). Reload, then **Clear table** and start again |
| Uploads stall at the same percentage | TikTok pauses uploads while its tab is in the background — keep the Studio tab in front until the run reaches review |
| `TikTok only opens the bulk table for two or more videos` | A one-video batch — use the normal Studio editor |
| `TikTok's calendar will not accept <date>` | Past the ~30-day scheduling window |
| `Row N kept a different caption than the CSV` | The Draft.js editor changed; press **Diagnose** |
| `The video upload input disappeared` | The page navigated or reloaded mid-run — press Start again |
| `Submitted, but no confirmation was detected` | TikTok accepted it but no toast was seen — check the posts list before retrying |
| Video rejected by TikTok | Codec/size — re-encode to H.264 MP4 |
| **Facebook:** `Tidak ada baris unggahan yang terlihat` | Not on the bulk upload composer, or the videos are not in the table yet — add them in Facebook first, then press Start |
| **Facebook:** `Baris N: tombol dropdown jadwal tidak ditemukan` | The composer markup changed — press **Diagnose** and send the JSON |
| **Facebook:** `Panel penjadwalan tidak muncul setelah dropdown dibuka (6 cara dicoba)` | Meta's dropdown ignored every synthetic open — open it manually, leave the panel open, press **Alt+D** and send the JSON |
| **Facebook:** `Tanggal tidak diterima` / `Nilai "07" tidak masuk` | The panel widgets changed or a popover intercepted the input — press **Diagnose** |
| **Facebook:** `Ketik trusted (CDP) gagal` | Another debugger (DevTools) is attached to the tab, or the `debugger` permission is missing — close DevTools, check `chrome://extensions`, retry |
| **Facebook:** `baris CSV tidak menemukan deskripsi yang cocok di composer` | The composer descriptions and the CSV captions disagree — clear the composer descriptions (the run fills them from the CSV) or fix the CSV, never let it guess |
| **Facebook:** `melewati jendela 29 hari Facebook` | The row is dated beyond now + 29 days — schedule it in a later batch |
| **Facebook:** panel log ends with `silakan verifikasi manual` | Normal success — nothing was published; check the rows in Facebook before posting |
