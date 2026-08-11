// ESM loader：让 Node 的 type-stripping 直接运行 TS 源码时，把相对 `.js` 导入映射到同目录
// `.ts` 文件。Node ≥23.6 支持运行 TS 但不做 `.js → .ts` 映射；本 loader 只处理存在对应
// `.ts` 文件的相对导入，其余（包导入、绝对路径、node: 内置）原样放行。
// 用法：node --import packages/browser-runtime/scripts/register-ts-js-resolver.mjs <entry.ts>
// — English: ESM loader that maps relative `.js` imports to sibling `.ts` files so
//   Node's type stripping can run TS sources directly (Node ≥23.6 runs TS but does
//   not map `.js → .ts`). Only relative specifiers with an existing `.ts` sibling
//   are rewritten; everything else passes through.
import { access } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * @param {string} specifier - 导入说明符
 * @param {object} context - resolve 上下文（含 parentURL）
 * @param {(s: string, c: object) => Promise<{ url: string }>} nextResolve - 链上下一解析器
 */
export async function resolve(specifier, context, nextResolve) {
  // Windows 绝对路径（D:\...）作为 CLI 入口：pathToFileURL 转 file URL
  // — English: Windows absolute paths as CLI entries — convert to file URLs.
  if (/^[a-zA-Z]:[\\/]/.test(specifier)) {
    try {
      await access(specifier);
      return nextResolve(pathToFileURL(specifier).href, context);
    } catch {
      // 文件不存在：按包说明符原样放行
    }
  }
  // 命令行入口（如 packages/browser-runtime/src/sidecar/sidecarEntry.ts）：相对 cwd 解析为文件
  // — English: CLI entry specifiers are resolved as files relative to cwd.
  if (
    !specifier.startsWith('.')
    && !specifier.startsWith('/')
    && !specifier.startsWith('node:')
    && !specifier.includes('://')
  ) {
    const fromCwd = new URL(specifier, pathToFileURL(`${process.cwd()}/`));
    try {
      await access(fileURLToPath(fromCwd));
      return nextResolve(fromCwd.href, context);
    } catch {
      // 不是文件：按包说明符原样放行
    }
  }
  if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL !== undefined) {
    const tsSpecifier = specifier.slice(0, -3) + '.ts';
    const tsUrl = new URL(tsSpecifier, context.parentURL);
    try {
      await access(fileURLToPath(tsUrl));
      return nextResolve(tsSpecifier, context);
    } catch {
      // 对应 .ts 不存在：按原样继续（例如导入真实的 .js 产物）
    }
  }
  return nextResolve(specifier, context);
}
