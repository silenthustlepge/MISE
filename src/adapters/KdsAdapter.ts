import { KdsTicket } from "./types";

/**
 * Adapter pattern to ingest external/legacy POS systems
 * into the Mise Data Schema.
 */
export interface KdsAdapter {
  getName(): string;
  parsePayload(payload: any): KdsTicket[];
}

export class MaitredAdapter implements KdsAdapter {
  getName() { return "Maitre'D"; }

  // Simulating parsing Maitre'D CSV export or XML payload
  parsePayload(payload: string): KdsTicket[] {
    // In production, this parses comma-separated or XML nodes.
    // For MVP, we simulate parsing a standard Maitre'D array format
    const lines = payload.split('\n').filter(l => l.trim().length > 0);
    
    return lines.map(line => {
      const parts = line.split(',');
      if (parts.length < 5) return null;
      
      return {
        ticketId: parts[0],
        stationId: parts[1],
        openedAt: new Date(parts[2]).getTime(),
        closedAt: parts[3] ? new Date(parts[3]).getTime() : null,
        items: parts[4].split('|')
      };
    }).filter(Boolean) as KdsTicket[];
  }
}

export class GenericWebhookAdapter implements KdsAdapter {
  getName() { return "GenericWebhook"; }

  parsePayload(jsonPayload: any): KdsTicket[] {
    if (!Array.isArray(jsonPayload.orders)) return [];
    
    return jsonPayload.orders.map((o: any) => ({
      ticketId: o.id,
      stationId: o.routing_group || 'unknown',
      openedAt: new Date(o.created_at).getTime(),
      closedAt: o.completed_at ? new Date(o.completed_at).getTime() : null,
      items: o.line_items?.map((i: any) => i.name) || []
    }));
  }
}
