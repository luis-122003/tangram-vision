import { useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { cambiarMiClave } from "../api/client";
import { BRUT, T } from "../theme/brut";
import type { User } from "../types";

/** Días que vale la clave de un docente. El mismo número que aplica el servidor. */
export const DIAS_VIGENCIA = 30;

/** Mínimo de caracteres, por rol. El servidor exige lo mismo; esto solo evita el viaje. */
function minimoClave(user: User): number {
  return user.role === "teacher" ? 12 : 4;
}

/**
 * «Mi clave»: cambiar la propia contraseña sabiendo la actual.
 *
 * Esta pantalla existe porque la recuperación por correo se quitó. Sin ella, un
 * docente que quisiera cambiar su clave —o que estuviera obligado a hacerlo
 * porque pasó el mes— no habría tenido ni una sola forma de hacerlo desde el
 * navegador, y la única salida habría sido que alguien entrara al servidor.
 *
 * Al terminar **se cierra la sesión**, y no es un efecto secundario que haya que
 * disimular: el servidor revoca todos los tokens del usuario, incluido el de
 * esta pestaña. Quedarse aquí significaría que la siguiente petición devuelve un
 * 401 sin que nada lo explique, así que se avisa y se vuelve al ingreso.
 */
export default function MiClave(
  { user, onCambiada }: { user: User; onCambiada: (mensaje: string) => void },
) {
  const [actual,     setActual]     = useState("");
  const [nueva,      setNueva]      = useState("");
  const [repetir,    setRepetir]    = useState("");
  const [error,      setError]      = useState("");
  const [submitting, setSubmitting] = useState(false);

  const minimo = minimoClave(user);
  const dias = user.password_age_days;
  const caducada = user.password_expired === true;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    // Las tres comprobaciones que se pueden hacer sin preguntarle al servidor.
    // Las mismas las repite él: esto solo ahorra el viaje y el parpadeo.
    if (nueva.length < minimo) {
      setError(`La clave nueva debe tener al menos ${minimo} caracteres.`);
      return;
    }
    if (nueva !== repetir) {
      setError("Las dos claves nuevas no coinciden.");
      return;
    }
    if (nueva === actual) {
      setError("La clave nueva tiene que ser distinta de la actual.");
      return;
    }

    setSubmitting(true);
    try {
      await cambiarMiClave(actual, nueva);
      onCambiada("Clave cambiada. Entra de nuevo con la nueva.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar la clave.");
      setSubmitting(false);
    }
  }

  const etiqueta: CSSProperties = { ...T.eyebrow(BRUT.ink), display: "block", marginBottom: 7 };

  return (
    <div style={{ maxWidth: 460, margin: "0 auto", padding: "1.6rem", ...BRUT.raised(6) }}>
      <h2 style={{ ...T.title(20), margin: "0 0 6px", textTransform: "uppercase" }}>Mi clave</h2>
      <p style={{ ...T.body(), fontSize: 13, margin: "0 0 20px", color: BRUT.muted }}>
        Para cambiarla hay que escribir la actual. Si no la recuerdas, pídele a
        quien administra el servidor que te la reponga: desde aquí no hay otra vía.
      </p>

      {/* La antigüedad, en el sitio donde se va a actuar sobre ella. */}
      {dias != null && (
        <p style={{
          fontSize: 13, fontWeight: 600, color: BRUT.ink, margin: "0 0 18px",
          padding: "12px 15px",
          ...BRUT.subtle(caducada ? BRUT.danger : BRUT.info),
        }}>
          {caducada
            ? `Tu clave lleva ${dias} días puesta y ya pasó el plazo de ${DIAS_VIGENCIA}. ` +
              "El panel queda cerrado hasta que la cambies."
            : `Tu clave lleva ${dias} ${dias === 1 ? "día" : "días"} puesta. ` +
              `Se cambia cada ${DIAS_VIGENCIA}.`}
        </p>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <label htmlFor="actual" style={etiqueta}>Clave actual</label>
          <input id="actual" name="actual" type="password" autoComplete="current-password"
            value={actual} onChange={e => setActual(e.target.value)}
            style={{ width: "100%" }} required />
        </div>
        <div>
          <label htmlFor="nueva" style={etiqueta}>Clave nueva</label>
          <input id="nueva" name="nueva" type="password" autoComplete="new-password"
            value={nueva} onChange={e => setNueva(e.target.value)}
            minLength={minimo} maxLength={200}
            style={{ width: "100%" }} required />
          <p style={{ margin: "7px 0 0", fontSize: 12, color: BRUT.muted }}>
            Mínimo {minimo} caracteres. No valen las fáciles de adivinar (1234, 0000…).
          </p>
        </div>
        <div>
          <label htmlFor="repetir" style={etiqueta}>Repite la clave nueva</label>
          <input id="repetir" name="repetir" type="password" autoComplete="new-password"
            value={repetir} onChange={e => setRepetir(e.target.value)}
            minLength={minimo} maxLength={200}
            style={{ width: "100%" }} required />
        </div>

        {error && (
          <p role="alert" style={{
            fontSize: 13, fontWeight: 600, color: BRUT.ink, margin: 0,
            padding: "12px 15px", textAlign: "center",
            ...BRUT.subtle(BRUT.danger),
          }}>{error}</p>
        )}

        <button type="submit" disabled={submitting} style={{
          ...BRUT.button(submitting, BRUT.success),
          width: "100%", marginTop: 4, padding: "14px", fontSize: 15,
        }}>{submitting ? "Cambiando…" : "Cambiar la clave"}</button>

        <p style={{ margin: 0, fontSize: 12, color: BRUT.muted, textAlign: "center" }}>
          Al cambiarla se cerrará la sesión en todos los dispositivos, también aquí.
        </p>
      </form>
    </div>
  );
}
