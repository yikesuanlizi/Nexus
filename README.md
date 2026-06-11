# Nexus

**本地 Agent OS**，一个用 TypeScript 和 React 构建的多智能体编程工作台。

项目目标是做一个完全本地运行的编程智能体系统：不依赖 ChatGPT 登录、不强制使用 OpenAI API、不绑定云端任务服务。模型侧默认面向 Ollama / LM Studio / vLLM / OpenAI-compatible endpoint。

## 架构

```text
packages/
├── protocol/         事件协议、Thread/Turn/Item 类型、审批与 checkpoint 类型
├── model-gateway/    Ollama / LM Studio / vLLM / OpenAI-compatible 适配层
├── tools/            Shell、文件系统、patch、搜索、git 等本地工具
├── sandbox/          权限预设、执行策略、审批 handler
├── storage/          SQLite 元数据 + JSONL 对话轨迹
├── runtime/          Agent 主循环、工具调用、审批、状态机、checkpoint/resume
├── memory/           上下文压缩、恢复、分支、回滚
├── extensions/       AGENTS.md、SKILL.md、hooks 系统
apps/
├── api/              本地 Node API，负责运行时、工具执行、审批与线程控制
└── web/              React + TypeScript 本地控制台
```

## 快速启动

```bash
npm install
npm start
```

启动后打开：

- Web 控制台：http://127.0.0.1:5177
- API 服务：http://127.0.0.1:4127

## 当前能力

- 本地多对话：每个对话对应独立 thread，用于隔离上下文和运行状态。
- Thread / Turn / Item 模型：保留可恢复的对话、轮次、事件和工具调用记录。
- 本地持久化：SQLite 保存线程元数据，JSONL 保存对话轨迹和 checkpoint。
- 运行态状态机：维护 idle / running / interrupted / completed / failed 等线程状态。
- checkpoint / resume：每轮和每次工具调用后写入 checkpoint，支持停止后继续与冷恢复。
- 权限预设：`read_only`、`workspace`、`danger_full_access` 三档权限。
- 人机审批：workspace 模式下，写文件和命令类工具可进入 Web 审批队列。
- 执行策略：shell 命令可按规则 allow / prompt / forbidden。
- Web 控制台：支持新建对话、发送消息、事件流、设置抽屉、Skills/MCP 本地配置、审批操作。
- 扩展入口：支持 AGENTS.md、SKILL.md 和 hooks 作为后续扩展基础。

## 工程取舍

| 编程 Agent 能力 | Nexus 当前实现 |
|---|---|
| JSON-RPC / stdio 协议 | 改为本地 HTTP API + SSE 事件 |
| OS 级沙箱 | 暂用 TypeScript 策略引擎与权限预设 |
| 云端任务 / 账号体系 | 移除，仅保留本地运行 |
| 企业 IAM / 组织治理 | 移除 |
| Thread / Turn / Item 模型 | 保留并简化 |
| exec policy 前缀规则 | 保留基础版本 |
| SQLite + JSONL thread-store | 保留核心结构 |
| checkpoint / resume | 已实现基础版本 |
| 上下文压缩 | 已有简化版本，仍需增强三级压缩与结构化传递 |
| Skills / Hooks | 已有基础入口，仍需完善多 skills 调度和懒加载 |
| MCP 治理 | Web 可配置，懒加载和运行时治理仍需继续补 |
| Plan 模式 | 待实现 |

## 后续重点

- 输入框命令：支持 `/skills add`、`/mcp add`、`/plan` 等应用内命令。
- Plan 模式：把规划、审批、执行、回滚和事件流组合成更清晰的交互模式。
- MCP 治理：补充 MCP 懒加载、连接状态、工具可见性、失败隔离和配置校验。
- 多 Skills：支持按任务选择、显式启用、自动匹配、冲突处理和运行期可观测。
- 上下文压缩：完善三级上下文压缩、结构化 summary、handoff summary 和缓存命中统计。
- 恢复能力：继续增强主动停止、异常退出、进程重启后的恢复体验。

## 许可证

MIT
