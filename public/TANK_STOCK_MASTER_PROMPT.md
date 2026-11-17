# MASTER PROMPT: "Tank Stock" — K R Agro Food Industries (Full-Stack 3D Hopper-Bottom Tank Inventory & Volumetric Stock PWA)

Copy and paste the entire prompt below into an AI coding assistant to build this exact full-stack application from scratch in one shot.

---

## COPY-PASTE MASTER PROMPT

Build a complete, production-ready, mobile-first and desktop-responsive Progressive Web App (PWA) called **"Tank Stock"** for **K R Agro Food Industries**, a food factory that stores rice and other raw materials in hopper-bottom tanks (square/rectangular upper body, sloped hopper bottom, outlet onto a conveyor belt). Users are factory staff on phones (non-technical) and managers on phones or desktop computers. All UI text, labels, and messages must be in simple, clear English.

### 1. CORE ARCHITECTURE & TECH STACK
- **Frontend**: React 19 + TypeScript + Tailwind CSS + Lucide Icons + Three.js (`three`) for interactive 3D tank and silo bay visualization + `xlsx` (SheetJS) for real `.xlsx` Excel spreadsheet exports.
- **Backend**: Node.js + Express (`server.ts`) serving `/api/*` REST endpoints, a `/ws` WebSocket server (`ws`) for real-time live sync across all connected phones, and Vite middleware in development (`tsx server.ts`).
- **Database**: PostgreSQL with Drizzle ORM (`src/db/schema.ts`, `src/db/index.ts`, `src/db/repository.ts`) compatible with Cloud SQL and Neon Postgres, plus an automatic in-memory fallback mirror so the app never fails if the database connection resets.
- **Authentication & Roles**: Firebase Authentication (Email & Password login + Google Sign-In + 1-tap Demo Manager and Demo Staff quick-switch buttons for testing). Two roles:
  - **Manager (`manager`)**: Full access to everything (add/edit/delete tanks, draw tank shapes, manage materials, record entries, edit or delete any past entry, view reports, export to Excel).
  - **Staff (`staff`)**: Can view live tank stock and record new entries (Loaded into tank, Used for production, Level reading) on mobile with big touch buttons, but cannot edit/delete past entries or modify tank shapes.
- **PWA & Offline Support**:
  - Configured with `vite-plugin-pwa`, Web App Manifest (`standalone`, dark slate theme `#0f172a`, 192x192, 512x512, maskable, and Apple touch icons), service worker asset caching, and an in-app **"Install App"** button in the header.
  - **Offline Outbox Queue**: If a phone loses internet connection on the factory floor, new entries (Load, Use, Level Reading) are saved in `localStorage` (`tank_stock_offline_outbox_v1`), shown with a pending badge, and automatically synced to the server when internet returns.

---

### 2. TANKS & 2D FRONT-VIEW GEOMETRY EDITOR
- **Default Factory Tanks**: Seed 12 realistic hopper-bottom tanks named `A, B, C, D, A1, B1, C1, D1, E, F, G, H` with varying capacities, hopper slopes, and rice materials. Managers can add new tanks, edit existing tanks, or delete tanks.
- **2D Front-View Polygon Drawing Editor (`TankGeometryEditor.tsx`)**:
  - Managers draw the front view of the tank on an interactive centimeter SVG grid (`1 cm` precision).
  - Coordinate system:
    - `xCm`: Across from the left edge (`cm`).
    - `yCm`: Up from the bottom outlet (`0 cm` at the bottom outlet up to top roof height).
  - Users can **tap on the grid** to add corner points, **drag corner points** directly with touch/mouse, or **type exact cm coordinates** (`Across from left cm`, `Up from outlet cm`) in a clean coordinate table, plus use quick preset templates (Standard Hopper, Steep Hopper, Wide Silo).
  - The 2D drawing must automatically display **each wall/side's exact length in cm** (`sqrt(dx^2 + dy^2)`), highlight the bottom outlet at `y = 0 cm`, and draw a dashed line where the sloped hopper meets the vertical walls.
- **Extra Tank Inputs**:
  - `straightDepthCm`: Front-to-back depth (cm) of the straight vertical upper body.
  - `outletDepthCm`: Front-to-back depth (cm) at the bottom outlet (`y = 0`), in case the hopper also narrows front-to-back.
  - `correctionFactor`: Multiplier (default `1.000`) to calibrate capacity after one weighed test load. Include a built-in **Weighed Test Load Calibration Calculator** where the manager enters a known test weight (`kg`), density (`kg/L`), and measured empty gap (`cm`), and the app automatically calculates and sets the exact `correctionFactor`.
  - `lowWarningPct` and `highWarningPct`: Editable per tank (default `< 15%` for Low Stock warning and `> 90%` for Nearly Full warning).

