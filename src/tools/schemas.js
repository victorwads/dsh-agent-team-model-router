export const routeSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    provider: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    model: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    reasoning_effort: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
  },
};
export const infoProperties = {
  session: { type: 'string', required: true },
  current: { ...routeSchema, required: true },
  pending: { oneOf: [routeSchema, { type: 'null' }], required: true },
  next: { ...routeSchema, required: true },
};
export const infoSchema = { type: 'object', additionalProperties: false, properties: infoProperties };
export const switchSchema = {
  type: 'object', additionalProperties: false, properties: {
    ...infoProperties, changed: { type: 'boolean', required: true },
    effective: { type: 'string', const: 'next-model-invocation', required: true },
    message: { type: 'string' },
  },
};
export const listSchema = {
  type: 'object', additionalProperties: false, properties: {
    enabled: { type: 'boolean', required: true }, message: { type: 'string' },
    routes: { type: 'array', required: true, items: {
      type: 'object', additionalProperties: false, properties: {
        provider: { type: 'string', required: true }, model: { type: 'string', required: true },
        available: { type: 'boolean', required: true }, reason: { type: 'string' },
        metadata: { type: 'json' },
      },
    } },
  },
};
export function jsonOutput(schema) {
  return { schema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };
}
