/**
 * plantillas.ts — los dos correos que envía el sistema.
 *
 * Cada uno va en texto y en HTML: el texto es lo que leen los clientes de
 * correo que no pintan HTML y lo que miran los filtros de spam. El nombre del
 * destinatario se escapa antes de entrar en el HTML, porque lo escribió él al
 * registrarse y no tiene por qué ser texto inocente.
 */
import { config } from "../config.js";
import type { Mensaje } from "./transporte.js";

function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function minutosDeVida(): number {
  return Math.max(1, Math.round(config.smtp.codigoSegundos / 60));
}

function html(nombre: string, intro: string, codigo: string, cierre: string): string {
  return `<!doctype html>
<html lang="es"><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2937">
  <p>Hola, ${escaparHtml(nombre)}:</p>
  <p>${intro}</p>
  <p style="font-size:32px;font-weight:bold;letter-spacing:8px;margin:24px 0">${codigo}</p>
  <p>El código vale ${minutosDeVida()} minutos y solo se puede usar una vez.</p>
  <p>${cierre}</p>
  <p style="color:#6b7280;font-size:12px">Tangram IA</p>
</body></html>`;
}

export function correoVerificacion(para: string, nombre: string, codigo: string): Mensaje {
  const intro = "Escribe este código en la app para activar tu cuenta de Tangram IA:";
  const cierre = "Si no te registraste tú, ignora este correo: la cuenta no se activará.";
  return {
    para,
    asunto: `${codigo} es tu código de Tangram IA`,
    texto:
      `Hola, ${nombre}:\n\n${intro}\n\n    ${codigo}\n\n` +
      `El código vale ${minutosDeVida()} minutos y solo se puede usar una vez.\n\n${cierre}\n`,
    html: html(nombre, intro, codigo, cierre),
  };
}

export function correoRecuperacion(para: string, nombre: string, codigo: string): Mensaje {
  const intro = "Pediste cambiar tu clave de Tangram IA. Escribe este código para elegir una nueva:";
  const cierre =
    "Si no lo pediste tú, ignora este correo: tu clave sigue siendo la misma.";
  return {
    para,
    asunto: `${codigo} es tu código para cambiar la clave`,
    texto:
      `Hola, ${nombre}:\n\n${intro}\n\n    ${codigo}\n\n` +
      `El código vale ${minutosDeVida()} minutos y solo se puede usar una vez.\n\n${cierre}\n`,
    html: html(nombre, intro, codigo, cierre),
  };
}
