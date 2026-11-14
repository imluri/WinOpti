export interface ProcessIdentity {
  pid: number;
  startedAt: number;
  executable: string;
  creationToken?: string;
}

export interface RawProcess {
  pid: number;
  startedAt: number | null;
  executable: string | null;
  creationToken?: string;
  parentPid: number | null;
  name: string;
  commandLine: string | null;
  cpuTimeMs: number | null;
  workingSetBytes: number | null;
  ioBytes: number | null;
  windowTitle: string | null;
  sessionId: number | null;
  displayName?: string | null;
  iconPath?: string | null;
}

export interface PowerStatus {
  source: 'plugged-in' | 'battery' | 'unknown';
  batteryPercent: number | null;
  saver: boolean | null;
}

export interface Snapshot {
  at: number;
  logicalCpus: number;
  processes: RawProcess[];
  cpuPercent: number | null;
  memoryPressurePercent: number | null;
  diskBytesPerSecond: number | null;
  power: PowerStatus;
}

export interface CaptureConditions {
  game: string;
  gameExecutable: string;
  scene: string;
  graphics: string;
  frameCap: string;
  durationSeconds: number;
  sampleIntervalSeconds?: number;
}

export interface Metrics {
  cpuPercent: number | null;
  memoryBytes: number | null;
  ioBytesPerSecond: number | null;
}

export interface ResourceSummary {
  backgroundCpuPercent: number | null;
  memoryPressurePercent: number | null;
  diskBytesPerSecond: number | null;
  systemCpuPercent: number | null;
}

export interface Finding {
  id: string;
  name: string;
  executable: string | null;
  processCount: number;
  average: Metrics;
  peak: Metrics;
  markerPeak: Metrics;
  observations: string[];
  reason: string;
  disposition: 'candidate' | 'protected' | 'other';
  icon?: string | null;
}

export interface FrameTimes {
  gameExecutable: string;
  timesMs: number[];
  durationSeconds: number;
  reliable: boolean;
  source?: 'presentmon-display' | 'presentmon-present' | 'presentmon-app' | 'preview';
}

export interface Capture {
  id: string;
  startedAt: number;
  durationSeconds: number;
  conditions: CaptureConditions;
  power: PowerStatus;
  powerChanged: boolean;
  sampleCount: number;
  markers: number[];
  resources: ResourceSummary;
  findings: Finding[];
  frameTimes: FrameTimes | null;
  timeline?: { second: number; resources: ResourceSummary }[];
}

export const recurringScanInterval = { minimum: 1, maximum: 60, default: 5 };

export interface RecurringScanSettings {
  enabled: boolean;
  intervalMinutes: number;
  conditions: CaptureConditions | null;
}

export interface RecurringScanState extends RecurringScanSettings {
  nextScanAt: number | null;
  running: boolean;
  latest: Capture | null;
  error: string | null;
}

export interface CloseResult {
  id: string;
  name: string;
  status: 'closed' | 'stayed-open' | 'exited' | 'identity-changed' | 'protected' | 'no-window' | 'denied';
  detail: string;
}

export interface FrameSummary {
  p95Ms: number;
  p99Ms: number;
  spikesPerMinute: number;
}

export interface Comparison {
  outcome: 'Stutter decreased' | 'Background load decreased' | 'No clear change' | 'Not enough data';
  differences: string[];
  spikeThresholdMs: number;
  baselineFrame: FrameSummary | null;
  followupFrame: FrameSummary | null;
  frameComparable: boolean;
}

const spikeThresholdMs = 33.3;
const minimumSamples = 3;
export const sampleIntervals = [1, 2, 3, 5] as const;
export const minimumCaptureDuration = (interval: number) => Math.max(5, minimumSamples * interval);
const mib = 1024 * 1024;

export function frameDurationTolerance(durationSeconds: number): number {
  return Math.max(2, durationSeconds * 0.1);
}

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function normalizedPath(value: string): string {
  return normalized(value).replace(/^"|"$/g, '').replaceAll('/', '\\').replace(/^\\\\\?\\/, '');
}

function baseName(path: string): string {
  return normalizedPath(path).split('\\').at(-1) ?? '';
}

function matchesExecutable(left: string, right: string): boolean {
  const a = normalizedPath(left);
  const b = normalizedPath(right);
  if (!a || !b) return false;
  return a === b || ((!a.includes('\\') || !b.includes('\\')) && baseName(a) === baseName(b));
}

