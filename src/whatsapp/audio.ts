import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

// WhatsApp solo muestra un audio como NOTA DE VOZ (el control redondo con
// micrófono) cuando llega en OGG con codec Opus. Los navegadores graban en
// formatos distintos —Chrome/Edge en webm/opus, Safari en mp4/aac— y WhatsApp
// rechaza el webm. Por eso transcodificamos siempre a ogg/opus antes de subirlo.
//
// Resolución del binario: FFMPEG_PATH (override de despliegue) → binario que
// trae el paquete ffmpeg-static → "ffmpeg" del PATH del sistema.
function resolveFfmpeg(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const staticPath = require("ffmpeg-static") as string | null;
    if (staticPath) return staticPath;
  } catch {
    /* paquete ausente — caemos al ffmpeg del sistema */
  }
  return "ffmpeg";
}

const FFMPEG = resolveFfmpeg();

/**
 * Convierte cualquier audio grabado en el navegador a OGG/Opus mono, listo para
 * enviarse como nota de voz de WhatsApp. Devuelve null si la conversión falla.
 */
export async function transcodeToWhatsappVoice(input: Buffer): Promise<Buffer | null> {
  const dir = os.tmpdir();
  const id = randomUUID();
  const inPath = path.join(dir, `fb-voice-${id}.in`);
  const outPath = path.join(dir, `fb-voice-${id}.ogg`);

  try {
    await fs.writeFile(inPath, input);

    await runFfmpeg([
      "-y",
      "-i", inPath,
      "-ac", "1",            // mono — requisito de WhatsApp para OGG/Opus
      "-c:a", "libopus",
      "-b:a", "32k",
      "-application", "voip", // optimizado para voz
      "-f", "ogg",
      outPath,
    ]);

    return await fs.readFile(outPath);
  } catch (e: any) {
    console.error("[wa.transcodeVoice]", e?.message ?? e);
    return null;
  } finally {
    fs.unlink(inPath).catch(() => {});
    fs.unlink(outPath).catch(() => {});
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      // Solo guardamos el final del log; ffmpeg es muy verboso.
      stderr = (stderr + d.toString()).slice(-2000);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.trim()}`));
    });
  });
}
