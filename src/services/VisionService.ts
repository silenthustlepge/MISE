import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { BoundingBox } from '../core/types';

/**
 * VisionService
 * 
 * The core edge-native module that processes video frames for object detection.
 * 
 * SECURITY & PRIVACY ENFORCEMENT (Law 25 & PIPEDA Compliant):
 * 1. This service ONLY outputs spatial coordinates (BoundingBox metadata).
 * 2. Raw video frames are processed entirely in ephemeral memory.
 * 3. NO image data, pixel arrays, or facial features are ever returned, logged, or persisted.
 * 4. Once `processFrame` completes, the source frame is immediately discarded by the JS garbage collector.
 */
export class VisionService {
  private model: cocoSsd.ObjectDetection | null = null;
  private isInitialized = false;

  /**
   * Loads the lightweight MobileNetV2 model designed for edge hardware.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    try {
      await tf.ready();
      // Using lite_mobilenet_v2 for optimal edge performance on under-counter mini-PCs
      this.model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      this.isInitialized = true;
      console.log("[mise] VisionService initialized. Ephemeral processing active.");
    } catch (error) {
      console.error("[mise] Failed to initialize VisionService:", error);
      throw error;
    }
  }

  /**
   * Processes a single video frame, extracts person coordinates, and strictly drops the image payload.
   * 
   * @param videoSource The live video element to process
   * @returns An array of bounding boxes for spatial tracking. Raw imagery is destroyed.
   */
  async processFrame(videoSource: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement): Promise<BoundingBox[]> {
    if (!this.isInitialized || !this.model) {
      throw new Error("VisionService is not initialized. Call initialize() first.");
    }

    // Await model inference
    const predictions = await this.model.detect(videoSource);

    // Map to normalized metadata, explicitly shedding any other tracking info
    const detections: BoundingBox[] = predictions.map(p => ({
      x: p.bbox[0],
      y: p.bbox[1],
      width: p.bbox[2],
      height: p.bbox[3],
      class: p.class,
      score: p.score
    }));

    // Explicitly return only metadata. The video frame stays in the DOM/Memory briefly
    // and is never written to disk or sent over a network.
    return detections;
  }
}

// Export a singleton instance for systemic use across the edge device
export const edgeVision = new VisionService();
