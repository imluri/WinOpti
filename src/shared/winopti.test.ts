import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  analyzeCapture, classifyApps, compareCaptures,
  type Capture, type CaptureConditions, type PowerStatus, type RawProcess, type Snapshot,
} from './winopti.ts';

const MiB = 1024 ** 2;
const conditions: CaptureConditions = {
  game: 'Game', gameExecutable: 'game.exe', scene: 'Practice route', graphics: 'High', frameCap: '120', durationSeconds: 60,
};
const power: PowerStatus = { source: 'plugged-in', batteryPercent: 86, saver: false };

function process(pid: number, name: string, overrides: Partial<RawProcess> = {}): RawProcess {
  return {
    pid, name, startedAt: pid, creationToken: String(pid), sessionId: 1, parentPid: 100,
    executable: `C:\\Apps\\${name.replace(/\.exe$/, '')}\\${name}`, commandLine: `"${name}"`,
    cpuTimeMs: 0, workingSetBytes: 10 * MiB, ioBytes: 0, windowTitle: null, ...overrides,
  };
}

function snapshot(at: number, processes: RawProcess[]): Snapshot {
  return { at, processes, logicalCpus: 8, cpuPercent: 30, memoryPressurePercent: 45, diskBytesPerSecond: 5 * MiB, power };
}

const own = process(110, 'WinOpti.exe', { windowTitle: 'WinOpti' });
const shell = process(100, 'explorer.exe', { parentPid: null });
const game = process(120, 'game.exe', { windowTitle: 'Game' });
const standalone = process(130, 'Disposable.exe', { windowTitle: 'Disposable', displayName: 'Disposable' });
const options = { conditions, ownPid: own.pid, alwaysProtect: [] };

test('protects active Vite work, package launches, unknown Node jobs, and related launchers', () => {
  const launcher = process(140, 'Launcher.exe', { windowTitle: 'Launcher' });
  const cmd = process(141, 'cmd.exe', { parentPid: launcher.pid });
  const vite = process(142, 'node.exe', { parentPid: cmd.pid, commandLine: 'node.exe "C:\\app\\node_modules\\vite\\bin\\vite.js" --host' });
  const viteHelper = process(143, 'Worker.exe', { parentPid: vite.pid, windowTitle: 'Worker' });
  const build = process(144, 'node.exe', { commandLine: 'node.exe C:\\app\\node_modules\\vite\\bin\\vite.js build' });
  const unknown = process(145, 'node.exe', { commandLine: null });
  const packageJob = process(146, 'node.exe', { commandLine: 'node.exe C:\\npm\\bin\\npm-cli.js install' });
  const groups = classifyApps(snapshot(2000, [shell, own, game, standalone, launcher, cmd, vite, viteHelper, build, unknown, packageJob]), options);
  const byPid = (pid: number) => groups.find((group) => group.processes.some((row) => row.pid === pid))!;
  assert.equal(byPid(vite.pid).protection, 'Active Vite dev server');
  assert.equal(byPid(build.pid).protection, 'Active Vite build');
  assert.equal(byPid(unknown.pid).protection, 'Could not identify this Node.js workload');
  assert.equal(byPid(packageJob.pid).protection, 'Active package-manager job');
  assert.match(byPid(launcher.pid).protection!, /Launcher for protected work/);
  assert.equal(byPid(viteHelper.pid).protection, 'Active Vite dev server');
  assert.equal(byPid(game.pid).protection, 'Game selected for this capture');
  assert.equal(byPid(own.pid).protection, 'WinOpti and its helper processes');
  assert.deepEqual(groups.flatMap((group) => group.windowTargets.map((target) => target.pid)), [standalone.pid]);
});

test('groups windowless helpers and rejects recycled parents, missing identity, and Always protect matches', () => {
  const oldNode = process(140, 'node.exe', { parentPid: 141, commandLine: null });
  const laterParent = process(141, 'Parent.exe', { windowTitle: 'Parent' });
  const helper = process(142, 'Helper.exe', { parentPid: standalone.pid, executable: 'C:\\Apps\\Disposable\\bin\\Helper.exe' });
  const separateApp = process(143, 'Different.exe', { parentPid: standalone.pid, windowTitle: 'Different', executable: 'C:\\Apps\\Disposable\\Different.exe' });
  const unverified = process(144, 'Unverified.exe', { windowTitle: 'Unverified', creationToken: undefined });
  const groups = classifyApps(snapshot(2000, [shell, own, standalone, helper, separateApp, oldNode, laterParent, unverified]), {
    ...options, alwaysProtect: ['DISPOSABLE'],
  });
  const byPid = (pid: number) => groups.find((group) => group.processes.some((row) => row.pid === pid))!;
  assert.deepEqual(byPid(standalone.pid).processes.map((row) => row.pid), [standalone.pid, helper.pid]);
  assert.equal(byPid(standalone.pid).protection, 'On your Always protect list');
  assert.equal(byPid(laterParent.pid).protection, null);
  assert.equal(byPid(separateApp.pid).windowTargets.length, 0);
  assert.match(byPid(unverified.pid).protection!, /identity/);
});

