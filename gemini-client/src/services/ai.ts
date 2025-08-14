import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';
import { stripIndent } from 'common-tags'; // npm install common-tags

dotenv.config();

/**
 * Interface untuk hasil audio yang dihasilkan.
 * Mengandung data biner dan tipe MIME.
 */
interface GeneratedAudio {
  data: Buffer;
  mimeType: string;
}

/**
 * Interface untuk hasil gambar yang dihasilkan.
 * Mengandung data biner dan tipe MIME.
 */
interface GeneratedImage {
  data: Buffer;
  mimeType: string;
}

// Inisialisasi Google GenAI dari kunci API yang diambil dari environment variable.
// Disarankan untuk menggunakan .env untuk menyimpan kunci API.
const apiKey = process.env.GOOGLE_API_KEY; // Menggunakan env variable untuk keamanan
if (!apiKey) {
  console.error('GOOGLE_API_KEY environment variable is not set.');
}

const ai = new GoogleGenAI({ apiKey });

/**
 * Mengonversi data PCM mentah menjadi format WAV.
 * @param rawData Data audio PCM dalam bentuk Buffer.
 * @param mimeType Tipe MIME dari data mentah, mis. "audio/L16;rate=22050;channels=1".
 * @returns Buffer yang berisi file WAV lengkap.
 */
function convertToWav(rawData: Buffer, mimeType: string): Buffer {
  const options = parseMimeType(mimeType);
  const wavHeader = createWavHeader(rawData.length, options);
  return Buffer.concat([wavHeader, rawData]);
}

/**
 * Mengurai tipe MIME untuk mendapatkan parameter audio.
 * @param mimeType Tipe MIME yang akan diurai.
 * @returns Opsi konversi WAV.
 */
function parseMimeType(mimeType: string) {
  const params = Object.fromEntries(mimeType.split(';').map(s => s.trim().split('=').map(p => p.trim())));
  return {
    numChannels: params.channels ? parseInt(params.channels, 10) : 1,
    sampleRate: params.rate ? parseInt(params.rate, 10) : 22050,
    bitsPerSample: params['audio/L16'] ? 16 : 16, // Default to 16 bits if not specified
  };
}

/**
 * Membuat header WAV untuk data audio mentah.
 * @param dataLength Ukuran data audio mentah.
 * @param options Opsi konversi WAV.
 * @returns Buffer yang berisi header WAV.
 */
function createWavHeader(dataLength: number, options: { numChannels: number; sampleRate: number; bitsPerSample: number }): Buffer {
  const { numChannels, sampleRate, bitsPerSample } = options;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const buffer = Buffer.alloc(44);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);

  return buffer;
}

/**
 * Interface untuk struktur JSON yang diharapkan dari Gemini.
 * Ini mencerminkan field yang relevan dari model Prisma 'Content' Anda.
 */
interface GeneratedContent {
  title: string;
  caption: string;
  scriptText: string;
  promptImage: string;
}

/**
 * Memanggil Google Gemini API untuk membuat konten video dan prompt gambar.
 *
 * @param categoryData - Objek Category dari database
 * @returns Promise<GeneratedContent> - Objek JSON berisi detail konten dan prompt gambar.
 */
