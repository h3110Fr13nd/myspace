import 'dotenv/config';
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Unified credentials resolution (supporting S3, R2, GCS, MinIO, or AWS)
const accountId = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || '';
const endpoint =
  process.env.S3_ENDPOINT ||
  process.env.S3_ENDPOINT_URL ||
  (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);

const accessKeyId =
  process.env.S3_ACCESS_KEY_ID ||
  process.env.R2_ACCESS_KEY_ID ||
  process.env.AWS_ACCESS_KEY_ID ||
  '';

const secretAccessKey =
  process.env.S3_SECRET_ACCESS_KEY ||
  process.env.R2_SECRET_ACCESS_KEY ||
  process.env.AWS_SECRET_ACCESS_KEY ||
  '';

const region =
  process.env.S3_REGION ||
  (endpoint && endpoint.includes('r2.cloudflarestorage.com') ? 'auto' : 'us-east-1');

const forcePathStyle =
  process.env.S3_FORCE_PATH_STYLE === 'true' ||
  (endpoint ? endpoint.includes('localhost') || endpoint.includes('127.0.0.1') || endpoint.includes('minio') : false);

export const BUCKET_NAME =
  process.env.S3_BUCKET_NAME ||
  process.env.R2_BUCKET_NAME ||
  process.env.BUCKET_NAME ||
  'foss-blog-assets';

export const s3Client = new S3Client({
  endpoint,
  region,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
  forcePathStyle,
});

/** Verifies bucket existence or attempts auto-creation in local/self-hosted dev */
export async function ensureBucketExists() {
  if (!accessKeyId) {
    console.warn('[Storage] No S3/R2 credentials configured — skipping bucket check.');
    return;
  }
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }));
  } catch (error: any) {
    // If local MinIO or auto-create enabled, attempt creation
    if (process.env.S3_AUTO_CREATE_BUCKET === 'true' || forcePathStyle) {
      try {
        await s3Client.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
        return;
      } catch (createErr: any) {
        console.warn(`[Storage] Could not auto-create bucket '${BUCKET_NAME}':`, createErr.message);
      }
    }
    console.warn(`[Storage] Bucket '${BUCKET_NAME}' verification notice:`, error.message);
  }
}

export async function uploadAsset(key: string, body: Buffer | Uint8Array | string, contentType: string) {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
  });
  await s3Client.send(command);
  return key;
}

export async function getAssetStream(key: string) {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });
  const response = await s3Client.send(command);
  return {
    stream: response.Body,
    contentType: response.ContentType || 'application/octet-stream',
    contentLength: response.ContentLength,
  };
}

export async function getPresignedAssetUrl(key: string, expiresInSeconds: number = 60) {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });
  return await getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}
