# Mue'ad Design System

Source of truth: `docs/design/Muead-UI-Reference.pdf` (6 pages: Maintenance Requests, Approvals, 4-screen overview, Dashboard v1, Dashboard v2, Logo sheet).

## 0. How to read this document

Every item is tagged:

- **[Confirmed]** – directly visible in the reference.
- **[Approx.]** – estimated by eye from rendered images. No pixel sampling was possible. Values must be verified with an eyedropper on the original asset before they are treated as final.
- **[Assumption]** – a design decision needed for implementation that the reference does not show.

Note: `Cloud-Maintenance-Planner-SOW.pdf` was **not available** during this analysis. No functional claims are made from it. The docs folder did not exist in the workspace when this was written.

---

## 1. Brand identity

### 1.1 Logo [Confirmed]
- Mark: two interlocking rounded-rectangle ribbons forming a diagonal infinity or "M" shape. The left ribbon goes deep purple to magenta/violet. The right ribbon goes coral/red to light orange/peach. Where they overlap there is a pink gradient with a soft 3D fold shadow.
- Wordmark: "Mue'ad" in a bold geometric sans, dark indigo/purple, with a curly apostrophe.
- Arabic wordmark: "ميعاد" below the Latin wordmark, same dark purple, with kashida stretching.
- Three lockups are defined on the logo sheet:
  1. Full logo (both languages), stacked vertical.
  2. Full logo horizontal (mark left, wordmark right).
  3. Icon only (mark, no text).
- Safe area (clear space) is defined with a dashed box and corner handles. The sheet states that no element may be placed inside it. Exact ratio is not stated. [Assumption] use roughly the height of the "M" of the wordmark as minimum clear space until the brand owner confirms.
- In the app UI the sidebar uses the stacked lockup. The Latin-only version appears on pages 1, 2, 4 and the Arabic line is added on pages 3 and 5. This is an inconsistency, see section 9.

### 1.2 Colors

#### Brand palette [Approx.]
| Role | Observation | Approx. value |
|---|---|---|
| Primary purple (buttons, active tab, active nav start) | medium violet | `#8E4FD0` to `#9B59D0` |
| Deep purple (headings, wordmark, logo left ribbon dark end) | dark indigo-purple | `#2E1A5E` to `#3B1F6E` |
| Magenta/orchid (logo mid-tone) | | `#B04FC8` |
| Coral/red-orange (logo right ribbon, active-nav gradient end) | | `#F0645A` |
| Peach/orange (logo light end, gradient end of CTA) | | `#FDA070` |
| Pink (chart series, avatar, High priority text) | | `#F0679F` |
| Orange/amber (chart series, Medium priority) | | `#F9A24D` |
| Info blue (page-1 "New Request" CTA, In Progress pill) | | `#1F6FEB` to `#2A7BF0` |

#### Neutrals and backgrounds [Approx.]
| Role | Observation |
|---|---|
| App background | Very light lavender-to-pink wash, gradient, not flat (approx. `#F8F2FC` to `#FBF0F8`) |
| Sidebar | Slightly more saturated lilac-pink gradient than the main area (approx. `#F1E4FA` to `#F9E9F5`) with decorative wave at the bottom in purple to peach |
| Surfaces (cards, table) | White or near-white, semi-transparent feel (`#FFFFFF` at about 70-90%) |
| Body text | Dark navy/indigo, not pure black (approx. `#2B2350`) |
| Secondary text | Grey-purple (approx. `#6B6585`) |
| Borders | Very light lavender-grey (approx. `#E6DDF3`) |

#### Gradients [Confirmed in kind, Approx. in values]
- **Brand gradient**: purple, magenta, coral, peach, running left to right or diagonally. Used on the logo mark, the active sidebar item (purple to coral), primary CTA on page 3 (purple to orange), "Generate Summary" button, and a thin underline on the logo sheet.
- **Decorative wave**: translucent purple/peach curves in the corners of the app background and bottom of sidebar.
- **Card tints**: stat cards have a soft tinted corner swoosh matching their icon color (purple, orange, violet, green).

#### Status colors [Approx.]
| Status | Pill background | Pill text |
|---|---|---|
| Pending | light peach/orange `#FDE9D2` | orange-brown `#C26A12` |
| In Progress (page 1, 2 alt) | light blue `#DCEBFE` | blue `#2A6BCB` |
| In Progress (page 3, 4) | light lavender `#E8D9FA` | purple `#7B3FC4` |
| Completed | light green `#D9F5DF` | green `#2E8B4A` |
| Rejected | light pink/red [not shown as a pill, only counted in tabs and the red X icon] | red `#D6335A` |

