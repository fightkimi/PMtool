/* v8 ignore file */
import { BaseAgent } from '@/agents/base/BaseAgent';
import type { AgentMessage } from '@/agents/base/types';

export class LibuHuAgent extends BaseAgent {
  readonly agentType = 'libu_hu' as const;

  constructor() {
    super();
  }

  async handle(message: AgentMessage): Promise<AgentMessage> {
    return this.createMessage(
      'libu_hu',
      {
        handled: true,
        payload: message.payload
      },
      message.context,
      2,
      'response'
    );
  }
}

const libuHuAgent = new LibuHuAgent();

export default libuHuAgent;
