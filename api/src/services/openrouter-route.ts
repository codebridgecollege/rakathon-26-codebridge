// The routing block every OpenRouter request carries (`provider` in the request body). Without it OpenRouter may pick
// any provider of the model, also outside the EU, and fall back to another one when the first is busy. So the endpoint
// is named exactly, a fallback is refused, and only providers that neither train on the data nor keep it are allowed.
// An endpoint that cannot serve the request answers an error; it never turns into a different endpoint.
export function pinnedRoute(endpoint: string) {
  return { only: [endpoint], allow_fallbacks: false, data_collection: "deny", zdr: true };
}
