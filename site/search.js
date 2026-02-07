/**
 * Index page search functionality
 * Filters Artists, Locations, Bible Stories, and Trip tabs in real-time
 * Also searches page content via search-index.json
 */
(function() {
  'use strict';

  const searchInput = document.getElementById('index-search');
  const clearButton = document.querySelector('.search-clear');
  const resultsCount = document.querySelector('.search-results-count');
  const resultsPanel = document.querySelector('.search-results-panel');

  // Exit early if not on index page
  if (!searchInput) return;

  let debounceTimer;
  let searchIndex = null;

  // Load search index
  fetch('./search-index.json')
    .then(r => r.json())
    .then(data => { searchIndex = data; })
    .catch(() => { /* index unavailable, content search disabled */ });

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
      artworks: document.querySelectorAll('.artworks-list li'),
      locationHeaders: document.querySelectorAll('[data-tab="locations"] h3'),
      locations: document.querySelectorAll('.location-list li'),
      bibleStories: document.querySelectorAll('.bible-stories-list li'),
      termsCategories: document.querySelectorAll('.terms-category'),
      termItems: document.querySelectorAll('.term-item'),
      tripDays: document.querySelectorAll('.trip-day'),
      tripLocations: document.querySelectorAll('.trip-location-item')
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
   * Escape HTML special characters
   */
  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Type label mapping
   */
  var typeLabels = {
    'artist': 'Artist',
    'artwork': 'Artwork',
    'location': 'Location',
    'bible story': 'Bible Story',
    'term': 'Term'
  };

  /**
   * Get the currently active tab name
   */
  function getActiveTab() {
    var activeBtn = document.querySelector('.tab-btn.active');
    return activeBtn ? activeBtn.dataset.tab : '';
  }

  /**
   * Search the index for content matches and display results
   */
  function searchContentIndex(query) {
    if (!resultsPanel) return;

    if (!searchIndex || query.length < 2 || getActiveTab() === 'trip') {
      resultsPanel.hidden = true;
      resultsPanel.innerHTML = '';
      return;
    }

    var lowerQuery = query.toLowerCase();
    var titleMatches = [];
    var contentMatches = [];

    for (var i = 0; i < searchIndex.length; i++) {
      var entry = searchIndex[i];
      var titleMatch = entry.title.toLowerCase().includes(lowerQuery);
      if (titleMatch) {
        titleMatches.push(entry);
      } else if (entry.content.toLowerCase().includes(lowerQuery)) {
        contentMatches.push(entry);
      }
    }

    // Sort each group alphabetically by title
    titleMatches.sort(function(a, b) { return a.title.localeCompare(b.title); });
    contentMatches.sort(function(a, b) { return a.title.localeCompare(b.title); });

    if (titleMatches.length === 0 && contentMatches.length === 0) {
      resultsPanel.hidden = true;
      resultsPanel.innerHTML = '';
      return;
    }

    var html = '';

    if (titleMatches.length > 0) {
      html += '<div class="search-results-group">';
      html += '<div class="search-results-group-label">Title matches</div>';
      for (var j = 0; j < titleMatches.length; j++) {
        html += renderResult(titleMatches[j], query, false);
      }
      html += '</div>';
    }

    if (contentMatches.length > 0) {
      if (titleMatches.length > 0) {
        html += '<hr class="search-results-divider">';
      }
      html += '<div class="search-results-group">';
      html += '<div class="search-results-group-label">Content matches</div>';
      for (var k = 0; k < contentMatches.length; k++) {
        html += renderResult(contentMatches[k], query, true);
      }
      html += '</div>';
    }

    resultsPanel.innerHTML = html;
    resultsPanel.hidden = false;
  }

  /**
   * Render a single search result item
   */
  function renderResult(entry, query, showSnippet) {
    var label = typeLabels[entry.type] || entry.type;
    var badgeClass = 'search-result-type search-result-type--' + entry.type.replace(/\s+/g, '-');
    var subtitleHtml = entry.subtitle
      ? '<div class="search-result-subtitle">' + escapeHtml(entry.subtitle) + '</div>'
      : '';
    var snippetHtml = '';

    if (showSnippet) {
      snippetHtml = '<div class="search-result-snippet">' + getSnippet(entry.content, query) + '</div>';
    }

    return '<a href="' + escapeHtml(entry.url) + '" class="search-result-item">' +
      '<div class="search-result-body">' +
        '<span class="search-result-title">' + escapeHtml(entry.title) + '</span>' +
        subtitleHtml +
        snippetHtml +
      '</div>' +
      '<span class="' + badgeClass + '">' + escapeHtml(label) + '</span>' +
      '</a>';
  }

  /**
   * Extract a snippet around the match with highlighting
   */
  function getSnippet(content, query) {
    var lower = content.toLowerCase();
    var idx = lower.indexOf(query.toLowerCase());
    if (idx === -1) return '';

    var contextChars = 80;
    var start = Math.max(0, idx - contextChars);
    var end = Math.min(content.length, idx + query.length + contextChars);

    var before = content.slice(start, idx);
    var match = content.slice(idx, idx + query.length);
    var after = content.slice(idx + query.length, end);

    var prefix = start > 0 ? '...' : '';
    var suffix = end < content.length ? '...' : '';

    return prefix + escapeHtml(before) + '<mark>' + escapeHtml(match) + '</mark>' + escapeHtml(after) + suffix;
  }

  /**
   * Filter all searchable content
   */
  function filterContent(query) {
    var items = getSearchableItems();
    var trimmedQuery = query.trim();

    // If empty query, show everything
    if (!trimmedQuery) {
      resetAll(items);
      updateResultsCount(null);
      searchContentIndex('');
      return;
    }

    var totalVisible = 0;

    // Filter artists
    items.artists.forEach(function(li) {
      var text = li.textContent;
      var visible = matches(text, trimmedQuery);
      setVisible(li, visible);
      if (visible) totalVisible++;
    });

    // Filter artworks
    items.artworks.forEach(function(li) {
      var text = li.textContent;
      var visible = matches(text, trimmedQuery);
      setVisible(li, visible);
      if (visible) totalVisible++;
    });

    // Filter locations (and their city headers)
    items.locationHeaders.forEach(function(header) {
      // Get the location list that follows this header
      var locationList = header.nextElementSibling;
      if (!locationList || !locationList.classList.contains('location-list')) return;

      var locationItems = locationList.querySelectorAll('li');
      var cityHasVisibleLocations = false;

      // Check if city name matches
      var cityMatches = matches(header.textContent, trimmedQuery);

      locationItems.forEach(function(li) {
        var locationMatches = matches(li.textContent, trimmedQuery);
        var visible = cityMatches || locationMatches;
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
    items.bibleStories.forEach(function(li) {
      var text = li.textContent;
      var visible = matches(text, trimmedQuery);
      setVisible(li, visible);
      if (visible) totalVisible++;
    });

    // Filter terms (by category name, term name, or definition)
    items.termsCategories.forEach(function(catEl) {
      var catHeader = catEl.querySelector('h3');
      var catMatches = catHeader ? matches(catHeader.textContent, trimmedQuery) : false;
      var termItems = catEl.querySelectorAll('.term-item');
      var catHasVisible = false;

      termItems.forEach(function(termEl) {
        var termMatches = matches(termEl.textContent, trimmedQuery);
        var visible = catMatches || termMatches;
        setVisible(termEl, visible);
        if (visible) {
          catHasVisible = true;
          totalVisible++;
        }
      });

      setVisible(catEl, catHasVisible);
    });

    // Filter trip days and locations
    items.tripDays.forEach(function(dayEl) {
      var dayLabel = dayEl.querySelector('.trip-day-label');
      var dayLabelText = dayLabel ? dayLabel.value || dayLabel.textContent : '';
      var dayMatches = matches(dayLabelText, trimmedQuery);

      var locationItems = dayEl.querySelectorAll('.trip-location-item');
      var hasVisibleLocation = false;

      locationItems.forEach(function(locEl) {
        // Get searchable text from location item
        var locLink = locEl.querySelector('.trip-location-link');
        var locComment = locEl.querySelector('.trip-location-comment');
        var locTime = locEl.querySelector('.trip-location-time');

        var searchText = [
          locLink ? locLink.textContent : '',
          locComment ? locComment.textContent : '',
          locTime ? locTime.textContent : ''
        ].join(' ');

        var locMatches = matches(searchText, trimmedQuery);

        if (locMatches) {
          hasVisibleLocation = true;
          locEl.classList.remove('search-hidden');
          locEl.classList.add('trip-location-highlight');
          totalVisible++;
        } else if (dayMatches) {
          // Day matches, show location but don't highlight
          locEl.classList.remove('search-hidden', 'trip-location-highlight');
          totalVisible++;
        } else {
          locEl.classList.add('search-hidden');
          locEl.classList.remove('trip-location-highlight');
        }
      });

      // Show day if day label matches or has visible locations
      if (dayMatches || hasVisibleLocation) {
        dayEl.classList.remove('search-hidden');
      } else {
        dayEl.classList.add('search-hidden');
      }
    });

    updateResultsCount(totalVisible);

    // Content search
    searchContentIndex(trimmedQuery);
  }

  /**
   * Reset all items to visible
   */
  function resetAll(items) {
    items.artists.forEach(function(li) { li.classList.remove('search-hidden'); });
    items.artworks.forEach(function(li) { li.classList.remove('search-hidden'); });
    items.locationHeaders.forEach(function(h3) { h3.classList.remove('search-hidden'); });
    items.locations.forEach(function(li) { li.classList.remove('search-hidden'); });
    document.querySelectorAll('.location-list').forEach(function(ul) { ul.classList.remove('search-hidden'); });
    items.bibleStories.forEach(function(li) { li.classList.remove('search-hidden'); });
    items.termsCategories.forEach(function(el) { el.classList.remove('search-hidden'); });
    items.termItems.forEach(function(el) { el.classList.remove('search-hidden'); });
    items.tripDays.forEach(function(el) { el.classList.remove('search-hidden'); });
    items.tripLocations.forEach(function(el) {
      el.classList.remove('search-hidden', 'trip-location-highlight');
    });
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
      resultsCount.textContent = count + ' results';
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
  var debouncedFilter = debounce(function() {
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

  // Re-evaluate search results panel when tab changes
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      if (searchInput.value.trim()) {
        searchContentIndex(searchInput.value.trim());
      }
    });
  });

  // Re-apply filter when trip tab content changes (after render)
  // Listen for custom event from trip.js
  document.addEventListener('trip-rendered', function() {
    if (searchInput.value.trim()) {
      filterContent(searchInput.value);
    }
  });
})();
