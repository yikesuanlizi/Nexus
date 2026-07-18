export interface ModuleInfo {
  name: string;
  path: string;
  purpose?: string;
  entryFile?: string;
  dependencies?: string[];
}

export interface RiskArea {
  area: string;
  reason: string;
  severity: 'low' | 'medium' | 'high';
  files?: string[];
}

export interface ArchitectureSummary {
  techStack: string[];
  framework?: string;
  language: string;
  buildSystem?: string;
  testFramework?: string;
  modules: ModuleInfo[];
  entryPoints: string[];
  keyPatterns: string[];
  generatedAt: number;
}

export interface ProjectChangeDelta {
  changedFiles: string[];
  addedFiles: string[];
  deletedFiles: string[];
  riskAreas: RiskArea[];
  recentCommits?: string[];
}

export interface ProjectBrainCache {
  injectedHash: string;
  injectedChangeVersion: number;
  lastInjectedTurn: number;
  threadTurnCount: number;
  lastDelta: ProjectChangeDelta | null;
  fullInjectedOnce: boolean;
}

export interface ProjectBrainEnricher {
  readonly name: string;
  getArchitecture?(workspaceRoot: string, signal?: AbortSignal): Promise<Partial<ArchitectureSummary> | null>;
  getChangeDelta?(workspaceRoot: string, sinceHash?: string, signal?: AbortSignal): Promise<Partial<ProjectChangeDelta> | null>;
  getRiskAreas?(workspaceRoot: string, changedFiles: string[], signal?: AbortSignal): Promise<RiskArea[] | null>;
}

export type InjectionMode = 'full' | 'delta' | 'risk_only' | 'skip';
