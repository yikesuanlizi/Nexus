import { describe, expect, it } from 'vitest';
import { ExperienceEngine, classifyErrorMessage } from './experienceEngine.js';
import { InMemoryExperienceStore, generateExperienceId } from './experienceStore.js';
import { evaluateCandidate } from './evaluationGate.js';
import type { ExperienceCandidate } from './types.js';

const WS_ROOT = '/test/workspace';

function makeFailureCandidate(overrides: Partial<ExperienceCandidate> = {}): ExperienceCandidate {
  return {
    type: 'failure_pattern',
    situation: {
      symptoms: ['MODULE_NOT_FOUND error when requiring express'],
      triggers: ['missing dependency'],
      errorMessages: ["Error: Cannot find module 'express'"],
      toolNames: ['npm'],
      context: 'npm install failed',
    },
    action: {
      steps: ['ran npm install express to install missing dependency'],
      toolsUsed: ['npm'],
      commands: ['npm install express'],
    },
    outcome: {
      success: true,
      resolution: 'Installed express package successfully',
      errorEncountered: "Cannot find module 'express'",
      attemptsBeforeSuccess: 1,
    },
    workspaceRoot: WS_ROOT,
    sourceThreadId: 'thr_test',
    tags: ['deps', 'npm'],
    signalStrength: 0.8,
    ...overrides,
  };
}

function makePortConflictCandidate(): ExperienceCandidate {
  return {
    type: 'failure_pattern',
    situation: {
      symptoms: ['docker port 3000 already in use'],
      triggers: ['port in use'],
      errorMessages: ['EADDRINUSE port 3000'],
      toolNames: ['docker'],
      keywords: ['docker', 'port'],
      context: 'port conflict when starting container',
    },
    action: {
      steps: ['kill port 3000 process', 'changed port mapping to 3001'],
      toolsUsed: ['docker'],
      commands: ['docker ps', 'kill $(lsof -t -i:3000)'],
    },
    outcome: {
      success: true,
      resolution: 'Port conflict resolved by using port 3001',
      errorEncountered: 'EADDRINUSE port 3000',
    },
    workspaceRoot: WS_ROOT,
    tags: ['port-conflict', 'docker'],
    signalStrength: 0.85,
  };
}

function makeSuccessCandidate(overrides: Partial<ExperienceCandidate> = {}): ExperienceCandidate {
  return {
    type: 'successful_workflow',
    situation: {
      symptoms: ['Set up JWT authentication middleware'],
      triggers: ['jwt', 'auth'],
      toolNames: ['express', 'jsonwebtoken'],
      context: 'Implementing JWT auth for API endpoints',
    },
    action: {
      steps: ['First installed jsonwebtoken package', 'Then created auth middleware that verifies tokens', 'Finally applied middleware to protected routes'],
      toolsUsed: ['npm', 'express', 'jsonwebtoken'],
      commands: ['npm install jsonwebtoken'],
      reasoning: 'JWT provides stateless authentication suitable for REST APIs',
    },
    outcome: {
      success: true,
      resolution: 'JWT middleware successfully implemented and applied',
      attemptsBeforeSuccess: 1,
    },
    workspaceRoot: WS_ROOT,
    sourceThreadId: 'thr_test',
    signalStrength: 0.7,
    ...overrides,
  };
}

describe('generateExperienceId', () => {
  it('produces stable IDs for the same candidate', () => {
    const candidate1 = makeFailureCandidate();
    const candidate2 = makeFailureCandidate();
    const id1 = generateExperienceId(candidate1);
    const id2 = generateExperienceId(candidate2);
    expect(id1).toBe(id2);
    expect(id1.startsWith('exp_failure_pattern_')).toBe(true);
  });

  it('produces different IDs for different experience types', () => {
    const failureId = generateExperienceId(makeFailureCandidate());
    const successId = generateExperienceId(makeSuccessCandidate());
    expect(failureId).not.toBe(successId);
  });
});

