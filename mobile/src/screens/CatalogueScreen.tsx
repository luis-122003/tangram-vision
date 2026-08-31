import { useEffect, useState } from "react";
import {
  View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, RefreshControl,
} from "react-native";
import { getFigures, getSolvedFigures, getStudentStats } from "../api/client";
import type { Figure, StudentStats, User } from "../api/types";
import Silhouette from "../components/Silhouette";
import Icon from "../components/Icon";
import { Bar, Card, Chip, Difficulty, Eyebrow, IconButton } from "../components/ui";
import {
  C, S, F, TAP, SAFE_TOP, SAFE_BOTTOM, cardColor, display, shout, label,
  pct, tabular, raised, inset, pressed, subtle, onFill,
} from "../theme";

const TODAS = "Todas";

/**
 * Catálogo de figuras.
 *
 * Cada figura vive en una placa con su filete y su sombra, y la silueta va
 * encajada en un nicho, como una pieza en su molde. Las que el estudiante ya
 * logró llevan un sello verde con su marca de visto: antes la señal era que el
 * nicho estuviera más hundido, que hay que explicar; el verde y el visto, no.
 */
export default function CatalogueScreen({
  user, recarga, onSelect, onOpenHistory, onOpenSettings, onLogout,
}: {
  user: User;
  /**
   * Vueltas al catálogo. Sube cada vez que se sale de una figura, y es lo único
   * que hace falta para volver a pedir los datos: esta pantalla **no se
   * desmonta** al entrar en una figura (ver el render de `App.tsx`), así que sin
   * esta señal se quedaría enseñando las estadísticas y los sellos de antes del
   * intento —el niño acaba de lograr una figura y el catálogo seguía diciendo
   * que no—.
   */
  recarga: number;
  onSelect: (fig: Figure) => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}) {
  const [figures, setFigures] = useState<Figure[]>([]);
  const [stats,   setStats]   = useState<StudentStats | null>(null);
  const [solved,  setSolved]  = useState<Set<string>>(new Set());
  const [filter,  setFilter]  = useState(TODAS);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");

  async function load() {
    setError("");
    setLoading(true);
    try {
      // Las estadísticas y el historial son opcionales: si fallan, el catálogo
      // sigue siendo utilizable.
      const [figs, st, done] = await Promise.all([
        getFigures(),
        getStudentStats(user.id).catch(() => null),
        getSolvedFigures(user.id).catch(() => new Set<string>()),
      ]);
      setFigures(figs);
      setStats(st);
      setSolved(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de conexión");
    } finally {
      setLoading(false);
    }
  }

  // También al volver de una figura, no solo al montarse: es lo que actualiza el
  // sello verde y el contador de aciertos del intento que se acaba de hacer.
  useEffect(() => { load(); }, [recarga]);

  const categories = [TODAS, ...Array.from(new Set(figures.map(f => f.category)))];
  const visible = filter === TODAS ? figures : figures.filter(f => f.category === filter);

  return (
    <ScrollView
      style={s.flex}
      contentContainerStyle={s.content}
      refreshControl={
        // Solo se marca como refrescando cuando ya hay algo debajo; en la
        // primera carga manda el indicador central.
        <RefreshControl
          refreshing={loading && figures.length > 0}
          onRefresh={load} tintColor={C.muted}
        />
      }
    >
      <View style={s.header}>
        <View style={s.flex}>
          <Text style={shout(30)}>Hola, {user.name.split(" ")[0]}</Text>
          <Text style={s.sub}>¿Qué figura vas a armar hoy?</Text>
        </View>
        {/* Los ajustes tienen que estar alcanzables **con la sesión abierta**, y
            no solo desde el ingreso: la IP de la PC cambia al pasarse al hotspot
            del celular, y hasta ahora la única forma de corregirla era cerrar
            sesión. Justo el día que más prisa hay. */}
        <IconButton name="gear" onPress={onOpenSettings} label="Ajustes del servidor" />
        <IconButton name="logout" onPress={onLogout} label="Salir de mi cuenta" />
      </View>

      {/* Progreso: /students/{id}/stats cuenta intentos, no figuras distintas.
          Cada cifra en su propia placa de color: son del mismo tipo de dato, así
          que comparten forma y se distinguen por el color. */}
      <View style={s.mb}>
        <View style={s.stats}>
          <View style={[s.stat, subtle(C.success)]}>
            <Text style={[display(26), tabular]}>{stats?.passed ?? 0}</Text>
            <Eyebrow color={C.ink} style={s.statLabel}>Aciertos</Eyebrow>
          </View>
          <View style={[s.stat, subtle(C.info)]}>
            <Text style={[display(26), tabular]}>{stats?.total ?? 0}</Text>
            <Eyebrow color={C.ink} style={s.statLabel}>Intentos</Eyebrow>
          </View>
          <View style={[s.stat, subtle(C.card)]}>
            <Text style={[display(26), tabular]}>{stats ? pct(stats.accuracy) : "—"}</Text>
            <View style={s.statBar}>
              <Bar value={stats?.accuracy ?? 0} height={10} tone="accent" />
            </View>
          </View>
        </View>

        {/* Las tres cifras son una cuenta; esto lleva al recuerdo: qué figuras
            fueron, cuánto tardó y cuál se quedó cerca. Va justo debajo porque es
            la pregunta que sigue a ver el número. */}
        <Pressable
          onPress={onOpenHistory}
          style={({ pressed: p }) => [s.verIntentos, p ? pressed(3) : raised(3)]}
          accessibilityRole="button" accessibilityLabel="Ver mis intentos"
        >
          <Icon name="clock" size={18} color={C.ink} />
          <Text style={label(13, C.ink)}>Ver mis intentos</Text>
        </Pressable>
      </View>

      {error !== "" && (
        <Card style={s.mb} tone="danger" depth={4} contentStyle={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
          <Pressable onPress={load} style={s.retry} accessibilityRole="button">
            <Icon name="refresh" size={18} color={C.ink} />
            <Text style={label(14, C.ink)}>Reintentar</Text>
          </Pressable>
        </Card>
      )}

      {loading && figures.length === 0 && <ActivityIndicator color={C.ink} size="large" />}

      {figures.length > 0 && (
        <>
          <ScrollView
            horizontal showsHorizontalScrollIndicator={false}
            style={s.chipScroll} contentContainerStyle={s.chipRow}
          >
            {categories.map(c => (
              <Chip key={c} label={c} active={filter === c} onPress={() => setFilter(c)} />
            ))}
          </ScrollView>

          <View style={s.grid}>
            {visible.map(fig => {
              const hecha = solved.has(fig.slug);
              const bloque = cardColor(fig.id);
              return (
                <Pressable
                  key={fig.slug}
                  style={({ pressed: p }) => [s.cell, s.card, p ? pressed(5) : raised(5)]}
                  onPress={() => onSelect(fig)}
                  accessibilityRole="button"
                  accessibilityLabel={`${fig.name}, dificultad ${fig.difficulty}` +
                    (hecha ? ", ya la lograste" : "")}
                >
                  {/* Nicho: la silueta encajada en un bloque de color. La tinta
                      de la silueta la decide `onFill`, no el gusto: sobre el
                      bloque ámbar, un recorte en crema sería invisible. */}
                  <View style={[s.block, inset(3, bloque)]}>
                    <Silhouette figure={fig} size={90} mode="knockout" color={onFill(bloque)} />
                    {/* Ya lograda: sello verde con su visto. Color y símbolo,
                        no una sombra más profunda que haya que interpretar. */}
                    {hecha && (
                      <View style={[s.done, subtle(C.success)]}>
                        <Icon name="check" size={14} color={C.ink} strokeWidth={3.5} />
                      </View>
                    )}
                  </View>
                  <View style={s.cellText}>
                    <Text style={display(17)} numberOfLines={1}>{fig.name}</Text>
                    <Difficulty level={fig.difficulty} />
                  </View>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  flex:      { flex: 1 },
  content:   { paddingHorizontal: S.lg + 4, paddingTop: SAFE_TOP, paddingBottom: SAFE_BOTTOM + 20 },
  mb:        { marginBottom: S.xl },

  header:    { flexDirection: "row", alignItems: "flex-start", gap: S.md, marginBottom: S.xl },
  sub:       { fontFamily: F.regular, fontSize: 14, color: C.muted, marginTop: 6 },

  // Tres placas separadas por aire, no una lámina dividida: así cada cifra
  // puede llevar su propio color sin que dos filetes se toquen.
  stats:     { flexDirection: "row", alignItems: "stretch", gap: S.sm },
  stat:      { flex: 1, paddingVertical: S.md, paddingHorizontal: 12 },
  statLabel: { marginTop: 4 },
  statBar:   { marginTop: 8 },

  verIntentos:{ flexDirection: "row", alignItems: "center", justifyContent: "center",
                gap: S.sm, height: TAP.min, marginTop: S.md },

  errorBox:  { padding: 16 },
  errorText: { fontFamily: F.regular, fontSize: 14, color: C.ink, lineHeight: 20 },
  retry:     { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12,
               alignSelf: "flex-start", minHeight: 44 },

  // La fila de filtros se sale del margen a propósito: es un carrusel, y ver el
  // último chip cortado en el borde avisa de que hay más categorías.
  chipScroll:{ marginHorizontal: -(S.lg + 4), marginBottom: S.xl },
  chipRow:   { flexDirection: "row", gap: S.md, paddingHorizontal: S.lg + 4, paddingVertical: S.sm },

  grid:      { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  cell:      { width: "47%", marginBottom: S.xl },
  card:      { padding: 10 },
  block:     { height: 104, alignItems: "center", justifyContent: "center" },
  // El sello va dentro del nicho, que no recorta, así que su sombra se ve.
  done:      { position: "absolute", top: 6, right: 6, width: 26, height: 26,
               alignItems: "center", justifyContent: "center" },
  cellText:  { paddingHorizontal: 4, paddingTop: 12, paddingBottom: 4 },
});
