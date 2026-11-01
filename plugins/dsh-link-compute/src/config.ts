/**
 * Row configuration for the compute core.
 *
 * The defaults are the product decision: **off**. A profile that wants the native core opts in
 * by setting `enabled: true` on the `dsh-link-compute` row (and may pin `nativeEnabled: false`
 * to force the pure-TS reference). Keeping the default off means a default DSH boot loads
 * neither the addon nor a service this row would publish, so nothing about the stock behaviour
 * changes (R485/R486 principle 2).
 */

/** Configuration a profile sets on the dsh-link-compute row. */
export interface ComputeConfig {
  /** Load the compute core at all. @default false */
  readonly enabled: boolean
  /** Allow the napi addon; false forces the pure-TypeScript reference. @default true */
  readonly nativeEnabled: boolean
}

/** The configuration a row gets when it sets nothing. */
export const DEFAULT_CONFIG: ComputeConfig = Object.freeze({
  enabled: false,
  nativeEnabled: true,
})
