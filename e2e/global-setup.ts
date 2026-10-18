import { checkServer, resetDemo } from "./reset";
import { BASE_URLS } from "./servers";

// Fails fast with a readable message when a Worker does not answer, instead of 60 tests timing out one by one.
export default async function globalSetup(): Promise<void> {
  for (const base of BASE_URLS) {
    await checkServer(base);
    await resetDemo(base);
  }
}
