# Arranca los tres procesos de Tangram IA en ventanas separadas.
#
# Con el backend dividido en dos servicios, abrir tres terminales a mano y
# recordar el orden es una fuente de errores tonta. Este script los levanta y
# comprueba que respondan.
#
#   .\dev.ps1            arranca todo
#   .\dev.ps1 -SoloApi   sin el frontend (útil para probar con la app móvil)

param([switch]$SoloApi)

$raiz = $PSScriptRoot
$ErrorActionPreference = "Stop"

function Esperar($url, $nombre, $intentos = 60) {
    for ($i = 0; $i -lt $intentos; $i++) {
        try {
            Invoke-RestMethod -Uri $url -TimeoutSec 2 | Out-Null
            Write-Host "  [OK] $nombre" -ForegroundColor Green
            return $true
        } catch { Start-Sleep -Milliseconds 1000 }
    }
    Write-Host "  [!!] $nombre no respondió en $intentos s" -ForegroundColor Red
    return $false
}

# Lee una clave de un archivo .env. Se usa para comprobar, ANTES de arrancar,
# que el archivo de pesos al que apunta YOLO_WEIGHTS existe de verdad: si no,
# el servicio arranca igual en modo demostración y devuelve cifras verosímiles
# que es fácil dar por buenas durante horas.
function LeerEnv($archivo, $clave) {
    if (-not (Test-Path $archivo)) { return $null }
    foreach ($linea in Get-Content $archivo) {
        if ($linea -match "^\s*$clave\s*=\s*(.+?)\s*$") { return $Matches[1] }
    }
    return $null
}

# ─── Comprobaciones previas ──────────────────────────────────────────────────
# Los tres .env y el archivo de pesos. Todo esto falla de forma silenciosa o
# confusa si se descubre a mitad de camino, así que se mira antes de abrir
# ninguna ventana.
$faltan = @()
foreach ($e in @("vision-service\.env", "backend\.env", "frontend\.env")) {
    if (-not (Test-Path (Join-Path $raiz $e))) { $faltan += $e }
}
if ($faltan.Count -gt 0) {
    Write-Host "Faltan archivos de configuración:" -ForegroundColor Red
    foreach ($f in $faltan) { Write-Host "  $f   (copia el .env.example de al lado)" }
    exit 1
}

$pesos = LeerEnv (Join-Path $raiz "vision-service\.env") "YOLO_WEIGHTS"
if ($pesos) {
    $rutaPesos = Join-Path $raiz "vision-service\$pesos"
    if (-not (Test-Path $rutaPesos)) {
        Write-Host ""
        Write-Host "  [!!] YOLO_WEIGHTS apunta a un archivo que no existe:" -ForegroundColor Red
        Write-Host "       $rutaPesos"
        Write-Host "       El servicio arrancará en MODO DEMOSTRACIÓN y sus cifras serán"
        Write-Host "       simuladas: no saldrán de la foto del estudiante." -ForegroundColor Yellow
        Write-Host ""
    }
}

# ¿Hay ya algo escuchando en ese puerto?
#
# Sin esta comprobación, ejecutar el script dos veces —cosa fácil desde el
# lanzador de doble clic— abre una segunda tanda de procesos que mueren al
# instante con EADDRINUSE. Lo confuso es el resultado: las ventanas nuevas se
# cierran, parece que no arrancó nada, y sin embargo todo estaba funcionando.
function PuertoOcupado($puerto) {
    $null -ne (Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue)
}

function Arrancar($puerto, $nombre, $carpeta, $comando) {
    if (PuertoOcupado $puerto) {
        Write-Host "  [=] $nombre ya estaba corriendo en el $puerto; no se arranca otro." -ForegroundColor DarkGray
        return
    }
    Write-Host "Arrancando $nombre ($puerto)..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList @(
        "-NoExit", "-Command", "cd '$carpeta'; $comando"
    )
}