---

### 3. 1 CM VOLUMETRIC SLICE ENGINE (`src/lib/tankMath.ts`)
- **Auto-Detect Top of Sloped Hopper (`detectHopperTopY`)**:
  - Automatically inspect the left and right wall segments of the front-view polygon starting from the bottom (`y = 0 cm`) upward and find the height `hopperTopY` where the sloped hopper walls become vertical (`|dx| < 0.5 cm`).
- **1 cm Horizontal Layer Slicing (`computeTankSlices`)**:
  - Slice the tank from `y = 0` to `totalHeightCm` into `1 cm` horizontal layers (sampled at layer midpoint `z = i + 0.5 cm`).
  - For each `1 cm` slice:
    1. Compute horizontal `widthCm(z)` between the left and right polygon walls at height `z`.
    2. Compute front-to-back `depthCm(z)`:
       - For `z >= hopperTopY` (vertical straight body): `depthCm(z) = straightDepthCm`.
       - For `0 <= z < hopperTopY` (sloped hopper section): linearly interpolate evenly from `outletDepthCm` at `z = 0` to `straightDepthCm` at `z = hopperTopY`:
         `depthCm(z) = outletDepthCm + (z / hopperTopY) * (straightDepthCm - outletDepthCm)`
    3. Compute slice volume in litres:
       `sliceLitres = (widthCm(z) * depthCm(z) * 1 / 1000) * correctionFactor`
    4. Store cumulative litres from `0` up to every `1 cm` height so any filled height or empty top gap converts to exact litres and `kg` instantaneously.

---

### 4. PROFESSIONAL 3D HOPPER-BOTTOM TANK & SILO BAY VIEW (`Tank3DViewport.tsx`)
- Build an interactive Three.js 3D viewport with smooth orbit/touch rotation, zoom, and pan:
  - **Single-Tank 3D Inspection View**:
    - Constructs the exact 3D lofted geometry of the tank from its 2D front-view polygon and front-to-back depth profile (`straightDepthCm` narrowing down to `outletDepthCm` below `hopperTopY`).
    - Renders structural steel corner columns, top roof deck with inspection hatch, bottom discharge slide-gate flange, and a moving **bottom conveyor belt with rollers** underneath the outlet.
    - Renders the **3D grain fill volume** inside the tank up to the current stock height, with a subtle conical surface angle of repose and warm rice/grain coloration matching the active material.
    - Renders a vertical **top empty-gap measurement laser line** from the roof down to the grain surface showing the empty gap in `cm`.
    - Includes 3 camera/material inspection modes: **Cutaway View** (front wall open so grain level is clearly visible), **X-Ray Glass**, and **Solid Steel**, plus a **Reset Camera** button and an interactive height/level readout HUD.
  - **Multi-Tank 3D Silo Bay Overview**:
    - Renders all 12 factory tanks (`A, B, C, D, A1, B1, C1, D1, E, F, G, H`) arranged in a 2-row industrial silo bay above factory conveyor lines, each filled to its live percentage and clickable to jump straight to that tank's detail page.

---

### 5. MATERIALS, ENTRIES & LIVE STOCK FORMULA
- **Materials Catalog**:
  - Each tank holds one material at a time.
  - Seed default factory materials:
    1. `Matta Rice ( Palakkadan )` — Lot `LOT-2025-M1`, `0.78 kg/L`
    2. `Ponni Raw Rice` — Lot `LOT-2025-P4`, `0.81 kg/L`
    3. `Jaya Parboiled Rice` — Lot `LOT-2025-J2`, `0.76 kg/L`
    4. `Kaima / Jeerakasala Rice` — Lot `LOT-2025-K9`, `0.74 kg/L`
    5. `Raw Paddy (Unmilled)` — Lot `LOT-2025-PD1`, `0.58 kg/L`
  - Managers can add new material lots or update reference `kg per litre` values.
