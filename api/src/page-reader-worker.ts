// The page reader's own Worker, `codebridge-page-reader` (api/page-reader.wrangler.jsonc): it only hosts the PageReader
// container class. The API Worker binds the class from here (durable_objects.bindings[].script_name) instead of
// defining it, because a Worker that defines a Durable Object class gets no preview URLs and refuses
// `wrangler versions upload` while a class migration is pending, and the `backend` branch deploys as a preview alias.
// Nothing calls this Worker over HTTP; every request reaches the container through the binding.
export { PageReader } from "./services/page-reader-container";

export default {
  fetch: () => new Response(null, { status: 404 }),
};
