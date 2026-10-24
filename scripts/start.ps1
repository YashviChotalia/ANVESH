# Starts backend (port 8000) and frontend (port 3000) in two windows; logs to logs\backend.log and logs\frontend.log
$Root = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force -Path (Join-Path $Root "logs") | Out-Null
# stop anything already listening on the Anvesh ports (an earlier start.bat run)
foreach ($port in 8000, 3000) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Seconds 1
$be = Join-Path $Root "logs\backend.log"; $fe = Join-Path $Root "logs\frontend.log"
"=== backend $(Get-Date -Format s) ===" | Out-File $be -Encoding utf8
"=== frontend $(Get-Date -Format s) ===" | Out-File $fe -Encoding utf8
# --- dependency refresh (re-installs only when requirements.txt or package-lock.json changed)
$stampDir = Join-Path $Root "logs"; New-Item -ItemType Directory -Force -Path $stampDir | Out-Null
$req = Join-Path $Root "backend\requirements.txt"; $reqStamp = Join-Path $stampDir ".req.sha"
$reqHash = (Get-FileHash $req -Algorithm SHA256).Hash
if (-not (Test-Path $reqStamp) -or (Get-Content $reqStamp -Raw).Trim() -ne $reqHash) {
  Write-Host "Updating backend packages (security updates)..."
  & (Join-Path $Root "backend\.venv\Scripts\python.exe") -m pip install -q -r $req
  if ($LASTEXITCODE -eq 0) { Set-Content $reqStamp $reqHash }
}
$lock = Join-Path $Root "frontend\package-lock.json"; $lockStamp = Join-Path $stampDir ".lock.sha"
$lockHash = (Get-FileHash $lock -Algorithm SHA256).Hash
if (-not (Test-Path $lockStamp) -or (Get-Content $lockStamp -Raw).Trim() -ne $lockHash) {
  Write-Host "Updating frontend packages..."
  Push-Location (Join-Path $Root "frontend"); npm install --no-audit --no-fund | Out-Null; $ok = $LASTEXITCODE; Pop-Location
  if ($ok -eq 0) { Set-Content $lockStamp $lockHash }
}

$beCmd = "`$env:PYTHONUTF8='1'; `$env:HF_HUB_DISABLE_PROGRESS_BARS='1'; `$env:HF_HUB_DISABLE_SYMLINKS_WARNING='1'; Set-Location '$Root\backend'; & '.\.venv\Scripts\python.exe' -m anvesh.seed; & '.\.venv\Scripts\python.exe' -m uvicorn anvesh.api:app --host 127.0.0.1 --port 8000 2>&1 | ForEach-Object { `"`$_`" | Out-File '$be' -Append -Encoding utf8; `"`$_`" }"
$feCmd = "Set-Location '$Root\frontend'; npm.cmd run dev 2>&1 | ForEach-Object { `"`$_`" | Out-File '$fe' -Append -Encoding utf8; `"`$_`" }"
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $beCmd -WindowStyle Normal
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $feCmd -WindowStyle Normal
Write-Host "Starting... open http://localhost:3000 in about 20 seconds."
Start-Sleep -Seconds 20
Start-Process "http://localhost:3000"
