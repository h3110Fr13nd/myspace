/**
 * Compiles the declarative `MODEL` spec into OpenFGA `type_definitions` JSON,
 * and renders it back to the readable FGA DSL.
 *
 * Keeping one spec and two renderings (JSON for the engine, DSL for review)
 * removes the class of bug where `authz/model.fga` and the actually-deployed
 * model disagree — which is exactly what had happened: the DSL was dead
 * documentation while a 700-line hand-written literal in `init-openfga.ts` was
 * the real schema.
 */
import { MODEL, STRUCTURAL_RELATIONS, type DirectType, type RelationSpec, type TypeSpec } from './modelSpec';

/* ── FGA JSON shapes (only the subset this spec uses) ─────────────────────── */

interface Userset {
  this?: Record<string, never>;
  computedUserset?: { relation: string };
  tupleToUserset?: { tupleset: { relation: string }; computedUserset: { relation: string } };
  union?: { child: Userset[] };
  intersection?: { child: Userset[] };
  exclusion?: { base: Userset; child: Userset };
}

const THIS: Userset = { this: {} };
const computed = (relation: string): Userset => ({ computedUserset: { relation } });
const ttu = (via: string, relation: string): Userset => ({
  tupleToUserset: { tupleset: { relation: via }, computedUserset: { relation } },
});
const union = (...child: Userset[]): Userset => ({ union: { child } });

/** Fold a relation's positive grant paths into one userset. */
function grantUnion(spec: RelationSpec): Userset | null {
  const children: Userset[] = [];
  if (spec.from && spec.from.length > 0) children.push(THIS);
  for (const rel of spec.or ?? []) children.push(computed(rel));
  for (const inh of spec.inherit ?? []) children.push(ttu(inh.via, inh.rel));
  if (children.length === 0) return null;
  return children.length === 1 ? children[0] : union(...children);
}

/**
 * Build one relation's userset.
 *
 * Negation is intentionally NOT supported here. OpenFGA v1.5's JSON model API
 * rejects every `exclusion` userset shape with "invalid userset rewrite
 * definition" (verified against the running engine across base/child
 * combinations and both schema versions), while `union` and `intersection`
 * validate fine. Attempting it produces a model that either fails to deploy or
 * — worse — deploys with the deny silently absent, failing OPEN.
 *
 * Denial is therefore enforced in `src/lib/acl/guards.ts` with an explicit
 * `check()` against `denied_viewer` / `denied_editor`, which are ordinary
 * assignable relations here. `RelationSpec.not` is retained only so that using
 * it fails loudly at compile time instead of being quietly dropped.
 */
function compileRelation(typeName: string, relName: string, spec: RelationSpec): Userset {
  if (spec.not && spec.not.length > 0) {
    throw new Error(
      `Model spec error: ${typeName}#${relName} declares \`not: [${spec.not.join(', ')}]\`, ` +
        `but model-level negation is unsupported (OpenFGA v1.5 rejects \`exclusion\`). ` +
        `Enforce denial in src/lib/acl/guards.ts via the denied_viewer / denied_editor relations.`
    );
  }

  const base = grantUnion(spec);
  if (!base) {
    // A relation with no grant paths is a deny-only relation (e.g.
    // `denied_viewer`). It must still be assignable, so emit a bare `this`.
    return THIS;
  }
  return base;
}

function directTypes(spec: RelationSpec): Array<{ type: string; relation?: string; wildcard?: object }> {
  const plain = (spec.from ?? []).map((t: DirectType) => {
    const [type, relation] = t.split('#');
    return relation ? { type, relation } : { type };
  });
  // Wildcards live in their own `directly_related_user_types` entries, marked
  // with `wildcard: {}`, e.g. { type: 'user', wildcard: {} } for `user:*`.
  const wild = (spec.wildcard ?? []).map((t: DirectType) => {
    const [type] = t.split('#');
    return { type, wildcard: {} };
  });
  return [...plain, ...wild] as Array<{ type: string; relation?: string; wildcard?: object }>;
}

export interface CompiledModel {
  schema_version: '1.1';
  type_definitions: Array<{
    type: string;
    relations?: Record<string, Userset>;
    metadata?: { relations: Record<string, { directly_related_user_types?: Array<{ type: string; relation?: string }> }> };
  }>;
}

