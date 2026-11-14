# WinOpti

WinOpti is a Windows 11 desktop app for investigating game stutter and reviewing background apps you can close. It uses Bun, React, and Electron and starts from the [Desktop UI Template](https://github.com/imluri/desktop-ui-template).

## Run

Install Bun 1.4.4 and Node.js 22.12 or newer. On Windows, the build uses the built-in .NET Framework C# compiler for its telemetry helper. WinOpti runs as the signed-in user.

```powershell
bun install --frozen-lockfile
bun run desktop
```

Electron may download its platform binary on first launch. Run `bun run desktop:preview` for a sample-only desktop window, or `bun run dev` and open the printed URL for the interactive browser preview. The sidebar includes examples for improved frame times and lower background CPU with unchanged frame times. Build an offline browser preview with `bun run preview:html`.

## Build the Windows installer

On Windows, run `bun install --frozen-lockfile` and `bun run package:win`. The x64 installer is written to `release/WinOpti-Setup-<version>-x64.exe`. It installs for the current user and adds WinOpti to the Start menu. The installer bundles Electron and the native metrics helper, so the installed app runs without Bun, Node.js, or administrator rights. Local builds without a signing certificate produce an unsigned installer.

## Updates

Install WinOpti 0.2.0 or newer once to enable **Settings → Updates**. From there, check for a release, download it, and choose **Restart and install**. WinOpti checks its public GitHub Releases and verifies the installer against the release asset's size and SHA-256 digest before running it. Active scans and app close reviews must finish before the app can restart. Captures and preferences stay in the local user profile. [WinOpti releases](https://github.com/imluri/WinOpti/releases)

To publish an update, bump the version in `package.json`, commit it, and push a matching stable tag such as `v0.2.1`. The release workflow tests and packages that revision, then publishes the installer under the tag.

## Live performance

Open **Performance** to see live CPU, GPU, memory, and storage activity and the hardware Windows can identify. WinOpti samples about once a second while the page is visible. The dashboard reads counters from a persistent native Windows helper. Saved scans use a separate helper and separate counters. Bun bundles the renderer and main-process code. The Windows APIs provide the live readings.

Open **Processes** to search running apps and sort by CPU, GPU, RAM, disk, or process I/O. The view groups processes with the same executable path in the same Windows session. CPU is a share of total logical CPU capacity, GPU shows the group's busiest graphics engine, and RAM is the combined working set, which can count shared pages more than once. Disk uses Windows process disk accounting and refreshes separately. Process I/O includes file, network, and device transfers. You can pause the table to inspect a reading. The live table stays in memory.

## Record and compare

1. Choose the running game from the process picker. Record the scene or route, graphics settings, frame cap, and capture duration. Choose a 1, 2, 3, or 5 second sampling interval, then start the scan and play through that scene.
2. Mark a stutter with **Ctrl+Shift+F9** while playing, or use **Mark stutter** in WinOpti. If Windows cannot register the shortcut, the capture screen displays its status.
3. In **Review apps**, inspect the observed usage and the reasons for protection. Select the apps you want to close and confirm the list. WinOpti rechecks the process identities and protection rules, requests a normal close, and checks which apps exited. Handle any remaining windows or save prompts yourself.
4. Record a follow-up with the same scene, graphics, frame cap, power state, capture duration, and sampling interval. Compare the readings and check any condition differences. User-marked stutters appear separately.
5. Use **Settings → Protection** to choose additional running apps to keep out of recommendations.

WinOpti records system CPU, sampled background app CPU, system memory pressure as a percentage of the Windows commit limit, and total physical-disk throughput. Background CPU covers sampled apps in your Windows session and excludes the selected game, Windows system processes, and WinOpti. The game must be running and background CPU coverage must be sufficient for a reading. Summed per-app working sets can count shared pages more than once, and per-app read/write I/O can include non-disk activity. The scan highlights sample intervals that overlap the three seconds before or after a stutter mark.

## Recurring scans

Set up a scan, then use **Recurring scans** on the **Scan** page to turn on automatic captures and choose an interval from 1 to 60 minutes. WinOpti waits the chosen interval before the first run and starts a new scan at each interval while the app is open, including when minimized. It skips runs that overlap an active capture or app close review. The schedule starts again when you reopen WinOpti or wake the PC. Switching it off stops the schedule and cancels any recurring scan in progress.

**View latest recurring scan** opens the most recent automatic capture. Manual baselines and follow-ups remain available for comparisons and close reviews. If your game is closed, the recurring scan can still report system CPU, memory pressure, and disk activity.

## Frame times and local data

The live scan records Windows resource counters. To add frame-time evidence, record the same gameplay interval with [PresentMon](https://github.com/GameTechDev/PresentMon/blob/main/README-ConsoleApplication.md) and import its CSV into the corresponding capture. Use the same PresentMon settings for both captures and leave its relative timestamp column enabled. WinOpti matches the game executable and checks frame coverage, duration, and swap-chain consistency. The report shows p95 and p99 frame times and spikes per minute using the same 33.3 ms threshold. If you have resource readings only, the report can still compare background load.

The baseline, follow-up, close results, and protection list are stored in `%APPDATA%\WinOpti\winopti-captures.json`. Process command lines are used transiently to recognize local work and are omitted from saved captures and exported reports. Reopening the app restores saved captures for comparison and export. Run a fresh baseline to request a close after reopening.

## Verify

```powershell
bun run build
bun test
```

Run `bun scripts/test-windows-close.ts` in an interactive Windows desktop session to verify the native close workflow with a disposable window, a live Bun dev server, and a build watcher.

[MIT license](LICENSE)
