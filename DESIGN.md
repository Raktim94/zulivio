# DESIGN.md — NodeDR Product Design System

Shared by **NodeDR WhatsApp Automation** and **Zulivio CRM**. Format follows the
[awesome-design-md](https://github.com/voltagent/awesome-design-md) convention
(the Stitch `DESIGN.md` layout): a plain-text design brief that coding agents
read before generating UI. The direction below is original to NodeDR; it takes
*structural* cues from precision-first work tools (Linear) and conversational
inbox patterns (Intercom) without reusing any brand's identity.

`AGENTS.md`/`CLAUDE.md` say how to build. This file says how it should look and feel.

---

## 1. Visual Theme & Atmosphere

**"Calm control room."** Staff spend hours in these tools, calling and replying
to real people. The UI must feel quiet, exact and trustworthy: dense enough to
scan 50 conversations, restful enough to read all day.

- Neutral, cool-grey canvas. Colour is *reserved for meaning* (state, action, risk).
- One brand accent: deep emerald (NodeDR). It marks the primary action and "healthy / live".
- Hairline borders instead of heavy shadows. Elevation only for overlays.
- Honesty is a visual feature: anything **simulated, test-mode or disconnected**
  is loud, consistent and impossible to miss (see §4 *Mode & Simulation*).
- Warm, human micro-copy. No jargon in errors; every error says what to do next.

Mood words: precise, calm, honest, dense-but-breathable, bilingual-friendly (English + Hindi).

## 2. Color Palette & Roles

Define as CSS custom properties; never hard-code hex in components.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | `#F6F7F8` | `#0E1418` | App canvas |
| `--surface` | `#FFFFFF` | `#151D23` | Cards, panels, table rows |
| `--surface-2` | `#F0F2F4` | `#1B252C` | Hover rows, inset areas, inbound bubbles |
| `--border` | `#E3E7EA` | `#26323A` | Hairlines (1px) |
| `--border-strong` | `#CBD2D7` | `#35444E` | Inputs, focus-adjacent edges |
| `--ink` | `#14212A` | `#EAF0F2` | Primary text |
| `--ink-2` | `#43535E` | `#A9B8C1` | Secondary text (≥ 4.5:1 on `--surface`) |
| `--ink-3` | `#6B7C87` | `#7E909B` | Tertiary / placeholders (large text & icons only) |
| `--brand` | `#0B7A5A` | `#2FBF92` | Primary actions, links, "live" |
| `--brand-ink` | `#FFFFFF` | `#06231A` | Text on `--brand` |
| `--brand-soft` | `#E4F4EE` | `#12302A` | Selected row, outbound bubble, brand chips |
| `--info` / `--info-soft` | `#2563EB` / `#E6EEFD` | `#6EA0FF` / `#14284F` | Neutral status, "sent" |
| `--ok` / `--ok-soft` | `#15803D` / `#E3F4E9` | `#4ADE80` / `#12301E` | Delivered, applied, healthy |
| `--warn` / `--warn-soft` | `#B45309` / `#FCF1DD` | `#F5B544` / `#38280E` | Needs attention, pending approval |
| `--danger` / `--danger-soft` | `#B91C1C` / `#FBE7E7` | `#F87171` / `#3A1717` | Failed, opted out, destructive |
| `--sim` / `--sim-soft` | `#7C3AED` / `#F1EAFE` | `#B794F6` / `#2A1B4A` | **Simulated / test-mode** (violet is used for nothing else) |

Rules
- Status is never colour-only: pair colour with an icon or label.
- Text/background pairs must pass WCAG AA (4.5:1 body, 3:1 large/icons).
- Dark mode follows `prefers-color-scheme` and an explicit `data-theme` override.

## 3. Typography Rules

- **Family:** Inter (variable) → `ui-sans-serif, system-ui, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Devanagari", sans-serif`. Devanagari must render without fallback glitches: always include Noto Sans Devanagari.
- **Scale (px / line-height):** 12/16 caption · 13/20 dense UI (tables, lists) · 14/22 body (default) · 16/24 lead · 20/28 page title · 24/32 section hero numbers. 
- **Weights:** 400 body, 500 labels & table headers, 600 titles & buttons. No 700+.
- **Tracking:** titles `-0.01em`; ALL-CAPS micro-labels (badges) `+0.04em` at 11px/600.
- **Numerals:** `font-variant-numeric: tabular-nums` for every count, price, percentage, timestamp.
- Message text keeps `white-space: pre-wrap` and `overflow-wrap: anywhere`; Hindi lines get `line-height: 1.6`.
- Phone numbers render as `+91 99990 00001` (grouped), always selectable, never truncated.

## 4. Component Stylings

Radii: input/button `8px` · card `12px` · chip/badge `999px` · bubble `14px` (tail corner `4px`).
Hit targets ≥ 40px (mobile ≥ 44px). Focus ring: `0 0 0 2px var(--bg), 0 0 0 4px var(--brand)`.

- **Button:** primary (`--brand` fill), secondary (surface + strong border), ghost, danger. 36px high desktop, 44px mobile. Loading = inline spinner, label kept, width stable.
- **Input / select:** 36px, `--border-strong`, 8px radius; error = `--danger` border + message under field. Labels above fields, never placeholder-only.
- **Card:** `--surface`, 1px `--border`, 12px radius, 16–20px padding. No shadow at rest.
- **Table:** sticky header, 13px text, row hover `--surface-2`, selected `--brand-soft`, zebra off. Checkbox column, sortable headers with arrow icon, footer shows `N selected of M`. Collapses to stacked cards under 720px.
- **Badge/chip:** 11px caps, soft background + solid text of the same hue. Recipient states: queued (neutral) · sent (info) · delivered (ok) · read (ok, filled) · replied (brand, filled) · failed (danger) · excluded (warn).
- **Stat tile:** label (12px `--ink-2`), value (24px 600 tabular), delta/sub-label (12px). Clickable tiles deep-link to the filtered list.
- **Chat bubbles (the signature surface):** inbound = `--surface-2`, left; outbound human = `--brand-soft`, right; outbound AI = same fill with a small `AI` pill and sparkle glyph; campaign message = outlined with a megaphone glyph and campaign name; internal note = full-width `--warn-soft` strip with lock glyph. Under each outbound bubble: time + delivery ticks (✓ sent · ✓✓ delivered · ✓✓ filled read · ⚠ failed with reason).
- **Handling-state control:** a segmented control `AI · Human` plus *Pause AI* / *Resume AI* / *Take over*. Current state always visible in the thread header.
- **24-hour window indicator:** pill in the composer: `Window open · 3h 12m left` (ok) or `Window closed · templates only` (warn) — composer disables free text when closed.
- **Empty states:** one line of what this is, one line of what to do, one primary action. No illustrations required.
- **Toasts:** bottom-left, 4s, never for errors that need action (those stay inline).
- **Dialogs:** destructive/outbound actions (approve, send, cancel, go-live) use a confirm dialog that restates the *count and consequence* ("Send to 142 people now").

### Mode & Simulation (mandatory, system-wide)
- **Mode bar** pinned under the top bar on every page: `TEST MODE` (violet) or `LIVE` (brand), plus connection chips: `WhatsApp ● connected / ○ not connected`, `CRM ● Zulivio / ○ simulated`, `AI ● model / ○ mock`.
- Anything simulated carries a **SIMULATED** badge (violet, dashed 1px border, micro-caps) *next to the thing itself* — message bubble, recipient row, stage change, CRM write, template. It is never hidden in a tooltip.
- Simulated results never use `--ok` green; they use violet so they cannot be mistaken for real delivery.

## 5. Layout Principles

- **Shell:** left sidebar 232px (collapses to 64px icon rail ≤ 1100px; becomes bottom tab bar ≤ 720px), top bar 56px with search, mode bar 32px, content max-width 1280px on settings/reports pages, fluid on inbox/tables.
- **Inbox:** three panes — list 340px · thread (flex) · customer panel 320px. ≤ 1100px the customer panel becomes a slide-over; ≤ 720px one pane at a time with a back button.
- **Spacing:** 4px base grid: 4 · 8 · 12 · 16 · 24 · 32 · 48. Card gaps 16px, page padding 24px (16px on mobile).
- **Page anatomy:** title row (title + primary action) → filter bar → content → pagination. Filters persist in the URL.
- **Wizards (campaign builder):** vertical stepper — Audience → Template & personalisation → Preview & exclusions → Review & approve → Schedule/Send. A sticky summary rail always shows `selected · eligible · excluded` counts.
- Z-index: sticky header 10 · slide-over 40 · dialog 50 · toast 60.

## 6. Depth & Elevation

Flat by default. Depth is communicated by border and background step, not shadow.
- Level 0: canvas. Level 1: surface + 1px border. Level 2 (menus, popovers): `0 6px 24px rgba(10,20,28,.12)` + border. Level 3 (dialogs): `0 16px 48px rgba(10,20,28,.20)` over a `rgba(10,20,28,.45)` scrim.
- Dark mode lowers shadow opacity and relies on lighter surface steps.

## 7. Do's and Don'ts

**Do**
- Show counts and consequences before irreversible actions.
- Put the *reason* next to every exclusion, failure and handoff.
- Keep one primary action per view.
- Make keyboard flow complete: `j/k` move in lists, `Enter` open, `/` focus search, `Esc` close panels, `Ctrl+Enter` send.
- Write errors as "what happened → what to do".

**Don't**
- Don't use green for anything simulated, and never imply a simulated action happened.
- Don't hide the opt-out / consent state of a person; show it in every profile and recipient row.
- Don't use colour alone for status, and don't use more than one accent per view.
- Don't auto-scroll a thread away from where an agent is reading; show a "N new" jump pill.
- Don't use modal-on-modal, carousels, or decorative gradients.

## 8. Responsive Behavior

Breakpoints: `sm 720` · `md 1100` · `lg 1440`.
- ≤ 720: bottom tab bar (Inbox, Campaigns, Contacts, More), tables become cards, composer sticks to the bottom above the safe-area inset, dialogs go full-screen sheets.
- 720–1100: icon rail, two-pane inbox, customer panel as slide-over.
- ≥ 1100: full three-pane.
- Touch: 44px targets, swipe-free (no hidden gestures); long-press is never the only way.
- Respect `prefers-reduced-motion` (no slide/fade; instant state changes) and `prefers-color-scheme`.

## 9. Agent Prompt Guide

When generating UI for NodeDR products:

> Use the tokens in DESIGN.md §2 as CSS variables (`var(--surface)` etc.). Inter + Noto Sans Devanagari, 14px body, tabular numerals. Hairline borders, 8/12px radii, no resting shadows. One emerald primary action per view. Status uses soft-background chips with an icon. Anything simulated or test-mode gets the violet SIMULATED badge beside the item. Show eligible/excluded counts before any send. Provide dark mode through the same tokens. Make it work at 360px wide.

Quick component checklist before shipping a screen: [ ] focus ring visible · [ ] works at 360px · [ ] dark mode · [ ] empty / loading / error states · [ ] counts & consequences on destructive actions · [ ] simulated items badged · [ ] consent state visible where a person is shown.
