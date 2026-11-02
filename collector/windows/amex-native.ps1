# collector/windows/amex-native.ps1 -- the Amex statement browser of the Windows downloader (case omf-amex-native-runtime-01).
# Amex refused the login request of Chrome started in automation mode (--enable-automation, and a DevTools pipe maps to the same
# AutomationControlled state); stock Chrome started without them was answered. This helper therefore starts installed stock Chrome with
# no DevTools connection, no automation switch, extension, property override, sandbox or security change, and reads and drives the Amex
# page only through Windows UI Automation patterns. collector/amex-native.mjs owns it; JSON lines on stdin/stdout.
#  - Ownership: Node starts this process, the batch's key broker assigns it to its kill-on-close job (index.mjs ownBrowser), and only then
#    sends `launch`. Chrome is created SUSPENDED, assigned to this helper's own kill-on-close job (no breakaway; nested under the broker's)
#    and resumed. The helper refuses `launch` outside a job. Its end, the broker's end or a crash of either ends Chrome through the kernel.
#  - Mode, fixed at start: `private` -- a new desktop that is never the input desktop and never switched to (nothing appears on the person's
#    screen; the routine download); `input` -- the person's own desktop, for a download the person asked to attend. No foreground, focus,
#    global input or desktop-switch call is made in either mode.
#  - Every read and action re-verifies the locked window (the one visible Chrome window of the launched browser process inside the job),
#    exactly one top-level document, its origin (and path) from the policy below, and that no other owned window hosts a web document. Reads
#    and actions are scoped to that main document (elements inside frames are excluded) and act on exactly one target. Operations are
#    fixed: there is no general evaluate, URL, action, shell or argument channel.
#  - Login values and codes arrive only inside request lines on stdin and are passed to ValuePattern.SetValue; they are never echoed,
#    written to stderr, put in an argument or kept. Replies carry fixed codes, booleans, counts, the statement-snapshot shape and, for
#    the login state, the fields collector/login.mjs ensureLogin reads.
#  - The recent activity (case omf-amex-recent-activity-20261102) adds fixed operations only: the statement page's own link to RecentPath, and the statement page's read and one-shot download
#    controls held to RecentPath. Each operation's name fixes its page; no request field names a page, an address or a target.
param(
  [Parameter(Mandatory = $true)][string]$Chrome,
  [Parameter(Mandatory = $true)][string]$ProfileDir,
  [Parameter(Mandatory = $true)][string]$Downloads,
  [Parameter(Mandatory = $true)][ValidateSet('private', 'input')][string]$Mode
)
$ErrorActionPreference = 'Stop'
# The target policy: the page Chrome opens and the two origins every read and action is held to; Report/Accept translate the URLs this
# helper reports and receives (identity here). The customer package stages and signs exactly this block. A test copy replaces only the
# lines between the two policy markers with a loopback policy (scripts/zoomer-fixtures/omf-amex-native.mjs); nothing at run time can.
# policy:begin
$policy = @'
public static class OmfAmexNativePolicy {
 public const string Login = "https://www.americanexpress.com/ja-jp/account/login?inav=iNavLnkLog";
 public const string Www = "https://www.americanexpress.com";
 public const string Global = "https://global.americanexpress.com";
 public const string Isolation = "";
 public static string Report(string url) { return url; }
 public static string Accept(string url) { return url; }
}
'@
# policy:end
$core = @'
using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;

