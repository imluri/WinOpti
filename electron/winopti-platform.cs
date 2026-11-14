using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

public static class WinOptiNative
{
    private const uint QueryLimitedInformation = 0x1000;
    private const uint Synchronize = 0x00100000;
    private const uint WaitTimeout = 258;
    private const uint SnapshotProcesses = 2;
    private const uint CloseWindowMessage = 0x0010;
    private const uint GetOwnerWindow = 4;
    private const int WindowCloakedAttribute = 14;
    private const int InvalidParameter = 87;
    private const int ProcessCommandLineInformation = 60;
    private const uint PdhFormatDouble = 0x200;
    private const uint AllProcessorGroups = 0xffff;
    private const uint DriveFixed = 3;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry
    {
        public uint size, usage, pid;
        public UIntPtr defaultHeap;
        public uint moduleId, threads, parentPid;
        public int basePriority;
        public uint flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string name;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessMemory
    {
        public uint size, pageFaultCount;
        public UIntPtr peakWorkingSet, workingSet, peakPagedPool, pagedPool,
            peakNonPagedPool, nonPagedPool, pagefile, peakPagefile;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong readOperations, writeOperations, otherOperations,
            readBytes, writeBytes, otherBytes;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PerformanceInfo
    {
        public uint size;
        public UIntPtr commitTotal, commitLimit, commitPeak, physicalTotal, physicalAvailable,
            systemCache, kernelTotal, kernelPaged, kernelNonPaged, pageSize;
        public uint handleCount, processCount, threadCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SystemPowerStatus
    {
        public byte acLineStatus, batteryFlag, batteryLifePercent, systemStatusFlag;
        public uint batteryLifeTime, batteryFullLifeTime;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PdhValue
    {
        public uint status;
        public double value;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct UnicodeString
    {
        public ushort length, maximumLength;
        public IntPtr buffer;
    }

    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr state);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentProcessId();
    [DllImport("kernel32.dll")]
    private static extern uint GetActiveProcessorCount(ushort group);
    [DllImport("kernel32.dll")]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll")]
    private static extern bool ProcessIdToSessionId(uint pid, out uint sessionId);
    [DllImport("kernel32.dll")]
    private static extern bool IsProcessCritical(IntPtr handle, out bool critical);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageNameW(IntPtr handle, uint flags, StringBuilder path, ref int length);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern uint GetDriveTypeW(string rootPath);
    [DllImport("kernel32.dll")]
    private static extern bool GetProcessTimes(IntPtr handle, out long created, out long exited, out long kernel, out long user);
    [DllImport("kernel32.dll")]
    private static extern bool GetProcessIoCounters(IntPtr handle, out IoCounters counters);
    [DllImport("kernel32.dll")]
    private static extern bool GetSystemTimes(out long idle, out long kernel, out long user);
    [DllImport("kernel32.dll")]
    private static extern bool GetSystemPowerStatus(out SystemPowerStatus status);
    [DllImport("psapi.dll")]
    private static extern bool GetPerformanceInfo(ref PerformanceInfo info, uint size);
    [DllImport("psapi.dll")]
    private static extern bool GetProcessMemoryInfo(IntPtr handle, ref ProcessMemory memory, uint size);
    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(IntPtr handle, int infoClass, IntPtr info, int length, out int required);
    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr state);
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")]
    private static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextW(IntPtr window, StringBuilder title, int count);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool PostMessageW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
    private static extern uint PdhOpenQueryW(string source, IntPtr userData, out IntPtr query);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
    private static extern uint PdhAddEnglishCounterW(IntPtr query, string path, IntPtr userData, out IntPtr counter);
    [DllImport("pdh.dll")]
    private static extern uint PdhCollectQueryData(IntPtr query);
    [DllImport("pdh.dll")]
    private static extern uint PdhGetFormattedCounterValue(IntPtr counter, uint format, IntPtr type, out PdhValue value);
    [DllImport("pdh.dll")]
    private static extern uint PdhCloseQuery(IntPtr query);

    public sealed class ProcessData
    {
        public uint pid { get; set; }
        public uint? parentPid { get; set; }
        public string name { get; set; }
        public long? startedAt { get; set; }
        public string creationToken { get; set; }
        public string executable { get; set; }
        public string displayName { get; set; }
        public string iconPath { get; set; }
        public string commandLine { get; set; }
        public double? cpuTimeMs { get; set; }
        public ulong? workingSetBytes { get; set; }
        public ulong? ioBytes { get; set; }
        public string windowTitle { get; set; }
        public uint? sessionId { get; set; }
    }

    public sealed class PowerData
    {
        public string source { get; set; }
        public byte? batteryPercent { get; set; }
        public bool? saver { get; set; }
    }

    public sealed class SnapshotData
    {
        public long at { get; set; }
        public int logicalCpus { get; set; }
        public double? cpuPercent { get; set; }
        public double? memoryPressurePercent { get; set; }
        public double? diskBytesPerSecond { get; set; }
        public PowerData power { get; set; }
        public List<ProcessData> processes { get; set; }
    }

    public sealed class CloseResult
    {
        public string status { get; set; }
        public string detail { get; set; }
    }

    public sealed class Request
    {
        public int id { get; set; }
        public string action { get; set; }
        public Identity identity { get; set; }
    }

    public sealed class Identity
    {
        public uint pid { get; set; }
        public string creationToken { get; set; }
        public string executable { get; set; }
    }

    public sealed class Response
    {
        public int id { get; set; }
        public object result { get; set; }
        public string error { get; set; }
    }

    private sealed class VisibleWindow
    {
        public IntPtr handle;
        public string title;
    }

    private static readonly Dictionary<string, string> Names = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    private static IntPtr perfQuery, cpuCounter, diskCounter;
    private static long lastCpuTotal, lastCpuIdle;
    private static bool hasCpuSample;

    // One JSON request and response per line. Command lines travel only over
    // the local pipe to WinOpti's trusted main process.
    public static void Main()
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        var json = new JavaScriptSerializer { MaxJsonLength = 32 * 1024 * 1024 };
        Initialize();
        try
        {
            string line;
            while ((line = Console.ReadLine()) != null)
            {
                var response = new Response();
                try
                {
                    Request request = json.Deserialize<Request>(line);
                    response.id = request.id;
                    if (request.action == "snapshot") response.result = Snapshot();
                    else if (request.action == "close" && request.identity != null)
                        response.result = RequestClose(
                            request.identity.pid, request.identity.creationToken, request.identity.executable);
                    else response.error = "Unknown Windows helper action.";
                }
                catch (Exception)
                {
                    response.error = "Windows could not complete the process operation.";
                }
                Console.WriteLine(json.Serialize(response));
            }
        }
        finally
        {
            if (perfQuery != IntPtr.Zero) PdhCloseQuery(perfQuery);
        }
    }

    private static void Initialize()
    {
        if (PdhOpenQueryW(null, IntPtr.Zero, out perfQuery) != 0) return;
        if (PdhAddEnglishCounterW(perfQuery, @"\Processor Information(_Total)\% Processor Time", IntPtr.Zero, out cpuCounter) != 0)
            cpuCounter = IntPtr.Zero;
        if (PdhAddEnglishCounterW(perfQuery, @"\PhysicalDisk(_Total)\Disk Bytes/sec", IntPtr.Zero, out diskCounter) != 0)
            diskCounter = IntPtr.Zero;
        PdhCollectQueryData(perfQuery);
    }

    private static SnapshotData Snapshot()
    {
        uint logicalCpus = GetActiveProcessorCount((ushort)AllProcessorGroups);
        if (logicalCpus == 0) logicalCpus = (uint)Environment.ProcessorCount;
        var sample = new SnapshotData
        {
            at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            logicalCpus = (int)logicalCpus,
            memoryPressurePercent = CommitPressure(),
            power = ReadPower()
        };
        if (perfQuery != IntPtr.Zero && PdhCollectQueryData(perfQuery) == 0)
        {
            sample.cpuPercent = CounterValue(cpuCounter);
            sample.diskBytesPerSecond = CounterValue(diskCounter);
        }
        // GetSystemTimes covers the calling processor group. Only use it as a
        // machine-wide fallback when all logical processors fit in one group.
        if (logicalCpus <= 64)
        {
            double? cpuFallback = CpuFromSystemTimes();
            if (!sample.cpuPercent.HasValue) sample.cpuPercent = cpuFallback;
        }
        sample.processes = ReadProcesses();
        return sample;
    }

    private static double? CounterValue(IntPtr counter)
    {
        PdhValue value;
        if (counter == IntPtr.Zero ||
            PdhGetFormattedCounterValue(counter, PdhFormatDouble, IntPtr.Zero, out value) != 0 ||
            value.status > 1 || double.IsNaN(value.value) || double.IsInfinity(value.value) || value.value < 0)
            return null;
        return value.value;
    }

    private static double? CpuFromSystemTimes()
    {
        long idle, kernel, user;
        if (!GetSystemTimes(out idle, out kernel, out user)) return null;
        long total = kernel + user;
        long elapsed = total - lastCpuTotal;
        long elapsedIdle = idle - lastCpuIdle;
        double? result = hasCpuSample && elapsed > 0
            ? (double?)Math.Max(0, Math.Min(100, 100.0 * (elapsed - elapsedIdle) / elapsed))
            : null;
        lastCpuTotal = total;
        lastCpuIdle = idle;
        hasCpuSample = true;
        return result;
    }

    private static double? CommitPressure()
    {
        var info = new PerformanceInfo { size = (uint)Marshal.SizeOf(typeof(PerformanceInfo)) };
        if (!GetPerformanceInfo(ref info, info.size) || info.commitLimit == UIntPtr.Zero) return null;
        return 100.0 * info.commitTotal.ToUInt64() / info.commitLimit.ToUInt64();
    }

    private static PowerData ReadPower()
    {
        var result = new PowerData { source = "unknown" };
        SystemPowerStatus status;
        if (!GetSystemPowerStatus(out status)) return result;
        if (status.acLineStatus == 1) result.source = "plugged-in";
        if (status.acLineStatus == 0) result.source = "battery";
        if (status.batteryLifePercent <= 100) result.batteryPercent = status.batteryLifePercent;
        if (status.systemStatusFlag <= 1) result.saver = status.systemStatusFlag == 1;
        return result;
    }

    private static Dictionary<uint, VisibleWindow> VisibleWindows()
    {
        var result = new Dictionary<uint, VisibleWindow>();
        EnumWindows(delegate(IntPtr window, IntPtr state)
        {
            int cloaked;
            if (!IsWindowVisible(window) || GetWindow(window, GetOwnerWindow) != IntPtr.Zero ||
                (DwmGetWindowAttribute(window, WindowCloakedAttribute, out cloaked, sizeof(int)) == 0 && cloaked != 0))
                return true;
            uint pid;
            if (GetWindowThreadProcessId(window, out pid) == 0) return true;
            var title = new StringBuilder(512);
            if (GetWindowTextW(window, title, title.Capacity) > 0 && !result.ContainsKey(pid))
                result.Add(pid, new VisibleWindow { handle = window, title = title.ToString() });
            return true;
        }, IntPtr.Zero);
        return result;
    }

    private static List<ProcessData> ReadProcesses()
    {
        var windows = VisibleWindows();
        uint currentSession;
        bool knowsSession = ProcessIdToSessionId(GetCurrentProcessId(), out currentSession);
        var results = new List<ProcessData>();
        var entry = new ProcessEntry { size = (uint)Marshal.SizeOf(typeof(ProcessEntry)) };
        IntPtr list = CreateToolhelp32Snapshot(SnapshotProcesses, 0);
        if (list == new IntPtr(-1)) throw new InvalidOperationException("Could not list Windows processes.");
        try
        {
            if (!Process32FirstW(list, ref entry)) throw new InvalidOperationException("Could not read Windows processes.");
            do
            {
                // System Idle Process is accounting for idle CPU time, not a workload.
                if (entry.pid == 0) continue;
                var row = new ProcessData
                {
                    pid = entry.pid,
                    parentPid = entry.parentPid == 0 ? (uint?)null : entry.parentPid,
                    name = entry.name
                };
                uint session;
                if (ProcessIdToSessionId(entry.pid, out session)) row.sessionId = session;
                VisibleWindow window;
                if (windows.TryGetValue(entry.pid, out window)) row.windowTitle = window.title;
                ReadProcessDetails(row, knowsSession && row.sessionId == currentSession);
                results.Add(row);
            } while (Process32NextW(list, ref entry));
        }
        finally { CloseHandle(list); }
        return results;
    }

    private static void ReadProcessDetails(ProcessData row, bool sameSession)
    {
        IntPtr process = OpenProcess(QueryLimitedInformation, false, row.pid);
        if (process == IntPtr.Zero) return;
        try
        {
            long created, exited, kernel, user;
            if (GetProcessTimes(process, out created, out exited, out kernel, out user) && created > 0 && exited == 0)
            {
                row.creationToken = created.ToString(CultureInfo.InvariantCulture);
                row.startedAt = new DateTimeOffset(DateTime.FromFileTimeUtc(created)).ToUnixTimeMilliseconds();
                row.cpuTimeMs = (kernel + user) / 10000.0;
            }
            row.executable = ReadImagePath(process);
            if (sameSession)
            {
                row.commandLine = ReadCommandLine(process);
                if (row.startedAt.HasValue && IsFixedDriveExecutable(row.executable))
                {
                    row.iconPath = row.executable;
                    if (row.windowTitle != null) row.displayName = DescribeImage(row.executable);
                }
            }
            var memory = new ProcessMemory { size = (uint)Marshal.SizeOf(typeof(ProcessMemory)) };
            if (GetProcessMemoryInfo(process, ref memory, memory.size)) row.workingSetBytes = memory.workingSet.ToUInt64();
            IoCounters io;
            if (GetProcessIoCounters(process, out io)) row.ioBytes = io.readBytes + io.writeBytes;
        }
        finally { CloseHandle(process); }
    }

    private static string ReadImagePath(IntPtr process)
    {
        var path = new StringBuilder(512);
        int length = path.Capacity;
        if (QueryFullProcessImageNameW(process, 0, path, ref length)) return path.ToString();
        const int InsufficientBuffer = 122;
        if (Marshal.GetLastWin32Error() != InsufficientBuffer) return null;
        path = new StringBuilder(32768);
        length = path.Capacity;
        return QueryFullProcessImageNameW(process, 0, path, ref length) ? path.ToString() : null;
    }

    private static string ReadCommandLine(IntPtr process)
    {
        // Windows 11 supports this native query. If the OS or access token
        // does not provide it, the application protects unidentified workloads.
        int size;
        NtQueryInformationProcess(process, ProcessCommandLineInformation, IntPtr.Zero, 0, out size);
        int headerSize = Marshal.SizeOf(typeof(UnicodeString));
        if (size < headerSize || size > 131072) return null;
        IntPtr memory = Marshal.AllocHGlobal(size);
        try
        {
            int returned;
            if (NtQueryInformationProcess(process, ProcessCommandLineInformation, memory, size, out returned) != 0) return null;
            var text = (UnicodeString)Marshal.PtrToStructure(memory, typeof(UnicodeString));
            long offset = text.buffer.ToInt64() - memory.ToInt64();
            if (offset < headerSize || offset > size || text.length > size - offset || text.length % 2 != 0) return null;
            return Marshal.PtrToStringUni(text.buffer, text.length / 2);
        }
        finally { Marshal.FreeHGlobal(memory); }
    }

    private static bool IsFixedDriveExecutable(string path)
    {
        return path != null && path.Length > 7 && char.IsLetter(path[0]) &&
            path[1] == ':' && path[2] == '\\' && path.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) &&
            GetDriveTypeW(path.Substring(0, 3)) == DriveFixed;
    }

    private static string DescribeImage(string path)
    {
        string description;
        if (Names.TryGetValue(path, out description)) return description;
        try { description = FileVersionInfo.GetVersionInfo(path).FileDescription; }
        catch (System.IO.IOException) { description = null; }
        catch (UnauthorizedAccessException) { description = null; }
        if (Names.Count >= 512) Names.Clear();
        Names[path] = String.IsNullOrWhiteSpace(description) ? null : description.Trim();
        return Names[path];
    }

    private static CloseResult RequestClose(uint pid, string expectedToken, string expectedImage)
    {
        var windows = VisibleWindows();
        IntPtr process = OpenProcess(QueryLimitedInformation | Synchronize, false, pid);
        if (process == IntPtr.Zero)
        {
            return Marshal.GetLastWin32Error() == InvalidParameter
                ? Result("exited", "The process already exited.")
                : Result("denied", "Windows did not allow WinOpti to verify the process.");
        }
        try
        {
            long created, exited, kernel, user;
            if (WaitForSingleObject(process, 0) != WaitTimeout ||
                !GetProcessTimes(process, out created, out exited, out kernel, out user) || exited != 0)
                return Result("exited", "The process already exited or its identity became unavailable.");
            string image = ReadImagePath(process);
            if (String.IsNullOrEmpty(expectedToken) ||
                !String.Equals(created.ToString(CultureInfo.InvariantCulture), expectedToken, StringComparison.Ordinal) ||
                image == null || !String.Equals(image, expectedImage, StringComparison.OrdinalIgnoreCase))
                return Result("identity-changed", "The process identity changed since the scan.");
            bool critical;
            uint targetSession, helperSession, shellPid;
            GetWindowThreadProcessId(GetShellWindow(), out shellPid);
            if (pid == GetCurrentProcessId() || pid == shellPid ||
                !IsProcessCritical(process, out critical) || critical ||
                !ProcessIdToSessionId(pid, out targetSession) ||
                !ProcessIdToSessionId(GetCurrentProcessId(), out helperSession) || targetSession != helperSession)
                return Result("denied", "Windows considers this process protected or outside your session.");
            VisibleWindow window;
            uint windowPid;
            if (!windows.TryGetValue(pid, out window) || !IsWindowVisible(window.handle) || !IsWindowEnabled(window.handle) ||
                GetWindowThreadProcessId(window.handle, out windowPid) == 0 || windowPid != pid)
                return Result("no-window", "No eligible main window was available for a normal close.");
            // Keep the verified process handle open across dispatch and confirm
            // the window still belongs to that live process before posting.
            if (WaitForSingleObject(process, 0) != WaitTimeout)
                return Result("exited", "The process exited before the close request.");
            if (!PostMessageW(window.handle, CloseWindowMessage, IntPtr.Zero, IntPtr.Zero))
                return Result("denied", "Windows did not accept the normal close request.");
            return Result("requested", "Sent a normal close request to the app window.");
        }
        finally { CloseHandle(process); }
    }

    private static CloseResult Result(string status, string detail)
    {
        return new CloseResult { status = status, detail = detail };
    }
}
