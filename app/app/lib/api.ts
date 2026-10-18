// One API client for the whole app, so the demo user and the data epoch are held in one place (the template's DATA).
// Tests replace it with setApi() and a client over a mocked fetch.
import { createApiClient, type ApiClient } from "@codebridge/api-client";

let client: ApiClient | null = null;
let resetHandler: () => void = () => {};

export function useApi(): ApiClient {
  if (!client) client = createApiClient({ onDataReset: () => resetHandler() });
  return client;
}

export function setApi(c: ApiClient | null): void {
  client = c;
}

// The session store decides what a data reset does (a message, then a reload); the client only reports it.
export function onDataReset(fn: () => void): void {
  resetHandler = fn;
}
