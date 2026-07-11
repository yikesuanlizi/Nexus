import type { IncomingMessage, ServerResponse } from 'node:http';
import { statSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sendError, sendJson, readJson } from '../shared/http.js';
import { McpRuntimeManager, McpServerConfig, normalizeMcpServerId, type McpCallToolResult } from '@nexus/runtime';

const GITNEXUS_DEFAULT_ID = 'gitnexus';
const GITNEXUS_DEFAULT_NAME = 'gitnexus';

const DEFAULT_GITNEXUS_CONFIG: McpServerConfig = {
  id: GITNEXUS_DEFAULT_ID,
  name: GITNEXUS_DEFAULT_NAME,
  command: 'gitnexus',
  args: 'mcp',
  enabled: true,
};

function findGitNexusServerId(configs: McpServerConfig[]): string | null {
  for (const cfg of configs) {
    const name = cfg.name?.toLowerCase() ?? '';
    const id = cfg.id?.toLowerCase() ?? '';
    if (name === 'gitnexus' || id === 'gitnexus' || id === 'mcp-gitnexus') {
      return normalizeMcpServerId(cfg.id || cfg.name);
    }
  }
  return null;
}

export interface GitNexusRouteOptions {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  mcpManager: McpRuntimeManager;
  listMcpServers(): Promise<McpServerConfig[]>;
}

