/**
 * Deploy the repo's authorization model to the OpenFGA store this process
 * points at.
 *
 * Needed when the store's model predates the code: a resource type that exists
 * in Postgres and in `resourceRegistry.ts` but not in the graph cannot carry a
 * single tuple, so every check for it fails with `type '<x>' not found` and the
 * resource is invisible with nothing in the logs but a tuple-write error.
 *
 * Reads the model from `src/lib/acl/modelSpec.ts` — the same source the app
 * enforces — so the graph cannot drift from the code again.
 *
 * Usage:
 *   OPENFGA_API_URL=... OPENFGA_STORE_ID=... npx tsx scripts/deploy-model-to-store.ts [--dry-run]
 */
import 'dotenv/config';
import { OpenFgaClient } from '@openfga/sdk';
import { compileModel, renderDsl, findDeadRelations } from '../src/lib/acl/compileModel';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const apiUrl = process.env.OPENFGA_API_URL;
  const storeId = process.env.OPENFGA_STORE_ID;
  if (!apiUrl || !storeId) {
    console.error('OPENFGA_API_URL and OPENFGA_STORE_ID are required');
    process.exit(2);
  }

  const dead = findDeadRelations();
  if (dead.length > 0) {
    console.error('Refusing to deploy: the model spec has unreachable relations.');
    for (const d of dead) console.error(`  ${d.type}#${d.relation}`);
    process.exit(1);
  }

  const model = compileModel();
  const types = model.type_definitions.map((t) => t.type).sort();
  console.log(`model defines ${types.length} types: ${types.join(', ')}`);

  const client = new OpenFgaClient({ apiUrl, storeId });
  if (dryRun) {
    console.log('\nDRY RUN — pass without --dry-run to write.');
    console.log('\nDSL preview:\n' + renderDsl().split('\n').slice(0, 20).join('\n'));
    return;
  }

  const res = await client.writeAuthorizationModel(model as any);
  console.log(`wrote authorization model ${res.authorization_model_id} to store ${storeId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});