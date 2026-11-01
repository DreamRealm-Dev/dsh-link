/**
 * Ambient declaration for the strict plugin gate (R488).
 *
 * Stylesheet imports are text in this repository: plugins/build.mjs loads `*.css`
 * with esbuild's text loader, so the module's default export is the file content,
 * not a class-name map. The gate must see that same value type or every CSS import
 * looks like an error the build does not have.
 */
declare module '*.css' {
  const content: string
  export default content
}
