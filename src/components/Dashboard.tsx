import React, { useState, useEffect, useCallback } from 'react';
import { analyzeBottleneck, generateHiddenCorrelations, StationMetrics, CorrelationInsight } from '../core/miseEngine';
import { StationZone } from '../core/types';
import { EdgeVisionStream } from './EdgeVisionStream';
import { cn } from '../lib/utils';
import { Activity, ShieldCheck, Zap, Terminal, TrendingUp, Cpu, Video, Database } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

// Polled mock data simulation for KDS
const generateTimelineData = () => {
  return Array.from({ length: 20 }).map((_, i) => ({
    time: `1${i % 10}:00`,
    ticketTime: 5 + Math.random() * 10,
    occupancy: 20 + Math.random() * 80,
  }));
};

const INITIAL_STATIONS: StationMetrics[] = [
  { id: 'dough', name: 'Dough Rolling (Top Right)', kdsTicketTimeAvg: 14.5, occupancyPercent: 92, throughput: 45 },
  { id: 'topping', name: 'Topping Area (Bottom Left)', kdsTicketTimeAvg: 16.2, occupancyPercent: 12, throughput: 55 },
  { id: 'dining', name: 'Guest Dining Window', kdsTicketTimeAvg: 0.0, occupancyPercent: 5, throughput: 0 },
];

// Physical layout for the actual Open Webcam detection (normalized screen coordinates 0.0-1.0)
const VISION_ZONES: StationZone[] = [
  { id: 'dough', name: 'Dough Rolling', bounds: { x: 0.5, y: 0.0, width: 0.5, height: 0.5 } },
  { id: 'topping', name: 'Topping', bounds: { x: 0.0, y: 0.4, width: 0.5, height: 0.6 } },
  { id: 'dining', name: 'Dining Area', bounds: { x: 0.0, y: 0.0, width: 0.5, height: 0.3 } },
];

