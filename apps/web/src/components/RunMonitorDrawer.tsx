import { RunMonitorWorkbench } from './monitor/RunMonitorWorkbench.js';
import type { RunMonitorWorkbenchProps } from './monitor/RunMonitorWorkbench.js';

export function RunMonitorDrawer(props: RunMonitorWorkbenchProps) {
  return <RunMonitorWorkbench {...props} />;
}
