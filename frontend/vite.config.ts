import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Inyecta la Content-Security-Policy en el HTML compilado.
 *
 * Solo en `build`: el servidor de desarrollo de Vite necesita `eval` y scripts
 * en línea para la recarga en caliente, y una CSP estricta lo dejaría inservible.
 *
 * La CSP es la defensa que sostiene la decisión de guardar el token de sesión
 * en `localStorage`: si no se puede inyectar script en la página, no hay quien
 * lo lea. `script-src 'self'` es la línea que importa.
 *
 * Cuando la web se sirva desde un servidor de verdad (nginx, Apache), lo mejor
 * es mandar esta misma política como **cabecera** en vez de como `<meta>`: la
 * cabecera cubre también `frame-ancestors`, que en `<meta>` se ignora.
 */
function csp(api: string): Plugin {
  const directivas = [
    "default-src 'self'",
    "script-src 'self'",
    // Los estilos van en línea (el sistema neumórfico se apoya en el atributo
    // `style`). Una inyección de CSS es mucho menos grave que una de script,
    // que es la que queda cerrada arriba.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    // `blob:` es el flujo de la cámara; `data:` la foto ya capturada.
    "media-src 'self' blob:",
    `connect-src 'self' ${api}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')

  return {
    name: 'csp-en-build',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${directivas}">\n` +
        `    <meta http-equiv="X-Content-Type-Options" content="nosniff">\n` +
        `    <meta name="referrer" content="no-referrer">`,
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // `process.env` NO contiene las variables de `.env`: Vite las carga aparte y
  // solo las expone al código de la aplicación (`import.meta.env`), no al de
  // este archivo. Sin `loadEnv` la CSP se compilaba siempre contra
  // `http://localhost:8000`, y un build servido desde cualquier otra dirección
  // bloqueaba todas las llamadas a la API con la consola llena de errores de
  // CSP y las pantallas vacías. Es el mismo valor que verá `import.meta.env`.
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const api = env.VITE_API_URL || 'http://localhost:8000'

  return {
    plugins: [react(), csp(api)],
    server: {
      // La app móvil y los navegadores de otros equipos del aula llegan por la
      // IP de la máquina, no por `localhost`. Sin esto Vite solo escucha en la
      // interfaz local y la web es inalcanzable desde el teléfono.
      host: true,
    },
    build: {
      // Sin mapas de fuente en producción: no hace falta publicar el código
      // original de la aplicación junto al compilado.
      sourcemap: false,
    },
  }
})
