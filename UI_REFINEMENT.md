# ZeroNine UI refinement

The existing navigation, brand palette, trading charts, dashboard sections, and execution workflows are preserved.

## Shared system

`web/src/refinement.css` provides shared spacing, control heights, control radii, typography, gutters, focus, and transition tokens. Existing primary, secondary, success, and danger colors remain in the base stylesheet. This layer normalizes existing controls without replacing their event handlers or adding nested panels.

## Connection / landing experience

The existing Account connection experience retains its two-column desktop composition. Token fields now have visible labels, consistent heights, improved focus treatment, and readable supporting text. The logo no longer continuously animates. No unsupported marketing claims or testimonials were added.

## Dashboard and secondary screens

Desktop navigation has consistent control sizing and an accessible current-page marker. Metrics use tabular numerals, empty and error states have a shared reading rhythm, and activity rows have restrained hover feedback. Legal links keep their separate row below the Home ticker. Chart data, indicators, price scales, execution gates, and placement are unchanged.

## Workflow and accessibility

The Lab remembers its selected research tab using validated, optional browser storage. Storage failure does not prevent navigation. Trade and virtual-paper detail dialogs contain keyboard focus and return it to the opener. Escape behavior is retained. Shared focus styles cover summary controls as well as buttons and fields. Reduced-motion preferences disable the new transitions.

## Responsive behavior

Mobile form controls use a 44px height and 16px input text for the normalized field classes. Navigation remains in the existing bottom bar. The Lab configuration grid now allows columns to shrink and labels to wrap, fixing actual overflow at 320px. Compact tabs scroll within their own container.

## Verification and limits

Playwright covers guest routes at 320, 375, 390, 768, 1024, and 1440px, plus visible token labels, current navigation state, ticker/footer separation, and saved Lab selection. API responses are stubbed; these checks do not certify authenticated trading or every populated panel. A desktop connection screenshot was visually reviewed. Frontend typecheck and production build were run. This is a shared UI refinement, not a complete WCAG certification or an end-to-end review of live trading.

## Main before / after issues

- Inconsistent shared field and button dimensions → common size and spacing tokens.
- Hidden token labels → visible persistent labels.
- Missing current-page semantics → desktop navigation announces the current page.
- Lab choices widened small screens → shrinkable columns and wrapping choices.
- Lab reset its view on return → validated saved browser preference.
- Detail dialogs allowed focus outside → contained focus and restored opener.

## Important files

- `web/src/refinement.css`: shared visual system.
- `web/src/App.tsx`: navigation, form labels, preferences, dialog wiring.
- `web/src/useDialogFocus.ts`: reusable keyboard focus behavior.
- `web/src/main.tsx`: refinement stylesheet import.
- `tests/e2e/refinement.spec.ts`: browser regression checks.
- `web/dist/`: production bundle.