export async function handleGitNexusRoute(options: GitNexusRouteOptions): Promise<boolean> {
  const { req, res, url, mcpManager, listMcpServers } = options;
  if (!url.pathname.startsWith('/api/gitnexus')) return false;
  console.log('[GitNexus route]', req.method, url.pathname);

  try {
    let servers = await listMcpServers();
    const existingId = findGitNexusServerId(servers);
    if (!existingId) {
      servers = [...servers, DEFAULT_GITNEXUS_CONFIG];
    }
    await mcpManager.configure(servers, { startEnabled: false });
    const serverId = findGitNexusServerId(servers) ?? GITNEXUS_DEFAULT_ID;

    if (req.method === 'GET' && url.pathname === '/api/gitnexus/health') {
      sendJson(res, 200, { ok: true, data: { serverId, servers: servers.length } });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/gitnexus/status') {
      const repoPath = url.searchParams.get('repo')?.trim() || '';
      if (!repoPath) {
        sendError(res, 400, 'Repo path is required');
        return true;
      }
      // 先从 list_repos 判断是否已索引
      const reposResult = await mcpManager.callTool(serverId, 'list_repos', {});
      console.log('[GitNexus status] list_repos raw result:', JSON.stringify(reposResult, null, 2));
      const reposData = parseMcpResult(reposResult);
      console.log('[GitNexus status] parsed repos data:', JSON.stringify(reposData, null, 2));
      const reposList = Array.isArray(reposData)
        ? reposData
        : Array.isArray((reposData as Record<string, unknown>)?.repos)
          ? (reposData as Record<string, unknown>).repos
          : Array.isArray((reposData as Record<string, unknown>)?.repositories)
            ? (reposData as Record<string, unknown>).repositories
            : [];
      console.log('[GitNexus status] repoPath:', repoPath, 'normalized:', normalizeFsPath(repoPath));
      console.log('[GitNexus status] repos list:', JSON.stringify(reposList, null, 2));
      const matched = (reposList as Array<Record<string, unknown>>).find((r) => {
        const p = String(r.path ?? r.location ?? r.directory ?? '');
        return normalizeFsPath(p) === normalizeFsPath(repoPath)
          || normalizeFsPath(repoPath).startsWith(normalizeFsPath(p) + '/');
      });
      console.log('[GitNexus status] matched:', JSON.stringify(matched, null, 2), 'indexed:', !!matched);
      const indexed = !!matched;
      let fileCount: number | undefined;
      let lastIndexed: string | undefined;
      let needsUpdate = false;
      if (matched) {
        fileCount = typeof matched.fileCount === 'number' ? matched.fileCount : undefined;
        lastIndexed = matched.lastIndexed ? String(matched.lastIndexed) : undefined;
        // 检查 .gitnexus 目录和源码目录修改时间，粗略判断是否需要更新
        const gitnexusDir = join(repoPath, '.gitnexus');
        if (existsSync(gitnexusDir)) {
          try {
            const indexMtime = statSync(gitnexusDir).mtimeMs;
            const srcMtime = findLatestSrcMtime(repoPath, 3);
            if (srcMtime > indexMtime) {
              needsUpdate = true;
            }
          } catch {
            // 忽略 stat 错误
          }
        }
      }
      sendJson(res, 200, { ok: true, data: { indexed, fileCount, lastIndexed, needsUpdate } });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/gitnexus/overview') {
      const repo = url.searchParams.get('repo')?.trim() || '';
      // 用 Cypher 统计各类节点数量和关系数量
      const labelTypes = ['Class', 'Interface', 'Method', 'Function', 'Route', 'Enum', 'Annotation', 'Constructor'];
      const labelQueries = labelTypes.map((label) =>
        mcpManager.callTool(serverId, 'cypher', {
          query: `MATCH (n:${label}) WHERE n.filePath IS NOT NULL RETURN count(*) AS cnt`,
          repo,
        }).then((r) => {
          const data = parseMcpResult(r);
          const rows = extractCypherRows(data);
          const cnt = rows.length > 0 ? Number(getRecordValue(rows[0], 'cnt') ?? 0) : 0;
          return { label, count: cnt };
        }).catch(() => ({ label, count: 0 })),
      );

      const relQuery = `
        MATCH ()-[r:CodeRelation]->()
        RETURN r.type AS relType, count(*) AS cnt
        ORDER BY cnt DESC
        LIMIT 20
      `;
      const statsQuery = `
        MATCH (f:File) RETURN count(*) AS fileCount
      `;

      const [labelsResult, relResult, statsResult] = await Promise.allSettled([
        Promise.all(labelQueries),
        mcpManager.callTool(serverId, 'cypher', { query: relQuery, repo }),
        mcpManager.callTool(serverId, 'cypher', { query: statsQuery, repo }),
      ]);

      const labels: Array<{ label: string; count: number }> = [];
      if (labelsResult.status === 'fulfilled') {
        for (const item of labelsResult.value) {
          if (item.count > 0) {
            labels.push(item);
          }
        }
        labels.sort((a, b) => b.count - a.count);
      }

      const relations: Array<{ type: string; count: number }> = [];
      if (relResult.status === 'fulfilled') {
        const data = parseMcpResult(relResult.value);
        const rows = extractCypherRows(data);
        for (const row of rows) {
          const type = String(getRecordValue(row, 'relType') ?? '');
          const count = Number(getRecordValue(row, 'cnt') ?? 0);
          if (type && count > 0) {
            relations.push({ type, count });
          }
        }
      }

      let fileCount = 0;
      if (statsResult.status === 'fulfilled') {
        const data = parseMcpResult(statsResult.value);
        const rows = extractCypherRows(data);
        if (rows.length > 0) {
          fileCount = Number(getRecordValue(rows[0], 'fileCount') ?? 0);
        }
      }

      sendJson(res, 200, { ok: true, data: { labels, relations, fileCount } });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/gitnexus/tools') {
      // 确保 server 已启动以获取真实工具列表
      try {
        await mcpManager.callTool(serverId, 'list_repos', {});
      } catch {
        // 即使调用失败也尝试获取已缓存的工具列表
      }
      const statuses = mcpManager.statuses();
      const server = statuses.find((s) => s.id === serverId);
      const tools = server?.tools ?? [];
      sendJson(res, 200, { ok: true, data: tools });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/gitnexus/repos') {
      const result = await mcpManager.callTool(serverId, 'list_repos', {});
      const data = parseMcpResult(result);
      sendJson(res, 200, { ok: true, data });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/gitnexus/analyze') {
      const body = await readJson<{ path: string }>(req);
      const repoPath = body.path?.trim();
      if (!repoPath) {
        sendError(res, 400, 'Path is required');
        return true;
      }
      const result = await mcpManager.callTool(serverId, 'analyze', { path: repoPath });
      const data = parseMcpResult(result);
      sendJson(res, 200, { ok: true, data });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/gitnexus/query') {
      const q = url.searchParams.get('q')?.trim() ?? '';
      const repo = url.searchParams.get('repo')?.trim() ?? undefined;
      if (!q) {
        sendError(res, 400, 'Query is required');
        return true;
      }
      const result = await mcpManager.callTool(serverId, 'query', { q, repo });
      const data = parseMcpResult(result);
      sendJson(res, 200, { ok: true, data });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/gitnexus/context') {
      const symbol = url.searchParams.get('symbol')?.trim() ?? '';
      const repo = url.searchParams.get('repo')?.trim() ?? undefined;
      if (!symbol) {
        sendError(res, 400, 'Symbol is required');
        return true;
      }
      const result = await mcpManager.callTool(serverId, 'context', { symbol, repo });
      const data = parseMcpResult(result);
      sendJson(res, 200, { ok: true, data });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/gitnexus/impact') {
      const symbol = url.searchParams.get('symbol')?.trim() ?? '';
      const repo = url.searchParams.get('repo')?.trim() ?? undefined;
      if (!symbol) {
        sendError(res, 400, 'Symbol is required');
        return true;
      }
      const result = await mcpManager.callTool(serverId, 'impact', { symbol, repo });
      const data = parseMcpResult(result);
      sendJson(res, 200, { ok: true, data });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/gitnexus/trace') {
      const from = url.searchParams.get('from')?.trim() ?? '';
      const to = url.searchParams.get('to')?.trim() ?? '';
      const repo = url.searchParams.get('repo')?.trim() ?? undefined;
      if (!from || !to) {
        sendError(res, 400, 'Both from and to are required');
        return true;
      }
      const result = await mcpManager.callTool(serverId, 'trace', { from, to, repo });
      const data = parseMcpResult(result);
      sendJson(res, 200, { ok: true, data });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/gitnexus/cypher') {
      const query = url.searchParams.get('q')?.trim() ?? '';
      const repo = url.searchParams.get('repo')?.trim() ?? undefined;
      if (!query) {
        sendError(res, 400, 'Query is required');
        return true;
      }
      const result = await mcpManager.callTool(serverId, 'cypher', { query, repo });
      const data = parseMcpResult(result);
      sendJson(res, 200, { ok: true, data });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/gitnexus/graph') {
      const repo = url.searchParams.get('repo')?.trim() ?? '';
      const level = url.searchParams.get('level')?.trim() || 'file';
      const limit = Number(url.searchParams.get('limit') ?? '300');
      if (!repo) {
        sendError(res, 400, 'Repo is required');
        return true;
      }
      const graphData = await buildDependencyGraph(mcpManager, serverId, repo, level, limit);
      sendJson(res, 200, { ok: true, data: graphData });
      return true;
    }

    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log('[GitNexus route] error:', message);
    sendError(res, 500, `GitNexus error: ${message}`);
    return true;
  }
}

