import { z } from 'zod';
const route = z.object({ provider: z.string().min(1), model: z.string().min(1), reasoningEffort: z.string().min(1).optional() }).strict();
export const routingProjection = {
  key: 'agentTeamModelRouter', stateVersion: 1,
  stateSchema: z.object({ boundary: z.number(), route: route.nullable(), allowed: z.array(z.object({provider:z.string(),model:z.string()})).nullable() }),
  init: (_header, inheritedEventCount) => ({ boundary: inheritedEventCount, route: null, allowed: null }),
  apply(state, event) {
    if (event.seq < state.boundary) return state;
    if (event.type === 'model/selection') return { ...state, route: route.parse(event.data) };
    if (event.type === 'subagent/model-selection-policy' && state.allowed === null) return { ...state, allowed: event.data.allowedModels };
    return state;
  },
};
