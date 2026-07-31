import fs from "fs";

/** Optional R2/S3: set S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PUBLIC_BASE_URL */
export async function maybeUploadToObjectStorage(localPath, filename, mime) {
  const bucket = process.env.S3_BUCKET;
  const baseUrl = process.env.S3_PUBLIC_BASE_URL;
  if (!bucket || !baseUrl) return null;

  try {
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = new S3Client({
      region: process.env.S3_REGION || "auto",
      endpoint: process.env.S3_ENDPOINT || undefined,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
      },
    });
    const key = `uploads/${filename}`;
    const body = fs.readFileSync(localPath);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: mime || "application/octet-stream",
      })
    );
    const url = baseUrl.replace(/\/$/, "") + "/" + key;
    return url;
  } catch (err) {
    console.warn("[storage] object upload skipped:", err?.message || err);
    return null;
  }
}