- **Three Entry Types** (all record date, time, user name, and optional note):
  1. **Loaded into Tank (`load`)**:
     - Select material (updates tank's active material if needed), enter weight (`kg`), **manually type `kg per litre` density** (pre-filled with the material lot's reference `kg/L` as a helper), and enter supplier / bill / lot number.
  2. **Used for Production (`use`)**:
     - Enter weight (`kg`) removed onto the conveyor, and product or batch made (e.g., `Batch #408 - 50kg Sortex Matta Bags`).
  3. **Level Reading (`reading`)**:
     - Enter **Empty Gap from Top at Centre (`cm`)** and **Empty Gap from Top at Wall (`cm`)**, plus **manually type `kg per litre` density**.
     - The app averages the centre and wall empty gaps (`avgEmptyGapCm = (gapCenterCm + gapWallCm) / 2`), subtracts from total tank height (`filledHeightCm = totalHeightCm - avgEmptyGapCm`), looks up exact **Litres** from the 1 cm slice table, multiplies by `kgPerLitre` to get **Measured Stock (`kg`)**, and displays a live preview before saving.
- **Stock Formula & Discrepancy Detection**:
  - `Stock Now (kg) = Last Level Reading (kg) + Loaded Since Then (kg) - Used Since Then (kg)`
  - If a tank has no level reading yet: `Stock Now (kg) = Total Loaded (kg) - Total Used (kg)`.
  - **Book Stock vs. Level Reading Difference**: Whenever a new level reading is entered, calculate `Discrepancy (kg) = New Level Reading (kg) - Book Stock Before Reading (kg)`. Display this difference clearly in the Level Reading modal, on the Tank Detail page, and in the History table so grain losses, moisture changes, or entry mistakes are immediately visible.
  - **Manager-Only Edit & Delete**: Managers can edit/correct or delete any past entry, which immediately recalculates all subsequent stock numbers and broadcasts the update live.

---

### 6. SCREENS & RESPONSIVE LAYOUTS
1. **Home Screen (Factory Overview)**:
   - Top KPI strip: Total Factory Stock (`kg` and metric tonnes), Active Warning Count (Low `< 15%` or High `> 90%`), and Horizontal Stock Breakdown by Material (`kg` and tank count per rice variety).
   - Search & Filter bar (All Tanks, Warnings Only, or filter by Material).
   - **Tank Grid**: One card per tank (`A, B, C, D, A1, B1, C1, D1, E, F, G, H`) featuring a custom 2D cross-section mini-tank graphic filled to its exact level, material badge, current `kg`, `% full`, last reading timestamp, warning badge (`LOW STOCK` in red or `NEARLY FULL` in amber), and 1-tap quick action buttons (`+ Load`, `- Use`, `Level Reading`).
2. **Tank Detail Page**:
   - Interactive 3D Hopper-Bottom Tank View + toggleable 2D Cross-Section diagram showing dimensions, `hopperTopY`, filled height, and empty top gap.
   - Big mobile-friendly action buttons for **1. Loaded into Tank**, **2. Used for Production**, and **3. Level Reading**.
   - Live Stock Breakdown card showing `Last Reading + Loaded Since - Used Since = Stock Now`, capacity in litres & kg, correction factor, and latest reading discrepancy vs. book stock.
   - Complete chronological **Tank Entry History** table with type badges, details, centre/wall gap, density, discrepancy badge, user name, and Manager-only Edit & Delete controls.
3. **3D Silo Bay View**:
   - Full-screen interactive 3D factory floor showing all 12 hopper-bottom tanks and conveyors simultaneously.
4. **Reports & Excel Export (`ReportsView.tsx`)**:
   - Date-range picker (`Start Date` to `End Date`, plus quick 7-day / 30-day / This Month buttons).
   - **Report by Tank**: Opening Stock (`kg`), Loaded (`kg`), Used (`kg`), Net Reading Adjustment / Variance (`kg`), Closing Stock (`kg`), Capacity (`kg`), and `% Full`.
   - **Report by Material**: Opening, Loaded, Used, Variance, and Closing `kg` grouped by rice material.
   - **Export to Excel (`.xlsx`)**: Generates a multi-sheet Excel workbook (`By Tank`, `By Material`, and `Entry Log`) using `xlsx`.
5. **Manager Studio (Tanks & Materials)**:
   - Create/edit/delete tanks with the interactive 2D cm grid drawing editor, straight/outlet depth inputs, weighed test-load correction factor calculator, and material catalog editor.
6. **Non-Programmer Deployment Guide (`DeployAndSensorView.tsx`)**:
   - Step-by-step non-programmer instructions for hosting on **GitHub + Render + Neon Postgres**.
