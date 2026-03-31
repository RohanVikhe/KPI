param(
  [string]$ServiceName = "KPI-API",
  [string]$ServerPath = "D:\KPI\server",
  [string]$NodeExe = "C:\Program Files\nodejs\node.exe",
  [string]$NssmExe = "C:\tools\nssm\nssm.exe"
)

$distEntry = Join-Path $ServerPath "dist\index.js"
$envFile = Join-Path $ServerPath ".env.production"
$logsDir = Join-Path $ServerPath "logs"
$stdoutLog = Join-Path $logsDir "service-stdout.log"
$stderrLog = Join-Path $logsDir "service-stderr.log"

if (-not (Test-Path $NssmExe)) {
  throw "NSSM was not found at $NssmExe"
}

if (-not (Test-Path $NodeExe)) {
  throw "Node.js was not found at $NodeExe"
}

if (-not (Test-Path $ServerPath)) {
  throw "Server path was not found at $ServerPath"
}

if (-not (Test-Path $distEntry)) {
  throw "Build output was not found at $distEntry. Run npm run build inside the server folder first."
}

if (-not (Test-Path $envFile)) {
  throw "Production env file was not found at $envFile. Create it from server\\.env.production.example first."
}

New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($null -eq $existingService) {
  & $NssmExe install $ServiceName $NodeExe $distEntry
}

& $NssmExe set $ServiceName AppDirectory $ServerPath
& $NssmExe set $ServiceName AppParameters $distEntry
& $NssmExe set $ServiceName AppEnvironmentExtra "NODE_ENV=production`r`nDOTENV_CONFIG_PATH=$envFile"
& $NssmExe set $ServiceName AppStdout $stdoutLog
& $NssmExe set $ServiceName AppStderr $stderrLog
& $NssmExe set $ServiceName AppRotateFiles 1
& $NssmExe set $ServiceName AppRotateOnline 1
& $NssmExe set $ServiceName AppRotateBytes 10485760
& $NssmExe set $ServiceName Start SERVICE_AUTO_START
& $NssmExe set $ServiceName DisplayName $ServiceName
& $NssmExe set $ServiceName Description "KPI backend API service"

if ($null -eq $existingService) {
  & $NssmExe start $ServiceName
} else {
  & $NssmExe restart $ServiceName
}

Write-Host "Service '$ServiceName' is installed or updated."
Write-Host "Backend entry: $distEntry"
Write-Host "Env file: $envFile"
Write-Host "Stdout log: $stdoutLog"
Write-Host "Stderr log: $stderrLog"