# 1. Servicio de visión. Va primero porque cargar los pesos del detector tarda
#    unos segundos y el backend lo consulta en /health.
$python = Join-Path $raiz "vision-service\venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    Write-Host "No existe $python. Crea el entorno:" -ForegroundColor Red
    Write-Host "  cd vision-service; python -m venv venv; .\venv\Scripts\pip install -r requirements.txt"
    exit 1
}
Arrancar 8001 "el servicio de visión" "$raiz\vision-service" `
         "& '$python' -m uvicorn service:app --port 8001"

# 2. Backend, como diga su propio .env.
#
# Con NODE_ENV=production no puede arrancarse con `npm run dev`: eso es `tsx
# watch`, que compila al vuelo y vigila los archivos: el modo de trabajar, no el
# de servir. Se compila y se ejecuta el JavaScript de `dist/`, que es lo que se
# despliega de verdad.
#
# El `build` se rehace en cada arranque a propósito. Un `dist/` viejo no se
# distingue de uno al día —el servidor levanta igual— y el fallo aparece mucho
# después, como un cambio que "no hizo efecto".
$entorno = LeerEnv (Join-Path $raiz "backend\.env") "NODE_ENV"
if ($entorno -eq "production") {
    Write-Host "  [i] NODE_ENV=production: se compila y se sirve desde dist/." -ForegroundColor DarkGray
    $comandoBackend = "npm run build; if (`$?) { npm start }"
} else {
    $comandoBackend = "npm run dev"
}
Arrancar 8000 "el backend" "$raiz\backend" $comandoBackend

# 3. Frontend
if (-not $SoloApi) {
    Arrancar 5173 "el frontend" "$raiz\frontend" "npm run dev"
}

Write-Host ""
Write-Host "Comprobando..." -ForegroundColor Cyan
# A visión se le dan tres minutos y no uno: cargar PyTorch y el detector en
# frío —la primera vez tras reiniciar, con el antivirus revisando cada DLL—
# supera con facilidad los 60 s, y con el tope corto el script declaraba «modo
# demostración» sobre un servicio que terminaba de arrancar medio minuto después.
# El backend no hay que reiniciarlo: pregunta a visión en cada foto, así que en
# cuanto el servicio aparece, las fotos se analizan de verdad.
$visionLista = Esperar "http://127.0.0.1:8001/health" "servicio de visión  http://127.0.0.1:8001" 180
if (-not $visionLista) {
    Write-Host "       Mira su ventana: si sigue cargando el modelo, espera y vuelve a abrir" -ForegroundColor Yellow
    Write-Host "       http://127.0.0.1:8001/health. Si muestra un error, ese es el problema." -ForegroundColor Yellow
}
if (Esperar "http://127.0.0.1:8000/health" "backend             http://localhost:8000") {
    $salud = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health"
    Write-Host ""
    Write-Host "  MySQL conectado : $($salud.db_connected)"
    Write-Host "  Umbral vigente  : $($salud.match_threshold)"
    # Las dos etapas del análisis, por separado. La segunda se nombra a
    # propósito: en vision-service/models/ sigue habiendo un U-Net retirado, y
    # cada vez que alguien lo ve da por hecho que falta un modelo por activar.
    if ($salud.yolo_loaded) { $textoDet = "YOLOv8s-seg cargado"; $colorDet = "Green" }
    else                    { $textoDet = "NO CARGADO";          $colorDet = "Red"   }
    Write-Host "  Deteccion fichas: $textoDet" -ForegroundColor $colorDet
    # Qué archivo de pesos se cargó, preguntándoselo al servicio de visión y no
    # al .env: lo que importa es lo que está corriendo, que puede no ser lo que
    # dice el archivo si el servicio ya estaba levantado de antes.
    try {
        $vision = Invoke-RestMethod -Uri "http://127.0.0.1:8001/health" -TimeoutSec 2
        if ($vision.yolo_weights) {
            Write-Host "  Pesos cargados  : $($vision.yolo_weights)"
        }
    } catch { }
    Write-Host "  Comparacion     : geometrica, sin pesos (no hay modelo que activar)"
    if (-not $salud.yolo_loaded) {
        Write-Host ""
        Write-Host "  ############################################################" -ForegroundColor Red
        Write-Host "  #  MODO DEMOSTRACIÓN: no se está analizando ninguna foto.  #" -ForegroundColor Red
        Write-Host '  #  Las respuestas llevan "mock": true y sus cifras salen   #' -ForegroundColor Red
        Write-Host "  #  de deformar la propia silueta objetivo.                 #" -ForegroundColor Red
        Write-Host "  #  Revisa YOLO_WEIGHTS en vision-service/.env              #" -ForegroundColor Red
        Write-Host "  ############################################################" -ForegroundColor Red
    }
}
if (-not $SoloApi) { Write-Host "  frontend            http://localhost:5173" }

