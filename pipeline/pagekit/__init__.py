"""pagekit: the deterministic document pipeline of CodeBridge (render, OCR, page index, readability, labs, redaction).

One implementation serves the scripts in scripts/, the container in pipeline/container/server.py and the
tests, so their outputs cannot drift (docs/research/backend-steps/step-6.md, "Design (b)"). No module here
calls a network service or an LLM. Modules that need PyMuPDF or Pillow import them themselves, so the
standard-library parts (page_index, readability, labs) run without installing anything.
"""

# Bumped when an output of any module changes, so stored pipeline runs can say which logic produced them.
VERSION = "0.1.0"