export async function generateContentScript(
  categoryData: {
    name: string;
    description: string | null;
    targetAudience: string | null;
    contentGoal: string | null;
    exampleUseCase: string | null;
  }
): Promise<GeneratedContent> {

  const prompt = stripIndent`
    Kamu adalah content creator yang ahli membuat konten ${categoryData.contentGoal} untuk ${categoryData.targetAudience}.

    Buatlah skrip konten singkat (maksimal 100 kata) yang relevan dengan kategori: ${categoryData.name}.
    Deskripsi kategori: ${categoryData.description}
    Contoh use case: ${categoryData.exampleUseCase}

    Gunakan gaya bahasa santai, storytelling singkat, dan call-to-action yang halus. Masukkan 1-2 insight atau tips praktis.
    Konten ini cocok untuk format short video / reels / TikTok.

    Selain skrip, buatkan juga deskripsi visual yang sangat detail dan kreatif (berbentuk satu kalimat) yang bisa digunakan untuk generate gambar yang sesuai dengan skrip video ini.

    Hasil output harus dalam format JSON dengan struktur ini:
    {
      "title": "Judul konten yang menarik",
      "caption": "Caption atau deskripsi singkat untuk postingan",
      "scriptText": "Skrip lengkap untuk video, berbentuk narasi atau poin-poin yang mudah dibaca",
      "promptImage": "Deskripsi visual untuk AI image generator, misalnya: 'Pemandangan urban futuristik di malam hari, dengan lampu neon berkilauan dan kendaraan terbang. Cinematic, high-detail.'"
    }
  `;

  try {
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    let textResponse = result.text ?? "";

    // --- Langkah perbaikan utama ---
    // Menggunakan regex untuk mengekstrak string JSON dari blok kode markdown
    const jsonMatch = textResponse.match(/```json\n([\s\S]*?)\n```/);

    if (jsonMatch && jsonMatch[1]) {
      // Jika ditemukan, ambil isi dari grup tangkapan pertama (grup 1)
      textResponse = jsonMatch[1].trim();
    } else {
      // Jika tidak ada blok markdown, coba bersihkan spasi ekstra saja
      textResponse = textResponse.trim();
    }
    // --- Akhir langkah perbaikan ---

    const generatedJson = JSON.parse(textResponse);
    return generatedJson as GeneratedContent;

  } catch (error) {
    console.error('Error saat memanggil Gemini API atau parsing JSON:', error);
    throw new Error('Gagal menghasilkan konten. Pastikan API mengembalikan JSON yang valid.');
  }
}

/**
 * Menghasilkan audio dari teks menggunakan Gemini TTS.
 * @param text Teks yang akan diubah menjadi audio.
 * @returns Promise yang resolve dengan objek GeneratedAudio.
 */
export async function generateAudio(text: string): Promise<GeneratedAudio | null> {
  const config = {
    temperature: 1,
    responseModalities: ['AUDIO'],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: 'Zephyr',
        }
      }
    },
  };

  const model = 'gemini-2.5-flash-preview-tts';
  
  const contents = [
    {
      role: 'user',
      parts: [{ text }],
    },
  ];

  try {
    // Menggunakan generateContent (non-streaming) untuk mendapatkan seluruh data sekaligus
    const response = await ai.models.generateContent({ model, config, contents });

    const part = response?.candidates?.[0]?.content?.parts?.[0];
    const audioData = part?.inlineData?.data;
    const mimeType = part?.inlineData?.mimeType;

    if (audioData && mimeType && mimeType.startsWith("audio/")) {
      const pcmData = Buffer.from(audioData, 'base64');
      const wavData = convertToWav(pcmData, mimeType);
      return { data: wavData, mimeType: 'audio/wav' };
    }

    console.log('No audio data received from the model.');
    return null;

  } catch (error) {
    console.error("An error occurred during audio generation:", error);
    throw error;
  }
}

/**
 * Menghasilkan gambar dari prompt menggunakan Gemini Image Generation.
 * @param prompt Prompt untuk menghasilkan gambar.
 * @returns Promise yang resolve dengan objek GeneratedImage.
 */
export async function generateImage(prompt: string): Promise<GeneratedImage | null> {
  const model = 'imagen-3.0-generate-002';

  const payload = { instances: { prompt }, parameters: { "sampleCount": 1, "aspectRatio": "9:16" } };
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;
  
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
        throw new Error(`API call failed with status: ${response.status}`);
    }
    
    const result = await response.json();
    
    if (result.predictions && result.predictions.length > 0 && result.predictions[0].bytesBase64Encoded) {
        const base64Data = result.predictions[0].bytesBase64Encoded;
        const buffer = Buffer.from(base64Data, 'base64');
        return { data: buffer, mimeType: 'image/png' };
    }

    console.log('No image data received from the model.');
    return null;

  } catch (error) {
    console.error("An error occurred during image generation:", error);
    throw error;
  }
}

