// Standard Czech clinical abbreviations for reading the brief at a glance (Soňa, 2026-11-05: "stav po" as "st.p."). For
// display only: the stored brief, the source passages and the report keep the full wording. The list stays short on
// purpose: connecting words and common terms a clinician reads without thinking. Other disease names are not on it, and no entry touches a digit, a date or a negation word.
const RULES: [RegExp, string][] = [
  // The diseases and drug groups a doctor always says short (Soňa, 2026-11-06). "HN" stays out: she did not recognise it.
  [/(?<![\p{L}])chronick(?:á|é|ou) obstrukční plicní nemoc(?:i|í)?(?![\p{L}])/giu, "CHOPN"],
  [/(?<![\p{L}])podezření na intersticiální plicní (?:postižení|proces)(?![\p{L}])/giu, "susp. IPP"],
  [/(?<![\p{L}])intersticiální plicní (?:postižení|proces)(?![\p{L}])/giu, "IPP"],
  [/(?<![\p{L}])(?:ACE inhibitor(?:y|ů|ech)?|inhibitor(?:y|ů|ech)? ACE)(?![\p{L}])/gu, "ACEi"],
  // Only "stav po": "zhoršení stavu po chemoterapii" says something else, and "ústavu po" is another word.
  [/(?<![\p{L}])stav po(?![\p{L}])/giu, "st.p."],
  [/(?<![\p{L}])lymfatick(?:á|é|ou|ých|ým|ými) uzlin(?:a|y|u|ou|ách|ám|ami)?(?![\p{L}])/giu, "LU"],
  // "pN1, 3 z 5 LU pozitivní" is said "pN1 (3/5)": everyone knows the numbers are nodes. Runs after the LU rule above.
  [/(pN[0-9a-z]+), (\d+) z (\d+) LU(?: pozitivní(?:ch)?)?(?![\p{L}])/giu, "$1 ($2/$3)"],
  [/(?<![\p{L}])metastatick(?:ý|á|é|ého|ému|ém|ým|ých|ými|ou)(?![\p{L}])/giu, "meta"],
  [/(?<![\p{L}])metastáz(?:a|y|u|ou|e|ám|ách|ami)?(?![\p{L}])/giu, "meta"],
  // Not before a number: "Reziduum ca 12 mm" would read as "about 12 mm". "adenokarcinom" stays whole.
  [/(?<![\p{L}])karcinom(?:u|em|y|ů|ech|ům)?(?![\p{L}])(?!\s*\d)/giu, "ca"],
  [/(?<![\p{L}])histologicky(?![\p{L}])/giu, "hist."],
  [/(?<![\p{L}])suspektní(?![\p{L}])/giu, "susp."],
  [/(?<![\p{L}])vpravo(?![\p{L}])/giu, "l. dx."],
  [/(?<![\p{L}])vlevo(?![\p{L}])/giu, "l. sin."],
  [/(?<![\p{L}])chemoterapi(?:e|i|í|ií)(?![\p{L}])/giu, "CHT"],
  [/(?<![\p{L}])radioterapi(?:e|i|í|ií)(?![\p{L}])/giu, "RT"],
  [/(?<![\p{L}])léčb(?:a|y|u|ě|ou)(?![\p{L}])/giu, "th."],
  [/(?<![\p{L}])diagnóz(?:a|y|u|e|ou)(?![\p{L}])/giu, "dg."],
  [/(?<![\p{L}])magnetick(?:á|é|ou) rezonanc(?:e|i)(?![\p{L}])/giu, "MR"],
  [/(?<![\p{L}])intrakraniálně(?![\p{L}])/giu, "i.c."],
  [/(?<![\p{L}])neurochirurgick(?:ý|á|é|ého|ém|ým|ou)(?![\p{L}])/giu, "NCH"],
  [/(?<![\p{L}])anamnesticky(?![\p{L}])/giu, "anamn."],
];

export function abbreviateCs(text: string): string {
  let out = text;
  for (const [re, short] of RULES) out = short.includes("$") ? out.replace(re, short) : out.replace(re, (m) => (!short.startsWith("susp") && short[0] === short[0]!.toLowerCase() && m[0] === m[0]!.toUpperCase() ? short[0]!.toUpperCase() + short.slice(1) : short));
  return out;
}
