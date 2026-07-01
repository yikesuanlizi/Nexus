import type { RunConfig } from './config.js';

// 任务模式：规划 / 代码审查 / 调试 / 前端优化
// Chinese translation: Task mode: plan / code review / debug / frontend polish.
export type TaskMode = 'plan' | 'review' | 'debug' | 'frontend';

// 根据模式和语言返回相应的模型系统指令文本，会直接传给模型
// Chinese translation: Returns the model system instruction text corresponding to the given mode and language, sent directly to the model.
export function modeInstructionFor(mode: TaskMode, locale: RunConfig['locale']): string {
  const zh = locale === 'zh';
  const instructions: Record<TaskMode, string> = {
    plan: zh
      ? '本轮使用计划模式：只分析和规划，不修改文件、不运行会产生副作用的命令。输出清晰、可执行的步骤，并标注风险和需要确认的点。'
      : 'Use planning mode for this turn: analyze and plan only. Do not edit files or run mutating commands. Return clear actionable steps, risks, and confirmation points.',
    review: zh
      ? '本轮使用代码审查模式：优先列出缺陷、回归风险和缺失测试，按严重程度排序，引用具体文件或行为依据。总结放在问题之后。'
      : 'Use code review mode for this turn: lead with bugs, regressions, and missing tests ordered by severity. Reference concrete files or behavior. Put summary after findings.',
    debug: zh
      ? '本轮使用调试模式：先复现或定位，再形成假设并逐步验证。修复必须保持最小范围，并说明验证命令。'
      : 'Use debugging mode for this turn: reproduce or localize first, form hypotheses, verify step by step, keep fixes scoped, and report validation commands.',
    frontend: zh
      ? '本轮使用前端优化模式：按成熟产品界面标准处理布局、密度、状态、响应式和视觉一致性；避免大字、浮夸装饰和无用说明。'
      : 'Use frontend polish mode for this turn: improve layout, density, states, responsiveness, and visual consistency with product-grade restraint. Avoid oversized text and decorative filler.',
  };
  return instructions[mode];
}
