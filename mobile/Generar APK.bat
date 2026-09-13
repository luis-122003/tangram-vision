@echo off
rem ===========================================================================
rem  Generar APK - doble clic y listo.
rem
rem  Igual que "Iniciar Tangram IA.bat": existe solo porque PowerShell no
rem  ejecuta .ps1 con doble clic (los abre en el editor) y la politica de
rem  ejecucion por defecto los bloquea. La logica vive en construir-apk.ps1.
rem ===========================================================================
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0construir-apk.ps1" %*
echo.
pause