function frameSummary(capture: Capture): FrameSummary | null {
  const frames = capture.frameTimes;
  if (!frames?.reliable || !frames.gameExecutable.trim() || frames.timesMs.length < 120
    || !Number.isFinite(frames.durationSeconds) || frames.durationSeconds <= 0
    || Math.abs(capture.durationSeconds - frames.durationSeconds) > frameDurationTolerance(capture.durationSeconds)
    || (capture.conditions.gameExecutable.trim() && !matchesExecutable(capture.conditions.gameExecutable, frames.gameExecutable))
    || frames.timesMs.some((time) => !Number.isFinite(time) || time <= 0)) return null;

  const sorted = [...frames.timesMs].sort((a, b) => a - b);
  const measuredSeconds = sorted.reduce((sum, time) => sum + time, 0) / 1000;
  if (Math.abs(measuredSeconds - frames.durationSeconds) > frameDurationTolerance(frames.durationSeconds)) return null;
  return {
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    p99Ms: sorted[Math.ceil(sorted.length * 0.99) - 1],
    spikesPerMinute: sorted.filter((time) => time > spikeThresholdMs).length * 60 / frames.durationSeconds,
  };
}

function captureDifferences(baseline: Capture, followup: Capture): string[] {
  const differences: string[] = [];
  const a = baseline.conditions;
  const b = followup.conditions;
  const gameA = a.gameExecutable || baseline.frameTimes?.gameExecutable || a.game;
  const gameB = b.gameExecutable || followup.frameTimes?.gameExecutable || b.game;
  if (!gameA.trim() || !gameB.trim()) differences.push('Game was not recorded for both captures.');
  else if (!matchesExecutable(gameA, gameB)) differences.push('Game differed between captures.');

  const textConditions = [
    ['Scene or route', a.scene, b.scene],
    ['Graphics settings', a.graphics, b.graphics],
    ['Frame cap', a.frameCap, b.frameCap],
  ];
  for (const [label, before, after] of textConditions) {
    if (!before.trim() || !after.trim()) differences.push(`${label} was not recorded for both captures.`);
    else if (normalized(before) !== normalized(after)) differences.push(`${label} differed between captures.`);
  }

  if (a.durationSeconds !== b.durationSeconds
    || Math.abs(baseline.durationSeconds - followup.durationSeconds) > Math.max(1, a.durationSeconds * 0.05)) {
    differences.push('Capture duration differed between captures.');
  }
  if ((a.sampleIntervalSeconds ?? 1) !== (b.sampleIntervalSeconds ?? 1)) {
    differences.push('Sampling interval differed between captures.');
  }

  if (baseline.power.source === 'unknown' || followup.power.source === 'unknown') {
    differences.push('Power source was unavailable for one or both captures.');
  } else if (baseline.power.source !== followup.power.source) {
    differences.push('Power source differed between captures.');
  }
  if (baseline.power.saver === null || followup.power.saver === null) {
    differences.push('Battery Saver status was unavailable for one or both captures.');
  } else if (baseline.power.saver !== followup.power.saver) {
    differences.push('Battery Saver status differed between captures.');
  }
  if (baseline.powerChanged || followup.powerChanged) differences.push('Power state changed during a capture.');
  return differences;
}

function materialChange(before: number, after: number, absolute: number, relative: number): number {
  const change = after - before;
  return Math.abs(change) >= Math.max(absolute, before * relative) ? Math.sign(change) : 0;
}

export function compareCaptures(baseline: Capture, followup: Capture): Comparison {
  const differences = captureDifferences(baseline, followup);
  const baselineFrame = frameSummary(baseline);
  const followupFrame = frameSummary(followup);
  const frameComparable = Boolean(baselineFrame && followupFrame && baseline.frameTimes && followup.frameTimes
    && matchesExecutable(baseline.frameTimes.gameExecutable, followup.frameTimes.gameExecutable));
  if (baselineFrame && followupFrame && !frameComparable) differences.push('Frame times came from different games.');
  const frameSourcesDiffer = Boolean(baselineFrame && followupFrame && baseline.frameTimes?.source && followup.frameTimes?.source
    && baseline.frameTimes.source !== followup.frameTimes.source);
  if (frameSourcesDiffer) {
    differences.push('Frame-time measurement sources differed between captures.');
  }

  const enoughResourceSamples = baseline.sampleCount >= minimumSamples && followup.sampleCount >= minimumSamples;
  const resourceThresholds = [
    ['backgroundCpuPercent', 2, 0.15],
    ['memoryPressurePercent', 3, 0.07],
    ['diskBytesPerSecond', mib, 0.2],
  ] as const;
  const resourceChanges: number[] = [];
  if (enoughResourceSamples) {
    for (const [key, absolute, relative] of resourceThresholds) {
      const before = baseline.resources[key];
      const after = followup.resources[key];
      if (before !== null && after !== null) resourceChanges.push(materialChange(before, after, absolute, relative));
    }
  }

  let outcome: Comparison['outcome'] = 'Not enough data';
  if (resourceChanges.length || (frameComparable && differences.length === 0)) outcome = 'No clear change';
  if (resourceChanges.includes(-1) && !resourceChanges.includes(1)) outcome = 'Background load decreased';

  if (frameComparable && differences.length === 0 && baselineFrame && followupFrame) {
    const p95 = materialChange(baselineFrame.p95Ms, followupFrame.p95Ms, 1, 0.08);
    const p99 = materialChange(baselineFrame.p99Ms, followupFrame.p99Ms, 1, 0.08);
    const spikes = materialChange(baselineFrame.spikesPerMinute, followupFrame.spikesPerMinute, 1, 0.15);
    if ((p99 < 0 || spikes < 0) && p95 <= 0 && p99 <= 0 && spikes <= 0) outcome = 'Stutter decreased';
  }

  return { outcome, differences, spikeThresholdMs, baselineFrame, followupFrame, frameComparable: frameComparable && !frameSourcesDiffer };
}

