-- CreateTable
CREATE TABLE "Conversation" (
    "id" SERIAL NOT NULL,
    "waId" TEXT NOT NULL,
    "customerName" TEXT,
    "fullName" TEXT,
    "phone" TEXT,
    "altPhone" TEXT,
    "idNumber" TEXT,
    "address" TEXT,
    "reference" TEXT,
    "city" TEXT,
    "department" TEXT,
    "state" TEXT NOT NULL DEFAULT 'GREETING',
    "automationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "objectionCount" INTEGER NOT NULL DEFAULT 0,
    "cart" JSONB NOT NULL DEFAULT '[]',
    "pendingOrder" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastInboundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastOutboundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" SERIAL NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "rawState" TEXT,
    "mediaUrl" TEXT,
    "whatsappMsgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" SERIAL NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "cart" JSONB NOT NULL,
    "total" INTEGER NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "fullName" TEXT,
    "idNumber" TEXT,
    "address" TEXT,
    "city" TEXT,
    "department" TEXT,
    "altPhone" TEXT,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_waId_key" ON "Conversation"("waId");

-- CreateIndex
CREATE INDEX "Conversation_state_idx" ON "Conversation"("state");

-- CreateIndex
CREATE INDEX "Conversation_automationEnabled_idx" ON "Conversation"("automationEnabled");

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- CreateIndex
CREATE INDEX "Message_createdAt_idx" ON "Message"("createdAt");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_conversationId_idx" ON "Order"("conversationId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