function parseMcpResult(result: { content: unknown }): unknown {
  const content = result.content as Array<{ type?: string; text?: string }> | undefined;
  const textContent = content?.find((c) => c?.type === 'text')?.text;
  if (!textContent) return null;
  // 先尝试直接解析
  try {
    return JSON.parse(textContent);
  } catch {
    // GitNexus 返回常带 markdown 后缀（\n\n---\n**Next:** ...）
    // 截取首个 markdown 分隔符前的内容再尝试
    const sepIdx = textContent.indexOf('\n---');
    const candidate = sepIdx >= 0 ? textContent.slice(0, sepIdx).trim() : textContent;
    if (candidate !== textContent) {
      try {
        return JSON.parse(candidate);
      } catch {
        // fall through
      }
    }
    // 最后尝试提取首个 { 到最后一个 } 的范围（处理嵌套）
    const firstBrace = textContent.indexOf('{');
    const lastBrace = textContent.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(textContent.slice(firstBrace, lastBrace + 1));
      } catch {
        // fall through
      }
    }
    return textContent;
  }
}

function normalizeFsPath(p: string): string {
  const normalized = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

const SRC_EXTENSIONS = new Set([
  '.java', '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.c', '.cpp', '.h',
  '.cs', '.rb', '.php', '.swift', '.kt', '.scala', '.clj', '.ex', '.exs',
  '.sql', '.vue', '.svelte',
]);

function findLatestSrcMtime(dir: string, maxDepth: number): number {
  let latest = 0;
  function walk(current: string, depth: number) {
    if (depth > maxDepth) return;
    try {
      const entries = readdirSync(current, { withFileTypes: true }) as Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
      for (const entry of entries) {
        const full = join(current, entry.name);
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'target' || entry.name === 'build' || entry.name === 'dist') continue;
        if (entry.isDirectory()) {
          walk(full, depth + 1);
        } else if (entry.isFile()) {
          const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
          if (SRC_EXTENSIONS.has(ext)) {
            try {
              const mtime = statSync(full).mtimeMs;
              if (mtime > latest) latest = mtime;
            } catch {
              // ignore
            }
          }
        }
      }
    } catch {
      // ignore read errors
    }
  }
  walk(dir, 0);
  return latest;
}

