// TaskHarnessEngine: 组装 HarnessLoop 主循环。
// 在 AgentLoop 之上构建跨 turn 自主循环：
//   Goal → Plan → Execute (AgentLoop.runTurn) → Critique → Replan → Verify
//
// Gap 3: runTurn(threadId, input, signal?, options?) — Step 10b 扩展后启用
// Gap 4: buildIterationContext → renderHarnessContextSlice → modeInstruction 注入
// Gap 5: resume 时 rebuildFromThreadItems 重建 ledger
// Gap 6: 互斥检查 canStartNewHarness
// Gap 9: hidden continuation 副作用通过 RunTurnOptions 控制

import type {
  GoalEvaluation,
  ThreadId,
  ThreadItem,
  UserInput,
} from '@nexus/protocol';
import type {
  ContinuationInput,
  EvidenceReceipt,
  HarnessConfig,
  HarnessResult,
  HarnessState,
  ReadinessResult,
  RunTurnOptions,
  StormBreakerResult,
} from './types.js';
import { DEFAULT_HARNESS_CONFIG } from './types.js';
import { EvidenceLedger } from './evidenceLedger.js';
import {
  GoalTracker,
  type GoalTrackerStore,
} from './goalTracker.js';
import { StormBreaker } from './stormBreaker.js';
import {
  HarnessContextManager,
  renderHarnessContextSlice,
  type HarnessContextStore,
} from './harnessContext.js';
import { ReadinessCritic } from './readinessCritic.js';
import { GoalEvaluator, type EvaluatorModelGateway } from './goalEvaluator.js';

// ─── AgentLoop 最小接口（避免循环依赖） ─────────────────────────────────────
// 真实 AgentLoop 在 Step 10b 会扩展 runTurn 为 4 参数签名。
// 这里定义接口兼容 3 参数（现有）和 4 参数（Step 10b 后）两种调用方式。

export interface HarnessAgentLoop {
  /**
   * Gap 3: runTurn(threadId, userInput, signal?, options?)
   * Step 10b 前只接受 3 参数；Step 10b 后扩展为 4 参数。
   * TaskHarnessEngine 统一用 4 参数调用，Step 10b 前 options 字段会被忽略。
   */
  runTurn(
    threadId: ThreadId,
    userInput: UserInput,
    signal?: AbortSignal,
    options?: RunTurnOptions,
  ): Promise<{ items: ThreadItem[]; usage: import('@nexus/protocol').Usage | null }>;
}

// ─── 辅助：构造续跑输入 ─────────────────────────────────────────────────────

function makeContinuationInput(
  evalResult: GoalEvaluation,
  state: HarnessState,
  contextSliceText: string,
): UserInput {
  const text = buildContinuationText(evalResult, state);
  return {
    type: 'text',
    text,
    // Gap 4: 把 HarnessContextSlice 渲染文本注入 modeInstruction
    // 不塞 system prompt（避免打爆 cache prefix）
    modeInstruction: contextSliceText,
  };
}

function buildContinuationText(evalResult: GoalEvaluation, state: HarnessState): string {
  const lines: string[] = [];
  lines.push('[harness continuation]');
  lines.push(`Iteration: ${state.iteration + 1}`);
  lines.push(`Objective: ${state.goal.objective}`);
  lines.push('');
  if (evalResult.satisfied) {
    lines.push('Previous evaluation: satisfied. Please finalize.');
  } else {
    lines.push('Previous evaluation: not yet satisfied.');
    if (evalResult.failedCriteria.length > 0) {
      lines.push(`Failed criteria:`);
      for (const c of evalResult.failedCriteria) {
        lines.push(`- ${c}`);
      }
    }
    if (evalResult.blocker) {
      lines.push(`Blocker: ${evalResult.blocker}`);
    }
    if (evalResult.nextHint) {
      lines.push(`Next hint: ${evalResult.nextHint}`);
    }
  }
  lines.push('');
  lines.push('Continue working on the goal. Do not ask for user input unless blocked.');
  return lines.join('\n');
}

function makeRetryInput(retryInstruction: string): UserInput {
  return {
    type: 'text',
    text: `[readiness retry]\n${retryInstruction}`,
  };
}

function makeStormInput(stormResult: StormBreakerResult): UserInput {
  return {
    type: 'text',
    text: `[storm breaker]\n${stormResult.instruction ?? 'Change your approach and try a different strategy.'}`,
  };
}

// ─── 简单 goal / criteria 提取（MVP 占位） ──────────────────────────────────

function extractGoalFromInput(userInput: UserInput): string {
  if (userInput.type === 'text') {
    return userInput.text.slice(0, 500);
  }
  if (userInput.type === 'multimodal') {
    const textPart = userInput.parts.find(p => p.type === 'text');
    if (textPart && textPart.type === 'text') return textPart.text.slice(0, 500);
  }
  return '(unknown goal)';
}

