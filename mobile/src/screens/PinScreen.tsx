import { useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, BackHandler } from "react-native";
import { changePassword } from "../api/client";
import Icon from "../components/Icon";
import { Eyebrow, IconButton, Note, PrimaryButton } from "../components/ui";
import { PIN_LENGTH, PinBoxes, PinPad } from "../components/Pin";
import {
  C, S, F, SAFE_TOP, SAFE_BOTTOM, shout, display, subtle, flat,
} from "../theme";

/**
 * Cambiar la clave propia.
 *
 * Esta pantalla sirve para dos cosas que se parecen pero no son iguales:
 *
 *   · **Cambio voluntario.** Se entra desde Ajustes, con la sesión abierta, y
 *     hay tres pasos: la clave de ahora, la nueva, y la nueva otra vez.
 *   · **Activación del perfil** (`obligatorio`). El estudiante acaba de entrar
 *     por primera vez con la clave temporal que le dio el docente, y no puede
 *     hacer nada más hasta cambiarla —el servidor le rechaza `/predict` y
 *     `/sessions` con un 403 mientras tanto—. Aquí la clave de ahora **ya se
 *     conoce**: es la que acaba de teclear en el ingreso, así que se pasa por
 *     `claveActual` y el primer paso se salta. Pedírsela otra vez sería hacerle
 *     repetir un dato que la app tiene delante.
 *
 * Son pasos y no un formulario con tres campos: en la pantalla de un teléfono,
 * con el teclado de teclas grandes ocupando media pantalla, tres huecos a la
 * vez no caben. Y pedir la nueva dos veces evita la avería que de verdad duele
 * aquí: un niño que se equivoca al teclear su clave nueva y se queda fuera de
 * su propia cuenta, sin saber siquiera con qué se quedó fuera.
 */
type Paso = "actual" | "nueva" | "repetir";

const TITULO: Record<Paso, string> = {
  actual:  "Escribe la clave que usas ahora",
  nueva:   "Inventa tu clave nueva",
  repetir: "Escríbela otra vez",
};

