@echo off
rem ===========================================================================
rem  Iniciar Tangram IA - doble clic y listo.
rem
rem  Existe por una razon concreta: el sistema son TRES procesos y arrancar solo
rem  uno no da ningun error visible. Arrancar el backend sin el servicio de
rem  vision deja la app pidiendo fotos que nadie analiza, y el fallo no aparece
rem  hasta que un nino toma la primera foto. Un doble clic no se olvida la mitad.
rem
rem  Lo unico que hace es llamar a dev.ps1, que es donde vive la logica: este
rem  archivo solo resuelve que PowerShell no ejecuta .ps1 con doble clic (los
rem  abre en el editor) y que la politica de ejecucion por defecto los bloquea.
rem ===========================================================================

rem %~dp0 es la carpeta de este archivo: asi funciona aunque se lance desde un
rem acceso directo del escritorio, donde el directorio actual es otro.
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1" %*

rem Si dev.ps1 corto por una comprobacion previa (falta un .env, no existe el
rem venv), la ventana se cerraria de golpe y no se alcanzaria a leer el motivo.
if errorlevel 1 (
    echo.
    echo   El arranque se detuvo. Lee el mensaje de arriba.
    echo.
    pause
)
