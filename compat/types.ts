/**
 * The compat table's types.
 *
 * A capability is the only thing a plugin-facing contract is allowed to name: one
 * neutral string, plus the **roles** it promises. A role is a neutral word for a
 * thing the capability can do («http.registerRoute»), never a kernel identifier
 * («webServer.register») — the kernel member a role currently binds to is data in
 * a per-kernel section and nowhere else. A table can therefore move a role to a
 * different member, or to a different service, without any code changing.
 *
 * The table cannot express behaviour. A row records a binding, a mapping, or a
 * refusal; there is no field in which "and also retry", "and also drop the field"
 * or "and also read the computed style" could be written down.
 */

/** The three dispositions. There is no fourth, and no "unknown". */
export type Disposition = 'resolve' | 'translate' | 'refuse'

/**
 * The two kinds of refusal, counted separately.
 *
 * «semantic-changed»: the name is on both kernels and means something different.
 * This is the product, and only this kind counts toward the refusal requirement.
 * «absent»: the name is not on this kernel at all. That is not evidence of a
 * semantic change, so it is never allowed to stand in for one.
 */
export type RefusalClass = 'semantic-changed' | 'absent'

/**
 * How a capability reaches the kernel.
 *
 * «passthrough» binds its roles to members of services this kernel has;
 * «service-rename» maps an old service name onto the name this kernel uses;
 * «field-rename» maps one key of a row read from this kernel onto the key the role
 * promises; «carrier-relocation» marks a value that kept its bytes and changed the
 * document that carries it.
 */
export type CapabilityKind = 'passthrough' | 'service-rename' | 'field-rename' | 'carrier-relocation'

/**
 * One role, bound to one kernel member on this kernel.
 *
 * The role name is frozen by the vocabulary; the member is this kernel's fact. A
 * member that moved is a new binding, not a new role.
 */
export interface RoleBinding {
  /** Frozen role name, «<root>.<roleWord>». */
  role: string
  /** The kernel member this role binds to here; a method name on «service». */
  member: string
}

/** One kernel-side service a capability resolves against on this kernel. */
export interface CompatTarget {
  /** The kernel's own service name in this version section. */
  service: string
  /** The roles served by this service, each bound to one of its members. */
  binds: RoleBinding[]
  /** Where that was measured: a line in the archived surface document, or a file:line. */
  evidence: string
}

/** What moved, for a translating capability. */
export interface CompatTranslation {
  /** The name or carrier on the kernel the caller was written against. */
  from: string
  /** The name or carrier on this kernel. */
  to: string
}

/** A capability this kernel can honour. */
export interface CapabilityRow {
  disposition: 'resolve' | 'translate'
  kind: CapabilityKind
  /** Every role this capability promises, by its frozen name. */
  roles: string[]
  /** Empty only for a capability the loader provides itself («self: true»). */
  targets: CompatTarget[]
  /** Present exactly when the capability translates; absent for a passthrough row. */
  translation?: CompatTranslation
  /** True for a capability whose implementation is this loader, not the kernel. */
  self?: boolean
  /** Package expected to provide a «self» capability. */
  providedBy?: string
  /** Concrete alternative reported when the row cannot be honoured on this kernel. */
  suggestion?: string
  /** Where the row's disposition was decided. */
  evidence: string
}

/**
 * One checkable claim about a kernel's surface.
 *
 * A refusal is only as good as the fact it rests on, so each one carries the fact
 * as a predicate the surface document can be asked. When a predicate stops
 * holding, the refusal is stale and must be re-decided — that is the whole point
 * of writing them down rather than describing them in prose.
 */
export type Witness = (
  | { claim: 'service-present'; service: string }
  | { claim: 'service-absent'; service: string }
  | { claim: 'member-present'; service: string; member: string }
  | { claim: 'member-absent'; service: string; member: string }
  /** No member of the service matches the regular expression. */
  | { claim: 'member-matching-absent'; service: string; pattern: string }
) & { because: string }

/**
 * One kernel-side fact, as a line a reader can open.
 *
 * «path» is relative to that kernel's root, so the same sentence is true on any
 * machine: the earlier-side paths resolve against the earlier checkout, the
 * this-side paths against the pinned checkout.
 */
