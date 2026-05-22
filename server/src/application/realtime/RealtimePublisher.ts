import type { RealtimeEvent } from '../../domain/realtime/RealtimeEvent.js';

// Порт доставки real-time-событий конкретному пользователю (его открытым SSE-коннектам).
export interface RealtimePublisher {
  publish(userId: string, event: RealtimeEvent): void;
}