export default function PinScreen({ onClose, onDone, obligatorio, claveActual, nombre }: {
  /**
   * Salir sin cambiar nada. En el cambio voluntario vuelve a Ajustes; en la
   * activación **cierra la sesión**, porque no hay ningún otro sitio al que
   * volver: la cuenta todavía no puede usar la aplicación.
   */
  onClose: () => void;
  /** El cambio se completó y la sesión ya no vale: hay que volver al ingreso. */
  onDone: () => void;
  /** Activación del perfil: no es opcional y no se puede posponer. */
  obligatorio?: boolean;
  /** La clave temporal con la que acaba de entrar, para no volver a pedírsela. */
  claveActual?: string;
  /** Nombre de pila, para saludar en la activación. */
  nombre?: string;
}) {
  /**
   * Con la clave temporal ya en la mano, el primer paso sobra. Sin ella —una
   * sesión restaurada del almacenamiento, donde la clave no se guarda nunca—
   * hay que pedirla igual, y por eso esto mira el dato y no solo el modo.
   */
  const saltaPrimerPaso = Boolean(obligatorio && claveActual);
  const pasosTotales = saltaPrimerPaso ? 2 : 3;
  const numeroDePaso = (p: Paso) =>
    `Paso ${(saltaPrimerPaso ? { actual: 1, nueva: 1, repetir: 2 } : { actual: 1, nueva: 2, repetir: 3 })[p]}` +
    ` de ${pasosTotales}`;

  const [paso,     setPaso]     = useState<Paso>(saltaPrimerPaso ? "nueva" : "actual");
  const [actual,   setActual]   = useState(saltaPrimerPaso ? claveActual! : "");
  const [nueva,    setNueva]    = useState("");
  const [pin,      setPin]      = useState("");
  const [error,    setError]    = useState("");
  const [enviando, setEnviando] = useState(false);
  const [listo,    setListo]    = useState(false);

  /**
   * Botón atrás de Android.
   *
   * Con la clave ya cambiada no puede devolver al catálogo: el servidor revocó
   * la sesión y todo lo que hay ahí respondería 401. Y en la activación tampoco
   * puede dejar pasar el gesto, porque debajo está el catálogo de una cuenta
   * que aún no puede jugar: se trata como el botón de la pantalla, que allí
   * significa «salir de mi cuenta».
   */
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (listo) { onDone(); return true; }
      if (obligatorio) { onClose(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [listo, obligatorio]);

  function digito(d: string) {
    setError("");
    setPin(p => (p.length >= PIN_LENGTH ? p : p + d));
  }

  function borrar() {
    setError("");
    setPin(p => p.slice(0, -1));
  }

  /** A dónde se vuelve cuando el servidor rechaza el cambio. */
  function reiniciar() {
    setPin(""); setNueva("");
    if (saltaPrimerPaso) {
      // La clave de ahora no se borra: la app la tiene porque el niño acaba de
      // entrar con ella, y hacérsela teclear otra vez sería pedirle que
      // recuerde un número que le dictaron hace treinta segundos.
      setPaso("nueva");
    } else {
      setActual(""); setPaso("actual");
    }
  }

  async function confirmar() {
    if (pin.length < PIN_LENGTH || enviando) return;
    setError("");

    if (paso === "actual") {
      setActual(pin); setPin(""); setPaso("nueva");
      return;
    }

    if (paso === "nueva") {
      // El servidor también lo rechaza, pero decirlo aquí ahorra un viaje y, más
      // importante, ahorra teclear la confirmación de una clave que no vale.
      if (pin === actual) {
        setError(obligatorio
          ? "Esa es la clave que te dieron. Inventa una que sepas solo tú."
          : "Esa es la clave que ya tienes. Elige otra.");
        setPin("");
        return;
      }
      setNueva(pin); setPin(""); setPaso("repetir");
      return;
    }

    if (pin !== nueva) {
      // Se vuelve al paso de la clave nueva, no al principio: lo que falló fue
      // esa, y hacerle teclear otra vez la de ahora sería castigarlo por un
      // error de dedo.
      setError("Las dos no son iguales. Escribe tu clave nueva otra vez.");
      setPin(""); setNueva(""); setPaso("nueva");
      return;
    }

    setEnviando(true);
    try {
      await changePassword(actual, nueva);
      setListo(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar la clave.");
      reiniciar();
    } finally {
      setEnviando(false);
    }
  }

  // ── Listo ───────────────────────────────────────────────────────────────────
  if (listo) {
    return (
      <ScrollView style={s.flex} contentContainerStyle={s.done}>
        <View style={[s.mark, flat(C.success, 3)]}>
          <Icon name="check" size={28} color={C.ink} strokeWidth={3.4} />
        </View>
        <Text style={[display(24), s.doneTitle]}>
          {obligatorio ? "Tu perfil ya está listo" : "Clave cambiada"}
        </Text>
        <Text style={s.doneText}>
          {obligatorio
            ? "Esta clave es tuya y no se la sabe nadie más, ni el profe. Entra " +
              "con ella y empieza a armar figuras."
            : "Ya está. Entra otra vez con tu clave nueva; no se la digas a nadie."}
        </Text>
        <View style={s.gap}>
          <PrimaryButton label="Entrar de nuevo" tone="success" onPress={onDone} />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={s.flex} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.header}>
        {/* En la activación el botón no es «volver» —no hay nada detrás— sino
            «salir de mi cuenta», y el icono lo dice antes que el rótulo. */}
        <IconButton
          name={obligatorio ? "logout" : "back"}
          onPress={onClose}
          label={obligatorio ? "Salir de mi cuenta" : "Volver"}
        />
        <Text style={shout(26)}>{obligatorio ? "Tu clave" : "Mi clave"}</Text>
      </View>

      {obligatorio && (
        <View style={s.gap}>
          <Note title={nombre ? `Hola, ${nombre}` : "Antes de empezar"}>
            La clave con la que entraste te la dio el profe, así que la sabe más
            gente. Inventa una tuya de cuatro números para que nadie más pueda
            entrar en tu cuenta.
          </Note>
        </View>
      )}

      <View style={s.gap}>
        <Eyebrow>{numeroDePaso(paso)}</Eyebrow>
        <Text style={[display(19), s.titulo]}>{TITULO[paso]}</Text>
        <View style={s.boxes}>
          <PinBoxes value={pin} />
        </View>
        {error !== "" && (
          <View style={[s.errorBox, subtle(C.danger)]}>
            <Text style={s.error}>{error}</Text>
          </View>
        )}
      </View>

      <View style={s.gap}>
        <PinPad
          onDigit={digito} onBackspace={borrar} onSubmit={confirmar}
          canSubmit={pin.length === PIN_LENGTH} busy={enviando}
          submitLabel={paso === "repetir" ? "Cambiar la clave" : "Siguiente"}
        />
      </View>

      <View style={s.gap}>
        <Note title="Ten en cuenta">
          {obligatorio
            ? "Apréndetela bien. Si se te olvida, el profe puede darte una nueva."
            : "Cuando la cambies tendrás que entrar de nuevo, aquí y en el computador."}
        </Note>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  flex:      { flex: 1, backgroundColor: C.base },
  content:   { paddingHorizontal: S.lg + 4, paddingTop: SAFE_TOP, paddingBottom: SAFE_BOTTOM + 20 },
  gap:       { marginTop: S.xl },

  header:    { flexDirection: "row", alignItems: "center", gap: S.md },
  titulo:    { marginTop: 6 },
  boxes:     { marginTop: S.lg },

  errorBox:  { marginTop: 14, paddingVertical: 10, paddingHorizontal: 14 },
  error:     { fontFamily: F.bold, fontSize: 14, color: C.ink, textAlign: "center" },

  done:      { flexGrow: 1, justifyContent: "center",
               paddingHorizontal: S.lg + 4, paddingTop: SAFE_TOP, paddingBottom: SAFE_BOTTOM + 20 },
  mark:      { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  doneTitle: { marginTop: S.lg },
  doneText:  { fontFamily: F.regular, fontSize: 15, lineHeight: 22, color: C.ink, marginTop: S.md },
});
