import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

/**
 * Dirección del backend, configurable desde la app.
 *
 * La IP de la PC cambia al moverse de red (casa, universidad, hotspot), así que
 * en vez de dejarla fija dentro del APK se guarda en el teléfono y se puede
 * editar desde la pantalla de ajustes. El valor de `app.json` solo sirve como
 * punto de partida la primera vez que se abre la app.
 */
const STORAGE_KEY = "tangram.apiUrl";

const EXTRA = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string };
export const DEFAULT_API_URL = EXTRA.apiUrl ?? "http://192.168.1.11:8000";

let current = DEFAULT_API_URL;

/** Limpia lo que escriba el usuario: espacios, barra final, esquema faltante. */
export function normalizeUrl(raw: string): string {
  let url = raw.trim().replace(/\s+/g, "");
  if (url === "") return "";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, "");
}

/** Carga la URL guardada. Se llama una vez al arrancar la app. */
export async function loadApiUrl(): Promise<string> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved) current = saved;
  } catch {
    // si falla el almacenamiento se usa el valor por defecto
  }
  return current;
}

export async function setApiUrl(raw: string): Promise<string> {
  const url = normalizeUrl(raw);
  current = url;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, url);
  } catch {
    // no es crítico: al menos queda aplicado en esta sesión
  }
  return url;
}

export function getApiUrl(): string {
  return current;
}
