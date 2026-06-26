import { Agent as HttpsAgent } from "node:https";

// El agente por defecto del SDK de Anthropic mantiene los sockets keep-alive
// vivos hasta 5 minutos. Pero la red de Railway (egress/NAT) cierra las
// conexiones inactivas mucho antes. Como este bot hace pocas llamadas por hora,
// los sockets quedan inactivos, Railway/Anthropic los cierran, y la siguiente
// llamada reutiliza un socket muerto → error "Premature close".
//
// keepAlive:false hace que cada llamada use una conexión nueva y la cierre al
// terminar: nunca se reutiliza un socket que pudo haber muerto. El costo es un
// handshake TLS por llamada (~200-400ms), despreciable al volumen de este bot.
export const anthropicHttpsAgent = new HttpsAgent({ keepAlive: false });