function extractList(parsed: unknown): Array<Record<string, unknown>> {
  if (!parsed || typeof parsed !== 'object') return [];
  const s = parsed as Record<string, unknown>;
  const raw = Array.isArray(s.results) ? s.results
    : Array.isArray(s.symbols) ? s.symbols
    : Array.isArray(s.matches) ? s.matches
    : Array.isArray(s.repositories) ? s.repositories
    : Array.isArray(s.repos) ? s.repos
    : Array.isArray(s) ? s
    : [];
  return raw.filter((r): r is Record<string, unknown> => r != null && typeof r === 'object');
}

function extractCypherRows(parsed: unknown): Array<Record<string, unknown>> {
  if (!parsed || typeof parsed !== 'object') return [];
  const s = parsed as Record<string, unknown>;
  if (typeof s.markdown === 'string') {
    return parseMarkdownTable(s.markdown);
  }
  if (Array.isArray(s.records)) return s.records as Array<Record<string, unknown>>;
  if (Array.isArray(s.rows)) return s.rows as Array<Record<string, unknown>>;
  if (Array.isArray(s.data)) return s.data as Array<Record<string, unknown>>;
  if (Array.isArray(s)) return s as Array<Record<string, unknown>>;
  return [];
}

function parseMarkdownTable(markdown: string): Array<Record<string, unknown>> {
  const lines = markdown.trim().split('\n').filter((l) => l.trim().startsWith('|'));
  if (lines.length < 2) return [];
  const headers = lines[0].split('|').map((h) => h.trim()).filter((h) => h.length > 0);
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 2; i < lines.length; i++) {
    const cells = lines[i].split('|').map((c) => c.trim()).slice(1, headers.length + 1);
    const row: Record<string, unknown> = {};
    for (let j = 0; j < headers.length && j < cells.length; j++) {
      const val = cells[j];
      const num = Number(val);
      row[headers[j]] = val !== '' && !Number.isNaN(num) && /^-?\d+(\.\d+)?$/.test(val) ? num : val;
    }
    rows.push(row);
  }
  return rows;
}

