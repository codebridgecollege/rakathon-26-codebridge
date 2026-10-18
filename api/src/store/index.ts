import { D1Audit, D1Cases, D1Directory } from "./d1";
import { R2Blobs } from "./r2";
import type { Stores } from "./types";

// Stores are made per request for the org the request acts in; nothing in them can reach another org's rows.
export type StoreFactory = (env: Env, org: string) => Stores;

const d1r2: StoreFactory = (env, org) => ({
  org,
  dir: new D1Directory(env.DB, org),
  cases: new D1Cases(env.DB, org),
  audit: new D1Audit(env.DB, org),
  blobs: new R2Blobs(env.DOCS),
});

let factory: StoreFactory = d1r2;

export const makeStores = (env: Env, org: string): Stores => factory(env, org);

// Tests swap in a store that fails (for example an audit insert that throws) to prove a route returns nothing then.
export function setStoreFactory(f: StoreFactory | null) {
  factory = f ?? d1r2;
}
