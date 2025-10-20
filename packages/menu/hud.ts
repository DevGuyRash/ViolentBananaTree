export type HudNotification = {
  id: string;
  title: string;
  description?: string;
  level: "info" | "warn" | "error";
  metadata?: Record<string, unknown>;
};

type HudEmitter = {
  notify: (notification: HudNotification) => void;
};

let emitter: HudEmitter | null = null;

export function registerHudEmitter(next: HudEmitter): void {
  emitter = next;
}

export function clearHudEmitter(): void {
  emitter = null;
}

export function pushHudNotification(notification: HudNotification): void {
  emitter?.notify(notification);
}
