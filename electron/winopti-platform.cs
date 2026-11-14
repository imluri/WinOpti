using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32;

public static partial class WinOptiNative
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
    private const uint PdhMoreData = 0x800007d2;
    private const int ProcessorCoreRelationship = 0;
    private const uint DxgiSoftwareAdapter = 2;

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
    private struct PdhItem
    {
        public IntPtr name;
        public PdhValue data;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct GraphicsAdapterDescription
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string description;
        public uint vendorId, deviceId, subsystemId, revision;
        public UIntPtr dedicatedVideoMemory, dedicatedSystemMemory, sharedSystemMemory;
        public uint luidLow;
        public int luidHigh;
        public uint flags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct UnicodeString
    {
        public ushort length, maximumLength;
        public IntPtr buffer;
    }

    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr state);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int EnumerateAdapter(IntPtr factory, uint index, out IntPtr adapter);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int DescribeAdapter(IntPtr adapter, out GraphicsAdapterDescription description);

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
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetLogicalProcessorInformationEx(int relationship, IntPtr buffer, ref uint length);
    [DllImport("kernel32.dll")]
    private static extern ulong GetTickCount64();
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
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
    private static extern uint PdhGetFormattedCounterArrayW(IntPtr counter, uint format, ref uint bufferSize, out uint count, IntPtr items);
    [DllImport("pdh.dll")]
    private static extern uint PdhCloseQuery(IntPtr query);
    [DllImport("dxgi.dll")]
    private static extern int CreateDXGIFactory1(ref Guid interfaceId, out IntPtr factory);

    public class ProcessTelemetry
    {
        public uint pid { get; set; }
        public uint? parentPid { get; set; }
        public string name { get; set; }
        public string creationToken { get; set; }
        public string executable { get; set; }
        public string displayName { get; set; }
        public string iconPath { get; set; }
        public double? cpuTimeMs { get; set; }
        public ulong? workingSetBytes { get; set; }
        public ulong? ioBytes { get; set; }
        public uint? sessionId { get; set; }
    }

    public sealed class ProcessData : ProcessTelemetry
    {
        public long? startedAt { get; set; }
        public string commandLine { get; set; }
        public string windowTitle { get; set; }
    }

    public sealed class LiveProcess : ProcessTelemetry
    {
        public List<EngineUse> gpuEngines { get; set; }
        public double? diskBytesPerSecond { get; set; }
    }

    public sealed class EngineUse
    {
        public string engine { get; set; }
        public double percent { get; set; }
    }

    public sealed class LiveProcessSnapshot
    {
        public long at { get; set; }
        public ulong tickMs { get; set; }
        public long? diskAt { get; set; }
        public int logicalCpus { get; set; }
        public List<LiveProcess> processes { get; set; }
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

    public sealed class PerformanceSample
    {
        public long at { get; set; }
        public double? cpuPercent { get; set; }
        public ulong? memoryUsedBytes { get; set; }
        public ulong? memoryTotalBytes { get; set; }
        public double? memoryPressurePercent { get; set; }
        public double? diskReadBytesPerSecond { get; set; }
        public double? diskWriteBytesPerSecond { get; set; }
        public double? diskActivePercent { get; set; }
        public double? gpuPercent { get; set; }
        public uint? processCount { get; set; }
        public ulong uptimeSeconds { get; set; }
        public PowerData power { get; set; }
    }

    public sealed class CpuHardware
    {
        public string name { get; set; }
        public int? cores { get; set; }
        public int logicalProcessors { get; set; }
    }

    public sealed class GraphicsHardware
    {
        public string name { get; set; }
        public ulong? dedicatedBytes { get; set; }
        public ulong? sharedBytes { get; set; }
    }

    public sealed class DriveHardware
    {
        public string letter { get; set; }
        public string label { get; set; }
        public long totalBytes { get; set; }
        public long freeBytes { get; set; }
    }

    public sealed class HardwareInfo
    {
        public CpuHardware cpu { get; set; }
        public ulong? memoryTotalBytes { get; set; }
        public List<GraphicsHardware> gpus { get; set; }
        public List<DriveHardware> drives { get; set; }
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
    private sealed class SystemCounters : IDisposable
    {
        private readonly IntPtr query;
        private readonly IntPtr cpu;
        private readonly IntPtr disk;
        private readonly IntPtr diskRead;
        private readonly IntPtr diskWrite;
        private readonly IntPtr diskIdle;
        private readonly IntPtr gpu;
        private readonly Stopwatch clock = Stopwatch.StartNew();
        private long lastCpuTotal, lastCpuIdle;
        private bool hasCpuSample;

        public SystemCounters(bool dashboard)
        {
            if (PdhOpenQueryW(null, IntPtr.Zero, out query) == 0)
            {
                cpu = Add(@"\Processor Information(_Total)\% Processor Time");
                if (dashboard)
                {
                    diskRead = Add(@"\PhysicalDisk(_Total)\Disk Read Bytes/sec");
                    diskWrite = Add(@"\PhysicalDisk(_Total)\Disk Write Bytes/sec");
                    diskIdle = Add(@"\PhysicalDisk(*)\% Idle Time");
                    gpu = Add(@"\GPU Engine(*)\Utilization Percentage");
                }
                else
                {
                    disk = Add(@"\PhysicalDisk(_Total)\Disk Bytes/sec");
                }
                PdhCollectQueryData(query);
            }
            clock.Restart();
            if (LogicalCpuCount() <= 64) CpuFromSystemTimes();
        }

        private IntPtr Add(string path)
        {
            IntPtr handle;
            return PdhAddEnglishCounterW(query, path, IntPtr.Zero, out handle) == 0 ? handle : IntPtr.Zero;
        }

        private bool SampleIntervalElapsed()
        {
            if (clock.ElapsedMilliseconds < 250) return false;
            clock.Restart();
            return true;
        }

        private bool Collect()
        {
            return query != IntPtr.Zero && PdhCollectQueryData(query) == 0;
        }

        public void ReadSnapshot(SnapshotData sample)
        {
            if (!SampleIntervalElapsed()) return;
            if (Collect())
            {
                sample.cpuPercent = Percent(CounterValue(cpu));
                sample.diskBytesPerSecond = CounterValue(disk);
            }
            if (sample.logicalCpus <= 64)
            {
                double? fallback = CpuFromSystemTimes();
                if (!sample.cpuPercent.HasValue) sample.cpuPercent = fallback;
            }
        }

        public void ReadPerformance(PerformanceSample sample)
        {
            if (!SampleIntervalElapsed()) return;
            if (Collect())
            {
                sample.cpuPercent = Percent(CounterValue(cpu));
                sample.diskReadBytesPerSecond = CounterValue(diskRead);
                sample.diskWriteBytesPerSecond = CounterValue(diskWrite);
                sample.diskActivePercent = DiskActivePercent(diskIdle);
                sample.gpuPercent = GpuBusyPercent(gpu);
            }
            if (LogicalCpuCount() <= 64)
            {
                double? fallback = CpuFromSystemTimes();
                if (!sample.cpuPercent.HasValue) sample.cpuPercent = fallback;
            }
        }

        private double? CpuFromSystemTimes()
        {
            long idle, kernel, user;
            if (!GetSystemTimes(out idle, out kernel, out user)) return null;
            long total = kernel + user;
            long elapsed = total - lastCpuTotal;
            long elapsedIdle = idle - lastCpuIdle;
            double? result = hasCpuSample && elapsed > 0
                ? Percent(100.0 * (elapsed - elapsedIdle) / elapsed)
                : null;
            lastCpuTotal = total;
            lastCpuIdle = idle;
            hasCpuSample = true;
            return result;
        }

        public void Dispose()
        {
            if (query != IntPtr.Zero) PdhCloseQuery(query);
        }
    }

    private static SystemCounters scanCounters;
    private static SystemCounters dashboardCounters;
    private static ProcessGpuCounters processGpuCounters;
    private static Dictionary<uint, LiveProcess> previousLiveProcesses = new Dictionary<uint, LiveProcess>();

    private sealed class ProcessGpuCounters : IDisposable
    {
        private readonly IntPtr query;
        private readonly IntPtr gpu;
        private readonly Stopwatch clock = Stopwatch.StartNew();

        public ProcessGpuCounters()
        {
            if (PdhOpenQueryW(null, IntPtr.Zero, out query) == 0 &&
                PdhAddEnglishCounterW(query, @"\GPU Engine(*)\Utilization Percentage", IntPtr.Zero, out gpu) != 0)
                gpu = IntPtr.Zero;
            if (gpu != IntPtr.Zero) PdhCollectQueryData(query);
            clock.Restart();
        }

        public void Apply(List<LiveProcess> processes, Dictionary<uint, LiveProcess> previous)
        {
            long elapsed = clock.ElapsedMilliseconds;
            if (gpu == IntPtr.Zero || elapsed < 250) return;
            clock.Restart();
            // Re-prime after the page was closed or sampling was suspended.
            if (PdhCollectQueryData(query) != 0 || elapsed > 3500) return;
            var readings = ReadProcessGpuEngines(gpu);
            if (readings == null) return;
            foreach (var process in processes)
            {
                LiveProcess prior;
                if (process.creationToken == null || !previous.TryGetValue(process.pid, out prior) ||
                    process.creationToken != prior.creationToken) continue;
                Dictionary<string, double> engines;
                if (readings.TryGetValue(process.pid, out engines) && engines.Count == 0) continue;
                process.gpuEngines = new List<EngineUse>();
                if (engines == null) continue;
                foreach (var engine in engines)
                    process.gpuEngines.Add(new EngineUse { engine = engine.Key, percent = engine.Value });
            }
        }

        public void Dispose()
        {
            if (query != IntPtr.Zero) PdhCloseQuery(query);
        }
    }

    // One JSON request and response per line. Command lines travel only over
    // the local pipe to WinOpti's trusted main process.
    public static void Main()
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        var json = new JavaScriptSerializer { MaxJsonLength = 32 * 1024 * 1024 };
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
                    else if (request.action == "processes") response.result = ReadLiveProcessSnapshot();
                    else if (request.action == "performance") response.result = ReadPerformance();
                    else if (request.action == "hardware") response.result = ReadHardware();
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
            if (scanCounters != null) scanCounters.Dispose();
            if (dashboardCounters != null) dashboardCounters.Dispose();
            if (processGpuCounters != null) processGpuCounters.Dispose();
        }
    }

    private static int LogicalCpuCount()
    {
        uint count = GetActiveProcessorCount((ushort)AllProcessorGroups);
        return count == 0 ? Environment.ProcessorCount : (int)count;
    }

    private static SnapshotData Snapshot()
    {
        if (scanCounters == null) scanCounters = new SystemCounters(false);
        PerformanceInfo info;
        var sample = new SnapshotData
        {
            at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            logicalCpus = LogicalCpuCount(),
            memoryPressurePercent = ReadMemory(out info) ? CommitPressure(info) : null,
            power = ReadPower()
        };
        scanCounters.ReadSnapshot(sample);
        sample.processes = ReadProcesses();
        return sample;
    }

    private static double? CounterValue(IntPtr counter)
    {
        PdhValue value;
        if (counter == IntPtr.Zero ||
            PdhGetFormattedCounterValue(counter, PdhFormatDouble, IntPtr.Zero, out value) != 0 ||
            !Valid(value)) return null;
        return value.value;
    }

    private static bool Valid(PdhValue value)
    {
        return value.status <= 1 && !double.IsNaN(value.value) && !double.IsInfinity(value.value) && value.value >= 0;
    }

    private static double? Percent(double? value)
    {
        return value.HasValue ? (double?)Math.Max(0, Math.Min(100, value.Value)) : null;
    }

    private static bool ReadMemory(out PerformanceInfo info)
    {
        info = new PerformanceInfo { size = (uint)Marshal.SizeOf(typeof(PerformanceInfo)) };
        return GetPerformanceInfo(ref info, info.size);
    }

    private static double? CommitPressure(PerformanceInfo info)
    {
        if (info.commitLimit == UIntPtr.Zero) return null;
        return 100.0 * info.commitTotal.ToUInt64() / info.commitLimit.ToUInt64();
    }

    private static ulong PhysicalMemoryBytes(PerformanceInfo info)
    {
        return info.physicalTotal.ToUInt64() * info.pageSize.ToUInt64();
    }

    private static PerformanceSample ReadPerformance()
    {
        if (dashboardCounters == null) dashboardCounters = new SystemCounters(true);
        var sample = new PerformanceSample
        {
            at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            uptimeSeconds = GetTickCount64() / 1000,
            power = ReadPower()
        };
        PerformanceInfo info;
        if (ReadMemory(out info))
        {
            sample.memoryTotalBytes = PhysicalMemoryBytes(info);
            ulong available = info.physicalAvailable.ToUInt64() * info.pageSize.ToUInt64();
            sample.memoryUsedBytes = sample.memoryTotalBytes.Value - Math.Min(sample.memoryTotalBytes.Value, available);
            sample.memoryPressurePercent = CommitPressure(info);
            sample.processCount = info.processCount;
        }
        dashboardCounters.ReadPerformance(sample);
        return sample;
    }

    private static IEnumerable<PdhItem> CounterItems(IntPtr counter, bool includeInvalid = false)
    {
        if (counter == IntPtr.Zero) yield break;
        uint bytes = 0;
        uint count;
        if (PdhGetFormattedCounterArrayW(counter, PdhFormatDouble, ref bytes, out count, IntPtr.Zero) != PdhMoreData ||
            bytes == 0 || bytes > 16 * 1024 * 1024) yield break;
        IntPtr buffer = Marshal.AllocHGlobal((int)bytes);
        try
        {
            int itemSize = Marshal.SizeOf(typeof(PdhItem));
            if (PdhGetFormattedCounterArrayW(counter, PdhFormatDouble, ref bytes, out count, buffer) != 0 ||
                count > bytes / itemSize) yield break;
            for (int i = 0; i < count; i++)
            {
                var item = (PdhItem)Marshal.PtrToStructure(IntPtr.Add(buffer, i * itemSize), typeof(PdhItem));
                if (item.name != IntPtr.Zero && (includeInvalid || Valid(item.data))) yield return item;
            }
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    private static double? DiskActivePercent(IntPtr counter)
    {
        double? busiest = null;
        foreach (var item in CounterItems(counter))
        {
            if (String.Equals(Marshal.PtrToStringUni(item.name), "_Total", StringComparison.OrdinalIgnoreCase)) continue;
            double active = 100 - item.data.value;
            if (!busiest.HasValue || active > busiest.Value) busiest = active;
        }
        return Percent(busiest);
    }

    private static double? GpuBusyPercent(IntPtr counter)
    {
        var engines = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        double? busiest = null;
        foreach (var item in CounterItems(counter))
        {
            string name = Marshal.PtrToStringUni(item.name);
            // Windows exposes a per-process instance for each engine. Combine
            // processes on the same engine, then report the busiest engine.
            int engineOffset = name.IndexOf("_luid_", StringComparison.OrdinalIgnoreCase);
            if (engineOffset < 0 || name.IndexOf("_eng_", engineOffset, StringComparison.OrdinalIgnoreCase) < 0) continue;
            string engine = name.Substring(engineOffset);
            double previous;
            engines.TryGetValue(engine, out previous);
            double utilization = previous + item.data.value;
            engines[engine] = utilization;
            if (!busiest.HasValue || utilization > busiest.Value) busiest = utilization;
        }
        return Percent(busiest);
    }

    private static Dictionary<uint, Dictionary<string, double>> ReadProcessGpuEngines(IntPtr counter)
    {
        var result = new Dictionary<uint, Dictionary<string, double>>();
        bool hasValidReading = false;
        foreach (var item in CounterItems(counter, true))
        {
            string name = Marshal.PtrToStringUni(item.name);
            if (!name.StartsWith("pid_", StringComparison.OrdinalIgnoreCase)) continue;
            int engineStart = name.IndexOf("_luid_", StringComparison.OrdinalIgnoreCase);
            if (engineStart <= 4) continue;
            int engineIndex = name.IndexOf("_eng_", engineStart, StringComparison.OrdinalIgnoreCase);
            int engineEnd = engineIndex < 0 ? -1 : name.IndexOf("_engtype_", engineIndex, StringComparison.OrdinalIgnoreCase);
            uint pid;
            if (engineEnd < 0 || !uint.TryParse(name.Substring(4, engineStart - 4),
                NumberStyles.None, CultureInfo.InvariantCulture, out pid)) continue;

            Dictionary<string, double> engines;
            if (!result.TryGetValue(pid, out engines))
            {
                engines = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
                result.Add(pid, engines);
            }
            if (!Valid(item.data)) continue;
            hasValidReading = true;
            string engine = name.Substring(engineStart + 1, engineEnd - engineStart - 1);
            double previous;
            if (!engines.TryGetValue(engine, out previous) || previous < item.data.value)
                engines[engine] = Math.Min(100, item.data.value);
        }
        return hasValidReading ? result : null;
    }

    private static HardwareInfo ReadHardware()
    {
        PerformanceInfo info;
        return new HardwareInfo
        {
            cpu = new CpuHardware { name = ProcessorName(), cores = PhysicalCoreCount(), logicalProcessors = LogicalCpuCount() },
            memoryTotalBytes = ReadMemory(out info) ? (ulong?)PhysicalMemoryBytes(info) : null,
            gpus = GraphicsAdapters(),
            drives = FixedVolumes()
        };
    }

    private static string ProcessorName()
    {
        try
        {
            using (RegistryKey key = Registry.LocalMachine.OpenSubKey(@"HARDWARE\DESCRIPTION\System\CentralProcessor\0"))
            {
                string name = key == null ? null : key.GetValue("ProcessorNameString") as string;
                return String.IsNullOrWhiteSpace(name) ? null : name.Trim();
            }
        }
        catch (System.Security.SecurityException) { return null; }
        catch (UnauthorizedAccessException) { return null; }
        catch (IOException) { return null; }
    }

    private static int? PhysicalCoreCount()
    {
        uint bytes = 0;
        GetLogicalProcessorInformationEx(ProcessorCoreRelationship, IntPtr.Zero, ref bytes);
        if (bytes < 8 || bytes > 1024 * 1024) return null;
        IntPtr buffer = Marshal.AllocHGlobal((int)bytes);
        try
        {
            if (!GetLogicalProcessorInformationEx(ProcessorCoreRelationship, buffer, ref bytes)) return null;
            int cores = 0;
            int offset = 0;
            while (offset <= bytes - 8)
            {
                int kind = Marshal.ReadInt32(buffer, offset);
                int size = Marshal.ReadInt32(buffer, offset + 4);
                if (size < 8 || size > bytes - offset) return null;
                if (kind == ProcessorCoreRelationship) cores++;
                offset += size;
            }
            return offset == bytes && cores > 0 ? (int?)cores : null;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    private static List<GraphicsHardware> GraphicsAdapters()
    {
        var adapters = new List<GraphicsHardware>();
        var seenAdapters = new HashSet<long>();
        Guid factoryId = new Guid("770aae78-f26f-4dba-a829-253c83d1b387"); // IDXGIFactory1
        IntPtr factory;
        if (CreateDXGIFactory1(ref factoryId, out factory) != 0 || factory == IntPtr.Zero) return adapters;
        try
        {
            // Slots include the inherited IUnknown and DXGI methods.
            const int enumAdapters1Slot = 12;
            const int getDesc1Slot = 10;
            var enumerate = (EnumerateAdapter)ComMethod(factory, enumAdapters1Slot, typeof(EnumerateAdapter));
            for (uint index = 0; index < 64; index++)
            {
                IntPtr adapter;
                if (enumerate(factory, index, out adapter) != 0 || adapter == IntPtr.Zero) break;
                try
                {
                    var describe = (DescribeAdapter)ComMethod(adapter, getDesc1Slot, typeof(DescribeAdapter));
                    GraphicsAdapterDescription description;
                    if (describe(adapter, out description) != 0 || (description.flags & DxgiSoftwareAdapter) != 0 ||
                        String.IsNullOrWhiteSpace(description.description)) continue;
                    long luid = ((long)description.luidHigh << 32) | description.luidLow;
                    if (!seenAdapters.Add(luid)) continue;
                    adapters.Add(new GraphicsHardware
                    {
                        name = description.description.Trim(),
                        dedicatedBytes = description.dedicatedVideoMemory.ToUInt64(),
                        sharedBytes = description.sharedSystemMemory.ToUInt64()
                    });
                }
                finally { Marshal.Release(adapter); }
            }
        }
        finally { Marshal.Release(factory); }
        return adapters;
    }

    private static Delegate ComMethod(IntPtr instance, int slot, Type signature)
    {
        IntPtr table = Marshal.ReadIntPtr(instance);
        return Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(table, slot * IntPtr.Size), signature);
    }

    private static List<DriveHardware> FixedVolumes()
    {
        var volumes = new List<DriveHardware>();
        foreach (DriveInfo drive in DriveInfo.GetDrives())
        {
            if (drive.DriveType != DriveType.Fixed || !drive.IsReady) continue;
            try
            {
                long total = drive.TotalSize;
                if (total <= 0) continue;
                volumes.Add(new DriveHardware
                {
                    letter = drive.Name.TrimEnd('\\'),
                    label = drive.VolumeLabel,
                    totalBytes = total,
                    freeBytes = drive.TotalFreeSpace
                });
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
        return volumes;
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

    private static LiveProcessSnapshot ReadLiveProcessSnapshot()
    {
        if (processGpuCounters == null) processGpuCounters = new ProcessGpuCounters();
        var snapshot = new LiveProcessSnapshot
        {
            at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            tickMs = GetTickCount64(),
            logicalCpus = LogicalCpuCount(),
            processes = new List<LiveProcess>()
        };
        uint currentSession;
        bool knowsSession = ProcessIdToSessionId(GetCurrentProcessId(), out currentSession);
        var entry = new ProcessEntry { size = (uint)Marshal.SizeOf(typeof(ProcessEntry)) };
        IntPtr list = CreateToolhelp32Snapshot(SnapshotProcesses, 0);
        if (list == new IntPtr(-1)) throw new InvalidOperationException("Could not list Windows processes.");
        try
        {
            if (!Process32FirstW(list, ref entry)) throw new InvalidOperationException("Could not read Windows processes.");
            do
            {
                if (entry.pid == 0) continue;
                var row = new LiveProcess
                {
                    pid = entry.pid,
                    parentPid = entry.parentPid == 0 ? (uint?)null : entry.parentPid,
                    name = entry.name
                };
                uint session;
                if (ProcessIdToSessionId(entry.pid, out session)) row.sessionId = session;
                if (ReadLiveProcessDetails(row, knowsSession && row.sessionId == currentSession))
                    snapshot.processes.Add(row);
            } while (Process32NextW(list, ref entry));
        }
        finally { CloseHandle(list); }

        processGpuCounters.Apply(snapshot.processes, previousLiveProcesses);
        ApplyProcessDiskRates(snapshot);
        var current = new Dictionary<uint, LiveProcess>();
        foreach (var row in snapshot.processes) current[row.pid] = row;
        previousLiveProcesses = current;
        return snapshot;
    }

    private static bool ReadLiveProcessDetails(LiveProcess row, bool sameSession)
    {
        IntPtr process = OpenProcess(QueryLimitedInformation, false, row.pid);
        if (process == IntPtr.Zero) return Marshal.GetLastWin32Error() != InvalidParameter;
        try
        {
            long created, exited, kernel, user;
            if (GetProcessTimes(process, out created, out exited, out kernel, out user))
            {
                if (exited != 0) return false;
                if (created > 0)
                {
                    row.creationToken = created.ToString(CultureInfo.InvariantCulture);
                    row.cpuTimeMs = (kernel + user) / 10000.0;
                }
            }
            if (sameSession && row.creationToken != null)
            {
                LiveProcess previous;
                if (previousLiveProcesses.TryGetValue(row.pid, out previous) &&
                    previous.creationToken == row.creationToken && previous.executable != null)
                {
                    row.executable = previous.executable;
                    row.displayName = previous.displayName;
                    row.iconPath = previous.iconPath;
                }
                else
                {
                    row.executable = ReadImagePath(process);
                    if (IsFixedDriveExecutable(row.executable))
                    {
                        row.iconPath = row.executable;
                        row.displayName = DescribeImage(row.executable);
                    }
                }
            }
            ReadProcessResources(process, row);
            return true;
        }
        finally { CloseHandle(process); }
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
            ReadProcessResources(process, row);
        }
        finally { CloseHandle(process); }
    }

    private static void ReadProcessResources(IntPtr process, ProcessTelemetry row)
    {
        var memory = new ProcessMemory { size = (uint)Marshal.SizeOf(typeof(ProcessMemory)) };
        if (GetProcessMemoryInfo(process, ref memory, memory.size)) row.workingSetBytes = memory.workingSet.ToUInt64();
        IoCounters io;
        if (GetProcessIoCounters(process, out io)) row.ioBytes = io.readBytes + io.writeBytes;
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
