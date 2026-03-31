param(
  [string]$ServiceName = "KPI-API",
  [string]$ServerPath = "D:\KPI\server",
  [string]$NodeExe = "C:\Program Files\nodejs\node.exe",
  [string]$WinSwExe = "D:\KPI\server\deploy\KPI-API.exe"
)

$distEntry = Join-Path $ServerPath "dist\index.js"
$envFile = Join-Path $ServerPath ".env.production"
$logsDir = Join-Path $ServerPath "logs"
$wrapperDir = Split-Path -Parent $WinSwExe
$wrapperBaseName = [System.IO.Path]::GetFileNameWithoutExtension($WinSwExe)
$wrapperConfigPath = Join-Path $wrapperDir "$wrapperBaseName.xml"

if (-not (Test-Path $WinSwExe)) {
  throw "WinSW executable was not found at $WinSwExe. Download WinSW, rename it to $wrapperBaseName.exe, and place it in $wrapperDir."
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
  throw "Production env file was not found at $envFile. Create it from server\.env.production.example first."
}

New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

$escapedServiceName = [System.Security.SecurityElement]::Escape($ServiceName)
$escapedNodeExe = [System.Security.SecurityElement]::Escape($NodeExe)
$escapedServerPath = [System.Security.SecurityElement]::Escape($ServerPath)
$escapedEnvFile = [System.Security.SecurityElement]::Escape($envFile)
$escapedLogsDir = [System.Security.SecurityElement]::Escape($logsDir)

$wrapperConfig = @"
<service>
  <id>$escapedServiceName</id>
  <name>$escapedServiceName</name>
  <description>KPI backend API service</description>
  <executable>$escapedNodeExe</executable>
  <arguments>dist\index.js</arguments>
  <workingdirectory>$escapedServerPath</workingdirectory>
  <stoptimeout>15 sec</stoptimeout>
  <env name="NODE_ENV" value="production" />
  <env name="DOTENV_CONFIG_PATH" value="$escapedEnvFile" />
  <logpath>$escapedLogsDir</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10485760</sizeThreshold>
    <keepFiles>5</keepFiles>
  </log>
  <onfailure action="restart" delay="10 sec" />
</service>
"@

Set-Content -Path $wrapperConfigPath -Value $wrapperConfig -Encoding UTF8

$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($null -ne $existingService) {
  if ($existingService.Status -ne "Stopped") {
    & $WinSwExe stop | Out-Host
  }
  & $WinSwExe uninstall | Out-Host
}

& $WinSwExe install | Out-Host
& $WinSwExe start | Out-Host

Write-Host "Service '$ServiceName' is installed or updated with WinSW."
Write-Host "WinSW exe: $WinSwExe"
Write-Host "WinSW config: $wrapperConfigPath"
Write-Host "Backend entry: $distEntry"
Write-Host "Env file: $envFile"
Write-Host "Logs path: $logsDir"
