import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';
import type { McpEnv } from './env';
import { callsWriteTool } from './scopes';
import { createServer } from './tools';

// 登録されたツールの名前と annotations を集める（DB には触らない）
function registeredTools() {
  const tools: { name: string; readOnly: boolean }[] = [];
  const spy = vi.spyOn(McpServer.prototype, 'registerTool').mockImplementation(function (
    this: McpServer,
    name: string,
    config: { annotations?: { readOnlyHint?: boolean } },
  ) {
    tools.push({ name, readOnly: config.annotations?.readOnlyHint === true });
    return {} as never;
  });
  try {
    createServer({} as McpEnv, 'U');
  } finally {
    // 失敗しても、ほかのテストに差し替えたままの registerTool を残さない
    spy.mockRestore();
  }
  return tools;
}

describe('書き込みの許可', () => {
  it('読み取りでないツールは、すべて書き込みの許可が要る（足し忘れを防ぐ）', () => {
    const tools = registeredTools();
    expect(tools.length).toBeGreaterThan(10);
    for (const t of tools) {
      const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: t.name, arguments: {} } };
      expect([t.name, callsWriteTool(call)]).toEqual([t.name, !t.readOnly]);
    }
  });
});
