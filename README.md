# CodeBridge

An AI assistant that prepares a patient overview for a multidisciplinary
team (MDT) meeting. Built at the [Rakathon](https://www.rakathon.cz/)
hackathon for challenge 2, set by Fakultní nemocnice Ostrava.

## The problem

Before an MDT meeting, doctors spend a long time looking up information
across a patient's records. CodeBridge reads the available documentation
and puts together:

- a short patient summary,
- a timeline of the treatment,
- how lab values changed over time,
- an overview of findings.

It also highlights significant changes, contradictions between documents,
and documents that are missing. Every fact links back to the document it
came from, so a doctor can check it in one click.

> **Zadání (Czech original):** Uvolněte lékařům ruce od zdlouhavého
> dohledávání informací před jednáním multidisciplinárního týmu. Vytvořte
> AI asistenta, který z dostupné dokumentace sestaví stručné shrnutí
> pacienta, časovou osu léčby, vývoj laboratorních hodnot a přehled
> nálezů. Současně zvýrazní zásadní změny, rozpory a chybějící podklady.

## Status

Kickoff. The tech stack is not chosen yet; this section will hold the
setup and run instructions once it is.

## API Worker

`api/` is a Cloudflare Worker (TypeScript, Hono) that serves the built
mock v3 as static files and the API under `/api`. Details, secrets and
the Access runbook are in [`api/AGENTS.md`](api/AGENTS.md).

```
cd api
npm ci
cp .dev.vars.example .dev.vars   # fill in keys; gitignored
npm run dev                      # stages mocks/ into .assets, serves http://localhost:8787
npm run typecheck                # tsc on src and tests
npm test                         # Vitest inside workerd
```

CI (`.github/workflows/deploy-worker.yml`) runs the type check and tests,
then deploys `main` to production and `backend` to the `backend` preview
alias.

On the Worker every change in the page (status, calendar, conclusion,
approval, tasks, edits, alerts, attendance, new patient, staff) goes
through the write API, which enforces the rules and writes the audit
log. The data is shared by every visitor; the administrator restores
the seed with "Obnovit ukázková data" in
Administrace (`POST /api/admin/reset-demo`, on when
`DEMO_RESET_ENABLED=true`). See [`api/AGENTS.md`](api/AGENTS.md).

## Document pipeline

`pipeline/` holds the deterministic page logic (render, Tesseract, the
"ověřit" marks, the readability check, the lab parser) as one Python
package, used by `scripts/` and by the PageKit service the API Worker
calls. Run its tests with `cd pipeline && uv run pytest -q`; run the
service with `uv run python container/server.py --port 8080`. How the
Worker uses it and the end-to-end check: `api/AGENTS.md`, section
"Uploads, intake and the document pipeline".

## Patient data

This repository never contains real patient data. `data/` holds the
synthetic challenge data from the organizers. Put anything real in
`private/`, which git ignores and which AI agents are blocked from
reading. See [`CLAUDE.md`](CLAUDE.md) for the
full rules.

## UI mocks

Clickable mocks of the app are in [`mocks/`](mocks/README.md); open
`mocks/v2.html` in a browser. The product design behind them is in
[`docs/design/PRODUCT.md`](docs/design/PRODUCT.md).

## Working with AI agents

The team uses AI coding agents. Their operating rules are in
[`CLAUDE.md`](CLAUDE.md) (read by Claude Code) and
[`AGENTS.md`](AGENTS.md) (for other tools). Background on the challenge
and the domain is in [`docs/agent/INDEX.md`](docs/agent/INDEX.md).

## Team

- Juro Oravec ([@JuroOravec](https://github.com/JuroOravec))
