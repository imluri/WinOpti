export interface ProcessCounter {
  pid: number
  parentPid: number | null
  name: string
  creationToken: string | null
  executable: string | null
  displayName: string | null
  iconPath: string | null
  sessionId: number | null
  cpuTimeMs: number | null
  workingSetBytes: number | null
  ioBytes: number | null
  diskBytesPerSecond?: number | null
  gpuEngines: { engine: string; percent: number }[] | null
}

export interface ProcessCounters {
  at: number
  diskAt?: number | null
  tickMs: number
  logicalCpus: number
  processes: ProcessCounter[]
}

export interface LiveProcessRow {
  id: string
  name: string
  executable: string
  processCount: number
  cpuPercent: number | null
  gpuPercent: number | null
  memoryBytes: number | null
  diskBytesPerSecond: number | null
  ioBytesPerSecond: number | null
  icon?: string | null
}

export interface LiveProcesses {
  at: number
  diskAt: number | null
  rows: LiveProcessRow[]
}
