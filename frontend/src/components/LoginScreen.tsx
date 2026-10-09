import { useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { login as apiLogin, olvideClave, restablecerClave } from "../api/client";
import { BRUT, T } from "../theme/brut";
import MaterialsButton from "./MaterialsPanel";
import Logo from "./Logo";
import type { User } from "../types";

/**
 * Pasos de la tarjeta: entrar, pedir un código para la clave olvidada y
 * elegir la clave nueva con ese código. Son la misma tarjeta y no pantallas
 * aparte porque los tres piden lo mismo —un correo y poco más— y volver a
 * entrar es un clic.
 */
type Paso = "entrar" | "olvide" | "restablecer";

/** Segundos que el servidor hace esperar entre dos envíos (EMAIL_CODE_RESEND). */
const ESPERA_REENVIO = 60;

/**
 * Ingreso. `apiLogin` guarda el token de sesión y devuelve ya el usuario.
 *
 * La tarjeta es una placa apoyada sobre el papel y los campos son huecos
 * practicados en ella: dos niveles, uno que sale y otro que entra, que es toda
 * la jerarquía que este estilo necesita.
 *
 * Desde aquí también se recupera la clave olvidada con un código de seis
 * números enviado al correo. Solo llega a cuentas con el correo confirmado;
 * las de un correo de aula sin buzón las sigue regenerando el docente.
 */
export default function LoginScreen(
  { onLogin, aviso }: { onLogin: (user: User) => void; aviso?: string | null },
) {
  const [paso,       setPaso]       = useState<Paso>("entrar");
  const [email,      setEmail]      = useState("");
  const [password,   setPassword]   = useState("");
  const [codigo,     setCodigo]     = useState("");
  const [nueva,      setNueva]      = useState("");
  const [error,      setError]      = useState("");
  /** Un mensaje que no es un error: «te enviamos un código…». */
  const [info,       setInfo]       = useState("");
  const [espera,     setEspera]     = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Cuenta atrás del reenvío: un paso por segundo, solo mientras hace falta.
  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera(e => e - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  function irA(nuevo: Paso, mensaje = "") {
    setPaso(nuevo);
    setError("");
    setInfo(mensaje);
    setPassword("");
    setCodigo("");
    setNueva("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (paso === "entrar") {
        onLogin(await apiLogin(email, password));
      } else if (paso === "olvide") {
        await olvideClave(email.trim());
        irA("restablecer",
          `Si ${email.trim()} tiene una cuenta con el correo confirmado, te llegará ` +
          "un código de 6 números. Escríbelo y elige tu clave nueva.");
        setEspera(ESPERA_REENVIO);
      } else {
        await restablecerClave(email.trim(), codigo.trim(), nueva);
        irA("entrar", "Listo, ya tienes tu clave nueva. Entra con ella.");
      }
    } catch (err) {
      setInfo("");
      setError(err instanceof Error ? err.message : "Credenciales incorrectas.");
    } finally {
      setSubmitting(false);
    }
  }

  async function reenviar() {
    if (espera > 0 || submitting) return;
    setError("");
    try {
      await olvideClave(email.trim());
      setInfo("Te enviamos otro código. Usa el más nuevo.");
      setCodigo("");
      setEspera(ESPERA_REENVIO);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo reenviar el código.");
    }
  }

  const etiqueta: CSSProperties = { ...T.eyebrow(BRUT.ink), display: "block", marginBottom: 7 };
  const enlace: CSSProperties = {
    background: "none", border: "none", padding: 0, cursor: "pointer",
    color: BRUT.ink, fontSize: 13, fontWeight: 600, textDecoration: "underline",
  };
  const textoBoton =
    paso === "entrar" ? (submitting ? "Ingresando…" : "Entrar")
    : paso === "olvide" ? (submitting ? "Enviando…" : "Enviarme un código")
    : (submitting ? "Cambiando…" : "Cambiar la clave");

  // Lo que se muestra arriba del formulario: el aviso de la raíz (sesión
  // caducada) solo en el primer paso; el de esta pantalla, en cualquiera.
  const mensaje = info || (paso === "entrar" ? aviso : null);

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
            {paso === "entrar"
              ? "Arma figuras con tu Tangram y descubre si quedaron perfectas"
              : "Recupera tu clave con un código enviado a tu correo"}
          </p>
        </div>

        {/* Por qué volvió aquí, o qué pasó con el código. Se distingue del
            error con el ámbar de «a medias»: no hay nada mal, falta un paso. */}
        {mensaje && !error && (
          <p role="status" style={{
            fontSize: 13, fontWeight: 600, color: BRUT.ink, margin: "0 0 18px",
            padding: "12px 15px", textAlign: "center",
            ...BRUT.subtle(BRUT.warning),
          }}>{mensaje}</p>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <label htmlFor="correo" style={etiqueta}>Correo institucional</label>
            {/* `htmlFor`/`id` no son decorativos: sin ellos un lector de
                pantalla no anuncia el nombre del campo y tocar la etiqueta no
                enfoca el cuadro, que en una tableta es el gesto natural. */}
            <input id="correo" name="correo" type="email" autoComplete="username"
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="usuario@tangram.edu" readOnly={paso === "restablecer"}
              style={{ width: "100%" }} required />
          </div>

          {paso === "entrar" && (
            <div>
              <label htmlFor="clave" style={etiqueta}>Contraseña</label>
              <input id="clave" name="clave" type="password" autoComplete="current-password"
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{ width: "100%" }} required />
            </div>
          )}

          {paso === "restablecer" && (
            <>
              <div>
                <label htmlFor="codigo" style={etiqueta}>Código del correo</label>
                <input id="codigo" name="codigo" inputMode="numeric" autoComplete="one-time-code"
                  value={codigo}
                  onChange={e => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000" pattern="\d{6}" title="Los 6 números del correo"
                  style={{ width: "100%", letterSpacing: 6, fontVariantNumeric: "tabular-nums" }}
                  required />
                <div style={{ marginTop: 8, fontSize: 12, color: BRUT.ink }}>
                  ¿No te llegó? Mira también en spam.{" "}
                  <button type="button" onClick={reenviar} disabled={espera > 0}
                    style={{ ...enlace, fontSize: 12, opacity: espera > 0 ? 0.55 : 1 }}>
                    {espera > 0 ? `Otro en ${espera} s` : "Enviar otro"}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="nueva" style={etiqueta}>Clave nueva</label>
                <input id="nueva" name="nueva" type="password" autoComplete="new-password"
                  value={nueva} onChange={e => setNueva(e.target.value)}
                  minLength={4} maxLength={200}
                  style={{ width: "100%" }} required />
              </div>
            </>
          )}

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
          }}>{textoBoton}</button>
        </form>

        <div style={{ textAlign: "center", marginTop: 14 }}>
          {paso === "entrar" ? (
            <button type="button" style={enlace} onClick={() => irA("olvide")}>
              ¿Olvidaste tu contraseña?
            </button>
          ) : (
            <button type="button" style={enlace} onClick={() => irA("entrar")}>
              Volver a entrar
            </button>
          )}
        </div>

        {/* Se consulta **sin cuenta**: es lo que mira el docente para saber qué
            repartir, antes de que ningún estudiante tenga la sesión abierta. */}
        <div style={{ textAlign: "center", marginTop: 14 }}>
          <MaterialsButton variant="link" />
        </div>

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