export function Dashboard() {
  const [stations, setStations] = useState<StationMetrics[]>(INITIAL_STATIONS);
  const [timelineData, setTimelineData] = useState(generateTimelineData());
  const [correlations, setCorrelations] = useState<CorrelationInsight[]>([]);

  // Callback to receive edge detection real-time state from TFJS
  const handleOccupancyChange = useCallback((occupancyMap: Map<string, boolean>) => {
    setStations(prev => prev.map(st => {
      const isOccupiedRightNow = occupancyMap.get(st.id);
      
      // We smooth the occupancy state over time into a percentage for the UI
      let newOcc = st.occupancyPercent;
      if (isOccupiedRightNow !== undefined) {
         if (isOccupiedRightNow) {
           newOcc = Math.min(100, newOcc + 5); // Ramp up fast
         } else {
           newOcc = Math.max(0, newOcc - 1);  // Drain slowly
         }
      }

      return { ...st, occupancyPercent: newOcc };
    }));
  }, []);

  // Simulate KDS data updates
  useEffect(() => {
    const interval = setInterval(() => {
      setStations(prev => {
        const next = prev.map(st => {
          const timeFluctuation = (Math.random() - 0.5) * 1.5;
          return {
            ...st,
            kdsTicketTimeAvg: Math.max(2, st.kdsTicketTimeAvg + timeFluctuation),
            throughput: st.throughput + Math.floor((Math.random() - 0.5) * 3)
          };
        });
        
        // Generate new causal insights from updated state
        const newCorrelations = generateHiddenCorrelations(next);
        if (newCorrelations.length > 0) {
           setCorrelations(prevCorrs => {
              const merged = [...newCorrelations, ...prevCorrs];
              return Array.from(new Map(merged.map(item => [item.description, item])).values()).slice(0, 3);
           });
        }
        return next;
      });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col space-y-8 max-w-7xl mx-auto">
      
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between border-b border-zinc-800 pb-6 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="bg-indigo-500/10 p-2 rounded-lg border border-indigo-500/20">
              <Activity className="w-6 h-6 text-indigo-400" />
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">Dodo Pizza - Guzovsky</h1>
            <span className="px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-xs font-mono text-zinc-400 flex items-center gap-1">
              <Video className="w-3 h-3 text-indigo-400" /> LIVE KITCHEN CAM
            </span>
          </div>
          <p className="text-zinc-400 mt-2 text-sm font-mono max-w-xl">
            [FUSION_ENGINE_ONLINE] Live stream analytics for Dodo Pizza kitchen (Cheboksary, Guzovsky St 42). Monitoring Dough, Topping, and Dining Window. GMT+04:00.
          </p>
        </div>
           <div className="flex items-center gap-3 text-sm">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-400 font-mono" title="Cooks may work without gloves as sanitary regulations allow, provided strict hygiene rules are followed. Inspections tracking active.">
               <ShieldCheck className="w-4 h-4" />
               HYGIENE TRACKING
            </div>
           <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              1440P RTSP MUX
           </div>
           <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 font-mono">
              <Cpu className="w-4 h-4" />
              CAUSAL INFERENCE
           </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Left Column (Webcam ML Layer & Stations) */}
        <div className="space-y-6">
          <div className="h-[350px]">
             <EdgeVisionStream 
               zones={VISION_ZONES} 
               onOccupancyChange={handleOccupancyChange} 
             />
          </div>

          <h2 className="text-lg font-medium text-zinc-100 flex items-center gap-2 mt-8">
            <Zap className="w-5 h-5 text-zinc-400" /> Live Station Analytics
          </h2>
          
          <div className="grid grid-cols-1 gap-4">
            {stations.map(station => {
              const insight = analyzeBottleneck(station);
              
              return (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={station.id} 
                  className={cn(
                    "relative overflow-hidden rounded-xl border bg-zinc-900/50 p-5",
                    insight.bottleneckType === 'allocation' ? "border-red-500/50 bg-red-500/5" :
                    insight.bottleneckType === 'process_limit' ? "border-amber-500/50 bg-amber-500/5" :
                    "border-zinc-800"
                  )}
                >
                  <div className="flex flex-col md:flex-row justify-between gap-6">
                    {/* Station Stats */}
                    <div className="flex-1 space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xl font-medium text-white">{station.name}</h3>
                        <div className="font-mono text-xs text-zinc-400">ID: {station.id.toUpperCase()}</div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <div className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Avg Ticket Time</div>
                          <div className="flex items-end gap-2">
                            <span className="text-2xl font-mono text-zinc-100">{station.kdsTicketTimeAvg.toFixed(1)}</span>
                            <span className="text-sm text-zinc-500 mb-1">min</span>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Spatial Occupancy</div>
                          <div className="flex items-end gap-2">
                            <span className="text-2xl font-mono text-zinc-100">{station.occupancyPercent.toFixed(0)}</span>
                            <span className="text-sm text-zinc-500 mb-1">%</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Engine Thesis / Output */}
                    <div className="flex-1 flex flex-col justify-center border-t md:border-t-0 md:border-l border-zinc-800/80 pt-4 md:pt-0 md:pl-6 border-dashed">
                       <div className="mb-2 flex items-center gap-2">
                         <Terminal className="w-4 h-4 text-indigo-400" />
                         <span className="text-xs font-mono text-indigo-400">Local Logic</span>
                       </div>
                       
                       <div className="space-y-3">
                         <div>
                           <div className="text-[10px] text-zinc-500 mb-1 font-mono uppercase tracking-widest">Manager Report</div>
                           <div className={cn(
                             "text-sm font-medium leading-relaxed",
                             insight.severity === 'critical' ? "text-red-400" :
                             insight.severity === 'warning' ? "text-amber-400" :
                             "text-zinc-300"
                           )}>
                             {insight.managerReport}
                           </div>
                         </div>
                         
                         <div>
                           <div className="text-[10px] text-zinc-500 mb-1 font-mono uppercase tracking-widest">Crew UI Mirror</div>
                           <div className="text-sm text-zinc-400 italic">
                             "{insight.crewFeedback}"
                           </div>
                         </div>
                       </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Right Column (Causal Inference & Graph) */}
        <div className="space-y-6">
          
          {/* Combined Timeline Chart */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
             <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-zinc-100 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-zinc-400" /> System Velocity Over Time
                </h3>
             </div>
             <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timelineData}>
                    <XAxis dataKey="time" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="left" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="right" orientation="right" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px', fontSize: '12px' }}
                      itemStyle={{ color: '#e4e4e7' }}
                    />
                    <ReferenceLine yAxisId="left" y={12} stroke="#ef4444" strokeDasharray="3 3" opacity={0.3} />
                    <Line yAxisId="left" type="monotone" dataKey="ticketTime" stroke="#6366f1" strokeWidth={2} dot={false} name="Ticket Avg (m)" />
                    <Line yAxisId="right" type="stepAfter" dataKey="occupancy" stroke="#10b981" strokeWidth={2} dot={false} name="Agg Occupancy (%)" strokeOpacity={0.5} />
                  </LineChart>
                </ResponsiveContainer>
             </div>
          </div>

          {/* Hidden Correlations / Causal Engine */}
          <div className="mt-8 rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-5">
             <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-indigo-200 flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-indigo-400" /> Causal Inference Matrix
                </h3>
                <span className="text-[10px] font-mono text-indigo-500 bg-indigo-500/10 px-2 py-1 rounded">DEEP_SCAN ACTIVE</span>
             </div>
             <p className="text-xs text-zinc-400 mb-4 font-mono leading-relaxed bg-black/20 p-2 rounded border border-indigo-500/10">
               {">"} Analyzing anonymized spatial overlaps vs KDS log anomalies.<br/>
               {">"} Identifying structural workflow failures...
             </p>

             <div className="space-y-3">
                <AnimatePresence>
                  {correlations.length === 0 ? (
                    <motion.div initial={{opacity:0}} animate={{opacity:1}} className="text-sm text-zinc-500 font-mono italic">
                       &gt; Aggregating cross-station matrix... Waiting for statistically significant event chains.
                    </motion.div>
                  ) : (
                    correlations.map(corr => (
                      <motion.div 
                        initial={{ opacity: 0, x: -10 }} 
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        key={corr.id} 
                        className="bg-zinc-950/80 border border-indigo-500/20 rounded-md p-3 flex flex-col gap-2 relative overflow-hidden"
                      >
                         <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500/50"></div>
                         <div className="flex justify-between items-center pl-2">
                           <span className="text-[10px] font-mono text-indigo-400">[{corr.timestamp}] ANONYMIZED_EVENT_TRACE</span>
                           <span className="text-[10px] font-mono text-zinc-500">IMPACT_SCORE: {corr.impactScore}/10</span>
                         </div>
                         <div className="pl-2 text-sm text-zinc-300">
                           {corr.description}
                         </div>
                      </motion.div>
                    ))
                  )}
                </AnimatePresence>
             </div>
          </div>

          {/* Data Points List */}
          <div className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
             <div className="flex items-center gap-2 mb-4 border-b border-zinc-800 pb-3">
                <Database className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-medium text-emerald-100 flex-1">Extracted Video Data Points</h3>
                <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded font-mono uppercase">Live Map</span>
             </div>
             
             <div className="space-y-4">
               <div>
                  <div className="text-xs font-semibold text-emerald-400 font-mono mb-1 block">DATA_POINT: Worker Localization</div>
                  <div className="text-sm text-zinc-300 mb-1 leading-snug">Detecting staff positioning between Dough, Topping, and Dining zones.</div>
                  <div className="text-[10px] text-zinc-500 font-mono uppercase bg-black/30 p-1.5 rounded border border-zinc-800/50 block">Method: COCO-SSD centroid tracking locked to Station Spatial bounds.</div>
               </div>
               <div>
                  <div className="text-xs font-semibold text-emerald-400 font-mono mb-1 block">DATA_POINT: Station Dwell Time</div>
                  <div className="text-sm text-zinc-300 mb-1 leading-snug">Measuring exact time a worker spends at Topping vs Dough rolling.</div>
                  <div className="text-[10px] text-zinc-500 font-mono uppercase bg-black/30 p-1.5 rounded border border-zinc-800/50 block">Method: Temporal delta (duration) while bounding box persists in respective zone.</div>
               </div>
               <div>
                  <div className="text-xs font-semibold text-emerald-400 font-mono mb-1 block">DATA_POINT: Hygiene/PPE Compliance</div>
                  <div className="text-sm text-zinc-300 mb-1 leading-snug">Validating bare-hand vs glove usage (allowed by code if washed) and Dodo hats.</div>
                  <div className="text-[10px] text-zinc-500 font-mono uppercase bg-black/30 p-1.5 rounded border border-zinc-800/50 block">Method: Secondary cropped-image classification on hands/head bounding boxes.</div>
               </div>
                <div>
                  <div className="text-xs font-semibold text-emerald-400 font-mono mb-1 block">DATA_POINT: Ingredient Bin Levels</div>
                  <div className="text-sm text-zinc-300 mb-1 leading-snug">Identifying when cheese, tomatoes, or pepperoni boxes are running low.</div>
                  <div className="text-[10px] text-zinc-500 font-mono uppercase bg-black/30 p-1.5 rounded border border-zinc-800/50 block">Method: Color-threshold area mapping constrained exactly to the Topping bin locations.</div>
               </div>
               <div>
                  <div className="text-xs font-semibold text-emerald-400 font-mono mb-1 block">DATA_POINT: Tray Stack Depletion Rate</div>
                  <div className="text-sm text-zinc-300 mb-1 leading-snug">Tracking the vertical height of dough tray stacks in the top center.</div>
                  <div className="text-[10px] text-zinc-500 font-mono uppercase bg-black/30 p-1.5 rounded border border-zinc-800/50 block">Method: Vertical Bbox height regression to calculate dough usage velocity.</div>
               </div>
             </div>
          </div>

        </div>
      </div>
    </div>
  );
}
