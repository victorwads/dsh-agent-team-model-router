import { createRequire } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import { scopeOf } from '@deepseek-ai/dsh-scope';
const require = createRequire(import.meta.url);
const EXPECTED = '0.2.0-rc.2';
export function assertCompatibility(ctx) {
  for (const pkg of ['agent', 'subagent', 'tools', 'llm', 'session', 'experimental-agent-team', 'experimental-tool-agent-team', 'session-projection', 'tool-subagent']) {
    const actual = require('@deepseek-ai/dsh-' + pkg + '/package.json').version;
    if (actual !== EXPECTED) throw new Error('agent-team-model-router requires DSH ' + EXPECTED + '; ' + pkg + ' is ' + actual);
  }
  for (const [service, methods] of Object.entries({ agents: ['list', 'get'], subagents: ['startContinuable'], llm: ['resolveCallConfig', 'resolveModelInfo', 'listProviders', 'listModels'], tools: ['register', 'get'], agentTeams: ['tryMembership', 'listMembers'] })) {
    for (const method of methods) if (typeof ctx[service]?.[method] !== 'function') throw new Error('Missing DSH API: ' + service + '.' + method);
  }
}
/** Cordis internal/get is a public framework waterfall. It decorates caller-traced services,
 * never mutates their prototypes/instances, and unwinds with the plugin fiber.
 * The rc.2 Team service drops agentOptions. Preserve its full provisioning transaction
 * and inject overrides at its existing startContinuable call, using async-local authority.
 */
export function installDecorators(ctx, transformTool) {
  const spawning = new AsyncLocalStorage();
  const shared = new WeakMap();
  const globalScope = {};
  const retain = (caller, key, register) => {
    const scope = scopeOf(caller) ?? globalScope;
    let entries = shared.get(scope);
    if (!entries) { entries = new Map(); shared.set(scope, entries); }
    let entry = entries.get(key);
    if (!entry) { entry = { count: 0, dispose: register() }; entries.set(key, entry); }
    entry.count++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--entry.count === 0) { entries.delete(key); entry.dispose(); }
    };
  };
  ctx.on('internal/get', (callerCtx, name, _error, next) => {
    const service = next();
    if (!service || (name !== 'tools' && name !== 'subagents' && name !== 'systemPrompt')) return service;
    return new Proxy(service, { get(target, key) {
      const original = Reflect.get(target, key, target);
      if (name === 'systemPrompt' && key === 'section') return section => {
        if (section.name !== 'team:policy') return original.call(target, section);
        return retain(callerCtx, 'section:team:policy', () => original.call(target, section));
      };
      if (name === 'tools' && key === 'register') return definition => {
        const transformed = transformTool(definition, spawning);
        return ['spawn_teammate', 'send_message', 'list_agents', 'wait_agent', 'interrupt_agent', 'team_task_create', 'team_task_list', 'team_task_get', 'team_task_update'].includes(definition.name)
          ? retain(callerCtx, 'tool:' + definition.name, () => original.call(target, transformed))
          : original.call(target, transformed);
      };
      if (name === 'subagents' && key === 'startContinuable') return spec => {
        const selection = spawning.getStore();
        if (selection && spec.childId && spec.request.parent === selection.parent) {
          return original.call(target, { ...spec, request: { ...spec.request, agentOptions: selection.options } });
        }
        return original.call(target, spec);
      };
      return typeof original === 'function' ? original.bind(target) : original;
    } });
  });
  return spawning;
}
