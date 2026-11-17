import { OpenFgaClient } from '@openfga/sdk';
import * as fs from 'fs';
import * as path from 'path';

const apiUrl = process.env.OPENFGA_API_URL || 'http://localhost:8081';
const storeId = process.env.OPENFGA_STORE_ID;

async function exportTuples() {
  if (!storeId) {
    console.error('[OpenFGA Export Error] OPENFGA_STORE_ID environment variable is missing.');
    process.exit(1);
  }

  console.log(`[OpenFGA Export] Connecting to store ${storeId} at ${apiUrl}...`);
  const client = new OpenFgaClient({ apiUrl, storeId });

  try {
    const readResponse = await client.read({});
    const tuples = readResponse.tuples || [];

    const snapshotDir = path.join(process.cwd(), 'docker', 'openfga');
    if (!fs.existsSync(snapshotDir)) {
      fs.mkdirSync(snapshotDir, { recursive: true });
    }

    const dumpPath = path.join(snapshotDir, 'tuples-snapshot.json');
    fs.writeFileSync(dumpPath, JSON.stringify(tuples, null, 2));

    console.log(`[OpenFGA Export Success] ${tuples.length} relationship tuples exported to ${dumpPath}`);
  } catch (error: any) {
    console.error(`[OpenFGA Export Error]:`, error.message);
  }
}

exportTuples();
