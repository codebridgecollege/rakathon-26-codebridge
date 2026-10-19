// Organizations (docs/design/AUTH.md). Migration 0011 put all data written before orgs into demo org A, so a value
// that predates orgs (a Workflow started before the deploy, an R2 key without the org/ prefix) belongs to it.
export const LEGACY_ORG = "demo-a";
