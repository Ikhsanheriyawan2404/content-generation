import * as Minio from 'minio'
import * as dotenv from 'dotenv';

dotenv.config();

const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT || '9000', 10),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || '',
  secretKey: process.env.MINIO_SECRET_KEY || ''
});

/**
 * Mendapatkan object dari bucket MinIO.
 * @param bucketName Nama bucket di MinIO.
 * @param objectName Nama objek yang ingin diambil.
 * @returns Stream data dari objek.
 */
export async function getObjectFromMinio(bucketName: string, objectName: string) {
  try {
    const dataStream = await minioClient.getObject(bucketName, objectName);
    return dataStream;
  } catch (error) {
    console.error('Failed to get object from MinIO:', error);
    throw new Error('Failed to get object from MinIO');
  }
}

/**
 * Mengunggah object ke bucket MinIO.
 * @param bucketName Nama bucket tujuan.
 * @param objectName Nama objek yang akan disimpan.
 * @param filePath Path file lokal yang akan diunggah.
 * @param metaData Metadata tambahan untuk objek.
 */
export async function putObjectToMinio(bucketName: string, objectName: string, filePath: string | Buffer, metaData: Minio.ItemBucketMetadata = {}) {
  try {
    let etag: any;

    if (Buffer.isBuffer(filePath)) {
      // Upload langsung dari buffer
      etag = await minioClient.putObject(bucketName, objectName, filePath, filePath.length, metaData);
    } else {
      // Upload dari file lokal
      etag = await minioClient.fPutObject(bucketName, objectName, filePath, metaData);
    }

    console.log(`Successfully uploaded object '${objectName}' with ETag: ${etag}`);
    return etag;
  } catch (error) {
    console.error('Failed to put object to MinIO:', error);
    throw new Error('Failed to put object to MinIO');
  }
}

export const ensureBucketExists = async (bucketName: string, region: string = 'us-east-1'): Promise<void> => {
  try {
    const bucketExists = await minioClient.bucketExists(bucketName);
    if (!bucketExists) {
      await minioClient.makeBucket(bucketName, region);
    }
  } catch (error) {
    console.error(`Failed to ensure bucket '${bucketName}' exists:`, error);
    throw new Error('Failed to ensure bucket exists.');
  }
};