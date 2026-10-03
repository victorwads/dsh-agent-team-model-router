import { displayNamesProjection, normalizeDisplayName } from './display-names/state.js';
import { defineTool } from '@deepseek-ai/dsh-tools';
import * as TeamTools from '@deepseek-ai/dsh-experimental-tool-agent-team';
import { assertCompatibility, installDecorators } from './compatibility/dsh-0.2.0-rc.2.js';
import { routingProjection } from './routing/state.js';
import { ModelRouter } from './routing/model-router.js';
import { infoSchema, switchSchema, listSchema, jsonOutput } from './tools/schemas.js';
import { hasDelegationModelRequest } from './vendor/model-selection.js';
export const name = 'agent-team-model-router';
export const inject = ['agents', 'sessions', 'agentTeams', 'subagents', 'tools', 'llm', 'systemPrompt', 'sessionProjections'];
const routeFields = {
  provider: { type: 'string', description: 'Registered LLM provider. Supply together with model; discover routes with list_models.' },
  model: { type: 'string', description: 'Exact provider-owned model id.' },
  reasoning_effort: { type: 'string', description: 'Supported reasoning effort. A changed route without effort uses its default.' },
};
export async function apply(ctx, config = {}) {
  assertCompatibility(ctx);
  for (const agent of ctx.agents.list()) {
    if (ctx.tools.get('spawn_teammate', agent)) throw new Error('agent-team-model-router: Team tools are already mounted. Stop the profile and disable the standalone tool-agent-team before enabling the router; existing sessions are not modified.');
  }
  ctx.sessionProjections.register(routingProjection);
  ctx.sessionProjections.register(displayNamesProjection);
  const router = new ModelRouter(ctx);
  installDecorators(ctx, (definition, spawning) => {
    if (definition.name !== 'spawn_teammate') return definition;
    // New schema wraps the ORIGINAL tool implementation; provisioning/reminders/authority remain upstream.
    return {
      ...definition,
      parameters: { ...definition.parameters, properties: { ...definition.parameters.properties,
        provider: { type: 'string' }, model: { type: 'string' }, reasoning_effort: { type: 'string' } } },
      description: definition.description + ' Optional provider/model/reasoning_effort select an authorized LLM route; omit to preserve normal inheritance.',
      async execute(args, exec) {
        if (!hasDelegationModelRequest(args)) return definition.execute(args, exec);
        if (!exec.agent) throw new Error('spawn_teammate requires a calling Agent');
        const options = await router.validate(exec.agent, args, exec.signal, true);
        return spawning.run({ parent: exec.agent, options }, () => definition.execute(args, exec));
      },
    };
  });
  const installed = new Map();
  const install = agent => {
    const membership = ctx.agentTeams.tryMembership(agent);
    if (!membership || installed.has(agent)) return;
    router.install(agent);
    const disposers = [];
    const register = (toolName, description, parameters, execute) => disposers.push(agent.ctx.tools.register(defineTool({ name: toolName, description, parameters, output: jsonOutput(toolName === 'list_models' ? listSchema : toolName === 'get_current_model' ? infoSchema : switchSchema), execute })));
    disposers.push(agent.ctx.tools.register(defineTool({
      name: 'set_teammate_display_name',
      isConcurrencySafe: () => false,
      description: 'Lead only: set or reset a Team member UI display name. Does not change its stable target, session, tasks or messages. The alias is persisted with this successful tool result.',
      parameters: {
        target: { type: 'string', required: true, description: 'Stable member name from list_agents, including lead. Not a display alias.' },
        display_name: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true, description: 'Visual name, 1–120 characters; spaces/case/accents allowed. null restores the stable name.' },
      },
      output: jsonOutput({ type: 'object', additionalProperties: false, properties: {
        target: { type: 'string', required: true }, session: { type: 'string', required: true },
        display_name: { type: 'string', required: true }, changed: { type: 'boolean', required: true },
        displayNames: { type: 'json', required: true },
        aliasOperation: { type: 'json', required: true },
      } }),
      async execute(args, exec) {
        const membership = ctx.agentTeams.tryMembership(exec.agent);
        if (membership?.role !== 'lead') throw new Error('Only the Team Lead can edit display names');
        const target = ctx.agentTeams.listMembers(exec.agent).find(member => member.name === args.target);
        if (!target) throw new Error('Team member not found; use its stable target from list_agents');
        const state = ctx.sessionProjections.stateOf(exec.agent.session, 'agentTeamDisplayNames');
        const names = { ...state.names };
        const previous = names[target.id] ?? target.name;
        const displayName = args.display_name === null ? target.name : normalizeDisplayName(args.display_name);
        if (args.display_name === null) delete names[target.id]; else names[target.id] = displayName;
        exec.signal.throwIfAborted();
        return { target: target.name, session: target.id, display_name: displayName, changed: previous !== displayName, aliasOperation: { memberId: target.id, value: args.display_name === null ? null : displayName }, displayNames: { version: 1, teamId: exec.agent.id, names } };
      },
    })));
    register('get_current_model', 'Read this exact Agent route from its actual request header, with pending/next route.', {}, async (_args, exec) => router.info(exec.agent));
    register('switch_model', 'Teammate only: schedule an authorized route for the next model invocation; never interrupt an executing inference or create a new session.', { ...routeFields, provider: { ...routeFields.provider, required: true }, model: { ...routeFields.model, required: true } }, (args, exec) => router.switch(exec.agent, args, exec.signal));
    register('switch_teammate_model', 'Lead only: change a live teammate route for its next model invocation. Does not wake or recreate it. Cold teammates must first be resumed with send_message.', { teammate: { type: 'string', required: true }, ...routeFields, provider: { ...routeFields.provider, required: true }, model: { ...routeFields.model, required: true } }, async (args, exec) => {
      const member = ctx.agentTeams.tryMembership(exec.agent);
      if (member?.role !== 'lead') throw new Error('Only the Team Lead can change another teammate route');
      const target = ctx.agentTeams.listMembers(exec.agent).find(row => row.name === args.teammate && row.role === 'teammate');
      if (!target) throw new Error('Teammate not found in this Team');
      const live = ctx.agents.get(target.id);
      if (!live) throw new Error('Teammate is cold/unloaded; use send_message to resume it before switching');
      return router.switch(live, args, exec.signal);
    });
    register('list_models', 'Discover exact authorized provider/model routes from the current Session policy and live DSH adapter metadata. No hardcoded catalog.', { provider: { type: 'string' }, model: { type: 'string' } }, async (args, exec) => {
      if (args.model !== undefined && args.provider === undefined) throw new Error('model requires provider');
      for (const key of ['provider', 'model']) if (args[key] !== undefined && args[key].length === 0) throw new Error(key + ' must be non-empty');
      const policy = router.policy(exec.agent);
      if (!policy) return { enabled: false, routes: [], message: 'Model selection is disabled for this Session. Enable Host subagent-model-selection and start a new Session.' };
      const routes = policy.routes.filter(route => (!args.provider || route.provider === args.provider) && (!args.model || route.model === args.model));
      if ((args.provider || args.model) && !routes.length) throw new Error('Requested route is not allowed for this Session');
      const providers = ctx.llm.listProviders();
      const result = [];
      for (const route of routes) {
        exec.signal.throwIfAborted();
        if (!providers.some(provider => provider.id === route.provider)) { result.push({ ...route, available: false, reason: 'Provider is not registered' }); continue; }
        try { const model = await ctx.llm.resolveModelInfo(route.provider, route.model, exec.signal); result.push({ ...route, available: true, metadata: model }); }
        catch (error) { exec.signal.throwIfAborted(); result.push({ ...route, available: false, reason: String(error.message ?? error) }); }
      }
      return { enabled: true, routes: result };
    });
    installed.set(agent, () => { for (const dispose of disposers.reverse()) dispose(); router.remove(agent); });
  };
  ctx.on('agent/created', ({ agent }) => install(agent));
  ctx.on('agent/disposed', ({ agent }) => { installed.get(agent)?.(); installed.delete(agent); });
  ctx.effect(() => () => { for (const dispose of installed.values()) dispose(); installed.clear(); });
  for (const agent of ctx.agents.list()) install(agent);
  // Mount upstream tools AFTER decoration, avoiding replacement of live registry definitions.
  await ctx.plugin(TeamTools, { freshProvider: config.freshProvider ?? 'spawn', forkProvider: config.forkProvider ?? 'fork' });
  ctx.logger.info('[agent-team-model-router] loaded for DSH 0.2.0-rc.2');
}
