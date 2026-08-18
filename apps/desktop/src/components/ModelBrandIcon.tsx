import { IconParkIcon } from './IconParkIcon.js';
import { modelBrandSvg } from './modelBrandSvg.js';

type BrandKey = keyof typeof modelBrandSvg;

const MODEL_BRAND_MATCHERS: Array<[BrandKey, RegExp]> = [
  ['deepseek', /deepseek/],
  ['zhipu', /(?:glm|zhipu)/],
  ['kimi', /(?:kimi|moonshot)/],
  ['qwen', /(?:qwen|tongyi|dashscope)/],
  ['baidu', /(?:ernie|baidu|wenxin)/],
  ['doubao', /doubao/],
  ['openai', /(?:gpt|openai)/],
  ['anthropic', /(?:claude|anthropic)/],
  ['gemini', /(?:gemini|google)/],
  ['mistral', /mistral/],
  ['perplexity', /(?:sonar|perplexity)/],
  ['grok', /(?:grok|xai)/],
  ['minimax', /minimax/],
  ['nvidia', /(?:nvidia|nemotron)/],
  ['huggingface', /(?:hugging[ _-]?face|hf[ _-]?inference)/],
  ['giteeai', /(?:gitee|giteeai)/],
  ['siliconcloud', /(?:silicon[ _-]?cloud|siliconflow)/],
  ['vllm', /vllm/],
  ['ollama', /ollama/],
  ['lmstudio', /(?:lm[ _-]?studio)/],
];

const PROVIDER_BRANDS: Record<string, BrandKey> = {
  openai: 'openai',
  deepseek: 'deepseek',
  zhipu: 'zhipu',
  kimi: 'kimi',
  moonshot: 'kimi',
  qwen: 'qwen',
  dashscope: 'qwen',
  baidu: 'baidu',
  volcengine: 'volcengine',
  siliconflow: 'siliconcloud',
  siliconcloud: 'siliconcloud',
  vllm: 'vllm',
  gitee: 'giteeai',
  giteeai: 'giteeai',
  groq: 'groq',
  together: 'together',
  openrouter: 'openrouter',
  huggingface: 'huggingface',
  hf: 'huggingface',
  nvidia: 'nvidia',
  nim: 'nvidia',
  'nvidia-nim': 'nvidia',
  gemini: 'gemini',
  google: 'gemini',
  mistral: 'mistral',
  perplexity: 'perplexity',
  xai: 'grok',
  anthropic: 'anthropic',
  minimax: 'minimax',
  ollama: 'ollama',
  lmstudio: 'lmstudio',
};

/**
 * 有明确提供商时优先展示该提供商，确保模型预设说明的是实际接入渠道。
 * 只有兼容端点或自定义渠道未标明厂商时，才根据模型名称推断图标。
 */
export function modelBrandKey(model?: string, provider?: string): BrandKey | undefined {
  const normalizedProvider = provider?.trim().toLowerCase() ?? '';
  const byProvider = PROVIDER_BRANDS[normalizedProvider];
  if (byProvider) return byProvider;

  const normalizedModel = model?.trim().toLowerCase() ?? '';
  const byModel = MODEL_BRAND_MATCHERS.find(([, pattern]) => pattern.test(normalizedModel));
  if (byModel) return byModel[0];
  return undefined;
}

// LobeHub Icons: @lobehub/icons-static-svg v1.94.0 (MIT).
// 图标以本地 data URL 按需内置；无法识别的兼容端点使用连接端点图标。
export function ModelBrandIcon({ model, provider }: { model?: string; provider?: string }) {
  const brandKey = modelBrandKey(model, provider);
  if (!brandKey) return <IconParkIcon name="connection" />;

  return <img alt="" aria-hidden="true" className={`modelBrandIcon brand-${brandKey}`} src={modelBrandSvg[brandKey]} />;
}
