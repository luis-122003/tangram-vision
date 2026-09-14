import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

/**
 * Dirección del backend, configurable desde la app y averiguable sola.
 *
 * La IP de la PC cambia al moverse de red (casa, universidad, hotspot), así que
 * no puede quedar fija dentro del APK: se guarda en el teléfono y se edita
 * desde la pantalla de ajustes.
 *
 * Encima de eso, la app se sabe de memoria las direcciones donde ya encontró el
 * servidor alguna vez —las de `app.json` más las que se hayan escrito a mano— y
 * al arrancar prueba todas para quedarse con la que conteste (ver
 * `buscarServidor` en ./client.ts). Es lo que evita tener que corregir la
 * dirección a mano cada vez que se llega al aula: la primera vez se escribe una
 * sola vez, y de ahí en adelante cambiar de red no pide nada.
 *
 * Para hornear una dirección nueva en el APK basta añadirla a
 * `expo.extra.apiUrls` de `app.json`; nada más en el código depende de ella.
 */
const STORAGE_KEY = "tangram.apiUrl";
/** Direcciones que ya se usaron, de la más reciente a la más vieja. */
const HISTORY_KEY = "tangram.apiUrls";
/**
 * Cuántas direcciones se recuerdan. Son las que se sondean al arrancar, y el
 * sondeo va en paralelo, así que el tope no es por tiempo sino para que la
 * lista de atajos de Ajustes siga siendo legible.
 */
const HISTORY_MAX = 6;

/** Una red con nombre: lo que se toca en Ajustes para cambiar de sitio. */
export interface RedConocida {
  etiqueta: string;
  url:      string;
}

interface Extra {
  apiUrl?:  string;
  apiUrls?: { etiqueta?: string; label?: string; url?: string }[];
}

const EXTRA = (Constants.expoConfig?.extra ?? {}) as Extra;

/**
 * Dirección de reserva por si `app.json` no trae ninguna. No es la fuente de
 * verdad: la lista de verdad está en `expo.extra.apiUrls`, que es donde hay que
 * añadirlas para no tener que tocar el código.
 *
 * Es `localhost` a propósito, y no la IP de ninguna red concreta. Una dirección
 * real aquí solo sirve en la red donde se escribió —en cualquier otra es una
 * ruta muerta que hace perder tiempo antes de mirar los ajustes—, y además
 * describe la red interna de quien la puso a todo el que lea el repositorio.
 *
 * Desde un teléfono, `localhost` es el propio teléfono y nunca va a responder.
 * Eso es correcto: obliga a escribir la dirección del servidor en Ajustes, que
 * es el único dato que la app no puede adivinar. Cada quien añade las suyas en
 * `expo.extra.apiUrls` de su `app.json`.
 */
const RED_DE_RESERVA: RedConocida = {
  etiqueta: "Servidor local",
  url:      "http://localhost:8000",
};

/** Limpia lo que escriba el usuario: espacios, barra final, esquema faltante. */
export function normalizeUrl(raw: string): string {
  let url = raw.trim().replace(/\s+/g, "");
  if (url === "") return "";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, "");
}

/**
 * Las redes horneadas en el APK.
 *
 * Todo lo que viene de `app.json` pasa por `normalizeUrl`: un espacio de más al
 * teclear la IP —`"http:// 192.168.1.10:8000"`— dejaba una URL inválida como
 * dirección por defecto, y el fallo aparecía luego como «no se pudo conectar»
 * sin decir que la culpa estaba en la configuración.
 */
export const REDES_CONOCIDAS: RedConocida[] = (() => {
  const desdeConfig = (EXTRA.apiUrls ?? [])
    .map(r => ({
      etiqueta: (r.etiqueta ?? r.label ?? "").trim(),
      url:      normalizeUrl(r.url ?? ""),
    }))
    .filter(r => r.url !== "")
    .map(r => ({ etiqueta: r.etiqueta === "" ? nombreDeHost(r.url) : r.etiqueta, url: r.url }));

  const lista = desdeConfig.length > 0 ? desdeConfig : [RED_DE_RESERVA];

  // `extra.apiUrl` es el campo antiguo, de cuando solo había una dirección. Se
  // sigue respetando para no romper una configuración vieja, y va primero.
  const suelta = normalizeUrl(EXTRA.apiUrl ?? "");
  if (suelta !== "" && !lista.some(r => r.url === suelta)) {
    lista.unshift({ etiqueta: nombreDeHost(suelta), url: suelta });
  }
  return lista;
})();

