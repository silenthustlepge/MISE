# 🔪 mise
**The open-source operations brain for commercial kitchens.**  
`mise` (from *mise en place*) is an edge-native intelligence layer that fuses your kitchen's POS transaction data with anonymous spatial data to diagnose bottlenecks in real-time. 

It runs on a mini-PC under the counter, plugs into any POS/KDS, and is fair to the line by construction.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Privacy: Law 25 Compliant](https://img.shields.io/badge/Privacy-Law_25_Compliant-green.svg)]()
[![Compute: Edge](https://img.shields.io/badge/Compute-On--Prem_Edge-blue.svg)]()

## 🚨 The Problem
The restaurant industry has a data problem. 
- **POS/KDS systems** track tickets, but they don't know *why* a ticket is slow. They don't know if a station is abandoned, understaffed, or physically maxed out.
- **Enterprise AI systems** (Agot, PreciTaste) use cloud-based surveillance to track named individuals. They are expensive, privacy-invasive stopwatches built to police workers, not help them.

## 💡 The Thesis: A Mirror, Not a Stopwatch
`mise` flips the three core assumptions of restaurant telemetry:
1. **Station, not Individual:** The schema enforces spatial tracking. We track "Station 2 (Carving)", never "Cook A". You cannot weaponize what the database cannot represent.
2. **Causal Inference Engine:** Instead of just measuring slowness, `mise` looks for *hidden correlations*. "When Club slows down, Assembly gets bottlenecked 5 minutes later." It connects the math behind the friction.
3. **Contestable, not Dictated:** The data is returned to the crew in plain language. If the system flags a slow hour, a line cook can annotate the log ("Warmer broke," "Trained new hire"). 

## ✨ The "Open Webcam" MVP Hack
You don't need to mount $2000 cameras in a client's restaurant to test the system. 
For the MVP/Demo, `mise` can consume Public RTSP traffic from open/MIT-licensed webcams (e.g., a public bar camera).
- The system connects to the feed.
- It completely strips PII instantly (blurring faces locally).
- It extracts pure timestamped polygon intersects.
- You can route this mock data right into the `mise-core` fusion engine to show grant officers your causal logic securely.

## 🏗️ Architecture

Think of `mise` as the OpenTelemetry for back-of-house operations.

```text
[ POS / KDS ] (Square, Toast, Maitre'D) --(Adapters)--> \
                                                         +--> [ mise-core: Fusion Engine ] -> [ Local LLM / Explain ]
[ CAMERA ] (RTSP Stream) --(YOLOv8 Edge Vision)-------> /                                           |
                                                                                                    |
                                                                              +---------------------+-------------------+
                                                                              |                                         |
                                                                      Manager Report                               Crew Feedback
                                                                 "Carving maxed out, add cook"              "You got buried, not your fault"
```

## 📦 What's Inside
- `/adapters`: Parsers for KDS data. Currently supports Maitre'D (CSV export) and generic Webhooks. **(We need community help building Toast, Square, and Lightspeed adapters!)**
- `/vision`: Lightweight YOLO script. Tracks bounding box overlap with custom station polygons. Zero image retention.
- `/core`: The constraint engine. Joins KDS ticket duration with vision dwell time to output bottleneck metrics.
- `/explain`: Translates metrics into actionable plain-text insights for both managers and crew.

## 🚀 Getting Started (POC)
You don't need cameras to test the logic. You can run the `mise-core` fusion engine right now using our mock CSV data or your own POS export.
```bash
git clone https://github.com/yourusername/mise.git
cd mise
pip install pandas numpy
python core/mise_core.py
```

## 🤝 Contributing
Open-source means leverage. We supply the BOH event schema; the community builds the adapters. If you've ever worked a Friday night rush and thought, "the data says I'm slow, but the reality is the process is broken," this project is for you.
