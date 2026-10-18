import { checkServer, resetDemo } from "./reset";

// Fails fast with a readable message when no Worker runs at the base URL, instead of 60 tests timing out one by one.
export default async function globalSetup(): Promise<void> {
  const base = process.env.E2E_BASE_URL ?? "http://localhost:8787";
  await checkServer(base);
  await resetDemo(base);
}
