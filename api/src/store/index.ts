import { D1Audit, D1Cases, D1Directory } from "./d1";
import { R2Blobs } from "./r2";
import type { Stores } from "./types";

export type StoreFactory = (env: Env) => Stores;

const d1r2: StoreFactory = (env) => ({
  dir: new D1Directory(env.DB),
  cases: new D1Cases(env.DB),
  audit: new D1Audit(env.DB),
  blobs: new R2Blobs(env.DOCS),
});

let factory: StoreFactory = d1r2;

export const makeStores = (env: Env): Stores => factory(env);

// Tests swap in a store that fails (for example an audit insert that throws) to prove a route returns nothing then.
export function setStoreFactory(f: StoreFactory | null) {
  factory = f ?? d1r2;
}
