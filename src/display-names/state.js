import { z } from 'zod';
const nameSchema = z.string().min(1).refine(value => [...value].length <= 120, { message: "display name exceeds 120 characters" });
const namesSchema = z.record(z.string(), nameSchema);
export const displayNamesSchema = z.object({ version: z.literal(1), teamId: z.string().min(1), names: namesSchema }).strict();
/** Informational UI state from native tool records. No external Session event types. */
export const displayNamesProjection = {
  key: 'agentTeamDisplayNames', stateVersion: 1,
  stateSchema: z.object({ teamId: z.string(), boundary: z.number(), names: namesSchema, calls: z.array(z.string()) }),
  init: (header, boundary) => ({ teamId: header.id, boundary, names: {}, calls: [] }),
  apply(state, event) {
    if (event.seq < state.boundary) return state;
    if (event.type === 'tool/call' && event.data.name === 'set_teammate_display_name') return { ...state, calls: [...state.calls, event.data.callId] };
    let blocks;
    if (event.type === 'tool/ptc-dispatch' && event.data.name === 'set_teammate_display_name' && !event.data.isError) blocks = event.data.content;
    if (event.type === 'tool/result' && state.calls.includes(event.data.message.toolCallId)) {
      state = { ...state, calls: state.calls.filter(id => id !== event.data.message.toolCallId) };
      if (!event.data.message.isError) blocks = event.data.message.content;
    }
    if (!blocks) return state;
    try {
      const result = JSON.parse(blocks.filter(block => block.type === 'text').map(block => block.text).join(''));
      const parsed = displayNamesSchema.parse(result.displayNames);
      if (parsed.teamId !== state.teamId) return state;
      const operation = z.object({ memberId: z.string().min(1), value: nameSchema.nullable() }).strict().parse(result.aliasOperation);
      const names = { ...state.names };
      if (operation.value === null) delete names[operation.memberId]; else names[operation.memberId] = operation.value;
      return { ...state, names };
    } catch { return state; }
  },
  wire: {
    viewSchema: namesSchema,
    view: state => state.names,
  },
};
export function normalizeDisplayName(raw) {
  const name = raw.normalize('NFC').trim();
  if (!name || [...name].length > 120 || /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(name)) throw new Error('display_name must contain 1–120 characters, without control characters or bidi overrides');
  return name;
}
