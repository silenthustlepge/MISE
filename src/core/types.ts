export type Point = { x: number; y: number };
export type BoundingBox = { x: number; y: number; width: number; height: number; class?: string; score?: number };

export interface StationZone {
  id: string;
  name: string;
  // Represented as percentages (0-1) relative to video/feed dimensions
  bounds: BoundingBox; 
}

export interface SpatialEvent {
  stationId: string;
  timestamp: number;
  occupancyState: boolean; 
  durationMs: number;
}

export interface KdsTicket {
  ticketId: string;
  stationId: string;
  openedAt: number;
  closedAt: number | null;
  items: string[];
}

export interface SystemMetrics {
  stationId: string;
  currentKdsLoad: number; // Active tickets
  rollingAvgTicketTimeMs: number;
  isSpatiallyOccupied: boolean;
  occupancyUptimePercent: number; // For the current hour
}