export interface WitnessedFact {
  /** The kernel the line was read from, e.g. «0.1.1-rc.2». */
  kernel: string
  /** Path relative to that kernel's root. */
  path: string
  /** 1-based line number. */
  line: number
  /** Text that must be on that line. */
  contains: string
  /** What the line shows. */
  fact: string
}

/**
 * The assertion that makes a refusal falsifiable: it names the token whose
 * introduction *is* the change, the line that must carry it here, and the file
 * that must not carry it on the earlier kernel. Flip either side of that pair and
 * the check fails, so "we refuse this because the semantics changed" cannot sit
 * there unverified.
 */
export interface Discriminator {
  /** The token that appeared with the change. */
  introduced: string
  /** This kernel's line that must contain it. */
  presentAt: { path: string; line: number }
  /**
   * Earlier kernel's file that must not contain the token. That file must itself
   * exist: a path that is not there proves "we looked in the wrong place", never
   * "the earlier kernel did not have it".
   */
  absentIn: string
  /**
   * Additionally require the token to appear nowhere in the earlier checkout. This
   * turns "that one file lacks it" into "the kernel lacked the mechanism", and it
   * is checked by scanning the earlier tree.
   */
  absentEverywhere?: boolean
  /** What the pair proves. */
  note: string
}

/** A capability this kernel must refuse. */
export interface RefusalRow {
  disposition: 'refuse'
  /** Which kind of refusal this is; only «semantic-changed» counts as the product. */
  class: RefusalClass
  /** Why a translation would produce a plugin that loads and then behaves wrongly. */
  reason: string
  /** The concrete alternative a caller can take instead. */
  suggestion: string
  /** This kernel's own evidence for the refusal, as prose for a reader. */
  evidence: string
  /**
   * The same evidence as paths, so a gate can check that the documents a refusal
   * cites are still there. Prose is documentation; these are the checked claims.
   */
  evidenceRefs?: { path: string; line?: number; contains?: string }[]
  /** Required for «semantic-changed»: the earlier kernel's line showing the old semantics. */
  wasThere?: WitnessedFact
  /** Required for «semantic-changed»: this kernel's line showing the changed semantics. */
  changedAt?: WitnessedFact
  /** Required for «semantic-changed»: the assertion that fails if the pair stops describing a change. */
  discriminator?: Discriminator
  /** Every claim must hold; a claim that stops holding makes the refusal stale. */
  witness: Witness[]
}

/** The archived surface document a section was written from, and its content hash. */
export interface SurfaceBinding {
  /** Repository-relative path of the archived document. */
  file: string
  /** SHA-256 of that file's bytes. */
  sha256: string
  /**
   * What the archived document says the composition was. A surface is a snapshot of a
   * kernel AND the plugin set mounted into it, so mounting one more plugin changes it
   * without changing the kernel. Optional so a section may bind by hash alone; the
   * sections that carry it assert their counts explicitly.
   */
  composition?: {
    declaredProperties: number
    reachableServices: number
    events: number
  }
}

/** One kernel's table. Keyed by exact identity: no ranges, no nearest-lower fallback. */
export interface CompatTable {
  /** Kernel identity the table is keyed by, e.g. «dsh-v0.2.1-alpha.1». */
  kernel: string
  /** The same kernel as its own manifest states the version, e.g. «0.2.1-alpha.1». */
  packageVersion: string
  /** Commit the kernel is pinned at, when it is known. */
  commit: string | null
  /** The earlier kernel every refusal's «wasThere» side was read from. */
  previousKernel: string
  /** The archived surface document this section describes, bound by hash. */
  surface: SurfaceBinding
  /**
   * The neutral word roots a capability name may start with. Enforced as a table
   * invariant so a kernel service name can never become a capability name.
   */
  roots: string[]
  /** Capabilities this kernel honours, by capability name. */
  capabilities: Record<string, CapabilityRow>
  /** Capabilities this kernel must refuse, by capability name. */
  refused: Record<string, RefusalRow>
  /** What this section of the table was written from. */
  notes: string
}
