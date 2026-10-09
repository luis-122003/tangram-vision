import { useEffect, useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, useWindowDimensions,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Svg, { Polygon, Rect } from "react-native-svg";
import {
  buscarServidor, CorreoSinVerificar, ErrorDeRed, login, logout, olvideClave,
  reenviarCodigo, registrar, restablecerClave, verificarCorreo,
} from "../api/client";
import { useApiUrl } from "../api/config";
import type { User } from "../api/types";
import Icon from "../components/Icon";
import { Card, Eyebrow, PrimaryButton } from "../components/ui";
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
 *
 * La misma pantalla sirve para **crear la cuenta**. No es otra pantalla porque
 * pide lo mismo que entrar más dos datos —nombre y correo— y la clave se
 * teclea en el mismo teclado de cuatro dígitos: la cuenta nace ya con la clave
 * que el niño eligió. Al crearla, el servidor manda un código de seis números
 * al correo, y la cuenta no se activa hasta escribirlo aquí mismo (modo
 * `codigo`): es la prueba de que el correo es suyo y no de un compañero. Con
 * el código bueno se va derecho al catálogo, y el docente la ve aparecer en su
 * panel sin haber hecho nada.
 *
 * Y sirve para **recuperar la clave olvidada**: se pide un código al correo
 * (`olvide`) y con él se elige un PIN nuevo (`restablecer`). Solo funciona con
 * cuentas cuyo correo está confirmado; las que dio de alta el docente con un
 * correo de aula siguen pidiéndole a él que la regenere.
 */
type Modo = "entrar" | "registro" | "codigo" | "olvide" | "restablecer";

/** Segundos que el servidor hace esperar entre dos envíos (EMAIL_CODE_RESEND). */
const ESPERA_REENVIO = 60;

/** Un código de correo completo: seis números. */
const esCodigo = (c: string) => /^\d{6}$/.test(c);

/** Tiene pinta de correo. El servidor es quien lo valida de verdad. */
const correoValido = (c: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.trim());

export default function LoginScreen({ onLogin, onOpenSettings, onOpenMaterials }: {
  /**
   * Entró. Se devuelve también **la clave que tecleó**, y no por capricho: si
   * la cuenta viene con la clave temporal del docente, la raíz de la app lleva
   * al estudiante a cambiarla en el acto, y para eso hace falta la clave de
   * ahora. Pedírsela otra vez en la pantalla siguiente sería hacerle repetir un
   * número que la app acaba de recibir.
   *
   * No se guarda en ningún sitio: vive en el estado de `App.tsx` hasta que se
   * completa el cambio, y se borra con él.
   */
  onLogin: (u: User, clave: string) => void;
  onOpenSettings: () => void; onOpenMaterials: () => void;
}) {
  const { width } = useWindowDimensions();

  const [account,    setAccount]    = useState<{ name: string; email: string } | null>(null);
  const [editing,    setEditing]    = useState(false);
  const [email,      setEmail]      = useState("estudiante@tangram.edu");
  const [pin,        setPin]        = useState("");
  const [error,      setError]      = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [modo,       setModo]       = useState<Modo>("entrar");
  /**
   * Nombre y correo de la cuenta nueva. Van aparte del `email` del ingreso a
   * propósito: cambiar de modo no puede pisar el correo con el que el teléfono
   * recuerda al último estudiante, ni al revés.
   */
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [correoNuevo, setCorreoNuevo] = useState("");
  /**
   * La cuenta que espera su código: correo y la clave que se acaba de teclear.
   * La clave se guarda solo en memoria, mientras dura este paso, porque el
   * servidor activa la cuenta con el código **y** la clave juntos.
   */
  const [pendiente, setPendiente] = useState<{ correo: string; clave: string } | null>(null);
  /** El código de seis números que llegó al correo. */
  const [codigo,     setCodigo]     = useState("");
  /** Correo de la cuenta cuya clave se está recuperando. */
  const [correoOlvido, setCorreoOlvido] = useState("");
  /** Un mensaje que no es un error: «te enviamos un código…». */
  const [aviso,      setAviso]      = useState("");
  /** Segundos que faltan para poder pedir otro código. */
  const [espera,     setEspera]     = useState(0);
  /** Se está sondeando la red buscando el servidor (ver `entrar`). */
  const [buscando,   setBuscando]   = useState(false);
  // La dirección se dibuja desde el hook y no leyéndola una vez: la búsqueda
  // automática puede reemplazarla mientras esta pantalla está abierta, y aquí
  // hay que decir a dónde se va a conectar de verdad.
  const apiUrl = useApiUrl();

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

  // Cuenta atrás del reenvío: un paso por segundo, solo mientras hace falta.
  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera(e => e - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  function press(digit: string) {
    setError("");
    setPin(p => (p.length >= PIN_LENGTH ? p : p + digit));
  }

  function backspace() {
    setError("");
    setPin(p => p.slice(0, -1));
  }

  /** Cambia de paso. La clave y el código a medias no se arrastran. */
  function cambiarModo(nuevo: Modo) {
    setModo(nuevo);
    setPin("");
    setCodigo("");
    setError("");
    setAviso("");
    if (nuevo === "entrar") setPendiente(null);
  }

  /** Pasa a escribir el código de la cuenta recién creada o sin confirmar. */
  function pedirCodigo(correo: string, clave: string, mensaje: string, esperar: boolean) {
    setPendiente({ correo, clave });
    cambiarModo("codigo");
    setAviso(mensaje);
    setEspera(esperar ? ESPERA_REENVIO : 0);
  }

  /** Los dos datos del registro están escritos y tienen pinta de serlo. */
  const datosDeRegistro = nombreNuevo.trim().length >= 2 && correoValido(correoNuevo);
  const canSubmit =
    modo === "codigo"      ? esCodigo(codigo) :
    modo === "olvide"      ? correoValido(correoOlvido) :
    modo === "restablecer" ? esCodigo(codigo) && pin.length === PIN_LENGTH :
    pin.length === PIN_LENGTH && (modo === "entrar" || datosDeRegistro);

  async function submit() {
    if (!canSubmit || submitting) return;
    setError("");
    setSubmitting(true);
    try {
      if (modo === "registro") await crearCuenta(pin);
      else if (modo === "codigo") await confirmarCodigo();
      else if (modo === "olvide") await pedirRecuperacion();
      else if (modo === "restablecer") await cambiarClaveOlvidada();
      else await entrar(pin);
    } catch (e) {
      setAviso("");
      setError(e instanceof Error ? e.message : "No se pudo entrar.");
      setPin("");
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Lanza una petición que abre sesión, mudándose de red si hace falta.
   *
   * Si falla **por red** —y solo por red: un PIN equivocado no cuenta— se
   * sondean las otras direcciones conocidas y, si el servidor aparece en una de
   * ellas, se reintenta una sola vez. Es el caso de siempre: el teléfono se
   * quedó con la dirección del aula de ayer, o con la de casa. Así la app se
   * muda de red por su cuenta en vez de mandar a un niño a Ajustes a teclear
   * una IP.
   *
   * Lo comparten entrar y registrarse: una cuenta nueva se crea en el mismo
   * aula, con el mismo teléfono y la misma dirección guardada de ayer.
   */
  async function conReintentoDeRed<T>(peticion: () => Promise<T>): Promise<T> {
    try {
      return await peticion();
    } catch (e) {
      if (!(e instanceof ErrorDeRed)) throw e;
      setError("");
      setBuscando(true);
      const hallado = await buscarServidor().catch(() => null);
      setBuscando(false);
      // Solo se reintenta si el servidor está en otra dirección. Si contestó
      // en la que ya había, el fallo no era la dirección y repetir el intento
      // solo daría el mismo error dos veces.
      if (hallado?.cambio) return peticion();
      throw e;
    }
  }

  /** El teléfono se queda con quién entró, para no pedir el correo mañana. */
  async function recordar(usuario: User, correo: string): Promise<void> {
    await AsyncStorage.setItem(LAST_STUDENT, JSON.stringify({ name: usuario.name, email: correo }))
      .catch(() => { /* recordar es opcional */ });
  }

  /**
   * Un intento de ingreso.
   *
   * La clave se pasa por parámetro porque el reintento la necesita intacta: el
   * estado se limpia al mostrar el error.
   */
  async function entrar(clave: string): Promise<void> {
    const clean = email.trim();
    // `login` guarda el token de sesión y devuelve ya el usuario.
    let usuario: User;
    try {
      usuario = await conReintentoDeRed(() => login(clean, clave));
    } catch (e) {
      // Clave buena, correo sin confirmar: no es un error, es el paso que falta.
      // Se deja pedir otro código al momento: el último pudo llegar hace días.
      if (e instanceof CorreoSinVerificar) {
        pedirCodigo(clean.toLowerCase(), clave, e.message, false);
        return;
      }
      throw e;
    }

    // Esta app es solo para estudiantes, y el servidor opina lo mismo: el
    // docente no juega, así que `POST /sessions` le responde 403. Dejarlo
    // entrar no daba un error visible —el fallo al guardar se tragaba— sino
    // algo peor: una app que parece funcionar y no anota ni un intento.
    // Se cierra la sesión que se acaba de abrir, también en el servidor.
    if (usuario.role !== "student") {
      await logout();
      throw new Error("Esta app es para estudiantes. El docente entra por la web.");
    }

    await recordar(usuario, clean);
    onLogin(usuario, clave);
  }

  /**
   * Crea la cuenta y pasa a pedir el código que el servidor mandó al correo.
   * La sesión no llega todavía: llega con el código (`confirmarCodigo`).
   */
  async function crearCuenta(clave: string): Promise<void> {
    const nombre = nombreNuevo.trim();
    const correo = correoNuevo.trim().toLowerCase();
    await conReintentoDeRed(() => registrar(nombre, correo, clave));
    pedirCodigo(
      correo, clave, `Te enviamos un código de 6 números a ${correo}. Escríbelo aquí.`, true,
    );
  }

  /**
   * Con el código bueno la cuenta queda activa y la sesión abierta, así que el
   * resto es idéntico a entrar: recordar al estudiante y avisar a la raíz. No
   * hace falta comprobar el rol: por esta puerta el servidor solo activa
   * cuentas de estudiante.
   */
  async function confirmarCodigo(): Promise<void> {
    if (!pendiente) return;
    const { correo, clave } = pendiente;
    const usuario = await conReintentoDeRed(() => verificarCorreo(correo, clave, codigo.trim()));
    await recordar(usuario, correo);
    setPendiente(null);
    onLogin(usuario, clave);
  }

  /** Abre la recuperación con el correo que ya se conoce, si hay uno. */
  function empezarRecuperacion() {
    const conocido = email.trim();
    cambiarModo("olvide");
    setCorreoOlvido(conocido);
  }

  async function pedirRecuperacion(): Promise<void> {
    const correo = correoOlvido.trim().toLowerCase();
    await conReintentoDeRed(() => olvideClave(correo));
    cambiarModo("restablecer");
    setCorreoOlvido(correo);
    setAviso(
      `Si ${correo} tiene una cuenta con el correo confirmado, te llegará un código. ` +
      "Escríbelo y elige tu clave nueva."
    );
    setEspera(ESPERA_REENVIO);
  }

  /** Cambia la clave y vuelve al ingreso para entrar con ella. */
  async function cambiarClaveOlvidada(): Promise<void> {
    const correo = correoOlvido.trim().toLowerCase();
    await conReintentoDeRed(() => restablecerClave(correo, codigo.trim(), pin));
    setEmail(correo);
    // Si el teléfono recordaba a otro estudiante, se entra con este correo.
    if (account?.email !== correo) setEditing(true);
    cambiarModo("entrar");
    setAviso("Listo, ya tienes tu clave nueva. Escríbela para entrar.");
  }

  /** Otro código, para el paso en el que se esté: verificar o recuperar. */
  async function reenviar(): Promise<void> {
    if (espera > 0 || submitting) return;
    setError("");
    try {
      if (modo === "codigo" && pendiente) await reenviarCodigo(pendiente.correo);
      else if (modo === "restablecer") await olvideClave(correoOlvido.trim().toLowerCase());
      else return;
      setAviso("Te enviamos otro código. Usa el más nuevo.");
      setCodigo("");
      setEspera(ESPERA_REENVIO);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo reenviar el código.");
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
        {modo === "codigo" || modo === "restablecer" ? (
          /* El código del correo. Va en un campo de texto con teclado numérico
             y no en el teclado propio: son seis números y no cuatro, y así el
             teléfono puede ofrecer pegarlo desde la notificación del correo. */
          <View>
            <Eyebrow color={C.ink}>Código del correo</Eyebrow>
            <View style={[s.mt8, s.emailBox, inset(4)]}>
              <TextInput
                style={[s.emailInput, s.codigoInput, tabular]} value={codigo}
                onChangeText={t => { setError(""); setCodigo(t.replace(/\D/g, "").slice(0, 6)); }}
                keyboardType="number-pad" maxLength={6} autoComplete="one-time-code"
                textContentType="oneTimeCode"
                placeholder="000000" placeholderTextColor={C.ghost}
                accessibilityLabel="Código de seis números recibido por correo"
              />
            </View>
            <Pressable
              onPress={reenviar} disabled={espera > 0}
              style={s.alternar} accessibilityRole="button"
              accessibilityLabel="Enviar otro código"
              accessibilityState={{ disabled: espera > 0 }}
            >
              <Text style={s.alternarTexto}>¿No te llegó? Mira también en spam.</Text>
              <Text style={labelType(12, espera > 0 ? C.muted : C.ink)}>
                {espera > 0 ? `Otro en ${espera} s` : "Enviar otro"}
              </Text>
            </Pressable>
          </View>
        ) : modo === "olvide" ? (
          <View>
            <Eyebrow color={C.ink}>¿Olvidaste tu clave? Escribe tu correo</Eyebrow>
            <View style={[s.mt8, s.emailBox, inset(4)]}>
              <TextInput
                style={s.emailInput} value={correoOlvido}
                onChangeText={t => { setError(""); setCorreoOlvido(t); }}
                autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
                maxLength={254}
                placeholder="tu-correo@colegio.edu" placeholderTextColor={C.ghost}
                accessibilityLabel="Correo de la cuenta"
              />
            </View>
          </View>
        ) : modo === "registro" ? (
          /* La cuenta nueva: nombre y correo. La clave va abajo, en el mismo
             teclado que el ingreso, porque es la misma clave de cuatro
             dígitos que va a teclear mañana para entrar. */
          <View>
            <Eyebrow color={C.ink}>Crea tu cuenta</Eyebrow>
            <View style={[s.mt8, s.emailBox, inset(4)]}>
              <TextInput
                style={s.emailInput} value={nombreNuevo} onChangeText={setNombreNuevo}
                autoCapitalize="words" autoCorrect={false} maxLength={120}
                placeholder="Tu nombre y apellido" placeholderTextColor={C.ghost}
                accessibilityLabel="Nombre del estudiante"
              />
            </View>
            <View style={[s.mt8, s.emailBox, inset(4)]}>
              <TextInput
                style={s.emailInput} value={correoNuevo} onChangeText={setCorreoNuevo}
                autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
                maxLength={254}
                placeholder="tu-correo@colegio.edu" placeholderTextColor={C.ghost}
                accessibilityLabel="Correo del estudiante"
              />
            </View>
          </View>
        ) : (
          /* Quién entra */
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
        )}

        {/* Clave: cuatro huecos y el teclado, los dos de `components/Pin`. Los
            comparte con la pantalla de cambiar la clave, que los pide tres
            veces seguidas. Los pasos de solo correo o solo código no la piden. */}
        {modo !== "codigo" && modo !== "olvide" && (
          <View>
            <Eyebrow color={C.ink}>
              {modo === "registro" ? "Elige tu clave: cuatro números"
                : modo === "restablecer" ? "Elige tu clave nueva: cuatro números"
                : "Escribe tu clave"}
            </Eyebrow>
            <View style={s.mt8}>
              <PinBoxes value={pin} />
            </View>
          </View>
        )}

        {aviso !== "" && error === "" && (
          <View style={[s.errorBox, subtle(C.note)]}>
            <Text style={s.error}>{aviso}</Text>
          </View>
        )}
        {error !== "" && (
          <View style={[s.errorBox, subtle(C.danger)]}>
            <Text style={s.error}>{error}</Text>
          </View>
        )}

        {modo === "codigo" || modo === "olvide" ? (
          <PrimaryButton
            label={modo === "codigo" ? "Activar mi cuenta" : "Enviarme un código"}
            onPress={submit} disabled={!canSubmit} loading={submitting}
          />
        ) : (
          <PinPad
            onDigit={press} onBackspace={backspace} onSubmit={submit}
            canSubmit={canSubmit} busy={submitting}
            submitLabel={
              modo === "registro" ? "Crear cuenta"
                : modo === "restablecer" ? "Cambiar clave"
                : "Entrar"
            }
          />
        )}

        {/* Las otras puertas. Desde el ingreso: crear la cuenta o recuperar la
            clave. Desde cualquier otro paso: volver a entrar. */}
        {modo === "entrar" ? (
          <>
            <Pressable
              onPress={() => cambiarModo("registro")}
              style={s.alternar} accessibilityRole="button"
              accessibilityLabel="Crear una cuenta nueva"
            >
              <Text style={s.alternarTexto}>¿Es tu primera vez?</Text>
              <Text style={labelType(12, C.ink)}>Crear cuenta</Text>
            </Pressable>
            <Pressable
              onPress={empezarRecuperacion}
              style={s.alternar} accessibilityRole="button"
              accessibilityLabel="Recuperar la clave olvidada"
            >
              <Text style={s.alternarTexto}>¿Olvidaste tu clave?</Text>
              <Text style={labelType(12, C.ink)}>Recuperarla</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            onPress={() => cambiarModo("entrar")}
            style={s.alternar} accessibilityRole="button"
            accessibilityLabel="Volver a entrar con mi clave"
          >
            <Text style={s.alternarTexto}>
              {modo === "registro" ? "¿Ya tienes cuenta?" : "¿Te acordaste?"}
            </Text>
            <Text style={labelType(12, C.ink)}>Entrar</Text>
          </Pressable>
        )}

        {/* Ajustes del servidor: discretos pero alcanzables */}
        <Pressable
          onPress={onOpenSettings} style={s.server}
          accessibilityRole="button" accessibilityLabel="Cambiar la dirección del servidor"
        >
          <Icon name="gear" size={17} color={C.muted} />
          <Text style={[s.serverText, tabular]} numberOfLines={1}>
            {buscando
              ? "Buscando el servidor en la red…"
              : `Servidor ${apiUrl.replace(/^https?:\/\//, "")}`}
          </Text>
          <Text style={labelType(12, C.ink)}>Cambiar</Text>
        </Pressable>

        {/* Alcanzable **sin cuenta**: es lo que mira el docente para saber qué
            repartir, antes de que ningún niño tenga el teléfono en la mano. */}
        <Pressable
          onPress={onOpenMaterials} style={s.materiales}
          accessibilityRole="button" accessibilityLabel="Ver qué materiales hacen falta"
        >
          <Icon name="kit" size={17} color={C.ink} />
          <Text style={[s.materialesTexto, s.flexText]}>Qué necesito para empezar</Text>
          <Text style={labelType(12, C.ink)}>Ver</Text>
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
  // Seis cifras espaciadas: se leen y se comparan con el correo de un vistazo.
  codigoInput:{ fontSize: 26, letterSpacing: 8, textAlign: "center" },

  who:       { flexDirection: "row", alignItems: "center",
               paddingLeft: 12, paddingRight: 4, paddingVertical: 10 },
  initial:   { width: 46, height: 46, alignItems: "center", justifyContent: "center" },
  whoText:   { flex: 1, paddingLeft: 14 },
  whoName:   { fontFamily: F.bold, fontSize: 16, color: C.ink },
  whoMail:   { fontFamily: F.regular, fontSize: 12, color: C.muted },
  change:    { justifyContent: "center", paddingHorizontal: 14, minHeight: TAP.min },

  errorBox:  { marginTop: 12, paddingVertical: 10, paddingHorizontal: 14 },
  error:     { fontFamily: F.bold, fontSize: 14, color: C.ink, textAlign: "center" },

  // Mismo trazo que las filas de abajo (servidor, materiales): una pregunta a
  // la izquierda y la acción a la derecha, sin placa, para no competir con el
  // teclado que tiene encima.
  alternar:      { flexDirection: "row", alignItems: "center", gap: S.sm,
                   justifyContent: "center", paddingVertical: 4, minHeight: TAP.min },
  alternarTexto: { fontFamily: F.regular, fontSize: 13, color: C.ink },

  server:    { marginTop: "auto", flexDirection: "row", alignItems: "center", gap: S.sm,
               paddingTop: 16, paddingBottom: 8, minHeight: TAP.min },
  serverText:{ flex: 1, fontFamily: F.regular, fontSize: 12, color: C.muted },

  materiales:     { flexDirection: "row", alignItems: "center", gap: S.sm,
                    paddingTop: 4, paddingBottom: 12, minHeight: TAP.min },
  materialesTexto:{ fontFamily: F.regular, fontSize: 12, color: C.ink },
  flexText:       { flex: 1 },
});