test('tracks sustained use, preserves marker peaks, and requires matching observed close identity', () => {
  const measurements = [0, 100, 1100, 1200].map((cpuTimeMs, index) => snapshot(1000 * (index + 1), [
    shell, own, game, { ...standalone, cpuTimeMs, ioBytes: index * MiB },
  ]));
  const input = { ...options, id: 'scan', startedAt: 1000, endedAt: 5000, markers: [2], snapshots: measurements };
  const result = analyzeCapture(input);
  const disposable = result.capture.findings.find((finding) => finding.name === 'Disposable')!;
  assert.equal(disposable.disposition, 'candidate');
  assert.equal(disposable.markerPeak.cpuPercent, 12.5);
  assert.equal(disposable.average.ioBytesPerSecond, MiB);
  assert.equal(result.capture.resources.backgroundCpuPercent, 5);
  assert.deepEqual(result.targets[disposable.id].map((target) => target.pid), [standalone.pid]);
  assert.equal(JSON.stringify(result.capture).includes('commandLine'), false);

  const replacement = { ...standalone, startedAt: 3950, creationToken: '3950' };
  const last = snapshot(4000, [shell, own, game, replacement]);
  const replaced = analyzeCapture({ ...input, snapshots: [...measurements.slice(0, -1), last] });
  assert.equal(Object.keys(replaced.targets).length, 0);
  assert.equal(replaced.capture.findings.find((finding) => finding.name === 'Disposable')?.disposition, 'other');
});

function capture(cpu: number | null, frameSpikeMs: number | null): Capture {
  return {
    id: 'capture', startedAt: 0, durationSeconds: 60, conditions, power, powerChanged: false, sampleCount: 60,
    markers: [1, 4], resources: {
      backgroundCpuPercent: cpu, memoryPressurePercent: null, diskBytesPerSecond: null, systemCpuPercent: null,
    },
    findings: [], frameTimes: frameSpikeMs === null ? null : {
      gameExecutable: conditions.gameExecutable, durationSeconds: 60, reliable: true, source: 'presentmon-display',
      timesMs: Array.from({ length: 6000 }, (_, index) => index % 50 === 0 ? frameSpikeMs : 9.5),
    },
  };
}

test('comparison separates frame-time changes, background load, and manual markers', () => {
  const before = capture(22, 44);
  const after = capture(12, 21);
  const improved = compareCaptures(before, after);
  assert.equal(improved.outcome, 'Stutter decreased');
  assert.equal(improved.spikeThresholdMs, 33.3);
  assert.equal(improved.baselineFrame?.p99Ms, 44);
  assert.equal(improved.baselineFrame?.spikesPerMinute, 120);
  assert.equal(improved.followupFrame?.spikesPerMinute, 0);
  assert.equal(compareCaptures(before, capture(12, 44)).outcome, 'Background load decreased');
  assert.equal(compareCaptures(capture(22, null), { ...capture(22, null), markers: [] }).outcome, 'No clear change');
  assert.equal(compareCaptures(capture(null, null), capture(null, null)).outcome, 'Not enough data');
});

test('comparison flags changes in power, capture conditions, and frame measurement source', () => {
  const before = capture(22, 44);
  const after = capture(12, 21);
  const comparison = compareCaptures(before, {
    ...after,
    conditions: { ...conditions, graphics: 'Low', durationSeconds: 55, sampleIntervalSeconds: 5 },
    power: { ...power, source: 'battery', saver: true },
    frameTimes: { ...after.frameTimes!, source: 'presentmon-present' },
  });
  assert.equal(comparison.outcome, 'Background load decreased');
  assert.match(comparison.differences.join(' '), /Graphics settings.*Capture duration.*Sampling interval.*Power source.*Battery Saver.*measurement sources/);
});
