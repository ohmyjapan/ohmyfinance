param([string]$ProfilePath, [string]$Root, [switch]$Kill)
$ErrorActionPreference = 'Stop'
function Normalize([string]$value) { return [IO.Path]::GetFullPath($value).Replace('/', '\').TrimEnd('\').ToLowerInvariant() }
function ProfileOf($process) {
  if ($process.CommandLine -and $process.CommandLine -match '--user-data-dir=(?:"([^"]+)"|([^\s]+))') {
    $candidate = if ($Matches[1]) { $Matches[1] } else { $Matches[2] }
    return Normalize $candidate
  }
  return $null
}
$omfChromeProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'")
if ($Root) {
  # Crash recovery (plan omf-customer-credential-security-20261009 §2 site 5): every chrome.exe whose profile is a DIRECT
  # child of the ephemeral root, browser processes first; -Kill re-reads each process by id and ends it only when the
  # profile and creation time still match (exact identity, not a textual prefix).
  $omfRoot = Normalize $Root
  $omfMatches = @($omfChromeProcesses | ForEach-Object {
    $omfProfile = ProfileOf $_
    if ($omfProfile -and $_.CommandLine -notmatch 'crashpad-handler' -and (Split-Path -Parent $omfProfile) -eq $omfRoot) {
      [pscustomobject]@{ pid = $_.ProcessId; profile = $omfProfile; browser = ($_.CommandLine -notmatch '--type='); created = $_.CreationDate.ToString('o') }
    }
  })
  $omfKilled = @(); $omfFailed = @()
  if ($Kill) {
    foreach ($omfMatch in @($omfMatches | Sort-Object { if ($_.browser) { 0 } else { 1 } })) {
      $omfLive = Get-CimInstance Win32_Process -Filter "ProcessId = $($omfMatch.pid)"
      if ($omfLive -and (ProfileOf $omfLive) -eq $omfMatch.profile -and $omfLive.CreationDate.ToString('o') -eq $omfMatch.created) {
        try { Stop-Process -Id $omfMatch.pid -Force -ErrorAction Stop; $omfKilled += $omfMatch.pid } catch { $omfFailed += $omfMatch.pid }
      }
    }
  }
  ConvertTo-Json -InputObject @{ root = $omfRoot; matches = $omfMatches; killed = $omfKilled; failed = $omfFailed } -Compress -Depth 4
  exit 0
}
$omfProfileNormalized = Normalize $ProfilePath
$omfBrowsers = @($omfChromeProcesses | Where-Object {
  if (-not $_.CommandLine -or $_.CommandLine -match '--type=|crashpad-handler') { return $false }
  $omfCandidate = ProfileOf $_
  return $omfCandidate -eq $omfProfileNormalized
} | ForEach-Object {
  if ($_.CommandLine -match '--remote-debugging-port=(\d+)') {
    [pscustomobject]@{ pid=$_.ProcessId; port=[int]$Matches[1] }
  } else { [pscustomobject]@{ pid=$_.ProcessId; port=0 } }
})
# Medium-integrity PM2 can enumerate elevated Chrome PIDs but cannot read their command lines.
ConvertTo-Json -InputObject @{ matches=$omfBrowsers; pids=@($omfChromeProcesses | ForEach-Object { $_.ProcessId }); unreadable=@($omfChromeProcesses | Where-Object { -not $_.CommandLine } | ForEach-Object { $_.ProcessId }) } -Compress