export interface ClassificationOptions {
  alwaysProtect: readonly string[];
  conditions: CaptureConditions;
  ownPid: number;
}

export interface AppGroup {
  id: string;
  name: string;
  executable: string | null;
  processes: RawProcess[];
  windowTargets: ProcessIdentity[];
  protection: string | null;
  background: boolean;
}

export function matchesAlwaysProtect(items: readonly string[], executable: string | null, displayName: string): boolean {
  const stem = baseName(executable ?? '').replace(/\.exe$/, '');
  return items.some((item) => {
    const value = normalized(item);
    return Boolean(value && (matchesExecutable(value, executable ?? '') || value === normalized(displayName) || value === stem));
  });
}

const nodeExecutables = new Set(['node.exe', 'nodejs.exe', 'iojs.exe']);
const jsRuntimes = new Set([...nodeExecutables, 'bun.exe', 'bunx.exe', 'deno.exe']);
const packageManagers = new Set(['npm.exe', 'npx.exe', 'pnpm.exe', 'pnpx.exe', 'yarn.exe', 'yarnpkg.exe', 'corepack.exe']);
const devTools = new Set(['esbuild.exe', 'tsc.exe', 'vite.exe', 'webpack.exe', 'rollup.exe', 'msbuild.exe', 'ninja.exe', 'cmake.exe']);
const terminals = new Set([
  'cmd.exe', 'powershell.exe', 'powershell_ise.exe', 'pwsh.exe', 'bash.exe', 'sh.exe', 'zsh.exe', 'fish.exe',
  'wsl.exe', 'wslhost.exe', 'wslservice.exe', 'windowsterminal.exe', 'openconsole.exe', 'conhost.exe',
  'mintty.exe', 'alacritty.exe', 'wezterm-gui.exe', 'conemu64.exe', 'hyper.exe', 'wt.exe',
]);
const developerApps = new Set([
  'code.exe', 'code - insiders.exe', 'cursor.exe', 'windsurf.exe', 'zed.exe', 'devenv.exe', 'idea64.exe', 'webstorm64.exe',
]);
const launchersWithDetachedJobs = new Set([
  'githubdesktop.exe', 'sourcetree.exe', 'fork.exe', 'docker desktop.exe', 'jetbrains-toolbox.exe',
]);
const shellBoundary = new Set([
  'system', 'idle', 'explorer.exe', 'taskmgr.exe', 'services.exe', 'svchost.exe', 'wininit.exe', 'winlogon.exe',
  'userinit.exe', 'sihost.exe', 'runtimebroker.exe', 'shellexperiencehost.exe', 'startmenuexperiencehost.exe',
]);

function processName(process: RawProcess): string {
  return baseName(process.executable || process.name);
}

function isWindowsProcess(process: RawProcess): boolean {
  const path = normalizedPath(process.executable ?? '');
  const underWindows = /^[a-z]:\\windows\\/.test(path);
  return process.pid <= 4 || process.sessionId === 0 || shellBoundary.has(processName(process))
    || (underWindows && /\\(?:system32|syswow64|systemapps|servicing|winsxs)\\/.test(path));
}

function processIdentity(process: RawProcess): ProcessIdentity | null {
  if (process.startedAt === null || !Number.isFinite(process.startedAt) || !process.executable?.trim()) return null;
  return {
    pid: process.pid, startedAt: process.startedAt, executable: process.executable,
    ...(process.creationToken ? { creationToken: process.creationToken } : {}),
  };
}