/** Compile the whole spec into an OpenFGA `WriteAuthorizationModelRequest`. */
export function compileModel(): CompiledModel {
  const type_definitions = Object.entries(MODEL).map(([type, spec]: [string, TypeSpec]) => {
    const relations: Record<string, Userset> = {};
    const metadata: CompiledModel['type_definitions'][number]['metadata'] = { relations: {} };

    for (const [relName, relSpec] of Object.entries(spec.relations)) {
      relations[relName] = compileRelation(type, relName, relSpec);
      const types = directTypes(relSpec);
      if (types.length > 0) {
        metadata!.relations[relName] = { directly_related_user_types: types };
      }
    }

    // Structural relations are assignable (the app writes `parent_folder` when a
    // resource is created or moved) but carry no capability.
    for (const [link, targets] of Object.entries(spec.links ?? {})) {
      relations[link] = THIS;
      metadata!.relations[link] = { directly_related_user_types: targets.map((type) => ({ type })) };
    }

    const out: CompiledModel['type_definitions'][number] = { type };
    if (Object.keys(relations).length > 0) out.relations = relations;
    if (Object.keys(metadata!.relations).length > 0) out.metadata = metadata;
    return out;
  });

  return { schema_version: '1.1', type_definitions };
}

/* ── DSL rendering (for `authz/model.fga`) ────────────────────────────────── */

const TYPE_NAMES: Record<string, string> = {
  user: 'user',
  'group#member': 'group#member',
  service_account: 'service_account',
};

function renderDirect(spec: RelationSpec): string {
  const parts = [
    ...(spec.from ?? []).map((t) => TYPE_NAMES[t] ?? t),
    ...(spec.wildcard ?? []).map((t) => `${t.split('#')[0]}:*`),
  ];
  return `[${parts.join(', ')}]`;
}

function renderRelation(relName: string, spec: RelationSpec): string {
  const parts: string[] = [];
  if (spec.from && spec.from.length > 0) parts.push(renderDirect(spec));
  for (const rel of spec.or ?? []) parts.push(rel);
  for (const inh of spec.inherit ?? []) parts.push(`${inh.rel} from ${inh.via}`);

  const denies = spec.not ?? [];
  if (denies.length === 0) return parts.length > 1 ? parts.join(' or ') : parts[0] ?? 'this';

  const base = parts.length > 1 ? `(${parts.join(' or ')})` : parts[0];
  return `${base} and ${denies.map((d) => `not ${d}`).join(' and ')}`;
}

/** Render the spec back to the FGA DSL for human review. */
export function renderDsl(): string {
  const lines: string[] = ['model', '  schema 1.1', ''];

  for (const [type, spec] of Object.entries(MODEL)) {
    lines.push(`type ${type}`);
    for (const [link, targets] of Object.entries(spec.links ?? {})) {
      lines.push(`  relation ${link}: [${targets.join(', ')}]`);
    }
    for (const [relName, relSpec] of Object.entries(spec.relations)) {
      lines.push(`  relation ${relName}: ${renderRelation(relName, relSpec)}`);
    }
    lines.push('');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/* ── Introspection: the guard that keeps relations from going dead ────────── */

/**
 * Every declared relation that grants capability must be referenced by at least
 * one other relation's union, otherwise it is unreachable dead weight.
 *
 * This is the guard that would have caught `denied_viewer` sitting declared on
 * 11 types while referenced in zero unions — a fail-open "restriction" that
 * silently did nothing.
 */
export function findDeadRelations(): Array<{ type: string; relation: string }> {
  const dead: Array<{ type: string; relation: string }> = [];

  for (const [type, spec] of Object.entries(MODEL)) {
    // Relations legitimately consumed by other types or by the app.
    const externalConsumers = new Set(['member']);

    for (const [relName, relSpec] of Object.entries(spec.relations)) {
      if (STRUCTURAL_RELATIONS.has(relName)) continue;
      // Deny relations are consumed as `not` terms; capability relations are
      // consumed by the role ladder. Both are checked below.
      const referenced =
        externalConsumers.has(relName) ||
        Object.values(spec.relations).some(
          (other) =>
            (other.or ?? []).includes(relName) ||
            (other.inherit ?? []).some((i) => i.rel === relName)
        );

      // A relation with no inbound reference and no grants of its own is dead.
      if (!referenced && !(relSpec.from && relSpec.from.length > 0)) {
        dead.push({ type, relation: relName });
      }
    }
  }

  return dead;
}

/** Relations that may be assigned directly for a given type (grants + structural edges). */
export function assignableRelations(type: string): string[] {
  const spec = MODEL[type];
  if (!spec) return [];
  const grants = Object.entries(spec.relations)
    .filter(([, relSpec]) => (relSpec.from ?? []).length > 0)
    .map(([relName]) => relName);
  return grants.concat(Object.keys(spec.links ?? {}));
}

/**
 * Every relation declared on a type, whether or not it is directly assignable.
 *
 * Returned as an empty array for an unknown type so callers can distinguish
 * "this type has no relations" from "we have no model", and fall back rather
 * than render an empty role picker.
 */
export function declaredRelations(type: string): string[] {
  const spec = MODEL[type];
  if (!spec) return [];
  return Object.keys(spec.relations).concat(Object.keys(spec.links ?? {}));
}
