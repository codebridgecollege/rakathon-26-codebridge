// The Worker's clock and ID source. Kept out of @codebridge/domain, which stays free of runtime globals so the browser
// and the Worker load the same file.
import type { Clock } from "@codebridge/domain/time";

export const systemClock: Clock = { now: () => new Date(), id: () => crypto.randomUUID() };
