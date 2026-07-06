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
├── bot/              钉钉 / 微信等 IM 平台桥接
├── extensions/       AGENTS.md、SKILL.md、hooks 系统
apps/
├── api/              本地 Node API，负责运行时、工具执行、审批与线程控制
├── desktop/          Tauri 桌面端（Windows / macOS / Linux）
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

默认启动是 **单机模式**，使用 SQLite + 本地 rollout 文件，适合个人桌面使用。首次打开 Web 控制台可选择单人/多人模式。

## 核心能力

### Agent 运行时
- **多对话线程**：每个对话对应独立 thread，上下文和运行状态完全隔离
- **状态机**：idle / running / interrupted / completed / failed 完整状态流转
- **Checkpoint / Resume**：每轮对话和每次工具调用后写入检查点，支持随时停止、断点续跑和冷恢复
- **子 Agent**：支持 spawn 子智能体分工协作，子 Agent 继承并只能收紧父 Agent 的权限
- **上下文压缩**：三级压缩框架（轻记忆 + episode + 结构化 summary），token 达到阈值自动触发压缩

### 工具与安全
- **本地工具集**：Shell、文件读写、patch、搜索、git 等常用工具内置
- **三档权限预设**：`read_only`（只读）、`workspace`（工作区内可写 + 审批）、`danger_full_access`（完全权限）
- **人机审批**：workspace 模式下，写文件和命令类工具自动进入 Web 审批队列
- **执行策略**：shell 命令可按规则配置 allow / prompt / forbidden
- **MCP 治理**：支持 MCP 工具接入，Web 配置界面 + 运行时懒加载 + 连接状态监控

### 技能与扩展
- **Skills 系统**：支持本地 Skill 目录，按任务选择、自动匹配
- **Hooks 扩展**：AGENTS.md、SKILL.md 约定式扩展入口
- **A2A 协议**：Agent-to-Agent 标准协议，支持调用远程 Agent

### 系统监控与限流
- **实时监控**：CPU / 内存 / 磁盘占用后台采样
- **四级限流**：none → light → moderate → severe，逐级收紧
  - light：并行批 ≤ 2，禁止新子 Agent
  - moderate：全串行执行，禁止新子 Agent
  - severe：仅允许只读工具，全串行，禁止新子 Agent
- **主动通知**：限流等级变化时主动告知 Agent，自动调整执行策略

### IM 平台接入
- **微信远程助手**：桌面端个人微信桥接，消息进入绑定的 Nexus 对话
- **钉钉机器人**：Stream 模式长连接 + AI Card 流式回复 + 企业数据操作（详见下方）

## 多租户部署

多租户模式使用 Postgres 存储 + JWT 鉴权，storage 层强制按 `tenant_id` 过滤，API / runtime 按 tenant 缓存 Agent 实例。

快速启动：

```bash
NEXUS_STORAGE_MODE=multi \
NEXUS_STORAGE_BACKEND=postgres \
DATABASE_URL=postgresql://nexus:nexus@localhost:5432/nexus \
npm start
```

或使用 Docker Compose：

```bash
docker compose -f docker-compose.multi-tenant.yml up
```

## 微信远程助手

桌面端支持个人微信桥接，把微信消息接入 Nexus 对话：

- 扫码登录一次即可，切换对话不需要重新扫码
- 消息进入当前绑定的对话，可随时改绑
- 配置按 thread 独立生效（模型、权限、Skills 等）
- 收到消息先自动 ACK，处理完成后统一回复

## 钉钉机器人

Nexus 深度集成钉钉平台，支持消息收发、AI Card 流式回复、企业数据操作等完整能力。

### 接入方式

支持两种连接模式：

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| **Stream 长连接** | WebSocket 长连接，主动推送消息 | 生产环境推荐，无需公网回调地址 |
| **Webhook 回调** | HTTP 回调接收消息 | 有公网地址的服务端部署 |

配置参数：`AppKey`（clientId）、`AppSecret`（clientSecret）、`RobotCode`。

### 消息收发

- **单聊 / 群聊**：都支持，群聊需 @ 机器人触发
- **文本 / 富文本 / 图片 / 文件**：全消息类型接收
- **@ 提及解析**：自动识别 @ 姓名，三级查找策略（已知用户缓存 → dws 通讯录 → 组织成员），支持真实钉钉 @ 高亮
- **消息转发**：单聊消息可转发到目标群，附件 / 图片也支持转发
- **自动降级**：session webhook 过期（错误码 300001）时自动降级为机器人主动发送
- **文件传输**：最大 20MB，支持下载钉钉附件并转发到群

### AI Card 流式回复

- 专属 AI Card 模板，支持 Markdown 内容流式追加
- 思考中 / 生成中 / 已完成 状态可视化
- 同一张卡片持续更新，不刷屏

### 企业数据操作（dws CLI）

通过 dws 命令行工具操作钉钉企业数据，Agent 可以直接调用：

| 能力 | 说明 |
|------|------|
| **通讯录** | 搜索联系人、查询组织成员 |
| **日历** | 创建 / 查询 / 修改日程事件 |
| **待办** | 创建待办、指定执行人、状态跟踪 |
| **AI 表格** | 读写钉钉智能表格 / 多维表格 |
| **文档** | 读写钉钉文档、云盘文件 |
| **考勤** | 查询考勤记录、排班信息 |
| **DING 消息** | 发送 DING 消息加急通知 |
| **审批** | 发起 / 查询审批单 |
| **群聊管理** | 管理群成员、群设置 |

调用方式为统一的 `dingtalk` 工具，通过 `action` 参数区分：

- `send_message`：发送 / 转发消息到群
- `dws_exec`：执行 dws 命令（如 `["calendar","event","list"]`）
- `dws_schema`：查询可用的 dws 产品和工具
- `dws_auth_status`：检查 dws 登录状态和当前组织

支持 `dwsDryRun` 预览破坏性操作，`dwsJq` 过滤 JSON 输出减少 token 消耗。

## 后续重点

- Plan 模式：规划 → 审批 → 执行 → 回滚 完整工作流
- 输入框命令：`/skills add`、`/mcp add`、`/plan` 等应用内命令
- 上下文压缩：完善三级压缩、handoff summary、缓存命中统计
- 恢复能力：增强主动停止、异常退出、进程重启后的恢复体验

## 许可证

MIT
