import { useEffect, useState } from "react";
import { BackHandler, StatusBar, StyleSheet, ActivityIndicator, View } from "react-native";
import { useFonts } from "expo-font";
// Se importa cada peso por su subruta y no desde la raíz del paquete: Metro no
// hace tree-shaking, así que importar `@expo-google-fonts/archivo` metería en
// el APK los 18 pesos de la familia (2,4 MB) en vez de los cinco que se usan.
import { Archivo_400Regular }  from "@expo-google-fonts/archivo/400Regular";
import { Archivo_500Medium }   from "@expo-google-fonts/archivo/500Medium";
import { Archivo_600SemiBold } from "@expo-google-fonts/archivo/600SemiBold";
import { Archivo_700Bold }     from "@expo-google-fonts/archivo/700Bold";
import { ArchivoBlack_400Regular } from "@expo-google-fonts/archivo-black/400Regular";
import LoginScreen from "./src/screens/LoginScreen";
import CatalogueScreen from "./src/screens/CatalogueScreen";
import GameScreen from "./src/screens/GameScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import PinScreen from "./src/screens/PinScreen";
import HistoryScreen from "./src/screens/HistoryScreen";
import ErrorBoundary from "./src/components/ErrorBoundary";
import { loadApiUrl } from "./src/api/config";
import { logout as apiLogout } from "./src/api/client";
import { alExpirarLaSesion, restaurarSesion } from "./src/api/session";
import type { Figure, User } from "./src/api/types";
import { C } from "./src/theme";

/**
 * App móvil de Tangram IA (versión estudiante).
 *
 * Se conecta al mismo backend Node.js que la versión web: el catálogo de
 * figuras y sus siluetas objetivo vienen de MySQL, y las fotos las valida el
 * servidor, que a su vez las pasa al servicio de visión: YOLOv8s-seg detecta
 * las 7 fichas y el validador geométrico revisa el armado (inventario, fichas
 * montadas, huecos, sueltas y forma).
 *
 * El diseño es neobrutalista: fondo de papel cálido, color plano con
 * significado, y cada elemento como una placa con filete negro y sombra sólida
 * sin difuminar (ver src/theme y src/components/ui).
 *
 * La raíz es un `View` a pantalla completa, no un `View`: la barra de
 * estado de Android se dibuja translúcida encima y cada pantalla reserva su
 * propia zona segura (`SAFE_TOP`). Así la cámara puede sangrar de borde a borde
 * y sus guías de encuadre se calculan sobre la ventana real.
 */
