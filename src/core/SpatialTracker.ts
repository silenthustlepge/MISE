import { BoundingBox, StationZone } from "./types";

/**
 * Handles the "crowd problem".
 * If multiple people walk past a station, we shouldn't trigger rapid state flipping.
 * We require a bounding box to intersect the station zone consistently for N frames.
 */
export class SpatialTracker {
  private zones: Map<string, StationZone>;
  private occupancyCounters: Map<string, number>;
  private occupancyState: Map<string, boolean>;
  
  // Configuration for smoothing
  private readonly ACTIVATION_THRESHOLD = 5; // Frames required to consider "active"
  private readonly DEACTIVATION_THRESHOLD = 8; // Frames required empty to consider "idle"
  private emptyCounters: Map<string, number>;

  constructor(zones: StationZone[]) {
    this.zones = new Map(zones.map(z => [z.id, z]));
    this.occupancyCounters = new Map(zones.map(z => [z.id, 0]));
    this.emptyCounters = new Map(zones.map(z => [z.id, 0]));
    this.occupancyState = new Map(zones.map(z => [z.id, false]));
  }

  // Returns true if box A overlaps box B by at least 30% of Box A's area
  private doesIntersect(person: BoundingBox, zone: BoundingBox, videoWidth: number, videoHeight: number): boolean {
    const pRight = person.x + person.width;
    const pBottom = person.y + person.height;
    
    // Scale zone (which is 0-1) to video dimensions
    const zX = zone.x * videoWidth;
    const zY = zone.y * videoHeight;
    const zRight = zX + (zone.width * videoWidth);
    const zBottom = zY + (zone.height * videoHeight);

    const overlapX = Math.max(0, Math.min(pRight, zRight) - Math.max(person.x, zX));
    const overlapY = Math.max(0, Math.min(pBottom, zBottom) - Math.max(person.y, zY));
    const overlapArea = overlapX * overlapY;

    const personArea = person.width * person.height;
    
    return (overlapArea / personArea) > 0.3; // 30% spatial overlap required
  }

  /**
   * Feed a new frame of detections into the tracker.
   * Returns a map of stationId -> isOccupied
   */
  public processFrame(detections: BoundingBox[], videoWidth: number, videoHeight: number): Map<string, boolean> {
    const currentFrameOccupancy = new Map<string, boolean>(Array.from(this.zones.keys()).map(k => [k, false]));

    // Check which zones have a person intersecting
    for (const det of detections) {
      if (det.class !== 'person') continue;
      
      for (const [id, zone] of this.zones.entries()) {
        if (this.doesIntersect(det, zone.bounds, videoWidth, videoHeight)) {
          currentFrameOccupancy.set(id, true);
        }
      }
    }

    // Apply temporal smoothing (debounce)
    for (const [id, isIntersecting] of currentFrameOccupancy.entries()) {
      const isCurrentlyOccupied = this.occupancyState.get(id) || false;

      if (isIntersecting) {
        this.emptyCounters.set(id, 0);
        let acc = (this.occupancyCounters.get(id) || 0) + 1;
        this.occupancyCounters.set(id, acc);

        if (!isCurrentlyOccupied && acc >= this.ACTIVATION_THRESHOLD) {
          this.occupancyState.set(id, true);
        }
      } else {
        this.occupancyCounters.set(id, 0);
        let emptyAcc = (this.emptyCounters.get(id) || 0) + 1;
        this.emptyCounters.set(id, emptyAcc);

        if (isCurrentlyOccupied && emptyAcc >= this.DEACTIVATION_THRESHOLD) {
          this.occupancyState.set(id, false);
        }
      }
    }

    return new Map(this.occupancyState);
  }

  public getState() {
    return new Map(this.occupancyState);
  }
}
