import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('agent stage layout', () => {
  it('matches the Nexus primary agent sample card copy and structure', () => {
    const component = readFileSync(join(here, 'components', 'AgentStagePanel.tsx'), 'utf-8');
    const styles = readFileSync(join(here, 'styles.css'), 'utf-8').replace(/\r\n/g, '\n');
    const sampleStart = styles.indexOf('.agentStageAvatarCard {\n    display: flex;');
    const sampleStyles = styles.slice(sampleStart, styles.indexOf('.childAgentTree {', sampleStart));

    expect(component).toContain("'Nexus 主控 Agent'");
    expect(component).toContain('agentStageStatusLine');
    expect(component).toContain('`${status} · ${action}`');
    expect(sampleStyles).toContain('background: #f2f7ff;');
    expect(sampleStyles).toContain('border: 1px solid #d9e6f7;');
    expect(sampleStyles).toContain('width: 64px;');
    expect(sampleStyles).toContain('font-size: 15px;');
    expect(sampleStyles).toContain('font-size: 12px;');
  });

  it('keeps stats compact when child agents are present', () => {
    const styles = readFileSync(join(here, 'styles.css'), 'utf-8').replace(/\r\n/g, '\n');
    const stageStyles = styles.slice(styles.indexOf('.agentStage {'), styles.indexOf('.agentStageHeader {'));
    const statsStyles = styles.slice(styles.indexOf('.agentStageStats {'), styles.indexOf('.agentStageStats strong'));
    const gridStyles = styles.slice(styles.indexOf('.agentStageGrid {'), styles.indexOf('.agentStageCard {'));

    expect(stageStyles).toContain('grid-template-rows: auto auto minmax(0, 1fr) auto;');
    expect(statsStyles).toContain('grid-row: 2;');
    expect(statsStyles).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(statsStyles).toContain('height: 28px;');
    expect(statsStyles).toContain('white-space: nowrap;');
    expect(gridStyles).toContain('grid-row: 3;');
  });
});
