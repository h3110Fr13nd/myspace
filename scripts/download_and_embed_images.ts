import 'dotenv/config';
import pg from 'pg';
import { OpenFgaClient } from '@openfga/sdk';
import { withAclCacheInvalidation } from '../src/lib/aclCache';
import { uploadAsset } from '../src/lib/storage';
import * as fs from 'fs';
import * as path from 'path';
import https from 'https';

const dbUrl = process.env.DATABASE_URL || 'postgresql://' + (process.env.POSTGRES_USER || 'postgres') + ':' + (process.env.POSTGRES_PASSWORD || 'postgres') + '@localhost:5435/workspace_db';
const fgaUrl = process.env.OPENFGA_API_URL || 'http://localhost:8085';
const storeId = process.env.OPENFGA_STORE_ID;

const IMAGES_DIR = path.join(process.cwd(), 'temp', 'content', 'images');
const CONTENT_DIR = path.join(process.cwd(), 'content', 'user_demo');

const SAMPLE_IMAGES = [
  {
    slug: 'edge_cloud_datacenter_topology',
    title: 'Edge Cloud Datacenter Topology',
    category: '01_agentic_ai_systems',
    summary: 'High-throughput edge cloud server node cluster topology.',
    url: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=1200&q=80',
  },
  {
    slug: 'iov_connected_vehicle_network',
    title: '6G Connected Vehicle IoV Network',
    category: '03_digital_twin_6g_iov',
    summary: 'Autonomous vehicle telemetry and V2X edge communication sensors.',
    url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80',
  },
  {
    slug: 'industrial_iot_smart_factory',
    title: 'Industrial IoT Smart Factory Sensor Nodes',
    category: '04_serverless_iiot_workflows',
    summary: 'Automated smart factory robotic assembly and IIoT sensor telemetry.',
    url: 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&w=1200&q=80',
  },
  {
    slug: 'quantum_npu_circuit_array',
    title: 'Quantum NPU Accelerator Circuit Array',
    category: '08_edge_benchmarks_and_taxonomy',
    summary: 'Heterogeneous NPU and quantum-inspired edge accelerator architecture.',
    url: 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?auto=format&fit=crop&w=1200&q=80',
  },
];

function downloadImage(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            downloadImage(redirectUrl, dest).then(resolve).catch(reject);
            return;
          }
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      })
      .on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
  });
}

async function main() {
  console.log(`[Download & Embed Images] Starting image acquisition...`);
  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  const pool = new pg.Pool({ connectionString: dbUrl });
  const fgaClient = new OpenFgaClient({ apiUrl: fgaUrl, storeId });

  const userId = 'user:demo';
  const rootFolderId = 'folder:user_demo_root';

  for (let i = 0; i < SAMPLE_IMAGES.length; i++) {
    const imgMeta = SAMPLE_IMAGES[i];
    const imagePath = path.join(IMAGES_DIR, `${imgMeta.slug}.jpg`);

    console.log(`[${i + 1}/${SAMPLE_IMAGES.length}] Downloading free high-res image from Unsplash: ${imgMeta.slug}...`);
    try {
      await downloadImage(imgMeta.url, imagePath);
      const imgBuffer = fs.readFileSync(imagePath);
      console.log(`Downloaded ${imgMeta.slug}.jpg (${(imgBuffer.length / 1024).toFixed(1)} KB). Uploading to MinIO S3...`);

      const imageId = `image:${imgMeta.slug}`;
      const fileKey = `${imgMeta.slug}.jpg`;
      const subfolderId = `folder:${imgMeta.category}`;
      const resourcePath = `${rootFolderId}/${subfolderId}/${imageId}`;

      // 1. Upload to MinIO S3
      await uploadAsset(fileKey, imgBuffer, 'image/jpeg');

      // 2. Register image resource node in PostgreSQL
      await pool.query(
        `INSERT INTO resources (id, type, tenant_id, parent_id, owner_id, path, title, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata, title = EXCLUDED.title`,
        [
          imageId,
          'image',
          'tenant_default',
          subfolderId,
          userId,
          resourcePath,
          imgMeta.title,
          JSON.stringify({
            slug: imgMeta.slug,
            category: imgMeta.category,
            fileName: fileKey,
            sizeBytes: imgBuffer.length,
            summary: imgMeta.summary,
            mimeType: 'image/jpeg',
          }),
        ]
      );

      // 3. Write OpenFGA Tuples
      try {
        await withAclCacheInvalidation(() =>
          fgaClient.write({
          writes: [
            { user: userId, relation: 'owner', object: imageId },
            { user: userId, relation: 'viewer', object: imageId },
            { user: subfolderId, relation: 'parent_folder', object: imageId },
          ],
        })
        );
      } catch (e: any) {
        // ignore
      }

      console.log(`✓ Uploaded & registered image:${imgMeta.slug} in MinIO, PostgreSQL, and OpenFGA!`);
    } catch (err: any) {
      console.error(`Error processing image ${imgMeta.slug}:`, err.message);
    }
  }

  // 4. Embed real images into research notes
  console.log(`[Download & Embed Images] Embedding real images into research notes...`);
  const catFolders = fs.readdirSync(CONTENT_DIR);

  for (const catFolder of catFolders) {
    const catPath = path.join(CONTENT_DIR, catFolder);
    if (!fs.statSync(catPath).isDirectory()) continue;

    const mdFiles = fs.readdirSync(catPath).filter((f) => f.endsWith('.md'));
    const matchingImages = SAMPLE_IMAGES.filter((img) => img.category === catFolder);

    if (matchingImages.length > 0) {
      for (const mdFile of mdFiles) {
        const filePath = path.join(catPath, mdFile);
        let content = fs.readFileSync(filePath, 'utf-8');
        const targetImage = matchingImages[0];
        const embedTag = `![[image:${targetImage.slug}|${targetImage.title}]]`;

        if (!content.includes(embedTag)) {
          content += `\n\n## High-Resolution System Topology Diagram\n${embedTag}\n`;
          fs.writeFileSync(filePath, content, 'utf-8');
          console.log(`✓ Embedded ${embedTag} into ${mdFile}`);
        }
      }
    }
  }

  console.log(`✓ Finished downloading, uploading, and embedding real images!`);
  await pool.end();
}

main();
