import { useEffect, useState } from "react";

/**
 * useMedia — una media query como un booleano de React.
 *
 * Esta aplicación pinta con estilos en línea y no con clases, así que las
 * media queries del CSS no sirven: un estilo en línea gana siempre a cualquier
 * regla de la hoja, y la alternativa habría sido llenar `index.css` de
 * `!important`. Preguntándolo desde JavaScript, cada componente elige su
 * disposición con un `if` normal y corriente, que además es lo que ya se hace
 * en este código con el rol del usuario.
 *
 * Escucha el evento `change` de `matchMedia` en vez de el `resize` de la
 * ventana: solo despierta cuando se cruza el umbral, y no sesenta veces por
 * segundo mientras alguien arrastra el borde.
 */
export function useMedia(consulta: string): boolean {
  const [coincide, setCoincide] = useState(
    () => typeof window !== "undefined" && window.matchMedia(consulta).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(consulta);
    const alCambiar = () => setCoincide(mq.matches);
    // Se vuelve a leer al montar: entre el primer render y este efecto puede
    // haber cambiado el tamaño, y en ese hueco cabe una rotación de tableta.
    alCambiar();
    mq.addEventListener("change", alCambiar);
    return () => mq.removeEventListener("change", alCambiar);
  }, [consulta]);

  return coincide;
}

/**
 * Los dos cortes de la aplicación, y por qué están donde están.
 *
 * 900 px es donde la barra superior deja de caber en una línea con sus cuatro
 * pestañas, el nombre y el botón de salir. 560 px es una pantalla de teléfono
 * en vertical, donde cualquier rejilla de dos columnas da columnas de
 * doscientos píxeles y deja de ayudar.
 *
 * Son dos y no cinco a propósito: cada corte es una disposición más que hay
 * que mirar cuando se toca algo.
 */
export const ESTRECHO = "(max-width: 900px)";
export const TELEFONO = "(max-width: 560px)";

export const useEstrecho = () => useMedia(ESTRECHO);
export const useTelefono = () => useMedia(TELEFONO);
