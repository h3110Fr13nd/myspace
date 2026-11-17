import * as fs from 'fs';
import * as path from 'path';

const CONTENT_DIR = path.join(process.cwd(), 'content', 'user_demo');

const DOC_EMBED_SEEDS = [
  {
    category: '01_agentic_ai_systems',
    file: 'agentic-ai-edge-cloud-continuum.md',
    embedTarget: 'agentic-workflow-dag-orchestration',
    title: 'Agentic Workflow DAG Orchestration Engine',
  },
  {
    category: '02_drl_edge_scheduling',
    file: 'deep-reinforcement-learning-edge-task-scheduling.md',
    embedTarget: 'maddpg-cooperative-offloading-mec',
    title: 'MADDPG Cooperative Edge Task Offloading Algorithm',
  },
  {
    category: '03_digital_twin_6g_iov',
    file: 'digital-twin-empowered-6g-iov-offloading.md',
    embedTarget: 'mobility-aware-twin-migration-drl',
    title: 'Mobility-Aware Digital Twin State Migration Model',
  },
  {
    category: '04_serverless_iiot_workflows',
    file: 'serverless-edge-iiot-faas-workflows.md',
    embedTarget: 'mitigating-cold-starts-wasm-microvms',
    title: 'Mitigating FaaS Cold-Starts with WebAssembly Micro-VMs',
  },
  {
    category: '07_edge_security_rebac_openfga',
    file: 'zero-trust-agentic-rebac-security.md',
    embedTarget: 'openfga-relationship-based-access-control',
    title: 'OpenFGA ReBAC Fine-Grained Authorization Specifications',
  },
];

async function main() {
  console.log(`[Seed Document Embeds] Injecting note-in-note embeds across research notes...`);
  let count = 0;

  for (const seed of DOC_EMBED_SEEDS) {
    const filePath = path.join(CONTENT_DIR, seed.category, seed.file);
    if (fs.existsSync(filePath)) {
      let content = fs.readFileSync(filePath, 'utf-8');
      const embedTag = `![[document:${seed.embedTarget}|${seed.title}]]`;

      if (!content.includes(embedTag)) {
        content += `\n\n## Embedded Related Research Sub-Note\n${embedTag}\n`;
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`✓ Embedded ${embedTag} into ${seed.file}`);
        count++;
      }
    }
  }

  console.log(`✓ Successfully seeded ${count} note-in-note document embeds!`);
}

main();
