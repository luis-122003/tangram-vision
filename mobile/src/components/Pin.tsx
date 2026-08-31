import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import Icon from "./Icon";
import {
  C, B, display, raised, inset, pressed as pressedStyle, flat, off as offStyle,
} from "../theme";

/**
 * La clave del estudiante: cuatro casillas y un teclado propio.
 *
 * Vive aquí, y no dentro del ingreso, porque hay dos sitios que piden una clave
 * de cuatro dígitos —entrar y cambiarla— y el segundo la pide **tres veces**
 * seguidas. Duplicar doce teclas con su filete, su sombra y su gesto de
 * aplastarse era garantizar que las dos copias se separaran a la primera
 * corrección.
 *
 * El teclado es donde el estilo se gana el sueldo: cada tecla es una placa con
 * su filete y su sombra, y al tocarla recorre esa sombra hasta aplastarse contra
 * ella, que es exactamente lo que hace una tecla de verdad.
 *
 * Es también lo más denso del sistema: doce teclas con filete y sombra son
 * veinticuatro dibujos a la vez. Por eso llevan sombra de 3 px y no de 5 —a
 * plena longitud, doce sombras seguidas se leen como ruido—.
 */
export const PIN_LENGTH = 4;

/**
 * Las cuatro casillas. La que toca escribir se marca en color y la que ya tiene
 * dígito se llena de verde: dos señales distintas, no dos profundidades de la
 * misma que haya que comparar entre sí.
 */
export function PinBoxes({ value }: { value: string }) {
  return (
    <View style={s.pinRow}>
      {Array.from({ length: PIN_LENGTH }).map((_, i) => {
        const filled = i < value.length;
        const active = i === value.length;
        return (
          <View key={i} style={[
            s.flexOne, s.pinBox,
            filled ? flat(C.success, B.base) : inset(3, active ? C.warning : C.well),
          ]}>
            {filled && <View style={s.pinDot} />}
            {active && !filled && <View style={s.caret} />}
          </View>
        );
      })}
    </View>
  );
}

export function PinPad({ onDigit, onBackspace, onSubmit, canSubmit, busy, submitLabel }: {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onSubmit: () => void;
  /** Hay cuatro dígitos escritos y el paso se puede confirmar. */
  canSubmit: boolean;
  busy?: boolean;
  /** Qué dice el lector de pantalla de la tecla de confirmar. */
  submitLabel?: string;
}) {
  return (
    <View style={s.pad}>
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(k => (
        <Pressable
          key={k} style={({ pressed: p }) => [s.keyWrap, s.key, p ? pressedStyle(3) : raised(3)]}
          onPress={() => onDigit(k)} accessibilityRole="button" accessibilityLabel={k}
        >
          <Text style={display(23, C.ink)}>{k}</Text>
        </Pressable>
      ))}
      {/* Borrar no es una tecla de dígito, así que va en hueco y no en placa: se
          distingue de las diez sin necesidad de un rótulo. */}
      <Pressable
        style={({ pressed: p }) => [s.keyWrap, s.key, p ? pressedStyle(3, C.well) : inset(3)]}
        onPress={onBackspace}
        accessibilityRole="button" accessibilityLabel="Borrar"
      >
        <Icon name="backspace" size={24} color={C.ink} />
      </Pressable>
      <Pressable
        style={({ pressed: p }) => [s.keyWrap, s.key, p ? pressedStyle(3) : raised(3)]}
        onPress={() => onDigit("0")}
        accessibilityRole="button" accessibilityLabel="0"
      >
        <Text style={display(23, C.ink)}>0</Text>
      </Pressable>
      {/* Confirmar: verde y con el filete más gordo cuando ya se puede pulsar.
          Mientras falten dígitos va apagada y aplastada, no con el texto
          aclarado: un control desactivado tiene que seguir siendo legible. */}
      <Pressable
        style={({ pressed: p }) => [
          s.keyWrap, s.key,
          !canSubmit
            ? offStyle()
            : p ? pressedStyle(4, C.success) : raised(4, C.success),
          canSubmit ? s.keyGo : null,
        ]}
        onPress={onSubmit}
        disabled={!canSubmit || busy}
        accessibilityRole="button" accessibilityLabel={submitLabel ?? "Entrar"}
      >
        {busy
          ? <ActivityIndicator color={C.ink} />
          : <Icon name="check" size={26} color={canSubmit ? C.ink : C.ghost} />}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  flexOne:  { flex: 1 },

  pinRow:   { flexDirection: "row", gap: 12 },
  // Altura 58 con filete de 3: React Native es border-box, así que quedan 52 de
  // contenido y el objetivo táctil sigue siendo 58.
  pinBox:   { height: 58, alignItems: "center", justifyContent: "center" },
  pinDot:   { width: 16, height: 16, backgroundColor: C.ink },
  caret:    { width: B.base, height: 24, backgroundColor: C.ink },

  pad:      { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  keyWrap:  { width: "30%" },
  key:      { height: 56, alignItems: "center", justifyContent: "center" },
  /** Solo la tecla de confirmar, y solo cuando ya se puede pulsar. */
  keyGo:    { borderWidth: B.loud },
});
