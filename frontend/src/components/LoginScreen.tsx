import { useState } from "react";
import type { FormEvent } from "react";
import { login as apiLogin } from "../api/client";
import { BRUT, T } from "../theme/brut";
import Logo from "./Logo";
import type { User } from "../types";

/**
 * Ingreso. `apiLogin` guarda el token de sesión y devuelve ya el usuario.
 *
 * La tarjeta es una placa apoyada sobre el papel y los campos son huecos
 * practicados en ella: dos niveles, uno que sale y otro que entra, que es toda
 * la jerarquía que este estilo necesita.
 */
export default function LoginScreen(
  { onLogin, aviso }: { onLogin: (user: User) => void; aviso?: string | null },
) {
  const [email,      setEmail]      = useState("");
  const [password,   setPassword]   = useState("");
  const [error,      setError]      = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      onLogin(await apiLogin(email, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Credenciales incorrectas.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{
      minHeight: "100svh", display: "grid", placeItems: "center",
      background: BRUT.paper, padding: "1.5rem",
    }}>
      <div style={{
        padding: "2.5rem", width: "100%", maxWidth: 400,
        ...BRUT.raised(8),
      }}>
        <div style={{ marginBottom: "2.25rem", textAlign: "center" }}>
          <div style={{
            width: 72, height: 72, margin: "0 auto 18px",
            display: "grid", placeItems: "center", ...BRUT.raised(5, BRUT.paper),
          }}>
            <Logo size={34} />
          </div>
          <h1 style={{ ...T.display(32), margin: "0 0 8px", textTransform: "uppercase" }}>
            Tangram IA
          </h1>
          <p style={{ ...T.body(), margin: 0, fontSize: 13 }}>
            Arma figuras con tu Tangram y descubre si quedaron perfectas
          </p>
        </div>

        {/* Por qué volvió aquí. Se distingue del error de credenciales con el
            ámbar de «a medias»: la clave no estaba mal, se acabó el tiempo. */}
        {aviso && !error && (
          <p role="status" style={{
            fontSize: 13, fontWeight: 600, color: BRUT.ink, margin: "0 0 18px",
            padding: "12px 15px", textAlign: "center",
            ...BRUT.subtle(BRUT.warning),
          }}>{aviso}</p>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <label htmlFor="correo"
              style={{ ...T.eyebrow(BRUT.ink), display: "block", marginBottom: 7 }}>
              Correo institucional
            </label>
            {/* `htmlFor`/`id` no son decorativos: sin ellos un lector de
                pantalla no anuncia el nombre del campo y tocar la etiqueta no
                enfoca el cuadro, que en una tableta es el gesto natural. */}
            <input id="correo" name="correo" type="email" autoComplete="username"
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="usuario@tangram.edu"
              style={{ width: "100%" }} required />
          </div>
          <div>
            <label htmlFor="clave"
              style={{ ...T.eyebrow(BRUT.ink), display: "block", marginBottom: 7 }}>
              Contraseña
            </label>
            <input id="clave" name="clave" type="password" autoComplete="current-password"
              value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{ width: "100%" }} required />
          </div>
          {/* El error va en rojo y con la palabra escrita: dos canales para lo
              único que puede dejar al estudiante fuera de la aplicación. */}
          {error && (
            <p role="alert" style={{
              fontSize: 13, fontWeight: 600, color: BRUT.ink, margin: 0,
              padding: "12px 15px", textAlign: "center",
              ...BRUT.subtle(BRUT.danger),
            }}>{error}</p>
          )}
          <button type="submit" disabled={submitting} style={{
            ...BRUT.button(submitting, BRUT.success),
            width: "100%", marginTop: 4, padding: "15px", fontSize: 16,
          }}>{submitting ? "Ingresando…" : "Entrar"}</button>
        </form>

        <div style={{
          marginTop: 24, padding: "15px 17px", fontSize: 12,
          color: BRUT.ink, lineHeight: 1.7, ...BRUT.inset(),
        }}>
          <strong style={{ ...T.eyebrow(BRUT.ink), display: "block", marginBottom: 4 }}>
            Demo
          </strong>
          Estudiante: estudiante@tangram.edu / 1234<br/>
          Docente: docente@tangram.edu / 1234
        </div>
      </div>
    </div>
  );
}
