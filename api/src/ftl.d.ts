// The Fluent catalogs (i18n/<lang>/*.ftl) are imported as text (wrangler.jsonc "rules").
declare module "*.ftl" {
  const text: string;
  export default text;
}
