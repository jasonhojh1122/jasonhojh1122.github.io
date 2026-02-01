/**
 * Index page search functionality
 * Filters Artists, Locations, and Bible Stories tabs in real-time
 */
(function() {
  'use strict';

  const searchInput = document.getElementById('index-search');
  const clearButton = document.querySelector('.search-clear');
  const resultsCount = document.querySelector('.search-results-count');

  // Exit early if not on index page
  if (!searchInput) return;

  let debounceTimer;

  /**
   * Debounce function to limit search frequency
   */
  function debounce(fn, delay) {
    return function(...args) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  /**
   * Get all searchable items organized by type
   */
  function getSearchableItems() {
    return {
      artists: document.querySelectorAll('.artist-list li'),
      locationHeaders: document.querySelectorAll('[data-tab="locations"] h3'),
      locations: document.querySelectorAll('.location-list li'),
      bibleStories: document.querySelectorAll('.bible-stories-list li')
    };
  }

  /**
   * Check if text matches search query (case-insensitive substring)
   */
  function matches(text, query) {
    return text.toLowerCase().includes(query.toLowerCase());
  }

  /**
   * Show or hide an element
   */
  function setVisible(element, visible) {
    if (visible) {
      element.classList.remove('search-hidden');
    } else {
      element.classList.add('search-hidden');
    }
  }

  /**
   * Filter all searchable content
   */
  function filterContent(query) {
    const items = getSearchableItems();
    const trimmedQuery = query.trim();

    // If empty query, show everything
    if (!trimmedQuery) {
      resetAll(items);
      updateResultsCount(null);
      return;
    }

    let totalVisible = 0;

    // Filter artists
    items.artists.forEach(li => {
      const text = li.textContent;
      const visible = matches(text, trimmedQuery);
      setVisible(li, visible);
      if (visible) totalVisible++;
    });

    // Filter locations (and their city headers)
    items.locationHeaders.forEach(header => {
      // Get the location list that follows this header
      const locationList = header.nextElementSibling;
      if (!locationList || !locationList.classList.contains('location-list')) return;

      const locationItems = locationList.querySelectorAll('li');
      let cityHasVisibleLocations = false;

      // Check if city name matches
      const cityMatches = matches(header.textContent, trimmedQuery);

      locationItems.forEach(li => {
        const locationMatches = matches(li.textContent, trimmedQuery);
        const visible = cityMatches || locationMatches;
        setVisible(li, visible);
        if (visible) {
          cityHasVisibleLocations = true;
          totalVisible++;
        }
      });

      // Show/hide the city header based on whether any locations are visible
      setVisible(header, cityHasVisibleLocations);
      setVisible(locationList, cityHasVisibleLocations);
    });

    // Filter bible stories
    items.bibleStories.forEach(li => {
      const text = li.textContent;
      const visible = matches(text, trimmedQuery);
      setVisible(li, visible);
      if (visible) totalVisible++;
    });

    updateResultsCount(totalVisible);
  }

  /**
   * Reset all items to visible
   */
  function resetAll(items) {
    items.artists.forEach(li => li.classList.remove('search-hidden'));
    items.locationHeaders.forEach(h3 => h3.classList.remove('search-hidden'));
    items.locations.forEach(li => li.classList.remove('search-hidden'));
    document.querySelectorAll('.location-list').forEach(ul => ul.classList.remove('search-hidden'));
    items.bibleStories.forEach(li => li.classList.remove('search-hidden'));
  }

  /**
   * Update results count display
   */
  function updateResultsCount(count) {
    if (count === null) {
      resultsCount.hidden = true;
      return;
    }

    resultsCount.hidden = false;
    if (count === 0) {
      resultsCount.textContent = 'No results found';
    } else if (count === 1) {
      resultsCount.textContent = '1 result';
    } else {
      resultsCount.textContent = `${count} results`;
    }
  }

  /**
   * Update clear button visibility
   */
  function updateClearButton() {
    clearButton.hidden = !searchInput.value;
  }

  /**
   * Clear search and reset
   */
  function clearSearch() {
    searchInput.value = '';
    filterContent('');
    updateClearButton();
    searchInput.focus();
  }

  // Debounced search handler
  const debouncedFilter = debounce(function() {
    filterContent(searchInput.value);
    updateClearButton();
  }, 150);

  // Event listeners
  searchInput.addEventListener('input', debouncedFilter);

  searchInput.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      clearSearch();
    }
  });

  clearButton.addEventListener('click', clearSearch);
})();
