/** esbuild's text loader hands stylesheets to the bundle as strings. */
declare module '*.css' {
  const css: string
  export default css
}
