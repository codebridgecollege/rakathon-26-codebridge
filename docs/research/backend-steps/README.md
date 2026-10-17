# Backend migration: implementation designs per step

One design per step of the plan in
[`../2026-10-17-backend-migration.md`](../2026-10-17-backend-migration.md).
Each was written by a separate research agent on 2026-10-17 against the code
at that date, and each is tracked as a GitHub issue. Line numbers in the
designs refer to `mocks/src/v3-template.html` at that time and drift as the
code changes.

| Step | Design | What |
|---|---|---|
| 0, 1 | [step-0-1.md](step-0-1.md) | Speech key off the page; Worker with static assets and the API foundation |
| 2 | [step-2.md](step-2.md) | D1 schema, seed, read API, frontend loader |
| 3 | [step-3.md](step-3.md) | Per-case data in the frontend (any case can be fully shown) |
| 4 | [step-4.md](step-4.md) | Write API with server-side rules and audit; reset demo |
| 5 | [step-5.md](step-5.md) | Long jobs as Workflows: speaker pass, summary, prognosis |
| 6 | [step-6.md](step-6.md) | Uploads to R2; the document processing pipeline |
