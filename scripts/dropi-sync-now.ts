import "dotenv/config";
import { runDropiSync } from "../src/dropi/tracker";
import { prisma } from "../src/db";

// Corre UN barrido de Dropi manualmente.
//   npx tsx scripts/dropi-sync-now.ts          → DRY-RUN (no envía, solo loguea)
//   npx tsx scripts/dropi-sync-now.ts --send    → envía de verdad
//
// La PRIMERA corrida solo "siembra" los pedidos existentes (no notifica). Corre
// una vez para sembrar, luego deja que las transiciones reales disparen avisos.

async function main() {
  const send = process.argv.includes("--send");
  const summary = await runDropiSync({ dryRun: !send });
  console.log("\n── Resumen ──");
  console.log(JSON.stringify(summary, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
