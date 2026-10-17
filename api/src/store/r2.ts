// R2 implementation of the blob store. The bucket is private; objects reach a browser only through a route that
// has checked access and written the audit row.
import type { BlobStore } from "./types";

export class R2Blobs implements BlobStore {
  constructor(private bucket: R2Bucket) {}

  async getJson<T>(key: string): Promise<T | null> {
    const o = await this.bucket.get(key);
    return o ? ((await o.json()) as T) : null;
  }

  async getStream(key: string) {
    const o = await this.bucket.get(key);
    if (!o) return null;
    return { body: o.body, contentType: o.httpMetadata?.contentType || "application/octet-stream" };
  }

  async listKeys(prefix: string) {
    const r = await this.bucket.list({ prefix, limit: 100 });
    return r.objects.map((o) => o.key);
  }
}
