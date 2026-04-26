import { EventEmitter } from "node:events";

export type DashboardEvent =
  | {
      type: "message";
      waId: string;
      direction: "inbound" | "outbound";
      body: string;
      messageType: string;
      at: number;
    }
  | {
      type: "state_change";
      waId: string;
      from: string;
      to: string;
      at: number;
    }
  | {
      type: "automation_toggle";
      waId: string;
      enabled: boolean;
      at: number;
    }
  | {
      type: "order_created";
      waId: string;
      orderId: number;
      total: number;
      at: number;
    };

class TypedEmitter extends EventEmitter {
  emitDashboard(e: DashboardEvent) {
    this.emit("dashboard", e);
  }
  onDashboard(fn: (e: DashboardEvent) => void) {
    this.on("dashboard", fn);
    return () => this.off("dashboard", fn);
  }
}

export const events = new TypedEmitter();
events.setMaxListeners(0);
