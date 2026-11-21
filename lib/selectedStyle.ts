// Shared "selected / active" look for toggles and segmented controls in the song
// editor: light lavender instead of the old solid dark indigo, which was too heavy
// on screen. Matches the Edit toolbar button's active circle.
//   light: bg #efe9fe · text/icon #6d5bf0 · hairline ring #e0d6fb
//   dark:  bg #2a2440 · text/icon #b3a3ff · hairline ring #3a3358
// The ring is inset so turning a control on never changes its size.

export const SELECTED =
  "bg-[#efe9fe] text-[#6d5bf0] ring-1 ring-inset ring-[#e0d6fb] dark:bg-[#2a2440] dark:text-[#b3a3ff] dark:ring-[#3a3358]";

// For controls that sit on an always-dark surface (the presentation-mode
// bottom bar), where the light lavender would glare.
export const SELECTED_ON_DARK =
  "bg-[#b3a3ff]/20 text-[#d9d0ff] ring-1 ring-inset ring-[#b3a3ff]/40";

// On/off switch track when ON. A white knob needs a mid-tone track to stay
// visible, so this is a softer brand purple rather than the pale lavender.
export const SWITCH_ON = "bg-[#9d8bff] dark:bg-[#7d6cf5]";
