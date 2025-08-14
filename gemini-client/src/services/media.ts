import { PrismaClient, MediaFileType } from '@prisma/client';
const prisma = new PrismaClient();

export async function insertMediaFile({
  contentId,
  fileType,
  fileName,
  fileUrl,
}: {
  contentId: number;
  fileType: MediaFileType; // Enum sesuai schema
  fileName: string;
  fileUrl: string;
}) {
  try {
    const media = await prisma.mediaFile.create({
      data: {
        contentId,
        fileType,
        fileName,
        fileUrl,
      }
    });

    console.log('Media inserted:', media);
    return media;
  } catch (error) {
    console.error('Error inserting media:', error);
    throw new Error('Failed to insert media.');
  }
}

export async function getMediaByContent(contentId: number, fileType?: MediaFileType) {
  return prisma.mediaFile.findMany({
    where: {
      contentId,
      ...(fileType && { fileType })
    },
    orderBy: {
      createdAt: 'desc'
    }
  });
}

export async function getMediaById(mediaId: number) {
  return prisma.mediaFile.findUnique({
    where: { id: mediaId }
  });
}
