// 系统监控模块：定期采样主机 CPU/内存/磁盘状态，计算限流级别，主动通知订阅者。
// — Chinese: system monitor: periodically sample host CPU/memory/disk, compute throttle level, notify subscribers.
//
// 分级限流策略：
//   none     — 一切正常，无限制
//   light    — CPU>80% 或 内存>75%：并发工具数减半，不再新增子 agent
//   moderate — CPU>90% 或 内存>85%：禁止并发（全串行），已有子 agent 跑完不再新增
//   severe   — CPU>95% 或 内存>95% 或 磁盘可用<500MB：只允许 readonly 工具
//
// 主动通知：级别变化时通过 onLevelChange 回调通知 agent，agent 可注入系统提示上下文。
// — Chinese: proactive notification: onLevelChange callback fires when level changes.

import si from 'systeminformation';
import type {
  SystemMonitorInterface,
  SystemMonitorStatus,
  SystemMonitorSnapshot,
  SystemMonitorLevel,
} from '@nexus/protocol';

/** 监控配置。 */
// — Chinese: monitor configuration
export interface SystemMonitorConfig {
  /** 是否启用监控 */
  enabled: boolean;
  /** 采样间隔（毫秒），默认 5000 */
  intervalMs: number;
  /** 阈值配置 */
  thresholds: {
    /** CPU 使用率 — light 阈值（百分比） */
    cpuLight: number;
    /** CPU 使用率 — moderate 阈值 */
    cpuModerate: number;
    /** CPU 使用率 — severe 阈值 */
    cpuSevere: number;
    /** 内存使用率 — light 阈值 */
    memLight: number;
    /** 内存使用率 — moderate 阈值 */
    memModerate: number;
    /** 内存使用率 — severe 阈值 */
    memSevere: number;
    /** 磁盘可用空间 — severe 阈值（字节），低于此值触发 severe */
    diskSevereBytes: number;
  };
}

/** 默认配置。 */
// — Chinese: default config
export const DEFAULT_SYSTEM_MONITOR_CONFIG: SystemMonitorConfig = {
  enabled: false,
  intervalMs: 5000,
  thresholds: {
    cpuLight: 80,
    cpuModerate: 90,
    cpuSevere: 95,
    memLight: 75,
    memModerate: 85,
    memSevere: 95,
    diskSevereBytes: 500 * 1024 * 1024, // 500 MB
  },
};

/** 级别变化监听器：接收新的完整状态。 */
// — Chinese: level-change listener: receives the full new status
export type SystemMonitorListener = (status: SystemMonitorStatus) => void;

/**
 * 系统监控：后台采样 + 阈值判断 + 分级限流 + 主动通知。
 * 实现 SystemMonitorInterface 供 ToolContext 注入。
 */
// — Chinese: system monitor: background sampling + threshold + tiered throttle + proactive notify
export class SystemMonitor implements SystemMonitorInterface {
  private config: SystemMonitorConfig;
  private currentStatus: SystemMonitorStatus | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<SystemMonitorListener>();
  private sampling = false;

  constructor(config?: Partial<SystemMonitorConfig>) {
    this.config = {
      ...DEFAULT_SYSTEM_MONITOR_CONFIG,
      ...config,
      thresholds: {
        ...DEFAULT_SYSTEM_MONITOR_CONFIG.thresholds,
        ...config?.thresholds,
      },
    };
  }

  /** 启动后台采样。 */
  // — Chinese: start background sampling
  start(): void {
    if (!this.config.enabled || this.timer) return;
    // 立即采样一次，然后按间隔采样
    // — Chinese: sample once immediately, then on interval
    void this.sample();
    this.timer = setInterval(() => {
      void this.sample();
    }, this.config.intervalMs);
  }

  /** 停止后台采样。 */
  // — Chinese: stop background sampling
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 监控是否已启用。 */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /** 获取当前监控状态。未采样过时返回一个"未知"状态。 */
  // — Chinese: get current status; returns an "unknown" status if never sampled
  getStatus(): SystemMonitorStatus {
    if (!this.currentStatus) {
      return {
        snapshot: {
          timestamp: new Date().toISOString(),
          cpuUsage: 0,
          cpuCount: 0,
          memTotal: 0,
          memUsed: 0,
          memUsage: 0,
          disks: [],
        },
        level: 'none',
        recommendation: 'Not sampled yet.',
        enabled: this.config.enabled,
      };
    }
    return this.currentStatus;
  }

