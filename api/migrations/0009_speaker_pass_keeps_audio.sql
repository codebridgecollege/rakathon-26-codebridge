-- Step 5 follow-up (user decision 2026-10-18): a failed speaker pass always keeps its audio for "Zkusit znovu" until
-- the case closes, at most 7 days, so the per-pass setting copied from SPEAKER_PASS_AUDIO_ON_FAILURE is gone.
ALTER TABLE transcript_passes DROP COLUMN audio_on_failure;
