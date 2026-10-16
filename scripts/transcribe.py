# /// script
# requires-python = ">=3.11"
# dependencies = ["requests==2.32.3"]
# ///
"""Transcribe a recording with ElevenLabs Scribe and write a readable Markdown transcript.

Usage:
    uv run scripts/transcribe.py AUDIO [AUDIO ...]

The API key is read from the ELEVENLABS_API_KEY environment variable, then
from `.elevenlabs-key` in the repo root, then from
`~/.config/elevenlabs/api_key`.

For each `NAME.m4a` it writes, next to the audio:
- `NAME.elevenlabs.json`: the raw API response, kept so the Markdown can be
  regenerated without paying for another transcription.
- `NAME.elevenlabs.md`: speaker turns with timestamps, for people and agents.

Only send audio that contains no patient data; see CLAUDE.md.
"""

import json
import os
import sys
from pathlib import Path

import requests

API_URL = "https://api.elevenlabs.io/v1/speech-to-text"
MODEL_ID = "scribe_v2"
REPO_ROOT = Path(__file__).resolve().parent.parent

# The talks are in Czech and full of standard names that generic speech
# recognition mangles (Zoom wrote FHIR as "Fire"), so we bias the model
# towards the terms the slides actually use.
KEYTERMS = [
    "FHIR", "HL7", "HL7 FHIR", "HL7 CZ", "FHIR R4", "STU4", "CDA", "IHE", "IHE MHD",
    "MHDS", "ITI-65", "ATNA", "EHDS", "EEHRxF", "NCPeH", "MyHealth@EU",
    "International Patient Summary", "Patient Summary", "Implementation Guide",
    "DocumentReference", "DiagnosticReport", "CarePlan", "OperationOutcome",
    "ValueSet", "OMOP", "DASTA", "NCLP", "MKN-10", "SNOMED CT", "LOINC",
    "afinitní doména", "akreditovaná afinitní doména", "AAfD", "eHealth",
    "elektronické zdravotnictví", "NIS", "LIS", "PACS", "AIS", "EZD", "PZS",
    "ÚZIS", "GDPR", "KOC", "komplexní onkologické centrum", "MDT",
    "multidisciplinární tým", "Národní onkologický registr",
    "Národní onkologické centrum", "Fakultní nemocnice Ostrava", "FBMI", "ČVUT",
    "onkologický pacient", "histologie", "chemoterapie", "radioterapie",
    "imunoterapie", "PHOENIX", "XiA", "Rakathon", "Azure", "resource group",
    "MVP", "Michal Opatřil",
]


def read_api_key() -> str:
    """Find the API key without ever storing it in the repository."""
    if key := os.environ.get("ELEVENLABS_API_KEY"):
        return key.strip()
    for path in (REPO_ROOT / ".elevenlabs-key", Path.home() / ".config/elevenlabs/api_key"):
        if path.is_file():
            return path.read_text().strip()
    sys.exit("No ElevenLabs API key found; set ELEVENLABS_API_KEY.")


def transcribe(audio: Path, api_key: str) -> dict:
    """Send one file and return the parsed response."""
    data = [
        ("model_id", MODEL_ID),
        # Setting the language stops the model from switching to English on
        # short or noisy passages, which is what ruined the Zoom captions.
        ("language_code", "ces"),
        # Speaker labels let us tell the presenter apart from audience questions.
        ("diarize", "true"),
        ("timestamps_granularity", "word"),
        ("tag_audio_events", "false"),
    ]
    data += [("keyterms", term) for term in KEYTERMS]
    with audio.open("rb") as fh:
        resp = requests.post(
            API_URL,
            headers={"xi-api-key": api_key},
            data=data,
            files={"file": (audio.name, fh)},
            # A 2.5-hour recording is processed synchronously and can take a while.
            timeout=3600,
        )
    if resp.status_code != 200:
        sys.exit(f"{audio.name}: HTTP {resp.status_code}: {resp.text[:2000]}")
    return resp.json()


def fmt_time(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def to_markdown(result: dict, title: str) -> str:
    """Group words into speaker turns so the transcript reads like a conversation."""
    turns: list[tuple[str, float, list[str]]] = []
    for word in result.get("words", []):
        if word.get("type") == "audio_event":
            continue
        speaker = word.get("speaker_id") or "speaker"
        # Start a new turn when the speaker changes, and also every ~2 minutes
        # so long monologues still get timestamps to cite.
        if not turns or turns[-1][0] != speaker or word.get("start", 0) - turns[-1][1] > 120:
            if word.get("type") == "spacing":
                continue
            turns.append((speaker, word.get("start", 0.0), []))
        turns[-1][2].append(word["text"])

    lines = [
        f"# Transcript: {title}",
        "",
        f"Transcribed by ElevenLabs `{MODEL_ID}` (language `{result.get('language_code')}`, "
        f"probability {result.get('language_probability')}). Speaker labels are automatic "
        "and may merge or split people. Timestamps are `hh:mm:ss` from the start of the recording.",
        "",
    ]
    for speaker, start, words in turns:
        text = "".join(words).strip()
        if text:
            lines += [f"**[{fmt_time(start)}] {speaker}:** {text}", ""]
    return "\n".join(lines)


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    api_key = read_api_key()
    for arg in sys.argv[1:]:
        audio = Path(arg)
        json_path = audio.with_suffix(".elevenlabs.json")
        # Reuse an earlier response so re-running only rebuilds the Markdown.
        if json_path.exists():
            result = json.loads(json_path.read_text())
            print(f"{audio.name}: reusing {json_path.name}")
        else:
            print(f"{audio.name}: transcribing...", flush=True)
            result = transcribe(audio, api_key)
            json_path.write_text(json.dumps(result, ensure_ascii=False, indent=1))
        md_path = audio.with_suffix(".elevenlabs.md")
        md_path.write_text(to_markdown(result, audio.stem))
        print(f"{audio.name}: wrote {md_path.name} ({len(result.get('words', []))} tokens)")


if __name__ == "__main__":
    main()
