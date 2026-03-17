/* v8 ignore file */
import { BaseAgent } from '@/agents/base/BaseAgent';
import type { AgentMessage } from '@/agents/base/types';

export class LibuXingAgent extends BaseAgent {
  readonly agentType = 'libu_xing' as const;

  constructor() {
    super();
  }

  async handle(message: AgentMessage): Promise<AgentMessage> {
    return this.createMessage(
      'libu_xing',
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

const libuXingAgent = new LibuXingAgent();

export default libuXingAgent;
