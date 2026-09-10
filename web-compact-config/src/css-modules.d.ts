/**
 * Ambient declaration for the typecheck facade: vendor client sources (e.g.
 * dsh-client-ui-settings-plugins) import CSS modules, which the bundler resolves
 * at build time but plain tsc cannot. Runtime behavior is unaffected.
 *
 * @module web-compact-config/css-modules
 */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
