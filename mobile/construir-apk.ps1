# Genera el APK de la app y lo deja en mobile\, reemplazando el anterior.
#
#   .\construir-apk.ps1              compila y reemplaza
#   .\construir-apk.ps1 -SoloCopiar  no compila; solo copia el último build
#
# Por qué existe
# -------------
# El APK que se entrega tiene que corresponder al código que se entrega. Sin un
# paso fijo, lo que pasa siempre es lo mismo: se toca la app, se prueba con
# `expo start` --que no genera ningún APK-- y el archivo que viaja en la carpeta
# sigue siendo el de hace tres semanas. Nadie lo nota hasta que alguien lo
# instala.
#
# El nombre lleva la versión de app.json y se borra cualquier APK anterior antes
# de copiar, para que en la carpeta **nunca haya dos**. Dos APKs con nombres
# parecidos es peor que uno viejo: al menos el viejo no obliga a adivinar.
#
# Este archivo se guarda en UTF-8 **con BOM**, y no es un detalle de formato:
# Windows PowerShell 5.1 lee los .ps1 sin BOM como ANSI, y entonces cada tilde
# sale rota en la consola ("está" -> "estÃ¡"). Al reescribirlo, conserva el BOM.
param([switch]$SoloCopiar)

$ErrorActionPreference = "Stop"
$raiz = $PSScriptRoot
Set-Location $raiz

# --- Comprobaciones previas -------------------------------------------------
# Todas fallan de forma confusa si se descubren a mitad de un build de varios
# minutos, así que se miran antes de empezar.
if (-not (Test-Path "$raiz\android\gradlew.bat")) {
    Write-Host "No existe android\gradlew.bat." -ForegroundColor Red
    Write-Host "  La carpeta nativa no está generada. Créala con:  npx expo prebuild --platform android"
    exit 1
}

<#
.SYNOPSIS
Deshace el escapado de un valor de un archivo .properties.

.DESCRIPTION
`local.properties` es un archivo de propiedades de Java, y ahí una ruta de
Windows se guarda con cada carácter especial escapado con barra invertida:

    sdk.dir=C\:\\Users\\alguien\\AppData\\Local\\Android\\Sdk

Hay que deshacer las dos cosas, no solo las barras dobles. Quitando `\\` pero
dejando `\:` queda `C\:\Users\...`, que no es una ruta válida y hace creer que
el SDK no está instalado cuando sí lo está. Una sola pasada de `\(.)` -> `$1`
resuelve las dos a la vez, y también cualquier otro escape que aparezca.
#>
function Expand-PropertiesPath([string]$valor) {
    if (-not $valor) { return $null }
    return [regex]::Replace($valor.Trim(), '\\(.)', '$1')
}

# El SDK se busca en tres sitios, en orden de autoridad: lo que diga el archivo
# del proyecto, lo que diga el entorno, y por último el sitio por defecto de
# Android Studio. Con uno que responda, basta.
$candidatos = @()
# El Test-Path va antes a propósito. `expo prebuild --clean` borra android/ entero,
# y con él local.properties, que no se versiona porque la ruta del SDK es de cada
# equipo. Sin esta guarda, Select-String sobre el archivo ausente aborta el script
# --con $ErrorActionPreference en "Stop", ni -ErrorAction SilentlyContinue lo
# salva-- y las otras dos vías de encontrar el SDK, que estaban justo debajo y
# habrían funcionado, no se llegan a probar nunca. El síntoma es el peor posible:
# "no encuentro local.properties" cuando el problema real no era ese.
$props = "$raiz\android\local.properties"
if (Test-Path $props) {
    $linea = Select-String -Path $props -Pattern '^\s*sdk\.dir\s*=\s*(.+)$'
    if ($linea) {
        $candidatos += [pscustomobject]@{
            ruta   = Expand-PropertiesPath $linea.Matches.Groups[1].Value
            origen = "android\local.properties"
        }
    }
}
foreach ($v in "ANDROID_HOME", "ANDROID_SDK_ROOT") {
    $valor = [Environment]::GetEnvironmentVariable($v)
    if ($valor) { $candidatos += [pscustomobject]@{ ruta = $valor; origen = $v } }
}
if ($env:LOCALAPPDATA) {
    $candidatos += [pscustomobject]@{
        ruta   = Join-Path $env:LOCALAPPDATA "Android\Sdk"
        origen = "ubicación por defecto de Android Studio"
    }
}

$sdk = $null
foreach ($c in $candidatos) {
    if ($c.ruta -and (Test-Path $c.ruta)) {
        $sdk = $c.ruta
        Write-Host "SDK de Android: $sdk" -ForegroundColor DarkGray
        Write-Host "  (según $($c.origen))" -ForegroundColor DarkGray
        break
    }
}

if (-not $sdk) {
    Write-Host "No encuentro el SDK de Android. Miré en:" -ForegroundColor Red
    foreach ($c in $candidatos) { Write-Host "  - $($c.ruta)   [$($c.origen)]" }
    Write-Host ""
    Write-Host "  Si Android Studio está instalado, la ruta correcta sale en"
    Write-Host "  Settings -> Languages & Frameworks -> Android SDK."
    exit 1
}

