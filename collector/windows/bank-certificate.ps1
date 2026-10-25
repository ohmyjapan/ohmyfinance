param([int]$ProcessId, [int]$ParentId, [string]$ProfilePath, [string]$ChromePath, [string]$NotBefore, [string]$Issuer, [string]$BankName, [int]$TimeoutMs = 20000)
# The bank certificate chooser helper (plan omf-ikeda-collector-20261025): answers Chrome's client-certificate chooser of exactly the
# owned Chrome this collector launched, with UI Automation select/invoke only (no mouse, keyboard, SendInput, registry, browser policy,
# certificate install/export or key access). It first proves the process identity (bank-certificate-policy.ps1 Test-OmfBankProcess), then
# looks only at that process's windows for ONE chooser (Select-OmfChooser) whose row is the bank's (Select-OmfBankCertificate); the
# current-user certificate store is read (metadata only: issuer name, serial, validity, whether a private key exists) only once such a
# chooser is shown. Exactly one valid matching certificate is selected and the chooser's OK is invoked after the process identity is
# checked again; anything else leaves the chooser for the person in the same window. Output: one value-free JSON line {outcome, reason} -
# never a subject, serial or path. ASCII only (Windows PowerShell 5.1 reads a BOM-less script in the ANSI code page).
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'bank-certificate-policy.ps1')
function Out-OmfResult($value) { ConvertTo-Json -InputObject $value -Compress; exit 0 }
function Get-OmfObserved {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId"
  if (-not $p) { return $null }
  $owner = $null; try { $o = Invoke-CimMethod -InputObject $p -MethodName GetOwner; if ($o.ReturnValue -eq 0) { $owner = "$($o.Domain)\$($o.User)" } } catch { $owner = $null }
  return @{ pid = $p.ProcessId; parentPid = $p.ParentProcessId; commandLine = $p.CommandLine; executable = $p.ExecutablePath; created = $p.CreationDate; user = $owner; session = $p.SessionId }
}
try {
  $expected = @{ pid = $ProcessId; parentPid = $ParentId; profile = (ConvertTo-OmfPath $ProfilePath); executable = (ConvertTo-OmfPath $ChromePath); notBefore = [DateTime]::Parse($NotBefore, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind); user = [Security.Principal.WindowsIdentity]::GetCurrent().Name; session = (Get-Process -Id $PID).SessionId }
  $first = Get-OmfObserved
  $check = Test-OmfBankProcess $expected $first
  if (-not $check.ok) { Out-OmfResult @{ outcome = 'attention'; reason = 'process'; detail = $check.reason } }
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
  $A = [Windows.Automation.AutomationElement]; $T = [Windows.Automation.TreeScope]; $C = [Windows.Automation.ControlType]
  $byPid = New-Object Windows.Automation.PropertyCondition($A::ProcessIdProperty, $ProcessId)
  $rowsCondition = New-Object Windows.Automation.OrCondition((New-Object Windows.Automation.PropertyCondition($A::ControlTypeProperty, $C::DataItem)), (New-Object Windows.Automation.PropertyCondition($A::ControlTypeProperty, $C::ListItem)))
  $buttons = New-Object Windows.Automation.PropertyCondition($A::ControlTypeProperty, $C::Button)
  $windows = New-Object Windows.Automation.PropertyCondition($A::ControlTypeProperty, $C::Window)
  $walker = [Windows.Automation.TreeWalker]::ControlViewWalker
  $okNames = Get-OmfOkNames
  function Get-OmfId($element) { return (@($element.GetRuntimeId()) -join '.') }
  function Get-OmfAncestors($element) { $ids = @(); $e = $walker.GetParent($element); for ($i = 0; $e -and $i -lt 80; $i++) { $ids += (Get-OmfId $e); $e = $walker.GetParent($e) }; return , $ids }
  function Test-OmfWebContent($element) { $e = $walker.GetParent($element); for ($i = 0; $e -and $i -lt 80; $i++) { if ($e.Current.ControlType -eq $C::Document) { return $true }; $e = $walker.GetParent($e) }; return $false }
  function Get-OmfRow($row) { $cells = @(); foreach ($cell in $row.FindAll($T::Children, [Windows.Automation.Condition]::TrueCondition)) { if ($cell.Current.Name) { $cells += $cell.Current.Name.Trim() } }; return @{ name = [string]$row.Current.Name; cells = $cells } }
  # Every window of the owned process (top level or nested) holding native rows (not page content), one of them the bank's, and exactly
  # one enabled OK button; then the one innermost such window (Select-OmfChooser), or null / ambiguity.
  function Find-OmfChooser {
    $found = @()
    foreach ($top in $A::RootElement.FindAll($T::Children, $byPid)) {
      foreach ($w in @($top) + @($top.FindAll($T::Descendants, $windows))) {
        $rows = @($w.FindAll($T::Descendants, $rowsCondition) | Where-Object { -not (Test-OmfWebContent $_) })
        if (-not $rows.Count) { continue }
        $data = @($rows | ForEach-Object { Get-OmfRow $_ })
        $bank = @($data | Where-Object { $d = $_; (@(@($d.name) + @($d.cells) | Where-Object { ([string]$_).Trim() -ceq $Issuer }).Count) -or (-not @($d.cells).Count -and $BankName -and ([string]$d.name).Contains($BankName)) })
        if (-not $bank.Count) { continue }
        $ok = @($w.FindAll($T::Descendants, $buttons) | Where-Object { $okNames -ccontains $_.Current.Name.Trim() -and $_.Current.IsEnabled -and -not (Test-OmfWebContent $_) })
        if ($ok.Count -ne 1) { continue }
        $found += @{ window = $w; rows = $rows; data = $data; ok = $ok[0]; id = (Get-OmfId $w); ancestors = (Get-OmfAncestors $w) }
      }
    }
    $choice = Select-OmfChooser @($found | ForEach-Object { @{ id = $_.id; ancestors = $_.ancestors } })
    if ($choice.ambiguous) { return @{ ambiguous = $true } }
    if ($choice.none) { return $null }
    return $found[$choice.index]
  }
  $deadline = [DateTime]::UtcNow.AddMilliseconds([Math]::Max(1000, $TimeoutMs))
  while ([DateTime]::UtcNow -lt $deadline) {
    $chooser = Find-OmfChooser
    if ($chooser -and $chooser.ambiguous) { Out-OmfResult @{ outcome = 'attention'; reason = 'ambiguous-chooser' } }
    if ($chooser) {
      $store = @(Get-ChildItem Cert:\CurrentUser\My | ForEach-Object { @{ issuerName = $_.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $true); serial = $_.SerialNumber; notBefore = $_.NotBefore; notAfter = $_.NotAfter; hasPrivateKey = $_.HasPrivateKey } })
      $decision = Select-OmfBankCertificate $chooser.data $store $Issuer $BankName (Get-Date)
      if ($decision.action -ne 'select') { Out-OmfResult @{ outcome = 'attention'; reason = $decision.reason } }
      $now = Get-OmfObserved; $again = Test-OmfBankProcess $expected $now
      if (-not $again.ok -or -not $first.created -or ([DateTime]$now.created) -ne ([DateTime]$first.created)) { Out-OmfResult @{ outcome = 'attention'; reason = 'process'; detail = 'changed' } }
      $row = $chooser.rows[$decision.index]
      $row.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern).Select()
      Start-Sleep -Milliseconds 150
      if (-not $row.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected) { Out-OmfResult @{ outcome = 'attention'; reason = 'not-selected' } }
      $chooser.ok.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
      Out-OmfResult @{ outcome = 'selected' }
    }
    Start-Sleep -Milliseconds 250
  }
  Out-OmfResult @{ outcome = 'no-dialog' }
} catch { Out-OmfResult @{ outcome = 'attention'; reason = 'helper-error' } }
