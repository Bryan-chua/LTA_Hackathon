# Smart Commuter Companion - Design Specification

## 1. Design direction

The Smart Commuter Companion uses an **LTA-inspired light theme** adapted for a commuter-facing mobile web application.

The visual language takes cues from the [official Land Transport Authority website](https://www.lta.gov.sg/content/ltagov/en.html):

- bright white and light-grey surfaces;
- blue and teal as the primary identity colours;
- red and yellow for important public advisories;
- strong black typography;
- colourful category accents;
- clear government-service information hierarchy;
- direct, functional language.

This is an original product design, not a reproduction of the LTA website. The website's visual cues are simplified and adapted for a mobile journey-planning experience.

## 2. Design goals

The interface should help Rachel understand what to do within five seconds.

The experience must be:

1. **Decision-first** - lead with the recommended action, not the incident details.
2. **Quiet by default** - normal days should feel calm; disruption states should attract attention.
3. **Mobile-first** - designed for one hand, a moving train and a small screen.
4. **Readable outdoors** - use a light theme, high contrast and strong text hierarchy.
5. **Trustworthy** - show sources, timestamps, uncertainty and whether data is live or replayed.
6. **Accessible** - never depend on colour alone to communicate meaning.
7. **Resilient** - keep the active journey readable when connectivity is lost underground.

## 3. Theme recommendation

Use the light theme as the default and hackathon MVP theme.

Reasons:

- The official LTA website is predominantly light and spacious.
- Maps and route overlays are easier to read against a pale base.
- Dark text on white performs well in bright outdoor conditions.
- Yellow advisories and LTA-inspired blue/teal accents remain visually distinctive.
- It avoids the visual heaviness of a dark disruption dashboard.

A dark theme can be considered after the MVP, but it should not delay the main experience.

## 4. Product identity

### Working product name

**Smart Commute**

Supporting label:

> Land Transport Authority

During the hackathon, use a small qualifier such as `Hackathon concept` where necessary. Do not imply that the prototype is an official production LTA service.

### Brand mark

Use an original route-inspired mark:

- a short line connecting two circular station nodes;
- teal for the first section;
- blue for the second section;
- a small red terminal accent if needed;
- simple enough to remain recognisable at 32-40 pixels.

Do not copy, trace or modify the official LTA logo unless the organisers explicitly provide permission and brand assets.

## 5. Colour system

These are starting values for the prototype. Verify all final text/background combinations against WCAG contrast requirements.

| Token | Value | Use |
|---|---:|---|
| `--color-background` | `#F4F5F7` | Main application background |
| `--color-surface` | `#FFFFFF` | Cards, navigation and header surfaces |
| `--color-surface-soft` | `#EDF7F6` | Quiet teal-tinted status surfaces |
| `--color-text` | `#171A1D` | Primary text |
| `--color-text-muted` | `#59636C` | Secondary text and timestamps |
| `--color-border` | `#D9DEE3` | Dividers and card boundaries |
| `--color-teal` | `#008B95` | Route alternative, positive identity accent |
| `--color-blue` | `#254A91` | Primary action, navigation and route identity |
| `--color-red` | `#CB3B46` | Disrupted route segment and critical state |
| `--color-yellow` | `#FFEB21` | High-attention advisory strip |
| `--color-yellow-soft` | `#FFF8C7` | Lower-intensity advisory background |
| `--color-orange` | `#DF6F2D` | Moderate crowding and caution |
| `--color-green` | `#187B5A` | On-time and successful state |
| `--color-map` | `#E9EEF1` | Simplified map base |
| `--color-map-road` | `#D2DADE` | Low-emphasis map roads and paths |

### Semantic mappings

- **Primary action:** blue background with white text.
- **Recommended route:** teal line and teal top/left border.
- **Original route:** blue line.
- **Affected route portion:** red line with an alert icon or dashed pattern.
- **Major advisory:** yellow strip plus alert icon and text.
- **On time:** green icon plus `On time` text.
- **Moderate crowding:** orange people icon plus `Moderate` text.
- **High crowding:** red people icon plus `High` text.
- **Offline/stale:** teal or neutral information treatment, not red unless the route is unusable.

Colour must always be paired with text, icons, line style or another non-colour indicator.

## 6. Typography

### Recommended fonts

- **Interface:** Arial, Helvetica or a system sans-serif stack.
- **Product wordmark only:** Georgia or another restrained serif can echo the official site's editorial identity.

Avoid downloading a custom font for the MVP unless licensing and performance are clear.

### Type scale

| Style | Suggested size | Weight | Use |
|---|---:|---:|---|
| Page title | 24 px | 500-600 | `Good morning, Rachel` |
| Decision title | 22 px | 500-600 | Recommended action |
| Section title | 16 px | 500-600 | Route overview, journey steps |
| Body | 14-16 px | 400 | Explanations and instructions |
| Supporting text | 12-13 px | 400 | Metadata and trade-offs |
| Eyebrow/label | 11-12 px | 500-600 | Date and state labels |

Use tabular numerals for ETAs, departure times and duration comparisons.

Do not use essential text smaller than 12 px. Body copy should generally remain at least 14 px, and form inputs at least 16 px to avoid mobile browser zoom.

## 7. Shape, spacing and elevation

### Corner radius

- Default card radius: `14px`.
- Buttons: `11px`.
- Phone preview frame only: `26px`.
- Avoid excessive pill shapes; the LTA-inspired direction should feel structured rather than playful.

### Spacing scale

Use a 4 px base grid:

```text
4, 8, 12, 16, 20, 24, 32
```

Recommended mobile page padding: `16px`.

### Elevation

Use shadows sparingly:

```css
box-shadow: 0 4px 12px rgba(24, 38, 48, 0.06);
```

Borders and whitespace should provide most of the separation. Avoid stacked floating cards and strong shadows.

## 8. Application shell

### Government identity strip

A compact strip may appear at the top:

> A Singapore Government Agency Website

Design:

- light-grey background;
- small shield/check icon;
- approximately 10-12 px text;
- maximum height around 28 px.

For the hackathon prototype, this helps communicate the design direction. For a production app, confirm whether this strip and its wording are permitted and necessary.

### Brand header

The header contains:

- the original Smart Commute route mark;
- `JourneySense` product name;
- a small `Land Transport Authority` or `Hackathon concept` label;
- Rachel's profile/avatar control.

Keep it compact. The recommendation must receive more screen space than the brand.

### Advisory strip

The disruption advisory sits directly below the header.

Example:

> EWL service disruption affects your journey - Updated 7:30

Use:

- strong yellow for an active material disruption;
- soft yellow for a planned or lower-severity advisory;
- an alert icon;
- plain language;
- a freshness timestamp.

Do not show the strip on a normal day unless there is useful information.

### Bottom navigation

Use three destinations:

1. **Today**
2. **Compare**
3. **Journey**

Each navigation item has an icon and visible text label. The selected item uses a pale-blue background and blue icon/text.

## 9. Core screens

## 9.1 Today

Purpose: answer `Do I need to change my commute today?`

Content order:

1. Date and greeting.
2. Recommended action card.
3. Expected arrival and deadline state.
4. Primary `Use this route` action.
5. Route overview map.
6. Short trade-off summary.
7. `Compare both routes` action.

### Recommendation card

Example:

> **Leave by 7:35 and take the Downtown Line**
>
> This avoids the affected EWL section and gives you a safer arrival before your 8:45 deadline.

Design:

- white surface;
- thin neutral border;
- teal left border;
- small red `Recommended change` label with a route icon;
- prominent action sentence;
- short reason;
- expected arrival in large tabular numerals;
- explicit `On time` state;
- full-width blue primary button.

### Normal-day state

When no meaningful action is needed, replace the disruption recommendation with a calm summary:

> **Your usual route is on track**
>
> Leave around 7:40. Expected arrival 8:38-8:43.

Do not show unnecessary warnings or force Rachel to compare routes.

## 9.2 Compare

Purpose: show why the recommended alternative is preferable.

Display no more than two or three meaningful options.

### Recommended option

- teal top border;
- `Recommended` label;
- route name;
- expected arrival;
- concise reason;
- walking time;
- transfer count;
- crowding level;
- primary selection action.

### Usual affected option

- red top border;
- `Usual route - affected` label;
- arrival range rather than one confident time;
- expected delay range;
- walking, transfers and crowding.

The comparison should be readable without opening the map.

## 9.3 Journey

Purpose: guide Rachel after she accepts a route.

Content order:

1. Current arrival estimate.
2. Immediate next action.
3. Short instruction.
4. Journey progress.
5. `Open step-by-step map` action.
6. Offline/freshness state.
7. Remaining journey timeline.

Example next action:

> **Walk to Tampines MRT**
>
> Enter via Exit B, then follow signs for the Downtown Line towards Bukit Panjang.

Only the next action should dominate. Later steps should use a compact timeline.

## 10. Map and route visualisation

Use OpenStreetMap as the geospatial base and display:

> © OpenStreetMap contributors

### Visual hierarchy

- Streets and nonessential geography: low-contrast grey.
- Original route: blue.
- Affected segment: red plus warning icon and alternate line style.
- Recommended alternative: teal.
- Start and destination: circular markers with visible outlines.
- Current step: stronger marker and label.

The map should not compete with the recommendation. On the Today screen, use a compact overview. The dedicated journey map can occupy more of the screen.

Never rely on red versus teal alone. Use labels, icons, line patterns and an accessible text summary.

## 11. Components

The initial component set should include:

```text
AppShell
GovernmentBanner
BrandHeader
AdvisoryStrip
RecommendationCard
ArrivalEstimate
PrimaryButton
SecondaryButton
RouteMap
RouteLegend
CrowdingIndicator
RouteOptionCard
TradeOffList
JourneyProgress
JourneyTimeline
OfflineStatus
DataFreshnessLabel
BottomNavigation
```

### Button rules

- Minimum target: `44 x 44px`; prefer `48px` height for major actions.
- One primary action per section.
- Primary: blue background, white text.
- Secondary: white background, blue border and text.
- Use visible labels; avoid unexplained icon-only buttons.
- Disabled controls must remain readable and must not rely on opacity alone.

### Status labels

Avoid a page full of badges. Use small labels only for meaningful states:

- Live
- Forecast
- Replay scenario
- Offline
- Updated 7:30
- Recommended

`Replay scenario` must be especially clear during the hackathon demo.

## 12. Interaction behaviour

### Choosing a route

1. Rachel taps `Use this route`.
2. The selected option becomes the active journey.
3. The app opens the Journey screen.
4. The active journey is cached for offline use.
5. A brief confirmation appears without blocking navigation.

### Comparing routes

1. Rachel taps `Compare both routes`.
2. The Compare screen opens at the top.
3. The recommended route appears first.
4. Differences are shown in the same order for both routes.

### Data freshness

Show the last update time next to the relevant status. If the data becomes stale:

- change the label to `Last updated 7:32`;
- show `Offline` or `Unable to refresh`;
- retain the cached route;
- avoid presenting stale conditions as live.

### Motion

Use short, functional transitions only:

- route selection;
- expanding details;
- changing between original and alternative routes.

Respect `prefers-reduced-motion`. Avoid looping animations, decorative movement and map motion that interferes with reading.

## 13. Responsive behaviour

Design mobile-first at approximately `390px` wide, but support screens down to `320px`.

### Mobile

- one-column layout;
- 16 px horizontal padding;
- full-width primary actions;
- compact map overview;
- persistent or easily reachable bottom navigation;
- no horizontal scrolling.

### Tablet and desktop

- preserve the same information hierarchy;
- allow the map and recommendation details to sit side by side when space permits;
- set a readable maximum content width;
- do not turn the commuter app into an operator dashboard.

Use dynamic viewport units carefully. Test browser chrome expansion, safe areas and the soft keyboard on real devices.

## 14. Accessibility requirements

- Meet WCAG 2.1 AA contrast at minimum.
- Never communicate disruption, recommendation or crowding using colour alone.
- Provide text alternatives for map state and route changes.
- Use semantic headings in order.
- Give every control an accessible name.
- Keep keyboard focus indicators visible.
- Maintain native tab order.
- Support browser text zoom and large text without clipping.
- Touch targets should be at least 44 px in both dimensions.
- Body text should generally be at least 14 px.
- Do not place essential information only inside hover tooltips.
- Announce meaningful live updates with a polite live region; do not announce continuous map movement.
- Use `role="alert"` only for immediate, important changes.
- Test with screen readers and reduced-motion settings.

## 15. Content style

### Voice

- calm;
- direct;
- specific;
- nontechnical;
- action-oriented.

### Preferred language

Use:

> Leave by 7:35 and take the Downtown Line.

Instead of:

> An alternative multimodal itinerary has been identified.

Use:

> EWL disruption affects your usual route.

Instead of:

> Train service status: disrupted.

Use exact times, place names and expected trade-offs. Explain why the recommendation changed.

### Time and uncertainty

- Prefer `8:42` for a clear estimate.
- Use `8:38-8:46` when uncertainty matters.
- Pair a range with a short explanation such as `Possible 14-22 min delay`.
- Do not imply statistical confidence unless the estimate has been validated.

## 16. Privacy and trust cues

The app should explain:

- what journey/routine information is saved;
- whether location is currently being used;
- how to clear saved data;
- when information was last refreshed;
- whether a disruption is live, forecast or replayed;
- whether the active journey is available offline.

Avoid continuously visible privacy warnings. Present concise status in context and provide a dedicated settings/details area.

## 17. Implementation guidance

Recommended frontend choices:

- TypeScript and React/Next.js;
- CSS custom properties for tokens;
- accessible headless component primitives where useful;
- MapLibre GL JS for maps;
- Lucide or a similarly consistent icon set;
- Progressive Web App service worker and IndexedDB for active-journey caching.

Suggested token structure:

```css
:root {
  --color-background: #f4f5f7;
  --color-surface: #ffffff;
  --color-surface-soft: #edf7f6;
  --color-text: #171a1d;
  --color-text-muted: #59636c;
  --color-border: #d9dee3;
  --color-teal: #008b95;
  --color-blue: #254a91;
  --color-red: #cb3b46;
  --color-yellow: #ffeb21;
  --color-orange: #df6f2d;
  --color-green: #187b5a;

  --radius-card: 14px;
  --radius-control: 11px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
}
```

Create semantic aliases in the implementation instead of scattering raw colours:

```css
:root {
  --action-primary: var(--color-blue);
  --route-recommended: var(--color-teal);
  --route-normal: var(--color-blue);
  --route-affected: var(--color-red);
  --status-warning: var(--color-yellow);
  --status-success: var(--color-green);
}
```

## 18. Design states to implement

The MVP should cover these states deliberately:

### Today screen

- normal day;
- material disruption;
- planned event tomorrow;
- heavy rain affects walking;
- route data loading;
- route provider unavailable;
- offline with cached journey;
- no saved routine.

### Comparison screen

- recommended alternative;
- original route affected;
- no viable alternative;
- alternatives have similar scores;
- missing crowding data.

### Journey screen

- before departure;
- active walking leg;
- active rail leg;
- transfer step;
- route updated during travel;
- offline/stale;
- destination reached.

## 19. Real-device test checklist

- Test at 320 px, 360 px and 390 px widths.
- Test iOS Safari and Android Chrome where available.
- Confirm no horizontal scrolling.
- Confirm primary actions are reachable with one thumb.
- Test with the browser address bar expanded and collapsed.
- Test 200% text zoom.
- Test screen reader labels and heading order.
- Test light-theme contrast outdoors or at maximum screen brightness.
- Test slow network, offline state and reconnect.
- Confirm timestamps and replay/live labels remain visible.
- Confirm OSM attribution is always present on maps.

## 20. Acceptance criteria

The current design direction is ready for implementation when:

- Rachel can identify the recommended action within five seconds.
- The action, reason and arrival outcome appear without scrolling on a typical phone.
- The affected route portion and alternative are visually distinguishable without relying on colour alone.
- The original and recommended routes can be compared using arrival time, walking, transfers and crowding.
- The app clearly distinguishes live, forecast, replay and offline information.
- All interactive targets meet the minimum touch size.
- The layout works at 320 px without clipping or horizontal scrolling.
- A real-device accessibility check finds no blocking issue.
- The government-inspired identity does not overpower the commuter decision.
- The design does not use the official LTA logo without permission.

## 21. Current mockup summary

The approved direction currently contains:

- a compact Singapore Government identity strip;
- an original Smart Commute route mark;
- a white LTA-inspired brand header;
- a yellow EWL disruption advisory;
- a decision-first recommendation card;
- blue primary actions;
- teal recommended-route styling;
- red affected-route styling;
- a light OSM route overview;
- Today, Compare and Journey screens;
- offline journey messaging;
- a compact three-item bottom navigation.

The next design step should be to create the remaining normal-day, loading, replay and offline variants using the same component system before high-fidelity frontend implementation begins.
