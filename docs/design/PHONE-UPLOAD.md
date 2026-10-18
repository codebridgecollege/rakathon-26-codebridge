# Upload from a phone (QR code)

Status: design, 2026-10-18; built on the `backend` branch (API mode on
the Worker). On Pages (embedded mode, no server) the feature is hidden.

A doctor or the coordinator often has the document on paper or on their
phone, not on the computer that shows the case. The desktop shows a QR
code; scanning it opens a small upload page on the phone; what the phone
sends appears in the desktop's upload list within a couple of seconds.

Terms: an **upload session** is a short-lived permission, created by the
desktop, to add files to one case; its **token** is the random value in
the QR code that proves the permission. **API mode** means the page runs
on the Worker with server data; **embedded mode** means the static page
with built-in data (Pages, a file).

## Where it appears

A "Nahrát z telefonu" button next to each existing upload area:

- "Nový pacient", step "Dokumenty" (F-02): files go to the open intake
  case, so the S02 intake can be done entirely from a phone.
- "Projednání na MDT", panel "Dokumenty" (S-5): documents brought to the
  meeting.
- Documents tab, "+ Nahrát dokument" dialog (S-3).

The button shows only in API mode and only where the desktop could upload
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
  one case, add files only, nothing readable (the phone sees only the case
  ID and its own files), valid 15 minutes or until the desktop closes the
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
