import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function saveContent(content: any, categoryId: number) {
  try {
    return await prisma.content.create({
      data: {
        categoryId: categoryId,
        title: content.title,
        caption: content.caption,
        scriptText: content.scriptText,
        // Simpan promptImage di field metadata
        metadata: {
          promptImage: content.promptImage,
        },
        status: 'pending',
      },
    });
  } catch (error) {
    console.error('Error fetching content:', error);
    throw new Error('Failed to get content.');
  }
}