function getRecordValue(record: Record<string, unknown>, key: string): unknown {
  if (key in record) return record[key];
  if (record._fields && Array.isArray(record._fields)) {
    const keys = record._keys as string[] | undefined;
    if (keys) {
      const idx = keys.indexOf(key);
      if (idx >= 0) return record._fields[idx];
    }
  }
  return undefined;
}

async function buildDependencyGraph(
  mcpManager: McpRuntimeManager,
  serverId: string,
  repo: string,
  level: string,
  limit: number,
): Promise<{ nodes: Array<{ id: string; label: string; group: string; file?: string; kind?: string }>; edges: Array<{ id: string; source: string; target: string; weight?: number }> }> {
  const nodesMap = new Map<string, { id: string; label: string; group: string; file?: string; kind?: string }>();
  const edgesMap = new Map<string, { id: string; source: string; target: string; weight: number }>();

  try {
    if (level === 'file') {
      const cypherQuery = `
        MATCH (srcFile:File)-[:CodeRelation]->(src)-[r:CodeRelation]->(dst)<-[:CodeRelation]-(dstFile:File)
        WHERE r.type IN ['IMPORTS','CALLS','EXTENDS','IMPLEMENTS','INSTANTIATES']
          AND srcFile <> dstFile
        WITH srcFile.filePath AS source, dstFile.filePath AS target, count(*) AS weight
        RETURN source, target, weight
        ORDER BY weight DESC
        LIMIT ${limit}
      `;
      const result = await mcpManager.callTool(serverId, 'cypher', { query: cypherQuery, repo });
      const data = parseMcpResult(result);
      const rows = extractCypherRows(data);
      for (const row of rows) {
        const source = String(getRecordValue(row, 'source') ?? '');
        const target = String(getRecordValue(row, 'target') ?? '');
        const weight = Number(getRecordValue(row, 'weight') ?? 1);
        if (!source || !target) continue;

        const srcRel = relativePath(repo, source);
        const dstRel = relativePath(repo, target);
        const srcGroup = getPackageGroup(srcRel);
        const dstGroup = getPackageGroup(dstRel);

        if (!nodesMap.has(srcRel)) {
          nodesMap.set(srcRel, { id: srcRel, label: basename(srcRel), group: srcGroup, file: srcRel });
        }
        if (!nodesMap.has(dstRel)) {
          nodesMap.set(dstRel, { id: dstRel, label: basename(dstRel), group: dstGroup, file: dstRel });
        }
        const edgeKey = `${srcRel}->${dstRel}`;
        if (!edgesMap.has(edgeKey)) {
          edgesMap.set(edgeKey, { id: edgeKey, source: srcRel, target: dstRel, weight });
        }
      }
    } else {
      // 符号级：Method 之间的 CALLS 关系 + Class 之间的 EXTENDS/IMPLEMENTS 关系
      const methodCallsQuery = `
        MATCH (s:Method)-[r:CodeRelation {type: 'CALLS'}]->(t:Method)
        WHERE s.filePath IS NOT NULL AND t.filePath IS NOT NULL
        WITH s.name AS source, t.name AS target, 
             s.filePath AS sourceFile, t.filePath AS targetFile,
             'method' AS sourceKind, 'method' AS targetKind,
             count(*) AS weight
        RETURN source, target, sourceFile, targetFile, sourceKind, targetKind, weight
        ORDER BY weight DESC
        LIMIT ${limit}
      `;
      const classExtendsQuery = `
        MATCH (s:Class)-[r:CodeRelation]->(t:Class)
        WHERE r.type IN ['EXTENDS','IMPLEMENTS']
          AND s.filePath IS NOT NULL AND t.filePath IS NOT NULL
        WITH s.name AS source, t.name AS target,
             s.filePath AS sourceFile, t.filePath AS targetFile,
             'class' AS sourceKind, 'class' AS targetKind,
             count(*) AS weight
        RETURN source, target, sourceFile, targetFile, sourceKind, targetKind, weight
        ORDER BY weight DESC
        LIMIT ${Math.floor(limit / 2)}
      `;

      const [methodResult, classResult] = await Promise.allSettled([
        mcpManager.callTool(serverId, 'cypher', { query: methodCallsQuery, repo }),
        mcpManager.callTool(serverId, 'cypher', { query: classExtendsQuery, repo }),
      ]);

      const processRows = (result: PromiseSettledResult<McpCallToolResult>) => {
        if (result.status !== 'fulfilled') return;
        const data = parseMcpResult(result.value);
        const rows = extractCypherRows(data);
        for (const row of rows) {
          const source = String(getRecordValue(row, 'source') ?? '');
          const target = String(getRecordValue(row, 'target') ?? '');
          const sourceKind = String(getRecordValue(row, 'sourceKind') ?? '').toLowerCase();
          const targetKind = String(getRecordValue(row, 'targetKind') ?? '').toLowerCase();
          const sourceFile = String(getRecordValue(row, 'sourceFile') ?? '');
          const targetFile = String(getRecordValue(row, 'targetFile') ?? '');
          const weight = Number(getRecordValue(row, 'weight') ?? 1);
          if (!source || !target) continue;

          const srcGroup = sourceKind || 'default';
          const dstGroup = targetKind || 'default';
          const srcId = `${sourceFile}:${source}`;
          const dstId = `${targetFile}:${target}`;

          if (!nodesMap.has(srcId)) {
            nodesMap.set(srcId, { id: srcId, label: source, group: srcGroup, file: sourceFile, kind: sourceKind });
          }
          if (!nodesMap.has(dstId)) {
            nodesMap.set(dstId, { id: dstId, label: target, group: dstGroup, file: targetFile, kind: targetKind });
          }
          const edgeKey = `${srcId}->${dstId}`;
          if (!edgesMap.has(edgeKey)) {
            edgesMap.set(edgeKey, { id: edgeKey, source: srcId, target: dstId, weight });
          } else {
            edgesMap.get(edgeKey)!.weight += weight;
          }
        }
      };

      processRows(methodResult);
      processRows(classResult);
    }
  } catch {
    // cypher 不可用时回退到空图
  }

  return { nodes: [...nodesMap.values()], edges: [...edgesMap.values()] };
}

