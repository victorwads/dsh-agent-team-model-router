import { installModelSelection } from '@deepseek-ai/dsh-agent';
import { parentAgentOptionsForDelegation } from '@deepseek-ai/dsh-subagent';
import { requestedAgentOptions, assertAllowedModelSelection } from '../vendor/model-selection.js';
export const same = (a, b) => !!a && !!b && a.provider === b.provider && a.model === b.model && a.reasoningEffort === b.reasoningEffort;
export class ModelRouter {
  constructor(ctx) { this.ctx = ctx; this.refs = new Map(); this.locks = new Map(); this.policies = new WeakMap(); }
  state(session) { return this.ctx.sessionProjections.stateOf(session, 'agentTeamModelRouter'); }
  policy(agent) {
    if (this.policies.has(agent)) return this.policies.get(agent);
    const own = this.state(agent.session)?.allowed;
    if (own !== null && own !== undefined) { const policy = { routes: own }; this.policies.set(agent, policy); return policy; }
    const parent = this.ctx.sessions.get(agent.session.header.parentSession);
    const inherited = parent && this.state(parent)?.allowed;
    const settings = this.ctx.get('subagentModelSelection')?.current();
    const routes = inherited ?? (agent.session.header.origin !== 'subagent' && agent.session.firstLiveSeq === 0 && settings?.enabled ? settings.allowedModels : undefined);
    if (routes?.length) {
      agent.session.append('subagent/model-selection-policy', { allowedModels: routes });
      const policy = { routes }; this.policies.set(agent, policy); return policy;
    }
    this.policies.set(agent, undefined);
    return undefined;
  }
  install(agent) {
    if (this.refs.has(agent)) return;
    const ref = { current: this.state(agent.session)?.route ?? undefined, assembled: undefined };
    this.policy(agent);
    const dispose = this.ctx.agentTeams.tryMembership(agent)?.role === 'teammate' ? installModelSelection(agent.ctx, ref) : () => {};
    const observe = agent.ctx.on('session/event', (session, event) => {
      if (session === agent.session && event.type === 'model/selection') ref.current = event.data;
    });
    this.refs.set(agent, { ref, dispose: () => { observe(); dispose(); } });
  }
  remove(agent) { this.refs.get(agent)?.dispose(); this.refs.delete(agent); }
  current(agent) {
    const config = agent.session.requestHeader()?.config ?? agent.options;
    return { provider: config.provider ?? null, model: config.model ?? null, reasoningEffort: config.reasoningEffort ?? undefined };
  }
  info(agent) {
    const current = this.current(agent);
    const selected = this.state(agent.session)?.route ?? this.refs.get(agent)?.ref.current;
    const wire = route => route ? { provider: route.provider, model: route.model, reasoning_effort: route.reasoningEffort ?? null } : null;
    return { session: agent.id, current: wire(current), pending: selected && !same(current, selected) ? wire(selected) : null, next: wire(selected ?? current) };
  }
  async validate(agent, args, signal, spawn = false) {
    const policy = this.policy(agent);
    const baseline = parentAgentOptionsForDelegation(agent);
    const requested = requestedAgentOptions(baseline, undefined, args, policy !== undefined);
    assertAllowedModelSelection(policy, baseline, requested, args);
    const provider = requested?.provider ?? baseline.provider;
    const model = requested?.model ?? baseline.model;
    if (!this.ctx.llm.listProviders().some(candidate => candidate.id === provider)) throw new Error('Unknown provider "' + provider + '". Use list_models to inspect routes.');
    // Exact adapter metadata is authoritative; no hardcoded catalog or guessed identifiers.
    try { await this.ctx.llm.resolveModelInfo(provider, model, signal); }
    catch (error) { signal.throwIfAborted(); throw new Error('Cannot resolve model "' + model + '" for provider "' + provider + '". Use list_models to inspect routes. ' + error.message, { cause: error }); }
    const changed = provider !== baseline.provider || model !== baseline.model;
    const reasoningEffort = requested?.reasoningEffort ?? (!changed ? baseline.reasoningEffort : undefined);
    const resolved = await this.ctx.llm.resolveCallConfig({ provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) }, signal);
    signal.throwIfAborted();
    return spawn ? requested : { provider, model, ...(resolved.reasoningEffort === undefined ? {} : { reasoningEffort: resolved.reasoningEffort }) };
  }
  switch(agent, args, signal) {
    const previous = this.locks.get(agent.id) ?? Promise.resolve();
    const operation = previous.then(async () => {
      const membership = this.ctx.agentTeams.tryMembership(agent);
      if (membership?.role !== 'teammate') throw new Error('switch_model requires an exact live Agent Team teammate');
      const route = await this.validate(agent, args, signal);
      if (this.ctx.agents.get(agent.id) !== agent) throw new Error('Teammate unloaded while validating route; retry after resume');
      const current = this.current(agent);
      const selected = this.refs.get(agent)?.ref;
      if (!selected) throw new Error('Router is not installed in this Agent');
      if (same(selected.current ?? current, route)) return { changed: false, ...this.info(agent), effective: 'next-model-invocation' };
      agent.session.append('model/selection', route);
      selected.current = route;
      // Publish the live selection immediately after the append. Await persistence before success.
      // If flush fails the route is still committed; never falsely report a rollback.
      try { await this.ctx.sessions.flush(agent.session); }
      catch (error) {
        this.ctx.logger.warn('[agent-team-model-router] session=' + agent.id + ' route committed in memory, persistence flush failed');
        throw new Error('Route committed in memory but durability checkpoint failed; inspect get_current_model before retrying', { cause: error });
      }
      this.ctx.logger.info('[agent-team-model-router] teammate=' + membership.name + ' session=' + agent.id + ' from=' + current.provider + '/' + current.model + ' to=' + route.provider + '/' + route.model + ' effective=next-model-invocation');
      return { changed: true, ...this.info(agent), effective: 'next-model-invocation', message: 'The current inference is unchanged. The selected route is used at the next prompt assembly/model invocation (possibly the next step of this DSH turn).' };
    });
    const tail = operation.catch(() => undefined); this.locks.set(agent.id, tail);
    void tail.then(() => { if (this.locks.get(agent.id) === tail) this.locks.delete(agent.id); });
    return operation;
  }
}
