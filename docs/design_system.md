# MDDP Data Ingestion Design System: Cyber-Industrial / Terminal Mode

This document defines the user interface design standards for the MDDP Data Ingestion Control Center and its distributed service panels. All sub-modules, consoles, and portals must adhere to these design patterns to ensure visual consistency and a cohesive user experience.

---

## 1. Visual & Aesthetic Philosophy

The MDDP interface prioritizes **high readability, industrial durability, and professional telemetry monitoring**. It is styled to resemble engineering dashboards (e.g., Grafana, CNC terminals, or flight control systems).

* **Theme**: Dark Mode (Dark Charcoal, Cybernetic Cyan, and Safety Amber).
* **Grid**: Highly structured panel grid layout with sharp borders.
* **Corners**: Minimal corner rounding (`4px` to `6px`) to convey structural machinery.
* **Animations**: Instant state changes with very brief, high-contrast hover indicators.

---

## 2. Color Palette

All UI elements must construct their styles using the following curated color tokens:

| Token Name | Hex Value | UI Role / Usage |
|---|---|---|
| `--bg-main` | `#0c0d12` | Overall page background (dark navy charcoal) |
| `--bg-card` | `#13151a` | Card panel container background (deep flat charcoal) |
| `--border-light` | `#1e222b` | Standard divider and card border |
| `--border-accent` | `#2d3443` | Input border and card hover border |
| `--text-primary` | `#f1f5f9` | Primary text and major headings (slate-100) |
| `--text-secondary` | `#94a3b8` | Secondary descriptors and body text (slate-400) |
| `--text-muted` | `#475569` | Placeholders, timestamps, and metadata (slate-600) |
| `--accent-cyan` | `#06b6d4` | Primary telemetry blue/cyan for buttons, active links, and focus |
| `--accent-cyan-bg` | `rgba(6, 182, 212, 0.1)` | Translucent cyan backing for status and highlights |
| `--accent-amber` | `#f59e0b` | Safety alert yellow/amber for warnings and standby states |
| `--accent-emerald` | `#10b981` | Success emerald for online systems and metrics |

---

## 3. Typography & Scale

The design system uses a combination of **Outfit** for headings and **monospace** (Consolas, SFMono, or system fallbacks) for parameters and logs.

* **Main Titles (`h1`)**: `22px / 1.375rem`, Semi-Bold (`600`), Letter-spacing `-0.01em`
* **Card Titles (`h3`)**: `16px / 1rem`, Semi-Bold (`600`), Upper-case Option
* **Body Text**: `13px / 0.8125rem`, Regular (`400`), Line-height `1.5`
* **Telemetry/Labels**: `12px / 0.75rem`, Monospace, Medium (`500`), Letter-spacing `0.08em`

---

## 4. Components

### A. Terminal Portal Card
Each control module is presented as a Card Component acting as a gateway (portal) to its respective port:
* **Layout**: Padding of `1.75rem` (`28px`), vertical flex gap.
* **Border**: `1px solid var(--border-light)`.
* **Hover Interaction**:
  * Border transitions to `var(--accent-cyan)`.
  * Text color of links changes to white.
  * Very subtle inner shadow: `inset 0 0 10px rgba(6, 182, 212, 0.05)`.

### B. Segmented Status Badges
Indicates system statuses clearly using telemetry color rules:
* **Active/Online**: Solid border `#10b981`, text `#10b981`, translucent green background.
* **Standby/Idle**: Solid border `#f59e0b`, text `#f59e0b`, translucent amber background.
* **Offline/Unreachable**: Solid border `#475569`, text `#94a3b8`, translucent gray background.

---

## 5. Architectural Portals & Scaling

To support distributed systems and micro-service scalability, the homepage acts as a **Central Portal Hub**.

1. **Decoupled Architecture**: Each hardware process (DAQ, Musashi II, Musashi IV) is managed by an independent web service running on its own dedicated port.
2. **Gateway Links**: Portal buttons use anchor links (`<a>` tags) pointing directly to the host IP and target port (e.g., `http://localhost:8081`).
3. **Decoupled Deployment**: Modifying or redeploying one control panel does not affect the main portal page or other panels, allowing independent scaling and high availability.
