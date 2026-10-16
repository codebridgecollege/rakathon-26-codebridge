# Sources

Raw material from the organizers and other outside sources, kept exactly
as received. Do not edit these files; write conclusions in
[`docs/research/`](../research/) or the agent docs and cite the source file and
slide or line.

## Presentations

The files sit directly in `presentations/`, as the organizers shared them:
the slide decks (`.pptx`, `.pdf`), and for each Zoom recording
(`GMT<date>-<time>_Recording`) its transcripts and chat export. Which talk
is in which recording, and at what time, is listed at the top of each note
in [`docs/research/`](../research/).

Never put patient data here. If the organizers ask that their material
is not shared, tell the team before committing it; the repository is
private, but everyone with access can read it.

## Recordings and transcripts

The organizers' Zoom recordings are transcribed with
[`scripts/transcribe.py`](../../scripts/transcribe.py) (ElevenLabs Scribe,
Czech, with speaker labels and a list of key terms taken from the slides).
For each recording:

- `NAME.elevenlabs.md` is the transcript to read and cite, as
  `[hh:mm:ss]`.
- `NAME.elevenlabs.json` is the raw response with per-word timestamps and
  confidence, kept so the Markdown can be rebuilt without paying again.
- `NAME.cc.vtt` is Zoom's own automatic caption file. It is much worse
  (it lost the first hour of the morning recording to English
  recognition), so use it only to cross-check.
- Known gap: the ElevenLabs transcript of `GMT20261015-105031` misses the
  speech from about 02:08:20 to 02:09:45 (the answer about sending data to
  cloud LLMs), and labels the block after it 02:08:28. The Zoom captions
  cover it; cite them as `[rec2 cc hh:mm:ss]`.
- The `.m4a` audio is not committed because it exceeds GitHub's 100 MB
  file limit. Get it from the team's shared drive or the organizers.
