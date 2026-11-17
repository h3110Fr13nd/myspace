import { expect, test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Source-level guards for the authorization surface.
 *
 * These exist because the failures they prevent were silent. A leaked ACL, an
 * unguarded endpoint, or a second tuple writer all produce HTTP 200 responses
 * and correct-looking UI, so nothing surfaces them except a deliberate check.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PERMISSIONS_DIR = path.join(ROOT, 'src/pages/api/v1/permissions');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

/** Strip comments so prose about a call is not mistaken for the call itself. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|astro)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test.describe('authentication cannot be bypassed with a header', () => {
  const middleware = read('src/middleware.ts');

  test('the x-user-id header is not trusted on its own', () => {
    // This single line was an unauthenticated privilege escalation: any client
    // could claim to be an owner and write ACL tuples. Verified live, then fixed.
    const readsHeader = /request\.headers\.get\(['"]x-user-id['"]\)/.test(middleware);
    expect(readsHeader).toBe(true);

    // The claim must be gated on a secret, not merely present.
    expect(middleware).toMatch(/x-internal-token/);
    expect(middleware).toMatch(/INTERNAL_SERVICE_TOKEN/);
    expect(middleware).toMatch(/timingSafeEqual/);
  });

  test('the auth block is not duplicated', () => {
    // It used to be assigned twice verbatim, which is how the second copy
    // drifted out of step with the first.
    const assignments = middleware.match(/context\.locals\.user = currentUser;/g) ?? [];
    expect(assignments.length).toBe(1);
  });

  test('the bypass is documented where it was fixed', () => {
    // A silent security fix is one nobody maintains. The reasoning has to be at
    // the point of the change.
    expect(middleware).toContain('bypass');
    expect(middleware).toContain('Verified live');
  });
});

test.describe('every permissions endpoint is guarded', () => {
  const files = fs
    .readdirSync(PERMISSIONS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(PERMISSIONS_DIR, f));

  test('the directory is not empty', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const name = path.basename(file);
    test(`${name} requires authentication`, () => {
      const src = fs.readFileSync(file, 'utf-8');
      // Either it rejects anonymous outright, or it defers to a guard that does.
      const rejectsAnonymous = /ANONYMOUS/.test(src);
      const delegatesToGuard = /require(ReadAcl|ManageGrants)\b/.test(src);
      expect(
        rejectsAnonymous || delegatesToGuard,
        `${name} neither rejects anonymous users nor delegates to a guard`
      ).toBe(true);
    });
  }
});

test.describe('no identity is special-cased by name', () => {
  // `userId` is derived from the email local part at registration, so it is
  // attacker-chosen. A `currentUser === 'user:admin'` comparison therefore let
  // anyone who signed up as dummy_mail bypass the authorization graph:
  // edit on every resource, plus unfiltered search across private and draft
  // documents. Verified live against the running stack before being fixed.
  const files = walk(path.join(ROOT, 'src'));

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const src = stripComments(fs.readFileSync(file, 'utf-8'));
    test(`${rel} does not grant capability by user id`, () => {
      const grantByName =
        /(currentUser|userId|user|actor|sub)\s*===?\s*['"](user:)?(admin|root|superuser|system)['"]/.test(src);
      expect(grantByName, `${rel} compares a user id to a privileged literal`).toBe(false);
    });
  }

  test('workspace administration is an OpenFGA capability', () => {
    const guards = read('src/lib/acl/guards.ts');
    expect(guards).toMatch(/isWorkspaceAdmin/);
    // Anchored on the same root of trust as everything else.
    expect(guards).toMatch(/manage_grants.*space:main|space:main.*manage_grants/s);
  });

  test('ids are minted by the identity module, never derived from the email', () => {
    // The defect this whole migration sequence fixes: `register.ts` used to mint
    // `user:${email.split('@')[0]}`, which produced `user:demo` (678 resources)
    // and `user:researcher` (42), collided across email domains, broke on an
    // email change, and let one human exist as two principals.
    const register = read('src/pages/api/v1/auth/register.ts');
    expect(register).toMatch(/newUserId\(\)/);

    // The assignment itself must never build an id from the email. A naive
    // "no `user:${` anywhere" check is wrong: the reserved-name guard
    // legitimately constructs one to test against the blocklist without ever
    // assigning it, so assert on the assignment instead.
    const assignment = register.match(/const userId = ([^;]+);/);
    expect(assignment, 'could not find the userId assignment').toBeTruthy();
    expect(assignment![1]).toBe('newUserId()');
    expect(assignment![1]).not.toMatch(/email|prefix/);
  });

  test('the identity module owns id minting and the reserved-name policy', () => {
    const ids = read('src/lib/userIds.ts');
    expect(ids).toMatch(/RESERVED_USER_IDS/);
    expect(ids).toMatch(/crypto\.randomUUID/);
    // A minted id is opaque: no email fragment may appear in it.
    expect(ids).toMatch(/^export function newUserId\(\): string \{\s*return `user:\$\{crypto\.randomUUID\(\)\}`;\s*\}/m);
  });

  test('a user account can never occupy the service_account namespace', () => {
    // The load-bearing invariant for service accounts: they own content and
    // cannot authenticate, so a user taking a `service_account:` id could
    // impersonate one. `newUserId` always emits the `user:` prefix.
    const ids = read('src/lib/userIds.ts');
    expect(ids).toMatch(/return `user:\$\{crypto\.randomUUID\(\)\}`;/);
    // And the format is a database constraint, not a code convention.
    const migration = read('migrations/0010_user_id_format_constraint.up.sql');
    expect(migration).toMatch(/users_id_format/);
    expect(migration).toMatch(/\^user:\[0-9a-f\]/);
  });

  test('user ids are immutable once assigned', () => {
    // A principal that can be renamed is a principal whose grants and audit
    // links can be orphaned — which is what the legacy-id mess was.
    const migration = read('migrations/0010_user_id_format_constraint.up.sql');
    expect(migration).toMatch(/forbid_user_id_change/);
    expect(migration).toMatch(/users_id_immutable/);
  });

  test('legacy ids stay resolvable so external references do not hard-fail', () => {
    const ids = read('src/lib/userIds.ts');
    expect(ids).toMatch(/legacy_id/);
    // Resolution accepts an email, a legacy id, or a canonical id.
    expect(ids).toMatch(/resolveUserId/);
  });
});

test.describe('tuple writes have a single owner', () => {
  test('only the acl layer writes tuples', () => {
    // A second writer bypasses the pre-flight that prevents contradictory
    // deny/grant state, and the projection that keeps the read model honest.
    const offenders: string[] = [];
    for (const file of walk(path.join(ROOT, 'src'))) {
      const rel = path.relative(ROOT, file);
      if (rel.startsWith('src/lib/acl/')) continue;
      if (rel.startsWith('src/lib/openfga.ts')) continue; // the low-level primitive
      if (rel.includes('acl/model')) continue;

      const src = stripComments(fs.readFileSync(file, 'utf-8'));
      if (/\b(writeTuple|deleteTuple|writeTuples)\s*\(/.test(src)) offenders.push(rel);
    }
    expect(offenders, `tuple writers outside the acl layer: ${offenders.join(', ')}`).toEqual([]);
  });

  test('tuple reads go through the paginating reader', () => {
    // A bare `fgaClient.read()` returns one page and silently discards the rest.
    const offenders: string[] = [];
    for (const file of walk(path.join(ROOT, 'src'))) {
      const rel = path.relative(ROOT, file);
      if (rel.startsWith('src/lib/acl/reader')) continue;
      if (rel.startsWith('src/lib/openfga.ts')) continue;
      // Health probes read exactly one page on purpose: they are testing that
      // the engine answers, not retrieving data.
      if (rel.endsWith('api/v1/health.ts') || rel.endsWith('api/v1/readyz.ts')) continue;

      const src = stripComments(fs.readFileSync(file, 'utf-8'));
      if (/fgaClient\.read\s*\(/.test(src)) offenders.push(rel);
    }
    expect(offenders, `unpaginated tuple reads: ${offenders.join(', ')}`).toEqual([]);
  });
});

test.describe('the model has a single source of truth', () => {
  test('the deploy script compiles the spec rather than embedding a literal', () => {
    const deploy = read('scripts/deploy-openfga-model.ts');
    expect(deploy).toMatch(/from '\.\.\/src\/lib\/acl\/compileModel'/);
    expect(deploy).toMatch(/compileModel\(\)/);
    // A hand-written `type_definitions` literal is exactly what caused the
    // spec and the deployed model to drift apart.
    expect(deploy).not.toMatch(/directly_related_user_types/);
  });

  test('the readable DSL is generated from the spec', () => {
    const deploy = read('scripts/deploy-openfga-model.ts');
    expect(deploy).toMatch(/renderDsl\(\)/);
    expect(deploy).toMatch(/model\.fga/);
  });

  test('the generated DSL is checked in and current', () => {
    const dsl = read('authz/model.fga');
    // If the spec gains a type and the DSL is not regenerated, this fails.
    expect(dsl).toMatch(/type canvas/);
    expect(dsl).toMatch(/relation read_acl/);
    expect(dsl).toMatch(/relation manage_grants/);
    // `circle` has never existed; asserting its absence keeps it from creeping back.
    expect(dsl).not.toMatch(/^type circle/m);
  });
});

test.describe('explanations cannot disagree with decisions', () => {
  test('the troubleshooter derives its steps from read tuples', () => {
    const src = read('src/pages/api/v1/permissions/troubleshoot.ts');
    expect(src).toMatch(/readTuplesForObject/);
    // Engine-native provenance, replacing the hand-rolled ReBAC walk.
    expect(src).toMatch(/fgaClient\.expand/);
    // A read failure must be reported as a failure, never as "no access found".
    expect(src).toMatch(/type: 'error'/);
    expect(src).toMatch(/readOk = false/);
  });

  test('the hand-rolled circle filter is gone', () => {
    const src = read('src/pages/api/v1/permissions/troubleshoot.ts');
    // Filtering for `circle:` could never match a real tuple, so group-based
    // explanations were permanently unreachable.
    expect(src).not.toMatch(/startsWith\('circle:'\)/);
  });
});

test.describe('an owner is never locked out of their own access list', () => {
  // Ownership was enforced from two places that disagreed: the edit path read
  // `resources.owner_id`, the guard layer read only OpenFGA. 748 of 913 resources
  // had an `owner_id` and no `owner` tuple, so you could open and edit your own
  // sheet, open Share, and be told you could not see who had access — with a 404
  // for a resource that plainly exists.
  const guards = read('src/lib/acl/guards.ts');

  test('the guard layer falls back to the database root of truth', () => {
    expect(guards).toMatch(/isDatabaseOwner/);
    // Inside the single decision function, so every consumer benefits at once.
    expect(guards).toMatch(/isDatabaseOwner\(actor, object\)/);
  });

  test('ownership lookups are cached and invalidatable', () => {
    expect(guards).toMatch(/OWNER_CACHE_TTL_MS/);
    expect(guards).toMatch(/invalidateOwnerCache/);
  });

  test('a failed lookup grants nothing', () => {
    // The catch block must not leave `isOwner` true.
    expect(guards).toMatch(/isOwner = false;\s*\n\s*}/);
  });

  test('the reconciler detects resources with no owner tuple', () => {
    const reconcile = read('scripts/reconcile-acl.ts');
    expect(reconcile).toMatch(/owner-without-tuple/);
    // And the phantom-owner class, so unadministerable resources stay visible.
    expect(reconcile).toMatch(/phantom-owner/);
  });

  test('the reconciler verifies its own repairs', () => {
    const reconcile = read('scripts/reconcile-acl.ts');
    // A repair job that trusts its writes is worse than none: it closes the alert.
    expect(reconcile).toMatch(/re-checking after repair/);
    expect(reconcile).toMatch(/still have no owner tuple/);
  });
});

test.describe('request identity cannot be asserted by the request', () => {
  // `?as_user=` was accepted by the content endpoints and passed straight into
  // `canUserViewResource()`, so a URL parameter WAS the authorization identity:
  //   GET /api/v1/resources/<private>?as_user=<owner>       -> 200, content served
  //   GET /api/v1/resources/canvas/my-canvas?as_user=<owner> -> 200, 4 nodes
  // without the parameter the same requests returned 403.
  //
  // A header (`x-user-id`) had already been found and fixed. A query parameter is
  // the same bug in a different place, so the CLASS is now asserted: no endpoint
  // may read an identity out of the request, and no endpoint may fall back to a
  // named person.
  test('no endpoint reads an identity from a request parameter or header', () => {
    const offenders: string[] = [];
    for (const file of walk(path.join(ROOT, 'src/pages'))) {
      const rel = path.relative(ROOT, file);
      const src = stripComments(fs.readFileSync(file, 'utf-8'));
      if (
        /(searchParams|params)\s*\.\s*get\s*\(\s*['"](as_user|as|act_as|user|user_id|uid|impersonate)['"]/.test(src) ||
        /headers\s*\.\s*get\s*\(\s*['"]x-(user-id|as-user|act-as)['"]/.test(src)
      ) {
        offenders.push(rel);
      }
    }
    expect(offenders, `identity may be asserted via the request: ${offenders.join(', ')}`).toEqual([]);
  });

  test('no endpoint falls back to a named person', () => {
    // `locals.user || 'user:demo'` attributed every unauthenticated request to a
    // specific person. The earlier guard only caught comparisons, so it missed
    // fallbacks entirely; this catches the literal wherever it appears.
    const offenders: string[] = [];
    for (const file of walk(path.join(ROOT, 'src/pages'))) {
      const rel = path.relative(ROOT, file);
      const src = stripComments(fs.readFileSync(file, 'utf-8'));
      if (/(locals\.user|userQuery|currentUser)\s*(\?\||\|\|)\s*['"]user:(?!anonymous|\*)[^'"]+['"]/.test(src)) {
        offenders.push(rel);
      }
    }
    expect(offenders, `hardcoded identity fallback: ${offenders.join(', ')}`).toEqual([]);
  });

  test('client components do not send an identity parameter', () => {
    const offenders: string[] = [];
    for (const file of walk(path.join(ROOT, 'src/components'))) {
      const src = stripComments(fs.readFileSync(file, 'utf-8'));
      if (/[?&]as_user=/.test(src)) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders, `client still sends as_user: ${offenders.join(', ')}`).toEqual([]);
  });
});

test.describe('the IAM studio does not embed the policy graph in HTML', () => {
  test('the page fetches tuples instead of receiving them as props', () => {
    const page = read('src/pages/admin/permissions.astro');
    expect(page).not.toMatch(/initialTuples=/);
    // Serialising the whole graph into the document handed it to any logged-in user.
    expect(page).not.toMatch(/fgaClient\.read\(/);
    expect(page).toMatch(/requireManageGrants/);
  });

  test('it does not use an inline layout style', () => {
    // AGENTS.md: layout and theming come from design tokens, never inline styles.
    const page = read('src/pages/admin/permissions.astro');
    expect(page).not.toMatch(/style="[^"]*max-width/);
  });
});