function Aplicacion() {
  const [ready,      setReady]      = useState(false);
  const [user,       setUser]       = useState<User | null>(null);
  const [activeFig,  setActiveFig]  = useState<Figure | null>(null);
  const [inSettings, setInSettings] = useState(false);
  const [inPin,      setInPin]      = useState(false);
  const [inHistory,  setInHistory]  = useState(false);
  /**
   * Vueltas al catálogo. Sube cada vez que se sale de una figura, y es lo único
   * que el catálogo necesita para volver a pedir sus datos: como ya no se
   * desmonta (ver el render), sin esta señal se quedaría mostrando las
   * estadísticas y los sellos de antes del intento.
   */
  const [vueltas,    setVueltas]    = useState(0);

  // Archivo Black para titulares y cifras, Archivo para el cuerpo. Si la carga
  // falla, `error` deja pasar igual: React Native cae a la fuente del sistema
  // en vez de dejar la app en blanco.
  const [fontsLoaded, fontError] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_600SemiBold,
    Archivo_700Bold,
    ArchivoBlack_400Regular,
  });

  // La dirección del servidor y la sesión del estudiante se guardan en el
  // teléfono, así que se leen antes de mostrar nada: si la sesión sigue viva no
  // hay que volver a pedir la clave.
  useEffect(() => {
    Promise.all([loadApiUrl(), restaurarSesion()])
      .then(([, guardado]) => {
        if (!guardado) return;
        // El mismo filtro que el ingreso: esta app es solo para estudiantes, y
        // al docente el servidor le rechaza los intentos con un 403. Aquí hace
        // falta además de allá porque una sesión de docente puede venir ya
        // guardada en el teléfono de antes.
        if (guardado.role === "student") setUser(guardado);
        else void apiLogout();
      })
      .finally(() => setReady(true));
  }, []);

  // Si el servidor rechaza el token (caducado, o el backend se reinició con
  // otro secreto), se vuelve al ingreso en vez de dejar pantallas que no cargan.
  // Se cierra **todo** lo que estuviera abierto encima: si la sesión caduca con
  // el historial a la vista, dejarlo marcado como abierto lo haría reaparecer
  // sobre el catálogo del siguiente que entre.
  useEffect(() => {
    alExpirarLaSesion(() => {
      setActiveFig(null);
      setInPin(false);
      setInHistory(false);
      setUser(null);
    });
  }, []);

  function handleLogout() {
    // Se avisa al servidor para que invalide también el token de refresco: sin
    // eso, salir solo borraría la copia del teléfono y el token seguiría
    // valiendo hasta caducar. Importa donde los teléfonos se comparten.
    void apiLogout();
    setActiveFig(null);
    setInPin(false);
    setInHistory(false);
    setUser(null);
  }

  /**
   * Vuelta al ingreso tras cambiar la clave. No se avisa al servidor: ya revocó
   * todas las sesiones al aceptar el cambio, y `changePassword` cerró la del
   * teléfono. Llamar a `/logout` ahora solo conseguiría un 401.
   */
  function claveCambiada() {
    setActiveFig(null);
    setInPin(false);
    setUser(null);
  }

  function salirDeLaFigura() {
    setActiveFig(null);
    setVueltas(v => v + 1);
  }

  /**
   * Botón atrás de Android.
   *
   * La navegación de esta app es por estado y no por pila, así que Android no
   * tiene ninguna pantalla a la que volver: sin manejarlo, el atrás desde
   * Ajustes o desde una figura **cierra la app** y se pierde el intento a medio
   * hacer. Aquí se mapea a la salida de la pantalla que esté encima; solo se
   * deja pasar en las dos raíces —el catálogo y el ingreso—, donde cerrar la
   * app sí es lo que el estudiante quiere decir.
   *
   * `GameScreen` y `PinScreen` registran el suyo por separado —para retroceder
   * de fase y para no volver al catálogo con la sesión ya revocada—: React
   * Native llama a las suscripciones en orden inverso al de registro, así que
   * la de la pantalla se atiende primero y esta solo actúa si aquella deja
   * pasar el gesto.
   */
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      // El atrás tiene que dejar donde deja el botón de volver de cada pantalla,
      // o el gesto y el botón contarían dos historias distintas: desde la clave
      // se vuelve a Ajustes, que es de donde se entró.
      if (inPin)      { setInPin(false); setInSettings(true); return true; }
      if (inHistory)  { setInHistory(false);  return true; }
      if (inSettings) { setInSettings(false); return true; }
      if (activeFig)  { salirDeLaFigura();    return true; }
      return false;
    });
    return () => sub.remove();
  }, [inPin, inHistory, inSettings, activeFig]);

  const booting = !ready || (!fontsLoaded && !fontError);
  /** Hay algo abierto encima del catálogo. */
  const tapado = inSettings || inPin || inHistory || activeFig !== null;

  return (
    <View style={s.root}>
      {/* `backgroundColor` era un no-op: con `targetSdk 36` Android fuerza el
          edge-to-edge y pinta su barra transparente encima del layout —que es
          justo para lo que cada pantalla reserva `SAFE_TOP`—. Lo que sí sigue
          aplicando es el color de los iconos, y por eso queda `barStyle`. */}
      <StatusBar barStyle="dark-content" />
      {booting ? (
        <View style={s.center}><ActivityIndicator size="large" color={C.ink} /></View>
      ) : !user ? (
        inSettings
          ? <SettingsScreen onClose={() => setInSettings(false)} />
          : <LoginScreen onLogin={setUser} onOpenSettings={() => setInSettings(true)} />
      ) : (
        <>
          {/* El catálogo se queda montado debajo de lo que se abra encima, y no
              se desmonta al entrar en una figura. Desmontándolo, volver
              devolvía el filtro a «Todas», el scroll al principio y repetía las
              tres peticiones. Se oculta con `display: "none"`, que además lo
              saca del recorrido táctil y del lector de pantalla. */}
          <View style={[s.fill, tapado && s.oculto]}>
            <CatalogueScreen
              user={user}
              recarga={vueltas}
              onSelect={setActiveFig}
              onOpenHistory={() => setInHistory(true)}
              onOpenSettings={() => setInSettings(true)}
              onLogout={handleLogout}
            />
          </View>
          {activeFig && (
            <View style={s.encima}>
              <GameScreen user={user} figure={activeFig} onExit={salirDeLaFigura} />
            </View>
          )}
          {inSettings && (
            <View style={s.encima}>
              {/* La opción de cambiar la clave solo aparece con la sesión
                  abierta: la misma pantalla se usa desde el ingreso, y allá no
                  hay ninguna cuenta a la que cambiársela. */}
              <SettingsScreen
                onClose={() => setInSettings(false)}
                onChangePin={() => { setInSettings(false); setInPin(true); }}
              />
            </View>
          )}
          {inHistory && (
            <View style={s.encima}>
              <HistoryScreen user={user} onClose={() => setInHistory(false)} />
            </View>
          )}
          {inPin && (
            <View style={s.encima}>
              {/* Volver deja donde se estaba, que es Ajustes: es de allí de
                  donde se entra a cambiar la clave. */}
              <PinScreen
                onClose={() => { setInPin(false); setInSettings(true); }}
                onDone={claveCambiada}
              />
            </View>
          )}
        </>
      )}
    </View>
  );
}

/**
 * La aplicación va envuelta desde fuera, y no desde dentro, a propósito: un
 * `ErrorBoundary` solo recoge los errores de sus **hijos**, así que puesto
 * dentro de `Aplicacion` no serviría para el fallo que más importa —el de la
 * propia raíz, el que deja la pantalla en blanco sin nada que tocar—.
 */
export default function App() {
  return (
    <ErrorBoundary>
      <Aplicacion />
    </ErrorBoundary>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  fill:   { flex: 1 },
  oculto: { display: "none" },
  // Lo que se abre encima tapa la pantalla entera y es opaco: el catálogo sigue
  // vivo detrás, pero ni se ve ni se toca.
  //
  // Las cuatro propiedades van escritas y no `...StyleSheet.absoluteFillObject`:
  // esa constante **desapareció en React Native 0.86**, y como se usaba dentro de
  // un spread el fallo no daba ningún error en tiempo de ejecución —`{...undefined}`
  // es un objeto vacío—. La capa se quedaba sin posición ni altura, así que abrir
  // una figura o los ajustes dejaba la pantalla en crema, con el catálogo ya
  // escondido detrás. La que sí sigue existiendo es `StyleSheet.absoluteFill`, y
  // se usa en GameScreen, pero como estilo dentro de un array, no esparcida.
  encima: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: C.base },
});
