import { useEffect, useState, type CSSProperties } from "react";
import {
  createStudent, deleteStudent, getStudents, resetStudentPassword, updateStudent,
} from "../api/client";
import { BRUT, T } from "../theme/brut";
import type { Student, StudentCreated } from "../types";

/**
 * Gestión de estudiantes: alta, edición, baja y clave temporal.
 *
 * La pantalla gira alrededor de un dato incómodo: **la clave temporal se
 * enseña una sola vez**. El servidor la genera, guarda su hash y la devuelve en
 * la respuesta del alta; a partir de ahí no existe ninguna consulta que la
 * recupere. Eso es lo correcto —una clave consultable meses después es una
 * clave que sigue estando a mano de cualquiera que abra el panel—, pero obliga
 * a que la interfaz no la trate como una notificación más.
 *
 * De ahí las tres decisiones de esta vista:
 *
 *   · El aviso con la clave **no se cierra solo** ni se va al recargar la
 *     lista. Se queda hasta que el docente pulsa «Ya la anoté».
 *   · La clave se pinta enorme y en monoespaciada, que es como se lee en voz
 *     alta un número que hay que dictar a un niño de primaria.
 *   · Dar de baja y resetear piden confirmación **en la propia fila**, no con
 *     un `confirm()` del navegador: el botón de borrar está a dos píxeles del
 *     de editar y la baja se lleva por delante el historial del estudiante.
 *
 * La columna «estado» es la que responde a la pregunta que trae al docente
 * aquí: quién ya activó su perfil y quién sigue con la clave que le repartieron.
 */
