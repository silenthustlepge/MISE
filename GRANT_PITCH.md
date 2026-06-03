**Project Title:** Project Mise: Privacy-First Edge Analytics for the Canadian Restaurant Sector
**Applicant Persona:** Prashant, Systems Developer & Operations Expert (St-Hubert ecosystem)
**Funding Track:** Technology Commercialization / Digital Modernization

### 1. Executive Summary
Canadian restaurants are facing a dual crisis: unprecedented labor shortages and collapsing profit margins. While large American fast-food chains are deploying multi-million-dollar AI surveillance to squeeze efficiency out of workers, Canadian independent restaurants and franchises are left behind. 

**Project Mise** is an open-architecture, edge-computed software layer. It securely fuses a restaurant's existing Kitchen Display System (KDS) data with anonymous, localized computer vision. By diagnosing structural bottlenecks in real-time without tracking individual identities, `mise` increases kitchen throughput by 10-15% while strictly adhering to Quebec Law 25 privacy standards and prioritizing labor retention.

### 2. The Market Gap & The Innovation
Currently, back-of-house operations are measured strictly by KDS ticket times. If a ticket is slow, management assumes the worker is slow. 

**The Innovation:** `mise` introduces *spatial context*. By running lightweight computer vision locally (on an under-counter mini-PC), `mise` knows when a workstation is physically occupied versus abandoned. 
*   *If ticket times are high + station is empty:* Management knows they have an allocation/staffing problem.
*   *If ticket times are high + station is 100% occupied:* Management knows they have a process/equipment limit, relieving the worker of unfair blame.

This "station-first, privacy-by-design" approach does not exist in the commercial market. 

### 3. Why It Must Be Edge-Native and Open
1.  **Law 25 & PIPEDA Compliance:** Competitors stream kitchen footage to cloud servers. `mise` processes bounding-box data locally. Video frames are instantly discarded. Only numerical logs (e.g., "Station 2 occupied for 45 mins") are stored.
2.  **Affordability:** By avoiding heavy AWS/Cloud processing fees, `mise` transforms an enterprise luxury into an accessible tool for Canadian SMEs and franchises.
3.  **Agnostic Integration:** Built as an open-core middleware, it is designed to integrate with major Canadian POS infrastructure like PayFacto (Maitre'D), Lightspeed, and Square.

### 4. The "Ask" and Roadmap
We are seeking **[$100k CAD]** to transition `mise` from a validated algorithmic prototype to a deployable B2B product.
*   **Milestone 1 (Months 1-2):** Develop secure, real-time API adapters for leading POS systems (moving from CSV batch exports to live webhooks).
*   **Milestone 2 (Months 3-4):** Hardware packaging. Configure the plug-and-play local edge device (NVIDIA Jetson / Local Linux Box) capable of running the vision module alongside the fusion engine.
*   **Milestone 3 (Months 5-6):** Beta deployment. Run a 60-day live pilot in a high-volume Quebec franchise (St-Hubert), validating both throughput increases and worker adoption rates. 

### 5. Social & Economic Impact for Canada
Instead of importing invasive Silicon Valley surveillance tech, Canada can export a fairer, smarter standard for restaurant operations. `mise` protects Canadian restaurant margins by identifying actual process inefficiencies, while protecting Canadian workers from algorithmic burnout. It proves that operational excellence and data privacy are not mutually exclusive.
