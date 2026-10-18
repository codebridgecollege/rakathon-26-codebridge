# Upload from a phone (QR code)

Status: built 2026-10-18 on the Worker; see "As implemented".

A doctor or the coordinator often has the document on paper or on their
phone, not on the computer that shows the case. The desktop shows a QR
code; scanning it opens a small upload page on the phone; what the phone
sends appears in the desktop's upload list within a couple of seconds.

Terms: an **upload session** is a short-lived permission, created by the
desktop, to add files to one case; its **token** is the random value in
the QR code that proves the permission.

## Where it appears

A "Nahrát z telefonu" button next to each existing upload area:

- "Nový pacient", step "Dokumenty" (F-02): files go to the open intake
  case, so the S02 intake can be done entirely from a phone.
- "Projednání na MDT", panel "Dokumenty" (S-5): documents brought to the
  meeting.
- Documents tab, "+ Nahrát dokument" dialog (S-3).

The button shows only where the desktop could upload
itself (same role and case-state rules as today's upload, `canUpload`).

## Flow

1. **Desktop:** "Nahrát z telefonu" calls `POST /api/upload-sessions`
   `{ case_id, target }` (`target`: `intake`, `discussion` or
   `documents`). The server checks the user may upload to that case and
   creates a session.
2. **Desktop:** a dialog shows the QR code for
   `https://<host>/u#<token>`, the case ID (for example NO-010, no
   patient name), "Platí 15 minut", and the list of files received so far.
3. **Phone:** opens `/u`, a separate small page (a few kB, no app code),
   reads the token from the part after `#`, and asks
   `GET /api/upload-sessions/current` (token in a header) for the case ID
   and the session state. It shows the case ID, one large
   "Vyfotit nebo vybrat soubory" button (`<input type="file" multiple
   accept="image/*,application/pdf,...">`, which offers the camera and the
   photo library), and the list of files sent with a tick each.
4. **Phone:** each file goes to `POST /api/upload-sessions/current/files`
   with the token in a header and the file as the body, into the same
   upload path as a desktop upload: registered synthetic fixtures are
   stored and recognised; any other file is recorded as name and size
   only, its content not kept. The phone never shows an error to the
   user: a file the server did not store is still listed as sent.
5. **Desktop:** while the dialog is open it asks
   `GET /api/upload-sessions/:id` every 1.5 s; new files join the
   existing upload list, marked "z telefonu", and the dialog counts them.
   Closing the dialog ends the session (`DELETE /api/upload-sessions/:id`).

## Why these choices

- **A separate page, not the app.** The app is about 2 MB and built for a
  desktop screen; on mobile data it would load slowly. The phone needs
  one button and a list.
- **The token after `#`.** Browsers never send the part after `#` to the
  server, so the token stays out of server logs, proxies and the Referer
  header. The page reads it in JavaScript and sends it in a header.
- **No change to hash routing.** The desktop keeps its `#` routes; only
  `/u` is a new path, served by the Worker as a static file. Moving the
  whole app to path-based routes is possible later and not needed here.
- **Polling, not a socket.** A request every 1.5 s while the dialog is
  open is robust on venue Wi-Fi and needs no new infrastructure. A
  Durable Object with a WebSocket would deliver instantly, at the cost of
  more moving parts for about a second of difference.
- **No login on the phone.** The token is the permission, so it is narrow:
  one case, add files only, nothing readable about the patient (the phone
  sees only the case ID and the names and sizes of the files sent with
  that code), valid 15 minutes or until the desktop closes the
  dialog, at most 30 files per session.

## Server

- **D1 table `upload_sessions`:** `id`, `token_hash` (SHA-256 of the
  token; the token itself is never stored), `case_id`, `target`,
  `created_by` (the desktop user), `created_at`, `expires_at`,
  `closed_at`, `file_count`.
- **Files** are rows in the existing `documents` table with
  `source = 'phone'` and the session ID, so the desktop's list, the
  intake check and reset-demo treat them like any upload.
- **Audit:** "otevřel(a) nahrávání z telefonu", "nahráno z telefonu"
  (size and hash prefix, never the file name) and "ukončil(a) nahrávání z
  telefonu", all under the desktop user's name.
- **Limits:** the existing upload rate limit, applied per session and per
  IP; a session refuses files after it expires, after 30 files, or once
  closed; the phone shows "Platnost odkazu skončila, naskenujte kód
  znovu" only in that case.
- **Reset-demo** closes every open session.
- **Login later:** when Cloudflare Access is switched on, `/u` and
  `/api/upload-sessions/current*` must bypass it, because the phone is not
  logged in; the token is those routes' credential.

## Desktop

- QR code drawn in the page by a small, pinned QR library inlined at
  build time (like jsPDF), no CDN.
- The dialog shows the case ID, the expiry, and the files as they arrive;
  "Hotovo" closes it and ends the session.
- Files from the phone appear in the existing upload list with
  "z telefonu" next to who and when.

## Demo

- The Worker URL is public HTTPS, so the phone works on mobile data; no
  shared Wi-Fi needed.
- For the S02 intake, put the seven PDFs from `samples/S02_pacient/upload/`
  on the phone first (for example unpack `S02-dokumenty.zip` into Files);
  a photo taken with the camera simply shows as uploaded.

## Not in scope

- Reading or OCR of photos (the pipeline handles PDFs; a photo is listed
  as uploaded).
- Push notifications or a native app.
- Uploading to a case from a phone without the desktop starting it.

## As implemented

Built on the `backend` branch (issue #10, 2026-10-18). Code:
`api/src/routes/upload-sessions.ts` (routes), `api/src/domain/upload-sessions.ts`
(rules), migration `api/migrations/0010_upload_sessions.sql`, the shared
upload path `receiveUpload` in `api/src/routes/documents.ts`, the phone
page `api/public/phone-upload.html` (staged as `.assets/u.html`), and in the
app `app/components/phone/PhoneUploadButton.vue` and `PhoneUploadDialog.vue`
(state and polling in `app/stores/phone.ts`).

### Contract

- `POST /api/upload-sessions` `{ case_id, target }` (desktop, write
  middleware): the same checks as `POST /api/cases/:id/documents`
  (`caseFor(..., "document.upload")`, an unlocked case, the upload rate
  limit). Answers 201 `{ data: { id, case_id, target, state, expires_at,
  file_count, max_files, token } }`. The token appears only in this
  answer.
- `GET /api/upload-sessions/:id` (desktop poll): only the creator (anyone
  else gets 404), with the case's header access check. Answers `{ id,
  case_id, target, state, expires_at, file_count, max_files, documents }`,
  `state` one of `open`, `expired`, `closed`, `full`; `documents` are the
  session's files in the shape of the case's document list, with
  `source: "phone"`.
- `DELETE /api/upload-sessions/:id` (desktop): ends the session; a second
  call changes and logs nothing.
- `GET /api/upload-sessions/current` (phone): `{ case_id, expires_at,
  max_files, files: [{ name, size, uploaded_at }] }`, the session's own
  files only.
- `POST /api/upload-sessions/current/files` (phone): the file as the raw
  body with `X-File-Name` (URI-encoded) and `Content-Length`; answers 201
  (or 200 for a repeat) `{ data: { name, size } }`.
- The phone sends the token as `Authorization: Bearer <token>`. An
  unknown, missing, expired, closed or full session answers 410
  `upload_session_closed`, "Platnost odkazu skončila, naskenujte kód
  znovu."

### Differences from the design

- **One answer for every ended link.** Expired, closed, full (30 files),
  an unknown token, a discarded intake and a desktop user who may no
  longer upload to the case all answer the same 410 (on both phone
  routes), so the phone learns nothing about which sessions exist.
- **The phone never shows any other error.** A busy or unreachable server
  (network, 408, 429, 5xx) is retried quietly with backoff until the link
  expires, the row showing "Odesílám…"; any other answer counts as sent
  ("✓ Odesláno"), because the server lists every file it receives. A case
  approved or closed while the code is open refuses the file
  (`case_locked`), and so does a case that already holds 40 documents
  (`too_many_documents`): the phone still shows the file as sent, and the
  desktop does not list it. A fixture the case already holds is answered
  as the document already there: the desktop lists it once, not in the
  dialog's "Přijato z telefonu".
- **Repeated names.** Phones name every camera photo `image.jpg`. From a
  phone, a listed file counts as a repeat of a same-named file only within
  its own session, so a photo named like an earlier one (another session,
  or a desktop upload) is stored as a new file, `image (2).jpg`; the phone
  page also gives a repeated name its own suffix within one session. The
  phone's answer carries the name it sent, never the name of a document
  already in the case.
- **The token leaves the address bar.** The phone page moves the token to
  `sessionStorage` (this tab only, so a reload still works) and removes
  the `#` part with `history.replaceState`. The browser history and the
  phone's QR scanner app may still keep the full URL until it expires.
- **Audit wording.** The upload lines are the normal upload lines with "z
  telefonu": "nahrál(a) dokument k případu z telefonu (PDF, 1 kB, otisk
  …)" for a stored fixture, "nahrál(a) soubor k případu z telefonu
  (uložen jen název a velikost, …)" otherwise, under the desktop user.
  Opening and ending are `upload_session.open` "otevřel(a) nahrávání z
  telefonu" and `upload_session.close` "ukončil(a) nahrávání z telefonu".
  The desktop's poll is not logged per request (every 1.5 s): it returns
  only the files this user's own session added, and the opening is in the
  log.
- **Documents.** `documents.source = 'phone'` and
  `documents.upload_session_id` mark a phone's file; the case's document
  list carries `source`, and the page shows "z telefonu" after who and
  when.
- **Rate limits.** The existing `RL_UPLOAD` binding with two keys per
  phone upload, `us:<session id>` and `ip:<client IP>`, checked before a
  file takes one of the 30 slots. The slot is claimed with one conditional
  `UPDATE ... RETURNING`, so parallel uploads cannot pass the cap or a
  close that already landed. A file whose slot was claimed just before
  the close still finishes; the desktop looks once more 3 s after the
  close and reloads the case's list.
- **Clean-up.** reset-demo removes every session (trigger
  `demo_reset_upload_sessions` on the reset flag, so the reset batch keeps
  its size); discarding an intake closes its sessions in the same batch,
  so a later case that reuses the ID is never reachable through an old
  code; the cron sweep deletes sessions a day after their expiry.
- **The phone acts as the desktop user.** Each phone upload re-checks
  that user's role and membership and the case state, then runs the same
  `receiveUpload` as a desktop upload. In demo mode the phone sends no
  `X-Demo-User` and no cookie (`credentials: "omit"`).
- **Routing.** The phone routes are mounted before the login and viewer
  middleware (they would act as the default demo user) and keep the
  same-origin check. `/u` is the static file `u.html`; the assets'
  default `html_handling` serves it without the extension and redirects
  `/u.html` to `/u`, so `run_worker_first` stays `["/api/*"]` and unknown
  paths still get the 404 page.
- **A closed tab ends its session.** The desktop sends the close with
  `fetch(..., { keepalive: true })` on `pagehide`, so the code does not
  stay valid for 15 minutes after the tab is gone.
- **Desktop dialog.** A layer of its own (`#phoneup`) above the page's
  dialogs, so it opens over "Nový pacient" without closing it; Escape and
  "Zavřít" close only it. Closing first polls once more, so a file that
  arrived just before "Hotovo" is still listed, then ends the session. An
  expired or full code shows "Nový kód". Discarding the intake closes the
  dialog. In the Documents tab the "+ Nahrát dokument" dialog
  (`app/components/patient/UploadDialog.vue`) has the phone button; it sends files to the case's upload
  list (the one in "Projednání na MDT", panel "Dokumenty").
- **QR library.** qrcode-generator 2.0.4 (MIT, npm), pinned in
  `app/package.json` and loaded only when a code is shown. Error correction M, SVG,
  a white border of four modules.

### Checks

- `api/test/upload-sessions.test.ts` (Vitest in workerd): token format and
  hashing, the token only in the create answer, who may open, poll and
  end, the phone's view, uploads through the normal path, add-only, the
  same-origin check, expiry, close, the 30-file cap under parallel
  uploads, the rate limits, the desktop user's lost access, a case locked
  meanwhile, the intake and its discard, reset and sweep, and no token,
  hash or file name in the access log or the Worker log.
- `app/test/uploads.test.ts` (Vitest, mocked API): the session, the `/u`
  link built from the token, polling, and the phone's files added to the
  case list once each; the e2e suite (`e2e/specs/uploads.spec.ts`) drives the
  dialog in the app.
- `api/scripts/e2e-phone-upload.mjs` (Playwright against a running
  Worker): the desktop in Chromium starts the S02 intake and opens the QR
  dialog; an Android phone (Chromium, Pixel 7 emulation) opens `/u`
  and sends the seven S02 PDFs; the desktop lists them, the prepared data
  attach and the patient is added; the ended link shows its message; an
  iPhone (WebKit, iPhone 13 emulation) sends two camera photos named
  `image.png` to the discussion panel. Run locally on `wrangler dev` and
  against the deployed Worker on 2026-10-18, each followed by reset-demo.

### Open risks

- Cloudflare's request logs record request headers. In `wrangler tail`
  during the deployed run (2026-10-18) the `Authorization` header showed
  as `REDACTED`, which is why the token travels there; `X-File-Name` (the
  file name, on desktop uploads too) showed in full. Workers Logs, the
  stored copy, was not checked; do so before a pilot (api/AGENTS.md,
  Access runbook step 7).
- Emulated phones are not real devices: the camera itself and the iOS
  photo picker were not exercised, and nothing decodes the drawn QR code
  (the e2e compares it with the code drawn for the session URL).
- The code is valid for any phone that scans it. A QR code on the
  projector can be scanned by anyone in the room, who can then add up to
  30 files to that case and see the names of the files sent with that
  code; they appear live in the projected dialog. Binding the session to
  the first phone that opens it was left out because a second scan by the
  same doctor (a new browser tab) would then fail during the demo.
