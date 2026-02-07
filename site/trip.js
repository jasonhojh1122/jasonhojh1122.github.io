/**
 * Trip Planner - Interactive itinerary with maps and route visualization
 * Reads data from Google Sheets at runtime
 */
(function() {
  'use strict';

  const SHEET_JSON_URL = 'https://docs.google.com/spreadsheets/d/1Fscjw06IFmHPLCsXM2yRgIks50bSH-pjlpgwYNhVW3w/gviz/tq?tqx=out:json';
  const CACHE_KEY = 'italian-art-trip-cache';
  const CACHE_TS_KEY = 'italian-art-trip-cache-ts';

  let initialized = false;
  let tripData = null;
  let dayMaps = {};
  let dayMarkers = {};

  /**
   * Fetch sheet data using JSONP (script tag injection) to bypass CORS.
   * Google Sheets gviz/tq endpoint returns data wrapped in:
   *   google.visualization.Query.setResponse({...})
   */
  function fetchSheetData() {
    return new Promise((resolve, reject) => {
      // Create a unique callback name
      const callbackName = '_sheetCallback_' + Date.now();

      // Set up timeout
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Request timed out'));
      }, 15000);

      function cleanup() {
        clearTimeout(timeout);
        delete window[callbackName];
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
      }

      // The gviz endpoint wraps response in google.visualization.Query.setResponse(...)
      // We intercept this by defining the function
      window.google = window.google || {};
      window.google.visualization = window.google.visualization || {};
      window.google.visualization.Query = window.google.visualization.Query || {};
      window.google.visualization.Query.setResponse = function(response) {
        cleanup();
        try {
          if (response.status === 'error') {
            reject(new Error(response.errors ? response.errors[0].detailed_message : 'Sheet query error'));
            return;
          }
          const data = parseGvizResponse(response);
          resolve(data);
        } catch (err) {
          reject(err);
        }
      };

      // Inject script tag to fetch the data
      const script = document.createElement('script');
      script.src = SHEET_JSON_URL;
      script.onerror = function() {
        cleanup();
        reject(new Error('Failed to load sheet data'));
      };
      document.head.appendChild(script);
    });
  }

  /**
   * Parse the Google Visualization JSON response into structured trip data.
   * Response format: { table: { cols: [{label: "TIME"}, ...], rows: [{c: [{v: "value"}, null, ...]}, ...] } }
   */
  function parseGvizResponse(response) {
    const table = response.table;
    const cols = table.cols;
    const rows = table.rows;

    // Build column name -> index mapping
    const colIndex = {};
    cols.forEach((col, idx) => {
      colIndex[col.label] = idx;
    });

    // Helper to get cell value from a row
    function cellValue(row, colName) {
      const idx = colIndex[colName];
      if (idx === undefined) return '';
      const cell = row.c[idx];
      if (!cell) return '';
      // For formatted values (like booleans), prefer 'f' for display; use 'v' for actual value
      return cell.v != null ? cell.v : '';
    }

    const days = [];
    let currentDay = null;
    let dayCount = 0;
    const dayPattern = /^D\d+\s*\|/;

    for (const row of rows) {
      if (!row.c) continue;

      const time = String(cellValue(row, 'TIME')).trim();
      const showVal = cellValue(row, 'SHOW');
      // Boolean values come as true/false from gviz, string "TRUE"/"FALSE" from some formats
      const show = showVal === true || String(showVal).toUpperCase() === 'TRUE';
      const chineseName = String(cellValue(row, 'CHINESE NAME')).trim();

      // Check if this is a day header row
      if (dayPattern.test(time)) {
        dayCount++;
        currentDay = {
          id: 'day-' + dayCount,
          label: time,
          locations: []
        };
        days.push(currentDay);
        continue;
      }

      // Skip rows that aren't shown or have no Chinese name
      if (!show || !chineseName) continue;

      // Skip if no current day yet
      if (!currentDay) continue;

      const latVal = cellValue(row, 'LATITUDE');
      const lngVal = cellValue(row, 'LONGTITUDE') || cellValue(row, 'LONGITUDE');
      const lat = latVal ? parseFloat(latVal) : null;
      const lng = lngVal ? parseFloat(lngVal) : null;

      currentDay.locations.push({
        chineseName: chineseName,
        englishName: String(cellValue(row, 'ENGLISH NAME')).trim(),
        time: time,
        memo: String(cellValue(row, 'MEMO')).trim(),
        mapLink: String(cellValue(row, 'GOOGLE MAP LINK')).trim(),
        ticketMemo: String(cellValue(row, 'TICKET MEMO')).trim(),
        ticketLink: String(cellValue(row, 'TICKET LINK')).trim(),
        lat: lat,
        lng: lng,
        pageLinkName: String(cellValue(row, 'PAGE LINK NAME')).trim()
      });
    }

    return { days: days };
  }

  /**
   * Load cached data from localStorage
   */
  function loadCachedData() {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (e) {
      console.warn('Could not load cached trip data:', e);
    }
    return null;
  }

  /**
   * Save parsed data to localStorage cache
   */
  function saveCachedData(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      localStorage.setItem(CACHE_TS_KEY, new Date().toISOString());
    } catch (e) {
      console.warn('Could not cache trip data:', e);
    }
  }

  /**
   * Get the last cached timestamp
   */
  function getCacheTimestamp() {
    return localStorage.getItem(CACHE_TS_KEY) || null;
  }

  /**
   * Re-fetch from sheet, update cache, re-render
   */
  async function refreshData() {
    const container = document.getElementById('trip-container');
    if (!container) return;

    renderLoading(container);

    try {
      tripData = await fetchSheetData();
      saveCachedData(tripData);
      render();
    } catch (err) {
      console.error('Failed to refresh trip data:', err);
      // If we have cached data, use it; otherwise show error
      const cached = loadCachedData();
      if (cached) {
        tripData = cached;
        render();
      } else {
        renderError(container, err.message);
      }
    }
  }

  /**
   * Show loading state
   */
  function renderLoading(container) {
    container.innerHTML = '<div class="trip-loading">Loading trip data...</div>';
  }

  /**
   * Show error state
   */
  function renderError(container, message) {
    container.innerHTML = `
      <div class="trip-error">
        <p>Could not load trip data.</p>
        <p class="trip-error-detail">${escapeHtml(message)}</p>
      </div>
    `;
    const retryBtn = document.createElement('button');
    retryBtn.className = 'trip-refresh-btn';
    retryBtn.textContent = 'Retry';
    retryBtn.addEventListener('click', () => refreshData());
    container.querySelector('.trip-error').appendChild(retryBtn);
  }

  /**
   * Render the entire trip UI
   */
  function render() {
    const container = document.getElementById('trip-container');
    if (!container || !tripData) return;

    container.innerHTML = '';

    // Toolbar with refresh button
    const toolbar = document.createElement('div');
    toolbar.className = 'trip-toolbar';

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'trip-refresh-btn';
    refreshBtn.textContent = 'Refresh';
    refreshBtn.addEventListener('click', () => refreshData());
    toolbar.appendChild(refreshBtn);

    const ts = getCacheTimestamp();
    if (ts) {
      const tsEl = document.createElement('span');
      tsEl.className = 'trip-cache-ts';
      const d = new Date(ts);
      tsEl.textContent = 'Updated: ' + d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      toolbar.appendChild(tsEl);
    }

    container.appendChild(toolbar);

    // Render each day
    tripData.days.forEach((day) => {
      const dayEl = renderDay(day);
      container.appendChild(dayEl);
    });

    // Initialize maps after DOM is ready
    requestAnimationFrame(() => {
      tripData.days.forEach(day => {
        initDayMap(day);
      });

      // Notify search.js that trip content has been rendered
      document.dispatchEvent(new CustomEvent('trip-rendered'));
    });
  }

  /**
   * Render a single day section
   */
  function renderDay(day) {
    const dayEl = document.createElement('div');
    dayEl.className = 'trip-day';
    dayEl.dataset.dayId = day.id;

    // Header with read-only label
    const header = document.createElement('div');
    header.className = 'trip-day-header';

    const label = document.createElement('span');
    label.className = 'trip-day-label';
    label.textContent = day.label;

    header.appendChild(label);
    dayEl.appendChild(header);

    // Location list
    const listEl = document.createElement('ol');
    listEl.className = 'trip-location-list';
    listEl.dataset.dayId = day.id;

    day.locations.forEach((entry, locIndex) => {
      const li = renderLocationItem(entry, day.id, locIndex);
      listEl.appendChild(li);
    });

    dayEl.appendChild(listEl);

    // Map container
    const mapContainer = document.createElement('div');
    mapContainer.className = 'trip-day-map';
    mapContainer.id = `trip-map-${day.id}`;
    dayEl.appendChild(mapContainer);

    return dayEl;
  }

  /**
   * Render a single location item
   */
  function renderLocationItem(entry, dayId, index) {
    const li = document.createElement('li');
    li.className = 'trip-location-item';
    li.dataset.locationIndex = index;

    // Column 1: Index number + time range
    const numberCol = document.createElement('div');
    numberCol.className = 'trip-location-col-number';

    const number = document.createElement('span');
    number.className = 'trip-location-number';
    number.textContent = (index + 1);
    numberCol.appendChild(number);

    // Time displayed as a compact range beneath the number
    if (entry.time) {
      const timeParts = entry.time.split(/\s*[-–~]\s*/);
      const timeWrap = document.createElement('div');
      timeWrap.className = 'trip-location-time-wrap';
      if (timeParts.length >= 2) {
        const startEl = document.createElement('span');
        startEl.className = 'trip-location-time';
        startEl.textContent = timeParts[0].trim();
        const sep = document.createElement('span');
        sep.className = 'trip-location-time-sep';
        const endEl = document.createElement('span');
        endEl.className = 'trip-location-time';
        endEl.textContent = timeParts[1].trim();
        timeWrap.appendChild(startEl);
        timeWrap.appendChild(sep);
        timeWrap.appendChild(endEl);
      } else {
        const singleEl = document.createElement('span');
        singleEl.className = 'trip-location-time';
        singleEl.textContent = timeParts[0].trim();
        timeWrap.appendChild(singleEl);
      }
      numberCol.appendChild(timeWrap);
    }

    // Column 2: Content (Chinese name, English name, memo, ticket)
    const contentCol = document.createElement('div');
    contentCol.className = 'trip-location-col-content';

    // Top row: Chinese name as primary title
    const topRow = document.createElement('div');
    topRow.className = 'trip-location-top';

    if (entry.pageLinkName) {
      const link = document.createElement('a');
      link.href = `locations/${entry.pageLinkName}.html`;
      link.className = 'trip-location-link';
      link.textContent = entry.chineseName;
      topRow.appendChild(link);
    } else {
      const span = document.createElement('span');
      span.className = 'trip-location-link';
      span.textContent = entry.chineseName;
      topRow.appendChild(span);
    }

    contentCol.appendChild(topRow);

    // English name (smaller, below Chinese name)
    if (entry.englishName) {
      const engRow = document.createElement('div');
      engRow.className = 'trip-location-english';
      engRow.textContent = entry.englishName;
      contentCol.appendChild(engRow);
    }

    // Memo
    if (entry.memo) {
      const memoRow = document.createElement('div');
      memoRow.className = 'trip-location-bottom';
      const memoSpan = document.createElement('span');
      memoSpan.className = 'trip-location-comment';
      memoSpan.textContent = entry.memo;
      memoRow.appendChild(memoSpan);
      contentCol.appendChild(memoRow);
    }

    // Column 4: Map link + booked badge (fixed slots)
    const mapCol = document.createElement('div');
    mapCol.className = 'trip-location-col-map';

    // Slot 1: Map button (or invisible placeholder)
    if (entry.mapLink) {
      const mapLink = document.createElement('a');
      mapLink.href = entry.mapLink;
      mapLink.className = 'trip-location-map-link';
      mapLink.textContent = 'Map';
      mapLink.target = '_blank';
      mapLink.rel = 'noopener noreferrer';
      mapLink.addEventListener('click', (e) => e.stopPropagation());
      mapCol.appendChild(mapLink);
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'trip-location-map-link trip-map-placeholder';
      placeholder.textContent = 'Map';
      mapCol.appendChild(placeholder);
    }

    // Slot 2: Booked badge (or invisible placeholder)
    const isBooked = entry.ticketMemo && /booked/i.test(entry.ticketMemo);
    const badgeEl = document.createElement('span');
    badgeEl.className = 'trip-booked-badge' + (isBooked ? '' : ' trip-booked-placeholder');
    badgeEl.textContent = 'Booked';
    mapCol.appendChild(badgeEl);

    li.appendChild(numberCol);
    li.appendChild(contentCol);
    li.appendChild(mapCol);

    // Hover interaction: highlight corresponding map marker
    li.addEventListener('mouseenter', () => {
      highlightMapMarker(dayId, index, true);
    });
    li.addEventListener('mouseleave', () => {
      highlightMapMarker(dayId, index, false);
    });

    // Double-click (desktop): center map on this entry
    if (entry.lat && entry.lng) {
      li.addEventListener('dblclick', (e) => {
        e.preventDefault();
        centerMapOnEntry(dayId, index, entry);
      });

      // Long-press (mobile): center map on this entry
      let pressTimer = null;
      li.addEventListener('touchstart', (e) => {
        pressTimer = setTimeout(() => {
          pressTimer = null;
          centerMapOnEntry(dayId, index, entry);
        }, 500);
      }, { passive: true });
      li.addEventListener('touchend', () => {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      });
      li.addEventListener('touchmove', () => {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      });
    }

    return li;
  }

  /**
   * Center the day's map on a specific entry and open its popup
   */
  function centerMapOnEntry(dayId, index, entry) {
    const map = dayMaps[dayId];
    if (!map) return;

    // Scroll the map into view
    const mapContainer = document.getElementById('trip-map-' + dayId);
    if (mapContainer) {
      mapContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Pan to the location and zoom in
    map.setView([entry.lat, entry.lng], 16, { animate: true });

    // Open the marker's popup
    const marker = dayMarkers[dayId] && dayMarkers[dayId][index];
    if (marker) {
      marker.openPopup();
    }
  }

  /**
   * Highlight or unhighlight a map marker
   */
  function highlightMapMarker(dayId, index, highlight) {
    const markers = dayMarkers[dayId];
    if (!markers || !markers[index]) return;

    const marker = markers[index];
    const el = marker.getElement();
    if (!el) return;

    const circle = el.querySelector('.trip-marker-circle');
    if (!circle) return;

    if (highlight) {
      circle.classList.add('trip-marker-highlighted');
      marker.setZIndexOffset(1000);
    } else {
      circle.classList.remove('trip-marker-highlighted');
      marker.setZIndexOffset(0);
    }
  }

  /**
   * Highlight or unhighlight a list item when hovering on map marker
   */
  function highlightListItem(dayId, index, highlight) {
    const dayEl = document.querySelector(`.trip-day[data-day-id="${dayId}"]`);
    if (!dayEl) return;

    const item = dayEl.querySelector(`.trip-location-item[data-location-index="${index}"]`);
    if (!item) return;

    if (highlight) {
      item.classList.add('trip-location-highlighted');
    } else {
      item.classList.remove('trip-location-highlighted');
    }
  }

  /**
   * Create the route legend element
   */
  function createRouteLegend() {
    const legend = document.createElement('div');
    legend.className = 'trip-route-legend';
    legend.innerHTML = `
      <div class="trip-route-legend-title">Route</div>
      <div class="trip-route-legend-item">
        <span class="trip-route-legend-line"></span>
        <span>Click for directions</span>
      </div>
    `;
    return legend;
  }

  /**
   * Initialize or update a day's map
   */
  function initDayMap(day) {
    const containerId = `trip-map-${day.id}`;
    const container = document.getElementById(containerId);
    if (!container) return;

    // Clear existing map
    if (dayMaps[day.id]) {
      dayMaps[day.id].remove();
    }

    // Clear stored markers
    dayMarkers[day.id] = [];

    // Get locations with coordinates
    const locsWithIndex = day.locations.map((entry, idx) => ({
      entry: entry,
      originalIndex: idx
    })).filter(item => item.entry.lat && item.entry.lng);

    if (locsWithIndex.length === 0) {
      container.innerHTML = '<p class="trip-map-empty">No locations with coordinates</p>';
      return;
    }

    // Create map
    const map = L.map(containerId, {
      scrollWheelZoom: false
    });
    dayMaps[day.id] = map;

    // Add CartoDB Positron tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(map);

    // Add numbered markers
    locsWithIndex.forEach((item) => {
      const entry = item.entry;
      const marker = L.marker([entry.lat, entry.lng], {
        icon: createNumberedIcon(item.originalIndex + 1)
      }).addTo(map);

      const popupContent = `
        <div class="trip-popup">
          <strong>${escapeHtml(entry.chineseName)}</strong>
          ${entry.englishName ? `<span class="trip-popup-city">${escapeHtml(entry.englishName)}</span>` : ''}
        </div>
      `;

      marker.bindPopup(popupContent, {
        className: 'trip-popup-container'
      });

      // Store marker at original index for hover highlighting
      dayMarkers[day.id][item.originalIndex] = marker;

      // Add hover listener on marker to highlight list item
      marker.on('mouseover', () => {
        highlightListItem(day.id, item.originalIndex, true);
      });
      marker.on('mouseout', () => {
        highlightListItem(day.id, item.originalIndex, false);
      });
    });

    // Draw route polylines between consecutive locations
    if (locsWithIndex.length > 1) {
      for (let i = 0; i < locsWithIndex.length - 1; i++) {
        const from = locsWithIndex[i].entry;
        const to = locsWithIndex[i + 1].entry;
        const polyline = L.polyline(
          [[from.lat, from.lng], [to.lat, to.lng]],
          {
            color: '#B85C38',
            weight: 3,
            opacity: 0.7,
            dashArray: '5, 10'
          }
        ).addTo(map);

        polyline.on('click', () => {
          const url = `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=walking`;
          window.open(url, '_blank');
        });

        polyline.on('mouseover', function() {
          this.setStyle({ weight: 5, opacity: 1 });
        });
        polyline.on('mouseout', function() {
          this.setStyle({ weight: 3, opacity: 0.7 });
        });
      }

      container.appendChild(createRouteLegend());
    }

    // Fit bounds
    const bounds = L.latLngBounds(locsWithIndex.map(item => [item.entry.lat, item.entry.lng]));
    map.fitBounds(bounds, { padding: [40, 40] });
  }

  /**
   * Escape HTML special characters
   */
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Create a numbered marker icon
   */
  function createNumberedIcon(number) {
    return L.divIcon({
      className: 'trip-marker',
      html: `<div class="trip-marker-circle">${number}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
  }

  /**
   * Initialize the trip tab
   */
  async function init() {
    if (initialized) return;
    initialized = true;

    const container = document.getElementById('trip-container');
    if (!container) return;

    // Try loading from cache first
    const cached = loadCachedData();
    if (cached) {
      tripData = cached;
      render();
      return;
    }

    // No cache — fetch from Google Sheets
    renderLoading(container);
    try {
      tripData = await fetchSheetData();
      saveCachedData(tripData);
      render();
    } catch (err) {
      console.error('Failed to load trip data:', err);
      renderError(container, err.message);
    }
  }

  // Initialize when trip tab is shown
  document.addEventListener('trip-tab-shown', init);

  // Also check if trip tab is already active on page load
  document.addEventListener('DOMContentLoaded', () => {
    const tripPanel = document.querySelector('.tab-panel[data-tab="trip"]');
    if (tripPanel && tripPanel.classList.contains('active')) {
      init();
    }

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('tab') === 'trip') {
      init();
    }
  });
})();
