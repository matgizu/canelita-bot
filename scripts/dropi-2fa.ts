import "dotenv/config";
import { dropi } from "../src/dropi/client";
import { prisma } from "../src/db";

// Siembra el token de Dropi validando tu código de Google Authenticator.
// En producción esto lo hace el bot solo por WhatsApp; este script es para la
// primera vez / pruebas desde la terminal.
//
// Dos pasos (para que el código no venza por el retraso del login):
//   1) node node_modules/tsx/dist/cli.mjs scripts/dropi-2fa.ts --request
//      → hace el login y deja listo el token temporal.
//   2) node node_modules/tsx/dist/cli.mjs scripts/dropi-2fa.ts 123456
//      → valida tu código (instantáneo) y guarda el token real.

async function main() {
  const arg = process.argv[2];
  if (arg === "--request") {
    console.log("→ Login con password (dejando listo el token temporal 2FA)…");
    await dropi.requestTwoFactor();
    console.log("✅ Listo. Ahora corre el script con tu código de 6 dígitos.");
  } else if (arg && /^\d{6}$/.test(arg)) {
    console.log("→ Validando código…");
    const ok = await dropi.submitTwoFactor(arg);
    console.log(ok
      ? "✅ Token de Dropi guardado (~12h). Ya puedes correr el dry-run."
      : "❌ Código incorrecto o vencido. Corre --request y prueba con un código fresco.");
  } else {
    console.error("Uso: dropi-2fa.ts --request   |   dropi-2fa.ts <código 6 dígitos>");
    process.exit(1);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("Error:", e.message);
  await prisma.$disconnect();
  process.exit(1);
});
