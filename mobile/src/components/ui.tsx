import type { ReactNode } from "react";
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator,
  type StyleProp, type TextStyle, type ViewStyle,
} from "react-native";
import Icon, { type IconName } from "./Icon";
import {
  C, R, S, TAP, F, B, label as labelType, eyebrow,
  raised, inset, pressed, subtle, flat, off as offStyle, onFill,
  DIFFICULTY_LEVEL, DIFFICULTY_COLOR,
} from "../theme";

/**
 * Primitivas del sistema de diseño neobrutalista.
 *
 * Todo es una placa con filete negro y sombra sólida. Los botones son
 * `Pressable` y no `TouchableOpacity` a propósito: aquí pulsar no significa
 * volverse translúcido, significa **aplastarse contra su propia sombra**, como
 * una tecla real.
 *
 * Cuidado al tocar los arrays de estilo: en React Native, la rama pulsada tiene
 * que anular la sombra **explícitamente** —eso hace `pressed()`—, porque
 * `transform` mueve la vista junto con su sombra y omitir la clave dejaría viva
 * la sombra de la rama anterior del array.
 *
 * `tone` es la prop nueva del rediseño. El sistema anterior no tenía ninguna
 * porque no tenía colores: el estado viajaba por el relieve. Ahora las tres
 * primitivas que muestran estado —la lámina, la barra y la acción principal—
 * aceptan un color de relleno, y la tinta de encima la decide `onFill` para que
 * ningún sitio de uso pueda equivocarse.
 */

/** Rellenos con significado. Cada uno trae su tinta obligatoria vía `onFill`. */
export type Tone = "default" | "success" | "warning" | "danger" | "accent" | "info";

const TONE_FILL: Record<Tone, string> = {
  default: C.card,
  success: C.success,
  warning: C.warning,
  danger:  C.danger,
  accent:  C.accent,
  info:    C.info,
};

export function toneFill(tone: Tone = "default"): string {
  return TONE_FILL[tone] ?? C.card;
}

export function Card({ children, style, contentStyle, depth = 4, sunken, clip, tone }: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  /** Cuánto se desplaza la sombra. Bájalo en listas largas. */
  depth?: number;
  /** Hueco en lugar de placa: para lo que contiene algo. No proyecta sombra. */
  sunken?: boolean;
  clip?: boolean;
  /** Relleno con significado: éxito, aviso, error… */
  tone?: Tone;
}) {
  const fill = tone ? toneFill(tone) : undefined;
  return (
    <View style={style}>
      <View style={[
        sunken ? inset(depth, fill ?? C.well) : raised(depth, fill ?? C.card),
        // `R.clip` no es un radio decorativo: sin él, Android deja asomar un
        // píxel del bitmap hijo en las esquinas del filete.
        clip ? s.clip : null,
        contentStyle,
      ]}>
        {children}
      </View>
    </View>
  );
}

export function Eyebrow({ children, color, style }: {
  children: ReactNode; color?: string; style?: StyleProp<TextStyle>;
}) {
  return <Text style={[eyebrow(color), style]}>{children}</Text>;
}

/**
 * Acción principal de la pantalla. Solo puede haber una a la vista.
 *
 * Lo que la hace principal es el tamaño, el filete más gordo de la pantalla y
 * la sombra más larga. Al pulsarla recorre exactamente esa sombra.
 */
export function PrimaryButton({ label, icon, onPress, disabled, loading, tone = "accent" }: {
  label: string; icon?: IconName; onPress: () => void;
  disabled?: boolean; loading?: boolean; tone?: Tone;
}) {
  const apagado = disabled || loading;
  const fill = toneFill(tone);
  const tinta = apagado ? C.ghost : onFill(fill);
  return (
    <Pressable
      onPress={onPress} disabled={apagado}
      accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled: !!apagado }}
      style={({ pressed: p }) => [
        s.primary,
        apagado ? offStyle() : p ? pressed(6, fill) : raised(6, fill),
        // El filete más gordo de la pantalla: es la jerarquía, no un adorno.
        apagado ? null : s.loudBorder,
      ]}
    >
      {loading
        ? <ActivityIndicator color={C.ink} />
        : (
          <>
            {icon && <Icon name={icon} size={23} color={tinta} />}
            <Text style={[labelType(18, tinta), s.btnLabel]}>{label}</Text>
          </>
        )}
    </Pressable>
  );
}

export function SecondaryButton({ label, icon, onPress }: {
  label: string; icon?: IconName; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed: p }) => [s.secondary, p ? pressed(4) : raised(4)]}
    >
      {icon && <Icon name={icon} size={20} color={C.ink} />}
      <Text style={labelType(15, C.ink)}>{label}</Text>
    </Pressable>
  );
}

/** Botón cuadrado de una sola acción (volver, salir). */
export function IconButton({ name, onPress, label, color = C.ink }: {
  name: IconName; onPress: () => void; label: string; color?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed: p }) => [s.iconBtn, p ? pressed(3) : raised(3)]}
    >
      <Icon name={name} size={21} color={color} />
    </Pressable>
  );
}

/**
 * Filtro del catálogo.
 *
 * El activo es el único de la fila que va en negativo —relleno de tinta— y se
 * queda aplastado abajo, como una tecla trabada. Se combinan las dos señales a
 * propósito: la inversión se ve de un vistazo en toda la fila, y la posición
 * dice que sigue siendo un botón.
 */
