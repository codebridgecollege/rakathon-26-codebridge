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

The demo is the Nuxt app (`app/`), served with its data by the API Worker
(`api/`) at `/`. The setup and run instructions are below.

## Repository layout (npm workspaces)

The root `package.json` holds npm workspaces with one lockfile:

- `api/`: the API Worker (below);
- `app/`: the Nuxt frontend, served by the Worker at `/` ([`app/README.md`](app/README.md));
- `packages/domain`: the pure case rules shared by the Worker and the app ([`packages/domain/README.md`](packages/domain/README.md));
- `packages/api-client`: the typed browser client for the API;
- `i18n/`: the Fluent catalogs (`i18n/<locale>/<area>.ftl`; Czech is the source).

```
npm ci              # at the root
npm run typecheck   # every workspace
npm test            # every workspace (the api tests run inside workerd)
```

## API Worker

`api/` is a Cloudflare Worker (TypeScript, Hono) that serves the built
app as static files, the API under `/api` and the login under `/auth`
(OIDC with Zitadel, EU; [`docs/design/AUTH.md`](docs/design/AUTH.md)).
Details, secrets and the login runbook are in [`api/AGENTS.md`](api/AGENTS.md).

```
cd api
npm ci                           # installs api's workspace dependencies from the root lockfile
cp .dev.vars.example .dev.vars   # fill in keys; gitignored
npm run dev                      # builds the app, stages it into .assets, serves http://localhost:8787 (user picker, no login)
npm run dev:oidc                 # the same with the login; OIDC_CLIENT_SECRET and SESSION_KEY in .dev.vars
npm run typecheck                # tsc on src and tests
npm test                         # Vitest inside workerd
```

CI (`.github/workflows/deploy-worker.yml`) runs the type check and tests,
then deploys `main` to production and `backend` to the `backend` preview
alias.

Every change in the app (status, calendar, conclusion,
approval, tasks, edits, alerts, attendance, new patient, staff) goes
through the write API, which enforces the rules and writes the audit
log. The deployed hosts ask for a login with one of the demo accounts
(passwords in the team's password manager); after logging in once, a
presenter switches role in the account menu. The data of a demo org is
shared by everyone in it; its administrator restores
the seed with "Obnovit ukázková data" in
Administrace (`POST /api/admin/reset-demo`, on when
`DEMO_RESET_ENABLED=true`). See [`api/AGENTS.md`](api/AGENTS.md).

## End-to-end tests

`e2e/` is a Playwright suite that drives the app only through what a user sees (roles, labels, Czech text) against
a running Worker. With the local demo seeded and running in `api/`
(`cp .dev.vars.example .dev.vars`, `npm run seed:local`, `npm run dev`):

```
npm --prefix e2e ci && npm --prefix e2e run install-browsers   # once
npm --prefix e2e test                                           # resets the local demo before every test
```

Or without a running Worker: after `npm --prefix api run stage`, `npm --prefix e2e run test:parallel` seeds a copy of
the demo for each of four local Workers, runs the suite on all four at once and stops them (about 35 s instead of
90 s; the first run seeds for about 1.5 minutes). CI runs it this way on every push to main and every pull request,
and main deploys only when it passes. Details, the deployed-Worker variant and the coverage table:
[`e2e/README.md`](e2e/README.md).

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

## Demo data and product design

The prepared demo data the seed loads, and the scripts that built it, are in
[`fixtures/`](fixtures/README.md). The product design is in
[`docs/design/PRODUCT.md`](docs/design/PRODUCT.md).

## Working with AI agents

The team uses AI coding agents. Their operating rules are in
[`CLAUDE.md`](CLAUDE.md) (read by Claude Code) and
[`AGENTS.md`](AGENTS.md) (for other tools). Background on the challenge
and the domain is in [`docs/agent/INDEX.md`](docs/agent/INDEX.md).

## Team

- Juro Oravec ([@JuroOravec](https://github.com/JuroOravec))
