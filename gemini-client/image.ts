import dotenv from 'dotenv';
dotenv.config();

import {
  GoogleGenAI,
} from '@google/genai';
import mime from 'mime';
import { writeFile } from 'fs';
import path from 'path';

function saveBinaryFile(fileName: string, content: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    writeFile(fileName, content, (err) => {
      if (err) {
        console.error(`Error writing file ${fileName}:`, err);
        reject(err);
        return;
      }
      console.log(`File ${fileName} saved successfully. Size: ${content.length} bytes`);
      resolve();
    });
  });
}

async function main() {
  try {
    // Gunakan environment variable untuk API key
    const apiKey = "AIzaSyB6sowjwVCFOYc-IgxSSBo_NqJU6xOcluc"
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY environment variable is required');
    }

    const ai = new GoogleGenAI({
      apiKey: apiKey,
    });

    const config = {
      temperature: 1,
      responseModalities: [
        'audio',
      ],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: 'Zephyr',
          }
        }
      },
    };

    const model = 'gemini-2.5-pro-preview-tts';
    
    // Ganti dengan input yang sebenarnya
    const userInput = "Serius… catat pengeluaran tuh nggak harus ribet… buka Excel… tiap hari. Dulu gue pikir… nyatet pengeluaran itu makan waktu… sampai akhirnya nyadar… kebocoran uang kecil-kecil itu kayak ember bocor. Pelan-pelan… habis juga. Sekarang… gue tinggal chat ke bot… 'kopi susu dua puluh lima ribu'… Langsung… auto masuk kategori… dan laporan. Jadi… tiap akhir bulan… gue tau jelas… duit larinya kemana. Nggak perlu buka spreadsheet… nggak perlu ribet. Coba… Duite Bot… sekarang. Gratis. Kirim pesan pertama kamu… hari ini… biar bulan depan… kamu nggak lagi bingung… duit hilang kemana.";
    
    const contents = [
      {
        role: 'user',
        parts: [
          {
            text: userInput,
          },
        ],
      },
    ];

    console.log('Generating audio content...');
    const response = await ai.models.generateContentStream({
      model,
      config,
      contents,
    });

    let fileIndex = 0;
    let hasAudioData = false;

    for await (const chunk of response) {
      console.log('Received chunk:', {
        hasCandidates: !!chunk.candidates,
        candidatesLength: chunk.candidates?.length || 0,
        hasContent: !!chunk.candidates?.[0]?.content,
        hasParts: !!chunk.candidates?.[0]?.content?.parts,
        partsLength: chunk.candidates?.[0]?.content?.parts?.length || 0
      });

      if (!chunk.candidates || !chunk.candidates[0].content || !chunk.candidates[0].content.parts) {
        continue;
      }

      for (const part of chunk.candidates[0].content.parts) {
        if (part.inlineData) {
          hasAudioData = true;
          const fileName = `audio_output_${fileIndex++}`;
          const inlineData = part.inlineData;
          
          console.log('Processing audio data:', {
            mimeType: inlineData.mimeType,
            dataLength: inlineData.data?.length || 0
          });

          let fileExtension = mime.getExtension(inlineData.mimeType || '');
          let buffer = Buffer.from(inlineData.data || '', 'base64');
          
          if (!fileExtension) {
            console.log('Unknown mime type, converting to WAV');
            fileExtension = 'wav';
            buffer = convertToWav(inlineData.data || '', inlineData.mimeType || '');
          }

          const fullFileName = `${fileName}.${fileExtension}`;
          console.log(`Saving audio file: ${fullFileName} (${buffer.length} bytes)`);
          
          try {
            await saveBinaryFile(fullFileName, buffer);
          } catch (saveError) {
            console.error('Failed to save audio file:', saveError);
          }
        } else if (part.text) {
          console.log('Text response:', part.text);
        }
      }
    }

    if (!hasAudioData) {
      console.log('No audio data received. Check if the model supports audio output.');
    }

  } catch (error) {
    console.error("An error occurred:", error);
  }
}

interface WavConversionOptions {
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
}

function convertToWav(rawData: string, mimeType: string): Buffer {
  const options = parseMimeType(mimeType);
  const rawBuffer = Buffer.from(rawData, 'base64');
  const wavHeader = createWavHeader(rawBuffer.length, options);

  return Buffer.concat([wavHeader, rawBuffer]);
}

function parseMimeType(mimeType: string): WavConversionOptions {
  const [fileType, ...params] = mimeType.split(';').map(s => s.trim());
  const [_, format] = fileType.split('/');

  const options: Partial<WavConversionOptions> = {
    numChannels: 1,
    sampleRate: 22050, // default sample rate
    bitsPerSample: 16, // default bits per sample
  };

  if (format && format.startsWith('L')) {
    const bits = parseInt(format.slice(1), 10);
    if (!isNaN(bits)) {
      options.bitsPerSample = bits;
    }
  }

  for (const param of params) {
    const [key, value] = param.split('=').map(s => s.trim());
    if (key === 'rate') {
      options.sampleRate = parseInt(value, 10);
    } else if (key === 'channels') {
      options.numChannels = parseInt(value, 10);
    }
  }

  return options as WavConversionOptions;
}

function createWavHeader(dataLength: number, options: WavConversionOptions): Buffer {
  const {
    numChannels,
    sampleRate,
    bitsPerSample,
  } = options;

  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const buffer = Buffer.alloc(44);

  buffer.write('RIFF', 0);                      // ChunkID
  buffer.writeUInt32LE(36 + dataLength, 4);     // ChunkSize
  buffer.write('WAVE', 8);                      // Format
  buffer.write('fmt ', 12);                     // Subchunk1ID
  buffer.writeUInt32LE(16, 16);                 // Subchunk1Size (PCM)
  buffer.writeUInt16LE(1, 20);                  // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(numChannels, 22);        // NumChannels
  buffer.writeUInt32LE(sampleRate, 24);         // SampleRate
  buffer.writeUInt32LE(byteRate, 28);           // ByteRate
  buffer.writeUInt16LE(blockAlign, 32);         // BlockAlign
  buffer.writeUInt16LE(bitsPerSample, 34);      // BitsPerSample
  buffer.write('data', 36);                     // Subchunk2ID
  buffer.writeUInt32LE(dataLength, 40);         // Subchunk2Size

  return buffer;
}

main().catch((err) => {
  console.error("An error occurred:", err);
});