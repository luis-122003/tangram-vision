import Constants from "expo-constants";

/**
 * Dirección del backend, fija dentro del APK.
 *
 * El sistema vive en un servidor con dominio y HTTPS (ver DESPLIEGUE.md), así
 * que la dirección ya no cambia con la red del teléfono y no hay nada que
 * configurar en la app. Se lee de `expo.extra.apiUrl` de `app.json`: para
 * apuntar a otro servidor se cambia ahí y se genera un APK nuevo.
 *
 * Las versiones anteriores guardaban en el teléfono una dirección escrita a
 * mano (`tangram.apiUrl`). Ya no se lee: un teléfono que traiga guardada la IP
 * del aula pasa solo al servidor de verdad al actualizar.
 */
interface Extra {
  apiUrl?: string;
}

/** Quita espacios y la barra final, para poder concatenar `/ruta` sin dobles. */
function normalizeUrl(raw: string): string {
  return raw.trim().replace(/\s+/g, "").replace(/\/+$/, "");
}

const API_URL = normalizeUrl(
  ((Constants.expoConfig?.extra ?? {}) as Extra).apiUrl ?? "",
);

if (API_URL === "") {
  // Un APK sin dirección haría todas las peticiones a rutas relativas, que
  // fallan sin decir por qué. Mejor que falle al construirlo y probarlo.
  throw new Error("Falta expo.extra.apiUrl en app.json: la app no sabe dónde está el servidor.");
}

export function getApiUrl(): string {
  return API_URL;
}
