# MDDP Data Ingestion Design System: Dark-Grey Horizontal List Rows

This document defines the user interface design standards for the MDDP Data Ingestion Control Center and its distributed service panels. All sub-modules, consoles, and portals must adhere to these design patterns to ensure visual consistency and a cohesive user experience.

---

## 1. Visual & Aesthetic Philosophy

The MDDP interface prioritizes **high readability, structured clarity, and professional horizontal data scanning**. It is styled to resemble modern cloud service management dashboards (e.g., AWS console, Vercel deployments, or Stripe logs).

* **Theme**: Dark-Grey Mode (Slate/Zinc Dark-Grey base, Sky Blue accents, distinct boundaries).
* **Layout**: Horizontal List-Rows instead of grid cards. This facilitates easy horizontal scanning of device information, ports, protocols, and actions.
* **Corners**: Minimal corner rounding (`6px`) to convey structural robustness.
* **Animations**: Fast, responsive transitions (e.g., border highlights, slight horizontal shifts on hover).

---

## 2. Color Palette

All UI elements must construct their styles using the following curated color tokens:

| Token Name | Hex Value | UI Role / Usage |
|---|---|---|
| `--bg-main` | `#121316` | Overall page background (cool dark-grey / slate-950) |
| `--bg-card` | `#1c1e22` | Row and panel container background (solid dark-grey) |
| `--bg-nested` | `#0f1013` | Deep terminal console and table header backing |
| `--border-light` | `#2b2f38` | Standard divider and row border |
| `--border-accent` | `#3f4756` | Active input border and row hover border |
| `--text-primary` | `#f8fafc` | Primary text and major headings (slate-50) |
| `--text-secondary` | `#cbd5e1` | Secondary descriptors and body text (slate-300) |
| `--text-muted` | `#64748b` | Placeholders, timestamps, and metadata (slate-500) |
| `--accent-sky` | `#0ea5e9` | Primary brand blue/sky for links, buttons, and hover boundaries |
| `--accent-sky-bg` | `rgba(14, 165, 233, 0.08)` | Translucent sky backing for icons and highlights |
| `--accent-amber` | `#f59e0b` | Safety alert yellow/amber for warnings and standby states |
| `--accent-emerald` | `#10b981` | Success emerald for online systems and metrics |

---

## 3. Typography & Scale

The design system uses a combination of **Outfit** for headings and **monospace** (Consolas, JetBrains Mono, or system fallbacks) for parameters, ports, and logs.

* **Main Titles (`h1`)**: `20px / 1.25rem`, Semi-Bold (`600`), Letter-spacing `-0.01em`
* **Row Titles (`h3`)**: `15px / 0.9375rem`, Semi-Bold (`600`)
* **Body Text / Descriptors**: `13px / 0.8125rem`, Regular (`400`), Line-height `1.5`
* **Telemetry/Labels**: `12px / 0.75rem`, Monospace, Medium (`500`), Letter-spacing `0.05em`

---

## 4. Components

### A. Horizontal Portal Row
Each control module is presented as a horizontal row component acting as a gateway (portal) to its respective port:
* **Layout**: `display: flex; align-items: center; justify-content: space-between; gap: 1.5rem;`
* **Padding**: `1.25rem 2rem` (`20px` vertical, `32px` horizontal).
* **Border**: `1px solid var(--border-light)`.
* **Hover Interaction**:
  * Row border transitions to `var(--accent-sky)`.
  * Action button background transitions to `var(--accent-sky)`.
  * The link arrow icon shifts slightly top-right (`transform: translate(2px, -2px)`).

### B. Segmented Status Badges
Indicates system statuses clearly using telemetry color rules:
* **Active/Online**: Solid border `#10b981`, text `#10b981`, translucent green background.
* **Standby/Idle**: Solid border `#f59e0b`, text `#f59e0b`, translucent amber background.
* **Offline/Unreachable**: Solid border `#64748b`, text `#cbd5e1`, translucent gray background.

---

## 5. Architectural Portals & Scaling

To support distributed systems and micro-service scalability, the homepage acts as a **Central Portal Hub**.

1. **Decoupled Architecture**: Each hardware process (DAQ, Musashi II, Musashi IV) is managed by an independent web service running on its own dedicated port.
2. **Gateway Links**: Portal buttons use anchor links (`<a>` tags) pointing directly to the host IP and target port (e.g., `http://localhost:8081`).
3. **Decoupled Deployment**: Modifying or redeploying one control panel does not affect the main portal page or other panels, allowing independent scaling and high availability.
