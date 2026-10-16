# /// script
# requires-python = ">=3.11"
# ///
"""Build the self-contained mock pages from their templates and data.

Usage:
    uv run mocks/build.py

Writes `mocks/v1.html`, `mocks/v2.html` and `mocks/v3.html`. Each template has placeholders
(`/*CASE*/`, `/*LIST*/`, `/*EXTRA*/`) that are replaced with the JSON files
in `mocks/src/data/`, so the published page needs no server.
"""

from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "src" / "data"


def embed(text: str) -> str:
    # A literal "</" would close the <script> tag early, and the artifact host
    # rejects raw U+FFFD, which the OCR text contains; both are escaped as JSON.
    return text.replace("</", "<\\/").replace("�", "\\ufffd")


def main() -> None:
    parts = {
        "/*CASE*/": embed((DATA / "mock-case-10.json").read_text()),
        "/*LIST*/": embed((DATA / "mock-patient-list.json").read_text()),
        "/*EXTRA*/": embed((DATA / "mock-case-10-extra.json").read_text()),
    }
    for version in ("v1", "v2", "v3"):
        page = (HERE / "src" / f"{version}-template.html").read_text()
        for key, value in parts.items():
            page = page.replace(key, value)
        (HERE / f"{version}.html").write_text(page)
        print(f"wrote mocks/{version}.html ({len(page)} bytes)")


if __name__ == "__main__":
    main()
