/**
 * Compiles `src/lib/acl/modelSpec.ts` into OpenFGA `type_definitions` JSON and
 * deploys it to the EXISTING store (OPENFGA_STORE_ID) without creating a store
 * or rewriting demo tuples.
 *
 * `authz/model.fga` is regenerated from the same spec, so the readable DSL can
 * never drift from what is actually deployed.
 */
import 'dotenv/config';
import { OpenFgaClient } from '@openfga/sdk';
import { compileModel, renderDsl, findDeadRelations } from '../src/lib/acl/compileModel';
import * as fs from 'fs';
import * as path from 'path';

const apiUrl = process.env.OPENFGA_API_URL || 'http://localhost:8085';

async function main() {
  const storeId = process.env.OPENFGA_STORE_ID;
  if (!storeId) {
    throw new Error('OPENFGA_STORE_ID is not set; refusing to create a brand new store.');
  }

  // Refuse to ship a schema with unreachable relations — the guard that would
  // have caught `denied_viewer` being declared but never referenced.
  const dead = findDeadRelations();
  if (dead.length > 0) {
    console.error('[Deploy Model] Refusing to deploy: unreachable relations detected.');
    for (const d of dead) console.error(`  ${d.type}#${d.relation}`);
    throw new Error(`${dead.length} unreachable relation(s) in the model spec`);
  }
  console.log('[Deploy Model] Reachability check passed — no dead relations.');

  const client = new OpenFgaClient({ apiUrl, storeId });
  const model = compileModel();

  const res = await client.writeAuthorizationModel(model as any);
  console.log(`[Deploy Model] Deployed model id: ${res.authorization_model_id}`);

  const dslPath = path.resolve(process.cwd(), 'authz/model.fga');
  fs.writeFileSync(dslPath, renderDsl(), 'utf-8');
  console.log(`[Deploy Model] Regenerated ${path.relative(process.cwd(), dslPath)}`);
}

main().catch((err) => {
  console.error('[Deploy Model] Fatal error:', err.message || err);
  process.exit(1);
});
