// URL 敏感信息清洗：查询参数/片段/userinfo 可能携带 code/token/凭据，
// 进入 Trace 或 LLM 上下文前必须剥离（架构文档 4.6 Trace 隐私 / 13.2 凭证规则）。
// — English: URL sanitization — query/hash/userinfo may carry code/token
//   credentials and must be stripped before entering Trace or LLM context
//   (architecture §4.6 trace privacy / §13.2 credential rules).
export function stripSensitiveUrl(raw?: string): string | undefined {
  if (raw === undefined) return undefined;
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return raw;
  }
}

// 只剥 userinfo、保留查询参数（审批展示/导航确认场景需要可见 query）。
// — English: strips only userinfo, keeps query — for approval display and
//   navigation confirmation where the query must remain visible.
export function stripUrlUserInfo(raw?: string): string | undefined {
  if (raw === undefined) return undefined;
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return raw;
  }
}