export const DEFAULT_API_URL = REDES_CONOCIDAS[0]?.url ?? RED_DE_RESERVA.url;

let current = DEFAULT_API_URL;
let historial: string[] = [];

/**
 * Quien esté mostrando la dirección en pantalla.
 *
 * La dirección ya no cambia solo cuando alguien la escribe: la búsqueda
 * automática puede reemplazarla mientras el ingreso está a la vista, y esa
 * pantalla tiene que decir a dónde se va a conectar de verdad, no a dónde
 * apuntaba al dibujarse.
 */
const oyentes = new Set<(url: string) => void>();

function avisar(): void {
  for (const oyente of oyentes) oyente(current);
}

/** Deja de escuchar con la función que devuelve. */
export function suscribirseAApiUrl(oyente: (url: string) => void): () => void {
  oyentes.add(oyente);
  return () => { oyentes.delete(oyente); };
}

/** La dirección en uso, y se vuelve a dibujar si cambia. */
export function useApiUrl(): string {
  const [url, setUrl] = useState(current);
  useEffect(() => {
    // Puede haber cambiado entre el primer dibujo y este efecto: la búsqueda
    // del arranque corre en paralelo.
    setUrl(current);
    return suscribirseAApiUrl(setUrl);
  }, []);
  return url;
}

/** `192.168.1.10:8000`, para etiquetar una dirección sin nombre propio. */
export function nombreDeHost(url: string): string {
  return url.replace(/^https?:\/\//i, "");
}

/** Carga la URL guardada y el historial. Se llama una vez al arrancar la app. */
export async function loadApiUrl(): Promise<string> {
  try {
    const [guardada, crudo] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY),
      AsyncStorage.getItem(HISTORY_KEY),
    ]);
    if (guardada) current = normalizeUrl(guardada) || current;
    if (crudo) {
      const lista: unknown = JSON.parse(crudo);
      if (Array.isArray(lista)) {
        historial = lista
          .filter((u): u is string => typeof u === "string")
          .map(u => normalizeUrl(u))
          .filter(u => u !== "")
          .slice(0, HISTORY_MAX);
      }
    }
  } catch {
    // si falla el almacenamiento se usa el valor por defecto
  }
  avisar();
  return current;
}

export async function setApiUrl(raw: string): Promise<string> {
  const url = normalizeUrl(raw);
  current = url;
  if (url !== "") {
    historial = [url, ...historial.filter(u => u !== url)].slice(0, HISTORY_MAX);
  }
  try {
    // Dos `setItem` y no un `multiSet`: esta versión del paquete no lo expone.
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEY, url),
      AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(historial)),
    ]);
  } catch {
    // no es crítico: al menos queda aplicado en esta sesión
  }
  avisar();
  return url;
}

export function getApiUrl(): string {
  return current;
}

/**
 * Todas las direcciones donde puede estar el servidor, en orden de apuesta: la
 * que se está usando, las que se usaron antes y las horneadas en el APK.
 *
 * La primera es siempre la actual, y de eso depende `buscarServidor`: prueba
 * esa sola antes de sondear el resto, para no cambiar de dirección cuando la
 * que hay funciona.
 */
export function candidatasApiUrl(): string[] {
  const vistas = new Set<string>();
  const lista: string[] = [];
  for (const url of [current, ...historial, ...REDES_CONOCIDAS.map(r => r.url)]) {
    if (url !== "" && !vistas.has(url)) {
      vistas.add(url);
      lista.push(url);
    }
  }
  return lista;
}

/**
 * Los atajos de red que se muestran en Ajustes: las horneadas con su nombre
 * («Universidad») y detrás las que se escribieron a mano, etiquetadas con su
 * propia dirección. Un toque en cualquiera es todo lo que hace falta para
 * mudarse de red.
 */
export function atajosDeRed(): RedConocida[] {
  const vistas = new Set(REDES_CONOCIDAS.map(r => r.url));
  const guardadas = historial
    .filter(url => !vistas.has(url))
    .map(url => ({ etiqueta: nombreDeHost(url), url }));
  return [...REDES_CONOCIDAS, ...guardadas];
}
