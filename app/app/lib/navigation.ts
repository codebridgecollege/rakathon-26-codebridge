// How a case was reached, for the access log: by a click inside the app, or by a link, a reload or the browser's back
// and forward ("otevřel(a) případ (odkazem nebo historií prohlížeče)"). The first route
// of a page load and a route reached by popstate count as "by link or history". plugins/navigation.ts feeds it.
let routes = 0;
let popped = false;
let lastWasPop = false;

export function notePopstate(): void {
  popped = true;
}

// Called after every completed navigation.
export function noteNavigation(): void {
  routes++;
  lastWasPop = popped;
  popped = false;
}

// Read once per case opening: true when this opening came from a link, a reload or the browser history.
export function consumeViaLink(): boolean {
  const via = routes <= 1 || lastWasPop;
  lastWasPop = false;
  return via;
}
