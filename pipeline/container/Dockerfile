# pagekit container: render, Tesseract and the deterministic page logic over HTTP (container/server.py).
# Build context is the repository root:  docker build -f pipeline/container/Dockerfile -t pagekit .
#
# linux/amd64 is the only architecture Cloudflare Containers run. The digest is the multi-arch index of
# python:3.12-slim-bookworm, read from Docker Hub on 2026-10-17; the platform flag picks its amd64 image.
FROM --platform=linux/amd64 python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258

# Debian bookworm ships Tesseract 5.3.0 and the Czech model 4.1.0 (versions checked on sources.debian.org).
# Pinned so OCR output, and with it every "ověřit" mark, stays the same between builds. Locally the tests ran
# with Homebrew Tesseract 5.5.3, so word confidences may differ slightly from the container.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr=5.3.0-2 tesseract-ocr-ces=1:4.1.0-2 \
    && rm -rf /var/lib/apt/lists/*

COPY pipeline/requirements.lock /app/requirements.lock
# --require-hashes: every wheel is checked against uv.lock's hashes (pymupdf==1.24.10, pillow==10.4.0).
RUN pip install --no-cache-dir --require-hashes -r /app/requirements.lock

COPY pipeline/pagekit /app/pagekit
COPY pipeline/container/server.py /app/server.py

# One Tesseract thread per request: the instance has half a vCPU and requests run one at a time.
# (No PYTHONUNBUFFERED: python -I ignores PYTHON* variables; the log handler writes each line as it goes.)
ENV OMP_THREAD_LIMIT=1
# No root: the process only reads request bodies and writes temporary files.
USER 65534
EXPOSE 8080
CMD ["python", "-I", "/app/server.py"]
