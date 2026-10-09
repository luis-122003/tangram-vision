/**
 * transporte.ts — salida de correo por SMTP.
 *
 * Solo envía los códigos de verificación y de recuperación de clave, así que
 * es deliberadamente pequeño: un transporte, creado la primera vez que hace
 * falta, y una función para mandar un mensaje.
 *
 * Nada de lo que pasa por aquí se escribe en el registro: ni el destinatario
 * ni el cuerpo. El cuerpo lleva un código que abre una cuenta, y el
 * destinatario es el correo de un menor, que en la base va cifrado.
 */
import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config.js";

let transporte: Transporter | null = null;

/** ¿El servidor SMTP está en esta misma máquina? Ver `requireTLS` abajo. */
function esLocal(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function obtenerTransporte(): Transporter {
  if (transporte) return transporte;
  const { host, port, seguro, usuario, clave } = config.smtp;
  transporte = nodemailer.createTransport({
    host,
    port,
    secure: seguro,
    // Sin `secure`, nodemailer intenta STARTTLS pero sigue en claro si el
    // servidor no lo ofrece. Con `requireTLS` se niega a enviar: un servidor
    // que no cifra no recibe la contraseña del buzón ni ningún código. Solo se
    // exime al servidor local de desarrollo, que no tiene red de por medio.
    requireTLS: !seguro && !esLocal(host),
    auth: usuario ? { user: usuario, pass: clave } : undefined,
    // Topes de espera: un SMTP colgado no puede dejar colgada la petición del
    // niño hasta que el teléfono se rinda.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return transporte;
}

export interface Mensaje {
  para: string;
  asunto: string;
  texto: string;
  html: string;
}

export async function enviarCorreo(m: Mensaje): Promise<void> {
  await obtenerTransporte().sendMail({
    from: config.smtp.remitente,
    to: m.para,
    subject: m.asunto,
    text: m.texto,
    html: m.html,
  });
}

/**
 * Comprueba al arrancar que el servidor SMTP responde y acepta las
 * credenciales. Solo avisa: igual que con el servicio de visión, un backend en
 * pie que explica el problema sirve más que uno que no arranca.
 */
export function comprobarCorreo(): void {
  if (!config.smtp.activo) {
    console.warn(
      "[!] SMTP sin configurar (SMTP_HOST / SMTP_FROM en backend/.env): el registro\n" +
      "    desde la app y la recuperación de clave quedan cerrados (responden 503).",
    );
    return;
  }
  obtenerTransporte()
    .verify()
    .then(() => console.log(`[OK] SMTP en ${config.smtp.host}:${config.smtp.port}`))
    .catch((error: Error) => {
      console.error(
        `[!] El servidor SMTP ${config.smtp.host}:${config.smtp.port} no responde o ` +
        `rechaza las credenciales: ${error.message}`,
      );
    });
}
