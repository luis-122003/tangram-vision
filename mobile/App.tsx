import { useEffect, useState } from "react";
import { BackHandler, StatusBar, StyleSheet, ActivityIndicator, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
import MaterialsScreen from "./src/screens/MaterialsScreen";
import TourScreen from "./src/screens/TourScreen";
import ErrorBoundary from "./src/components/ErrorBoundary";
import { loadApiUrl } from "./src/api/config";
import { buscarServidor, logout as apiLogout } from "./src/api/client";
import { alExpirarLaSesion, restaurarSesion } from "./src/api/session";
import { siguienteFigura } from "./src/api/orden";
import type { Figure, User } from "./src/api/types";

/**
 * Marca de que este estudiante ya vio el recorrido de bienvenida.
 *
 * La clave lleva el id del estudiante y no es una sola para el teléfono: en un
 * aula los aparatos se comparten, y una marca global haría que el segundo niño
 * que entra no llegue a ver nunca la explicación porque el primero ya la pasó.
 */
const TOUR_VISTO = (userId: number) => `tangram.tour.v1.${userId}`;
import { C, F } from "./src/theme";

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
   * Los materiales se abren desde tres sitios —el ingreso, el catálogo y la
   * figura— y encima de cualquiera de ellos, así que viven en un estado
   * propio y se dibujan los últimos. El botón atrás lo atiende la propia
   * pantalla, que al montarse después queda por delante de los demás.
   */
  const [inMaterials, setInMaterials] = useState(false);
  /**
   * El recorrido de bienvenida está abierto. Se decide al entrar (una vez por
   * estudiante) y también se puede abrir a mano desde Ajustes.
   */
  const [inTour, setInTour] = useState(false);
  /**
   * El recorrido se abrió desde Ajustes, así que al cerrarlo hay que volver
   * allí. Sin esto, repetir el recorrido dejaba al estudiante en el catálogo:
   * el mismo menú, dos entradas, y cada una devolviendo a un sitio distinto.
   */
  const [tourDesdeAjustes, setTourDesdeAjustes] = useState(false);
  /**
   * La clave con la que el estudiante acaba de entrar.
   *
   * Solo se guarda en memoria, y solo mientras haga falta: es lo que permite
   * saltarse el primer paso del cambio obligatorio cuando la cuenta viene con
   * la clave temporal del docente. Se borra en cuanto el cambio termina o se
   * cierra la sesión; no toca el almacenamiento del teléfono en ningún momento.
   */
  const [claveDeIngreso, setClaveDeIngreso] = useState<string | null>(null);
  /**
   * El catálogo tal como lo cargó la pantalla del catálogo.
   *
   * Vive aquí porque lo necesitan dos sitios: aquella pantalla, que lo pinta, y
   * el encadenado de figuras, que tiene que saber cuál viene después de la que
   * se está jugando. Pedirlo dos veces al servidor para eso sería descargar el
   * catálogo entero cada vez que un niño termina una figura.
   */
  const [figuras, setFiguras] = useState<Figure[]>([]);
  /**
   * La app está sondeando la red para encontrar el backend. Se dice en el
   * arranque porque es la única espera del inicio que puede durar unos
   * segundos, y un spinner mudo tanto tiempo se lee como app colgada.
   */
  const [buscando,   setBuscando]   = useState(false);
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
  //
  // Con la dirección ya cargada se busca el servidor antes de dibujar nada:
  // `buscarServidor` prueba la guardada y, si no contesta, sondea las demás
  // direcciones conocidas y adopta la que responda. Es lo que hace que llegar
  // al aula no pida tocar la IP en Ajustes. La espera va aquí, en el arranque,
  // y no en segundo plano a propósito: entrando con la dirección equivocada, el
  // catálogo de una sesión ya guardada dispararía sus tres peticiones contra el
  // vacío y el niño vería errores antes de que la búsqueda terminara.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const [, guardado] = await Promise.all([loadApiUrl(), restaurarSesion()]);
      if (vivo) setBuscando(true);
      await buscarServidor().catch(() => null);
      if (vivo) setBuscando(false);
      if (!guardado) return;
      // El mismo filtro que el ingreso: esta app es solo para estudiantes, y
      // al docente el servidor le rechaza los intentos con un 403. Aquí hace
      // falta además de allá porque una sesión de docente puede venir ya
      // guardada en el teléfono de antes.
      if (guardado.role === "student") setUser(guardado);
      else void apiLogout();
    })()
      .finally(() => { if (vivo) setReady(true); });
    return () => { vivo = false; };
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
      // El recorrido también: no se dibuja sin sesión, así que quedaría abierto
      // e invisible hasta el siguiente ingreso, y el siguiente en entrar —en un
      // teléfono compartido, otro niño— se lo comería entero aunque ya lo
      // hubiera visto. Lo mismo la clave con la que se entró: no tiene por qué
      // seguir en memoria cuando ya no hay sesión.
      setInTour(false);
      setTourDesdeAjustes(false);
      setClaveDeIngreso(null);
      setUser(null);
    });
  }, []);

  /**
   * ¿Le toca el recorrido a este estudiante?
   *
   * Se mira **después** de descartar el cambio de clave obligatorio: con la
   * clave temporal todavía puesta el recorrido llegaría antes que la pantalla
   * que de verdad hay que atender, y encima explicaría una app que el servidor
   * aún no deja usar.
   *
   * Un fallo de lectura se trata como «ya lo vio»: quedarse sin almacenamiento
   * no puede significar que el recorrido salga en cada ingreso.
   */
  useEffect(() => {
    if (!user || user.must_change_password) return;
    let vivo = true;
    AsyncStorage.getItem(TOUR_VISTO(user.id))
      .then(visto => { if (vivo && !visto) setInTour(true); })
      .catch(() => { /* sin almacenamiento no se insiste */ });
    return () => { vivo = false; };
  }, [user]);

  /** Terminado o saltado: en los dos casos no se vuelve a mostrar solo. */
  function cerrarRecorrido() {
    setInTour(false);
    if (tourDesdeAjustes) {
      setTourDesdeAjustes(false);
      setInSettings(true);
    }
    if (user) {
      void AsyncStorage.setItem(TOUR_VISTO(user.id), "1")
        .catch(() => { /* volverá a salir la próxima vez, y no pasa nada */ });
    }
  }

  function handleLogin(u: User, clave: string) {
    setClaveDeIngreso(clave);
    setUser(u);
  }

  function handleLogout() {
    // Se avisa al servidor para que invalide también el token de refresco: sin
    // eso, salir solo borraría la copia del teléfono y el token seguiría
    // valiendo hasta caducar. Importa donde los teléfonos se comparten.
    void apiLogout();
    setActiveFig(null);
    setInPin(false);
    setInHistory(false);
    setInTour(false);
    setTourDesdeAjustes(false);
    setClaveDeIngreso(null);
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
    setInTour(false);
    // La clave de ingreso ya no sirve para nada y no tiene por qué seguir en
    // memoria: la cuenta tiene otra desde hace un segundo.
    setClaveDeIngreso(null);
    setUser(null);
  }

  function salirDeLaFigura() {
    setActiveFig(null);
    setVueltas(v => v + 1);
  }

  /**
   * Pasar a la figura siguiente sin volver al catálogo.
   *
   * Es lo que hace el botón del final de un intento logrado. Antes ese botón
   * devolvía a la rejilla, y el niño tenía que acordarse de cuál acababa de
   * hacer para buscar la de al lado —con el agravante de que «la de al lado» en
   * una rejilla filtrable no es la siguiente de nada—. El orden de progresión
   * lo decide `siguienteFigura` (por dificultad, y dentro de cada nivel por
   * catálogo), no la posición en pantalla.
   *
   * `vueltas` sube igual que al salir: el catálogo sigue montado detrás y tiene
   * que enterarse del intento que se acaba de registrar, aunque ahora mismo no
   * se vea.
   */
  function irALaSiguiente(fig: Figure) {
    setActiveFig(fig);
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
  const tapado = inSettings || inPin || inHistory || inMaterials || inTour || activeFig !== null;

  return (
    <View style={s.root}>
      {/* `backgroundColor` era un no-op: con `targetSdk 36` Android fuerza el
          edge-to-edge y pinta su barra transparente encima del layout —que es
          justo para lo que cada pantalla reserva `SAFE_TOP`—. Lo que sí sigue
          aplicando es el color de los iconos, y por eso queda `barStyle`. */}
      <StatusBar barStyle="dark-content" />
      {booting ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={C.ink} />
          {buscando && <Text style={s.buscando}>Buscando el servidor…</Text>}
        </View>
      ) : !user ? (
        inMaterials
          ? <MaterialsScreen onClose={() => setInMaterials(false)} />
          : inSettings
            ? <SettingsScreen onClose={() => setInSettings(false)} />
            : <LoginScreen
                onLogin={handleLogin}
                onOpenSettings={() => setInSettings(true)}
                onOpenMaterials={() => setInMaterials(true)}
              />
      ) : user.must_change_password ? (
        /**
         * Activación del perfil. La cuenta entró con la clave temporal que le
         * dio el docente, así que aquí no se dibuja el catálogo en absoluto:
         * no es una pantalla encima de la app, es la app hasta que se cambie.
         *
         * Y no es solo una decisión de interfaz. El servidor le responde 403 a
         * `/predict` y a `/sessions` mientras la marca siga puesta, así que un
         * catálogo dibujado detrás sería una app donde se puede elegir figura,
         * armarla, tomar la foto y recibir un error al final. Esto evita el
         * paseo entero.
         *
         * Salir de aquí es cerrar la sesión: es lo único que tiene sentido
         * cuando el teléfono se comparte y quien lo cogió no era su dueño.
         */
        <PinScreen
          obligatorio
          claveActual={claveDeIngreso ?? undefined}
          nombre={user.name.split(" ")[0]}
          onClose={handleLogout}
          onDone={claveCambiada}
        />
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
              onFigures={setFiguras}
              onSelect={setActiveFig}
              onOpenHistory={() => setInHistory(true)}
              onOpenMaterials={() => setInMaterials(true)}
              onOpenSettings={() => setInSettings(true)}
              onLogout={handleLogout}
            />
          </View>
          {activeFig && (
            <View style={s.encima}>
              {/* La `key` es lo que hace que encadenar figuras funcione. Sin
                  ella, cambiar la prop `figure` deja viva toda la maquinaria
                  del intento anterior —fase, foto, resultado, cronómetro— y el
                  niño aterriza en la figura nueva viendo el veredicto de la
                  vieja. Con ella, React monta una pantalla limpia. */}
              <GameScreen
                key={activeFig.slug}
                user={user} figure={activeFig} onExit={salirDeLaFigura}
                onOpenMaterials={() => setInMaterials(true)}
                siguiente={siguienteFigura(figuras, activeFig)}
                onSiguiente={irALaSiguiente}
              />
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
                onVerRecorrido={() => {
                  setInSettings(false);
                  setTourDesdeAjustes(true);
                  setInTour(true);
                }}
              />
            </View>
          )}
          {inHistory && (
            <View style={s.encima}>
              <HistoryScreen user={user} onClose={() => setInHistory(false)} />
            </View>
          )}
          {/* Va el último del árbol a propósito: se abre desde el catálogo y
              también desde una figura, así que tiene que quedar por encima de
              la pantalla de juego y no debajo. */}
          {inMaterials && (
            <View style={s.encima}>
              <MaterialsScreen onClose={() => setInMaterials(false)} />
            </View>
          )}
          {/* El recorrido va por encima de todo lo demás: la primera vez se
              abre solo, sobre el catálogo recién cargado, y desde Ajustes se
              abre encima de la pantalla que estuviera. Su propio manejador del
              botón atrás retrocede de paso en vez de cerrar la app. */}
          {inTour && (
            <View style={s.encima}>
              <TourScreen
                nombre={user.name.split(" ")[0]}
                onFinish={cerrarRecorrido}
              />
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
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  buscando: { fontFamily: F.regular, fontSize: 13, color: C.muted },
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