export function Chip({ label, active, onPress }: {
  label: string; active?: boolean; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={({ pressed: p }) => [
        s.chip,
        active ? pressed(3, C.ink) : p ? pressed(3) : raised(3),
      ]}
    >
      <Text style={labelType(13, active ? C.paper : C.ink)}>{label}</Text>
    </Pressable>
  );
}

/**
 * Dificultad: cuadritos y color.
 *
 * Los cuadritos se conservan del sistema anterior y siguen siendo la señal
 * principal, porque se entienden sin saber leer y sin distinguir los colores.
 * Lo que cambia es que ahora se rellenan del color de la dificultad en vez de
 * hundirse, y que el nombre escrito va al lado como tercera pista.
 *
 * Filete fino, y no por estética: un cuadrito de 10 px con filete de 3 sería
 * más borde que relleno y el color desaparecería. De paso sube a 14 px.
 */
export function Difficulty({ level }: { level: string }) {
  const filled = DIFFICULTY_LEVEL[level] ?? 1;
  const color = DIFFICULTY_COLOR[level] ?? C.card;
  return (
    <View style={s.difRow}>
      <View style={s.difSquares}>
        {[0, 1, 2].map(i => (
          <View key={i} style={[
            s.difSquare,
            i < filled ? flat(color) : flat(C.well),
          ]} />
        ))}
      </View>
      <Text style={labelType(12, C.ink)}>{level}</Text>
    </View>
  );
}

/** Nota al margen: una placa de papel amarillo, con su filete. */
export function Note({ title, children, tone }: {
  title?: string; children: ReactNode; tone?: Tone;
}) {
  return (
    <View style={[s.note, tone ? subtle(toneFill(tone)) : subtle(C.note)]}>
      {title && <Eyebrow color={C.ink} style={s.noteTitle}>{title}</Eyebrow>}
      <Text style={s.noteText}>{children}</Text>
    </View>
  );
}

/**
 * Barra de avance: un canal con filete y dentro una barra de color plano.
 *
 * El relleno lleva su propio filete en el borde de avance, y esa es la razón de
 * ser del detalle: sin él, una barra de color claro dentro de un canal claro no
 * tiene un límite perceptible —falla el mínimo de 3:1 que WCAG pide a los
 * componentes gráficos—. Con el filete, la frontera siempre la marca el negro.
 *
 * La cifra en porcentaje va igualmente al lado: la barra sugiere, el número
 * informa.
 *
 * La marca del umbral se dibuja **fuera** del canal, no dentro. Tiene que
 * sobresalir por arriba y por abajo para leerse como una marca y no como un
 * trozo de relleno, y el canal lleva `overflow: "hidden"` para recortar la
 * barra: metida dentro, esos cuatro píxeles se los comía el recorte y la marca
 * quedaba a ras. El recuadro que la posiciona se ciñe al interior del filete
 * para que el porcentaje caiga exactamente donde cae el relleno.
 */
export function Bar({ value, height = 14, mark, tone = "accent" }: {
  value: number; height?: number; mark?: number; tone?: Tone;
}) {
  const v = Math.max(0, Math.min(1, value));
  const width = `${v * 100}%` as `${number}%`;
  return (
    <View>
      <View style={[s.bar, { height }, inset(3)]}>
        <View style={[
          s.barFill,
          { width, backgroundColor: toneFill(tone) },
          v > 0 && v < 1 ? s.barEdge : null,
        ]} />
      </View>
      {mark !== undefined && (
        <View style={s.barMarkArea} pointerEvents="none">
          <View style={[s.barMark, { left: `${mark * 100}%` as `${number}%` }]} />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  clip:     { overflow: "hidden", borderRadius: R.clip },

  loudBorder: { borderWidth: B.loud },

  primary:  { height: TAP.primary, flexDirection: "row",
              alignItems: "center", justifyContent: "center", gap: S.sm + 2 },
  btnLabel: { textAlign: "center" },

  secondary: { height: TAP.secondary, flexDirection: "row",
               alignItems: "center", justifyContent: "center", gap: 9 },

  iconBtn:  { width: TAP.control, height: TAP.control,
              alignItems: "center", justifyContent: "center" },

  chip:     { height: TAP.min, paddingHorizontal: 18, justifyContent: "center" },

  difRow:     { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 7 },
  difSquares: { flexDirection: "row", gap: 5 },
  difSquare:  { width: 14, height: 14 },

  note:      { paddingVertical: 14, paddingHorizontal: 16 },
  noteTitle: { marginBottom: 6 },
  noteText:  { fontFamily: F.regular, fontSize: 14, lineHeight: 20, color: C.ink },

  // El canal recorta el relleno, así que ni el canal ni el relleno pueden
  // llevar sombra: se resuelve quitándola, no quitando el recorte.
  bar:      { justifyContent: "center", overflow: "hidden" },
  barFill:  { height: "100%" },
  barEdge:  { borderRightWidth: B.hair, borderRightColor: C.ink },
  // Se calca sobre el canal descontando su filete: es lo que hace que un 75 %
  // de marca y un 75 % de relleno coincidan en el mismo píxel.
  barMarkArea:{ position: "absolute", left: B.base, right: B.base, top: 0, bottom: 0 },
  barMark:  { position: "absolute", top: -4, bottom: -4, width: B.base,
              backgroundColor: C.ink },
});
