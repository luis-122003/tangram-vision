import { Component, type ReactNode } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import Icon from "./Icon";
import { Card, Eyebrow, PrimaryButton } from "./ui";
import { C, S, F, SAFE_TOP, SAFE_BOTTOM, display, flat } from "../theme";

/**
 * Última red de seguridad de la app.
 *
 * Un error al pintar cualquier pantalla desmonta el árbol entero de React, y sin
 * nadie que lo recoja el estudiante se queda mirando una pantalla en blanco de
 * la que no se sale ni con el botón atrás: hay que matar la app y volver a
 * entrar. En el aula eso es el final de la actividad para ese niño.
 *
 * Aquí se recoge, se le dice que no fue culpa suya y se le da la única acción
 * que sirve: reintentar. Se limpia el error y el árbol se vuelve a montar desde
 * cero; si el fallo era pasajero —una respuesta rara del servidor, una figura sin
 * silueta— con eso basta.
 *
 * Va en un componente de clase porque recoger errores —`getDerivedStateFromError`
 * y `componentDidCatch`— no tiene equivalente en hooks: es lo único de React que
 * todavía obliga a escribir una clase.
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <ScrollView style={s.flex} contentContainerStyle={s.content}>
        <View style={[s.mark, flat(C.warning, 3)]}>
          <Icon name="bang" size={26} color={C.ink} strokeWidth={3.4} />
        </View>
        <Text style={[display(24), s.title]}>Algo se rompió</Text>
        <Text style={s.text}>
          No fue culpa tuya. Vuelve a empezar y sigue armando; si pasa otra vez,
          avísale a tu profe.
        </Text>

        {/* El mensaje técnico va aparte y en pequeño: al niño no le dice nada,
            pero es lo único que le sirve a quien tenga que arreglarlo. */}
        <Card style={s.gap} sunken depth={4} contentStyle={s.detail}>
          <Eyebrow>Detalle</Eyebrow>
          <Text style={s.mono}>{error.message || String(error)}</Text>
        </Card>

        <View style={s.gap}>
          <PrimaryButton
            label="Volver a empezar" icon="refresh"
            onPress={() => this.setState({ error: null })}
          />
        </View>
      </ScrollView>
    );
  }
}

const s = StyleSheet.create({
  flex:    { flex: 1, backgroundColor: C.base },
  content: { flexGrow: 1, justifyContent: "center",
             paddingHorizontal: S.lg + 4, paddingTop: SAFE_TOP, paddingBottom: SAFE_BOTTOM + 20 },
  gap:     { marginTop: S.xl },

  mark:    { width: 52, height: 52, alignItems: "center", justifyContent: "center" },
  title:   { marginTop: S.lg },
  text:    { fontFamily: F.regular, fontSize: 15, lineHeight: 22,
             color: C.ink, marginTop: S.md },

  detail:  { padding: 14 },
  mono:    { fontFamily: F.mono, fontSize: 12, lineHeight: 18,
             color: C.ink, marginTop: 8 },
});
