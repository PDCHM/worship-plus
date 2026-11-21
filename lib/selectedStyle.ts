// App-wide purple system (replaces the old heavy dark indigo).
// TIER 1 — selected / active states & tints: pale lavender.
//   light: bg #efe9fe · text/icon #6350ef · hairline ring #e0d6fb
//   dark:  bg #2a2440 · text/icon #b3a3ff · hairline ring #3a3358
//   (#6350ef rather than #6d5bf0: the lightest same-hue purple that keeps small
//    text at WCAG AA 4.5:1 on the lavender — #6d5bf0 was 4.03:1.)
// TIER 2 — primary action buttons: solid #735fee (hover #6650e6) with WHITE
//   text, 4.56:1 — the lightest same-hue purple that passes AA for white text
//   (#8574f0 would be 3.65:1). Used inline as bg-[#735fee] hover:bg-[#6650e6].
// Rings are inset so turning a control on never changes its size.

export const SELECTED =
  "bg-[#efe9fe] text-[#6350ef] ring-1 ring-inset ring-[#e0d6fb] dark:bg-[#2a2440] dark:text-[#b3a3ff] dark:ring-[#3a3358]";

// For controls that sit on an always-dark surface (the presentation-mode
// bottom bar), where the light lavender would glare.
export const SELECTED_ON_DARK =
  "bg-[#b3a3ff]/20 text-[#d9d0ff] ring-1 ring-inset ring-[#b3a3ff]/40";

// On/off switch track when ON. A white knob needs a mid-tone track to stay
// visible, so this is a softer brand purple rather than the pale lavender.
export const SWITCH_ON = "bg-[#9d8bff] dark:bg-[#7d6cf5]";