describe('InMemoryExperienceStore', () => {
  it('records experiences with unique IDs', async () => {
    const store = new InMemoryExperienceStore();
    const candidate = makeFailureCandidate();
    const evaluation = evaluateCandidate(candidate);
    const exp = await store.record(candidate, evaluation);
    expect(exp.id).toBeDefined();
    expect(exp.id.startsWith('exp_')).toBe(true);
    expect(exp.timesReinforced).toBe(1);
    expect(exp.confidence).toBeGreaterThan(0);
  });

  it('reinforces duplicates instead of creating new entries', async () => {
    const store = new InMemoryExperienceStore();
    const candidate = makeFailureCandidate();
    const evaluation = evaluateCandidate(candidate);
    const exp1 = await store.record(candidate, evaluation);
    const exp2 = await store.record(candidate, evaluation);
    expect(exp1.id).toBe(exp2.id);
    expect(exp2.timesReinforced).toBe(2);
    expect(await store.getAll()).toHaveLength(1);
  });

  it('queries and filters by type', async () => {
    const store = new InMemoryExperienceStore();
    const failureEval = evaluateCandidate(makeFailureCandidate());
    const successEval = evaluateCandidate(makeSuccessCandidate());
    await store.record(makeFailureCandidate(), failureEval);
    await store.record(makeSuccessCandidate(), successEval);
    const failures = await store.query({ type: 'failure_pattern' });
    expect(failures).toHaveLength(1);
    expect(failures[0]!.type).toBe('failure_pattern');
    const successes = await store.query({ type: 'successful_workflow' });
    expect(successes).toHaveLength(1);
    expect(successes[0]!.type).toBe('successful_workflow');
  });

  it('queries and filters by workspaceRoot', async () => {
    const store = new InMemoryExperienceStore();
    const eval1 = evaluateCandidate(makeFailureCandidate());
    const eval2 = evaluateCandidate(makeFailureCandidate({ workspaceRoot: '/other/workspace' }));
    await store.record(makeFailureCandidate(), eval1);
    await store.record(makeFailureCandidate({ workspaceRoot: '/other/workspace' }), eval2);
    const ws1 = await store.query({ workspaceRoot: WS_ROOT });
    expect(ws1).toHaveLength(1);
    expect(ws1[0]!.workspaceRoot).toBe(WS_ROOT);
  });

  it('queries and filters by minConfidence', async () => {
    const store = new InMemoryExperienceStore();
    const highConfidence = makeFailureCandidate({ signalStrength: 0.9 });
    const lowConfidence: ExperienceCandidate = {
      type: 'failure_pattern',
      situation: {
        symptoms: ['specific low confidence test error with details'],
        triggers: ['test'],
        errorMessages: ['specific test error message here'],
        toolNames: ['yarn'],
      },
      action: { steps: ['ran yarn add to install packages'], toolsUsed: ['yarn'] },
      outcome: { success: true, resolution: 'installed packages' },
      signalStrength: 0.45,
    };
    await store.record(highConfidence, evaluateCandidate(highConfidence));
    await store.record(lowConfidence, evaluateCandidate(lowConfidence));
    const highResults = await store.query({ minConfidence: 0.7 });
    expect(highResults.length).toBeGreaterThanOrEqual(1);
    for (const exp of highResults) {
      expect(exp.confidence).toBeGreaterThanOrEqual(0.7);
    }
  });

  it('queries and filters by taskKeywords', async () => {
    const store = new InMemoryExperienceStore();
    const npmCandidate = makeFailureCandidate();
    const dockerCandidate = makePortConflictCandidate();
    await store.record(npmCandidate, evaluateCandidate(npmCandidate));
    await store.record(dockerCandidate, evaluateCandidate(dockerCandidate));
    const dockerResults = await store.query({ taskKeywords: ['docker'] });
    expect(dockerResults).toHaveLength(1);
    expect(dockerResults[0]!.situation.toolNames).toContain('docker');
  });

  it('prunes old entries when over limit', async () => {
    const store = new InMemoryExperienceStore();
    for (let i = 0; i < 5; i++) {
      const candidate: ExperienceCandidate = {
        type: 'failure_pattern',
        situation: {
          symptoms: [`npm test error number ${i} with details`],
          triggers: ['test'],
          errorMessages: [`test error message ${i} content`],
          toolNames: ['npm'],
        },
        action: { steps: [`ran npm install to fix step ${i}`], toolsUsed: ['npm'] },
        outcome: { success: true, resolution: `fixed issue ${i}` },
        signalStrength: 0.6,
      };
      await store.record(candidate, evaluateCandidate(candidate));
    }
    expect(await store.getAll()).toHaveLength(5);
    const pruned = await store.prune(3);
    expect(pruned).toBe(2);
    expect(await store.getAll()).toHaveLength(3);
  });
});

