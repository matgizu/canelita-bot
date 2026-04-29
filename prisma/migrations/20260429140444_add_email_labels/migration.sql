-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "email" TEXT,
ADD COLUMN     "labels" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "email" TEXT;
