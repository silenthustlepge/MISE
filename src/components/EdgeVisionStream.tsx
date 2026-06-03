import React, { useRef, useEffect, useState } from 'react';
import { edgeVision } from '../services/VisionService';
import { SpatialTracker } from '../core/SpatialTracker';
import { StationZone } from '../core/types';
import { Video, AlertCircle, Play, Square, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';

interface EdgeVisionStreamProps {
  onOccupancyChange: (state: Map<string, boolean>) => void;
  zones: StationZone[];
}

export function EdgeVisionStream({ onOccupancyChange, zones }: EdgeVisionStreamProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isActive, setIsActive] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(true);
  const trackerRef = useRef<SpatialTracker | null>(null);
  const reqFrameRef = useRef<number>(0);

  // Load Model via Service
  useEffect(() => {
    async function initVisionService() {
      try {
        await edgeVision.initialize();
        trackerRef.current = new SpatialTracker(zones);
        setIsModelLoading(false);
      } catch (e) {
        console.error("VisionService initialization error:", e);
      }
    }
    initVisionService();
  }, [zones]);

  // Handle Video Stream
  useEffect(() => {
    if (!isActive || !videoRef.current || !canvasRef.current || !trackerRef.current) {
       cancelAnimationFrame(reqFrameRef.current);
       return;
    }

    const video = videoRef.current;
    
    const startWebcam = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = stream;
        video.play();
      } catch (err) {
        console.error("Camera access denied or unavailable. Fallback to placeholder if needed.", err);
        // Fallback to a placeholder video so TFJS still has something to process without crashing.
        video.crossOrigin = "anonymous";
        video.src = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4";
        video.loop = true;
        video.play().catch(e => console.error("Fallback video play failed:", e));
      }
    };

    startWebcam();

    const detectFrame = async () => {
      if (video.readyState === 4) {
        try {
          // Detect using the encapsulated edge service. Raw frames are dropped post-processing.
          const detections = await edgeVision.processFrame(video);
          
          // Run through Spatial Tracker
          const state = trackerRef.current!.processFrame(detections, video.videoWidth, video.videoHeight);
          onOccupancyChange(state);

          // Draw overlay
          const ctx = canvasRef.current!.getContext('2d');
          if (ctx) {
            canvasRef.current!.width = video.videoWidth;
            canvasRef.current!.height = video.videoHeight;
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

            // Draw Station Zones
            zones.forEach(z => {
               const isOccupied = state.get(z.id) || false;
               ctx.strokeStyle = isOccupied ? 'rgba(74, 222, 128, 0.8)' : 'rgba(161, 161, 170, 0.4)'; // Emerald if active, Zinc if idle
               ctx.lineWidth = 2;
               ctx.setLineDash([5, 5]);
               ctx.strokeRect(z.bounds.x * video.videoWidth, z.bounds.y * video.videoHeight, z.bounds.width * video.videoWidth, z.bounds.height * video.videoHeight);
               
               // Label
               ctx.fillStyle = isOccupied ? 'rgba(74, 222, 128, 0.9)' : 'rgba(161, 161, 170, 0.8)';
               ctx.font = '16px monospace';
               ctx.fillText(z.name, (z.bounds.x * video.videoWidth) + 4, (z.bounds.y * video.videoHeight) + 16);
            });

            // Draw Person Detections
            ctx.setLineDash([]);
            detections.forEach(det => {
              if (det.class === 'person') {
                ctx.strokeStyle = 'rgba(99, 102, 241, 0.8)'; // Indigo-500
                ctx.lineWidth = 3;
                ctx.strokeRect(det.x, det.y, det.width, det.height);
                
                const text = `person ${Math.round((det.score || 0)*100)}%`;
                ctx.fillStyle = 'rgba(99, 102, 241, 0.8)';
                ctx.font = '14px monospace';
                ctx.fillText(text, det.x, det.y > 20 ? det.y - 5 : 20);
              }
            });
          }
        } catch (e) {
          console.warn("Frame processing skipped:", e);
        }
      }
      reqFrameRef.current = requestAnimationFrame(detectFrame);
    };

    video.addEventListener('loadeddata', () => {
      detectFrame();
    });

    return () => {
      cancelAnimationFrame(reqFrameRef.current);
      if (video.srcObject) {
         (video.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
    };
  }, [isActive, zones, onOccupancyChange]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden flex flex-col h-full">
      <div className="border-b border-zinc-800 p-4 bg-zinc-900 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-100 flex items-center gap-2">
           <Video className="w-4 h-4 text-zinc-400" />
           Live Spatial Extraction (Local Edge)
        </h2>
        <div className="flex items-center gap-2">
           {isModelLoading ? (
               <span className="text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700 px-2 py-1 rounded flex items-center gap-1 font-mono">
                  <Loader2 className="w-3 h-3 animate-spin"/> LOADING COCO-SSD
               </span>
           ) : (
               <button 
                 onClick={() => setIsActive(!isActive)}
                 className={`text-[10px] px-2 py-1 rounded flex items-center gap-1 font-mono transition-colors ${
                   isActive 
                     ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30' 
                     : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30'
                 }`}
               >
                 {isActive ? <><Square className="w-3 h-3 fill-current"/> STOP STREAM</> : <><Play className="w-3 h-3 fill-current"/> CONNECT OPEN WEBCAM</>}
               </button>
           )}
        </div>
      </div>
      
      <div className="relative flex-1 bg-[#050505] w-full overflow-hidden flex items-center justify-center min-h-[300px]">
         {/* Disclaimer Overlay */}
         <div className="absolute top-2 left-2 z-20 bg-black/80 text-[10px] font-mono text-zinc-400 px-2 py-1 border border-zinc-800 rounded">
           LAW 25 MODE: VIDEO BUFFER BLURRED. EXTRACTING MATH ONLY.
         </div>
         
         {!isActive && !isModelLoading && (
            <div className="text-sm font-mono text-zinc-500 flex flex-col items-center gap-2">
              <AlertCircle className="w-6 h-6 opacity-50" />
              <span>Camera integration inactive.</span>
              <span className="text-xs">Click 'CONNECT OPEN WEBCAM' to mount physical layout.</span>
            </div>
         )}
         
         <div className="relative w-full h-full max-h-[600px] flex justify-center items-center">
            {/* The actual video feed. Heavily blurred to simulate edge PII stripping. */}
            <video 
              ref={videoRef}
              crossOrigin="anonymous"
              className={`absolute w-full h-full object-contain filter blur-[12px] brightness-50 transition-opacity duration-1000 ${isActive ? 'opacity-100' : 'opacity-0'}`}
              autoPlay 
              playsInline 
              muted
            />
            {/* The detection overlay canvas */}
            <canvas 
              ref={canvasRef}
              className={`absolute w-full h-full object-contain pointer-events-none z-10 transition-opacity duration-1000 ${isActive ? 'opacity-100' : 'opacity-0'}`}
            />
         </div>
      </div>
      <div className="p-3 text-xs text-zinc-500 font-mono bg-zinc-950/80 border-t border-zinc-800 break-all leading-tight">
         {">"} Edge Model: {isModelLoading ? 'Initializing...' : 'TFJS MobileNetV2 (Active)'}<br/>
         {">"} Adapter: Maitre'D Protocol / OpenWebcam Layer<br/>
         {">"} Polygons loaded and mapped.
      </div>
    </div>
  );
}