  /**
   * 订阅级别变化事件。返回取消订阅函数。
   * 级别变化（如 none → light）时触发，级别不变不触发。
   */
  // — Chinese: subscribe to level-change events. Returns unsubscribe function.
  onLevelChange(listener: SystemMonitorListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 更新配置（运行时切换开关）。 */
  // — Chinese: update config at runtime (toggle on/off)
  updateConfig(partial: Partial<SystemMonitorConfig>): void {
    const wasEnabled = this.config.enabled;
    this.config = {
      ...this.config,
      ...partial,
      thresholds: {
        ...this.config.thresholds,
        ...partial.thresholds,
      },
    };
    if (this.config.enabled && !wasEnabled) {
      this.start();
    } else if (!this.config.enabled && wasEnabled) {
      this.stop();
    }
  }

  /** 采集一次系统状态并更新内部状态。 */
  // — Chinese: sample once and update internal state
  private async sample(): Promise<void> {
    if (this.sampling) return; // 防止重叠采样
    this.sampling = true;
    try {
      const [cpuLoad, mem, fsSize, cpuCores] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.cpu(),
      ]);

      const snapshot: SystemMonitorSnapshot = {
        timestamp: new Date().toISOString(),
        cpuUsage: cpuLoad.currentLoad ?? 0,
        cpuCount: cpuCores.cores ?? cpuLoad.cpus?.length ?? 0,
        memTotal: mem.total,
        memUsed: mem.used,
        memUsage: mem.total > 0 ? (mem.used / mem.total) * 100 : 0,
        disks: fsSize.map((d) => ({
          mount: d.mount,
          size: d.size,
          used: d.used,
          available: d.available,
          usage: d.use ?? 0,
        })),
      };

      const newLevel = this.computeLevel(snapshot);
      const oldLevel = this.currentStatus?.level ?? 'none';
      const recommendation = this.buildRecommendation(newLevel, snapshot);

      this.currentStatus = {
        snapshot,
        level: newLevel,
        recommendation,
        enabled: this.config.enabled,
      };

      // 级别变化时通知监听器
      // — Chinese: notify listeners only when level changes
      if (newLevel !== oldLevel) {
        for (const listener of this.listeners) {
          try {
            listener(this.currentStatus);
          } catch {
            // 监听器异常不应影响采样循环
            // — Chinese: listener errors should not break the sampling loop
          }
        }
      }
    } catch {
      // 采样失败时保持上一个状态，不中断监控循环
      // — Chinese: on sample failure keep previous status, don't break the loop
    } finally {
      this.sampling = false;
    }
  }

  /** 根据阈值计算限流级别。 */
  // — Chinese: compute throttle level from thresholds
  private computeLevel(snapshot: SystemMonitorSnapshot): SystemMonitorLevel {
    const t = this.config.thresholds;
    const cpu = snapshot.cpuUsage;
    const mem = snapshot.memUsage;
    // 任意磁盘可用空间低于 severe 阈值 → severe
    // — Chinese: any disk below severe threshold → severe
    const diskSevere = snapshot.disks.some((d) => d.available < t.diskSevereBytes);

    if (cpu >= t.cpuSevere || mem >= t.memSevere || diskSevere) {
      return 'severe';
    }
    if (cpu >= t.cpuModerate || mem >= t.memModerate) {
      return 'moderate';
    }
    if (cpu >= t.cpuLight || mem >= t.memLight) {
      return 'light';
    }
    return 'none';
  }

  /** 根据级别生成人类可读的建议。 */
  // — Chinese: build human-readable recommendation per level
  private buildRecommendation(level: SystemMonitorLevel, snapshot: SystemMonitorSnapshot): string {
    switch (level) {
      case 'severe':
        return 'Host under severe pressure. Only readonly tools allowed. Do not spawn subagents. Wait for load to decrease before resuming write operations.';
      case 'moderate':
        return 'Host under moderate pressure. Run tools sequentially (no parallel batches). Do not spawn new subagents until existing ones complete.';
      case 'light':
        return 'Host under light pressure. Reduce parallel tool batch size. Avoid spawning additional subagents if possible.';
      case 'none':
      default:
        return 'Host load is normal. No restrictions needed.';
    }
  }
}