export function sameProcess(left: ProcessIdentity, right: ProcessIdentity): boolean {
  return left.pid === right.pid && left.startedAt === right.startedAt
    && left.creationToken === right.creationToken
    && normalizedPath(left.executable) === normalizedPath(right.executable);
}

function developerReason(process: RawProcess): string | null {
  const name = processName(process);
  const command = normalized(process.commandLine ?? '').replaceAll('\\', '/');
  if (packageManagers.has(name)) return 'Active package-manager job';
  const scripts = jsRuntimes.has(name) || terminals.has(name) || devTools.has(name);
  if (scripts && command) {
    if (/(?:^|[\s/"'])(?:vite(?:\.(?:c?js|mjs|cmd|exe))?)(?=$|[\s"'])/.test(command)) {
      return /(?:^|\s)build(?=\s|$)/.test(command) ? 'Active Vite build' : 'Active Vite dev server';
    }
    if (name === 'bun.exe' && /(?:^|\s)(?:["'][^"']+\.html?["']|[^\s"']+\.html?)(?=\s|$)/.test(command)) {
      return /(?:^|\s)build(?=\s|$)/.test(command) ? 'Active Bun build' : 'Active Bun development server';
    }
    if (/(?:^|[\s/"'])(?:vitest|jest|mocha|playwright|tsx\s+watch|nodemon)(?:[\s/"'.]|$)/.test(command)
      || /(?:^|\s)(?:test|--watch)(?:\s|$)/.test(command)) return 'Active test or watch job';
    if (/(?:^|[\s/"'])(?:next|nuxt|astro|remix|webpack-dev-server|react-scripts)(?:[\s/"'.]|$)/.test(command)
      && /(?:^|\s)(?:dev|start|serve)(?:\s|$)/.test(command)) return 'Active development server';
    if (/(?:^|[\s/"'])(?:esbuild|webpack|rollup|tsc|parcel|swc|turbo|nx)(?:[\s/"'.]|$)/.test(command)
      || /(?:^|\s)(?:run\s+)?build(?:\s|$)/.test(command)) return 'Active build tool';
    if (/(?:^|[\s/"'])(?:npm|npx|pnpm|pnpx|yarn|yarnpkg|corepack)(?:-cli)?(?:\.[a-z]+)?(?=[\s/"']|$)/.test(command)
      || /(?:^|[\s/"'])(?:bun|deno)(?:\.exe)?["']?\s+(?:run|install|add|update|remove|exec|x)(?:\s|$)/.test(command)) {
      return 'Active package-manager job';
    }
  }
  if (nodeExecutables.has(name)) return 'Could not identify this Node.js workload';
  if (jsRuntimes.has(name)) return 'Could not identify this JavaScript workload';
  if (devTools.has(name)) return 'Active build tool';
  return null;
}

function gameMatches(process: RawProcess, conditions: CaptureConditions): boolean {
  if (conditions.gameExecutable.trim()) {
    return matchesExecutable(conditions.gameExecutable, process.executable ?? process.name);
  }
  const game = normalized(conditions.game);
  return Boolean(game && (normalized(process.displayName ?? '') === game || processName(process).replace(/\.exe$/, '') === game));
}

function timeOrder(parent: RawProcess, child: RawProcess): boolean {
  if (parent.creationToken && child.creationToken) {
    const a = parent.creationToken.padStart(24, '0');
    const b = child.creationToken.padStart(24, '0');
    return a <= b;
  }
  return parent.startedAt !== null && child.startedAt !== null && parent.startedAt < child.startedAt;
}

function appPathKey(process: RawProcess): string {
  const path = normalizedPath(process.executable ?? '');
  return path ? `${process.sessionId ?? 'unknown'}:${path}`
    : `${process.sessionId ?? 'unknown'}:pid:${process.pid}:${process.creationToken ?? process.startedAt ?? 'unknown'}`;
}

function appGroupKey(process: RawProcess): string {
  const path = appPathKey(process);
  if (!jsRuntimes.has(processName(process)) && !packageManagers.has(processName(process))) return path;
  return `${path}:job:${process.pid}:${process.creationToken ?? process.startedAt ?? 'unknown'}`;
}

function mayGroupWithParent(child: RawProcess, parent: RawProcess): boolean {
  if (isWindowsProcess(child) || isWindowsProcess(parent) || child.windowTitle !== null) return false;
  if (processName(child) === processName(parent) && appPathKey(child) === appPathKey(parent)) return true;
  const childPath = normalizedPath(child.executable ?? '');
  const parentPath = normalizedPath(parent.executable ?? '');
  const parentDirectory = parentPath.slice(0, parentPath.lastIndexOf('\\') + 1);
  const genericDirectory = /^[a-z]:\\(?:program files(?: \(x86\))?\\|users\\[^\\]+\\(?:appdata\\(?:local|roaming)\\)?|)$/;
  return Boolean(parentDirectory && !genericDirectory.test(parentDirectory) && childPath.startsWith(parentDirectory));
}

export function classifyApps(snapshot: Snapshot, options: ClassificationOptions): AppGroup[] {
  const byPid = new Map(snapshot.processes.map((process) => [process.pid, process]));
  const ownSession = byPid.get(options.ownPid)?.sessionId ?? null;
  const parents = new Map<number, RawProcess>();
  const children = new Map<number, RawProcess[]>();
  for (const process of snapshot.processes) {
    const parent = process.parentPid === null ? undefined : byPid.get(process.parentPid);
    if (!parent || parent.pid === process.pid || parent.sessionId !== process.sessionId || !timeOrder(parent, process)) continue;
    parents.set(process.pid, parent);
    const siblings = children.get(parent.pid) ?? [];
    siblings.push(process);
    children.set(parent.pid, siblings);
  }

  const reasons = new Map<number, string>();
  const ownTree = new Set<number>();
  const gameTree = new Set<number>();
  const seen = new Set<number>();
  function protectTree(start: RawProcess, reason: string, members?: Set<number>) {
    const pending = [start];
    seen.clear();
    while (pending.length) {
      const current = pending.pop()!;
      if (seen.has(current.pid)) continue;
      seen.add(current.pid);
      if (!reasons.has(current.pid)) reasons.set(current.pid, reason);
      members?.add(current.pid);
      pending.push(...(children.get(current.pid) ?? []));
    }
  }

  function protectLaunchers(process: RawProcess, reason: string) {
    let parent = parents.get(process.pid);
    const visited = new Set([process.pid]);
    while (parent && !visited.has(parent.pid) && !shellBoundary.has(processName(parent))) {
      // Some launcher binaries live under System32, but their user-session windows are part of the job.
      if (isWindowsProcess(parent) && !terminals.has(processName(parent))) break;
      visited.add(parent.pid);
      if (!reasons.has(parent.pid)) reasons.set(parent.pid, `Launcher for protected work · ${reason}`);
      parent = parents.get(parent.pid);
    }
  }

  const own = byPid.get(options.ownPid);
  if (own) protectTree(own, 'WinOpti and its helper processes', ownTree);
  for (const process of snapshot.processes) {
    if (gameMatches(process, options.conditions)) {
      protectTree(process, 'Game selected for this capture', gameTree);
      protectLaunchers(process, 'Game selected for this capture');
    }
  }
  for (const process of snapshot.processes) {
    const name = processName(process);
    const alwaysProtected = matchesAlwaysProtect(options.alwaysProtect, process.executable ?? process.name, process.displayName ?? '');
    const devReason = developerReason(process);
    const reason = alwaysProtected ? 'On your Always protect list' : devReason;
    if (reason) {
      // The concrete job should retain its own reason even if its parent is already protected.
      if (!ownTree.has(process.pid) && !gameTree.has(process.pid)) reasons.set(process.pid, reason);
      protectTree(process, reason);
      protectLaunchers(process, reason);
    } else if (!reasons.has(process.pid)) {
      if (terminals.has(name)) reasons.set(process.pid, 'Terminal or command launcher');
      else if (developerApps.has(name)) reasons.set(process.pid, 'Development editor');
      else if (launchersWithDetachedJobs.has(name)) reasons.set(process.pid, 'Development tool or launcher');
    }
  }

  const groups = new Map<string, AppGroup>();
  for (const process of snapshot.processes) {
    let anchor = process;
    let parent = parents.get(anchor.pid);
    const visited = new Set([anchor.pid]);
    while (parent && !visited.has(parent.pid) && mayGroupWithParent(anchor, parent)) {
      anchor = parent;
      visited.add(anchor.pid);
      parent = parents.get(anchor.pid);
    }

    const id = appGroupKey(anchor);
    const group = groups.get(id) ?? {
      id,
      name: anchor.displayName?.trim() || anchor.name.replace(/\.exe$/i, ''),
      executable: anchor.executable,
      processes: [],
      windowTargets: [],
      protection: null,
      background: true,
    };
    group.processes.push(process);
    const explicitProtection = reasons.get(process.pid);
    if (explicitProtection && (!group.protection || group.protection.startsWith('Launcher for protected work'))) {
      group.protection = explicitProtection;
    }
    if (ownTree.has(process.pid) || gameTree.has(process.pid) || isWindowsProcess(process) || process.sessionId !== ownSession) {
      group.background = false;
    }
    if (process.windowTitle !== null) {
      const target = processIdentity(process);
      if (!group.protection && (isWindowsProcess(process) || ownSession === null || process.sessionId !== ownSession)) {
        group.protection = 'Windows or a process outside your desktop session';
      }
      if (!group.protection && (!target?.creationToken || !process.commandLine?.trim())) group.protection = 'Process identity or command metadata unavailable';
      if (target) group.windowTargets.push(target);
    }
    groups.set(id, group);
  }

  for (const group of groups.values()) {
    if (!group.protection && !group.windowTargets.length) {
      group.protection = group.processes.every(isWindowsProcess) ? 'Windows system process' : 'No normal-close window found';
    }
    if (group.protection) group.windowTargets = [];
  }
  return [...groups.values()];
}

interface AnalyzeOptions extends ClassificationOptions {
  id: string;
  startedAt: number;
  endedAt: number;
  snapshots: Snapshot[];
  markers: number[];
  frameTimes?: FrameTimes | null;
}

type MetricKey = keyof Metrics;
const metricKeys = ['cpuPercent', 'memoryBytes', 'ioBytesPerSecond'] as const;
const resourceKeys = ['backgroundCpuPercent', 'memoryPressurePercent', 'diskBytesPerSecond', 'systemCpuPercent'] as const;
const markerRadiusSeconds = 3;
const unknownPower: PowerStatus = { source: 'unknown', batteryPercent: null, saver: null };

function emptyMetrics(): Metrics {
  return { cpuPercent: null, memoryBytes: null, ioBytesPerSecond: null };
}

function metricValue(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

function processRate(process: RawProcess, previous: RawProcess | undefined, sampleAt: number, previousAt: number,
  key: 'cpuTimeMs' | 'ioBytes', multiplier: number): number | null {
  if (sampleAt <= previousAt || multiplier <= 0) return null;
  const current = processIdentity(process);
  if (!current) return null;
  const old = previous && processIdentity(previous);
  const start = old && previous && sameProcess(current, old) ? metricValue(previous[key])
    : current.startedAt >= previousAt && current.startedAt < sampleAt ? 0 : null;
  const end = metricValue(process[key]);
  if (start === null || end === null || end < start) return null;
  return (end - start) * multiplier / (sampleAt - previousAt);
}

function processMetrics(process: RawProcess, previous: RawProcess | undefined, snapshot: Snapshot, previousAt: number): Metrics {
  return {
    cpuPercent: processRate(process, previous, snapshot.at, previousAt, 'cpuTimeMs', 100 / snapshot.logicalCpus),
    memoryBytes: metricValue(process.workingSetBytes),
    ioBytesPerSecond: processRate(process, previous, snapshot.at, previousAt, 'ioBytes', 1000),
  };
}

function sumMeasurements(values: (number | null)[], minimumCoverage = 1): number | null {
  const observed = values.filter((value): value is number => value !== null);
  if (!observed.length || observed.length < values.length * minimumCoverage) return null;
  return observed.reduce((sum, value) => sum + value, 0);
}

function mean(values: { value: number | null; weight: number }[]): number | null {
  const measured = values.filter((sample): sample is { value: number; weight: number } => sample.value !== null);
  const weight = measured.reduce((sum, sample) => sum + sample.weight, 0);
  if (measured.length < Math.min(2, values.length) || weight <= 0) return null;
  return measured.reduce((sum, sample) => sum + sample.value * sample.weight, 0) / weight;
}

function peak(values: (number | null)[]): number | null {
  return values.reduce<number | null>((highest, value) => value === null ? highest : Math.max(highest ?? 0, value), null);
}

interface GroupMeasurement {
  metrics: Metrics;
  markerNear: boolean;
  windowTargets: ProcessIdentity[];
}

interface AppHistory {
  group: AppGroup;
  series: Map<number, GroupMeasurement>;
  processCount: number;
}

function hasComparablePower(a: PowerStatus, b: PowerStatus): boolean {
  return (a.source === 'unknown' || b.source === 'unknown' || a.source === b.source)
    && (a.saver === null || b.saver === null || a.saver === b.saver);
}

function cpu(value: number): string {
  return `${value.toFixed(1)}% CPU`;
}

function memory(value: number): string {
  return `${(value / mib).toFixed(0)} MiB working set`;
}

function io(value: number): string {
  return value >= mib ? `${(value / mib).toFixed(1)} MiB/s process I/O` : `${(value / 1024).toFixed(0)} KiB/s process I/O`;
}

const formatMetric: Record<MetricKey, (value: number) => string> = {
  cpuPercent: cpu, memoryBytes: memory, ioBytesPerSecond: io,
};
const metricName: Record<MetricKey, string> = {
  cpuPercent: 'Process CPU', memoryBytes: 'Working set', ioBytesPerSecond: 'Process I/O',
};

function observationMetrics(history: AppHistory, weights: number[], includeMarkers: boolean): Pick<Finding, 'average' | 'peak' | 'markerPeak' | 'observations'> {
  const average = emptyMetrics();
  const peakMetrics = emptyMetrics();
  const markerPeak = emptyMetrics();
  const observations: string[] = [];
  const present = [...history.series.values()];
  for (const key of metricKeys) {
    const measured = present.filter((item) => item.metrics[key] !== null);
    if (!measured.length) {
      observations.push(`${metricName[key]} unavailable.`);
      continue;
    }
    // A fully absent app used no observed resources during that interval. Missing counters while present remain unavailable.
    average[key] = mean(weights.map((weight, index) => ({
      value: history.series.get(index)?.metrics[key] ?? (history.series.has(index) ? null : 0),
      weight,
    })));
    peakMetrics[key] = peak(present.map((item) => item.metrics[key]));
    markerPeak[key] = peak(present.filter((item) => item.markerNear).map((item) => item.metrics[key]));
    const format = formatMetric[key];
    if (average[key] !== null) {
      observations.push(`${format(average[key]!)} average · ${format(peakMetrics[key]!)} peak (${measured.length}/${weights.length} sampled).`);
    } else {
      observations.push(`${metricName[key]} average unavailable · ${format(peakMetrics[key]!)} observed peak.`);
    }
    if (includeMarkers && key !== 'memoryBytes' && markerPeak[key] !== null) {
      observations.push(`${format(markerPeak[key]!)} in a sample near a stutter mark.`);
    }
  }
  return { average, peak: peakMetrics, markerPeak, observations };
}

function rank(finding: Finding): number {
  const cpuScore = (finding.average.cpuPercent ?? 0) + 0.15 * (finding.peak.cpuPercent ?? 0);
  const ioScore = Math.log1p((finding.average.ioBytesPerSecond ?? 0) / mib) * 3;
  const memoryScore = Math.log1p((finding.average.memoryBytes ?? 0) / (64 * mib));
  const cpuSpike = Math.max(0, (finding.markerPeak.cpuPercent ?? 0) - (finding.average.cpuPercent ?? 0));
  const ioSpike = Math.max(0, (finding.markerPeak.ioBytesPerSecond ?? 0) - (finding.average.ioBytesPerSecond ?? 0));
  return cpuScore + ioScore + memoryScore + cpuSpike * 0.6 + Math.log1p(ioSpike / mib) * 2;
}

function possibleBenefit(average: Metrics, peakMetrics: Metrics): string {
  if ((average.cpuPercent ?? 0) >= 0.2 || (peakMetrics.cpuPercent ?? 0) >= 1) return 'Closing it may reduce CPU contention.';
  if ((average.ioBytesPerSecond ?? 0) >= 64 * 1024 || (peakMetrics.ioBytesPerSecond ?? 0) >= 256 * 1024) {
    return 'Closing it may reduce competing I/O.';
  }
  if ((peakMetrics.memoryBytes ?? 0) >= 16 * mib) return 'Closing it may free part of its measured working set.';
  return 'Closing it may reduce its measured background activity.';
}

export function analyzeCapture(options: AnalyzeOptions): { capture: Capture; targets: Record<string, ProcessIdentity[]> } {
  const { id, startedAt, endedAt, conditions } = options;
  const durationSeconds = Math.max(0, (endedAt - startedAt) / 1000);
  const markers = options.markers.filter((marker) => Number.isFinite(marker) && marker >= 0 && marker <= durationSeconds).sort((a, b) => a - b);
  const snapshots = [...options.snapshots].filter((sample) => sample.at >= startedAt && sample.at <= endedAt).sort((a, b) => a.at - b.at);
  const timeline: NonNullable<Capture['timeline']> = [];
  const histories = new Map<string, AppHistory>();
  const weights: number[] = [];
  let previousProcesses = new Map<number, RawProcess>();
  let latestApps: AppGroup[] = [];

  snapshots.forEach((snapshot, index) => {
    const previousAt = snapshots[index - 1]?.at ?? snapshot.at;
    const weight = Math.max(1, snapshot.at - previousAt || (snapshots[index + 1]?.at ?? snapshot.at + 1000) - snapshot.at);
    weights.push(weight);
    const second = Math.max(0, (snapshot.at - startedAt) / 1000);
    const firstSecond = Math.max(0, (previousAt - startedAt) / 1000);
    const markerNear = markers.some((marker) => firstSecond <= marker + markerRadiusSeconds && second >= marker - markerRadiusSeconds);
    const processValues = new Map(snapshot.processes.map((process) => [process.pid, processMetrics(process, previousProcesses.get(process.pid), snapshot, previousAt)]));
    latestApps = classifyApps(snapshot, options);
    const gameObserved = snapshot.processes.some((process) => gameMatches(process, conditions));
    const backgroundCpus: (number | null)[] = [];

    for (const group of latestApps) {
      const metrics = emptyMetrics();
      for (const key of metricKeys) metrics[key] = sumMeasurements(group.processes.map((process) => processValues.get(process.pid)![key]));
      const history = histories.get(group.id) ?? { group, series: new Map(), processCount: 0 };
      history.group = group;
      history.processCount = Math.max(history.processCount, group.processes.length);
      history.series.set(index, { metrics, markerNear, windowTargets: group.windowTargets });
      histories.set(group.id, history);
      if (group.background) backgroundCpus.push(...group.processes.map((process) => processValues.get(process.pid)!.cpuPercent));
    }

    const measuredBackground = gameObserved ? sumMeasurements(backgroundCpus, 0.8) : null;
    timeline.push({ second, resources: {
      backgroundCpuPercent: measuredBackground === null ? null : Math.min(100, measuredBackground),
      memoryPressurePercent: metricValue(snapshot.memoryPressurePercent),
      diskBytesPerSecond: metricValue(snapshot.diskBytesPerSecond),
      systemCpuPercent: metricValue(snapshot.cpuPercent),
    } });
    previousProcesses = new Map(snapshot.processes.map((process) => [process.pid, process]));
  });

  const resources = { backgroundCpuPercent: null, memoryPressurePercent: null, diskBytesPerSecond: null, systemCpuPercent: null } as ResourceSummary;
  for (const key of resourceKeys) {
    resources[key] = mean(timeline.map(({ resources: sample }, index) => ({ value: sample[key], weight: weights[index] })));
  }

  const liveGroups = new Map(latestApps.map((group) => [group.id, group]));
  const targets: Record<string, ProcessIdentity[]> = {};
  const findings: Finding[] = [];
  for (const [groupId, history] of histories) {
    const { group } = history;
    const liveGroup = liveGroups.get(groupId);
    const liveTargets = liveGroup?.windowTargets ?? [];
    const matchingSeries = new Map<number, GroupMeasurement>();
    const identityCoverage = liveTargets.map(() => 0);
    for (const [index, measurement] of history.series) {
      let matches = false;
      for (const [targetIndex, target] of liveTargets.entries()) {
        if (measurement.windowTargets.some((observed) => sameProcess(target, observed))) {
          identityCoverage[targetIndex]++;
          matches = true;
        }
      }
      if (matches) matchingSeries.set(index, measurement);
    }
    const activeIdentity = Boolean(liveTargets.length && identityCoverage.every((count) => count >= 2));
    const measured = observationMetrics(activeIdentity ? { ...history, series: matchingSeries } : history, weights, markers.length > 0);
    const usedResources = metricKeys.some((key) => (measured.peak[key] ?? 0) > 0);
    const candidate = Boolean(liveGroup && !liveGroup.protection && activeIdentity && usedResources && snapshots.length >= minimumSamples);
    if (candidate && liveGroup) targets[groupId] = liveGroup.windowTargets;
    const routineProcess = ['Windows system process', 'No normal-close window found'].includes(group.protection ?? '');
    const disposition = candidate ? 'candidate' : group.protection && !routineProcess ? 'protected' : 'other';
    const reason = candidate ? possibleBenefit(measured.average, measured.peak) : liveGroup?.protection || group.protection
      || (liveGroup ? 'Insufficient measurements for the running app' : 'No longer running when the scan ended');
    findings.push({ id: groupId, name: group.name, executable: group.executable, processCount: history.processCount,
      ...measured, reason, disposition });
  }

  findings.sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name));
  const power = {
    source: snapshots.find(({ power }) => power.source !== 'unknown')?.power.source ?? unknownPower.source,
    batteryPercent: snapshots.find(({ power }) => power.batteryPercent !== null)?.power.batteryPercent ?? null,
    saver: snapshots.find(({ power }) => power.saver !== null)?.power.saver ?? null,
  };
  const powerChanged = snapshots.some(({ power: status }) => !hasComparablePower(power, status));
  return { capture: { id, startedAt, durationSeconds, conditions, power, powerChanged, sampleCount: snapshots.length, markers,
    resources, findings, timeline, frameTimes: options.frameTimes ?? null }, targets };
}