async function deriveCriteriaFromInput(userInput: UserInput): Promise<string[]> {
  // MVP 占位：从输入中简单提取
  // 生产环境应由 TaskHarnessEngine 配置的 criteriaDeriver 提供
  const text = userInput.type === 'text'
    ? userInput.text
    : (userInput.type === 'multimodal'
        ? userInput.parts.filter(p => p.type === 'text').map(p => p.type === 'text' ? p.text : '').join(' ')
        : '');
  // 简单启发：把句子拆成 criteria（MVP）
  const sentences = text.split(/[。.\n]/).map(s => s.trim()).filter(s => s.length > 5);
  if (sentences.length === 0) return ['任务完成'];
  return sentences.slice(0, 5);
}

// ─── TaskHarnessEngine ───────────────────────────────────────────────────────

export class TaskHarnessEngine {
  constructor(
    private agentLoop: HarnessAgentLoop,
    private model: EvaluatorModelGateway,
    private store: GoalTrackerStore & HarnessContextStore,
    private config: HarnessConfig = DEFAULT_HARNESS_CONFIG,
  ) {}

  /**
   * 启动 harness run。
   *
   * 流程：
   * 1. 互斥检查（Gap 6）
   * 2. 初始化 GoalTracker / EvidenceLedger / HarnessContextManager / StormBreaker / ReadinessCritic / GoalEvaluator
   * 3. 第一轮：正常 runTurn（用户输入）
   * 4. 自主循环：readiness → storm → evaluator → replanner → continuation
   * 5. 到达 max_continuations 或无进展时暂停
   */
  async runHarness(
    threadId: ThreadId,
    userInput: UserInput,
    options?: {
      goal?: string;
      acceptanceCriteria?: string[];
      maxContinuations?: number;
      signal?: AbortSignal;
      /** Gap 1: 调用方预生成的 harnessRunId，用于 API 立即返回 */
      harnessRunId?: string;
    },
  ): Promise<HarnessResult> {
    const signal = options?.signal;
    // Gap 1: 支持调用方预生成 harnessRunId，使 API 可立即返回
    // — English: accept caller-provided harnessRunId so API can return immediately
    const goalTracker = new GoalTracker(threadId, options?.harnessRunId);
    const ledger = new EvidenceLedger();
    const contextMgr = new HarnessContextManager(this.store, ledger, goalTracker);
    const stormBreaker = new StormBreaker({
      threshold: this.config.stormThreshold,
      blockedThreshold: this.config.stormBlockedThreshold,
    });
    const readinessCritic = new ReadinessCritic(ledger, goalTracker);
    const evaluator = new GoalEvaluator(this.model, this.config.evaluatorModelName);
    const harnessRunId = goalTracker.getHarnessRunId();

    // Gap 6: 互斥检查
    if (!(await GoalTracker.canStartNewHarness(this.store, threadId))) {
      throw new Error('Thread already has an active harness run. Cancel or wait for it to finish first.');
    }

    // 1. 设置 goal
    const objective = options?.goal ?? extractGoalFromInput(userInput);
    const criteria = options?.acceptanceCriteria ?? await deriveCriteriaFromInput(userInput);
    goalTracker.setGoal(objective, criteria, {
      maxContinuations: options?.maxContinuations ?? this.config.maxContinuations,
      maxNoProgress: this.config.maxNoProgress,
    });
    ledger.setCriteria(criteria);
    await goalTracker.persist(this.store);

    // 2. 第一轮：正常 runTurn（用户输入）
    let result = await this.agentLoop.runTurn(threadId, userInput, signal);
    ledger.recordTurn(result.items, threadId, '', harnessRunId);

    // 3. 自主循环
    while (goalTracker.canContinue()) {
      // 3a. Readiness gate（确定性规则）
      const stormCheck = stormBreaker.check(result.items);
      const readiness = readinessCritic.check(result.items, stormCheck);
      if (!readiness.passed) {
        // 注入 retry instruction，继续 AgentLoop
        const retryInput = makeRetryInput(readiness.retryInstruction ?? 'readiness gate failed');
        result = await this.agentLoop.runTurn(threadId, retryInput, signal, {
          source: 'harness',
          visibleToUser: false,
          harnessRunId,
          harnessIteration: goalTracker.getState().iteration,
          skipColdMemory: true,
          extractMemory: false,
        });
        ledger.recordTurn(result.items, threadId, '', harnessRunId);
        continue;
      }

      // 3b. Storm breaker
      if (stormCheck.triggered) {
        const stormInput = makeStormInput(stormCheck);
        result = await this.agentLoop.runTurn(threadId, stormInput, signal, {
          source: 'harness',
          visibleToUser: false,
          harnessRunId,
          harnessIteration: goalTracker.getState().iteration,
          skipColdMemory: true,
          extractMemory: false,
        });
        ledger.recordTurn(result.items, threadId, '', harnessRunId);
        continue;
      }

      // 3c. Goal evaluation（独立模型）
      const eval_ = await evaluator.evaluate(
        goalTracker.getState().goal,
        goalTracker.getState(),
        result.items,
        ledger.getRecentEvidence(20),
        { signal },
      );

      // 3d. Gap 8: 反向更新 ledger 的 supportsCriteria
      if (eval_.criteriaEvidenceMap) {
        ledger.applyCriteriaMap(eval_.criteriaEvidenceMap);
      }

      // 3e. 记录评估，更新状态
      goalTracker.recordEvaluation(eval_);
      await goalTracker.persist(this.store);

      // 3f. 判定
      if (eval_.satisfied || eval_.status === 'satisfied') {
        goalTracker.markSatisfied();
        await goalTracker.persist(this.store);
        return this.buildResult('satisfied', goalTracker, ledger, result);
      }
      if (eval_.status === 'needs_user_input' || eval_.status === 'blocked') {
        goalTracker.markBlocked(eval_.blocker ?? eval_.status);
        await goalTracker.persist(this.store);
        return this.buildResult('blocked', goalTracker, ledger, result);
      }

      // 3g. 无进展检测
      if (goalTracker.checkNoProgress()) {
        goalTracker.markNoProgress();
        await goalTracker.persist(this.store);
        return this.buildResult('no_progress', goalTracker, ledger, result);
      }

      // 3h. 到达上限
      if (!goalTracker.canContinue()) {
        const status = goalTracker.getState().status;
        await goalTracker.persist(this.store);
        if (status === 'max_continuations') {
          return this.buildResult('max_continuations', goalTracker, ledger, result);
        }
        return this.buildResult('no_progress', goalTracker, ledger, result);
      }

      // 3i. 隐藏续跑 — 注意必须传 signal 作为第三参数（Gap 3）
      const slice = await contextMgr.buildIterationContext(threadId, this.config.contextBudget);
      const contextSliceText = renderHarnessContextSlice(slice);
      const continuationInput = makeContinuationInput(eval_, goalTracker.getState(), contextSliceText);

      result = await this.agentLoop.runTurn(
        threadId,
        continuationInput,
        signal,
        {
          source: 'harness',
          visibleToUser: false,
          harnessRunId,
          harnessIteration: goalTracker.getState().iteration,
          skipColdMemory: true,
          extractMemory: false,
        },
      );
      ledger.recordTurn(result.items, threadId, '', harnessRunId);
    }

    // 4. 到达上限
    const finalStatus = goalTracker.getState().status;
    await goalTracker.persist(this.store);
    if (finalStatus === 'max_continuations') {
      return this.buildResult('max_continuations', goalTracker, ledger, result);
    }
    if (finalStatus === 'no_progress') {
      return this.buildResult('no_progress', goalTracker, ledger, result);
    }
    return this.buildResult('blocked', goalTracker, ledger, result);
  }

