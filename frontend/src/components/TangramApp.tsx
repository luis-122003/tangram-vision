import { useEffect, useState } from "react";
import { logout as apiLogout } from "../api/client";
import { alExpirarLaSesion, restaurarSesion } from "../api/session";
import LoginScreen from "./LoginScreen";
import Shell from "./Shell";
import type { User } from "../types";

/**
 * Raíz de la aplicación web de Tangram IA.
 *
 * Solo decide una cosa: si hay sesión, se entra; si no, se pide. Cada pantalla
 * vive en su propio archivo dentro de este mismo directorio.
 */
export default function TangramApp() {
  // La sesión sobrevive a una recarga: el token dura una jornada de clase y
  // recargar la página no debería expulsar al niño a media actividad.
  const [user, setUser] = useState<User | null>(() => restaurarSesion());
  /**
   * Por qué se volvió al login. Si la sesión caducó a mitad de partida, el
   * estudiante tiene que leer el motivo: aparecer de golpe ante el formulario,
   * sin foto y sin cronómetro, es indistinguible de un fallo de la aplicación.
   */
  const [aviso, setAviso] = useState<string | null>(null);

  // Si el servidor rechaza el token (caducado, o firmado con otro secreto tras
  // reiniciar el backend), se vuelve al login en vez de dejar pantallas que no
  // cargan y no explican por qué.
  useEffect(() => {
    alExpirarLaSesion((motivo) => {
      setUser(null);
      setAviso(motivo ?? "Tu sesión expiró. Vuelve a iniciar sesión.");
    });
  }, []);

  function handleLogout() {
    // Se avisa al servidor para que invalide también el token de refresco: sin
    // eso, cerrar sesión solo borraría la copia local y el token seguiría
    // siendo válido hasta caducar.
    void apiLogout();
    setUser(null);
    setAviso(null);
  }

  function handleLogin(u: User) {
    setAviso(null);
    setUser(u);
  }

  if (!user) return <LoginScreen onLogin={handleLogin} aviso={aviso} />;
  return <Shell user={user} onLogout={handleLogout} />;
}