function relativePath(root: string, full: string): string {
  const normRoot = normalizeFsPath(root);
  const normFull = normalizeFsPath(full);
  if (normFull.startsWith(normRoot + '/')) {
    return normFull.slice(normRoot.length + 1);
  }
  return normFull;
}

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function getPackageGroup(filePath: string): string {
  const parts = filePath.split('/').filter((p) => p.length > 0);
  if (parts.length <= 1) return 'root';

  const javaIdx = parts.findIndex((p) => p === 'java' || p === 'kotlin');
  if (javaIdx >= 0 && parts.length > javaIdx + 3) {
    return `${parts[javaIdx + 1]}.${parts[javaIdx + 2]}.${parts[javaIdx + 3]}`;
  }
  if (javaIdx >= 0 && parts.length > javaIdx + 2) {
    return `${parts[javaIdx + 1]}.${parts[javaIdx + 2]}`;
  }

  const dirParts: string[] = [];
  for (const p of parts) {
    if (p.endsWith('.java') || p.endsWith('.ts') || p.endsWith('.tsx') || p.endsWith('.js') ||
        p.endsWith('.jsx') || p.endsWith('.vue') || p.endsWith('.py') || p.endsWith('.go') ||
        p.endsWith('.rs') || p.endsWith('.kt')) {
      break;
    }
    dirParts.push(p);
  }

  if (dirParts.length <= 1) return dirParts[0] ?? 'root';
  if (dirParts.length === 2) return `${dirParts[0]}/${dirParts[1]}`;
  return `${dirParts[0]}/${dirParts[1]}/${dirParts[2]}`;
}