  // ─── resume harness run（Gap 5） ─────────────────────────────────────────────

  /**
   * 从已有的 thread.tags 恢复 harness state，并重建 ledger。
   * 如果 state.status !== 'active'，直接返回当前状态。
   * 否则继续 harness loop。
   */
  async resumeHarness(
    threadId: ThreadId,
    options?: { signal?: AbortSignal },
  ): Promise<HarnessResult> {
    const goalTracker = new GoalTracker(threadId);
    const state = await goalTracker.load(this.store);
    if (!state) {
      throw new Error('No active harness run found for this thread.');
    }
    if (state.status !== 'active') {
      // 已结束，返回当前状态
      const ledger = new EvidenceLedger();
      await ledger.rebuildFromThreadItems(threadId, this.store, state.harnessRunId);
      return {
        status: state.status as HarnessResult['status'],
        harnessRunId: state.harnessRunId,
        iterations: state.iteration,
        finalEvaluation: state.lastEvaluation,
        evidenceCount: ledger.size(),
        items: [],
        usage: null,
      };
    }

    // 重建 ledger
    const ledger = new EvidenceLedger();
    await ledger.rebuildFromThreadItems(threadId, this.store, state.harnessRunId);
    ledger.setCriteria(state.goal.acceptanceCriteria);

    // 重新构造各组件
    const contextMgr = new HarnessContextManager(this.store, ledger, goalTracker);
    const stormBreaker = new StormBreaker({
      threshold: this.config.stormThreshold,
      blockedThreshold: this.config.stormBlockedThreshold,
    });
    const readinessCritic = new ReadinessCritic(ledger, goalTracker);
    const evaluator = new GoalEvaluator(this.model, this.config.evaluatorModelName);
    const harnessRunId = goalTracker.getHarnessRunId();

    // 取最近 items 作为上下文
    const recentItems = await this.store.getRecentItems(threadId, 60);
    let result = { items: recentItems, usage: null as import('@nexus/protocol').Usage | null };

    // 继续 harness loop
    while (goalTracker.canContinue()) {
      const stormCheck = stormBreaker.check(result.items);
      const readiness = readinessCritic.check(result.items, stormCheck);
      if (!readiness.passed) {
        const retryInput = makeRetryInput(readiness.retryInstruction ?? 'readiness gate failed');
        result = await this.agentLoop.runTurn(threadId, retryInput, options?.signal, {
          source: 'harness',
          visibleToUser: false,
          harnessRunId,
          harnessIteration: goalTracker.getState().iteration,
          skipColdMemory: true,
          extractMemory: false,
        });
        ledger.recordTurn(result.items, threadId, '', harnessRunId);
        continue;
      }

      if (stormCheck.triggered) {
        const stormInput = makeStormInput(stormCheck);
        result = await this.agentLoop.runTurn(threadId, stormInput, options?.signal, {
          source: 'harness',
          visibleToUser: false,
          harnessRunId,
          harnessIteration: goalTracker.getState().iteration,
          skipColdMemory: true,
          extractMemory: false,
        });
        ledger.recordTurn(result.items, threadId, '', harnessRunId);
        continue;
      }

      const eval_ = await evaluator.evaluate(
        goalTracker.getState().goal,
        goalTracker.getState(),
        result.items,
        ledger.getRecentEvidence(20),
        { signal: options?.signal },
      );
      if (eval_.criteriaEvidenceMap) {
        ledger.applyCriteriaMap(eval_.criteriaEvidenceMap);
      }
      goalTracker.recordEvaluation(eval_);
      await goalTracker.persist(this.store);

      if (eval_.satisfied || eval_.status === 'satisfied') {
        goalTracker.markSatisfied();
        await goalTracker.persist(this.store);
        return this.buildResult('satisfied', goalTracker, ledger, result);
      }
      if (eval_.status === 'needs_user_input' || eval_.status === 'blocked') {
        goalTracker.markBlocked(eval_.blocker ?? eval_.status);
        await goalTracker.persist(this.store);
        return this.buildResult('blocked', goalTracker, ledger, result);
      }
      if (goalTracker.checkNoProgress()) {
        goalTracker.markNoProgress();
        await goalTracker.persist(this.store);
        return this.buildResult('no_progress', goalTracker, ledger, result);
      }
      if (!goalTracker.canContinue()) {
        await goalTracker.persist(this.store);
        const status = goalTracker.getState().status;
        if (status === 'max_continuations') {
          return this.buildResult('max_continuations', goalTracker, ledger, result);
        }
        return this.buildResult('no_progress', goalTracker, ledger, result);
      }

      const slice = await contextMgr.buildIterationContext(threadId, this.config.contextBudget);
      const contextSliceText = renderHarnessContextSlice(slice);
      const continuationInput = makeContinuationInput(eval_, goalTracker.getState(), contextSliceText);
      result = await this.agentLoop.runTurn(
        threadId,
        continuationInput,
        options?.signal,
        {
          source: 'harness',
          visibleToUser: false,
          harnessRunId,
          harnessIteration: goalTracker.getState().iteration,
          skipColdMemory: true,
          extractMemory: false,
        },
      );
      ledger.recordTurn(result.items, threadId, '', harnessRunId);
    }

    await goalTracker.persist(this.store);
    const finalStatus = goalTracker.getState().status;
    if (finalStatus === 'max_continuations') {
      return this.buildResult('max_continuations', goalTracker, ledger, result);
    }
    return this.buildResult('no_progress', goalTracker, ledger, result);
  }

  // ─── 结果构造 ──────────────────────────────────────────────────────────────

  private buildResult(
    status: HarnessResult['status'],
    goalTracker: GoalTracker,
    ledger: EvidenceLedger,
    lastResult: { items: ThreadItem[]; usage: import('@nexus/protocol').Usage | null },
  ): HarnessResult {
    return {
      status,
      harnessRunId: goalTracker.getHarnessRunId(),
      iterations: goalTracker.getState().iteration,
      finalEvaluation: goalTracker.getState().lastEvaluation,
      evidenceCount: ledger.size(),
      items: lastResult.items,
      usage: lastResult.usage,
    };
  }
}
