# collector/windows/key-broker.ps1 — the native key broker (plan omf-customer-credential-security-20261009 §2 site 1).
# One process per authorized batch, JSON lines over stdin/stdout, exactly the NCrypt configuration proven on this PC by
# synthetic-tpm-probe-v3: Microsoft Platform Crypto Provider, RSA-2048, Export Policy 0, Key Usage decrypt, UI policy
# force-high (3) — enrolment and the first decrypt of a batch are the Windows key-protection dialog; nothing here ever
# retries a refused or cancelled operation. The broker also OWNS the batch's browser processes through a job object with
# kill-on-close: when this process ends for any reason (end of batch, Windows lock/logoff/suspend, a crash of the
# collector that closes stdin, or its own crash) the owned Chrome processes are terminated by the kernel.
#   -Role key    opens the device key (enroll / open / unseal / inspect / destroy) and owns processes
#   -Role owner  owns processes only (the manual lane: no key, no provider)
#   -Role consent authenticates reset/re-pair with Windows Hello; no key operations or credential access
#   -SilentAuth  TEST HOOK (synthetic keys only, name prefix "OhMyFinance collector test-"): the probe's in-memory usage
#                authorization, silent finalize/decrypt — no dialog, no real key, never a wrong PIN
#   -Silent      every provider call with NCRYPT_SILENT_FLAG (the "separate process without authorization" leg)
# PowerShell variable names are case-insensitive: the provider NAME is $PROVIDER_NAME, its HANDLE $providerHandle.
param([ValidateSet('key', 'owner', 'consent')][string]$Role = 'key', [string]$SilentAuth = '', [switch]$Silent)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32;
[ComImport,Guid("39E050C3-4E74-441A-8DC0-B81104DF949C"),InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
public interface IOmfConsentVerifierInterop {
  [return:MarshalAs(UnmanagedType.IInspectable)]
  object RequestVerificationForWindowAsync(IntPtr window,[MarshalAs(UnmanagedType.HString)] string message,ref Guid iid);
}
public static class OmfKeyBroker {
  public static bool SupportsConsent(object factory) {return factory is IOmfConsentVerifierInterop;}
  public static object VerifyConsent(object factory,IntPtr window,string message,Guid iid) {
    return ((IOmfConsentVerifierInterop)factory).RequestVerificationForWindowAsync(window,message,ref iid);
  }
  public static volatile bool Interrupted;
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetUserObjectInformation(IntPtr obj, int index, System.Text.StringBuilder name, int length, out int needed);
  [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint thread);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("wtsapi32.dll", CharSet=CharSet.Unicode)] static extern bool WTSQuerySessionInformation(IntPtr server, int session, int info, out IntPtr buffer, out int bytes);
  [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr buffer);
  public static bool SessionAvailable() {
    if (Interrupted) return false;
    IntPtr state; int bytes;
    if (!WTSQuerySessionInformation(IntPtr.Zero, System.Diagnostics.Process.GetCurrentProcess().SessionId, 8, out state, out bytes)) return false;
    try { if (bytes < 4 || Marshal.ReadInt32(state) != 0) return false; } finally { WTSFreeMemory(state); }
    var desktop = OpenInputDesktop(0, false, 1); if (desktop == IntPtr.Zero) return false;
    try {
      var input = new System.Text.StringBuilder(256); var current = new System.Text.StringBuilder(256); int needed;
      return GetUserObjectInformation(desktop, 2, input, 512, out needed)
        && GetUserObjectInformation(GetThreadDesktop(GetCurrentThreadId()), 2, current, 512, out needed)
        && input.ToString() == current.ToString();
    } finally { CloseDesktop(desktop); }
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct UI { public int Version, Flags; [MarshalAs(UnmanagedType.LPWStr)] public string Title, Name, Description; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct OAEP { [MarshalAs(UnmanagedType.LPWStr)] public string Hash; public IntPtr Label; public int LabelLength; }
  [DllImport("ncrypt.dll", CharSet=CharSet.Unicode)] public static extern int NCryptOpenStorageProvider(out IntPtr p, string n, int f);
  [DllImport("ncrypt.dll", CharSet=CharSet.Unicode)] public static extern int NCryptCreatePersistedKey(IntPtr p, out IntPtr k, string a, string n, int s, int f);
  [DllImport("ncrypt.dll", CharSet=CharSet.Unicode)] public static extern int NCryptOpenKey(IntPtr p, out IntPtr k, string n, int s, int f);
  [DllImport("ncrypt.dll", CharSet=CharSet.Unicode)] public static extern int NCryptSetProperty(IntPtr k, string n, byte[] d, int l, int f);
  [DllImport("ncrypt.dll", CharSet=CharSet.Unicode)] public static extern int NCryptGetProperty(IntPtr k, string n, byte[] d, int l, out int r, int f);
  [DllImport("ncrypt.dll", EntryPoint="NCryptSetProperty", CharSet=CharSet.Unicode)] public static extern int SetUI(IntPtr k, string n, ref UI d, int l, int f);
  [DllImport("ncrypt.dll")] public static extern int NCryptFinalizeKey(IntPtr k, int f);
  [DllImport("ncrypt.dll")] public static extern int NCryptDecrypt(IntPtr k, byte[] i, int il, ref OAEP pad, byte[] o, int ol, out int r, int f);
  [DllImport("ncrypt.dll", CharSet=CharSet.Unicode)] public static extern int NCryptExportKey(IntPtr k, IntPtr e, string type, IntPtr parameters, byte[] o, int l, out int r, int f);
  [DllImport("ncrypt.dll")] public static extern int NCryptDeleteKey(IntPtr k, int f);
  [DllImport("ncrypt.dll")] public static extern int NCryptFreeObject(IntPtr k);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr CreateJobObject(IntPtr a, string name);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr j, int c, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION i, int l);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool IsProcessInJob(IntPtr p, IntPtr j, out bool r);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(int a, bool i, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct JOBOBJECT_BASIC_LIMIT_INFORMATION { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)] public struct IO_COUNTERS { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
  [StructLayout(LayoutKind.Sequential)] public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION { public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
  public static BlockingCollection<string> Queue = new BlockingCollection<string>();
  public const string Eof = "\u0001eof";
  public const string Locked = "\u0001locked:";
  public static void Start() {
    var reader = new Thread(() => { try { string line; while ((line = Console.In.ReadLine()) != null) Queue.Add(line); } catch { } Interrupted = true; Queue.Add(Eof); });
    reader.IsBackground = true; reader.Start();
    SystemEvents.SessionSwitch += (s, e) => { if (e.Reason == SessionSwitchReason.SessionLock || e.Reason == SessionSwitchReason.SessionLogoff || e.Reason == SessionSwitchReason.ConsoleDisconnect || e.Reason == SessionSwitchReason.RemoteDisconnect) {Interrupted = true; Queue.Add(Locked + e.Reason);} };
    SystemEvents.PowerModeChanged += (s, e) => { if (e.Mode == PowerModes.Suspend) {Interrupted = true; Queue.Add(Locked + "Suspend");} };
  }
  public static string Next() { return Queue.Take(); }
  public static IntPtr MakeJob() {
    var job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) return IntPtr.Zero;
    var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
    info.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if (!SetInformationJobObject(job, 9, ref info, Marshal.SizeOf(info))) { CloseHandle(job); return IntPtr.Zero; }
    return job;
  }
  // 0 = assigned, -1 = already in this job, otherwise the Win32 error.
  public static int Assign(IntPtr job, int pid) {
    var handle = OpenProcess(0x0001 | 0x0100 | 0x1000, false, pid);
    if (handle == IntPtr.Zero) return Marshal.GetLastWin32Error();
    try {
      bool inside;
      if (IsProcessInJob(handle, job, out inside) && inside) return -1;
      return AssignProcessToJobObject(job, handle) ? 0 : Marshal.GetLastWin32Error();
    } finally { CloseHandle(handle); }
  }
}
'@
$PROVIDER_NAME = 'Microsoft Platform Crypto Provider'
$NAME_RULE = '^OhMyFinance collector (test-)?[a-f0-9]{16}$'
$silentFlag = if ($Silent -or $SilentAuth) { 0x40 } else { 0 }
$padding = New-Object OmfKeyBroker+OAEP; $padding.Hash = 'SHA256'; $padding.Label = [IntPtr]::Zero; $padding.LabelLength = 0
$providerHandle = [IntPtr]::Zero; $keyHandle = [IntPtr]::Zero; $keyName = $null; $authBytes = $null
if ($SilentAuth) { $authBytes = [Convert]::FromBase64String($SilentAuth) }
function Hex([int]$status) { return ('0x{0:X8}' -f $status) }
function Reply($object) { [Console]::Out.WriteLine((ConvertTo-Json -InputObject $object -Compress -Depth 6)); [Console]::Out.Flush() }
function Classify([int]$status) {
  switch (Hex $status) {
    '0x80090016' { return 'missing' }
    '0x80090022' { return 'silent_refused' }
    '0x80090036' { return 'cancelled' }
    '0x8010006E' { return 'cancelled' }
    '0x800704C7' { return 'cancelled' }
    default { return 'failed' }
  }
}
function Fail($id, [int]$status, $message) { Reply ([ordered]@{ id = $id; ok = $false; code = (Classify $status); status = (Hex $status); error = $message }) }
function Open-Provider {
  if ($script:providerHandle -ne [IntPtr]::Zero) { return 0 }
  $opened = [IntPtr]::Zero
  $status = [OmfKeyBroker]::NCryptOpenStorageProvider([ref]$opened, $script:PROVIDER_NAME, 0)
  if ($status -eq 0) { $script:providerHandle = $opened }
  return $status
}
function Public-Key([IntPtr]$handle) {
  $size = 0
  $status = [OmfKeyBroker]::NCryptExportKey($handle, [IntPtr]::Zero, 'RSAPUBLICBLOB', [IntPtr]::Zero, $null, 0, [ref]$size, 0x40)
  if ($status -ne 0) { throw ('public key export failed ' + (Hex $status)) }
  $blob = New-Object byte[] $size
  $status = [OmfKeyBroker]::NCryptExportKey($handle, [IntPtr]::Zero, 'RSAPUBLICBLOB', [IntPtr]::Zero, $blob, $blob.Length, [ref]$size, 0x40)
  if ($status -ne 0) { throw ('public key export failed ' + (Hex $status)) }
  $exponentLength = [BitConverter]::ToInt32($blob, 8); $modulusLength = [BitConverter]::ToInt32($blob, 12)
  $exponent = New-Object byte[] $exponentLength; [Array]::Copy($blob, 24, $exponent, 0, $exponentLength)
  $modulus = New-Object byte[] $modulusLength; [Array]::Copy($blob, 24 + $exponentLength, $modulus, 0, $modulusLength)
  return [ordered]@{ modulus = [Convert]::ToBase64String($modulus); exponent = [Convert]::ToBase64String($exponent) }
}
function Key-Property([IntPtr]$handle, [string]$name) {
  $buffer = New-Object byte[] 4; $size = 0
  $status = [OmfKeyBroker]::NCryptGetProperty($handle, $name, $buffer, $buffer.Length, [ref]$size, 0x40)
  if ($status -eq 0 -and $size -eq 4) { return [BitConverter]::ToInt32($buffer, 0) }
  return $null
}
function Release-Key { if ($script:keyHandle -ne [IntPtr]::Zero) { [void][OmfKeyBroker]::NCryptFreeObject($script:keyHandle); $script:keyHandle = [IntPtr]::Zero; $script:keyName = $null } }
function Own-Tree([int]$rootPid) {
  $assigned = @(); $failed = @()
  for ($pass = 0; $pass -lt 2; $pass++) {
    $todo = New-Object 'System.Collections.Generic.Queue[int]'; $todo.Enqueue($rootPid); $seen = @{}
    while ($todo.Count -gt 0) {
      $current = $todo.Dequeue()
      if ($seen.ContainsKey($current)) { continue }
      $seen[$current] = $true
      $status = [OmfKeyBroker]::Assign($script:job, $current)
      if ($status -eq 0) { $assigned += $current } elseif ($status -ne -1) { $failed += [ordered]@{ pid = $current; error = $status } }
      foreach ($child in @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $current")) { $todo.Enqueue([int]$child.ProcessId) }
    }
  }
  return [ordered]@{ assigned = @($assigned | Sort-Object -Unique); failed = @($failed) }
}

# Win32 desktop interop, not the UWP RequestVerificationAsync API. Only metadata recovery uses this
# authentication result; bank decryption still requires the independent hardware-protected key.
# ABI: microsoft/win32metadata generation/WinSDK/RecompiledIdlHeaders/um/UserConsentVerifierInterop.idl
function Consent-Context {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $verifier = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType=WindowsRuntime]
  $factory = [Runtime.InteropServices.WindowsRuntime.WindowsRuntimeMarshal]::GetActivationFactory($verifier)
  if (-not [OmfKeyBroker]::SupportsConsent($factory)) { throw 'desktop authentication interface unavailable' }
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetGenericArguments().Count -eq 1 } | Select-Object -First 1
  $availableType = [Windows.Security.Credentials.UI.UserConsentVerifierAvailability, Windows.Security.Credentials.UI, ContentType=WindowsRuntime]
  $availableTask = $asTask.MakeGenericMethod($availableType).Invoke($null,@($verifier::CheckAvailabilityAsync()))
  if (-not $availableTask.Wait(10000)) { throw 'authentication availability timed out' }
  return @{ factory=$factory; asTask=$asTask; availability=[string]$availableTask.Result }
}
function Request-Consent([string]$action,[string]$origin) {
  if ($action -notin @('pair','reset')) { return @{ok=$false;code='invalid'} }
  $context=Consent-Context
  if ($context.availability -ne 'Available') { return @{ok=$false;code='unavailable';availability=$context.availability} }
  if ([OmfKeyBroker]::Interrupted) { return @{ok=$false;code='cancelled'} }
  $message='Reset OhMyFinance protection. Existing sealed logins will be moved aside; none will be decrypted.'
  if ($action -eq 'pair') {
    $target=[Uri]$origin
    if (-not $target.IsAbsoluteUri -or $target.Scheme -notin @('http','https') -or $target.UserInfo -or $origin -ne $target.GetLeftPart([UriPartial]::Authority)) { return @{ok=$false;code='invalid'} }
    $message='Change the OhMyFinance connection to '+$origin+'. Previous saved logins and statements remain bound to their original connection.'
  }
  Add-Type -AssemblyName System.Windows.Forms
  $window=New-Object Windows.Forms.Form
  $window.Text='OhMyFinance — local authentication';$window.Width=440;$window.Height=160
  $window.StartPosition='CenterScreen';$window.FormBorderStyle='FixedDialog';$window.MaximizeBox=$false;$window.MinimizeBox=$false
  $label=New-Object Windows.Forms.Label;$label.Text=$message+"`r`n`r`nComplete Windows authentication, or close this window to cancel.";$label.Dock='Fill';$label.Padding=New-Object Windows.Forms.Padding(12);$window.Controls.Add($label)
  $operation=$null
  try {
    $window.Show();$window.Activate();[Windows.Forms.Application]::DoEvents()
    $resultType=[Windows.Security.Credentials.UI.UserConsentVerificationResult,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]
    $operationType=[Windows.Foundation.IAsyncOperation`1,Windows.Foundation,ContentType=WindowsRuntime]
    $resultGuid=$operationType.MakeGenericType($resultType).GUID
    $operation=[OmfKeyBroker]::VerifyConsent($context.factory,$window.Handle,$message,$resultGuid)
    $task=$context.asTask.MakeGenericMethod($resultType).Invoke($null,@($operation))
    $deadline=[DateTime]::UtcNow.AddSeconds(280)
    while (-not $task.IsCompleted) {
      if ([OmfKeyBroker]::Interrupted -or $window.IsDisposed -or [DateTime]::UtcNow -gt $deadline) { return @{ok=$false;code='cancelled'} }
      [Windows.Forms.Application]::DoEvents();[Threading.Thread]::Sleep(25)
    }
    if ([OmfKeyBroker]::Interrupted -or $window.IsDisposed) { return @{ok=$false;code='cancelled'} }
    $result=[string]$task.GetAwaiter().GetResult()
    if ($result -eq 'Verified') { return @{ok=$true;action=$action} }
    return @{ok=$false;code=$(if($result -eq 'Canceled'){'cancelled'}else{'unavailable'});result=$result}
  } finally {
    if ($operation) { try { ([Windows.Foundation.IAsyncInfo,Windows.Foundation,ContentType=WindowsRuntime]$operation).Cancel() } catch {} }
    $window.Dispose()
  }
}

[OmfKeyBroker]::Start()
$job = [OmfKeyBroker]::MakeJob()
Reply ([ordered]@{ event = 'ready'; role = $Role; pid = $PID; job = ($job -ne [IntPtr]::Zero); silent = ($silentFlag -ne 0) })
try {
  while ($true) {
    $line = [OmfKeyBroker]::Next()
    if ($line -eq [OmfKeyBroker]::Eof) { break }
    if ($line.StartsWith([OmfKeyBroker]::Locked)) { Reply ([ordered]@{ event = 'locked'; reason = $line.Substring([OmfKeyBroker]::Locked.Length) }); break }
    $request = $null
    try { $request = $line | ConvertFrom-Json } catch { Reply ([ordered]@{ ok = $false; code = 'invalid'; error = 'invalid request' }); continue }
    $id = $request.id
    try {
      if ($Role -eq 'consent' -and $request.op -notin @('consent','consent-capability','end')) { Reply @{id=$id;ok=$false;code='role'};continue }
      switch ($request.op) {
        'available' { Reply @{id=$id;ok=$true;available=[OmfKeyBroker]::SessionAvailable()} }
        'consent-capability' {
          if ($Role -ne 'consent') { Reply @{id=$id;ok=$false;code='role'};break }
          $context=Consent-Context
          Reply @{id=$id;ok=$true;availability=$context.availability;available=($context.availability -eq 'Available')}
        }
        'consent' {
          if ($Role -ne 'consent') { Reply @{id=$id;ok=$false;code='role'};break }
          $consent=Request-Consent ([string]$request.action) ([string]$request.origin)
          $consent.id=$id;Reply $consent
        }
        'capability' {
          $status = Open-Provider
          if ($status -ne 0) { Reply ([ordered]@{ id = $id; ok = $false; code = 'no_provider'; status = (Hex $status); error = 'the platform key provider is not available' }); break }
          $implType = $null; $buffer = New-Object byte[] 4; $size = 0
          if ([OmfKeyBroker]::NCryptGetProperty($providerHandle, 'Impl Type', $buffer, 4, [ref]$size, 0x40) -eq 0 -and $size -eq 4) { $implType = [BitConverter]::ToInt32($buffer, 0) }
          Reply ([ordered]@{ id = $id; ok = $true; provider = $PROVIDER_NAME; implType = $implType; hardware = (($implType -ne $null) -and (($implType -band 1) -eq 1)) })
        }
        'enroll' {
          if ($Role -ne 'key') { Reply ([ordered]@{ id = $id; ok = $false; code = 'role'; error = 'the owner role has no key' }); break }
          $name = [string]$request.name
          if ($name -notmatch $NAME_RULE) { Reply ([ordered]@{ id = $id; ok = $false; code = 'name'; error = 'invalid key name' }); break }
          if ($SilentAuth -and $name -notmatch 'collector test-') { Reply ([ordered]@{ id = $id; ok = $false; code = 'name'; error = 'silent authorization is for synthetic test keys only' }); break }
          $status = Open-Provider
          if ($status -ne 0) { Reply ([ordered]@{ id = $id; ok = $false; code = 'no_provider'; status = (Hex $status); error = 'the platform key provider is not available' }); break }
          Release-Key
          $created = [IntPtr]::Zero
          $status = [OmfKeyBroker]::NCryptCreatePersistedKey($providerHandle, [ref]$created, 'RSA', $name, 0, $silentFlag)
          if ($status -ne 0) { Fail $id $status 'the key could not be created'; break }
          $finalized = $false
          try {
            foreach ($setting in @(@('Length', 2048), @('Export Policy', 0), @('Key Usage', 1))) {
              $bytes = [BitConverter]::GetBytes([int]$setting[1])
              $status = [OmfKeyBroker]::NCryptSetProperty($created, [string]$setting[0], $bytes, $bytes.Length, 0)
              if ($status -ne 0) { throw ('property ' + $setting[0] + ' refused ' + (Hex $status)) }
            }
            $ui = New-Object OmfKeyBroker+UI; $ui.Version = 1; $ui.Flags = 3; $ui.Title = 'OhMyFinance collector'; $ui.Name = 'OhMyFinance bank login protection'; $ui.Description = 'Unlock one statement batch'
            $status = [OmfKeyBroker]::SetUI($created, 'UI Policy', [ref]$ui, [Runtime.InteropServices.Marshal]::SizeOf($ui), 0)
            if ($status -ne 0) { throw ('UI policy refused ' + (Hex $status)) }
            if ($authBytes) { $status = [OmfKeyBroker]::NCryptSetProperty($created, 'PCP_USAGEAUTH', $authBytes, $authBytes.Length, 0); if ($status -ne 0) { throw ('usage authorization refused ' + (Hex $status)) } }
            $status = [OmfKeyBroker]::NCryptFinalizeKey($created, $silentFlag)
            if ($status -ne 0) { Fail $id $status 'enrolment was not completed'; break }
            $finalized = $true
            $script:keyHandle = $created; $script:keyName = $name
            Reply ([ordered]@{ id = $id; ok = $true; publicKey = (Public-Key $created); provider = $PROVIDER_NAME; exportPolicy = (Key-Property $created 'Export Policy'); name = $name })
          } finally { if (-not $finalized -and $created -ne [IntPtr]::Zero) { [void][OmfKeyBroker]::NCryptFreeObject($created) } }
        }
        'open' {
          if ($Role -ne 'key') { Reply ([ordered]@{ id = $id; ok = $false; code = 'role'; error = 'the owner role has no key' }); break }
          $name = [string]$request.name
          if ($name -notmatch $NAME_RULE) { Reply ([ordered]@{ id = $id; ok = $false; code = 'name'; error = 'invalid key name' }); break }
          if ($SilentAuth -and $name -notmatch 'collector test-') { Reply ([ordered]@{ id = $id; ok = $false; code = 'name'; error = 'silent authorization is for synthetic test keys only' }); break }
          $status = Open-Provider
          if ($status -ne 0) { Reply ([ordered]@{ id = $id; ok = $false; code = 'no_provider'; status = (Hex $status); error = 'the platform key provider is not available' }); break }
          Release-Key
          $opened = [IntPtr]::Zero
          $status = [OmfKeyBroker]::NCryptOpenKey($providerHandle, [ref]$opened, $name, 0, $silentFlag)
          if ($status -ne 0) { Fail $id $status 'the key could not be opened'; break }
          if ($authBytes) { [void][OmfKeyBroker]::NCryptSetProperty($opened, 'PCP_USAGEAUTH', $authBytes, $authBytes.Length, 0) }
          $script:keyHandle = $opened; $script:keyName = $name
          Reply ([ordered]@{ id = $id; ok = $true; publicKey = (Public-Key $opened); provider = $PROVIDER_NAME; exportPolicy = (Key-Property $opened 'Export Policy'); name = $name })
        }
        'unseal' {
          if ($keyHandle -eq [IntPtr]::Zero) { Reply ([ordered]@{ id = $id; ok = $false; code = 'no_key'; error = 'open or enroll first' }); break }
          $cipher = [Convert]::FromBase64String([string]$request.wrapped)
          $plain = New-Object byte[] 256; $size = 0
          $status = [OmfKeyBroker]::NCryptDecrypt($keyHandle, $cipher, $cipher.Length, [ref]$padding, $plain, $plain.Length, [ref]$size, (0x4 -bor $silentFlag))
          if ($status -ne 0) { [Array]::Clear($plain, 0, $plain.Length); Fail $id $status 'the device key did not release the data key'; break }
          $out = New-Object byte[] $size; [Array]::Copy($plain, 0, $out, 0, $size)
          Reply ([ordered]@{ id = $id; ok = $true; key = [Convert]::ToBase64String($out) })
          [Array]::Clear($plain, 0, $plain.Length); [Array]::Clear($out, 0, $out.Length)
        }
        'inspect' {
          if ($keyHandle -eq [IntPtr]::Zero) { Reply ([ordered]@{ id = $id; ok = $false; code = 'no_key'; error = 'open or enroll first' }); break }
          Reply ([ordered]@{ id = $id; ok = $true; publicKey = (Public-Key $keyHandle); provider = $PROVIDER_NAME; exportPolicy = (Key-Property $keyHandle 'Export Policy'); keyUsage = (Key-Property $keyHandle 'Key Usage'); name = $keyName })
        }
        'probe-export' {
          if ($keyHandle -eq [IntPtr]::Zero -or $keyName -notmatch 'collector test-') { Reply ([ordered]@{ id = $id; ok = $false; code = 'name'; error = 'export probes run on synthetic test keys only' }); break }
          $size = 0
          $status = [OmfKeyBroker]::NCryptExportKey($keyHandle, [IntPtr]::Zero, 'RSAPRIVATEBLOB', [IntPtr]::Zero, $null, 0, [ref]$size, 0x40)
          Reply ([ordered]@{ id = $id; ok = $true; status = (Hex $status); exportAllowed = ($status -eq 0) })
        }
        'destroy' {
          if ($Role -ne 'key') { Reply ([ordered]@{ id = $id; ok = $false; code = 'role'; error = 'the owner role has no key' }); break }
          $name = [string]$request.name
          if ($name -notmatch $NAME_RULE) { Reply ([ordered]@{ id = $id; ok = $false; code = 'name'; error = 'invalid key name' }); break }
          $status = Open-Provider
          if ($status -ne 0) { Reply ([ordered]@{ id = $id; ok = $false; code = 'no_provider'; status = (Hex $status); error = 'the platform key provider is not available' }); break }
          if ($keyHandle -ne [IntPtr]::Zero -and $keyName -ne $name) { Release-Key }
          if ($keyHandle -eq [IntPtr]::Zero) {
            $opened = [IntPtr]::Zero
            $status = [OmfKeyBroker]::NCryptOpenKey($providerHandle, [ref]$opened, $name, 0, $silentFlag)
            if ($status -ne 0) { Fail $id $status 'the key could not be opened'; break }
            $script:keyHandle = $opened; $script:keyName = $name
          }
          # The platform provider on the target PC rejects SILENT for deletion. Only synthetic test cleanup uses
          # the proven flags-zero path; this does not change the real key's silent/unattended behavior.
          $deleteFlags = if ($name -match '^OhMyFinance collector test-') { 0 } else { $silentFlag }
          $status = [OmfKeyBroker]::NCryptDeleteKey($keyHandle, $deleteFlags)
          if ($status -eq 0) { $script:keyHandle = [IntPtr]::Zero; $script:keyName = $null; Reply ([ordered]@{ id = $id; ok = $true }) } else { Fail $id $status 'the key could not be deleted' }
        }
        'own' {
          if ($job -eq [IntPtr]::Zero) { Reply ([ordered]@{ id = $id; ok = $false; code = 'no_job'; error = 'the job object is not available' }); break }
          $target = [int]$request.pid
          if ($target -le 0 -or $target -eq $PID) { Reply ([ordered]@{ id = $id; ok = $false; code = 'pid'; error = 'invalid process id' }); break }
          $tree = Own-Tree $target
          $rootFailed = @($tree.failed | Where-Object { $_.pid -eq $target })
          Reply ([ordered]@{ id = $id; ok = ($rootFailed.Count -eq 0); owned = ($rootFailed.Count -eq 0); assigned = $tree.assigned; failed = $tree.failed; code = $(if ($rootFailed.Count -eq 0) { $null } else { 'own_failed' }) })
        }
        'end' { Reply ([ordered]@{ id = $id; ok = $true }); break }
        default { Reply ([ordered]@{ id = $id; ok = $false; code = 'unknown_op'; error = 'unknown operation' }) }
      }
      if ($request.op -eq 'end') { break }
    } catch {
      Reply ([ordered]@{ id = $id; ok = $false; code = 'failed'; error = $_.Exception.Message })
    }
  }
} finally {
  Release-Key
  if ($providerHandle -ne [IntPtr]::Zero) { [void][OmfKeyBroker]::NCryptFreeObject($providerHandle); $providerHandle = [IntPtr]::Zero }
  if ($authBytes) { [Array]::Clear($authBytes, 0, $authBytes.Length) }
  if ($job -ne [IntPtr]::Zero) { [void][OmfKeyBroker]::CloseHandle($job) }
}
