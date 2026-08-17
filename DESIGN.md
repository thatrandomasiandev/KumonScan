---
name: KumonScan
description: Calm, official attendance tool for Kumon learning centers, Material Design 3
colors:
  primary: "#1B6EF3"
  on-primary: "#FFFFFF"
  primary-container: "#D8E6FF"
  on-primary-container: "#001946"
  secondary: "#F59E0B"
  secondary-container: "#FFECC2"
  tertiary: "#6B4EFF"
  tertiary-container: "#E8DDFF"
  surface: "#F8F9FF"
  surface-bright: "#FFFFFF"
  surface-variant: "#E1E2EC"
  on-surface: "#1A1B22"
  on-surface-variant: "#44464F"
  background: "#F8F9FF"
  outline: "#74767F"
  outline-variant: "#C4C6D0"
  error: "#BA1A1A"
  error-container: "#FFDAD6"
  success: "#2E7D32"
  success-container: "#C8E6C9"
typography:
  display-small:
    fontFamily: "Roboto, Helvetica, Arial, sans-serif"
    fontSize: "36px"
    fontWeight: 400
    lineHeight: "44px"
  title-large:
    fontFamily: "Roboto, Helvetica, Arial, sans-serif"
    fontSize: "22px"
    fontWeight: 500
    lineHeight: "28px"
  body-large:
    fontFamily: "Roboto, Helvetica, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "24px"
    letterSpacing: "0.5px"
  body-medium:
    fontFamily: "Roboto, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  label-large:
    fontFamily: "Roboto, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "20px"
  mono:
    fontFamily: "Roboto Mono, Roboto, monospace"
    fontSize: "14px"
    fontWeight: 400
rounded:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "28px"
  full: "9999px"
spacing:
  grid: "4px"
components:
  button-filled:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
    height: "40px"
  button-tonal:
    backgroundColor: "{colors.primary-container}"
    textColor: "{colors.on-primary-container}"
    rounded: "{rounded.full}"
  chip-assist:
    backgroundColor: "{colors.surface-bright}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.sm}"
    height: "32px"
  card-elevated:
    backgroundColor: "{colors.surface-bright}"
    rounded: "{rounded.xl}"
    padding: "20px"
---

# Design System: KumonScan

## Overview

**Creative North Star: "The Front Desk Ledger"**

KumonScan reads like a well-run center front desk: bright, orderly, legible at arm's length on a tablet. Staff run Desk, Dashboard, and Admin on the same device or a nearby laptop, front desk in normal indoor light.

**Visual system:** Material Design 3 (Material You) with a blue seed palette, Roboto typography, and Material Icons Outlined. Implementation uses MUI theme tokens in `client/src/theme.js`.

**Key characteristics:**

- Light `#F8F9FF` background everywhere (no dark mode)
- Primary blue `#1B6EF3` for actions, selection, and check-in accents only
- Kumon amber `#F59E0B` as MD3 secondary (progress indicators, accent moments)
- Surface tint elevation instead of heavy drop shadows on cards
- Navigation rail (desktop) + bottom bar (mobile) + a shared top app bar

## Colors

### Primary (MD3 blue seed)

- **Primary** (#1B6EF3): Filled buttons, active nav, chart bars
- **Primary Container** (#D8E6FF): Tonal buttons, stat strip, active nav pill
- **On Primary Container** (#001946): Text on primary container surfaces

### Secondary (Kumon amber)

- **Secondary** (#F59E0B): Auto-dismiss progress indicators, accent moments
- **Secondary Container** (#FFECC2): Progress track

### Semantic

- **Tertiary** (#6B4EFF) + **Tertiary Container** (#E8DDFF): Check-in success icon circle
- **Error** (#BA1A1A) + **Error Container** (#FFDAD6): Check-out sheet, destructive confirmations
- **Success** (#2E7D32) + **Success Container** (#C8E6C9): Attendance confirmation only

### Surfaces

- **Background / Surface** (#F8F9FF): Page wash (blue-tinted white)
- **Surface Bright** (#FFFFFF): Elevated cards, app bar, bottom sheets
- **Surface Variant** (#E1E2EC): Filled text fields, camera loading placeholder
- **On Surface** (#1A1B22): Headings and primary text
- **On Surface Variant** (#44464F): Captions, clock, supporting text
- **Outline Variant** (#C4C6D0): Dividers, chip borders, app bar bottom edge

### Named rules

**The One Voice Rule.** Primary blue appears on actions and app chrome, not on every icon or card.

**The Attendance Color Rule.** Tertiary/success = checked in; error container = checked out or destructive actions. Do not reuse for unrelated states.

## Typography

**Family:** Roboto (300, 400, 500, 700) for UI; Roboto Mono for timestamps and student numbers.

**MD3 type scale** (defined in `theme.js`): displaySmall through labelSmall. Hierarchy via scale + weight, not decorative pairing.

### Hierarchy on Desk

- **displaySmall** (36px): Page heading
- **titleLarge** (22px): App bar title, stat numbers
- **bodyLarge** (16px): Instructions and roster search
- **bodySmall** (12px): Captions, stat labels
- **labelLarge** (14px): Status chip

Body prose max ~65 characters where possible.

## Elevation

MD3 surface tint levels (primary at 5–14% over white), not nested card stacks.

- **Level 0:** Background `#F8F9FF`
- **Level 1–2:** App bar, elevated cards (`0 1px 2px` + `0 2px 8px` shadow allowed)
- **Level 4:** Bottom sheets, dialogs (`0 4px 32px rgba(0,0,0,0.12)`)
- **Scrim:** `rgba(0,0,0,0.32)` behind sheets

No glassmorphism, no glow, no ambient orbs.

## Components

### Top app bar

Center-aligned title, menu leading, live clock trailing (no seconds). Surface + elevation-2 tint, consistent across every page.

### Buttons (MUI)

- **Filled:** Primary bg, full pill radius, 40px height
- **Tonal:** Primary container bg
- **Outlined / Text:** Outline or transparent per MD3 spec

### Chips

Assist chip for status; filter chip for session duration on check-out.

### Bottom sheets & dialogs

28px top radius, drag handle where used, auto-dismiss with amber linear progress on success, error styling on destructive confirmations (deactivate, replace roster).

### Navigation

- **Desktop:** 80px navigation rail (Desk, Register, Dashboard, Messages, Insights, Admin)
- **Mobile:** MD3 bottom navigation (Desk, Dashboard, Messages, Admin)

## Do's and Don'ts

### Do:

- Keep student-facing tap targets at least 44px
- Show attendance state with label and color together
- Use skeleton loading for live stats on Desk
- Respect `prefers-reduced-motion` on all transitions
- Use Material Icons Outlined only

### Don't:

- Use dark backgrounds or glassmorphism anywhere in the app
- Use hero-metric card grids (use unified stat strip instead)
- Use colored left-border stripes on alerts
- Use gradient text or decorative blur
- Nest cards at the same information level
- Expose raw API error strings to students or staff
