# collector/windows/private-acl.ps1 — the protected DACL of the collector's private directory
# (plan omf-customer-credential-security-20261009 §2 site 3). Node's mode 0o600 does nothing on Windows
# (file-permissions.json: an extra local group inherited ReadAndExecute on the real vault). This script
# turns inheritance off on the root and grants exactly the owning user and SYSTEM, (OI)(CI), so every
# file and folder created or replaced below (secrets/, staging-*/, outbox/, .new temporaries) inherits
# only those; it then verifies by reading the root ACL back and the ACL of one file it creates.
# -VerifyOnly reads ACLs and creates/removes a private probe; it does not repair grants.
# It also reports whether this process runs elevated (token integrity level >= High).
param([Parameter(Mandatory = $true)][string]$Root, [switch]$VerifyOnly, [switch]$HoldLock, [int]$OwnerPid, [string]$LeaseId)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
if ($HoldLock) {
  # FileShare.None is the lock. The JSON is diagnostic only; no PID/staleness guess can steal a live handle.
  # stdin belongs only to the collector. Explicit release closes both handles; parent process death closes its
  # duplicate. Unexpected helper death deliberately leaves the parent's handle held until collector restart.
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class OmfLeasePath {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern uint GetFinalPathNameByHandle(IntPtr handle, StringBuilder path, uint count, uint flags);
  [DllImport("kernel32.dll")] public static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint access, bool inherit, uint options);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
}
'@
  $leasePath = Join-Path ([IO.Path]::GetFullPath($Root)) 'vault.lock'
  $leaseStream = $null
  $ownerProcess = [IntPtr]::Zero
  $parentHandle = [IntPtr]::Zero
  $releaseParent = $false
  $readySent = $false
  $releaseFailed = $false
  try {
    if ($OwnerPid -le 0 -or $OwnerPid -eq $PID -or $LeaseId -notmatch '^[a-f0-9]{32}$') { throw 'Invalid lease owner' }
    if (([IO.File]::GetAttributes($Root) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'The private directory is a reparse point' }
    if ([IO.File]::Exists($leasePath) -and (([IO.File]::GetAttributes($leasePath) -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw 'The vault lock is a reparse point' }
    try { $leaseStream = [IO.File]::Open($leasePath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
    catch [IO.IOException] {
      [Console]::Out.WriteLine('{"event":"busy"}')
      [Console]::Out.Flush()
      exit 2
    }
    $resolved = New-Object Text.StringBuilder(32768)
    $length = [OmfLeasePath]::GetFinalPathNameByHandle($leaseStream.SafeFileHandle.DangerousGetHandle(), $resolved, $resolved.Capacity, 0)
    if ($length -eq 0 -or $length -ge $resolved.Capacity) { throw 'The vault lock path could not be verified' }
    $resolvedPath = $resolved.ToString() -replace '^\\\\\?\\', ''
    if (-not [string]::Equals($resolvedPath, $leasePath, [StringComparison]::OrdinalIgnoreCase)) { throw 'The vault lock resolves elsewhere' }
    # The collector also owns a non-inheritable duplicate. A killed helper cannot release the lock early.
    $ownerProcess = [OmfLeasePath]::OpenProcess(0x40, $false, $OwnerPid)
    if ($ownerProcess -eq [IntPtr]::Zero) { throw 'The lease owner could not be opened' }
    if (-not [OmfLeasePath]::DuplicateHandle([OmfLeasePath]::GetCurrentProcess(), $leaseStream.SafeFileHandle.DangerousGetHandle(), $ownerProcess, [ref]$parentHandle, 0, $false, 2)) { throw 'The lease could not be bound to its owner' }
    $bytes = [Text.Encoding]::UTF8.GetBytes((@{ pid = $OwnerPid; helperPid = $PID; lease = $LeaseId; at = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Compress))
    $leaseStream.SetLength(0)
    $leaseStream.Write($bytes, 0, $bytes.Length)
    $leaseStream.Flush()
    [Console]::Out.WriteLine('{"event":"ready"}')
    [Console]::Out.Flush()
    $readySent = $true
    $releaseParent = ([Console]::In.ReadLine() -ceq ('release:' + $LeaseId))
  } catch {
    [Console]::Out.WriteLine('{"event":"failed"}')
    [Console]::Out.Flush()
    exit 1
  } finally {
    if (-not $readySent) { $releaseParent = $true }
    if ($leaseStream) {
      $leaseStream.Dispose()
      if ($releaseParent -and $parentHandle -ne [IntPtr]::Zero) {
        $localCopy = [IntPtr]::Zero
        if ([OmfLeasePath]::DuplicateHandle($ownerProcess, $parentHandle, [OmfLeasePath]::GetCurrentProcess(), [ref]$localCopy, 0, $false, 3)) { [void][OmfLeasePath]::CloseHandle($localCopy) }
        else { $releaseFailed = $true }
      }
    }
    if ($ownerProcess -ne [IntPtr]::Zero) { [void][OmfLeasePath]::CloseHandle($ownerProcess) }
    # A successor holding FileShare.None prevents this deletion. A stale file is harmless; handles are authoritative.
    if ($leaseStream) { try { [IO.File]::Delete($leasePath) } catch { } }
  }
  if ($releaseFailed) { exit 1 }
  exit 0
}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OmfToken {
  [DllImport("kernel32.dll")] public static extern IntPtr GetCurrentProcess();
  [DllImport("advapi32.dll", SetLastError=true)] public static extern bool OpenProcessToken(IntPtr h, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError=true)] public static extern bool GetTokenInformation(IntPtr token, int cls, IntPtr info, uint len, out uint ret);
  [DllImport("advapi32.dll")] public static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
  [DllImport("advapi32.dll")] public static extern IntPtr GetSidSubAuthority(IntPtr sid, uint index);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  public static int IntegrityLevel() {
    IntPtr token;
    if (!OpenProcessToken(GetCurrentProcess(), 0x0008, out token)) return -1;
    try {
      uint size;
      GetTokenInformation(token, 25, IntPtr.Zero, 0, out size);
      IntPtr buffer = Marshal.AllocHGlobal((int)size);
      try {
        if (!GetTokenInformation(token, 25, buffer, size, out size)) return -1;
        IntPtr sid = Marshal.ReadIntPtr(buffer);
        int count = Marshal.ReadByte(GetSidSubAuthorityCount(sid));
        return Marshal.ReadInt32(GetSidSubAuthority(sid, (uint)(count - 1)));
      } finally { Marshal.FreeHGlobal(buffer); }
    } finally { CloseHandle(token); }
  }
}
'@
$result = [ordered]@{ root = $Root; protected = $false; verified = $false; applied = $false; identities = @(); user = $null; elevated = $null; integrity = $null; probe = $false; checkedPaths = 0; error = $null }
$SYSTEM = 'S-1-5-18'
function Sid($rule) { try { return $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { return [string]$rule.IdentityReference } }
function Assert-Plain($item) {
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $result['code'] = 'reparse'; throw 'A private data path is a reparse point; permissions were not verified' }
}
function Private-Rules($security, [bool]$isDirectory) {
  $rules = @($security.Access)
  $owner = $security.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if ($owner -ne $user.Value -and $owner -ne $SYSTEM) { return $false }
  if (@($rules | Where-Object { (Sid $_) -ne $user.Value -and (Sid $_) -ne $SYSTEM }).Count -gt 0) { return $false }
  if (@($rules | Where-Object { $_.AccessControlType -ne 'Allow' }).Count -gt 0) { return $false }
  foreach ($requiredSid in @($user.Value, $SYSTEM)) {
    $grants = @($rules | Where-Object { (Sid $_) -eq $requiredSid -and (($_.FileSystemRights -band $full) -eq $full) -and (-not $isDirectory -or $_.InheritanceFlags -eq $inherit) })
    if ($grants.Count -eq 0) { return $false }
  }
  return $true
}
function Private-Children {
  $pending = New-Object 'System.Collections.Generic.Queue[System.IO.FileSystemInfo]'
  foreach ($item in (New-Object IO.DirectoryInfo($Root)).GetFileSystemInfos()) { $pending.Enqueue($item) }
  while ($pending.Count -gt 0) {
    $item = $pending.Dequeue()
    Assert-Plain $item
    $item
    if ($item -is [IO.DirectoryInfo]) {
      if ($item.FullName -eq (Join-Path $Root 'profiles')) {
        # Retained real profiles are not opened, deleted or individually rewritten. New sessions use this root only.
        $ephemeral = Join-Path $item.FullName 'ephemeral'
        if (Test-Path -LiteralPath $ephemeral) { $pending.Enqueue((Get-Item -LiteralPath $ephemeral -Force)) }
      } elseif ($item.FullName -ne (Join-Path $Root 'profiles\ephemeral')) {
        foreach ($child in $item.GetFileSystemInfos()) { $pending.Enqueue($child) }
      }
    }
  }
}
try {
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $result.user = $user.Value
  $integrity = [OmfToken]::IntegrityLevel()
  $result.integrity = $integrity
  $result.elevated = ($integrity -ge 12288)
  if (-not (Test-Path -LiteralPath $Root -PathType Container)) { throw 'the private directory does not exist' }
  Assert-Plain (Get-Item -LiteralPath $Root -Force)
  $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
  $none = [Security.AccessControl.PropagationFlags]::None
  $full = [Security.AccessControl.FileSystemRights]::FullControl
  if (-not $VerifyOnly) {
    $acl = Get-Acl -LiteralPath $Root
    $acl.SetAccessRuleProtection($true, $false)
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @($user.Value, $SYSTEM)) { $acl.SetOwner($user) }
    foreach ($rule in @($acl.Access | Where-Object { -not $_.IsInherited })) { [void]$acl.RemoveAccessRule($rule) }
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($user, $full, $inherit, $none, 'Allow')))
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($SYSTEM)), $full, $inherit, $none, 'Allow')))
    # Apply only the modified access/owner sections. Set-Acl can request SeSecurityPrivilege when
    # rewriting an already-protected root, preventing a normal-user collector from restarting.
    (Get-Item -LiteralPath $Root -Force).SetAccessControl($acl)
    $result.applied = $true
  }
  $current = Get-Acl -LiteralPath $Root
  $rules = @($current.Access)
  $result.protected = [bool]$current.AreAccessRulesProtected
  $sids = @($rules | ForEach-Object { Sid $_ })
  $result.identities = @($sids | Sort-Object -Unique)
  $foreign = @($sids | Where-Object { $_ -ne $user.Value -and $_ -ne $SYSTEM })
  $userFull = @($rules | Where-Object { (Sid $_) -eq $user.Value -and $_.AccessControlType -eq 'Allow' -and (($_.FileSystemRights -band $full) -eq $full) -and $_.InheritanceFlags -eq $inherit })
  $systemFull = @($rules | Where-Object { (Sid $_) -eq $SYSTEM -and $_.AccessControlType -eq 'Allow' -and (($_.FileSystemRights -band $full) -eq $full) -and $_.InheritanceFlags -eq $inherit })
  foreach ($item in @(Private-Children)) {
    $childAcl = Get-Acl -LiteralPath $item.FullName
    if (-not (Private-Rules $childAcl ($item -is [IO.DirectoryInfo]))) {
      if ($VerifyOnly) { throw 'An existing private data file has unverified permissions' }
      $childAcl.SetAccessRuleProtection($false, $false)
      if ($childAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @($user.Value, $SYSTEM)) { $childAcl.SetOwner($user) }
      foreach ($rule in @($childAcl.Access | Where-Object { -not $_.IsInherited })) { [void]$childAcl.RemoveAccessRuleSpecific($rule) }
      $item.SetAccessControl($childAcl)
      $childAcl = Get-Acl -LiteralPath $item.FullName
      if (-not (Private-Rules $childAcl ($item -is [IO.DirectoryInfo]))) { throw 'Private file permissions could not be repaired' }
    }
    $result.checkedPaths += 1
  }
  $probe = Join-Path $Root ('.acl-probe-' + [Guid]::NewGuid().ToString('N'))
  [IO.File]::WriteAllBytes($probe, [byte[]]@())
  try {
    $probeAcl = Get-Acl -LiteralPath $probe
    $probeRules = @($probeAcl.Access)
    $probeSids = @($probeRules | ForEach-Object { Sid $_ })
    $result.probe = ($probeRules.Count -gt 0) -and (@($probeRules | Where-Object { -not $_.IsInherited }).Count -eq 0) -and (@($probeSids | Where-Object { $_ -ne $user.Value -and $_ -ne $SYSTEM }).Count -eq 0)
  } finally { Remove-Item -LiteralPath $probe -Force }
  $result.verified = ($integrity -ge 0) -and $result.protected -and (Private-Rules $current $true) -and ($foreign.Count -eq 0) -and ($userFull.Count -gt 0) -and ($systemFull.Count -gt 0) -and $result.probe
} catch {
  $result.error = $_.Exception.Message
  $result.verified = $false
}
ConvertTo-Json -InputObject $result -Compress -Depth 4
