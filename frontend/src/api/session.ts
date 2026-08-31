import type { User } from "../types";

/**
 * session.ts — el token de sesión y quién lo tiene.
 *
 * Hay dos tokens. El de **acceso** dura una hora y viaja en cada petición; el
 * de **refresco** dura la jornada y solo sirve para pedir uno de acceso nuevo.
 * Así, si el de acceso se filtrara, la ventana de uso es corta.
 *
 * Se guardan en `localStorage` para que recargar la página no expulse al niño a
 * media actividad. Eso los deja al alcance de un XSS, y por eso el backend
 * manda una CSP estricta y React escapa todo lo que pinta: la defensa contra el
 * robo del token es que no se pueda inyectar script, no esconderlo.
 *
 * Si alguna vez esta web pasa a servirse con contenido de terceros, lo correcto
 * sería mover el token a una cookie httpOnly.
 */

const CLAVE_TOKEN = "tangram.token";
const CLAVE_REFRESCO = "tangram.refresh";
const CLAVE_USUARIO = "tangram.user";

let token: string | null = null;
let refresco: string | null = null;
let usuario: User | null = null;
let alExpirar: ((motivo?: string) => void) | null = null;

/** Lee lo guardado. `localStorage` puede fallar (modo privado, permisos). */
function leer<T>(clave: string, comoJson: boolean): T | null {
  try {
    const bruto = localStorage.getItem(clave);
    if (!bruto) return null;
    return (comoJson ? JSON.parse(bruto) : bruto) as T;
  } catch {
    return null;
  }
}

function escribir(clave: string, valor: string | null): void {
  try {
    if (valor === null) localStorage.removeItem(clave);
    else localStorage.setItem(clave, valor);
  } catch {
    // Sin almacenamiento la sesión sigue viva en memoria; solo no sobrevive a
    // una recarga. No es motivo para impedir el uso de la aplicación.
  }
}

/** Restaura la sesión guardada al arrancar la aplicación. */
export function restaurarSesion(): User | null {
  token = leer<string>(CLAVE_TOKEN, false);
  refresco = leer<string>(CLAVE_REFRESCO, false);
  usuario = leer<User>(CLAVE_USUARIO, true);
  if (!token || !usuario) {
    cerrarSesion();
    return null;
  }
  return usuario;
}

export function iniciarSesion(
  nuevoToken: string, nuevoRefresco: string, nuevoUsuario: User,
): void {
  token = nuevoToken;
  refresco = nuevoRefresco;
  usuario = nuevoUsuario;
  escribir(CLAVE_TOKEN, nuevoToken);
  escribir(CLAVE_REFRESCO, nuevoRefresco);
  escribir(CLAVE_USUARIO, JSON.stringify(nuevoUsuario));
}

/** Guarda el token de acceso recién refrescado, sin tocar el de refresco. */
export function actualizarAcceso(nuevoToken: string): void {
  token = nuevoToken;
  escribir(CLAVE_TOKEN, nuevoToken);
}

export function cerrarSesion(): void {
  token = null;
  refresco = null;
  usuario = null;
  escribir(CLAVE_TOKEN, null);
  escribir(CLAVE_REFRESCO, null);
  escribir(CLAVE_USUARIO, null);
}

export function obtenerToken(): string | null { return token; }
export function obtenerRefresco(): string | null { return refresco; }

/** Cabecera `Authorization` para las peticiones autenticadas. */
export function cabeceraAuth(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Registra qué hacer cuando la sesión ya no se puede recuperar. Lo usa la raíz
 * de la aplicación para devolver al usuario al login en vez de dejarlo ante una
 * pantalla que no carga y no explica por qué.
 */
export function alExpirarLaSesion(callback: (motivo?: string) => void): void {
  alExpirar = callback;
}

/**
 * La llama el cliente HTTP cuando ni el refresco sirve.
 *
 * El `motivo` es el texto que dio el backend. Sin él, el estudiante aparecía de
 * golpe en el login a mitad de partida sin una sola palabra que lo explicara,
 * que es justo lo que este mecanismo existe para evitar.
 */
export function sesionExpirada(motivo?: string): void {
  cerrarSesion();
  alExpirar?.(motivo);
}
