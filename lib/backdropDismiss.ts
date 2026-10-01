import type React from "react";

// Click-outside-to-close for modal backdrops — but ONLY for a real tap/click on
// the backdrop itself.
//
// A plain `onClick={onClose}` on the backdrop is not enough: when a press and
// its release land on different elements, the browser dispatches `click` to
// their nearest COMMON ANCESTOR. So pressing inside the dialog (e.g. drag-
// selecting text in an input), drifting a few pixels past the panel's edge and
// releasing over the dim backdrop fires the backdrop's click — with
// target === backdrop, so the panel's stopPropagation never sees it — and the
// dialog closes mid-edit.
//
// Spread these props on the backdrop element instead: the press must START on
// the backdrop (recorded on pointerdown — mouse, touch and pen alike) and the
// click must land on it too. Stateless (kept on the element's dataset), so it
// works in any component without a hook.
export function backdropDismiss(onClose: () => void): {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onClick: (e: React.MouseEvent<HTMLElement>) => void;
} {
  return {
    onPointerDown: (e) => {
      e.currentTarget.dataset.backdropPress = e.target === e.currentTarget ? "1" : "";
    },
    onClick: (e) => {
      const pressedHere = e.currentTarget.dataset.backdropPress === "1";
      e.currentTarget.dataset.backdropPress = "";
      if (pressedHere && e.target === e.currentTarget) onClose();
    },
  };
}
