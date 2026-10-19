// The page reader as a Cloudflare Container (step 6): the Durable Object class behind the PAGE_READER binding. Each
// named instance (poolInstance in page-reader.ts) starts one container from pipeline/container/Dockerfile, built by
// `wrangler deploy` in CI and placed in the EU (wrangler.jsonc, containers.constraints.jurisdiction).
import { Container } from "@cloudflare/containers";

export class PageReader extends Container<Env> {
  // server.py listens on 8080 (Dockerfile EXPOSE).
  defaultPort = 8080;
  // Long enough to cover a seven-file intake and a demo after it, short enough not to keep an idle instance running
  // overnight.
  sleepAfter = "15m";
  // The page reader needs no outbound network (server.py holds no secrets and calls nothing); with it off, a document
  // inside the container cannot leave it even if the code had a bug.
  enableInternet = false;
}
