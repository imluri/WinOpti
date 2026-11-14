using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using System.Threading.Tasks;

public static partial class WinOptiNative
{
    private const ulong DiskSweepIntervalMs = 5000;
    private const ulong DiskFreshnessMs = 12000;
    private static ulong lastDiskSweepStarted;
    private static Task<ProcessDiskSweep> pendingDiskSweep;
    private static ProcessDiskSweep completedDiskSweep;
    private static ProcessDiskDiagnostics diskDiagnostics;

    private sealed class ProcessDiskSample
    {
        public string creationToken;
        public long bytes;
        public ulong tickMs;
        public double? bytesPerSecond;
    }

    private sealed class ProcessDiskSweep
    {
        public Dictionary<uint, ProcessDiskSample> samples = new Dictionary<uint, ProcessDiskSample>();
        public ulong completedTick;
        public long completedAt;
    }

    private sealed class ProcessDiskDiagnostics
    {
        private readonly MethodInfo getProcesses;
        private readonly PropertyInfo processId;
        private readonly PropertyInfo processStart;
        private readonly PropertyInfo diskUsage;
        private readonly MethodInfo getReport;
        private readonly PropertyInfo bytesRead;
        private readonly PropertyInfo bytesWritten;

        public ProcessDiskDiagnostics()
        {
            // Use the .NET Framework's WinRT projection with the inbox Windows metadata.
            // This keeps the standard Windows build independent of a Windows SDK install.
            var type = Type.GetType(
                "Windows.System.Diagnostics.ProcessDiagnosticInfo, Windows.System.Diagnostics, ContentType=WindowsRuntime",
                true);
            getProcesses = type.GetMethod("GetForProcesses");
            processId = type.GetProperty("ProcessId");
            processStart = type.GetProperty("ProcessStartTime");
            diskUsage = type.GetProperty("DiskUsage");
            getReport = diskUsage.PropertyType.GetMethod("GetReport");
            bytesRead = getReport.ReturnType.GetProperty("BytesReadCount");
            bytesWritten = getReport.ReturnType.GetProperty("BytesWrittenCount");
        }

        public ProcessDiskSweep Read(ProcessDiskSweep previous, Dictionary<uint, string> identities)
        {
            var result = new ProcessDiskSweep();
            var processes = (IEnumerable)getProcesses.Invoke(null, null);
            foreach (object process in processes)
            {
                if (process == null) continue;
                try
                {
                    uint pid = (uint)processId.GetValue(process, null);
                    string token;
                    if (!identities.TryGetValue(pid, out token)) continue;
                    var start = (DateTimeOffset)processStart.GetValue(process, null);
                    if (start.ToFileTime().ToString(CultureInfo.InvariantCulture) != token) continue;
                    object usage = diskUsage.GetValue(process, null);
                    if (usage == null) continue;
                    object report = getReport.Invoke(usage, null);
                    if (report == null) continue;
                    ulong tick = GetTickCount64();
                    long read = (long)bytesRead.GetValue(report, null);
                    long written = (long)bytesWritten.GetValue(report, null);
                    if (read < 0 || written < 0 || read > long.MaxValue - written) continue;
                    var reading = new ProcessDiskSample
                    {
                        creationToken = token,
                        bytes = read + written,
                        tickMs = tick
                    };
                    ProcessDiskSample prior;
                    if (previous != null && previous.samples.TryGetValue(pid, out prior) &&
                        prior.creationToken == reading.creationToken &&
                        tick > prior.tickMs && tick - prior.tickMs <= DiskFreshnessMs &&
                        reading.bytes >= prior.bytes)
                        reading.bytesPerSecond = (reading.bytes - prior.bytes) * 1000.0 / (tick - prior.tickMs);
                    result.samples[pid] = reading;
                }
                catch (TargetInvocationException)
                {
                    // Some processes exit during the sweep or withhold the report.
                }
                catch (ArgumentOutOfRangeException)
                {
                    // Windows did not provide a usable process creation timestamp.
                }
            }
            result.completedTick = GetTickCount64();
            result.completedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            return result;
        }
    }

    private static ProcessDiskSweep CollectProcessDisk(ProcessDiskSweep previous, Dictionary<uint, string> identities)
    {
        try
        {
            if (diskDiagnostics == null) diskDiagnostics = new ProcessDiskDiagnostics();
            return diskDiagnostics.Read(previous, identities);
        }
        catch (Exception)
        {
            // WinRT diagnostics may be disabled or inaccessible on some machines.
            return null;
        }
    }

    private static void ApplyProcessDiskRates(LiveProcessSnapshot snapshot)
    {
        if (pendingDiskSweep != null && pendingDiskSweep.IsCompleted)
        {
            completedDiskSweep = pendingDiskSweep.Result;
            pendingDiskSweep = null;
        }
        ulong now = GetTickCount64();
        if (pendingDiskSweep == null &&
            (lastDiskSweepStarted == 0 || now - lastDiskSweepStarted >= DiskSweepIntervalMs))
        {
            lastDiskSweepStarted = now;
            var previous = completedDiskSweep;
            var identities = new Dictionary<uint, string>();
            foreach (var process in snapshot.processes)
                if (process.creationToken != null) identities[process.pid] = process.creationToken;
            // WinRT retrieves these counters one process at a time. One in-flight
            // sweep keeps that work off the fast snapshot path and stops when polling stops.
            pendingDiskSweep = Task.Run(() => CollectProcessDisk(previous, identities));
        }
        var completed = completedDiskSweep;
        if (completed == null || now - completed.completedTick > DiskFreshnessMs) return;
        foreach (var process in snapshot.processes)
        {
            ProcessDiskSample sample;
            if (process.creationToken != null && completed.samples.TryGetValue(process.pid, out sample) &&
                process.creationToken == sample.creationToken && now - sample.tickMs <= DiskFreshnessMs &&
                sample.bytesPerSecond.HasValue)
            {
                process.diskBytesPerSecond = sample.bytesPerSecond;
                snapshot.diskAt = completed.completedAt;
            }
        }
    }
}
