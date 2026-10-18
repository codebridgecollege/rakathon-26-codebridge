// How a person's name is shown everywhere: "<titul před> <příjmení>, <titul za>", as staffName() in the page. Shared,
// so the user picker in the browser and the server's names (attendance, assignments) can never differ.
export function staffName(x: { pre: string; sur: string; post: string }): string {
  const base = [x.pre, x.sur].map((s) => (s || "").trim()).filter(Boolean).join(" ");
  return (x.post || "").trim() ? `${base}, ${x.post.trim()}` : base;
}

// A patient's name as the list shows it, surname first ("Lipenská Věra"): the name as the documents write it when the
// server has one, else the last word moved to the front.
export function surnameFirst(p: { name: string; nameAsWritten?: string | null }): string {
  if (p.nameAsWritten) return p.nameAsWritten;
  if (!p.name.includes(" ")) return p.name;
  const parts = p.name.split(" ");
  return `${parts.slice(-1)[0]} ${parts.slice(0, -1).join(" ")}`;
}
