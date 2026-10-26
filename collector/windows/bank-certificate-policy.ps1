# Pure decisions of the bank certificate helper (plan omf-ikeda-collector-20261025): no process, window, certificate store or file is
# read here. Dot-sourced by bank-certificate.ps1 and by the fictional Windows tests (collector/test/ikeda-portal.test.mjs). ASCII only:
# Windows PowerShell 5.1 reads a script without a byte order mark in the ANSI code page, so non-ASCII literals are written as char codes.
function ConvertTo-OmfPath([string]$value) { if (-not $value) { return $null }; return [IO.Path]::GetFullPath($value.Trim('"')).Replace('/', '\').TrimEnd('\').ToLowerInvariant() }
function Get-OmfProfileOf([string]$commandLine) {
  if ($commandLine -and $commandLine -match '--user-data-dir=(?:"([^"]+)"|([^\s]+))') { $c = if ($Matches[1]) { $Matches[1] } else { $Matches[2] }; return ConvertTo-OmfPath $c }
  return $null
}
# GUARD - the Chrome browser process this collector launched: same id, parented by this collector's node process, created after that
# process started (a reused id is never taken for it), the stock chrome.exe it launched, the browser process itself (no --type=) on
# exactly the collector's own profile, under the current Windows user and session. Returns @{ok} or @{ok=$false; reason}.
function Test-OmfBankProcess($Expected, $Observed) {
  if (-not ([string]$Expected.executable).EndsWith('\chrome.exe')) { return @{ ok = $false; reason = 'executable' } }
  if (-not $Observed) { return @{ ok = $false; reason = 'gone' } }
  if ([int]$Observed.pid -ne [int]$Expected.pid) { return @{ ok = $false; reason = 'pid' } }
  if ([int]$Observed.parentPid -ne [int]$Expected.parentPid) { return @{ ok = $false; reason = 'parent' } }
  if (-not $Observed.created -or ([DateTime]$Observed.created).ToUniversalTime() -lt ([DateTime]$Expected.notBefore).ToUniversalTime().AddSeconds(-2)) { return @{ ok = $false; reason = 'created' } }
  if (-not $Observed.executable -or (ConvertTo-OmfPath $Observed.executable) -ne $Expected.executable) { return @{ ok = $false; reason = 'executable' } }
  if (-not $Observed.commandLine -or $Observed.commandLine -match '--type=') { return @{ ok = $false; reason = 'not-browser' } }
  if ((Get-OmfProfileOf $Observed.commandLine) -ne $Expected.profile) { return @{ ok = $false; reason = 'profile' } }
  if (-not $Observed.user -or $Observed.user.ToLowerInvariant() -ne ([string]$Expected.user).ToLowerInvariant()) { return @{ ok = $false; reason = 'user' } }
  if ([int]$Observed.session -ne [int]$Expected.session) { return @{ ok = $false; reason = 'session' } }
  return @{ ok = $true }
}
# The names a chooser OK button may carry: ASCII OK and the fullwidth form (U+FF2F U+FF2B).
function Get-OmfOkNames { return @('OK', ([string][char]0xFF2F + [string][char]0xFF2B)) }
# GUARD (parent finding C1) - which window is THE chooser. `Candidates`: each qualifying window as @{ id; ancestors = @(ids of its
# ancestors) }. A window that contains another qualifying window is the same chooser seen from outside (a nested representation) and is
# dropped; exactly one remaining (innermost) window is the chooser: @{ index }. None: @{ none = $true }. Two or more distinct choosers:
# @{ ambiguous = $true } - the person decides; nothing is selected.
function Select-OmfChooser($Candidates) {
  $list = @($Candidates); $inner = @()
  for ($i = 0; $i -lt $list.Count; $i++) {
    $id = [string]$list[$i].id; $outer = $false
    for ($j = 0; $j -lt $list.Count; $j++) { if ($j -ne $i -and (@($list[$j].ancestors) | Where-Object { [string]$_ -eq $id }).Count) { $outer = $true; break } }
    if (-not $outer) { $inner += $i }
  }
  if ($inner.Count -eq 1) { return @{ index = $inner[0] } }
  if ($inner.Count -eq 0) { return @{ none = $true } }
  return @{ ambiguous = $true }
}
function ConvertTo-OmfSerial([string]$text) {
  $t = ([string]$text).Trim()
  if ($t -cmatch '^[0-9A-Fa-f]{2}([ :]?[0-9A-Fa-f]{2}){3,}$') { return ($t -replace '[ :]', '').ToUpperInvariant() }
  return $null
}
# GUARD - which chooser row to select. `Rows`: each row as @{ name = its accessible name; cells = @(the names of its cells) }. A row is the
# bank's when one of its cells (or its name) is exactly the issuer, or - the representation observed on the owner's PC, one row without
# separate cells (parent lead C2) - when its name contains the bank's public name. Exactly one such row must exist; other banks' rows are
# left alone (never a reason to stop). That row's certificate must be exactly one current-user certificate of the issuer (and of the
# row's serial when the row shows one), valid now, with a private key. Anything else is the person's choice in the same window:
# @{action='attention'; reason}. `Certificates`: issuerName (simple name), serial, notBefore, notAfter, hasPrivateKey - metadata only.
function Select-OmfBankCertificate($Rows, $Certificates, [string]$Issuer, [string]$BankName, [DateTime]$Now) {
  if (-not $Issuer) { return @{ action = 'attention'; reason = 'issuer' } }
  $rows = @($Rows); $matched = @()
  for ($i = 0; $i -lt $rows.Count; $i++) {
    $name = [string]$rows[$i].name; $cells = @($rows[$i].cells | Where-Object { $_ -ne $null })
    $exact = @(@($name) + $cells | Where-Object { ([string]$_).Trim() -ceq $Issuer }).Count -gt 0
    $named = $cells.Count -eq 0 -and $BankName -and $name.Contains($BankName)
    if ($exact -or $named) { $matched += $i }
  }
  if ($matched.Count -eq 0) { return @{ action = 'attention'; reason = 'missing' } }
  if ($matched.Count -gt 1) { return @{ action = 'attention'; reason = 'ambiguous' } }
  $row = $rows[$matched[0]]
  $tokens = @(@($row.cells) + @(([string]$row.name) -split '[\s,;|]+'))
  $serials = @($tokens | ForEach-Object { ConvertTo-OmfSerial $_ } | Where-Object { $_ } | Select-Object -Unique)
  if ($serials.Count -gt 1) { return @{ action = 'attention'; reason = 'ambiguous' } }
  $serial = if ($serials.Count -eq 1) { $serials[0] } else { $null }
  $store = @(@($Certificates) | Where-Object { $_ -and ([string]$_.issuerName) -ceq $Issuer -and (-not $serial -or ([string]$_.serial).ToUpperInvariant() -eq $serial) })
  if ($store.Count -eq 0) { return @{ action = 'attention'; reason = 'not-in-store' } }
  if ($store.Count -gt 1) { return @{ action = 'attention'; reason = 'ambiguous' } }
  $c = $store[0]
  if ($Now -lt ([DateTime]$c.notBefore) -or $Now -gt ([DateTime]$c.notAfter)) { return @{ action = 'attention'; reason = 'expired' } }
  if (-not $c.hasPrivateKey) { return @{ action = 'attention'; reason = 'no-private-key' } }
  return @{ action = 'select'; index = $matched[0] }
}


# A selectable native row has no row/cell or web-document ancestor before its native window.
function Test-OmfBankCertificateRow([string]$Kind, [bool]$Selectable, $AncestorKinds) {
  if (-not $Selectable -or @('ControlType.DataItem', 'ControlType.ListItem') -cnotcontains $Kind) { return $false }
  foreach ($omfAncestorKind in @($AncestorKinds)) {
    if (@('ControlType.Document', 'ControlType.DataItem', 'ControlType.ListItem') -ccontains $omfAncestorKind) { return $false }
    if ($omfAncestorKind -ceq 'ControlType.Window') { return $true }
  }
  return $false
}
