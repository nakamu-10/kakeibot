import { describe, expect, it } from 'vitest';
import { callsWriteTool } from './scopes';

const call = (name: string) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } });

describe('callsWriteTool', () => {
  it('書き込みのツールを呼ぶときだけ true', () => {
    expect(callsWriteTool(call('add_entries'))).toBe(true);
    expect(callsWriteTool(call('delete_entry'))).toBe(true);
    expect(callsWriteTool(call('search_entries'))).toBe(false);
    expect(callsWriteTool({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).toBe(false);
  });
  it('まとめて送られた中に1つでもあれば true。読めない本文は false', () => {
    expect(callsWriteTool([call('get_summary'), call('update_entry')])).toBe(true);
    expect(callsWriteTool(null)).toBe(false);
    expect(callsWriteTool('not json')).toBe(false);
  });
});
