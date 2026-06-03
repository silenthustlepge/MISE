export type StationMetrics = {
  id: string;
  name: string;
  kdsTicketTimeAvg: number; // Average ticket duration in minutes
  occupancyPercent: number; // 0-100% of time bounding-box detects worker in zone
  throughput: number; // Tickets processed per hour
};

export type InsightSeverity = 'normal' | 'warning' | 'critical';

export type Insight = {
  severity: InsightSeverity;
  managerReport: string;
  crewFeedback: string;
  bottleneckType: 'none' | 'allocation' | 'process_limit';
};

export type CorrelationInsight = {
  id: string;
  timestamp: string;
  description: string;
  impactScore: number; // 1-10 scale of how heavily this affects throughput
};

export function analyzeBottleneck(metrics: StationMetrics): Insight {
  const { kdsTicketTimeAvg, occupancyPercent } = metrics;

  // Thresholds (configurable via dashboard/settings later)
  const TICKET_TIME_DANGER_THRESHOLD = 12; // minutes
  const TICKET_TIME_WARN_THRESHOLD = 9;
  const ABANDONED_THRESHOLD = 30; // percent
  const MAXED_OUT_THRESHOLD = 80;

  if (kdsTicketTimeAvg > TICKET_TIME_DANGER_THRESHOLD) {
    if (occupancyPercent < ABANDONED_THRESHOLD) {
      return {
        severity: 'critical',
        managerReport: `Station abandoned during high volume. Reallocate staff to ${metrics.name}.`,
        crewFeedback: `Station empty. Is the line short-staffed?`,
        bottleneckType: 'allocation'
      };
    } else if (occupancyPercent > MAXED_OUT_THRESHOLD) {
      return {
        severity: 'warning',
        managerReport: `Physical process limit reached at ${metrics.name}. Worker cannot move faster.`,
        crewFeedback: `You got buried, not your fault. Operating at 100% capacity.`,
        bottleneckType: 'process_limit'
      };
    }
  }

  if (kdsTicketTimeAvg > TICKET_TIME_WARN_THRESHOLD && occupancyPercent > MAXED_OUT_THRESHOLD) {
    return {
      severity: 'warning',
      managerReport: `${metrics.name} is nearing physical limits. Monitor closely.`,
      crewFeedback: `Heavy volume, holding steady at maximum capacity.`,
      bottleneckType: 'process_limit'
    };
  }

  if (occupancyPercent > 80 && kdsTicketTimeAvg <= TICKET_TIME_WARN_THRESHOLD) {
    return {
      severity: 'normal',
      managerReport: `High efficiency. ${metrics.name} is busy but clearing tickets fast.`,
      crewFeedback: `Great pace. Holding down the line effortlessly.`,
      bottleneckType: 'none'
    };
  }

  return {
    severity: 'normal',
    managerReport: `Operating nominally. Routine ticket flow.`,
    crewFeedback: `Steady state. Standard volume.`,
    bottleneckType: 'none'
  };
}

// Generate hidden insights / causal correlations based on system-wide anonymous event data
export function generateHiddenCorrelations(stations: StationMetrics[]): CorrelationInsight[] {
  const insights: CorrelationInsight[] = [];
  const now = new Date().toISOString().split('T')[1].slice(0,8); // HH:MM:SS
  
  const dough = stations.find(s => s.id === 'dough');
  const topping = stations.find(s => s.id === 'topping');
  const stacks = stations.find(s => s.id === 'stacks');

  // Example Causal Rule 1: High Dough Volume -> Topping bottleneck
  if (dough && dough.throughput > 50 && topping && topping.occupancyPercent > 80) {
    insights.push({
      id: `corr_dough_top_${Date.now()}`,
      timestamp: now,
      description: `Causal Link: When 'Dough' throughput spikes >50/hr, 'Topping' reaches 80% occupancy within 5 minutes. Consider assigning a second worker to Topping during Dough rushes.`,
      impactScore: 8.5
    });
  }

  // Example Causal Rule 2: Topping abandoned -> Downstream delays
  if (topping && topping.occupancyPercent < 20 && topping.kdsTicketTimeAvg > 8) {
    insights.push({
      id: `corr_top_line_${Date.now()}`,
      timestamp: now,
      description: `Anomaly Detected: 'Topping' spatial target is empty while KDS shows 8m+ dwell limits. The worker is likely fetching ingredients from the cooler. Improve ingredient routing to Topping station.`,
      impactScore: 9.2
    });
  }

  // Example Causal Rule 3: Fast stack depletion
  if (stacks && stacks.occupancyPercent > 80) {
     insights.push({
       id: `corr_stack_${Date.now()}`,
       timestamp: now,
       description: `Inventory Alert: Tray Stack depletion velocity is extremely high. Dough reserves may drop below nominal levels in 15 minutes. Dispatch restock soon.`,
       impactScore: 7.0
     });
  }

  return insights;
}
