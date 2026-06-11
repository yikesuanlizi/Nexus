import type { Locale } from './config.js';
import type { SkillEntry } from './types.js';

export function localizedSkillDescription(skill: SkillEntry, locale: Locale): string {
  if (locale !== 'zh') return skill.description || 'No description';
  return ZH_SKILL_DESCRIPTIONS[skill.name] ?? (skill.description || '暂无说明');
}

const ZH_SKILL_DESCRIPTIONS: Record<string, string> = {
  'algorithmic-art': '使用 p5.js 和可控随机性创作程序化视觉艺术。',
  'brand-guidelines': '根据品牌色彩、字体和视觉规范生成一致的品牌内容。',
  'canvas-design': '设计适合图片、PDF 等画布媒介的精美视觉作品。',
  'claude-api': '围绕 Claude API 的使用、集成和最佳实践提供指导。',
  'composition-patterns': '指导 React 组件组合、拆分和可扩展结构设计。',
  'deploy-to-vercel': '帮助将应用或网站部署到 Vercel，并处理常见部署配置。',
  'doc-coauthoring': '协助共同撰写、编辑和组织长文档。',
  docx: '创建、编辑和处理 Word 文档。',
  'frontend-design': '设计高质量、具有明确风格的前端界面。',
  'frontend-polish': '优化界面细节、响应式状态和视觉一致性。',
  'internal-comms': '撰写清晰、得体的内部沟通材料。',
  'mcp-builder': '构建和配置 MCP server、工具与相关集成。',
  pdf: '阅读、生成和检查 PDF 文件，关注内容与版式。',
  pptx: '创建、编辑和优化演示文稿。',
  'skill-creator': '创建或改进 AI 编程工具风格的 Skill。',
  'slack-gif-creator': '为 Slack 制作适合沟通场景的 GIF 内容。',
  'theme-factory': '创建一致的视觉主题、色彩和排版系统。',
  'web-artifacts-builder': '构建可交互的网页 Artifact、组件或原型。',
  'webapp-testing': '测试 Web 应用交互、状态和端到端流程。',
  xlsx: '创建、读取和分析 Excel 表格。',
  'bug-hunt': '复现并定位问题，给出最小修复和验证路径。',
  'code-review': '审查代码变更，优先发现缺陷、回归和缺失测试。',
  'release-notes': '整理面向用户的发布说明和升级注意事项。',
};
