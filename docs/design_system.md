# MDDP Data Ingestion Design System & Patterns

This document defines the user interface design standards for the MDDP Data Ingestion Control Center and its distributed service panels. All sub-modules, consoles, and portals must adhere to these design patterns to ensure visual consistency and a cohesive user experience.

---

## 1. Visual & Aesthetic Philosophy

The MDDP interface prioritizes **high readability, structural clarity, and professional enterprise aesthetics**. It avoids excessive decorative effects (such as heavy glows or animations) and instead uses clean layouts, high-contrast typography, and purposeful indicators.

* **Theme**: Light Mode (Light-blue to white gradient/palette).
* **Grid**: Clean, structural alignments with defined card modules.
* **Animations**: Subtle, meaningful feedback transitions (e.g., slight elevation on hover, clean active/focus outlines).

---

## 2. Color Palette

All UI elements must construct their styles using the following curated color tokens:

| Token Name | Hex Value | UI Role / Usage |
|---|---|---|
| `--bg-main` | `#f8fafc` | Overall page background (slate-50) |
| `--bg-card` | `#ffffff` | Card container background (pure white) |
| `--border-light` | `#e2e8f0` | Standard divider and card border (slate-200) |
| `--border-accent` | `#cbd5e1` | Input border and card hover border (slate-300) |
| `--text-primary` | `#0f172a` | Primary text and major headings (slate-900) |
| `--text-secondary` | `#475569` | Secondary descriptors and body text (slate-600) |
| `--text-muted` | `#94a3b8` | Placeholders, timestamps, and metadata (slate-400) |
| `--accent-sky` | `#0284c7` | Primary brand blue for links, buttons, and status (sky-600) |
| `--accent-sky-light` | `#e0f2fe` | Light background accent for alerts and highlights (sky-100) |
| `--badge-bg` | `#f0f9ff` | Default portal status background (sky-50) |

---

## 3. Typography & Scale

The design system uses the **Outfit** typeface (or system sans-serif fallbacks) for a modern, clean geometric look.

* **Main Titles (`h1`)**: `24px / 1.5rem`, Semi-Bold (`600`), Letter-spacing `-0.02em`
* **Card Titles (`h3`)**: `18px / 1.125rem`, Semi-Bold (`600`), Letter-spacing `-0.01em`
* **Body Text**: `14px / 0.875rem`, Regular (`400`), Line-height `1.5`
* **Metadata/Labels**: `12px / 0.75rem`, Medium (`500`), Letter-spacing `0.05em`

---

## 4. Components

### A. Main Portal Card
Each control module is presented as a Card Component acting as a gateway (portal) to its respective port:
* **Layout**: Padding of `2rem` (`32px`), vertical flex gap.
* **Border**: `1px solid var(--border-light)`.
* **Hover Interaction**:
  * Translate upward by `4px` (`transform: translateY(-4px)`).
  * Border transitions to `var(--accent-sky)`.
  * Subtle box shadow: `0 10px 15px -3px rgba(0, 0, 0, 0.05)`.

### B. Status Badges
Indicates system statuses clearly using colored badges:
* **Active/Online**: Light green background (`#dcfce7`), text green (`#15803d`).
* **Standby/Idle**: Light orange/amber background (`#fef3c7`), text orange (`#b45309`).
* **Offline/Unreachable**: Light gray background (`#f1f5f9`), text gray (`#475569`).

---

## 5. Architectural Portals & Scaling

To support distributed systems and micro-service scalability, the homepage acts as a **Central Portal Hub**.

1. **Decoupled Architecture**: Each hardware process (DAQ, Musashi II, Musashi IV) is managed by an independent web service running on its own dedicated port.
2. **Gateway Links**: Portal buttons use anchor links (`<a>` tags) pointing directly to the host IP and target port (e.g., `http://localhost:8081`).
3. **Decoupled Deployment**: Modifying or redeploying one control panel does not affect the main portal page or other panels, allowing independent scaling and high availability.
