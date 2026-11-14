import type { PowerStatus } from './winopti'

export interface PerformanceSample {
  at: number
  cpuPercent: number | null
  memoryUsedBytes: number | null
  memoryTotalBytes: number | null
  memoryPressurePercent: number | null
  diskReadBytesPerSecond: number | null
  diskWriteBytesPerSecond: number | null
  diskActivePercent: number | null
  gpuPercent: number | null
  processCount: number | null
  uptimeSeconds: number
  power: PowerStatus
}

export interface HardwareInfo {
  cpu: { name: string | null; cores: number | null; logicalProcessors: number }
  memoryTotalBytes: number | null
  gpus: { name: string; dedicatedBytes: number | null; sharedBytes: number | null }[]
  drives: { letter: string; label: string | null; totalBytes: number; freeBytes: number }[]
}

export interface PerformanceReading {
  hardware: HardwareInfo
  sample: PerformanceSample
}