public static class OmfAmexNative {
 [StructLayout(LayoutKind.Sequential)] public struct SA { public int length; public IntPtr descriptor; public int inherit; }
 [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct SI { public int cb; public string reserved; public string desktop; public string title; public int x, y, xSize, ySize, xCount, yCount, fill, flags; public short show, reserved2; public IntPtr reservedBytes, input, output, error; }
 [StructLayout(LayoutKind.Sequential)] public struct PI { public IntPtr process, thread; public uint pid, tid; }
 [StructLayout(LayoutKind.Sequential)] public struct BasicLimits { public long processTime, jobTime; public uint flags; public UIntPtr minWorking, maxWorking; public uint active; public UIntPtr affinity; public uint priority, scheduling; }
 [StructLayout(LayoutKind.Sequential)] public struct IoCounters { public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes; }
 [StructLayout(LayoutKind.Sequential)] public struct ExtendedLimits { public BasicLimits basic; public IoCounters io; public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory; }
 public delegate bool EnumWindow(IntPtr hwnd, IntPtr parameter);
 [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateDesktopW(string name, IntPtr device, IntPtr devmode, uint flags, uint access, ref SA security);
 [DllImport("user32.dll", SetLastError = true)] static extern bool CloseDesktop(IntPtr handle);
 [DllImport("user32.dll", SetLastError = true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
 [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint thread);
 [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
 [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool GetUserObjectInformationW(IntPtr handle, int index, StringBuilder text, uint length, out uint needed);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
 [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
 [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int command);
 [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr hwnd, StringBuilder text, int length);
 [DllImport("user32.dll", SetLastError = true)] static extern bool EnumDesktopWindows(IntPtr desktop, EnumWindow callback, IntPtr parameter);
 [DllImport("user32.dll", SetLastError = true)] static extern bool PostMessageW(IntPtr hwnd, uint message, IntPtr w, IntPtr l);
 [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text, uint revision, out IntPtr descriptor, out uint length);
 [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcessW(string file, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string cwd, ref SI info, out PI process);
 [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObjectW(IntPtr security, string name);
 [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int type, IntPtr information, uint size);
 [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
 [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
 [DllImport("kernel32.dll", SetLastError = true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool contained);
 [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int type, IntPtr information, uint size, IntPtr returned);
 [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
 [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
 [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr handle, uint code);
 [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);

 sealed class Fail : Exception { public Fail(string code) : base(code) {} }
 sealed class Work { public Dictionary<string, object> request; public Dictionary<string, object> reply; public ManualResetEvent done = new ManualResetEvent(false); }
 sealed class Doc { public AutomationElement main; public string url; }

 const string LoginPath = "/ja-jp/account/login", VerifyPath = "/ja-jp/account/reauth/verify", StatementPath = "/activity/statement", RecentPath = "/activity/recent";
 const string IconId = "action-icon-dls-icon-download-", CsvId = "axp-activity-download-body-selection-options-type_csv";
 // collector/browser.mjs PLAIN_LANGUAGE_ARGS (the Amex language list, case omf-amex-locale-01), then the owned profile and the policy page.
 const string Arguments = "--lang=ja-JP,ja --accept-lang=ja-JP,ja,en --no-first-run --no-default-browser-check --disable-extensions --disable-sync";
 static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
 static readonly object OutLock = new object();
 static readonly BlockingCollection<Work> Queue = new BlockingCollection<Work>();
 // collector/statement.mjs statementSnapshot's three filters and login.mjs's recipient pattern, with ASCII classes written out.
 // This file stays ASCII (Windows PowerShell reads a script without a byte order mark in the ANSI code page): every Japanese literal is a
 // C# escape. Here the fullwidth parentheses and hyphen, the en dash, and the count text "N ken-chuu M ken wo hyouji".
 static readonly Regex PeriodText = new Regex("^[\uFF08(][0-9]{4}/[0-9]{2}/[0-9]{2}[\\s]*[-\uFF0D\u2013][\\s]*[0-9]{4}/[0-9]{2}/[0-9]{2}[\uFF09)]$", RegexOptions.CultureInvariant);
 static readonly Regex CardText = new Regex("^-[0-9]{5}$", RegexOptions.CultureInvariant);
 static readonly Regex CountText = new Regex("([0-9,]+)[\\s]*\u4EF6\u4E2D[\\s]*([0-9,]+)[\\s]*\u4EF6\u3092\u8868\u793A", RegexOptions.CultureInvariant);
 // The current statement page, measured through UI Automation (case omf-amex-statement-fold-01), has no card button and no whole period text:
 // the card is one Text of exactly four U+2022 bullets and its five digits; the period is five adjacent Texts, the separate DOM text nodes of
 // "(start - end)": parenthesis, date, range mark, date, parenthesis. Their character classes are PeriodText's.
 const string DatePart = "[0-9]{4}/[0-9]{2}/[0-9]{2}";
 static readonly Regex MaskedCardText = new Regex("^\u2022{4}([0-9]{5})$", RegexOptions.CultureInvariant);
 static readonly Regex[] PeriodParts = { Whole("[\uFF08(]"), Whole(DatePart), Whole("[-\uFF0D\u2013]"), Whole(DatePart), Whole("[\uFF09)]") };
 // The code field's label (ninshou koodo), the button "tsugi he" and the dialog button "daunroodo".
 const string CodeLabel = "\u8A8D\u8A3C\u30B3\u30FC\u30C9", NextLabel = "\u6B21\u3078", DownloadLabel = "\u30C0\u30A6\u30F3\u30ED\u30FC\u30C9";
 // The recent page's displayed range (the sanitized contract's shape): the cycle's first date, a long mark or one of PeriodText's range marks, "kyou genzai" (as of today), an opening parenthesis,
 // "jikai shimebi" (next closing date), that date and a closing parenthesis. Measured only as a shape: one Text or several is not known, so RecentRanges reads either, all of it displayed.
 static readonly Regex RecentRange = new Regex("^[0-9]{4}/[0-9]{2}/[0-9]{2}[\\s]*[\u30FC\uFF0D\u2013-][\\s]*\u4ECA\u65E5\u73FE\u5728[\\s]*[\uFF08(][\\s]*\u6B21\u56DE\u7DE0\u3081\u65E5[\\s]*[0-9]{4}/[0-9]{2}/[0-9]{2}[\\s]*[\uFF09)]$", RegexOptions.CultureInvariant);
 const int RecentParts = 7; // date, mark, "kyou genzai", parenthesis, "jikai shimebi", date, parenthesis
 static readonly Regex Recipient = new Regex("[a-zA-Z0-9.*_+-]+@[a-zA-Z0-9.-]+", RegexOptions.CultureInvariant);
 static StreamWriter Output;
 static IntPtr desktop, job, window;
 static bool ownDesktop;
 static PI chrome;
 static uint windowPid;
 static string desktopName, mode, executable, profile, downloads;
 static volatile bool launched, acting;

 static Regex Whole(string pattern) { return new Regex("^" + pattern + "$", RegexOptions.CultureInvariant); }
 static void Emit(object value) { lock (OutLock) { Output.WriteLine(Json.Serialize(value)); Output.Flush(); } }
 static void Check(bool value, string code) { if (!value) throw new Fail(code); }
 static string Quote(string value) { Check(value.IndexOf('"') < 0 && value.IndexOf('\0') < 0 && !value.EndsWith("\\"), "argument"); return "\"" + value + "\""; }
 static string NameOf(IntPtr handle) { var text = new StringBuilder(256); uint needed; return GetUserObjectInformationW(handle, 2, text, 512, out needed) ? text.ToString() : null; }
 static bool Owned(uint pid) { IntPtr p = OpenProcess(0x1000, false, pid); if (p == IntPtr.Zero) return false; try { bool contained; return IsProcessInJob(p, job, out contained) && contained; } finally { CloseHandle(p); } }
 static string ClassOf(IntPtr hwnd) { var text = new StringBuilder(128); GetClassNameW(hwnd, text, 128); return text.ToString(); }
 static string Str(Dictionary<string, object> r, string key) { object v; return r.TryGetValue(key, out v) && v is string ? (string)v : null; }
 static int Int(Dictionary<string, object> r, string key, int fallback) { object v; return r.TryGetValue(key, out v) && v is int ? (int)v : fallback; }
 static string OriginOf(string url) { Uri u; return url != null && Uri.TryCreate(url, UriKind.Absolute, out u) ? u.GetLeftPart(UriPartial.Authority) : null; }
 static string PathOf(string url) { Uri u; return url != null && Uri.TryCreate(url, UriKind.Absolute, out u) ? u.AbsolutePath : null; }
 static string QueryOf(string url) { Uri u; return url != null && Uri.TryCreate(url, UriKind.Absolute, out u) ? u.Query : null; }
 static string ValueOf(AutomationElement e) { object p; return e.TryGetCurrentPattern(ValuePattern.Pattern, out p) ? ((ValuePattern)p).Current.Value : null; }
 static string Trimmed(string value) { return (value ?? "").Trim(); }

 // -- the window: one visible Chrome_WidgetWin_1 of the launched browser process (whose handle this helper holds, so its id is not reused)
 // inside the job, locked once and re-verified before every read and action --
 static List<IntPtr> OwnedVisible() {
  var found = new List<IntPtr>();
  if (desktop == IntPtr.Zero || chrome.pid == 0) return found;
  EnumDesktopWindows(desktop, delegate (IntPtr w, IntPtr unused) { uint pid; GetWindowThreadProcessId(w, out pid); if (pid == chrome.pid && IsWindowVisible(w) && ClassOf(w) == "Chrome_WidgetWin_1" && Owned(pid)) found.Add(w); return true; }, IntPtr.Zero);
  return found;
 }
 static void GuardWindow() {
  Check(window != IntPtr.Zero, "window_not_locked");
  Check(IsWindow(window) && IsWindowVisible(window) && ClassOf(window) == "Chrome_WidgetWin_1", "window_changed");
  uint pid; GetWindowThreadProcessId(window, out pid); Check(pid == windowPid && pid == chrome.pid && Owned(pid), "window_not_owned");
 }
 static Condition Type(ControlType t) { return new PropertyCondition(AutomationElement.ControlTypeProperty, t); }
 static Condition Id(string id) { return new PropertyCondition(AutomationElement.AutomationIdProperty, id); }
 static AutomationElement NearestDocument(AutomationElement e) {
  var walker = TreeWalker.RawViewWalker; var current = walker.GetParent(e); int depth = 0;
  while (current != null && depth < 200) { if (current.Current.ControlType == ControlType.Document) return current; current = walker.GetParent(current); depth++; }
  return null;
 }
 // -- documents: the main document is the one top-level Document of the locked window; each frame is a nested Document --
 static Doc Document() {
  GuardWindow();
  var docs = AutomationElement.FromHandle(window).FindAll(TreeScope.Descendants, Type(ControlType.Document));
  var top = new List<AutomationElement>();
  for (int i = 0; i < docs.Count; i++) if (NearestDocument(docs[i]) == null) top.Add(docs[i]);
  Check(top.Count == 1, top.Count == 0 ? "no_document" : "ambiguous_document");
  var url = ValueOf(top[0]); Check(url != null, "document_url_unavailable");
  return new Doc { main = top[0], url = url };
 }
 // Owned visible windows besides the locked one that host a web document (a page popup); browser-UI windows without one do not count.
 static int DocumentWindows() {
  int count = 0;
  foreach (var w in OwnedVisible()) { if (w == window) continue; try { if (AutomationElement.FromHandle(w).FindFirst(TreeScope.Descendants, Type(ControlType.Document)) != null) count++; } catch (ElementNotAvailableException) { } catch (InvalidOperationException) { } }
  return count;
 }
 // The main document on `origin` (and `path` when given), with no page popup beside it.
 static Doc On(string origin, string path) {
  var d = Document();
  Check(OriginOf(d.url) == origin, "document_origin");
  if (path != null) Check(PathOf(d.url) == path, "document_path");
  Check(DocumentWindows() == 0, "unrelated_document_window");
  return d;
 }
 // Immediately before acting: the same main document is still there, on the same surface.
 static void Same(Doc d, string origin, string path) { var now = On(origin, path); Check(Automation.Compare(now.main, d.main), "document_changed"); }
 static string Key(AutomationElement e) { return string.Join(".", e.GetRuntimeId()); }
 // Elements matching `condition` in the main document only: every element inside a frame's document is excluded. The frames are listed after the
 // matches, never before: a frame that attached in between would keep its elements. Any document that is not the main one counts as a frame.
 static List<AutomationElement> Scoped(Doc d, Condition condition) {
  var all = d.main.FindAll(TreeScope.Descendants, condition); var list = new List<AutomationElement>();
  var excluded = new HashSet<string>(); var docs = AutomationElement.FromHandle(window).FindAll(TreeScope.Descendants, Type(ControlType.Document));
  for (int n = 0; n < docs.Count; n++) { if (Automation.Compare(docs[n], d.main)) continue; var inner = docs[n].FindAll(TreeScope.Descendants, condition); for (int i = 0; i < inner.Count; i++) excluded.Add(Key(inner[i])); }
  for (int i = 0; i < all.Count; i++) if (!excluded.Contains(Key(all[i]))) list.Add(all[i]);
  return list;
 }
 static string TextOf(Doc d) { var names = new List<string>(); foreach (var e in Scoped(d, Type(ControlType.Text))) names.Add(e.Current.Name ?? ""); return string.Join("\n", names.ToArray()); }
 // A Text the page displays: on screen and not clipped away. Clipped screen-reader text reports its full size and IsOffscreen false (measured);
 // only its parent's box shows it, a pixel or two wide, so a parent less than half the Text's size hides it. A parent with no box of its own
 // does not. Scoped keeps frames out. Links, buttons, menu items and tabs are no Text: Chrome names them by their label and exposes no Text
 // inside them (measured), so the period menu cannot reach this.
 static bool Displayed(AutomationElement e) {
  if (e.Current.IsOffscreen) return false;
  var parent = TreeWalker.RawViewWalker.GetParent(e); if (parent == null) return false;
  var own = e.Current.BoundingRectangle; var box = parent.Current.BoundingRectangle;
  return box.IsEmpty || (box.Width * 2 >= own.Width && box.Height * 2 >= own.Height);
 }
 // The period split over adjacent Texts, joined into PeriodText's form. `texts` holds the non-empty names in document order, as an empty name
 // shows nothing between two parts; `elements` holds their elements. Every part must be Displayed, or the run is no period at all.
 static void AddSplitPeriods(List<AutomationElement> elements, List<string> texts, List<string> periods) {
  for (int i = 0; i + PeriodParts.Length <= texts.Count; i++) {
   int part = 0; while (part < PeriodParts.Length && PeriodParts[part].IsMatch(texts[i + part])) part++;
   if (part < PeriodParts.Length) continue;
   part = 0; while (part < PeriodParts.Length && Displayed(elements[i + part])) part++;
   if (part == PeriodParts.Length) periods.Add(string.Concat(texts.GetRange(i, PeriodParts.Length)));
  }
 }
 // The recent range the page displays: one Text, or up to RecentParts adjacent Texts that read as the whole range. As with the period, an empty name shows nothing between two parts and every part
 // must be Displayed. Controls are no Text, and Scoped keeps frames out.
 static List<string> RecentRanges(List<AutomationElement> elements, List<string> texts) {
  var ranges = new List<string>();
  for (int i = 0; i < texts.Count; i++) {
   var joined = "";
   for (int n = 1; n <= RecentParts && i + n <= texts.Count; n++) {
    joined += texts[i + n - 1];
    if (!RecentRange.IsMatch(joined)) continue;
    int part = 0; while (part < n && Displayed(elements[i + part])) part++;
    if (part == n) ranges.Add(joined);
    break;
   }
  }
  return ranges;
 }
 static AutomationElement Single(List<AutomationElement> list, string code) { Check(list.Count == 1, list.Count == 0 ? code + "_missing" : code + "_ambiguous"); return list[0]; }
 static object Pattern(AutomationElement e, AutomationPattern pattern, string code) { object p; Check(e.TryGetCurrentPattern(pattern, out p), code); return p; }
 static ValuePattern Editable(AutomationElement e) {
  Check(e.Current.ControlType == ControlType.Edit, "control_type"); Check(e.Current.IsEnabled, "control_disabled");
  var v = (ValuePattern)Pattern(e, ValuePattern.Pattern, "value_unsupported"); Check(!v.Current.IsReadOnly, "control_readonly"); return v;
 }
 static InvokePattern Invokable(AutomationElement e) { Check(e.Current.IsEnabled, "control_disabled"); return (InvokePattern)Pattern(e, InvokePattern.Pattern, "invoke_unsupported"); }
 static List<AutomationElement> Named(Doc d, ControlType type, string name) { var list = new List<AutomationElement>(); foreach (var e in Scoped(d, Type(type))) if (Trimmed(e.Current.Name) == name) list.Add(e); return list; }
 static AutomationElement CodeInput(Doc d) {
  var list = Scoped(d, Id("question-input")); if (list.Count != 1) return null;
  var e = list[0]; object v;
  return e.Current.ControlType == ControlType.Edit && e.Current.IsEnabled && Trimmed(e.Current.Name) == CodeLabel && e.TryGetCurrentPattern(ValuePattern.Pattern, out v) && !((ValuePattern)v).Current.IsReadOnly ? e : null;
 }

 // -- operations --
 static Dictionary<string, object> Launch() {
  Check(!launched, "already_launched"); launched = true;
  bool inJob; Check(IsProcessInJob(GetCurrentProcess(), IntPtr.Zero, out inJob) && inJob, "helper_not_owned");
  if (mode == "private") {
   IntPtr descriptor = IntPtr.Zero;
   try {
    uint bytes; string sid = WindowsIdentity.GetCurrent().User.Value;
    Check(ConvertStringSecurityDescriptorToSecurityDescriptorW("D:P(A;;GA;;;SY)(A;;GA;;;" + sid + ")", 1, out descriptor, out bytes), "desktop_descriptor");
    var sa = new SA { length = Marshal.SizeOf(typeof(SA)), descriptor = descriptor, inherit = 0 };
    desktopName = "OmfAmexNative" + Guid.NewGuid().ToString("N");
    // read, create windows, enumerate, write objects; never DESKTOP_SWITCHDESKTOP
    desktop = CreateDesktopW(desktopName, IntPtr.Zero, IntPtr.Zero, 0, 0xC3, ref sa); Check(desktop != IntPtr.Zero, "desktop_creation"); ownDesktop = true;
   } finally { if (descriptor != IntPtr.Zero) LocalFree(descriptor); }
  } else {
   desktop = GetThreadDesktop(GetCurrentThreadId()); Check(desktop != IntPtr.Zero, "input_desktop_unavailable");
   IntPtr input = OpenInputDesktop(0, false, 1); Check(input != IntPtr.Zero, "input_desktop_unavailable");
   try { var here = NameOf(desktop); Check(here != null && here == NameOf(input), "input_desktop_unavailable"); desktopName = here; } finally { CloseDesktop(input); }
  }
  // Profile preferences: only the owned download directory and its save prompt; Safe Browsing and every other default stay.
  try {
   Directory.CreateDirectory(Path.Combine(profile, "Default"));
   var prefs = new Dictionary<string, object> { { "download", new Dictionary<string, object> { { "default_directory", downloads }, { "prompt_for_download", false } } } };
   File.WriteAllText(Path.Combine(profile, "Default", "Preferences"), Json.Serialize(prefs), new UTF8Encoding(false));
  } catch (IOException) { throw new Fail("preferences"); } catch (UnauthorizedAccessException) { throw new Fail("preferences"); }
  var si = new SI { cb = Marshal.SizeOf(typeof(SI)), desktop = ownDesktop ? "winsta0\\" + desktopName : null };
  var command = new StringBuilder(Quote(executable) + " " + Arguments + " --user-data-dir=" + Quote(profile) + OmfAmexNativePolicy.Isolation + " " + Quote(OmfAmexNativePolicy.Login));
  Check(CreateProcessW(executable, command, IntPtr.Zero, IntPtr.Zero, false, 0x404, IntPtr.Zero, null, ref si, out chrome), "chrome_creation");
  if (!AssignProcessToJobObject(job, chrome.process)) { TerminateProcess(chrome.process, 101); CloseHandle(chrome.thread); chrome.thread = IntPtr.Zero; throw new Fail("job_assignment"); }
  Check(ResumeThread(chrome.thread) != UInt32.MaxValue, "chrome_resume"); CloseHandle(chrome.thread); chrome.thread = IntPtr.Zero;
  return new Dictionary<string, object> { { "pid", (long)chrome.pid }, { "mode", mode } };
 }
 static Dictionary<string, object> WaitReady(int timeoutMs) {
  var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs); string last = "no_window";
  while (DateTime.UtcNow < deadline) {
   if (window == IntPtr.Zero) { var found = OwnedVisible(); if (found.Count == 1) { window = found[0]; uint pid; GetWindowThreadProcessId(window, out pid); windowPid = pid; } else if (found.Count > 1) last = "ambiguous_window"; }
   if (window != IntPtr.Zero) {
    try {
     var d = Document(); var origin = OriginOf(d.url);
     if (origin == OmfAmexNativePolicy.Www || origin == OmfAmexNativePolicy.Global) return new Dictionary<string, object> { { "surface", origin == OmfAmexNativePolicy.Www ? "www" : "global" } };
     last = "document_origin";
    } catch (Fail f) { if (f.Message.StartsWith("window_")) throw; last = f.Message; }
    catch (ElementNotAvailableException) { last = "element_not_available"; } catch (InvalidOperationException) { last = "uia_invalid_operation"; }
   }
   Thread.Sleep(250);
  }
  throw new Fail(last);
 }
 // collector/login.mjs loginUi.state from the accessibility tree: authenticated on the global origin with a statement link; the login form;
 // the e-mail channels (radio buttons named by their labels); the code field CodeLabel with the e-mail addresses shown; else unknown.
 static Dictionary<string, object> State() {
  var d = Document(); Check(DocumentWindows() == 0, "unrelated_document_window");
  string origin = OriginOf(d.url), path = PathOf(d.url);
  var r = new Dictionary<string, object> { { "kind", "unknown" } };
  if (origin == OmfAmexNativePolicy.Global) {
   foreach (var e in Scoped(d, Type(ControlType.Hyperlink))) { var v = ValueOf(e); var p = PathOf(v); if (OriginOf(v) == OmfAmexNativePolicy.Global && p != null && p.StartsWith(StatementPath)) { r["kind"] = "authenticated"; break; } }
  } else if (origin == OmfAmexNativePolicy.Www && path == LoginPath) {
   if (Scoped(d, Id("eliloUserID")).Count > 0 && Scoped(d, Id("eliloPassword")).Count > 0 && Scoped(d, Id("loginSubmit")).Count > 0) r["kind"] = "login";
  } else if (origin == OmfAmexNativePolicy.Www && path == VerifyPath) {
   var channels = new List<object>();
   foreach (var e in Scoped(d, Type(ControlType.RadioButton))) {
    var id = e.Current.AutomationId ?? ""; var text = Trimmed(e.Current.Name); if (id.Length == 0 || text.Length == 0) continue;
    object p; bool selected = e.TryGetCurrentPattern(SelectionItemPattern.Pattern, out p) && ((SelectionItemPattern)p).Current.IsSelected;
    channels.Add(new Dictionary<string, object> { { "id", id }, { "text", text }, { "checked", selected } });
   }
   if (channels.Count > 0) { r["kind"] = "channels"; r["channels"] = channels; }
   else if (CodeInput(d) != null) { var list = new List<string>(); foreach (Match m in Recipient.Matches(TextOf(d))) list.Add(m.Value); r["kind"] = "code"; r["recipients"] = list; }
  }
  return r;
 }
 static Dictionary<string, object> Login(string user, string password) {
  Check(!string.IsNullOrEmpty(user) && !string.IsNullOrEmpty(password), "argument");
  var d = On(OmfAmexNativePolicy.Www, LoginPath);
  var u = Editable(Single(Scoped(d, Id("eliloUserID")), "control")); var p = Editable(Single(Scoped(d, Id("eliloPassword")), "control"));
  var submit = Invokable(Single(Scoped(d, Id("loginSubmit")), "control"));
  Same(d, OmfAmexNativePolicy.Www, LoginPath);
  acting = true; u.SetValue(user); p.SetValue(password);
  Same(d, OmfAmexNativePolicy.Www, LoginPath); // the page is still the login page before the one submission
  submit.Invoke();
  return new Dictionary<string, object> { { "submitted", 1 } };
 }
 static Dictionary<string, object> Choose(string id) {
  Check(!string.IsNullOrEmpty(id), "argument");
  var d = On(OmfAmexNativePolicy.Www, VerifyPath); var radio = Single(Scoped(d, Id(id)), "control");
  Check(radio.Current.ControlType == ControlType.RadioButton, "not_radio"); Check(radio.Current.IsEnabled, "control_disabled");
  var s = (SelectionItemPattern)Pattern(radio, SelectionItemPattern.Pattern, "selection_unsupported");
  Same(d, OmfAmexNativePolicy.Www, VerifyPath); acting = true; s.Select();
  return new Dictionary<string, object> { { "chosen", 1 } };
 }
 static Dictionary<string, object> Next() {
  var d = On(OmfAmexNativePolicy.Www, VerifyPath); var next = Invokable(Single(Named(d, ControlType.Button, NextLabel), "control"));
  Same(d, OmfAmexNativePolicy.Www, VerifyPath); acting = true; next.Invoke();
  return new Dictionary<string, object> { { "invoked", 1 } };
 }
 static Dictionary<string, object> Code(string value) {
  Check(!string.IsNullOrEmpty(value), "argument");
  var d = On(OmfAmexNativePolicy.Www, VerifyPath); var input = CodeInput(d); Check(input != null, "control_missing"); var v = Editable(input);
  Same(d, OmfAmexNativePolicy.Www, VerifyPath); acting = true; v.SetValue(value);
  return new Dictionary<string, object> { { "typed", 1 } };
 }
 // The dashboard's link to the statement page (global origin, /activity/statement): the one without a query when present, else the only
 // destination. Elements with that same destination lead to the same page; the first enabled one is invoked once.
 static Dictionary<string, object> OpenStatement() {
  var d = On(OmfAmexNativePolicy.Global, null);
  var order = new List<string>(); var groups = new Dictionary<string, List<AutomationElement>>();
  foreach (var e in Scoped(d, Type(ControlType.Hyperlink))) {
   var v = ValueOf(e); if (OriginOf(v) != OmfAmexNativePolicy.Global || PathOf(v) != StatementPath) continue;
   if (!groups.ContainsKey(v)) { groups[v] = new List<AutomationElement>(); order.Add(v); }
   groups[v].Add(e);
  }
  string chosen = null;
  foreach (var v in order) if (QueryOf(v) == "") { chosen = v; break; }
  if (chosen == null) { Check(order.Count > 0, "statement_link_missing"); Check(order.Count == 1, "statement_link_ambiguous"); chosen = order[0]; }
  AutomationElement target = null; foreach (var e in groups[chosen]) if (e.Current.IsEnabled) { target = e; break; }
  Check(target != null, "control_disabled"); var invoke = Invokable(target);
  Same(d, OmfAmexNativePolicy.Global, null); acting = true; invoke.Invoke();
  return new Dictionary<string, object> { { "invoked", 1 } };
 }
 // The statement page's link to the current activity, as observed: the global origin, exactly RecentPath, no query, in the main document. Its label is not read: the observed labels differ by
 // page and language while the destination decides where it leads. Elements with that one destination lead to the same page; the first enabled one is invoked once, as OpenStatement does.
 static Dictionary<string, object> OpenRecent() {
  var d = On(OmfAmexNativePolicy.Global, StatementPath); AutomationElement target = null; int found = 0;
  foreach (var e in Scoped(d, Type(ControlType.Hyperlink))) { var v = ValueOf(e); if (OriginOf(v) != OmfAmexNativePolicy.Global || PathOf(v) != RecentPath || QueryOf(v) != "") continue; found++; if (target == null && e.Current.IsEnabled) target = e; }
  Check(found > 0, "recent_link_missing"); Check(target != null, "control_disabled"); var open = Invokable(target);
  Same(d, OmfAmexNativePolicy.Global, StatementPath); acting = true; open.Invoke();
  return new Dictionary<string, object> { { "invoked", 1 } };
 }
 // collector/statement.mjs statementSnapshot's shape from the main document of the statement page; URLs as the policy reports them. The legacy
 // card button and whole period stay; the current page's card and period are translated into the same strings, so verifyStatement's card,
 // period and count comparisons are the ones it always made.
 static Dictionary<string, object> Snapshot() { return Read(StatementPath); }
 // The recent page's read is the same read on its own page, with its displayed ranges beside it; the closed reply is unchanged.
 static Dictionary<string, object> Read(string surface) {
  var d = On(OmfAmexNativePolicy.Global, surface);
  var links = new List<object>();
  foreach (var e in Scoped(d, Type(ControlType.Hyperlink))) { var v = ValueOf(e); if (v == null) continue; var href = OmfAmexNativePolicy.Report(v); if (href.Contains("/activity/statement?end=")) links.Add(new Dictionary<string, object> { { "text", Trimmed(e.Current.Name) }, { "href", href } }); }
  var periods = new List<string>(); var names = new List<string>(); var cards = new List<string>(); var elements = new List<AutomationElement>(); var texts = new List<string>();
  foreach (var e in Scoped(d, Type(ControlType.Text))) {
   var name = e.Current.Name ?? ""; names.Add(name); var text = name.Trim();
   if (PeriodText.IsMatch(text)) periods.Add(text);
   var masked = MaskedCardText.Match(text); if (masked.Success && Displayed(e)) cards.Add("-" + masked.Groups[1].Value);
   if (text.Length > 0) { elements.Add(e); texts.Add(text); }
  }
  AddSplitPeriods(elements, texts, periods);
  foreach (var e in Scoped(d, Type(ControlType.Button))) { var name = Trimmed(e.Current.Name); if (CardText.IsMatch(name)) cards.Add(name); }
  var counts = new List<object>();
  foreach (Match m in CountText.Matches(string.Join("\n", names.ToArray()))) counts.Add(new[] { long.Parse(m.Groups[1].Value.Replace(",", "")), long.Parse(m.Groups[2].Value.Replace(",", "")) });
  var reply = new Dictionary<string, object> { { "url", OmfAmexNativePolicy.Report(d.url) }, { "links", links }, { "periods", periods }, { "cards", cards }, { "counts", counts } };
  if (surface == RecentPath) reply["ranges"] = RecentRanges(elements, texts);
  return reply;
 }
 // The one main-document statement link with exactly this destination and accessible name (a period link latestClosed chose).
 static Dictionary<string, object> InvokePeriod(string href, string name) {
  Check(!string.IsNullOrEmpty(href) && name != null, "argument");
  var raw = OmfAmexNativePolicy.Accept(href); Check(OriginOf(raw) == OmfAmexNativePolicy.Global && PathOf(raw) == StatementPath && QueryOf(raw).StartsWith("?end="), "argument");
  var d = On(OmfAmexNativePolicy.Global, StatementPath); var matches = new List<AutomationElement>();
  foreach (var e in Scoped(d, Type(ControlType.Hyperlink))) if (ValueOf(e) == raw && Trimmed(e.Current.Name) == name) matches.Add(e);
  var invoke = Invokable(Single(matches, "link"));
  Same(d, OmfAmexNativePolicy.Global, StatementPath); acting = true; invoke.Invoke();
  return new Dictionary<string, object> { { "invoked", 1 } };
 }
 // The download icon, the one main-document element with IconId. Invoke where it has that pattern, as ever. The real icon has none: Chrome exposes a
 // button with aria-expanded or aria-haspopup through ExpandCollapse instead, and its Expand is the same click (measured, case omf-amex-download-fold-01).
 // With neither pattern Invokable refuses: no other pattern and no other element is tried.
 static Dictionary<string, object> DownloadOpen(string surface) {
  var d = On(OmfAmexNativePolicy.Global, surface); var icon = Single(Scoped(d, Id(IconId)), "control"); object p;
  if (!icon.TryGetCurrentPattern(InvokePattern.Pattern, out p) && icon.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out p)) return ExpandIcon(d, icon, (ExpandCollapsePattern)p, surface);
  var invoke = Invokable(icon);
  Same(d, OmfAmexNativePolicy.Global, surface); acting = true; invoke.Invoke();
  return new Dictionary<string, object> { { "invoked", 1 } };
 }
 // One Expand, with the document, the icon's place in it, its enabled state and its ExpandCollapseState read again last. Expanded shows its content already:
 // Chrome refuses Expand there and the content must stay open, so nothing is sent and the CSV read decides. Every other state gets the one Expand. Collapsed and
 // PartiallyExpanded have content to show. Microsoft documents InvalidOperationException for LeafNode, but Chrome answers it with the same click (measured), and a
 // provider that did refuse ends the job here as uncertain, never sent again, so refusing it first would only stop a job that works. Collapse is never called.
 static Dictionary<string, object> ExpandIcon(Doc d, AutomationElement icon, ExpandCollapsePattern expand, string surface) {
  Same(d, OmfAmexNativePolicy.Global, surface); Check(Automation.Compare(Single(Scoped(d, Id(IconId)), "control"), icon), "control_changed"); Check(icon.Current.IsEnabled, "control_disabled");
  var state = expand.Current.ExpandCollapseState;
  if (state == ExpandCollapseState.Expanded) return new Dictionary<string, object> { { "alreadyExpanded", true } };
  acting = true; expand.Expand();
  return new Dictionary<string, object> { { "expanded", 1 } };
 }
 static Dictionary<string, object> CsvState(string surface) {
  var d = On(OmfAmexNativePolicy.Global, surface); var list = Scoped(d, Id(CsvId));
  if (list.Count == 0) return new Dictionary<string, object> { { "present", false } };
  Check(list.Count == 1, "radio_ambiguous"); Check(list[0].Current.ControlType == ControlType.RadioButton, "not_radio");
  var s = (SelectionItemPattern)Pattern(list[0], SelectionItemPattern.Pattern, "selection_unsupported");
  return new Dictionary<string, object> { { "present", true }, { "selected", s.Current.IsSelected } };
 }
 static Dictionary<string, object> CsvSelect(string surface) {
  var d = On(OmfAmexNativePolicy.Global, surface); var radio = Single(Scoped(d, Id(CsvId)), "radio");
  Check(radio.Current.ControlType == ControlType.RadioButton, "not_radio"); Check(radio.Current.IsEnabled, "control_disabled");
  var s = (SelectionItemPattern)Pattern(radio, SelectionItemPattern.Pattern, "selection_unsupported");
  Same(d, OmfAmexNativePolicy.Global, surface); acting = true; s.Select();
  return new Dictionary<string, object> { { "chosen", 1 } };
 }
 // collector/browser.mjs clicked '[role="dialog"] button' with the text DownloadLabel: here a main-document button with that exact accessible
 // name, not the download icon, whose ancestor inside the main document reports IsDialog.
 static Dictionary<string, object> Download(string surface) {
  var d = On(OmfAmexNativePolicy.Global, surface); var matches = new List<AutomationElement>();
  foreach (var e in Named(d, ControlType.Button, DownloadLabel)) {
   if (e.Current.AutomationId == IconId) continue;
   var walker = TreeWalker.RawViewWalker; var current = walker.GetParent(e); bool dialog = false; int depth = 0;
   while (current != null && depth < 60 && current.Current.ControlType != ControlType.Document) { object v = current.GetCurrentPropertyValue(AutomationElement.IsDialogProperty, true); if (v is bool && (bool)v) { dialog = true; break; } current = walker.GetParent(current); depth++; }
   if (dialog) matches.Add(e);
  }
  var invoke = Invokable(Single(matches, "dialog_button"));
  Same(d, OmfAmexNativePolicy.Global, surface); acting = true; invoke.Invoke();
  return new Dictionary<string, object> { { "invoked", 1 } };
 }
 // Attended mode only: the window is already on the person's desktop; it is restored without activation only when minimized.
 static Dictionary<string, object> Show() {
  Check(mode == "input", "private_mode"); GuardWindow();
  bool minimized = IsIconic(window); if (minimized) { acting = true; ShowWindow(window, 4); }
  return new Dictionary<string, object> { { "restored", minimized } };
 }
 // -- the end of the job's processes --
 // The job's own figures cannot say they have ended: ActiveProcesses and the id list read zero within 2 ms of TerminateJobObject while the processes run on for seconds (measured, case
 // omf-amex-download-fold-01). So each member is held by a handle taken from the list just before the termination, and Finish waits on those handles. A process already exiting by itself
 // is still on the list then: it leaves within 3 ms of its handle signaling (measured). EndMs bounds the wait: exits past 20 s were measured on a loaded PC, and that is no maximum. A list
 // that cannot be read, or a listed process that cannot be opened for any reason but having gone, leaves the end unproven. An id read a moment ago can already be another process's: that one
 // is closed again, never waited on.
 const int EndMs = 60000;
 static readonly List<IntPtr> members = new List<IntPtr>();
 static bool membersKnown = true;
 static void Hold(uint pid) {
  if (pid == chrome.pid) return;
  IntPtr p = OpenProcess(0x101000, false, pid); bool contained; // SYNCHRONIZE, PROCESS_QUERY_LIMITED_INFORMATION
  if (p == IntPtr.Zero) { if (Marshal.GetLastWin32Error() != 87) membersKnown = false; return; }
  if (!IsProcessInJob(p, job, out contained)) membersKnown = false;
  if (contained) members.Add(p); else CloseHandle(p);
 }
 // JOBOBJECT_BASIC_PROCESS_ID_LIST: two counts, then the ids. A list that does not fit is read again in a larger buffer: a partial one proves nothing.
 static void Track() {
  if (job == IntPtr.Zero) return;
  for (int capacity = 1024; capacity <= 65536; capacity *= 4) {
   int size = 8 + capacity * IntPtr.Size; IntPtr list = Marshal.AllocHGlobal(size);
   try {
    bool read = QueryInformationJobObject(job, 3, list, (uint)size, IntPtr.Zero);
    if (!read) { if (Marshal.GetLastWin32Error() == 234) continue; break; }
    int listed = Marshal.ReadInt32(list, 4);
    if (listed < Marshal.ReadInt32(list, 0)) continue;
    for (int i = 0; i < listed; i++) Hold((uint)Marshal.ReadIntPtr(list, 8 + i * IntPtr.Size).ToInt64());
    return;
   } finally { Marshal.FreeHGlobal(list); }
  }
  membersKnown = false;
 }
 static Dictionary<string, object> Close() {
  if (window != IntPtr.Zero && IsWindow(window)) { uint pid; GetWindowThreadProcessId(window, out pid); if (pid == windowPid && Owned(pid)) PostMessageW(window, 0x10, IntPtr.Zero, IntPtr.Zero); }
  bool exited = chrome.process == IntPtr.Zero || WaitForSingleObject(chrome.process, 5000) == 0;
  return new Dictionary<string, object> { { "gracefulExit", exited } };
 }
 static Dictionary<string, object> Execute(Dictionary<string, object> request) {
  switch (Str(request, "op")) {
   case "launch": return Launch();
   case "wait-ready": return WaitReady(Math.Min(Math.Max(Int(request, "timeoutMs", 60000), 1000), 120000));
   case "state": return State();
   case "login": return Login(Str(request, "user"), Str(request, "password"));
   case "choose": return Choose(Str(request, "channel"));
   case "next": return Next();
   case "code": return Code(Str(request, "value"));
   case "show": return Show();
   case "open-statement": return OpenStatement();
   case "snapshot": return Snapshot();
   case "invoke-period": return InvokePeriod(Str(request, "href"), Str(request, "name"));
   case "download-open": return DownloadOpen(StatementPath);
   case "csv-state": return CsvState(StatementPath);
   case "csv-select": return CsvSelect(StatementPath);
   case "download": return Download(StatementPath);
   case "open-recent": return OpenRecent();
   case "recent-snapshot": return Read(RecentPath);
   case "recent-download-open": return DownloadOpen(RecentPath);
   case "recent-csv-state": return CsvState(RecentPath);
   case "recent-csv-select": return CsvSelect(RecentPath);
   case "recent-download": return Download(RecentPath);
   case "close": return Close();
   default: throw new Fail("unknown_op");
  }
 }
 static void Failed(Dictionary<string, object> reply, string code) { reply["ok"] = false; reply["code"] = code; reply["acted"] = acting; }
 static void Worker() {
  foreach (var work in Queue.GetConsumingEnumerable()) {
   var reply = new Dictionary<string, object>(); object id; reply["id"] = work.request.TryGetValue("id", out id) ? id : null; acting = false;
   try {
    var op = Str(work.request, "op");
    if (!launched && op != "launch" && op != "close") throw new Fail("not_launched");
    foreach (var pair in Execute(work.request)) reply[pair.Key] = pair.Value;
    reply["ok"] = true;
   }
   catch (Fail f) { Failed(reply, f.Message); }
   catch (ElementNotAvailableException) { Failed(reply, "element_not_available"); }
   catch (InvalidOperationException) { Failed(reply, "uia_invalid_operation"); }
   catch (COMException) { Failed(reply, "uia_com"); }
   catch (Exception) { Failed(reply, "error"); }
   work.reply = reply; work.done.Set();
  }
 }
 static int Finish(string reason, int code) {
  Track();
  bool terminated = job == IntPtr.Zero || TerminateJobObject(job, 0);
  if (!terminated) { CloseHandle(job); job = IntPtr.Zero; } // the job's kill-on-close ends what the refused termination left
  var clock = System.Diagnostics.Stopwatch.StartNew(); int left = 0;
  if (chrome.process != IntPtr.Zero) { members.Add(chrome.process); chrome.process = IntPtr.Zero; }
  foreach (var p in members) { if (WaitForSingleObject(p, (uint)Math.Max(0, EndMs - clock.ElapsedMilliseconds)) != 0) left++; CloseHandle(p); }
  members.Clear();
  bool chromeEnded = left == 0 && membersKnown; long closeMs = clock.ElapsedMilliseconds;
  bool desktopClosed = !ownDesktop || desktop == IntPtr.Zero || CloseDesktop(desktop);
  desktop = IntPtr.Zero;
  if (job != IntPtr.Zero) { CloseHandle(job); job = IntPtr.Zero; }
  Emit(new Dictionary<string, object> { { "event", "end" }, { "reason", reason }, { "chromeEnded", chromeEnded }, { "desktopClosed", desktopClosed }, { "jobTerminated", terminated }, { "processesLeft", left }, { "membersKnown", membersKnown }, { "closeMs", closeMs } });
  return code;
 }
 public static int Run(string chromePath, string profileDir, string downloadDir, string runMode) {
  Output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
  var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
  try {
   Check(runMode == "private" || runMode == "input", "mode"); mode = runMode;
   executable = Path.GetFullPath(chromePath); Check(File.Exists(executable) && Path.GetFileName(executable).Equals("chrome.exe", StringComparison.OrdinalIgnoreCase), "chrome_path");
   profile = Path.GetFullPath(profileDir); Check(Directory.Exists(profile), "profile_path");
   downloads = Path.GetFullPath(downloadDir); Check(Directory.Exists(downloads) && Directory.GetFileSystemEntries(downloads).Length == 0, "downloads_path");
   job = CreateJobObjectW(IntPtr.Zero, null); Check(job != IntPtr.Zero, "job_creation");
   var limits = new ExtendedLimits(); limits.basic.flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, no breakaway
   int size = Marshal.SizeOf(typeof(ExtendedLimits)); IntPtr memory = Marshal.AllocHGlobal(size);
   try { Marshal.StructureToPtr(limits, memory, false); Check(SetInformationJobObject(job, 9, memory, (uint)size), "job_limit"); } finally { Marshal.FreeHGlobal(memory); }
  } catch (Exception e) { Emit(new Dictionary<string, object> { { "event", "failure" }, { "code", e is Fail ? e.Message : "error" } }); if (job != IntPtr.Zero) CloseHandle(job); return 1; }
  var worker = new Thread(Worker); worker.SetApartmentState(ApartmentState.MTA); worker.IsBackground = true; worker.Start();
  Emit(new Dictionary<string, object> { { "event", "ready" }, { "pid", (long)System.Diagnostics.Process.GetCurrentProcess().Id }, { "mode", mode } });
  string line, reason = "stdin_closed";
  while ((line = input.ReadLine()) != null) {
   if (line.Length > 65536) { Emit(new Dictionary<string, object> { { "ok", false }, { "code", "invalid_request" } }); continue; }
   Dictionary<string, object> request = null;
   try { request = Json.DeserializeObject(line) as Dictionary<string, object>; } catch (Exception) { request = null; }
   line = null;
   if (request == null) { Emit(new Dictionary<string, object> { { "ok", false }, { "code", "invalid_request" } }); continue; }
   var op = Str(request, "op"); var work = new Work { request = request };
   Queue.Add(work);
   int limit = Math.Min(Math.Max(Int(request, "timeoutMs", 20000) + 5000, 5000), 130000);
   if (!work.done.WaitOne(limit)) { object id; Emit(new Dictionary<string, object> { { "id", request.TryGetValue("id", out id) ? id : null }, { "ok", false }, { "code", "uia_watchdog" } }); return Finish("uia_watchdog", 3); }
   request.Clear(); // the request's values (a login or a code) are not kept
   Emit(work.reply);
   if (op == "close") { reason = "closed"; break; }
  }
  return Finish(reason, 0);
 }
}
'@
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase, System.Web.Extensions
$references = @([System.Windows.Automation.AutomationElement].Assembly.Location, [System.Windows.Automation.ControlType].Assembly.Location, [System.Windows.Rect].Assembly.Location, [System.Web.Script.Serialization.JavaScriptSerializer].Assembly.Location)
Add-Type -TypeDefinition ($core + "`n" + $policy) -ReferencedAssemblies $references
exit ([OmfAmexNative]::Run($Chrome, $ProfileDir, $Downloads, $Mode))
