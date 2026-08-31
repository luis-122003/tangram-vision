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
 * Existe porque sin esto la autenticación del sistema no protege nada: las
 * cuentas se siembran con `1234` y hasta ahora no había ninguna forma de
 * cambiarlo desde el teléfono. Se puede cifrar el correo, firmar los tokens y
 * limitar los intentos, que si la clave sigue siendo la de la demostración todo
 * ese trabajo queda de adorno.
 *
 * Son tres pasos —la de ahora, la nueva, y la nueva otra vez— y no un formulario
 * con tres campos: en una pantalla de teléfono, con el teclado de teclas grandes
 * ocupando media pantalla, tres huecos a la vez no caben. De paso, pedirla dos
 * veces evita la avería que de verdad duele aquí: un niño que se equivoca al
 * teclear su clave nueva y se queda fuera de su propia cuenta.
 */
type Paso = "actual" | "nueva" | "repetir";

const TITULO: Record<Paso, string> = {
  actual:  "Escribe la clave que usas ahora",
  nueva:   "Escribe tu clave nueva",
  repetir: "Escríbela otra vez",
};

const PASO_NUMERO: Record<Paso, string> = {
  actual: "Paso 1 de 3", nueva: "Paso 2 de 3", repetir: "Paso 3 de 3",
};

export default function PinScreen({ onClose, onDone }: {
  onClose: () => void;
  /** El cambio se completó y la sesión ya no vale: hay que volver al ingreso. */
  onDone: () => void;
}) {
  const [paso,     setPaso]     = useState<Paso>("actual");
  const [actual,   setActual]   = useState("");
  const [nueva,    setNueva]    = useState("");
  const [pin,      setPin]      = useState("");
  const [error,    setError]    = useState("");
  const [enviando, setEnviando] = useState(false);
  const [listo,    setListo]    = useState(false);

  /**
   * Con la clave ya cambiada, el atrás no puede devolver al catálogo: el
   * servidor revocó la sesión y todo lo que hay ahí respondería 401. Se lleva
   * al ingreso, que es lo mismo que hace el botón de la pantalla.
   */
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (listo) { onDone(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [listo]);

  function digito(d: string) {
    setError("");
    setPin(p => (p.length >= PIN_LENGTH ? p : p + d));
  }

  function borrar() {
    setError("");
    setPin(p => p.slice(0, -1));
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
        setError("Esa es la clave que ya tienes. Elige otra.");
        setPin("");
        return;
      }
      setNueva(pin); setPin(""); setPaso("repetir");
      return;
    }

    if (pin !== nueva) {
      // Se vuelve al paso 2, no al 1: lo que falló fue la clave nueva, y hacerle
      // teclear otra vez la de ahora sería castigarlo por un error de dedo.
      setError("Las dos no son iguales. Escribe tu clave nueva otra vez.");
      setPin(""); setNueva(""); setPaso("nueva");
      return;
    }

    setEnviando(true);
    try {
      await changePassword(actual, nueva);
      setListo(true);
    } catch (e) {
      // De vuelta al principio: el fallo más común es que la clave de ahora
      // estuviera mal, y el servidor no dice cuál de las dos falló.
      setError(e instanceof Error ? e.message : "No se pudo cambiar la clave.");
      setPin(""); setActual(""); setNueva(""); setPaso("actual");
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
        <Text style={[display(24), s.doneTitle]}>Clave cambiada</Text>
        <Text style={s.doneText}>
          Ya está. Entra otra vez con tu clave nueva; no se la digas a nadie.
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
        <IconButton name="back" onPress={onClose} label="Volver" />
        <Text style={shout(26)}>Mi clave</Text>
      </View>

      <View style={s.gap}>
        <Eyebrow>{PASO_NUMERO[paso]}</Eyebrow>
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
          Cuando la cambies tendrás que entrar de nuevo, aquí y en el computador.
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
