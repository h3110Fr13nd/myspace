import 'dotenv/config';
import { OpenFgaClient } from '@openfga/sdk';

const apiUrl = process.env.OPENFGA_API_URL || 'http://localhost:8085';
const storeId = process.env.OPENFGA_STORE_ID;

async function main() {
  console.log(`Testing OpenFGA at ${apiUrl}, storeId: ${storeId}...`);
  const fgaClient = new OpenFgaClient({ apiUrl, storeId });

  const testObject = 'pdf:hybrid_redundancy_for_reliable_task_offloading_in';
  const testUser = 'user:demo';

  // 1. Check permission
  const checkRes = await fgaClient.check({
    user: testUser,
    relation: 'viewer',
    object: testObject,
  });
  console.log(`[Check] Allowed for ${testUser} viewer ${testObject}:`, checkRes.allowed);

  // 2. Read tuples for this object
  const readRes = await fgaClient.read({
    object: testObject,
  });
  console.log(`[Read Tuples] Tuples for ${testObject}:`, readRes.tuples);
}

main();
