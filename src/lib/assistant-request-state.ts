export interface AssistantRequestToken {
  generation: number;
  sessionId: string | null;
}

export function settleAssistantMessages<T extends { role: string; isStreaming?: boolean }>(messages: T[]): T[] {
  return messages
    .filter((message) => message.role !== "thinking")
    .map((message) => message.isStreaming ? { ...message, isStreaming: false } : message);
}

/** Generation guard for async history loads and buffered SSE events. */
export class AssistantRequestState {
  private historyGeneration = 0;
  private streamGeneration = 0;

  beginHistory(sessionId: string): AssistantRequestToken {
    return { generation: ++this.historyGeneration, sessionId };
  }

  cancelHistory(): void {
    this.historyGeneration += 1;
  }

  isCurrentHistory(token: AssistantRequestToken, activeSessionId: string | null): boolean {
    return token.generation === this.historyGeneration && token.sessionId === activeSessionId;
  }

  beginStream(sessionId: string | null): AssistantRequestToken {
    return { generation: ++this.streamGeneration, sessionId };
  }

  cancelStream(): void {
    this.streamGeneration += 1;
  }

  acceptsStreamEvent(
    token: AssistantRequestToken,
    activeSessionId: string | null,
    eventSessionId?: string,
  ): boolean {
    if (token.generation !== this.streamGeneration) return false;
    if (eventSessionId) {
      if (token.sessionId !== null && token.sessionId !== eventSessionId) return false;
      if (token.sessionId === null) {
        if (activeSessionId !== null) return false;
        token.sessionId = eventSessionId;
        return true;
      }
    }
    return token.sessionId === activeSessionId;
  }
}
