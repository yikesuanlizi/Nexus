import type { ThreadItemLike, TurnLike } from './threadView.js';

export function rollbackCountForTurn(turnId: string, turns: TurnLike[], items: ThreadItemLike[]): number {
  const turnOrder = uniqueTurnIds(turns.map((turn) => turn.turnId));
  const itemOrder = uniqueTurnIds(
    items
      .filter((item) => item.type === 'user_message' && item.turnId)
      .map((item) => item.turnId!),
  );
  const order = turnOrder.includes(turnId)
    ? turnOrder
    : (itemOrder.includes(turnId) ? itemOrder : turnOrder);
  const index = order.indexOf(turnId);
  return index >= 0 ? Math.max(1, order.length - index) : 1;
}

function uniqueTurnIds(turnIds: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const turnId of turnIds) {
    if (!turnId || seen.has(turnId)) continue;
    seen.add(turnId);
    result.push(turnId);
  }
  return result;
}