Priority:
| Priority | Pill background | Text |
|---|---|---|
| High | light pink `#FDDDE6` | crimson/pink `#D6335A` |
| Medium | light amber `#FDEBD0` | amber-brown `#C2701A` |
| Low | light blue `#DCEBFE` | blue `#2A6BCB` |

Presence dot: green `#22B04B` [Approx.].

Category chips (page 1): Equipment = lavender, Facilities = peach, IT = light blue, Office = lavender. Page 2 adds icon-prefixed chips (Facilities, Equipment, IT, HVAC) with tinted backgrounds. Category colors are only loosely consistent and are not a strict mapping. [Assumption] treat category chips as neutral tinted chips and do not assign semantic color.

### 1.3 Typography

- **Latin UI font** [Confirmed]: geometric/humanist sans with round bowls and a single-story-looking "a" in the headings; very consistent with **Plus Jakarta Sans** or **Outfit/Poppins-like** families. The exact family cannot be confirmed from images. [Assumption] Plus Jakarta Sans (free, Google Fonts) as best visual match; confirm with the brand owner.
- **Arabic font** [Confirmed visually]: modern geometric Arabic with stretched baseline (kashida) in the logo. [Assumption] IBM Plex Sans Arabic or Tajawal for UI; the logo itself must be used as an image, never retyped.
- **Weights observed** [Confirmed]: Bold/ExtraBold for page titles and numbers, SemiBold for table titles and nav, Regular for body and captions.
- **Sizes** [Approx.] (at the 1x desktop render):

| Token | Size | Weight | Use |
|---|---|---|---|
| display | 32-36px | 700-800 | Page title ("Maintenance Requests", "Good morning, Amal") |
| stat-number | 28-32px | 700 | KPI numbers |
| h2 | 18-20px | 700 | Card titles ("Requests by Status") |
| body | 14-15px | 400-500 | Table cells, nav items |
| caption | 12-13px | 400 | Subtitles under row titles, "Showing 1-5 of 12" |
| pill | 12px | 500-600 | Status/priority/category chips |

---

## 2. Spacing, radius, shadow

### Spacing [Approx., Assumption for the scale]
Reference appears to follow a 4px grid with 8/12/16/24/32 as common steps.
`space-1 4 · space-2 8 · space-3 12 · space-4 16 · space-5 24 · space-6 32 · space-8 48`
- Card padding about 20-24px. Gap between cards about 16-24px. Table row height about 52-60px. Sidebar width about 200-230px at 1440-wide render (about 16% of width).

### Border radius [Approx.]
| Token | Value | Use |
|---|---|---|
| radius-pill | 999px | Tabs, status pills, avatars, search field edge on tabs |
| radius-sm | 8px | Icon tiles, small buttons, pagination buttons |
| radius-md | 12px | Inputs, buttons, nav active item |
| radius-lg | 16-20px | Cards, table container |
| radius-xl | 24px | Outer app frame / decorative panels |

### Shadows [Approx.]
- Cards: very soft, large blur, low opacity, purple-tinted: `0 8px 24px rgba(120, 70, 190, 0.08)`.
- Active nav and primary buttons: slightly stronger colored glow `0 6px 16px rgba(155, 89, 208, 0.30)`.
- No hard borders; borders are 1px hairline lavender in addition to the shadow. [Confirmed visually]

### Visual patterns [Confirmed]
- Glassmorphism-like translucent white cards over a soft gradient.
- Pill-shaped filter tabs with counts in parentheses.
- Tinted icon tile (rounded square) before stat numbers and table titles.
- Initial-letter avatars: colored circle with a tinted background and a darker letter (S purple, Sh pink, A orange).
- Decorative waves in corners.

---

## 3. Components

