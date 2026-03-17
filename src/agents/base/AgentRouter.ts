import type { BaseAgent } from './BaseAgent';
import type { AgentMessage, AgentType } from './types';

export class AgentRouter {
  private agents: Map<AgentType, BaseAgent> = new Map();

  register(agent: BaseAgent): void {
    this.agents.set(agent.agentType, agent);
  }

  getAgent(type: AgentType): BaseAgent | undefined {
    return this.agents.get(type);
  }

  async route(message: AgentMessage): Promise<void> {
    const agent = this.getAgent(message.to);
    if (!agent) {
      throw new Error(`Unknown agent type: ${message.to}`);
    }

    await agent.run(message);
  }
}
