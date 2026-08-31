import { useEffect, useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, useWindowDimensions,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Svg, { Polygon, Rect } from "react-native-svg";
import { login, logout } from "../api/client";
import { getApiUrl } from "../api/config";
import type { User } from "../api/types";
import Icon from "../components/Icon";
import { Card, Eyebrow } from "../components/ui";
import { PIN_LENGTH, PinBoxes, PinPad } from "../components/Pin";
import {
  C, S, F, B, TAP, SAFE_BOTTOM, display, shout, label as labelType,
  tabular, raised, inset, subtle, flat,
} from "../theme";

const LAST_STUDENT = "tangram.lastStudent";

/**
 * Ingreso sin teclado alfanumérico.
 *
 * Un niño de primaria no escribe un correo cuatro veces al día, así que el
 * teléfono recuerda al último estudiante que entró y solo le pide su clave de
 * cuatro dígitos en un teclado propio, con teclas grandes. Por debajo no cambia
 * nada: la tarjeta guarda el correo y el PIN viaja como contraseña, así que
 * `POST /token` sigue recibiendo username + password.
 *
 * El teclado es donde el estilo se gana el sueldo: cada tecla es una placa con
 * su filete y su sombra, y al tocarla recorre esa sombra hasta aplastarse
 * contra ella, que es exactamente lo que hace una tecla de verdad. Las casillas
 * del PIN son huecos, y la que toca escribir se marca en color.
 *
 * Es también la pantalla más densa del sistema: doce teclas con filete y sombra
 * son veinticuatro dibujos a la vez. Por eso las teclas llevan sombra de 3 px y
 * no de 5: a plena longitud, doce sombras seguidas se leen como ruido.
 */
export default function LoginScreen({ onLogin, onOpenSettings }: {
  onLogin: (u: User) => void; onOpenSettings: () => void;
}) {
  const { width } = useWindowDimensions();

  const [account,    setAccount]    = useState<{ name: string; email: string } | null>(null);
  const [editing,    setEditing]    = useState(false);
  const [email,      setEmail]      = useState("estudiante@tangram.edu");
  const [pin,        setPin]        = useState("");
  const [error,      setError]      = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(LAST_STUDENT)
      .then(raw => {
        if (!raw) return;
        const saved = JSON.parse(raw) as { name: string; email: string };
        setAccount(saved);
        setEmail(saved.email);
      })
      .catch(() => { /* sin recuerdo previo se pide el correo */ });
  }, []);

  function press(digit: string) {
    setError("");
    setPin(p => (p.length >= PIN_LENGTH ? p : p + digit));
  }

  function backspace() {
    setError("");
    setPin(p => p.slice(0, -1));
  }

  async function submit() {
    if (pin.length < PIN_LENGTH || submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const clean = email.trim();
      // `login` guarda el token de sesión y devuelve ya el usuario.
      const usuario = await login(clean, pin);

      // Esta app es solo para estudiantes, y el servidor opina lo mismo: el
      // docente no juega, así que `POST /sessions` le responde 403. Dejarlo
      // entrar no daba un error visible —el fallo al guardar se tragaba— sino
      // algo peor: una app que parece funcionar y no anota ni un intento.
      // Se cierra la sesión que se acaba de abrir, también en el servidor.
      if (usuario.role !== "student") {
        await logout();
        setError("Esta app es para estudiantes. El docente entra por la web.");
        setPin("");
        return;
      }

      await AsyncStorage.setItem(LAST_STUDENT, JSON.stringify({ name: usuario.name, email: clean }))
        .catch(() => { /* recordar es opcional */ });
      onLogin(usuario);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo entrar.");
      setPin("");
    } finally {
      setSubmitting(false);
    }
  }

  const askEmail = editing || account === null;
  // Las fichas decorativas se anclan al borde derecho, sea cual sea el ancho.
  const d = width - 390;

  return (
    <KeyboardAvoidingView
      style={s.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
    <ScrollView
      style={s.flex} contentContainerStyle={s.scroll}
      keyboardShouldPersistTaps="handled"
    >
      {/* Marca: las fichas del Tangram desparramadas, a color pleno y con su
          contorno negro. Antes iban a media opacidad porque el estilo no
          admitía color y había que insinuarlas; ahora no hace falta el truco. */}
      <View style={s.band}>
        <Svg width={width} height={190} style={StyleSheet.absoluteFill}>
          <Polygon points={`${252 + d},22 ${356 + d},22 ${304 + d},74`} fill={C.cobalto}
                   stroke={C.ink} strokeWidth={2.5} strokeLinejoin="miter" />
          <Polygon points={`${356 + d},22 ${356 + d},126 ${304 + d},74`} fill={C.ciruela}
                   stroke={C.ink} strokeWidth={2.5} strokeLinejoin="miter" />
          <Polygon points={`${252 + d},86 ${304 + d},138 ${252 + d},138`} fill={C.ambar}
                   stroke={C.ink} strokeWidth={2.5} strokeLinejoin="miter" />
          <Polygon points={`${312 + d},92 ${364 + d},92 ${338 + d},118 ${286 + d},118`} fill={C.verde}
                   stroke={C.ink} strokeWidth={2.5} strokeLinejoin="miter" />
          <Polygon points={`${264 + d},150 ${316 + d},150 ${290 + d},176`} fill={C.rojo}
                   stroke={C.ink} strokeWidth={2.5} strokeLinejoin="miter" />
          <Rect x={330 + d} y={146} width={34} height={34} fill={C.card}
                stroke={C.ink} strokeWidth={2.5} />
        </Svg>
        <View style={s.brand}>
          <View style={s.brandRow}>
            <Text style={[shout(40), s.wordmark]}>TAN{"\n"}GRAM</Text>
            <View style={[s.badge, raised(4, C.warning)]}>
              <Text style={display(18, C.ink)}>IA</Text>
            </View>
          </View>
          <Text style={s.tagline}>Arma · Fotografía · Comprueba</Text>
        </View>
      </View>

      <View style={s.body}>
        {/* Quién entra */}
        <View>
          <Eyebrow color={C.ink}>{askEmail ? "Escribe tu correo" : "Estás entrando como"}</Eyebrow>
          {askEmail ? (
            <View style={[s.mt8, s.emailBox, inset(4)]}>
              <TextInput
                style={s.emailInput} value={email} onChangeText={setEmail}
                autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
                placeholder="usuario@tangram.edu" placeholderTextColor={C.ghost}
                accessibilityLabel="Correo del estudiante"
              />
            </View>
          ) : (
            <Card style={s.mt8} depth={5} contentStyle={s.who}>
              <View style={[s.initial, flat(C.accent, B.base)]}>
                <Text style={display(20, C.ink)}>{account!.name.trim().charAt(0).toUpperCase()}</Text>
              </View>
              <View style={s.whoText}>
                <Text style={s.whoName} numberOfLines={1}>{account!.name}</Text>
                <Text style={s.whoMail} numberOfLines={1}>{account!.email}</Text>
              </View>
              <Pressable
                onPress={() => { setEditing(true); setPin(""); }}
                style={s.change} accessibilityRole="button"
                accessibilityLabel="Entrar con otro correo"
              >
                <Text style={labelType(12, C.ink)}>Cambiar</Text>
              </Pressable>
            </Card>
          )}
        </View>

        {/* Clave: cuatro huecos y el teclado, los dos de `components/Pin`. Los
            comparte con la pantalla de cambiar la clave, que los pide tres
            veces seguidas. */}
        <View>
          <Eyebrow color={C.ink}>Escribe tu clave</Eyebrow>
          <View style={s.mt8}>
            <PinBoxes value={pin} />
          </View>
          {error !== "" && (
            <View style={[s.errorBox, subtle(C.danger)]}>
              <Text style={s.error}>{error}</Text>
            </View>
          )}
        </View>

        <PinPad
          onDigit={press} onBackspace={backspace} onSubmit={submit}
          canSubmit={pin.length === PIN_LENGTH} busy={submitting}
          submitLabel="Entrar"
        />

        {/* Ajustes del servidor: discretos pero alcanzables */}
        <Pressable
          onPress={onOpenSettings} style={s.server}
          accessibilityRole="button" accessibilityLabel="Cambiar la dirección del servidor"
        >
          <Icon name="gear" size={17} color={C.muted} />
          <Text style={[s.serverText, tabular]} numberOfLines={1}>
            Servidor {getApiUrl().replace(/^https?:\/\//, "")}
          </Text>
          <Text style={labelType(12, C.ink)}>Cambiar</Text>
        </Pressable>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  flex:      { flex: 1, backgroundColor: C.base },
  scroll:    { flexGrow: 1 },
  mt8:       { marginTop: S.sm },

  band:      { height: 190, justifyContent: "flex-end" },
  brand:     { paddingLeft: S.xl, paddingBottom: 26 },
  brandRow:  { flexDirection: "row", alignItems: "flex-end", gap: S.md },
  // El interlineado no puede bajar del tamaño de letra: Android recorta.
  wordmark:  { lineHeight: 42 },
  badge:     { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  tagline:   { fontFamily: F.bold, fontSize: 13, color: C.ink,
               marginTop: S.md, letterSpacing: 0.5 },

  body:      { flex: 1, paddingHorizontal: S.xl, paddingTop: 22,
               paddingBottom: SAFE_BOTTOM, gap: 20 },

  emailBox:  { height: 58, justifyContent: "center", paddingHorizontal: 16 },
  emailInput:{ fontFamily: F.medium, fontSize: 16, color: C.ink, padding: 0 },

  who:       { flexDirection: "row", alignItems: "center",
               paddingLeft: 12, paddingRight: 4, paddingVertical: 10 },
  initial:   { width: 46, height: 46, alignItems: "center", justifyContent: "center" },
  whoText:   { flex: 1, paddingLeft: 14 },
  whoName:   { fontFamily: F.bold, fontSize: 16, color: C.ink },
  whoMail:   { fontFamily: F.regular, fontSize: 12, color: C.muted },
  change:    { justifyContent: "center", paddingHorizontal: 14, minHeight: TAP.min },

  errorBox:  { marginTop: 12, paddingVertical: 10, paddingHorizontal: 14 },
  error:     { fontFamily: F.bold, fontSize: 14, color: C.ink, textAlign: "center" },

  server:    { marginTop: "auto", flexDirection: "row", alignItems: "center", gap: S.sm,
               paddingTop: 16, paddingBottom: 8, minHeight: TAP.min },
  serverText:{ flex: 1, fontFamily: F.regular, fontSize: 12, color: C.muted },
});