# ─── Dónde está cada cosa ────────────────────────────────────────────────────
# Las direcciones, cada una con lo que hay detrás. Es lo que se busca al
# terminar de arrancar: qué abrir en el navegador para el panel del docente,
# qué escribir en Ajustes de la app del teléfono. Antes había que deducirlo de
# tres líneas sueltas de "[OK]" y del README.
#
# La IP de la red se calcula ahora y no se guarda en ningún archivo: una
# dirección solo vale en la red donde se leyó, y publicarla en el repositorio
# describe esa red a cualquiera. Se descartan las interfaces virtuales
# (vEthernet de WSL/Hyper-V, VirtualBox, VMware): el teléfono no llega por ahí.
function IpsDeRed {
    try {
        Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object {
                $_.IPAddress -notlike "127.*" -and
                $_.IPAddress -notlike "169.254.*" -and
                $_.InterfaceAlias -notmatch "vEthernet|Loopback|VirtualBox|VMware|Bluetooth" -and
                $_.PrefixOrigin -in @("Dhcp", "Manual")
            } | Select-Object -ExpandProperty IPAddress
    } catch { @() }
}

function Fila($que, $url, $nota) {
    Write-Host ("  {0,-26}" -f $que) -NoNewline -ForegroundColor White
    Write-Host ("{0,-38}" -f $url) -NoNewline -ForegroundColor Cyan
    if ($nota) { Write-Host $nota -ForegroundColor DarkGray } else { Write-Host "" }
}

Write-Host ""
Write-Host "Direcciones" -ForegroundColor Cyan
Write-Host ("  " + ("-" * 74)) -ForegroundColor DarkGray
if (-not $SoloApi) {
    Fila "Dashboard del maestro"   "http://localhost:5173"        "entra como docente: pestañas Intentos y Estudiantes"
    Fila "Web del estudiante"      "http://localhost:5173"        "misma dirección; entra con una cuenta de estudiante"
}
Fila "API (backend)"          "http://localhost:8000"        "lo que consumen la web y la app"
Fila "Estado del sistema"     "http://localhost:8000/health" "MySQL, detector, almacén de fotos y umbral"
Fila "Servicio de visión"     "http://127.0.0.1:8001/health" "YOLOv8s-seg + validador geométrico"

$ips = @(IpsDeRed)
if ($ips.Count -gt 0) {
    Write-Host ""
    Write-Host "  Para la app del teléfono (mismo WiFi que esta PC):" -ForegroundColor White
    foreach ($ip in $ips) {
        Fila "  Servidor en Ajustes" "http://${ip}:8000" "la app también lo busca sola al arrancar"
    }
    if (-not $SoloApi) {
        foreach ($ip in $ips) {
            Fila "  Web desde otro equipo" "http://${ip}:5173" "el dashboard del maestro desde un portátil o tableta"
        }
    }
} else {
    Write-Host ""
    Write-Host "  [!] No se encontró ninguna IP de red: sin WiFi, el teléfono no puede conectarse." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  Cuentas de demostración (si la base se sembró): docente@tangram.edu y" -ForegroundColor DarkGray
Write-Host "  estudiante@tangram.edu, clave 1234. El estudiante puede además crearse" -ForegroundColor DarkGray
Write-Host "  la cuenta desde la app (Crear cuenta) y aparece en el panel del maestro." -ForegroundColor DarkGray
Write-Host ""