$version = (Get-Content "$raiz\app.json" -Raw | ConvertFrom-Json).expo.version
if (-not $version) { $version = "0.0.0" }
$destino = Join-Path $raiz "tangram-ia-$version.apk"
$origen  = Join-Path $raiz "android\app\build\outputs\apk\release\app-release.apk"

# --- Compilar ---------------------------------------------------------------
# Toda la salida de Gradle se guarda además en un archivo. Cuando algo falla, el
# motivo son dos líneas perdidas en medio de cientos, y en una ventana que se
# cierra no hay forma de recuperarlas. Con el registro en disco, el error se
# puede leer con calma --o pegárselo a quien vaya a ayudar-- en vez de tener que
# reproducir el fallo para volver a verlo.
$registro = Join-Path $raiz "ultimo-build.log"

if (-not $SoloCopiar) {
    Write-Host "Compilando el APK de release (tarda varios minutos)..." -ForegroundColor Cyan
    Write-Host "  el registro completo queda en ultimo-build.log" -ForegroundColor DarkGray
    Remove-Item $registro -Force -ErrorAction SilentlyContinue

    # Un build de release se empaqueta en modo producción, y quien lo decide es
    # esta variable: `expo-constants` la lee al generar la configuración que
    # queda dentro del APK. Al llamar a Gradle directamente --y no a través de
    # `expo run:android`-- nadie la define, así que se define aquí.
    #
    # No es solo corrección: sin ella Expo avisa por la salida de errores, y ese
    # aviso bastaba para tumbar el script entero. Ver el comentario de abajo.
    $env:NODE_ENV = "production"

    Push-Location "$raiz\android"
    try {
        # `2>&1` mete también los errores en el flujo, y `--stacktrace` añade el
        # punto exacto del fallo: sin él, Gradle dice qué tarea falló pero no por
        # qué, y hay que repetir el build entero para averiguarlo.
        #
        # El `$ErrorActionPreference` de aquí es imprescindible, y cuesta de
        # creer hasta que pasa: en Windows PowerShell 5.1, redirigir la salida
        # de errores de un .bat convierte **cada línea** en un error de
        # PowerShell, y con la preferencia en "Stop" de la cabecera el primero
        # de ellos aborta el script. Gradle manda advertencias de rutina por ahí
        # --una nota de Expo, un aviso de una dependencia--, así que el build se
        # cortaba a mitad por un mensaje informativo y dejaba un APK a medio
        # hacer con la fecha del día, indistinguible de uno terminado.
        #
        # Lo que decide si el build salió bien es el código de salida, que se
        # comprueba justo después. Las líneas de texto son texto.
        # El SDK que se encontró arriba se le pasa también a Gradle. Sin esto,
        # el script sabía dónde estaba el SDK y Gradle no: `expo prebuild`
        # borra android\local.properties, y el build fallaba con "SDK location
        # not found" justo después de regenerar la carpeta nativa.
        $env:ANDROID_HOME = $sdk

        $previo = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            & .\gradlew.bat assembleRelease --console=plain --stacktrace 2>&1 |
                Tee-Object -FilePath $registro
            $codigo = $LASTEXITCODE
        } finally { $ErrorActionPreference = $previo }
    } finally { Pop-Location }

    if ($codigo -ne 0) {
        Write-Host ""
        Write-Host "Gradle falló (código $codigo). El APK de la carpeta NO se tocó." -ForegroundColor Red
        Write-Host ""
        Write-Host "Las líneas que importan:" -ForegroundColor Yellow
        # Las de "FAILURE", "What went wrong" y "error:" son las que explican el
        # fallo; el resto del registro es ruido de tareas que sí funcionaron.
        Select-String -Path $registro -Pattern "FAILURE|What went wrong|^\s*>|error:|Caused by" |
            Select-Object -First 25 |
            ForEach-Object { Write-Host "  $($_.Line)" }
        Write-Host ""
        Write-Host "  Registro completo: $registro" -ForegroundColor DarkGray
        exit 1
    }
}

if (-not (Test-Path $origen)) {
    Write-Host "Gradle terminó pero no encuentro el APK en:" -ForegroundColor Red
    Write-Host "  $origen"
    exit 1
}

# --- Reemplazar -------------------------------------------------------------
# Se borra cualquier tangram-ia-*.apk previo, no solo el del mismo nombre: si la
# versión de app.json subió, el archivo nuevo se llamaría distinto y el viejo se
# quedaría al lado haciéndose pasar por la entrega.
Get-ChildItem -Path $raiz -Filter "tangram-ia-*.apk" -File | ForEach-Object {
    Write-Host "  quitando $($_.Name)" -ForegroundColor DarkGray
    Remove-Item $_.FullName -Force
}
Copy-Item $origen $destino -Force

$mb = [math]::Round((Get-Item $destino).Length / 1MB, 1)
Write-Host ""
Write-Host "  APK listo: $(Split-Path $destino -Leaf)  ($mb MB)" -ForegroundColor Green
Write-Host "  $destino"
Write-Host ""
Write-Host "  Firmado con android\app\debug.keystore, que es el que trae la plantilla" -ForegroundColor DarkGray
Write-Host "  de Expo y está versionado: por eso este APK se instala encima del" -ForegroundColor DarkGray
Write-Host "  anterior sin desinstalarlo. Para publicar en Play hace falta una firma" -ForegroundColor DarkGray
Write-Host "  propia; para repartirlo a mano, esta sirve." -ForegroundColor DarkGray
