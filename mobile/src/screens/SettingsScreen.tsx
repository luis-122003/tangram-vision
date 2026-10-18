import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { testConnection } from "../api/client";
import type { HealthStatus } from "../api/client";
import Icon from "../components/Icon";
import { Card, Eyebrow, IconButton, SecondaryButton } from "../components/ui";
import { C, S, F, SAFE_TOP, SAFE_BOTTOM, shout, flat } from "../theme";

/**
 * Ajustes de la cuenta y estado del servidor.
 *
 * La dirección del servidor va fija en el APK (ver ../api/config.ts), así que
 * aquí no se puede cambiar: solo se comprueba si la app puede trabajar.
 */
export default function SettingsScreen({ onClose, onChangePin, onVerRecorrido }: {
  onClose: () => void;
  /**
   * Cambiar la clave de la cuenta abierta.
   */
  onChangePin?: () => void;
  /**
   * Repetir el recorrido de bienvenida.
   *
   * Que se pueda repetir no es un extra. El recorrido se ve una vez, el primer
   * día, que es justo el día en que el niño está pendiente de otras cosas; sin
   * una forma de volver a verlo, lo que se explicó ahí se pierde para siempre.
   */
  onVerRecorrido?: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [health,  setHealth]  = useState<HealthStatus | null>(null);
  const [error,   setError]   = useState("");

  async function handleTest() {
    if (testing) return;
    setError(""); setHealth(null); setTesting(true);
    try {
      setHealth(await testConnection());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setTesting(false);
    }
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
    <View style={s.flex}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.header}>
          <IconButton name="back" onPress={onClose} label="Volver" />
          <Text style={shout(26)}>Ajustes</Text>
        </View>

        <Eyebrow color={C.ink} style={s.label}>Conexión</Eyebrow>
        <Text style={s.help}>
          Si algo no carga, comprueba aquí si la app llega al servidor.
        </Text>
        <View style={s.gap}>
          <SecondaryButton
            label={testing ? "Comprobando…" : "Comprobar conexión"}
            icon="signal" onPress={handleTest}
          />
        </View>
        {testing && <ActivityIndicator color={C.ink} style={s.spin} />}

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
                  El servidor responde, pero el servicio que analiza las fotos no
                  está encendido: al tomar una foto saldrá un error. Avísale al
                  docente.
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

        {/* Lo de arriba es del servidor; esto es de la cuenta. */}
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
    </View>
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

  cuenta:    { marginTop: S.xxl },
  cuentaExtra:{ marginTop: S.md },

});
