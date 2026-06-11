import type { UserInput } from '@nexus/protocol';
import type { TurnRequest } from './config.js';

export function buildUserInputFromTurnRequest(body: TurnRequest): UserInput {
  const modeInstruction = body.modeInstruction?.trim() || undefined;
  if (body.images && body.images.length > 0) {
    return {
      type: 'multimodal',
      modeInstruction,
      parts: [
        { type: 'text', text: body.input || 'See attached image(s).' },
        ...body.images.map((img) => ({
          type: 'image_url' as const,
          image_url: { url: img.dataUrl },
        })),
      ],
    };
  }
  return { type: 'text', text: body.input, modeInstruction };
}
