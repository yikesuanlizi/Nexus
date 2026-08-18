import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { UserInput } from '@nexus/protocol';
import type { TurnRequest } from '../config/config.js';

export async function buildUserInputFromTurnRequest(
  body: TurnRequest,
  options: { threadId: string; workspaceRoot?: string; dataDir: string },
): Promise<UserInput> {
  const modeInstruction = body.modeInstruction?.trim() || undefined;
  if (body.images && body.images.length > 0) {
    const images = await persistTurnImages(body.images, options);
    return {
      type: 'multimodal',
      modeInstruction,
      parts: [
        { type: 'text', text: body.input || 'See attached image(s).' },
        ...images,
      ],
    };
  }
  return { type: 'text', text: body.input, modeInstruction };
}

async function persistTurnImages(
  images: Array<{ name: string; dataUrl: string }>,
  options: { threadId: string; workspaceRoot?: string; dataDir: string },
) {
  const configuredRoot = options.workspaceRoot?.trim();
  const root = configuredRoot
    ? path.join(configuredRoot, '.nexus', 'attachments', options.threadId)
    : path.join(options.dataDir, 'attachments', options.threadId);
  await fs.mkdir(root, { recursive: true });
  return Promise.all(images.map(async (image, index) => {
    const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(image.dataUrl);
    if (!match) throw new Error('Invalid image attachment');
    const mimeType = match[1].toLowerCase();
    if (!mimeType.startsWith('image/')) throw new Error('Unsupported attachment type');
    const content = Buffer.from(match[2], 'base64');
    if (content.byteLength === 0 || content.byteLength > 20 * 1024 * 1024) throw new Error('Image attachment must be between 1 byte and 20 MB');
    const originalName = path.basename(image.name || `image-${index + 1}`);
    const extension = extensionForImage(mimeType, originalName);
    const name = `${Date.now()}-${index + 1}-${randomUUID().slice(0, 8)}${extension}`;
    const filePath = path.join(root, name);
    await fs.writeFile(filePath, content);
    const attachmentRoot = configuredRoot || options.dataDir;
    const relativePath = configuredRoot
      ? path.posix.join('.nexus', 'attachments', options.threadId, name)
      : path.join('attachments', options.threadId, name);
    return {
      type: 'image_path' as const,
      path: filePath,
      name: originalName,
      mimeType,
      url: `/api/workspaces/raw?root=${encodeURIComponent(attachmentRoot)}&path=${encodeURIComponent(relativePath)}`,
    };
  }));
}

function extensionForImage(mimeType: string, originalName: string): string {
  const ext = path.extname(originalName);
  if (ext) return ext;
  return ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg' }[mimeType] ?? '.img');
}
