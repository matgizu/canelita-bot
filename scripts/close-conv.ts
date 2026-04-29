import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const waId = process.argv[2];

if (!waId) { console.error("Usage: npx tsx scripts/close-conv.ts <waId>"); process.exit(1); }

async function main() {
  const conv = await prisma.conversation.findUnique({ where: { waId } });
  if (!conv) { console.log("Conversación no encontrada:", waId); return; }
  console.log(`Estado actual: ${conv.state} | Nombre: ${conv.customerName ?? "—"}`);
  await prisma.conversation.update({ where: { waId }, data: { state: "CLOSED" } });
  console.log("✓ Marcada como CLOSED");
}

main().catch(console.error).finally(() => prisma.$disconnect());
