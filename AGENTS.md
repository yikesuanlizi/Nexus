# AGENTS.md

## 项目定位

- 本项目是 `Nexus`，目标是一个本地优先的 TypeScript + React Agent OS 原型。
- 参考 Codex 的工程思路，但不要照搬 CLI 优先结构；本项目优先前端 Web 交互、API 服务、runtime/storage/model-gateway 分层。
- 默认工作区是 `E:\langchain\Nexus`。
- 阶段路线：缓存命中治理 → 最终 UI 改造 → 远程机器人连接器（QQ、微信/企业微信、飞书、钉钉统一 Bot Adapter）→ 桌面端封装。不要在机器人连接器完成前急着做桌面端。

## 强约束

- 修改或新增 `Nexus` 功能前，第一步必须先对照 `E:\langchain\codex` 的 Codex 源码逻辑、行为和工程边界；Skills、MCP、斜杠命令、web_search、线程/rollout/resume 等能力尤其如此。确认 Codex 做法后，只做适配本项目前端 Web + API 分层的最小改动，不要凭空另造流程。
- 只把 `src/` 视为开发源码。`dist/`、`dist-types/`、`apps/web/dist/` 都是生成物，不能手改，不能把里面的代码当作架构依据。
- 修改运行时代码后需要重启 `npm start` 对应的 API/Vite 服务，否则浏览器可能还在跑旧进程；除非用户明确要求，助手禁止自行启动、重启或后台占用本项目服务，只能提示用户手动重启。
- 不要留下临时验证线程、临时 rollout、临时测试文件；验证结束后清理。
- 前后端交互失败必须闭环：后端 turn 失败时要写入 `error` item，SSE 要发出失败事件，前端 REST 失败后要重新拉取线程，不能只显示空白或只在事件栏出现。
- 用户消息已经用黑色气泡区分，不要再在气泡内额外显示“你”这类角色标题。
- 工具调用增长时，页面不能整体滚动或被撑开；滚动必须限制在 transcript/event pane 内部，输入框必须始终可见。
- 侧栏折叠必须真实收缩宽度；悬浮 rail/侧栏时可以临时展开。
- 回车发送消息，`Shift+Enter` 换行。
- 不要执行npm install,这是管理员权限，也不要用.npm-cache,执行npm install告诉管理员执行

## 目录边界

- `apps/web/src/`：React 前端源码。UI 状态、事件展示、输入框、设置面板都在这里。
- `apps/api/src/`：HTTP API、SSE、配置持久化、provider/key/preset 管理。
- `packages/runtime/src/`：AgentLoop、状态机、checkpoint、turn 执行、工具调用编排。
- `packages/storage/src/`：SQLite + JSONL 持久化。
- `packages/model-gateway/src/`：OpenAI-compatible / Anthropic-like provider 网关。
- `packages/protocol/src/`：跨层共享类型和 schema。
- `packages/tools/src/`：内置工具注册。
- `tests/`：推荐放新的跨包或集成测试。

## 源码分层约束

- `apps/web/src/main.tsx` 只做 App 级状态编排、API 调用和页面布局，不能继续堆 i18n、类型定义、设置表单、item 渲染、列表合并算法。
- `apps/web/src/components/` 放可复用 UI 组件；复杂组件应自带局部状态，但不要直接写后端协议逻辑。
- `apps/web/src/threadView.ts` / `threadItems.ts` 放对话视图模型、事件归一化、item 合并等纯前端转换逻辑。
- `apps/api/src/server.ts` 只做路由和运行时编排；HTTP 解析/响应放 `http.ts`，配置、模型预设、线程配置持久化放 `config.ts`。
- 后续新增 provider、权限、skills/mcp 管理时，优先扩展相应层，不要直接塞进 `main.tsx` 或 `server.ts`。
- 单文件超过约 800 行时，先判断是否已经混合了状态编排、UI 展示、协议转换或持久化逻辑；能拆就先拆边界。

## 测试与生成物

- 新增测试优先放 `tests/`，除非是很小的包内单元测试且与源码强相关。
- Vitest 只应运行源码测试，不能运行 `dist` 或 `dist-types` 里的生成测试。
- 如果测试输出里出现 `dist-types/*.test.js`，先修 Vitest exclude/project 配置，不要继续在生成物上修。
- `npm test`、`npm run build`、`npm --prefix apps/web run build` 是常用验证命令。

## 前端交互约束

- 主界面第一屏就是可用聊天，不做营销页。
- 设置、provider key、skills、mcp 属于设置面板，不堆在主聊天界面明面上。
- 权限模式属于输入框附近的运行模式选择，而不是深藏在设置里。
- 右侧运行轨迹只展示运行状态、工具、错误和 token 摘要；用户消息显示在对话区，不重复进入轨迹栏。
- React list key 必须稳定，不能用会重复或会随状态更新冲突的数字 id。

## 调试工作流

1. 先复现并读真实错误：浏览器 console、API 返回、rollout JSONL、turn 状态。
2. 区分四层：前端渲染、SSE 事件、REST `/turn` 返回、runtime/storage 落盘。
3. 工具成功但前端失败时，优先检查是否缺少最终 `agent_message` 或 `error` item。
4. 不要只做视觉遮掩；失败必须在 thread items 中可追溯。
5. 修完后至少跑相关单测、全量 `npm test`，并用浏览器或 API 验证一条真实消息链路。

## 代码风格

- 先小步修复，不做无关大重构。
- 结构调整要先写清目标和边界；不要一边修 bug 一边大搬家。
- 中文 UI 文案保持简洁，避免解释型废话。
- 生成物、日志、数据库、rollout 不进入总结或人工维护。
