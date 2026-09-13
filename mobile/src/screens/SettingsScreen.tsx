import { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from "react-native";
import {
  atajosDeRed, getApiUrl, setApiUrl, normalizeUrl, nombreDeHost, DEFAULT_API_URL,
} from "../api/config";
import type { RedConocida } from "../api/config";
import { buscarServidor, testConnection } from "../api/client";
import type { HealthStatus } from "../api/client";
import Icon from "../components/Icon";
import { Card, Eyebrow, IconButton, Note, PrimaryButton, SecondaryButton } from "../components/ui";
import { C, S, F, TAP, SAFE_TOP, SAFE_BOTTOM, shout, inset, flat } from "../theme";

/**
 * Permite cambiar la dirección del servidor sin recompilar la app.
 * Es necesario porque la IP de la PC cambia según la red (casa, universidad,
 * hotspot del celular).
 *
 * Escribir la IP a mano es el último recurso, no el camino normal. Encima del
 * campo están los **atajos de red**: las direcciones horneadas en el APK y las
 * que ya se usaron alguna vez, a un toque cada una. Y debajo, la búsqueda
 * automática, que sondea todas y se queda con la que conteste —lo mismo que
 * hace la app al arrancar, aquí a mano por si se cambió de red con la app ya
 * abierta—.
 */
export default function SettingsScreen({ onClose, onChangePin, onVerRecorrido }: {
  onClose: () => void;
  /**
   * Solo llega con la sesión abierta. Esta misma pantalla se abre desde el
   * ingreso —es donde se corrige la dirección cuando ni siquiera se puede
   * entrar—, y allá no hay ninguna cuenta a la que cambiarle la clave.
   */
  onChangePin?: () => void;
  /**
   * Repetir el recorrido de bienvenida. Como `onChangePin`, solo llega con la
   * sesión abierta: desde el ingreso no hay ninguna app que recorrer todavía.
   *
   * Que se pueda repetir no es un extra. El recorrido se ve una vez, el primer
   * día, que es justo el día en que el niño está pendiente de otras cosas; sin
   * una forma de volver a verlo, lo que se explicó ahí se pierde para siempre.
   */
  onVerRecorrido?: () => void;
}) {
  const [url,     setUrl]     = useState(getApiUrl());
  const [testing, setTesting] = useState(false);
  const [health,  setHealth]  = useState<HealthStatus | null>(null);
  const [error,   setError]   = useState("");
  const [saved,   setSaved]   = useState(false);
  const [buscando, setBuscando] = useState(false);
  /**
   * Los atajos son estado y no una lectura suelta: guardar una dirección nueva
   * la añade al historial, y entonces tiene que aparecer aquí sin salir de la
   * pantalla.
   */
  const [atajos,  setAtajos]  = useState<RedConocida[]>(() => atajosDeRed());

  /** Cualquier edición invalida el resultado que hubiera en pantalla. */
  function edit(next: string) {
    setUrl(next);
    setHealth(null); setError(""); setSaved(false);
  }

  /**
   * Un toque en un atajo: la guarda y la prueba de una vez.
   *
   * Guardar antes de probar es a propósito. Es el gesto de «me acabo de mudar
   * de red»: si el backend todavía no está encendido, la prueba fallará, pero
   * la dirección ya queda puesta y solo hay que volver a probar.
   */
  async function aplicar(destino: string) {
    if (testing || buscando) return;
    const clean = await setApiUrl(destino);
    setUrl(clean); setError(""); setHealth(null); setSaved(true);
    setAtajos(atajosDeRed());
    setTesting(true);
    try {
      setHealth(await testConnection(clean));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setTesting(false);
    }
  }

  /** Sondea todas las direcciones conocidas y adopta la que conteste. */
  async function handleBuscar() {
    if (testing || buscando) return;
    setError(""); setHealth(null); setSaved(false); setBuscando(true);
    try {
      const hallado = await buscarServidor();
      if (!hallado) {
        setError(
          "Ninguna de las direcciones conocidas contestó. Comprueba que el " +
          "backend esté corriendo y que estés en el mismo wifi que la PC; si " +
          "la IP es nueva, escríbela abajo."
        );
        return;
      }
      setUrl(hallado.url);
      setHealth(hallado.health);
      setSaved(true);
      setAtajos(atajosDeRed());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setBuscando(false);
    }
  }

  async function handleTest() {
    if (testing) return;
    const clean = normalizeUrl(url);
    if (clean === "") {
      setError("Escribe la dirección del servidor.");
      return;
    }
    setError(""); setHealth(null); setSaved(false); setTesting(true);
    setUrl(clean);
    try {
      setHealth(await testConnection(clean));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    // Guardar una dirección vacía deja a la app haciendo peticiones a rutas
    // relativas, que fallan sin decir por qué.
    if (normalizeUrl(url) === "") {
      setError("Escribe la dirección del servidor.");
      return;
    }
    const clean = await setApiUrl(url);
    setUrl(clean);
    setAtajos(atajosDeRed());
    setError("");
    setSaved(true);
  }

  // El validador es geometría y no tiene pesos que cargar, así que dentro del
  // servicio de visión SIEMPRE está listo. Que llegue en `false` no significa
  // «al validador le falta algo»: significa que el servicio de visión entero no
  // contestó y el backend rellenó el hueco con su valor por defecto.
  //
  // La diferencia importa porque los dos casos se arreglan distinto y solo uno
  // deja usar la app:
  //
  //   validador en false  -> nadie escucha en el 8001. No habrá análisis: el
  //                          backend devuelve 503 y el niño ve un error.
  //   validador listo y detector en false -> el servicio corre pero sin pesos.
  //                          Sí responde, con cifras simuladas.
  const detector = health?.yolo_loaded ?? false;
  const visionCaida = health != null && !health.validator_ready;
  const modoDemo = health != null && health.validator_ready && !detector;

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.header}>
          <IconButton name="back" onPress={onClose} label="Volver" />
          <Text style={shout(26)}>Servidor</Text>
        </View>

        <Text style={s.help}>
          La app busca el servidor sola cada vez que arranca. Si cambiaste de red
          con la app abierta, toca la red de abajo o búscalo otra vez.
        </Text>

        {atajos.length > 0 && (
          <>
            <Eyebrow color={C.ink} style={s.label}>Mis redes</Eyebrow>
            {/* Cada red es una placa que se toca: guarda la dirección y la
                prueba de una vez. La que está en uso va en color, que es lo
                único que hace falta para saber dónde se está. */}
            <View style={s.chips}>
              {atajos.map(red => {
                const activa = red.url === normalizeUrl(url);
                return (
                  <TouchableOpacity
                    key={red.url} onPress={() => void aplicar(red.url)}
                    style={[s.chip, flat(activa ? C.accent : C.card, 2)]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: activa }}
                    accessibilityLabel={`Usar ${red.etiqueta}: ${nombreDeHost(red.url)}`}
                  >
                    <Text style={s.chipTitle}>{red.etiqueta}</Text>
                    <Text style={s.chipUrl}>{nombreDeHost(red.url)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        <View style={s.gap}>
          <SecondaryButton
            label={buscando ? "Buscando…" : "Buscar el servidor en la red"}
            icon="signal" onPress={handleBuscar}
          />
        </View>

        <Eyebrow color={C.ink} style={s.label}>Escribirla a mano</Eyebrow>
        <Text style={s.help}>
          Solo si la IP es nueva. En Windows la obtienes con{" "}
          <Text style={s.code}>ipconfig</Text>, en la Dirección IPv4 del wifi.
          Al guardarla queda en «Mis redes» y la app la volverá a probar sola.
        </Text>
        {/* El campo es un hueco: fondo más oscuro que el de alrededor y su
            filete. Un hueco no proyecta sombra, y eso es lo que lo distingue
            de un botón, que sí la tiene. */}
        <View style={[s.inputBox, inset(4)]}>
          <TextInput
            style={s.input} value={url} onChangeText={edit}
            autoCapitalize="none" autoCorrect={false} keyboardType="url"
            placeholder="http://192.168.1.105:8000" placeholderTextColor={C.ghost}
            accessibilityLabel="Dirección del servidor"
          />
        </View>

        <View style={s.gap}>
          <SecondaryButton
            label={testing ? "Probando…" : "Probar conexión"}
            icon="signal" onPress={handleTest}
          />
        </View>
        {(testing || buscando) && <ActivityIndicator color={C.ink} style={s.spin} />}

        {/* El estado va en color, con el icono y la palabra al lado: tres
            canales para lo mismo, de modo que ninguno sea imprescindible. */}
        {error !== "" && (
          <Card style={s.gap} tone="danger" depth={5} contentStyle={s.state}>
            <View style={s.stateHead}>
              <View style={[s.stateMark, flat(C.card, 2)]}>
                <Icon name="bang" size={18} color={C.ink} strokeWidth={3.2} />
              </View>
              <Text style={shout(17)}>Sin conexión</Text>
            </View>
            <View style={s.stateBody}>
              <Text style={s.stateText}>{error}</Text>
            </View>
          </Card>
        )}

        {health && (
          // Verde solo cuando la app se puede usar de verdad. Que el backend
          // conteste no basta: sin el servicio de visión, la foto no se analiza
          // y un visto verde estaría prometiendo algo que va a fallar.
          <Card style={s.gap} tone={visionCaida ? "warning" : "success"}
                depth={5} contentStyle={s.state}>
            <View style={s.stateHead}>
              <View style={[s.stateMark, flat(C.card, 2)]}>
                <Icon name={visionCaida ? "bang" : "check"} size={18}
                      color={C.ink} strokeWidth={3.2} />
              </View>
              <Text style={shout(17)}>
                {visionCaida ? "Falta el análisis" : "Conectado"}
              </Text>
            </View>
            <View style={s.stateBody}>
              <StateRow ok={health.db_connected} label="Base de datos MySQL"
                        value={health.db_connected ? "Lista" : "Sin conexión"} />
              {/* Con el servicio de visión caído, las dos filas de análisis no
                  informan de dos averías distintas: son la misma. Se dicen
                  juntas y una sola vez, para no mandar a revisar los pesos del
                  detector a quien lo que tiene es el 8001 apagado. */}
              {visionCaida ? (
                <StateRow ok={false} label="Servicio de análisis (Python)"
                          value="No responde" />
              ) : (
                <>
                  <StateRow ok={health.yolo_loaded} label="YOLOv8s-seg · detecta las fichas"
                            value={health.yolo_loaded ? "Cargado" : "Demostración"} />
                  <StateRow ok={health.validator_ready} label="Validador · revisa el armado"
                            value="Listo" />
                </>
              )}
              {typeof health.match_threshold === "number" && (
                <StateRow ok label="Acierto mínimo para aprobar"
                          value={`${Math.round(health.match_threshold * 100)}%`} />
              )}
              {visionCaida && (
                <Text style={s.stateHint}>
                  El backend responde, pero el servicio que analiza las fotos no
                  está encendido: al tomar una foto saldrá un error. Arráncalo en
                  el computador con .\dev.ps1 y vuelve a probar.
                </Text>
              )}
              {modoDemo && (
                <Text style={s.stateHint}>
                  Sin el detector de fichas el servidor responde en modo
                  demostración: los resultados son simulados.
                </Text>
              )}
            </View>
          </Card>
        )}

        <View style={s.gap}>
          <PrimaryButton label="Guardar dirección" onPress={handleSave} tone="success" />
        </View>
        {saved && (
          <Text style={s.saved}>Guardado. Ya puedes volver y entrar.</Text>
        )}

        <View style={s.gap}>
          <Note title="Si no conecta">
            Arranca el backend con <Text style={s.code}>--host 0.0.0.0</Text>{"\n"}
            El teléfono y el PC en el mismo wifi{"\n"}
            Permite el acceso en el firewall de Windows{"\n"}
            Si la red de la universidad lo bloquea, usa el hotspot del celular
          </Note>
        </View>

        <TouchableOpacity
          onPress={() => edit(DEFAULT_API_URL)} style={s.reset}
          accessibilityRole="button"
        >
          <Text style={s.resetText}>Restaurar dirección por defecto</Text>
        </TouchableOpacity>

        {/* Todo lo de arriba es del servidor; esto es de la cuenta. Va aparte y
            al final porque son dos asuntos distintos que solo comparten el ser
            «ajustes», y porque la dirección se toca a diario y la clave no. */}
        {(onChangePin || onVerRecorrido) && (
          <View style={s.cuenta}>
            <Eyebrow color={C.ink} style={s.label}>Mi cuenta</Eyebrow>
            {onChangePin && (
              <SecondaryButton label="Cambiar mi clave" icon="gear" onPress={onChangePin} />
            )}
            {onVerRecorrido && (
              <View style={s.cuentaExtra}>
                <SecondaryButton
                  label="Ver el recorrido otra vez" icon="layers"
                  onPress={onVerRecorrido}
                />
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * Una comprobación del servidor. El punto va verde o rojo, y el valor escrito
 * («Lista», «Sin conexión») dice lo mismo con palabras justo al lado, así que
 * el color no es el único canal.
 *
 * El punto va sin sombra: son cinco filas seguidas, y cinco sombras en una
 * lista tan corta se leen como ruido.
 */
function StateRow({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <View style={s.row}>
      <View style={[s.dot, flat(ok ? C.success : C.danger, 2)]} />
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  flex:      { flex: 1, backgroundColor: C.base },
  content:   { paddingHorizontal: S.lg + 4, paddingTop: SAFE_TOP, paddingBottom: SAFE_BOTTOM + 20 },
  gap:       { marginTop: S.xl },

  header:    { flexDirection: "row", alignItems: "center", gap: S.md, marginBottom: S.lg },
  help:      { fontFamily: F.regular, fontSize: 14, lineHeight: 21, color: C.muted },
  label:     { marginTop: S.xl, marginBottom: 9 },

  chips:     { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  chip:      { paddingVertical: 10, paddingHorizontal: 14, minHeight: TAP.min,
               justifyContent: "center" },
  chipTitle: { fontFamily: F.bold, fontSize: 14, color: C.ink },
  chipUrl:   { fontFamily: F.mono, fontSize: 11, color: C.ink, marginTop: 2 },

  inputBox:  { height: 58, justifyContent: "center", paddingHorizontal: 16 },
  input:     { fontFamily: F.mono, fontSize: 16, color: C.ink, padding: 0 },

  spin:      { marginTop: S.md },

  // Sin filete que separe la cabecera del cuerpo: los separa el espacio.
  state:     { padding: 16 },
  stateHead: { flexDirection: "row", alignItems: "center", gap: 12,
               paddingBottom: 14 },
  stateMark: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  stateBody: { gap: 13 },
  stateText: { fontFamily: F.regular, fontSize: 14, lineHeight: 20, color: C.ink },
  stateHint: { fontFamily: F.regular, fontSize: 13, lineHeight: 19, color: C.ink,
               paddingTop: 12 },

  row:       { flexDirection: "row", alignItems: "center", gap: 12 },
  dot:       { width: 14, height: 14 },
  rowLabel:  { flex: 1, fontFamily: F.regular, fontSize: 14, color: C.ink },
  rowValue:  { fontFamily: F.bold, fontSize: 13, color: C.ink },

  saved:     { fontFamily: F.bold, fontSize: 14, color: C.ink,
               textAlign: "center", marginTop: 12 },

  cuenta:    { marginTop: S.xxl },
  cuentaExtra:{ marginTop: S.md },

  reset:     { height: TAP.control, alignItems: "center", justifyContent: "center",
               marginTop: S.lg },
  resetText: { fontFamily: F.bold, fontSize: 13, color: C.muted,
               textDecorationLine: "underline" },

  code:      { fontFamily: F.mono, color: C.ink },
});
