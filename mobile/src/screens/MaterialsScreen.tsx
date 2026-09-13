import { useEffect } from "react";
import { BackHandler, ScrollView, StyleSheet, Text, View } from "react-native";

import MaterialArt, { type MaterialArtKind } from "../components/MaterialArt";
import TangramPiece from "../components/TangramPiece";
import { Card, Eyebrow, IconButton, Note } from "../components/ui";
import {
  C, PIECE_INVENTORY, S, SAFE_BOTTOM, SAFE_TOP, TOTAL_PIECES,
  display, pieceCount, shout, subtle,
} from "../theme";

/**
 * Qué hace falta tener a mano antes de armar y fotografiar una figura.
 *
 * No es una pantalla de ayuda genérica: cada punto sale de un modo de fallo
 * real y medido del sistema, y por eso cada tarjeta dice **qué pasa si no** en
 * vez de limitarse a mandar. Un consejo sin su motivo se salta; uno que explica
 * qué se rompe, se recuerda.
 *
 *   · el fondo con vetas o dibujos confunde el contorno de las fichas;
 *   · una sombra dura al lado de una ficha se detecta como parte de ella;
 *   · fotografiar de costado deforma la figura y el giro deja de compensarlo;
 *   · un dedo encima tapa una ficha, y una ficha tapada es una ficha que falta.
 *
 * Se llega desde el ingreso, desde el catálogo y desde la propia pantalla de
 * juego. Los tres accesos son a propósito: en el ingreso lo consulta el docente
 * antes de repartir los teléfonos, en el catálogo el estudiante mientras elige,
 * y en el juego cuando la foto ya le salió mal y quiere saber por qué.
 */
type Punto = {
  arte: MaterialArtKind;
  titulo: string;
  texto: string;
  porque: string;
};

const PUNTOS: Punto[] = [
  {
    arte: "superficie",
    titulo: "Una superficie lisa y de un solo color",
    texto: "Una mesa despejada, o una hoja grande encima. Que no tenga dibujos, " +
           "vetas ni manteles de cuadros.",
    porque: "Sobre un fondo con figuras, la cámara no distingue dónde termina una ficha.",
  },
  {
    arte: "luz",
    titulo: "Luz pareja, sin sombras marcadas",
    texto: "Que la luz venga de arriba o de tu frente. Si la lámpara está muy " +
           "de costado, cada ficha proyecta una sombra larga.",
    porque: "Una sombra dura pegada a una ficha se ve como si fuera parte de ella.",
  },
  {
    arte: "encuadre",
    titulo: "El celular arriba, mirando de frente",
    texto: "Sostenlo sobre la figura, no de costado. La figura entera tiene que " +
           "caber en la foto, con un poco de margen alrededor.",
    porque: "De costado la figura se ve estirada y deja de parecerse a la del ejemplo.",
  },
  {
    arte: "manos",
    titulo: "Las manos fuera de la foto",
    texto: "Arma la figura, retira las manos y recién entonces toma la foto.",
    porque: "Un dedo encima tapa una ficha, y una ficha tapada cuenta como una que falta.",
  },
];

export default function MaterialsScreen({ onClose }: { onClose: () => void }) {
  /**
   * El atrás se atiende aquí y no en `App`, y la diferencia importa cuando esta
   * pantalla se abre **encima de una figura**: React Native llama a las
   * suscripciones en orden inverso al de registro, así que la de `GameScreen`
   * se atendería primero y el gesto retrocedería de fase por debajo en vez de
   * cerrar esto. Registrada al montar, esta es la última y por tanto la primera
   * en responder.
   */
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  return (
    <ScrollView style={s.flex} contentContainerStyle={s.contenido}>
      <View style={s.header}>
        <IconButton name="back" onPress={onClose} label="Volver" />
        <View style={s.flex}>
          <Eyebrow>Antes de empezar</Eyebrow>
          <Text style={shout(28)}>Materiales</Text>
        </View>
      </View>

      <Text style={s.entrada}>
        Con esto listo, la foto sale bien casi siempre.
      </Text>

      {/* El inventario va primero y aparte: es lo único sin lo cual no se puede
          empezar. Los otros cuatro puntos mejoran la foto; este la hace posible. */}
      <Card style={s.tarjeta} depth={5} contentStyle={s.cuerpo}>
        <Eyebrow>Lo imprescindible</Eyebrow>
        <Text style={[display(19), s.titulo]}>Tu Tangram completo</Text>

        <View style={s.fichas}>
          {PIECE_INVENTORY.map(({ kind, count }) =>
            Array.from({ length: count }, (_, i) => (
              <View key={`${kind}-${i}`} style={[s.ficha, subtle(C.card)]}>
                <TangramPiece kind={kind} size={38} />
              </View>
            )),
          )}
        </View>

        <Text style={s.texto}>
          Son {TOTAL_PIECES} fichas: {PIECE_INVENTORY.map(
            ({ kind, count }) => pieceCount(kind, count),
          ).join(", ")}.
        </Text>
        <Note tone="warning" title="Si falta una">
          La figura no se puede armar, y el sistema va a decirte que está incompleta
          aunque hayas puesto bien todas las demás.
        </Note>
      </Card>

      {PUNTOS.map(punto => (
        <Card key={punto.arte} style={s.tarjeta} depth={5} contentStyle={s.cuerpo}>
          <View style={[s.lamina, subtle(C.well)]}>
            <MaterialArt kind={punto.arte} width={200} />
          </View>
          <Text style={[display(19), s.titulo]}>{punto.titulo}</Text>
          <Text style={s.texto}>{punto.texto}</Text>
          <View style={s.porque}>
            <Text style={s.porqueTexto}>{punto.porque}</Text>
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  flex:      { flex: 1, backgroundColor: C.base },
  contenido: {
    paddingTop: SAFE_TOP + S.sm,
    paddingHorizontal: S.lg,
    paddingBottom: SAFE_BOTTOM + S.xl,
  },

  header:  { flexDirection: "row", alignItems: "center", gap: S.md, marginBottom: S.md },
  entrada: { fontSize: 15, lineHeight: 22, color: C.muted, marginBottom: S.lg },

  tarjeta: { marginBottom: S.lg },
  cuerpo:  { padding: S.lg, gap: S.sm },
  titulo:  { marginTop: S.xs },
  texto:   { fontSize: 15, lineHeight: 22, color: C.muted },

  // La ilustración va en un nicho hundido, como la silueta objetivo del
  // catálogo: es contenido que se mira, no un control que se pulsa.
  lamina:  { alignItems: "center", justifyContent: "center", paddingVertical: S.md },

  fichas:  { flexDirection: "row", flexWrap: "wrap", gap: S.sm, marginVertical: S.xs },
  ficha:   { padding: S.xs },

  porque:      { borderLeftWidth: 4, borderLeftColor: C.ink, paddingLeft: S.md, marginTop: S.xs },
  porqueTexto: { fontSize: 14, lineHeight: 20, color: C.ink },
});
