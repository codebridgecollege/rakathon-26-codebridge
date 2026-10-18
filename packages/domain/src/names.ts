// How a person's name is shown everywhere: "<titul před> <příjmení>, <titul za>", as staffName() in the page. Shared,
// so the user picker in the browser and the server's names (attendance, assignments) can never differ.
export function staffName(x: { pre: string; sur: string; post: string }): string {
  const base = [x.pre, x.sur].map((s) => (s || "").trim()).filter(Boolean).join(" ");
  return (x.post || "").trim() ? `${base}, ${x.post.trim()}` : base;
}
