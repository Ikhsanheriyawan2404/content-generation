import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

/**
 * Mengambil kategori berikutnya secara round-robin berdasarkan waktu terakhir diambil (last_picked_at).
 * @returns Kategori berikutnya yang paling lama tidak diambil.
 */
export async function getNextCategoryRoundRobin() {
  try {
    // Cari kategori yang paling lama tidak di-pickup (lastPickedAt adalah yang paling tua)
    const nextCategory = await prisma.category.findFirst({
      orderBy: {
        lastPickedAt: { sort: 'asc', nulls: 'first' },
      },
    });

    if (!nextCategory) {
      return null;
    }

    // Perbarui timestamp lastPickedAt untuk kategori yang baru saja diambil
    await prisma.category.update({
      where: {
        id: nextCategory.id,
      },
      data: {
        lastPickedAt: new Date(),
      },
    });

    return nextCategory;
  } catch (error) {
    console.error('Error fetching round-robin category in service:', error);
    throw new Error('Failed to get next round-robin category.');
  }
}

export async function getCategory(categoryId: number) {
  return await prisma.category.findUnique({
    where: { id: categoryId },
  });
}
