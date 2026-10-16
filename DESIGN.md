# Echo design

Echo is a French (and Portuguese, Swedish) practice app. One learner uses it, mostly on an iPhone as a
home-screen app, sometimes on a Mac. Sessions are short and often hands-busy: a card, a clip, a question.
The look serves that: calm, steady, readable at arm's length.

Read this before changing anything in `static/app.css` or the markup `static/app.js` renders.
Run the scale check after every CSS change; it must report zero:

```sh
bun ~/.omp/agent/skills/design-pass/scripts/design-lint.ts check DESIGN.md
```

## Taste

Each line is a choice already made in this app and kept. Follow these before any general design advice;
when a request contradicts one, say so and ask.

1. **Nothing moves when state changes.** A turned card keeps the word where it was; tabs keep their place
   in every room; buttons stay put when a verdict appears. Reserve the space for what will appear.
2. **No instruction text.** No hint lines under headings, no "tap here to…". A screen explains itself by
   its layout; the long explanation lives behind ⓘ and in How it works.
3. **Quiet by default.** Secondary information is a small muted line, not a box. One big figure, the rest
   in a quiet line under it.
4. **Dusk has no outlines.** Surfaces stand apart by shade; dividers are faint. An edge appears only where
   it says something: a text field, a word scoring below 0, a choice made, a verdict. Paper keeps its
   hairlines and warm fills.
5. **The language being learnt is in the serif** (`--serif`, New York on Apple devices) wherever it appears;
   the app's own words stay in the system font.
6. **Section names are plain words**: sentence case, 17px semibold in the text colour — not small grey
   uppercase kickers. Room tabs are words on a hairline, the open one underlined in violet.
7. **Colour means something.** Violet is the accent and the one call to action. Green, violet and peach are
   solid, getting there and shaky progress. `--danger` is only a wrong answer. Masculine and feminine have
   their own blue and pink. No decorative colour.
8. **Every room is one tap from Home.** Home was meant to fit one phone screen. Today it is about two
   screens tall at 390×844; either drop that aim or move Hands-free and Study off Home.
9. **Taps land at once.** 44px minimum targets, no double-tap zoom, a pressed state on anything tappable.

## References

When a choice is not covered above, decide by these, in order:

1. **Apple's iOS type ramp and Human Interface Guidelines.** Echo lives on an iPhone home screen and should
   feel native there; the type scale below follows the iOS ramp (15 subhead, 17 headline, 28/34 titles).
2. **The current Dusk palette** ("Night look"): retune colour tokens only in a change about colour.
3. **Direction:** not chosen yet. Record the pick from the next design pass here.

## Tokens

Colour: only the custom properties in the theme blocks at the top of `static/app.css`. A new colour is a new
token — in both themes, or in Dusk's block when only a Dusk rule uses it — never a literal in a rule.
Transparent tints of a token are `color-mix(in srgb, var(--token) N%, transparent)`.

Type (`font-size: var(--fs-*)`):

| Token | px | Use |
|---|---|---|
| `--fs-2xs` | 12 | level tags, counts, kickers |
| `--fs-xs` | 13 | captions, secondary lines in rows |
| `--fs-sm` | 14 | quiet buttons, back links, row subtitles |
| `--fs-md` | 15 | body inside cards, buttons, tabs |
| `--fs-base` | 16 | page body, inputs (never smaller on an input: iOS zooms) |
| `--fs-lg` | 17 | section names, row titles |
| `--fs-xl` | 19 | reading text, lyrics, card translations |
| `--fs-2xl` | 21 | word-list words, written answers |
| `--fs-3xl` | 24 | card answers, section headings |
| `--fs-4xl` | 28 | room titles |
| `--fs-5xl` | 34 | the Home title |

Sizes of 36px and up (the word on a card, big symbols) are display sizes: literal or `clamp()`.
Weights: 400 body, 500 the word being learnt, 550 emphasis in rows, 600 headings and primary buttons,
650 page titles.

Radius (`border-radius: var(--r-*)`): `--r-xs` 8 · `--r-sm` 10 · `--r-md` 12 · `--r-lg` 14 · `--r-xl` 16
(board tiles) · `--r-2xl` 20 (tiles, dialogs) · `--r-3xl` 24 (bars) · `--r-4xl` 28 (the study card) ·
`--r-pill`. Radii of 6px or less (bars, progress, tags) stay literal.

Spacing (padding, margin, gap): literal px on a 2px grid up to 24px, a 4px grid above. Negative margins and
1–3px optical nudges are exempt.

```json design-scale
{
  "css": ["static/app.css"],
  "fontSize": { "--fs-2xs": 12, "--fs-xs": 13, "--fs-sm": 14, "--fs-md": 15, "--fs-base": 16, "--fs-lg": 17, "--fs-xl": 19, "--fs-2xl": 21, "--fs-3xl": 24, "--fs-4xl": 28, "--fs-5xl": 34 },
  "fontSizeLiteralMin": 36,
  "radius": { "--r-xs": 8, "--r-sm": 10, "--r-md": 12, "--r-lg": 14, "--r-xl": 16, "--r-2xl": 20, "--r-3xl": 24, "--r-4xl": 28, "--r-pill": 999 },
  "radiusLiteralMax": 6,
  "spacing": { "step": 2, "largeStep": 4, "largeFrom": 24, "literalMax": 3 }
}
```

## Decisions

Newest first. One line each: what was picked, over what, and why.

- Type, radius and spacing scales introduced; every literal snapped to the nearest step, ties upward.
  Dusk's literal colours became Dusk tokens.
- Night look: darker neutral Dusk without outlines, the learnt language in the serif, section names in
  plain words, tabs as words.
- Words and News: steady tabs, the word stays put on a turned card, quieter rows, no instruction text.
