const requiredEnvironment = [
  'CLOUDFLARE_R2_ACCOUNT_ID',
  'CLOUDFLARE_R2_ACCESS_KEY_ID',
  'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
  'CLOUDFLARE_R2_MEDIA_BUCKET'
];

export function r2MediaConfigured(env = process.env) {
  return requiredEnvironment.every((name) => String(env[name] || '').trim());
}

let clientPromise;
async function r2Client() {
  if (!r2MediaConfigured()) throw new Error('R2 media storage is not configured.');
  if (!clientPromise) {
    clientPromise = import('@aws-sdk/client-s3').then(({ S3Client }) => new S3Client({
      region: 'auto',
      endpoint: `https://${String(process.env.CLOUDFLARE_R2_ACCOUNT_ID).trim()}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: String(process.env.CLOUDFLARE_R2_ACCESS_KEY_ID).trim(),
        secretAccessKey: String(process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY).trim()
      }
    }));
  }
  return clientPromise;
}

function bucket() {
  return String(process.env.CLOUDFLARE_R2_MEDIA_BUCKET || '').trim();
}

export async function putR2Media(key, body, contentType) {
  const [{ PutObjectCommand }, client] = await Promise.all([import('@aws-sdk/client-s3'), r2Client()]);
  await client.send(new PutObjectCommand({
    Bucket: bucket(), Key: key, Body: body, ContentType: contentType,
    CacheControl: 'private, max-age=86400'
  }), { abortSignal: AbortSignal.timeout(90_000) });
}

export async function getR2Media(key, maximumBytes) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) throw new Error('Invalid media size limit.');
  const [{ GetObjectCommand }, client] = await Promise.all([import('@aws-sdk/client-s3'), r2Client()]);
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket(), Key: key }),
      { abortSignal: AbortSignal.timeout(120_000) });
    const chunks = [];
    let total = 0;
    try {
      if (Number(result.ContentLength) > maximumBytes) throw new Error('Stored media exceeds size limit.');
      for await (const chunk of result.Body) {
        total += chunk.length;
        if (total > maximumBytes) throw new Error('Stored media exceeds size limit.');
        chunks.push(Buffer.from(chunk));
      }
    } catch (error) {
      result.Body?.destroy?.();
      throw error;
    }
    return {
      body: Buffer.concat(chunks, total),
      contentType: String(result.ContentType || ''),
      contentLength: Number(result.ContentLength) || 0
    };
  } catch (error) {
    if (['NoSuchKey', 'NotFound'].includes(String(error && (error.name || error.Code)))) return null;
    throw error;
  }
}
