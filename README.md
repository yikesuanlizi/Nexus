# Nexus

**本地 Agent OS**，一个用 TypeScript 和 React 构建的多智能体全能工作台。

项目目标是做一个完全本地运行的全能智能体系统：不依赖 ChatGPT 登录、不强制使用 OpenAI API、不绑定云端任务服务。模型侧默认面向 Ollama / LM Studio / vLLM / OpenAI-compatible endpoint。

## 架构

```text
packages/
├── protocol/         事件协议、Thread/Turn/Item 类型、审批与 checkpoint 类型
├── model-gateway/    Ollama / LM Studio / vLLM / OpenAI-compatible 适配层
├── tools/            Shell、文件系统、patch、搜索、git 等本地工具
├── sandbox/          权限预设、执行策略、审批 handler
├── storage/          单机 SQLite + JSONL；可选 Postgres 多租户存储
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

默认启动是 **单机模式**：`NEXUS_STORAGE_MODE=single`，使用 SQLite + 本地 rollout 文件，适合个人桌面使用，不需要额外数据库。

首次打开 Web 控制台时，如果没有显式部署环境变量，也没有保存过初始化设置，会显示部署初始化页：

- 单人模式：无登录，本地桌面和个人微信 bridge 场景。
- 多人模式：需要部署人手动输入 JWT 签名密钥，随后启用 token/JWT 登录、tenant 隔离和管理员 token 管理。

部署模式优先级固定为：

```text
初始化设置 deployment.mode.v1 > 环境变量 > 默认 single
```

也就是说，如果初始化界面已经保存过单人/多人模式，即使环境变量同时存在，也以初始化设置为准。

## 多租户部署

生产/团队部署通常先显式启用 Postgres，然后在 Web 初始化页选择 **多人模式** 并输入首次密钥：

```bash
NEXUS_STORAGE_MODE=multi
NEXUS_STORAGE_BACKEND=postgres
DATABASE_URL=postgresql://nexus:nexus@localhost:5432/nexus
NEXUS_CORS_ORIGINS=http://127.0.0.1:5177,http://localhost:5177
```

无人值守部署仍可完全走环境变量：

```bash
NEXUS_DEPLOYMENT_MODE=multi
NEXUS_AUTH_MODE=token
NEXUS_JWT_SECRET=replace-with-a-long-random-secret
NEXUS_ADMIN_BOOTSTRAP_TOKEN=replace-with-a-bootstrap-admin-token
```

也可以用 Docker Compose 模板启动 Postgres + Nexus：

```bash
docker compose -f docker-compose.multi-tenant.yml up
```

多租户模式下：

- 多人模式启用后使用 token/JWT。客户端先用管理员签发的原始 token 调 `/api/auth/login`，再用返回的 JWT 访问普通 API。
- 如果通过初始化界面首次开启多人模式，部署人输入的首次密钥会保存为 JWT 签名密钥；系统会生成一个初始管理员 token，并只在初始化结果中显示一次。
- JWT 内的 `tenantId` 是租户边界来源；`x-nexus-tenant-id` 只作兼容校验，若与 JWT 租户不一致会返回 403。
- 管理员 token 通过 `/api/admin/tokens` 创建、禁用、删除、轮换。首次初始化可使用 `x-nexus-admin-bootstrap-token`，后续建议改用管理员 JWT。
- CORS 由 `NEXUS_CORS_ORIGINS` 白名单控制；启用鉴权后不再对任意 Origin 返回通配允许。
- 线程、轮次、item、checkpoint、settings、子 agent edge 都由 storage 层强制按 `tenant_id` 过滤。
- API / runtime 按 tenant 缓存 agent、MCP manager、config repository 和 SSE client，避免串租户。
- SQLite 仍保留为本地 fallback，不建议作为多节点或团队生产存储。

## 当前能力

- 本地多对话：每个对话对应独立 thread，用于隔离上下文和运行状态。
- Thread / Turn / Item 模型：保留可恢复的对话、轮次、事件和工具调用记录。
- 本地持久化：单机默认 SQLite 保存线程元数据，JSONL 保存对话轨迹和 checkpoint；多租户部署可切换为 Postgres。
- 运行态状态机：维护 idle / running / interrupted / completed / failed 等线程状态。
- checkpoint / resume：每轮和每次工具调用后写入 checkpoint，支持停止后继续与冷恢复。
- 权限预设：`read_only`、`workspace`、`danger_full_access` 三档权限。
- 人机审批：workspace 模式下，写文件和命令类工具可进入 Web 审批队列。
- 执行策略：shell 命令可按规则 allow / prompt / forbidden。
- Web 控制台：支持新建对话、发送消息、事件流、设置抽屉、Skills/MCP 本地配置、审批操作。
- 扩展入口：支持 AGENTS.md、SKILL.md 和 hooks 作为后续扩展基础。
- 微信远程助手：桌面端托管个人微信桥接，微信消息可进入当前绑定的 Nexus 对话。

## 微信远程助手语义

Nexus 把“微信账号登录”和“对话绑定”分开处理：

- 微信扫码登录是全局账号状态。只要 token 仍有效，切换 Nexus 对话不需要重新扫码。
- 当前机器人目标是一个 `activeThreadId`。微信消息只进入这个当前绑定的 Nexus 对话。
- 在另一个对话里点击微信远程助手按钮，只会把 `activeThreadId` 改绑到当前对话，不会退出登录。
- 设置页只负责微信登录、退出、账号和监听状态；对话绑定标志显示在输入框工具区。
- 删除当前绑定的 Nexus 对话只会清空 `activeThreadId`，不会退出微信账号。
- 未绑定、绑定对话已删除、或旧 bot session 指向已删除对话时，微信入站会自动创建一个无工作区纯对话并回写为新的 `activeThreadId`；绑定后优先进入绑定对话。
- 退出微信登录会停止监听、调用 bridge logout，并清空 `accountId` 与 `activeThreadId`；不会删除 Nexus 对话历史。

微信入站运行时使用绑定对话自己的线程级配置，而不是全局 UI 的临时状态。也就是说，以下配置都按 thread 独立生效：

- 模型与 provider。
- `read_only` / `workspace` / `danger_full_access` 权限模式。
- 思考程度。
- 缓存优先 / 长运行模式。
- workspaceRoot。
- Skills、MCP、web_search 相关配置。

子 agent 默认继承父 thread 的配置和权限，权限只能收紧，不能自行放宽。

## 微信响应性能策略

微信链路天然比 Web 对话慢，因为它需要经过微信 bridge 轮询、Nexus agent turn、工具执行和微信发送接口。当前优化策略是：

- bridge 收到微信消息后先发送“已收到，正在处理。”作为即时 ACK。
- Nexus 内部仍按正常 agent turn 运行，最终回答完成后同步回微信。
- 最终回答默认保持单条微信回复，不把长回复拆成一堆气泡。
- 如果微信接口不支持同一气泡编辑，Nexus 不做逐字 delta 刷屏；后续可扩展为平台支持时的同气泡流式更新。
- 工具循环、web_search/web_fetch 和长任务由 runtime 的最大迭代、工具治理和缓存/压缩策略共同约束。
- 缓存优先模式适合微信远程助手的快速交互；长运行模式适合复杂编程任务。

## 工程取舍

| 能力领域 | Nexus 当前实现 |
|---|---|
| 对外协议 | 本地 HTTP API + SSE 事件，前后端分离 |
| 安全沙箱 | TypeScript 策略引擎与权限预设 |
| 鉴权体系 | 单机默认关闭鉴权，多租户使用本地 token + JWT |
| 多租户隔离 | storage 层按 tenant_id 强制过滤 |
| Thread / Turn / Item 模型 | 已实现并简化，支持可恢复对话 |
| 执行策略 | 保留基础版本，shell 命令按规则 allow / prompt / forbidden |
| SQLite + JSONL thread-store | 作为单机轻量模式保留 |
| Postgres 多租户 thread-store | 已有 storage adapter 与 Docker Compose 部署模板 |
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
