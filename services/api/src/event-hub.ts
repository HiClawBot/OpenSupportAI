import type { ClientEvent } from "@opensupportai/protocol";

export type EventSink = {
  send: (event: ClientEvent) => void;
};

type SubscriptionKey = `${string}:${string}`;

export class EventHub {
  private readonly subscribers = new Map<SubscriptionKey, Set<EventSink>>();

  subscribe(projectId: string, conversationId: string, sink: EventSink): () => void {
    const key = this.key(projectId, conversationId);
    const subscribers = this.subscribers.get(key) ?? new Set<EventSink>();
    subscribers.add(sink);
    this.subscribers.set(key, subscribers);

    return () => {
      const current = this.subscribers.get(key);
      current?.delete(sink);
      if (current?.size === 0) {
        this.subscribers.delete(key);
      }
    };
  }

  publish(projectId: string, conversationId: string, event: ClientEvent): void {
    const subscribers = this.subscribers.get(this.key(projectId, conversationId));
    if (!subscribers) {
      return;
    }

    for (const subscriber of subscribers) {
      subscriber.send(event);
    }
  }

  private key(projectId: string, conversationId: string): SubscriptionKey {
    return `${projectId}:${conversationId}`;
  }
}

export function formatSse(event: ClientEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}