describe('Evaluation gate', () => {
  it('rejects vague symptoms', () => {
    const vagueCandidate: ExperienceCandidate = {
      type: 'failure_pattern',
      situation: {
        symptoms: ['it does not work'],
        triggers: [],
      },
      action: { steps: ['fixed it'] },
      outcome: { success: true, resolution: 'fixed' },
      signalStrength: 0.8,
    };
    const result = evaluateCandidate(vagueCandidate);
    expect(result.shouldStore).toBe(false);
    expect(result.reason).toContain('vague');
  });

  it('rejects low-confidence entries', () => {
    const lowSignalCandidate: ExperienceCandidate = {
      type: 'failure_pattern',
      situation: {
        symptoms: ['some specific error message here with details'],
        triggers: ['error'],
        errorMessages: ['some error occurred with stack trace'],
      },
      action: { steps: ['ran some command to debug'] },
      outcome: { success: true },
      signalStrength: 0.2,
    };
    const result = evaluateCandidate(lowSignalCandidate);
    expect(result.shouldStore).toBe(false);
    expect(result.reason).toContain('signal strength too low');
  });

  it('accepts valid candidates with actionable steps', () => {
    const validCandidate = makeFailureCandidate();
    const result = evaluateCandidate(validCandidate);
    expect(result.shouldStore).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });
});

describe('ExperienceEngine', () => {
  it('recordFailure records a failure_pattern for MODULE_NOT_FOUND errors', async () => {
    const engine = new ExperienceEngine({ workspaceRoot: WS_ROOT });
    const classification = classifyErrorMessage("Error: Cannot find module 'express'");
    expect(classification).not.toBeNull();
    const exp = await engine.recordFailure({
      errorMessage: "Error: Cannot find module 'express'",
      resolutionSteps: ['ran npm install express to add missing package'],
      toolName: 'npm',
    });
    expect(exp).not.toBeNull();
    expect(exp!.type).toBe('failure_pattern');
    expect(exp!.tags).toContain('failure_pattern');
    expect(exp!.tags).toContain('success');
    expect(exp!.tags).toContain('tool:npm');
  });

  it('recordFailure records a failure_pattern for EACCES errors', async () => {
    const engine = new ExperienceEngine({ workspaceRoot: WS_ROOT });
    const classification = classifyErrorMessage('EACCES: permission denied, open /etc/config');
    expect(classification).not.toBeNull();
    const exp = await engine.recordFailure({
      errorMessage: 'EACCES: permission denied, open /etc/config',
      resolutionSteps: ['ran chmod 755 /etc/config to set permissions', 'used sudo to execute command'],
    });
    expect(exp).not.toBeNull();
    expect(exp!.type).toBe('failure_pattern');
    expect(exp!.tags).toContain('failure_pattern');
  });

  it('recordFailure records a failure_pattern for EADDRINUSE errors', async () => {
    const engine = new ExperienceEngine({ workspaceRoot: WS_ROOT });
    const classification = classifyErrorMessage('EADDRINUSE: address already in use :::3000');
    expect(classification).not.toBeNull();
    const exp = await engine.recordFailure({
      errorMessage: 'EADDRINUSE: address already in use :::3000',
      resolutionSteps: ['ran kill port 3000 using lsof command', 'change port to 3001 in docker config'],
      toolName: 'docker',
    });
    expect(exp).not.toBeNull();
    expect(exp!.type).toBe('failure_pattern');
  });

  it('recordFailure records a failure_pattern for ENOENT errors', async () => {
    const engine = new ExperienceEngine({ workspaceRoot: WS_ROOT });
    const classification = classifyErrorMessage('ENOENT: no such file or directory, open /tmp/data.json');
    expect(classification).not.toBeNull();
    const exp = await engine.recordFailure({
      errorMessage: 'ENOENT: no such file or directory, open /tmp/data.json',
      resolutionSteps: ['ran mkdir to created directory /tmp first', 'checked file path exists before opening'],
    });
    expect(exp).not.toBeNull();
    expect(exp!.type).toBe('failure_pattern');
  });

  it('recordFailure records a failure_pattern for version mismatch errors', async () => {
    const engine = new ExperienceEngine({ workspaceRoot: WS_ROOT });
    const classification = classifyErrorMessage('version mismatch: requires node >=18 but found 16');
    expect(classification).not.toBeNull();
    const exp = await engine.recordFailure({
      errorMessage: 'version mismatch: requires node >=18 but found 16',
      resolutionSteps: ['ran nvm install 20 to upgrade node', 'use node 20 with nvm use command'],
      toolName: 'nvm',
    });
    expect(exp).not.toBeNull();
    expect(exp!.type).toBe('failure_pattern');
  });

  it('recordSuccess records successful_workflow', async () => {
    const engine = new ExperienceEngine({ workspaceRoot: WS_ROOT });
    const exp = await engine.recordSuccess({
      toolNames: ['npm', 'express'],
      taskSummary: 'Created a new Express.js REST API server',
      steps: ['First initialized npm project with npm init', 'Then installed express package', 'Finally created server.js with routes implemented'],
      commands: ['npm init -y', 'npm install express'],
    });
    expect(exp).not.toBeNull();
    expect(exp!.type).toBe('successful_workflow');
    expect(exp!.outcome.success).toBe(true);
  });

  it('recordGotcha records gotcha experiences', async () => {
    const engine = new ExperienceEngine({ workspaceRoot: WS_ROOT });
    const exp = await engine.recordGotcha({
      symptom: 'Windows uses backslash path separators which can break cross-platform code',
      trigger: 'path concatenation on Windows',
      workaround: 'Always used path.join() instead of string concatenation for building file paths',
    });
    expect(exp).not.toBeNull();
    expect(exp!.type).toBe('gotcha');
    expect(exp!.tags).toContain('gotcha');
  });

  it('findByError returns matching failure patterns', async () => {
    const engine = new ExperienceEngine({ workspaceRoot: WS_ROOT });
    await engine.recordFailure({
      errorMessage: "Cannot find module 'lodash'",
      resolutionSteps: ['ran npm install lodash to add package'],
      toolName: 'npm',
    });
    await engine.recordFailure({
      errorMessage: 'EADDRINUSE port 3000 already in use',
      resolutionSteps: ['ran kill port 3000 process', 'change port to 3001'],
      toolName: 'docker',
    });
    const results = await engine.findByError("Cannot find module 'express'");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.type).toBe('failure_pattern');
  });

  it('formatExperiencesForPrompt outputs XML-like format', async () => {
    const engine = new ExperienceEngine({ workspaceRoot: WS_ROOT });
    const exp = await engine.recordFailure({
      errorMessage: "Error: Cannot find module 'express'",
      resolutionSteps: ['ran npm install express to add dependency'],
      toolName: 'npm',
    });
    expect(exp).not.toBeNull();
    const formatted = engine.formatExperiencesForPrompt([exp!]);
    expect(formatted).toContain('<relevant_experiences>');
    expect(formatted).toContain('</relevant_experiences>');
    expect(formatted).toContain('<failure');
    expect(formatted).toContain('</failure>');
    expect(formatted).toContain('Situation:');
    expect(formatted).toContain('Action:');
    expect(formatted).toContain('Outcome:');
  });

  it('disabled engine returns null for record operations', async () => {
    const engine = new ExperienceEngine({ enabled: false, workspaceRoot: WS_ROOT });
    expect(engine.getEnabled()).toBe(false);
    const failure = await engine.recordFailure({
      errorMessage: 'test error',
      resolutionSteps: ['ran npm install test package'],
    });
    expect(failure).toBeNull();
    const success = await engine.recordSuccess({
      toolNames: ['test'],
      taskSummary: 'test task summary',
      steps: ['First ran test command', 'Then verified results'],
    });
    expect(success).toBeNull();
    const gotcha = await engine.recordGotcha({
      symptom: 'test symptom description',
      workaround: 'used alternative approach for test',
    });
    expect(gotcha).toBeNull();
  });
});

