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
