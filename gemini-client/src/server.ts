import express from 'express';

import { v4 as uuidv4 } from 'uuid'; // Untuk membuat nama file unik

import { PrismaClient } from '@prisma/client';
import { getCategory, getNextCategoryRoundRobin } from './services/category';
import { ensureBucketExists, getObjectFromMinio, putObjectToMinio } from './services/minio';
import { generateAudio, generateContentScript, generateImage } from './services/ai';

const prisma = new PrismaClient();
const app = express();
import * as dotenv from 'dotenv';
import { saveContent } from './services/content';
import { getMediaByContent, getMediaById, insertMediaFile } from './services/media';
dotenv.config();

const port = process.env.APP_PORT || 3_000;

// Middleware untuk parsing body JSON dari request
app.use(express.json());

app.get('/category/next', async (req, res) => {
  try {
    const nextCategory = await getNextCategoryRoundRobin()

    if (!nextCategory) {
      return res.status(404).json({ message: 'No categories found.' });
    }
    
    return res.json(nextCategory);
  } catch (error) {
    console.error('Error fetching round-robin category:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/media/file/:mediaId', async (req, res) => {
  try {
    const mediaId = parseInt(req.params.mediaId, 10);
    if (isNaN(mediaId)) {
      return res.status(400).json({ error: 'Invalid media ID' });
    }

    // Ambil detail media dari DB
    const media = await getMediaById(mediaId);
    if (!media) {
      return res.status(404).json({ error: 'Media not found' });
    }

    const bucket = "media"
    const filename = media.fileName

    const stream = await getObjectFromMinio(bucket, filename);
    const downloadName = media.fileName || filename.split('/').pop() || filename;

    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    return stream.pipe(res);

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to get file' });
  }
});

app.get('/media/:id', async (req, res) => {
  try {
    const contentId = parseInt(req.params.id, 10);
    if (isNaN(contentId)) {
      return res.status(400).json({ error: 'Invalid content ID' });
    }

    const media = await getMediaByContent(contentId);
    return res.json(media);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to get media' });
  }
});

/**
 * Endpoint untuk menghasilkan audio dari teks dan menyimpannya ke MinIO.
 * Menerima body JSON dengan format { "text": "..." }.
 */
app.post('/generate/audio', async (req, res) => {
  try {
    const { text, contentId } = req.body; // pastikan contentId dikirim dari client
    if (!text || !contentId) {
      return res.status(400).json({ message: 'Text and contentId are required.' });
    }

    const bucketName = 'media'; // Ganti dengan nama bucket yang diinginkan
    await ensureBucketExists(bucketName);

    const audioResult = await generateAudio(text);
    
    if (!audioResult) {
      return res.status(500).json({ message: 'Failed to generate audio.' });
    }
    
    const objectName = `${contentId}/${uuidv4()}.wav`; // Nama file unik
    const etag = await putObjectToMinio(
      bucketName,
      objectName,
      audioResult.data,
      { 'Content-Type': audioResult.mimeType }
    );
    
    const fileUrl = `/files/${bucketName}/${objectName}`;

    await insertMediaFile({
      contentId,                // dari body request
      fileType: 'audio',        // enum di schema kamu
      fileName: objectName,     // nama file unik
      fileUrl,                  // path URL
    });

    return res.json({ message: 'Audio generated and uploaded successfully', etag, fileUrl, contentId });
  } catch (error) {
    console.error('Error generating audio:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * Endpoint untuk menghasilkan gambar dari prompt dan menyimpannya ke MinIO.
 * Menerima body JSON dengan format { "prompt": "..." }.
 */
app.post('/generate/image', async (req, res) => {
  try {
    const { prompt, contentId } = req.body; // pastikan contentId dikirim dari client
    if (!prompt || !contentId) {
      return res.status(400).json({ message: 'Prompt and contentId are required.' });
    }

    const bucketName = 'media'; // Ganti dengan nama bucket yang diinginkan
    await ensureBucketExists(bucketName);

    const imageResult = await generateImage(prompt);
    
    if (!imageResult) {
      return res.status(500).json({ message: 'Failed to generate image.' });
    }

    const objectName = `${contentId}/${uuidv4()}.png`; // Nama file unik
    const etag = await putObjectToMinio(
      bucketName,
      objectName,
      imageResult.data,
      { 'Content-Type': imageResult.mimeType }
    );
    
    const fileUrl = `/files/${bucketName}/${objectName}`;

    await insertMediaFile({
      contentId,                // dari body request
      fileType: 'image',        // enum di schema kamu
      fileName: objectName,     // nama file unik
      fileUrl,                  // path URL
    });

    return res.json({ message: 'Image generated and uploaded successfully', etag, fileUrl, contentId });
  } catch (error) {
    console.error('Error generating image:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/generate/content', async (req, res) => {
  const { categoryId } = req.body;

  if (!categoryId) {
    return res.status(400).json({ error: '`categoryId` diperlukan di request body.' });
  }

  try {
    // 1. Ambil data kategori dari database
    const category = await getCategory(categoryId)

    if (!category) {
      return res.status(404).json({ error: `Kategori dengan ID ${categoryId} tidak ditemukan.` });
    }

    console.log('Memulai proses pembuatan konten untuk kategori:', category.name);

    // 2. Panggil fungsi service untuk berinteraksi dengan Google Gemini API
    const generatedContent = await generateContentScript(category);

    // 3. Simpan konten yang baru dibuat ke database
    const newContent = await saveContent(generatedContent, category.id)

    console.log('Konten berhasil disimpan:', newContent.id);

    // 4. Mengirimkan hasil ke client
    return res.status(201).json(newContent);

  } catch (error) {
    console.error('Gagal memproses permintaan:', error);
    return res.status(500).json({ error: 'Gagal membuat atau menyimpan konten. Silakan coba lagi.' });
  }
})

// Jalankan server
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit();
});