### 3.1 Buttons
| Variant | Observation | Source |
|---|---|---|
| Primary (gradient) | Purple to coral/orange gradient, white text, radius ~12px, glow shadow. Used for "New Request" (p3), "Submit Request" (p3), "Generate Summary" (p4, p5). | Confirmed |
| Primary (solid blue) | Solid blue with a plus icon "New Request" (p1 only). | Confirmed, conflicts with p3 |
| Secondary / outline | White bg, hairline border, dark text ("Cancel"). | Confirmed |
| Approve (table) | White bg, blue border/text with check icon (p2); green border/text with check icon (p3). | Confirmed, conflicts |
| Approve (detail page) | Solid green, white text, check icon. | Confirmed |
| Reject | White bg, red/pink border and text, X icon. | Confirmed |
| Icon button | Square rounded 8-10px with border, e.g. filter, kebab menu, back arrow, pagination. | Confirmed |

[Assumption] Final decision needed: see section 9 for chosen defaults.

### 3.2 Cards
- White translucent, radius-lg, soft shadow, hairline border.
- **Stat card**: icon tile left, large number, label. Optional corner tint swoosh. 4-up on dashboard, 3-up on approvals.
- **Content card**: title (h2) top-left, "View All" link top-right in primary purple.

### 3.3 Forms (Create Request)
- Labels bold, small, with a red asterisk for required fields.
- Inputs: white, hairline lavender border, radius ~10px, placeholder in grey, height ~40px.
- Textarea resizable (corner handle visible).
- Selects with chevron; Date field with calendar icon.
- Three fields in one row: Category, Priority, Target Date.
- Attachment dropzone: dashed border, cloud-upload icon, "Drag and drop files here, or browse", hint "PDF, DOC, XLS, PNG (Max 10 MB)".
- Right-hand "Request Guidelines" card with illustrated document icon and 4 check-marked tips.
- Actions bottom-right: Cancel (outline) + Submit Request (gradient).

### 3.4 Tables
- Container is a rounded card. Header row has a faint lavender tint, semibold text, sortable columns with small chevrons (p1).
- Row separators are hairlines. No zebra striping.
- Cells: ID in regular dark text; title in semibold with optional icon tile; avatar + name; pills; date; kebab at the end.
- Footer: "Showing X-Y of N requests" left, pagination right (prev, numbered pages, next; active page filled purple).
- Approvals table adds a checkbox column and an Actions column; title cell has a muted description line.

### 3.5 Navigation
**Sidebar** [Confirmed]
- Logo top (stacked).
- Items, in order: Dashboard, Requests (p1 labels it "Maintenance Requests"), Schedule, Approvals, Reports, Team, Settings. Outline icons, 20px, with label.
- Active item: filled pill with purple-to-coral gradient and white text/icon.
- Divider, then a "Team" (p4 labels it "Team Members") list with avatars and green presence dots.
- Decorative wave at the bottom.

**Top bar** [Confirmed]
- Left: page title and subtitle (and breadcrumb on form/detail screens: `Requests > New Request`, `Requests > REQ-0011`).
- Right: notification bell with red dot, avatar + name + chevron. Primary CTA sits on the right under the bell on the list screen.

**Tabs** [Confirmed]
- Pill tabs, active = filled purple with white text, inactive = white with hairline border. Counts in parentheses. Detail page tabs: Details, Activity, Approvals, Attachments.

### 3.6 Status indicators
- Pills as in 1.2. Text is sentence case, 12px, radius pill, no border, no icon.
- Detail page shows status pill near the title (top-right) and also in a side card.
- Presence: 8px green dot.
- Priority and status use different hue families to avoid confusion: priority = pink/amber/blue, status = amber/blue-or-purple/green.

### 3.7 Charts [Confirmed]
- **Donut** (Requests by Status): thick ring, center number + "Requests", legend on the right with dot, label, count. Colors: purple, pink, orange (see mismatch note in section 9).
- **Line/area** (Requests Over Time): smooth purple line with hollow circle markers, soft purple gradient fill, light horizontal gridlines, y axis 0-8, x axis dates every 2 days.
- **Horizontal bars** (Requests by Category): rounded bars in purple, pink, orange, light lavender with icon + label left and number right.
- **Schedule list**: colored dot (p4) or vertical colored bar (p5) per item, title, date/time, chevron.

### 3.8 Icons [Confirmed]
Single consistent outline style, rounded stroke ~1.5-2px, about 20px, e.g. Lucide/Feather/Phosphor-like. [Assumption] Lucide for implementation. Icons used: home, file-text, calendar, check-circle, bar-chart, users, settings, bell, search, filter, plus, chevron, more-vertical, hourglass, refresh, upload-cloud, sparkles, arrow-left, laptop, snowflake, wifi, chair, lightbulb, wrench, monitor, network.