describe('classifyErrorMessage', () => {
  it('classifies MODULE_NOT_FOUND errors', () => {
    const result = classifyErrorMessage("Cannot find module 'express'");
    expect(result).not.toBeNull();
    expect(result!.triggers).toContain('missing dependency');
    expect(result!.tags).toContain('deps');
  });

  it('classifies EACCES errors', () => {
    const result = classifyErrorMessage('EACCES permission denied');
    expect(result).not.toBeNull();
    expect(result!.tags).toContain('permissions');
  });

  it('classifies EADDRINUSE errors', () => {
    const result = classifyErrorMessage('EADDRINUSE address already in use');
    expect(result).not.toBeNull();
    expect(result!.tags).toContain('port-conflict');
  });

  it('classifies ENOENT errors', () => {
    const result = classifyErrorMessage('ENOENT no such file or directory');
    expect(result).not.toBeNull();
    expect(result!.tags).toContain('path');
  });

  it('classifies version mismatch errors', () => {
    const result = classifyErrorMessage('version mismatch requires node');
    expect(result).not.toBeNull();
    expect(result!.tags).toContain('version');
  });

  it('returns null for unrecognized errors', () => {
    const result = classifyErrorMessage('some random error message that is not recognized');
    expect(result).toBeNull();
  });
});
