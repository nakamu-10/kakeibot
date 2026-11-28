/** AI アプリに許すこと。読み取りはいつも要る。書き込みは許可の画面で選べる */
export const READ = 'kakeibo:read';
export const WRITE = 'kakeibo:write';

export const SCOPE_LABELS: Record<string, string> = {
  [READ]: '家計簿を見る（記録・集計・シフト収入）',
  [WRITE]: '家計簿に記録する・直す・消す、予算・固定費・目標を変える（取り消せる）',
};

/** 書き込みの許可が要るツール */
const WRITE_TOOLS = new Set([
  'add_entries',
  'update_entry',
  'delete_entry',
  'set_budget',
  'undo_changes',
  'save_fixed_cost',
  'delete_fixed_cost',
  'save_goal',
  'delete_goal',
]);

/**
 * MCP のリクエスト（JSON-RPC。まとめて送られた配列も）が、書き込みのツールを呼んでいるか。
 * 呼んでいて許可がなければ、HTTP の 403 で書き込みの許可を求める（MCP の step-up）
 */
export function callsWriteTool(body: unknown): boolean {
  const messages = Array.isArray(body) ? (body as unknown[]) : [body];
  return messages.some((m) => {
    if (!m || typeof m !== 'object') return false;
    const { method, params } = m as { method?: unknown; params?: { name?: unknown } };
    return method === 'tools/call' && typeof params?.name === 'string' && WRITE_TOOLS.has(params.name);
  });
}
