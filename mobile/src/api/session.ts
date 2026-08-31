import AsyncStorage from "@react-native-async-storage/async-storage";
import type { User } from "./types";

/**
 * session.ts — los tokens de sesión del estudiante.
 *
 * Hay dos. El de **acceso** dura una hora y viaja en cada petición; el de
 * **refresco** dura la jornada y solo sirve para pedir uno de acceso nuevo. Así
 * el que más se expone caduca pronto, y el niño no tiene que volver a teclear
 * su clave a media actividad.
 *
 * Se guardan en el almacenamiento de la app, igual que la dirección del
 * servidor (ver ./config.ts). En Android ese almacenamiento es privado de la
 * aplicación: otra app no puede leerlo salvo en un teléfono rooteado.
 */

const CLAVE_TOKEN = "tangram.token";
const CLAVE_REFRESCO = "tangram.refresh";
const CLAVE_USUARIO = "tangram.user";

let token: string | null = null;
let refresco: string | null = null;
let alExpirar: (() => void) | null = null;

/**
 * Recupera la sesión guardada. Se llama una vez al arrancar la app, junto con
 * `loadApiUrl`, antes de decidir si se muestra el login.
 */
export async function restaurarSesion(): Promise<User | null> {
  try {
    const [guardadoToken, guardadoRefresco, guardadoUsuario] = await Promise.all([
      AsyncStorage.getItem(CLAVE_TOKEN),
      AsyncStorage.getItem(CLAVE_REFRESCO),
      AsyncStorage.getItem(CLAVE_USUARIO),
    ]);
    if (!guardadoToken || !guardadoUsuario) return null;
    token = guardadoToken;
    refresco = guardadoRefresco;
    return JSON.parse(guardadoUsuario) as User;
  } catch {
    return null;
  }
}

export async function iniciarSesion(
  nuevoToken: string, nuevoRefresco: string, usuario: User,
): Promise<void> {
  token = nuevoToken;
  refresco = nuevoRefresco;
  try {
    await AsyncStorage.setItem(CLAVE_TOKEN, nuevoToken);
    await AsyncStorage.setItem(CLAVE_REFRESCO, nuevoRefresco);
    await AsyncStorage.setItem(CLAVE_USUARIO, JSON.stringify(usuario));
  } catch {
    // Sin almacenamiento la sesión sigue viva mientras la app esté abierta.
  }
}

/** Guarda el token de acceso recién refrescado, sin tocar el de refresco. */
export async function actualizarAcceso(nuevoToken: string): Promise<void> {
  token = nuevoToken;
  try {
    await AsyncStorage.setItem(CLAVE_TOKEN, nuevoToken);
  } catch {
    // Queda aplicado en memoria para esta sesión.
  }
}

export async function cerrarSesion(): Promise<void> {
  token = null;
  refresco = null;
  try {
    await AsyncStorage.removeItem(CLAVE_TOKEN);
    await AsyncStorage.removeItem(CLAVE_REFRESCO);
    await AsyncStorage.removeItem(CLAVE_USUARIO);
  } catch {
    // Los tokens ya se borraron de memoria, que es lo que impide seguir usándolos.
  }
}

export function obtenerRefresco(): string | null { return refresco; }

/**
 * El token de acceso vigente. Lo necesita `logout()`, que borra la sesión del
 * teléfono **antes** de avisar al servidor y tiene que quedarse con una copia
 * para poder hacer esa última petición autenticada.
 */
export function obtenerAcceso(): string | null { return token; }

/** Cabecera `Authorization` para las peticiones autenticadas. */
export function cabeceraAuth(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Qué hacer cuando la sesión ya no se puede recuperar. Lo registra App.tsx. */
export function alExpirarLaSesion(callback: () => void): void {
  alExpirar = callback;
}

/** La llama el cliente HTTP cuando ni el refresco sirve. */
export function sesionExpirada(): void {
  void cerrarSesion();
  alExpirar?.();
}
