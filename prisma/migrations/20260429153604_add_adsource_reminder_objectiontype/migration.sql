-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "adHeadline" TEXT,
ADD COLUMN     "adSource" TEXT,
ADD COLUMN     "ctwaClid" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "objectionType" TEXT;

-- CreateTable
CREATE TABLE "Reminder" (
    "id" SERIAL NOT NULL,
    "waId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "sent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Reminder_sent_dueAt_idx" ON "Reminder"("sent", "dueAt");
