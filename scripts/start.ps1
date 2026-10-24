# Starts backend (port 8000) and frontend (port 3000) in two windows; logs to logs\backend.log and logs\frontend.log
$Root = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force -Path (Join-Path $Root "logs") | Out-Null
$be = Join-Path $Root "logs\backend.log"; $fe = Join-Path $Root "logs\frontend.log"
"=== backend $(Get-Date -Format s) ===" | Out-File $be -Encoding utf8
"=== frontend $(Get-Date -Format s) ===" | Out-File $fe -Encoding utf8
$beCmd = "`$env:PYTHONUTF8='1'; Set-Location '$Root\backend'; & '.\.venv\Scripts\python.exe' -m uvicorn anvesh.api:app --host 127.0.0.1 --port 8000 2>&1 | ForEach-Object { `"`$_`" | Out-File '$be' -Append -Encoding utf8; `"`$_`" }"
$feCmd = "Set-Location '$Root\frontend'; npm.cmd run dev 2>&1 | ForEach-Object { `"`$_`" | Out-File '$fe' -Append -Encoding utf8; `"`$_`" }"
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $beCmd -WindowStyle Normal
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $feCmd -WindowStyle Normal
Write-Host "Starting... open http://localhost:3000 in about 20 seconds."
Start-Sleep -Seconds 20
Start-Process "http://localhost:3000"
