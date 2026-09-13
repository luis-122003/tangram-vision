import { useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, BackHandler, Pressable } from "react-native";
import Icon, { type IconName } from "../components/Icon";
import { Eyebrow, PrimaryButton } from "../components/ui";
import {
  C, S, F, B, TAP, SAFE_TOP, SAFE_BOTTOM, display, shout,
  raised, flat, pressed, onFill,
} from "../theme";

/**
 * Recorrido de bienvenida: qué es esta app y qué se espera del niño.
 *
 * Se muestra una sola vez, la primera vez que un estudiante llega al catálogo,
 * y se puede repetir desde Ajustes. El motivo de que exista es concreto: sin
 * él, la app arranca en una rejilla de figuras y da por sabido todo lo demás
 * —que hay que armar con fichas **físicas** sobre una mesa, que la foto se toma
 * dentro del cuadro, que el resultado dice si se logró—. Un niño de primaria
 * que abre esto por primera vez no tiene por qué deducirlo de una rejilla.
 *
 * Cinco pasos y ni uno más. Es una app de cinco pantallas, y un recorrido más
 * largo que la aplicación que explica se salta entero.
 *
 * Cada paso es una lámina de color con su icono, su titular y dos líneas. El
 * color no decora: es el mismo código semántico del resto del sistema —ámbar
 * para lo que se elige, azul para lo que se prepara, verde para lo logrado—,
 * así que el recorrido enseña de paso a leer los colores de la app.
 */
interface Paso {
  icono: IconName;
  color: string;
  titulo: string;
  texto: string;
}

const PASOS: Paso[] = [
  {
    icono: "layers",
    color: C.accent,
    titulo: "Arma figuras con tu Tangram",
    texto:
      "Yo te propongo una figura, tú la armas con tus fichas de verdad sobre la " +
      "mesa, y luego le tomas una foto. Miro tu foto y te digo si te quedó.",
  },
  {
    icono: "kit",
    color: C.info,
    titulo: "Primero, prepara tu mesa",
    texto:
      "Necesitas las 7 fichas del Tangram, una mesa despejada de color claro y " +
      "buena luz. En el botón del maletín te muestro todo lo que hace falta.",
  },
  {
    icono: "clock",
    color: C.warning,
    titulo: "Elige tu figura",
    texto:
      "En el catálogo están todas, de la más fácil a la más difícil. Las que ya " +
      "lograste llevan un visto verde en la esquina.",
  },
  {
    icono: "camera",
    color: C.cobalto,
    titulo: "Toma la foto dentro del cuadro",
    texto:
      "Que la figura entera quepa en el cuadro, sin tus manos encima y sin " +
      "sombras. Si me queda mal la foto te lo digo y la repites.",
  },
  {
    icono: "check",
    color: C.success,
    titulo: "Y sigues con la siguiente",
    texto:
      "Te digo si lo lograste. Si todavía no, te doy una pista de qué acomodar. " +
      "Y cuando lo logres, un botón te lleva directo a la figura que sigue.",
  },
];

export default function TourScreen({ onFinish, nombre }: {
  /** Terminado o saltado: en los dos casos no se vuelve a mostrar solo. */
  onFinish: () => void;
  /** Nombre de pila, para que el saludo no sea el de un folleto. */
  nombre?: string;
}) {
  const [i, setI] = useState(0);
  const paso = PASOS[i];
  const ultimo = i === PASOS.length - 1;

  /**
   * El atrás retrocede un paso, y en el primero cierra el recorrido.
   *
   * Se registra aquí y no en `App.tsx` porque React Native atiende las
   * suscripciones en orden inverso al de registro: esta pantalla se monta
   * encima, así que su gesto se resuelve antes que el de la raíz y el atrás no
   * acaba cerrando la aplicación a mitad del recorrido.
   */
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (i > 0) { setI(n => n - 1); return true; }
      onFinish();
      return true;
    });
    return () => sub.remove();
  }, [i]);

  return (
    <ScrollView style={s.flex} contentContainerStyle={s.content}>
      <View style={s.head}>
        <Eyebrow>Paso {i + 1} de {PASOS.length}</Eyebrow>
        {/* Saltar está desde el primer paso: obligar a pasar cinco pantallas a
            quien ya conoce la app es la forma más rápida de que el recorrido se
            recuerde como un estorbo. */}
        {!ultimo && (
          <Pressable
            onPress={onFinish} style={s.saltar}
            accessibilityRole="button" accessibilityLabel="Saltar el recorrido"
          >
            <Text style={s.saltarText}>Saltar</Text>
          </Pressable>
        )}
      </View>

      {i === 0 && (
        <Text style={[shout(30), s.saludo]}>
          {nombre ? `Hola, ${nombre}` : "Hola"}
        </Text>
      )}

      <View style={[s.lamina, raised(6, paso.color)]}>
        <View style={[s.marca, flat(C.paper, B.base)]}>
          <Icon name={paso.icono} size={34} color={C.ink} strokeWidth={2.6} />
        </View>
        <Text style={[display(25, onFill(paso.color)), s.titulo]}>{paso.titulo}</Text>
        <Text style={[s.texto, { color: onFill(paso.color) }]}>{paso.texto}</Text>
      </View>

      {/* Dónde va uno del recorrido. Los pasos ya dados quedan llenos, no solo
          el actual: así el indicador dice cuánto falta y no solo dónde se está. */}
      <View style={s.puntos}>
        {PASOS.map((_, n) => (
          <View
            key={n}
            style={[s.punto, flat(n <= i ? C.ink : C.well, B.hair), n === i && s.puntoActual]}
          />
        ))}
      </View>

      <View style={s.acciones}>
        <PrimaryButton
          label={ultimo ? "Empezar" : "Siguiente"}
          icon={ultimo ? "check" : undefined}
          tone={ultimo ? "success" : "accent"}
          onPress={() => (ultimo ? onFinish() : setI(n => n + 1))}
        />
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  flex:    { flex: 1, backgroundColor: C.base },
  content: { flexGrow: 1, paddingHorizontal: S.lg + 4,
             paddingTop: SAFE_TOP, paddingBottom: SAFE_BOTTOM + 20 },

  head:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
             minHeight: TAP.min },
  saltar:  { height: TAP.min, justifyContent: "center", paddingHorizontal: 4 },
  saltarText: { fontFamily: F.bold, fontSize: 14, color: C.muted,
                textDecorationLine: "underline" },

  saludo:  { marginTop: S.sm },

  lamina:  { marginTop: S.xl, padding: S.xl, flexGrow: 1, justifyContent: "center" },
  marca:   { width: 62, height: 62, alignItems: "center", justifyContent: "center" },
  titulo:  { marginTop: S.xl },
  texto:   { fontFamily: F.regular, fontSize: 16, lineHeight: 24, marginTop: S.md },

  puntos:  { flexDirection: "row", gap: S.sm, marginTop: S.xl, justifyContent: "center" },
  punto:   { width: 26, height: 10 },
  /** El actual es más ancho: se distingue sin depender solo del relleno. */
  puntoActual: { width: 40 },

  acciones:{ marginTop: S.xl },
});
