/**
 * Client-side sorting for artwork grids
 */

/**
 * Parse date strings into comparable numbers
 * Handles: "1423", "c. 1427", "1334–1343", "1440s", etc.
 * Returns Infinity for unparseable dates (sorts last)
 */
function parseDate(dateStr) {
  if (!dateStr) return Infinity;

  // Remove "c.", "ca.", "circa" prefix
  const cleaned = dateStr.replace(/^(c\.|ca\.|circa)\s*/i, '').trim();

  // Match first 4-digit year
  const match = cleaned.match(/\d{4}/);
  if (match) {
    return parseInt(match[0], 10);
  }

  // Handle decade format like "1440s"
  const decadeMatch = cleaned.match(/(\d{3})0s/);
  if (decadeMatch) {
    return parseInt(decadeMatch[1] + '0', 10);
  }

  return Infinity;
}

/**
 * Sort artwork cards within a grid
 */
function sortArtworks(grid, sortBy) {
  const cards = Array.from(grid.querySelectorAll('.artwork-card'));

  cards.sort((a, b) => {
    let aVal, bVal;

    switch (sortBy) {
      case 'date':
        aVal = parseDate(a.dataset.date);
        bVal = parseDate(b.dataset.date);
        return aVal - bVal;

      case 'title':
        aVal = (a.dataset.title || '').toLowerCase();
        bVal = (b.dataset.title || '').toLowerCase();
        return aVal.localeCompare(bVal);

      case 'artist':
        aVal = (a.dataset.artist || '').toLowerCase();
        bVal = (b.dataset.artist || '').toLowerCase();
        return aVal.localeCompare(bVal);

      default:
        return 0;
    }
  });

  // Re-append cards in sorted order
  cards.forEach(card => grid.appendChild(card));
}

/**
 * Initialize sorting controls
 */
function initSorting() {
  const controls = document.querySelector('.sort-controls');
  if (!controls) return;

  const grid = document.querySelector('.artwork-grid');
  if (!grid) return;

  const buttons = controls.querySelectorAll('.sort-btn');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Update active state
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Sort the grid
      sortArtworks(grid, btn.dataset.sort);
    });
  });
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initSorting);