---

## 4. Design tokens (proposed names; values flagged)

```
color.brand.primary          ≈ #8E4FD0   [Approx.]
color.brand.deep             ≈ #2E1A5E   [Approx.]
color.brand.magenta          ≈ #B04FC8   [Approx.]
color.brand.coral            ≈ #F0645A   [Approx.]
color.brand.peach            ≈ #FDA070   [Approx.]
gradient.brand               primary → magenta → coral → peach  [Confirmed in kind]
gradient.nav-active          primary → coral                      [Confirmed in kind]
color.text.default           ≈ #2B2350   [Approx.]
color.text.muted             ≈ #6B6585   [Approx.]
color.border.default         ≈ #E6DDF3   [Approx.]
color.surface.card           white @ 70-90%
color.status.pending|progress|completed|rejected  → see 1.2
color.priority.high|medium|low                    → see 1.2
radius.sm 8 · md 12 · lg 16-20 · pill 999
shadow.card  0 8px 24px rgba(120,70,190,.08)
shadow.cta   0 6px 16px rgba(155,89,208,.30)
font.latin   Plus Jakarta Sans [Assumption]
font.arabic  IBM Plex Sans Arabic or Tajawal [Assumption]
```

Action required before implementation: sample the real hex values from the original logo and design source files.

---

## 5. Responsive design

The reference only shows desktop (~1440px). Everything below is **[Assumption]** and keeps the same visual language.

### Breakpoints
- Desktop ≥ 1200px: as in reference.
- Tablet 768-1199px.
- Mobile < 768px.

### Tablet
- Sidebar collapses to an **icon-only rail** (~72px). The active item keeps its gradient pill; the logo becomes the icon-only mark (a lockup already defined in the logo sheet). The Team list collapses to avatars with dots, or moves into a Team page.
- KPI cards: 4-up becomes 2x2. Approvals KPI: 3-up stays or becomes 3 compact.
- Dashboard 2-column cards stack to 1 column when width is too small; charts keep their ratio.
- Tables keep columns but hide low-priority ones (Category, Assigned to, Created) behind the row kebab or a detail view. Horizontal scroll is acceptable as a fallback.
- Create Request: guidelines card moves below the form or collapses into an accordion.

### Mobile
- Sidebar becomes a **slide-in drawer** from a hamburger in the top bar; bottom navigation optional for the 4-5 most used destinations (Dashboard, Requests, Approvals, Schedule, More). [Assumption]
- Top bar: icon-only mark, bell, avatar. Page title below.
- Primary CTA "New Request" becomes a full-width button or a floating action button using the brand gradient.
- Tabs become a horizontally scrollable pill row.
- Search collapses to an icon that expands, filter opens in a bottom sheet.
- **Tables convert to stacked cards**: ID + title + status pill on the first line, secondary info (requester, priority, date) below, actions (Approve/Reject) as full-width buttons at the card bottom.
- KPI cards: 2-up grid or horizontal scroll; charts full width, legend moved below the donut.
- Form fields stack to a single column; the dropzone stays dashed; Submit and Cancel are sticky at the bottom.
- Request Details: side cards (Requested by, Status, Created on) move under the main info; Approve/Reject become a sticky footer.

### Preserved on all sizes
Gradient wash background, translucent rounded cards, pill tabs and chips, tinted icon tiles, brand gradient CTA, logo clear space, and RTL support (Arabic wordmark means the UI is likely bilingual). [Assumption] Use logical CSS properties (`margin-inline-start`, etc.) so mirroring for Arabic is possible; the reference shows no RTL screen, so that layout needs design confirmation.

---

## 6. Accessibility notes [Assumption / to verify]
- White text on the lighter peach end of the gradient may fall below 4.5:1 contrast; verify with a contrast checker and use darker gradient stops for text-bearing buttons.
- Pill text on tinted backgrounds looks sufficient but must be checked.
- Status should not rely on color alone: keep the text label (already present).
- Full WCAG compliance needs manual testing with assistive technologies.

---

## 7. Decisions needed from the design owner (see also screen specs)
1. Primary CTA: blue solid (p1) or brand gradient (p3)?
2. In Progress status: blue (p1) or purple (p3/p4)?
3. Approve button: blue, green outline, or solid green?
4. Arabic line under the logo in the app sidebar: always, or only on some screens?
5. Font family confirmation.
6. Exact hex values from source files.
