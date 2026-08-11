# Phase 0 决策记录：Browser Engine Adapter 路径

日期：2026-08-11（实施当天）

## 结论

**采用 Electron `webContents.debugger` CDP Adapter 作为默认路径**；Playwright `connectOverCDP` 不作为正式链路。

## 依据（迁移计划 §3.2 选择标准，逐项对照）

| 选择标准 | `webContents.debugger` CDP Adapter | Playwright connectOverCDP |
| --- | --- | --- |
| 稳定识别同一页面/frame/popup/epoch | ✅ 已验证：同一 webContents 的 debugger Target（Phase 0 测试 2/3） | 需要 `--remote-debugging-port` 开放固定端口（违反 §3.2「不开放固定远程调试端口」） |
| Agent 动作与用户输入共享 Cookie/storage/内存 | ✅ 已验证：CDP Input 键入 → evaluate 读同一值；localStorage/Cookie 同会话持久（Phase 0 测试 3/4） | 同样共享（附着同一 Target），但依赖端口开放 |
| 不开放固定远程调试端口 | ✅ 不开放任何端口 | ❌ 必须开放调试端口 |
| 退出/关闭/崩溃后无调试连接或子进程残留 | ✅ 已验证：app.close() 后进程树退出（Phase 0 测试 5）；before-quit 统一 detach | Electron 退出后连接自然断开，但端口期间暴露面更大 |
| 覆盖观测/点击/输入/滚动/截图/网络/下载 | ✅ 最小子集已验证（Runtime.evaluate + Input.dispatchMouseEvent + Input.insertText）；完整能力按 Phase 1-3 扩展 | 官方定义 connectOverCDP 为「低于原生协议的连接」，部分功能可能不可用（Playwright 官方文档） |

## 执行路径（正式链路）

```text
React Renderer → typed preload API（contextBridge 白名单）
  → Electron Main（IPC 校验）
    → BrowserViewManager（WebContentsView 生命周期）
    → BrowserEngineAdapter（webContents.debugger CDP：evaluate / click / insertText）
    → 同一 WebContents（用户可见的真实页面）
```

## 保留验证项

- Playwright `_electron.launch` 仅用于**集成测试驱动**（不是浏览器执行路径）——Phase 0 测试即采用此方式。
- 若未来需要远程 Browser Worker（架构文档远期目标），再单独评估 CDP-over-network 的独立方案，不绑定本决策。

## 证据

- `tests/electron-phase0.test.ts`：5/5 通过（2026-08-11）。
