// src/lib/ui/popover-place.js
//
// Pure placement math for Popover. Extracted so the two desktop bugs this
// solves stay locked by unit tests:
//   1. a panel measured before its content/fonts settle must re-place
//      correctly on re-run (the caller re-invokes on panel resize);
//   2. a panel taller than the available space is CAPPED (maxHeight +
//      internal scroll) instead of being clamped upward over app chrome.
//
// anchor/panel are rect-like ({top,bottom,left,right,width,height} — panel
// needs width/height only); viewport is {width,height}.

export function placePopover({
  anchor,
  panel,
  placement,
  viewport,
  margin = 8,
  gap = 6,
  minHeight = 160,
}) {
  const spaceAbove = anchor.top - gap - margin;
  const spaceBelow = viewport.height - (anchor.bottom + gap) - margin;

  let side = placement.startsWith("top") ? "top" : "bottom";
  const align = placement.endsWith("-end") ? "end" : "start";

  // Flip when the chosen side can't fit a useful panel and the other side
  // has more room. Uses the side's available space, not the panel height,
  // so a temporarily-mismeasured panel can't force a flip flap.
  const chosen = side === "top" ? spaceAbove : spaceBelow;
  const other = side === "top" ? spaceBelow : spaceAbove;
  if (chosen < Math.min(minHeight, panel.height) && other > chosen) {
    side = side === "top" ? "bottom" : "top";
  }

  const maxHeight = Math.max(0, side === "top" ? spaceAbove : spaceBelow);
  const effHeight = Math.min(panel.height, maxHeight);

  let top;
  if (side === "top") {
    top = anchor.top - gap - effHeight;
  } else {
    top = anchor.bottom + gap;
  }

  let left = align === "end" ? anchor.right - panel.width : anchor.left;
  left = Math.max(margin, Math.min(left, viewport.width - panel.width - margin));
  top = Math.max(margin, top);

  return { top, left, maxHeight };
}