export default function StudentsAdmin() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState("");

  // Alta
  const [name,     setName]     = useState("");
  const [email,    setEmail]    = useState("");
  /**
   * Contraseña elegida por el docente. Vacía significa «genérala tú»: se envía
   * omitiendo el campo, y la cuenta nace con los cuatro dígitos de siempre.
   */
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);

  /**
   * La clave recién generada, del alta o de un reseteo. Mientras esté aquí, el
   * aviso se queda en pantalla: es el único momento en que ese valor existe
   * fuera del hash de la base.
   */
  const [entregada, setEntregada] = useState<StudentCreated | null>(null);
  const [copiada,   setCopiada]   = useState(false);

  // Edición y confirmaciones, siempre de una fila a la vez.
  const [editId,   setEditId]   = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editMail, setEditMail] = useState("");
  const [confirmando, setConfirmando] = useState<{ id: number; que: "baja" | "clave" } | null>(null);
  const [ocupado,  setOcupado]  = useState(false);

  async function cargar() {
    setError("");
    try {
      setStudents(await getStudents());
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la lista");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void cargar(); }, []);

  /**
   * Envuelve una acción sobre una fila.
   *
   * Recarga la lista al terminar en vez de retocar el array en memoria: las
   * cifras de progreso y el estado de la clave los calcula el servidor, y
   * adivinarlos aquí es la forma habitual de que la pantalla acabe contando
   * algo distinto de lo que hay en la base.
   */
  async function accion(fn: () => Promise<void>) {
    if (ocupado) return;
    setOcupado(true);
    setError("");
    try {
      await fn();
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la operación");
    } finally {
      setOcupado(false);
      setConfirmando(null);
    }
  }

  /**
   * La clave se manda sin `trim`.
   *
   * El nombre y el correo sí se recortan —un espacio al final es siempre un
   * descuido—, pero en una contraseña ese espacio puede ser parte de lo que el
   * docente escribió a propósito, y quitárselo aquí crearía la cuenta con una
   * clave distinta de la que se va a llevar anotada.
   */
  const claveElegida = password === "" ? undefined : password;
  const claveCorta   = claveElegida !== undefined && claveElegida.length < 4;
  const altaInvalida = name.trim() === "" || email.trim() === "" || claveCorta;

  async function alta(e: React.FormEvent) {
    e.preventDefault();
    if (creating || altaInvalida) return;
    setCreating(true);
    setError("");
    try {
      const resultado = await createStudent(name.trim(), email.trim(), claveElegida);
      setEntregada(resultado);
      setCopiada(false);
      setName("");
      setEmail("");
      setPassword("");
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el estudiante");
    } finally {
      setCreating(false);
    }
  }

  function empezarEdicion(s: Student) {
    setEditId(s.id);
    setEditName(s.name);
    setEditMail(s.email);
    setConfirmando(null);
  }

  /**
   * Copia la clave al portapapeles.
   *
   * `navigator.clipboard` no existe fuera de un contexto seguro, y esta web se
   * sirve por HTTP plano en la red del aula: ahí el método es `undefined` y el
   * botón reventaba en vez de no hacer nada. Con el fallo recogido, el docente
   * siempre puede leerla de la pantalla, que es el camino que de verdad se usa.
   */
  function copiar(clave: string) {
    navigator.clipboard?.writeText(clave)
      .then(() => setCopiada(true))
      .catch(() => setCopiada(false));
  }

  const celda: CSSProperties = {
    padding: "12px 14px",
    borderBottom: `${BRUT.borderThin}px solid ${BRUT.ink}`,
    fontSize: 13,
    color: BRUT.ink,
  };

  const campo: CSSProperties = {
    padding: "10px 12px", fontSize: 14, fontWeight: 600, color: BRUT.ink,
    width: "100%", boxSizing: "border-box", ...BRUT.inset(),
  };

  const botonFila: CSSProperties = {
    padding: "7px 12px", fontSize: 11, cursor: "pointer",
    fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
    color: BRUT.ink, ...BRUT.subtle(BRUT.card),
  };

  const pendientes = students.filter(s => s.must_change_password).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      {/* ── La clave recién entregada ─────────────────────────────────────── */}
      {entregada && (
        <div style={{ padding: "1.4rem", ...BRUT.raised(6, BRUT.warning) }}>
          <p style={{ ...T.eyebrow(BRUT.ink), margin: "0 0 4px" }}>
            {/* Sin el `?.`, un estudiante dado de baja desde otra pestaña entre
                la generación de la clave y la relectura de su fila tumbaba esta
                pantalla justo cuando enseña el único valor irrecuperable.
                «Temporal» solo si de verdad lo es: la que escribe el docente al
                dar de alta es ya la contraseña de la cuenta, y llamarla temporal
                le haría esperar un cambio de clave que no va a ocurrir. */}
            {entregada.student && !entregada.student.must_change_password
              ? "Clave de "
              : "Clave temporal de "}
            {entregada.student?.name ?? "el estudiante"}
          </p>
          <p style={{ ...T.body(BRUT.ink), margin: "0 0 14px", fontWeight: 600 }}>
            {entregada.detail}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <span style={{
              ...T.stat(44), letterSpacing: 8, padding: "10px 22px",
              fontFamily: "var(--font-mono)", ...BRUT.raised(4, BRUT.paper),
            }}>{entregada.temporary_password}</span>
            <button
              onClick={() => copiar(entregada.temporary_password)}
              style={{ ...BRUT.button(false, BRUT.card), fontSize: 13 }}
            >{copiada ? "Copiada" : "Copiar"}</button>
            <button
              onClick={() => { setEntregada(null); setCopiada(false); }}
              style={{ ...BRUT.button(false, BRUT.success), fontSize: 13 }}
            >Ya la anoté</button>
          </div>
        </div>
      )}

      {/* ── Alta ──────────────────────────────────────────────────────────── */}
      <form onSubmit={alta} style={{ padding: "1.4rem", ...BRUT.raised(6) }}>
        <p style={{ ...T.title(18), margin: "0 0 16px", textTransform: "uppercase" }}>
          Dar de alta un estudiante
        </p>
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 0.9fr auto",
          gap: 12, alignItems: "center",
        }}>
          <input
            value={name} onChange={e => setName(e.target.value)}
            placeholder="Nombre y apellido" style={campo} maxLength={120}
            aria-label="Nombre del estudiante"
          />
          <input
            value={email} onChange={e => setEmail(e.target.value)}
            placeholder="correo@colegio.edu" style={campo} type="email" maxLength={254}
            aria-label="Correo del estudiante"
          />
          {/* En claro y no `type="password"`: la escribe el docente para
              dictársela a un niño, así que lo útil es verla mientras la teclea.
              Ocultarla solo serviría para darla de alta con una errata que nadie
              podría comprobar, y su valor va a aparecer igual, enorme, en el
              aviso de arriba en cuanto se cree la cuenta. */}
          <input
            value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Clave (opcional)" style={campo} maxLength={200}
            aria-label="Contraseña del estudiante (opcional)"
            autoComplete="off"
          />
          <button
            type="submit" disabled={creating || altaInvalida}
            style={BRUT.button(creating || altaInvalida, BRUT.accent)}
          >{creating ? "Creando…" : "Crear"}</button>
        </div>
        <p style={{ ...T.body(BRUT.muted), margin: "12px 0 0", fontSize: 12 }}>
          {claveCorta
            ? "La contraseña debe tener al menos 4 caracteres."
            : claveElegida !== undefined
              ? "Se creará con esa contraseña y el estudiante podrá entrar con ella " +
                "directamente. Anótala: no se puede volver a consultar."
              : "Si dejas la clave vacía, el sistema genera una de cuatro dígitos y la " +
                "muestra una sola vez; el estudiante tendrá que cambiarla la primera " +
                "vez que entre en la app."}
        </p>
        {/* La otra puerta de alta. Se dice aquí, junto al formulario, porque es
            donde el docente se pregunta por qué hay en la lista un nombre que
            él no escribió. */}
        <p style={{ ...T.body(BRUT.muted), margin: "6px 0 0", fontSize: 12 }}>
          El estudiante también puede crearse la cuenta desde la pantalla de
          ingreso de la app, con su nombre, su correo y una clave de cuatro
          dígitos que elige él. Aparece en esta lista con el perfil ya activo.
        </p>
      </form>

      {error !== "" && (
        <div style={{ padding: "1rem 1.3rem", ...BRUT.raised(4, BRUT.danger) }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: BRUT.ink }}>{error}</p>
        </div>
      )}

      {/* ── Lista ─────────────────────────────────────────────────────────── */}
      <div style={{ padding: "1.4rem", ...BRUT.raised(6) }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, margin: "0 0 16px",
        }}>
          <p style={{ ...T.title(18), margin: 0, textTransform: "uppercase" }}>
            Estudiantes
            <span style={{
              fontWeight: 500, fontSize: 12, color: BRUT.muted,
              marginLeft: 10, letterSpacing: 0, textTransform: "none",
            }}>
              {students.length} en total
              {pendientes > 0 && ` · ${pendientes} sin activar su perfil`}
            </span>
          </p>
          {/* Los registros desde la app llegan mientras esta pestaña está
              abierta: con esto el docente los ve sin recargar la página. */}
          <button
            type="button" onClick={() => void cargar()} disabled={ocupado}
            style={{ ...botonFila, padding: "8px 14px" }}
            title="Volver a pedir la lista al servidor"
          >Actualizar</button>
        </div>

        {loading ? (
          <p style={{ padding: "2rem", textAlign: "center", color: BRUT.muted, fontSize: 14, margin: 0 }}>
            Cargando…
          </p>
        ) : students.length === 0 ? (
          <p style={{ padding: "2rem", textAlign: "center", color: BRUT.muted, fontSize: 14, margin: 0 }}>
            Todavía no hay estudiantes dados de alta.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 13, minWidth: 880, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: BRUT.ink }}>
                  {["Estudiante", "Correo", "Estado", "Alta", "Intentos", "Último intento", ""].map(h => (
                    <th key={h} style={{
                      ...T.eyebrow(BRUT.paper), fontSize: 10,
                      padding: "11px 14px", textAlign: "left",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {students.map(s => {
                  const editando = editId === s.id;
                  const confirma = confirmando?.id === s.id ? confirmando.que : null;
                  return (
                    <tr key={s.id}>
                      <td style={{ ...celda, fontWeight: 800 }}>
                        {editando
                          ? <input value={editName} onChange={e => setEditName(e.target.value)}
                                   style={{ ...campo, fontSize: 13 }} aria-label="Nombre" />
                          : s.name}
                      </td>
                      <td style={{ ...celda, fontWeight: 500 }}>
                        {editando
                          ? <input value={editMail} onChange={e => setEditMail(e.target.value)}
                                   style={{ ...campo, fontSize: 13 }} type="email" aria-label="Correo" />
                          : s.email}
                      </td>
                      <td style={celda}>
                        {/* El color no es el único canal: la palabra lo dice. */}
                        <span style={{
                          display: "inline-block", ...T.eyebrow(BRUT.ink), fontSize: 10,
                          padding: "4px 10px",
                          background: s.must_change_password ? BRUT.warning : BRUT.success,
                          border: `${BRUT.borderThin}px solid ${BRUT.ink}`,
                        }}>
                          {s.must_change_password ? "Clave temporal" : "Perfil activo"}
                        </span>
                      </td>
                      {/* Cuándo se creó la cuenta. Es lo que distingue, en una
                          lista ordenada por alta, al que se registró hoy desde
                          la app del que el docente dio de alta en septiembre. */}
                      <td style={{ ...celda, color: BRUT.muted, fontSize: 12, fontWeight: 500 }}>
                        {new Date(s.created_at).toLocaleDateString("es-CO")}
                      </td>
                      <td style={{ ...celda, ...T.stat(14), letterSpacing: 0 }}>
                        {s.passed} / {s.attempts}
                      </td>
                      <td style={{ ...celda, color: BRUT.muted, fontSize: 12, fontWeight: 500 }}>
                        {s.last_attempt
                          ? new Date(s.last_attempt).toLocaleString("es-CO")
                          : "Nunca entró"}
                      </td>
                      <td style={{ ...celda, whiteSpace: "nowrap" }}>
                        {editando ? (
                          <span style={{ display: "inline-flex", gap: 8 }}>
                            <button
                              style={{ ...botonFila, background: BRUT.success }}
                              onClick={() => void accion(async () => {
                                await updateStudent(s.id, {
                                  name: editName.trim(), email: editMail.trim(),
                                });
                                setEditId(null);
                              })}
                            >Guardar</button>
                            <button style={botonFila} onClick={() => setEditId(null)}>
                              Cancelar
                            </button>
                          </span>
                        ) : confirma ? (
                          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: BRUT.ink }}>
                              {confirma === "baja"
                                ? "¿Borrar también sus intentos?"
                                : "¿Generar clave nueva?"}
                            </span>
                            <button
                              style={{
                                ...botonFila,
                                background: confirma === "baja" ? BRUT.danger : BRUT.warning,
                              }}
                              onClick={() => void accion(async () => {
                                if (confirma === "baja") await deleteStudent(s.id);
                                else {
                                  const r = await resetStudentPassword(s.id);
                                  setEntregada(r);
                                  setCopiada(false);
                                }
                              })}
                            >Sí</button>
                            <button style={botonFila} onClick={() => setConfirmando(null)}>
                              No
                            </button>
                          </span>
                        ) : (
                          <span style={{ display: "inline-flex", gap: 8 }}>
                            <button style={botonFila} onClick={() => empezarEdicion(s)}>
                              Editar
                            </button>
                            <button
                              style={botonFila}
                              onClick={() => setConfirmando({ id: s.id, que: "clave" })}
                            >Clave nueva</button>
                            <button
                              style={botonFila}
                              onClick={() => setConfirmando({ id: s.id, que: "baja" })}
                            >Dar de baja</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
