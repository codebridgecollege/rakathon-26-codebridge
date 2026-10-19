// One API client for the whole app, so the demo user and the data epoch are held in one place.
// Tests replace it with setApi() and a client over a mocked fetch.
import { createApiClient, type ApiClient } from "@codebridge/api-client";

type LoginInfo = { sentAt: number; method: string };

let client: ApiClient | null = null;
let resetHandler: () => void = () => {};
let changedHandler: () => void = () => {};
let loginHandler: (info: LoginInfo) => Promise<boolean> = async () => false;

export function useApi(): ApiClient {
  if (!client) client = createApiClient({ onDataReset: () => resetHandler(), onUnauthenticated: loginLost, onSessionChanged: sessionChanged });
  return client;
}

export function setApi(c: ApiClient | null): void {
  client = c;
}

// The session store decides what a data reset does (a message, then a reload); the client only reports it.
export function onDataReset(fn: () => void): void {
  resetHandler = fn;
}

// The session store decides what a lost login does (the login page, or the "Přihlášení vypršelo" dialog while
// something is unsaved) and whether the refused request goes out again.
export function onUnauthenticated(fn: (info: LoginInfo) => Promise<boolean>): void {
  loginHandler = fn;
}

// The session store decides what a session changed in another tab does (a message, then a reload).
export function onSessionChanged(fn: () => void): void {
  changedHandler = fn;
}

// What the client calls on a 401 and on a 409 session_changed; tests pass them to the client they build over a
// mocked fetch.
export const loginLost = (info: LoginInfo) => loginHandler(info);
export const sessionChanged = () => changedHandler();
