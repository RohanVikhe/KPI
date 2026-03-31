#Requires -RunAsAdministrator

[CmdletBinding()]
param(
  [string]$SiteName = "KPI",
  [string]$AppPoolName = "KPIStaticPool",
  [string]$PhysicalPath = "D:\KPI\client\dist",
  [string]$IPAddress = "*",
  [int]$Port = 8080,
  [string]$HostHeader = "",
  [switch]$SkipAclUpdate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path $PhysicalPath)) {
  throw "Frontend build output was not found at $PhysicalPath. Run npm run build inside the client folder first."
}

Import-Module WebAdministration

function Set-RootApplicationPool {
  param(
    [Parameter(Mandatory = $true)]
    [string]$TargetSiteName,

    [Parameter(Mandatory = $true)]
    [string]$TargetAppPoolName
  )

  Set-WebConfigurationProperty `
    -PSPath "MACHINE/WEBROOT/APPHOST" `
    -Filter "system.applicationHost/sites/site[@name='$TargetSiteName']/application[@path='/']" `
    -Name "applicationPool" `
    -Value $TargetAppPoolName
}

function Set-RootPhysicalPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$TargetSiteName,

    [Parameter(Mandatory = $true)]
    [string]$TargetPhysicalPath
  )

  Set-WebConfigurationProperty `
    -PSPath "MACHINE/WEBROOT/APPHOST" `
    -Filter "system.applicationHost/sites/site[@name='$TargetSiteName']/application[@path='/']/virtualDirectory[@path='/']" `
    -Name "physicalPath" `
    -Value $TargetPhysicalPath
}

$appPoolPath = "IIS:\AppPools\$AppPoolName"
if (-not (Test-Path $appPoolPath)) {
  New-WebAppPool -Name $AppPoolName | Out-Null
}

Set-ItemProperty -Path $appPoolPath -Name managedRuntimeVersion -Value ""
Set-ItemProperty -Path $appPoolPath -Name managedPipelineMode -Value 0
Set-ItemProperty -Path $appPoolPath -Name autoStart -Value $true
Set-ItemProperty -Path $appPoolPath -Name startMode -Value "AlwaysRunning"
Set-ItemProperty -Path $appPoolPath -Name processModel.identityType -Value "ApplicationPoolIdentity"
Set-ItemProperty -Path $appPoolPath -Name processModel.idleTimeout -Value ([TimeSpan]::Zero)

$sitePath = "IIS:\Sites\$SiteName"
if (-not (Test-Path $sitePath)) {
  $newWebsiteParams = @{
    Name = $SiteName
    PhysicalPath = $PhysicalPath
    ApplicationPool = $AppPoolName
    IPAddress = $IPAddress
    Port = $Port
  }

  if ($HostHeader) {
    $newWebsiteParams["HostHeader"] = $HostHeader
  }

  New-Website @newWebsiteParams | Out-Null
}
else {
  Set-RootApplicationPool -TargetSiteName $SiteName -TargetAppPoolName $AppPoolName
  Set-RootPhysicalPath -TargetSiteName $SiteName -TargetPhysicalPath $PhysicalPath
}

if (-not $SkipAclUpdate) {
  & icacls.exe $PhysicalPath /grant "IIS_IUSRS:(OI)(CI)(RX)" /grant "IUSR:(OI)(CI)(RX)" /T | Out-Host
}

$poolState = (Get-WebAppPoolState -Name $AppPoolName).Value
if ($poolState -ne "Started") {
  Start-WebAppPool -Name $AppPoolName
}

$siteState = (Get-Website -Name $SiteName).State
if ($siteState -ne "Started") {
  Start-Website -Name $SiteName
}

$bindings = (Get-Website -Name $SiteName).Bindings.Collection | ForEach-Object {
  "{0}://{1}" -f $_.protocol, $_.bindingInformation
}

$assignedPool = (Get-WebConfigurationProperty `
  -PSPath "MACHINE/WEBROOT/APPHOST" `
  -Filter "system.applicationHost/sites/site[@name='$SiteName']/application[@path='/']" `
  -Name "applicationPool").Value

Write-Host "IIS frontend site is configured."
Write-Host "Site name: $SiteName"
Write-Host "Physical path: $PhysicalPath"
Write-Host "Assigned app pool: $assignedPool"
Write-Host "App pool state: $((Get-WebAppPoolState -Name $AppPoolName).Value)"
Write-Host "Site state: $((Get-Website -Name $SiteName).State)"
Write-Host "Bindings:"
$bindings | ForEach-Object { Write-Host "  $_" }
Write-Host ""
Write-Host "Validation:"
Write-Host "& `"$env:windir\System32\inetsrv\appcmd.exe`" list app `"$SiteName/`" /text:apppool.name"
Write-Host "& `"$env:windir\System32\inetsrv\appcmd.exe`" list apppool `"$AppPoolName`" /text:state"
