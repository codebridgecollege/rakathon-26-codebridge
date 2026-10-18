// Vite's ?raw import of the Fluent catalogs (i18n/*.ftl) gives their text.
declare module "*.ftl?raw" {
  const source: string;
  export default source;
}
