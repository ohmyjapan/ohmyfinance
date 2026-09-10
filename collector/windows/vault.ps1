param([ValidateSet('protect','unprotect')][string]$Mode)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$omfInputBytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
$omfEntropy = [Text.Encoding]::UTF8.GetBytes('OhMyFinance collector v1')
if ($Mode -eq 'protect') {
  $omfOutputBytes = [Security.Cryptography.ProtectedData]::Protect($omfInputBytes, $omfEntropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
} else {
  $omfOutputBytes = [Security.Cryptography.ProtectedData]::Unprotect($omfInputBytes, $omfEntropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
}
[Console]::Out.Write([Convert]::ToBase64String($omfOutputBytes))
