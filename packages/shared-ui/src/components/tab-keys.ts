/**
 * Keyboard model of a tab list (WAI-ARIA tabs, manual activation): Left/Right
 * (and Up/Down) move focus to the previous/next tab with wrap-around, Home/End
 * to the first/last. Returns the index to focus, or null when the key is not a
 * tab-list key. Activation (Enter/Space) follows the focused tab's link.
 */
export function nextTabIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
