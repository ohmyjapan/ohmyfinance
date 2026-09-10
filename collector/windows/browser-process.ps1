param([string]$ProfilePath)
$ErrorActionPreference = 'Stop'
$omfProfileNormalized = [IO.Path]::GetFullPath($ProfilePath).Replace('/','\').ToLowerInvariant()
$omfChromeProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'")
$omfBrowsers = @($omfChromeProcesses | Where-Object {
  if (-not $_.CommandLine -or $_.CommandLine -match '--type=|crashpad-handler') { return $false }
  if ($_.CommandLine -match '--user-data-dir=(?:"([^"]+)"|([^\s]+))') {
    $omfCandidate = if ($Matches[1]) { $Matches[1] } else { $Matches[2] }
    return [IO.Path]::GetFullPath($omfCandidate).Replace('/','\').ToLowerInvariant() -eq $omfProfileNormalized
  }
  return $false
} | ForEach-Object {
  if ($_.CommandLine -match '--remote-debugging-port=(\d+)') {
    [pscustomobject]@{ pid=$_.ProcessId; port=[int]$Matches[1] }
  } else { [pscustomobject]@{ pid=$_.ProcessId; port=0 } }
})
# Medium-integrity PM2 can enumerate elevated Chrome PIDs but cannot read their command lines.
ConvertTo-Json -InputObject @{ matches=$omfBrowsers; pids=@($omfChromeProcesses | ForEach-Object { $_.ProcessId }); unreadable=@($omfChromeProcesses | Where-Object { -not $_.CommandLine } | ForEach-Object { $_.ProcessId }) } -Compress
