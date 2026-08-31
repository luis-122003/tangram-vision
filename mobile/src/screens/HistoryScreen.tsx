import { useEffect, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl,
} from "react-native";
import { getFigures, getStudentSessions } from "../api/client";
import type { Figure, Session, User } from "../api/types";
import Icon from "../components/Icon";
import { Card, Eyebrow, IconButton } from "../components/ui";
import {
  C, S, F, SAFE_TOP, SAFE_BOTTOM, shout, display, formatTime, pct, tabular,
  subtle, flat,
} from "../theme";

/**
 * Mis intentos: las últimas veces que el estudiante armó una figura.
 *
 * El catálogo ya enseña «4 aciertos de 7 intentos», pero eso es una cuenta, no
 * un recuerdo: no dice cuáles, ni cuánto tardó, ni si la que no le salió estuvo
 * cerca. Esto sí, y es lo que convierte el número en algo que puede mirar —y
 * enseñarle a su profe— al terminar la clase.
 *
 * Sale de `/students/{id}/sessions`, el listado propio. El del curso entero es
 * del docente y esta app no lo pide.
 */
const CUANTOS = 20;

export default function HistoryScreen({ user, onClose }: {
  user: User; onClose: () => void;
}) {
  const [filas,   setFilas]   = useState<Session[]>([]);
  const [nombres, setNombres] = useState<Record<string, Figure>>({});
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");

  async function load() {
    setError("");
    setLoading(true);
    try {
      // El catálogo es lo que traduce el `figure_id` de cada fila —un slug— al
      // nombre que el niño reconoce. Si falla, las filas siguen sirviendo: se
      // enseña el slug antes que dejar la pantalla vacía.
      const [pagina, figuras] = await Promise.all([
        getStudentSessions(user.id, CUANTOS),
        getFigures().catch(() => [] as Figure[]),
      ]);
      setFilas(pagina.rows);
      setTotal(pagina.total);
      setNombres(Object.fromEntries(figuras.map(f => [f.slug, f])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar tu historial");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <ScrollView
      style={s.flex}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={loading && filas.length > 0} onRefresh={load} tintColor={C.muted}
        />
      }
    >
      <View style={s.header}>
        <IconButton name="back" onPress={onClose} label="Volver al catálogo" />
        <View style={s.flex}>
          <Text style={shout(26)}>Mis intentos</Text>
          {total > 0 && (
            <Text style={s.sub}>
              {total === 1 ? "1 intento en total" : `${total} intentos en total`}
              {total > CUANTOS ? ` · se ven los ${CUANTOS} últimos` : ""}
            </Text>
          )}
        </View>
      </View>

      {error !== "" && (
        <Card style={s.gap} tone="danger" depth={4} contentStyle={s.aviso}>
          <Text style={s.avisoText}>{error}</Text>
        </Card>
      )}

      {loading && filas.length === 0 && (
        <ActivityIndicator color={C.ink} size="large" style={s.gap} />
      )}

      {!loading && filas.length === 0 && error === "" && (
        <Card style={s.gap} sunken depth={4} contentStyle={s.aviso}>
          <Text style={s.avisoText}>
            Todavía no has armado ninguna figura. Elige una del catálogo y toma
            la foto: aquí aparecerá lo que vayas logrando.
          </Text>
        </Card>
      )}

      {filas.map(fila => {
        const figura = nombres[fila.figure_id];
        // `match_result` llega de MySQL como 0/1, no como booleano.
        const ok = Boolean(fila.match_result);
        return (
          <View key={fila.id} style={[s.fila, subtle(C.card)]}>
            {/* Verde lo logrado, amarillo lo que quedó a medias. El icono dice
                lo mismo que el color, y el parecido en cifras lo dice otra vez:
                ninguno de los tres canales es imprescindible por separado. */}
            <View style={[s.marca, flat(ok ? C.success : C.warning, 2)]}>
              <Icon name={ok ? "check" : "bang"} size={14} color={C.ink} strokeWidth={3.4} />
            </View>
            <View style={s.filaTexto}>
              <Text style={display(16)} numberOfLines={1}>
                {figura?.name ?? fila.figure_id}
              </Text>
              <Text style={s.filaFecha}>
                {ok ? "Lograda" : "Casi"} · {fecha(fila.created_at)}
              </Text>
            </View>
            <View style={s.filaCifras}>
              <Text style={[display(16), tabular]}>{pct(fila.iou_score)}</Text>
              <Text style={[s.filaTiempo, tabular]}>{formatTime(fila.time_seconds)}</Text>
            </View>
          </View>
        );
      })}

      {filas.length > 0 && (
        <View style={s.gap}>
          <Eyebrow>El parecido y el tiempo de cada intento</Eyebrow>
        </View>
      )}
    </ScrollView>
  );
}

/**
 * Fecha corta y en español. Va defensiva a propósito: si el servidor cambiara el
 * formato de `created_at`, una fecha inválida no puede llevarse por delante la
 * fila entera —el parecido y el tiempo siguen siendo verdad—.
 */
function fecha(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hoy = new Date();
  const mismoDia = d.toDateString() === hoy.toDateString();
  const hora = `${d.getHours()}:${d.getMinutes().toString().padStart(2, "0")}`;
  if (mismoDia) return `hoy ${hora}`;
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun",
                 "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${d.getDate()} ${MESES[d.getMonth()]} ${hora}`;
}

const s = StyleSheet.create({
  flex:      { flex: 1 },
  content:   { paddingHorizontal: S.lg + 4, paddingTop: SAFE_TOP, paddingBottom: SAFE_BOTTOM + 20,
               backgroundColor: C.base },
  gap:       { marginTop: S.xl },

  header:    { flexDirection: "row", alignItems: "flex-start", gap: S.md, marginBottom: S.lg },
  sub:       { fontFamily: F.regular, fontSize: 13, color: C.muted, marginTop: 6 },

  aviso:     { padding: 16 },
  avisoText: { fontFamily: F.regular, fontSize: 14, lineHeight: 20, color: C.ink },

  // Filete y sombra finos: son hasta veinte filas seguidas, y a filete completo
  // se leerían como una reja.
  fila:      { flexDirection: "row", alignItems: "center", gap: 12,
               paddingVertical: 12, paddingHorizontal: 14, marginTop: S.md },
  marca:     { width: 26, height: 26, alignItems: "center", justifyContent: "center" },
  filaTexto: { flex: 1 },
  filaFecha: { fontFamily: F.regular, fontSize: 12, color: C.muted, marginTop: 3 },
  filaCifras:{ alignItems: "flex-end" },
  filaTiempo:{ fontFamily: F.regular, fontSize: 12, color: C.muted, marginTop: 3 },
});
