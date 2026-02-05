/**
 * Trip Planner - Interactive itinerary with maps and route visualization
 */
(function() {
  'use strict';

  const STORAGE_KEY = 'italian-art-trip-v2';
  let initialized = false;
  let tripData = null;
  let allLocations = {};
  let dayMaps = {};

  /**
   * Load trip data from embedded JSON and merge with localStorage
   */
  function loadTripData() {
    const dataEl = document.getElementById('trip-data');
    const locationsEl = document.getElementById('trip-locations-data');

    if (!dataEl || !locationsEl) return null;

    const builtInData = JSON.parse(dataEl.textContent);
    const locationsArray = JSON.parse(locationsEl.textContent);

    // Build locations lookup
    locationsArray.forEach(loc => {
      allLocations[loc.id] = loc;
    });

    // Try to load from localStorage
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Check version compatibility
        if (parsed.version === builtInData.version) {
          return parsed;
        }
        // Version mismatch - use built-in data but warn
        console.warn('Trip data version mismatch, using built-in data');
      } catch (e) {
        console.warn('Could not parse stored trip data:', e);
      }
    }

    return JSON.parse(JSON.stringify(builtInData)); // Deep clone
  }

  /**
   * Save trip data to localStorage
   */
  function saveTripData() {
    if (!tripData) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tripData));
  }

  /**
   * Generate unique ID for new days
   */
  function generateDayId() {
    return 'day-' + Date.now();
  }

  /**
   * Get location info by ID or from custom entry
   */
  function getLocation(id, entry = null) {
    // Check if this is a custom location
    if (entry && entry.custom) {
      return {
        id: entry.id,
        title: entry.title || 'Custom Location',
        city: entry.city || '',
        lat: entry.lat || null,
        lng: entry.lng || null,
        isCustom: true
      };
    }
    return allLocations[id] || { id, title: id, city: '', lat: null, lng: null };
  }

  /**
   * Render the entire trip UI
   */
  function render() {
    const container = document.getElementById('trip-container');
    if (!container || !tripData) return;

    container.innerHTML = '';

    // Render each day
    tripData.days.forEach((day, dayIndex) => {
      const dayEl = renderDay(day, dayIndex);
      container.appendChild(dayEl);
    });

    // Actions container
    const actionsEl = document.createElement('div');
    actionsEl.className = 'trip-actions';

    // Add "Add Day" button
    const addDayBtn = document.createElement('button');
    addDayBtn.className = 'trip-add-day-btn';
    addDayBtn.innerHTML = '<span>Add Day</span>';
    addDayBtn.addEventListener('click', () => addDay());
    actionsEl.appendChild(addDayBtn);

    // Add Reset button
    const resetBtn = document.createElement('button');
    resetBtn.className = 'trip-reset-btn';
    resetBtn.textContent = 'Reset to Default';
    resetBtn.addEventListener('click', () => resetToDefault());
    actionsEl.appendChild(resetBtn);

    container.appendChild(actionsEl);

    // Initialize maps after DOM is ready
    requestAnimationFrame(() => {
      tripData.days.forEach(day => {
        initDayMap(day);
      });
    });
  }

  /**
   * Render a single day section
   */
  function renderDay(day, dayIndex) {
    const dayEl = document.createElement('div');
    dayEl.className = 'trip-day';
    dayEl.dataset.dayId = day.id;

    // Header with editable label and delete button
    const header = document.createElement('div');
    header.className = 'trip-day-header';

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'trip-day-label';
    labelInput.value = day.label;
    labelInput.addEventListener('change', () => {
      day.label = labelInput.value;
      saveTripData();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'trip-day-delete';
    deleteBtn.textContent = 'Delete Day';
    deleteBtn.addEventListener('click', () => deleteDay(day.id));

    header.appendChild(labelInput);
    header.appendChild(deleteBtn);
    dayEl.appendChild(header);

    // Location list
    const listEl = document.createElement('ol');
    listEl.className = 'trip-location-list';
    listEl.dataset.dayId = day.id;

    day.locations.forEach((entry, locIndex) => {
      const loc = getLocation(entry.id, entry);
      const li = renderLocationItem(loc, entry, day.id, locIndex);
      listEl.appendChild(li);
    });

    // Make list sortable via drag-and-drop
    setupDragAndDrop(listEl, day);

    dayEl.appendChild(listEl);

    // Add location button
    const addLocBtn = document.createElement('button');
    addLocBtn.className = 'trip-add-location-btn';
    addLocBtn.textContent = '+ Add Location';
    addLocBtn.addEventListener('click', () => showAddLocationModal(day.id));
    dayEl.appendChild(addLocBtn);

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
  function renderLocationItem(loc, entry, dayId, index) {
    const li = document.createElement('li');
    li.className = 'trip-location-item';
    li.draggable = true;
    li.dataset.locationId = loc.id;
    li.dataset.locationIndex = index;

    // Column 1: Number
    const numberCol = document.createElement('div');
    numberCol.className = 'trip-location-col-number';

    const number = document.createElement('span');
    number.className = 'trip-location-number';
    number.textContent = (index + 1);
    numberCol.appendChild(number);

    // Column 2: Time
    const timeCol = document.createElement('div');
    timeCol.className = 'trip-location-col-time';

    if (entry.time) {
      const time = document.createElement('span');
      time.className = 'trip-location-time';
      time.textContent = entry.time;
      time.contentEditable = true;
      time.spellcheck = false;
      time.addEventListener('blur', () => {
        entry.time = time.textContent.trim();
        saveTripData();
      });
      time.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          time.blur();
        }
      });
      timeCol.appendChild(time);
    } else {
      const addTime = document.createElement('button');
      addTime.className = 'trip-location-add-time';
      addTime.textContent = '+time';
      addTime.addEventListener('click', (e) => {
        e.stopPropagation();
        entry.time = '09:00';
        saveTripData();
        render();
      });
      timeCol.appendChild(addTime);
    }

    // Column 3: Name and comment (two rows)
    const contentCol = document.createElement('div');
    contentCol.className = 'trip-location-col-content';

    // Top row: title only
    const topRow = document.createElement('div');
    topRow.className = 'trip-location-top';

    if (loc.isCustom) {
      // Custom locations don't have a page to link to
      const span = document.createElement('span');
      span.className = 'trip-location-link trip-location-custom';
      span.textContent = loc.title;
      topRow.appendChild(span);
    } else {
      const link = document.createElement('a');
      link.href = `locations/${loc.id}.html`;
      link.className = 'trip-location-link';
      link.textContent = loc.title;
      topRow.appendChild(link);
    }

    contentCol.appendChild(topRow);

    // Bottom row: comment
    const bottomRow = document.createElement('div');
    bottomRow.className = 'trip-location-bottom';

    if (entry.comment) {
      const comment = document.createElement('span');
      comment.className = 'trip-location-comment';
      comment.textContent = entry.comment;
      comment.contentEditable = true;
      comment.spellcheck = false;
      comment.addEventListener('blur', () => {
        entry.comment = comment.textContent.trim();
        saveTripData();
      });
      comment.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          comment.blur();
        }
      });
      bottomRow.appendChild(comment);
    } else {
      const addComment = document.createElement('button');
      addComment.className = 'trip-location-add-comment';
      addComment.textContent = '+note';
      addComment.addEventListener('click', (e) => {
        e.stopPropagation();
        entry.comment = 'Add note...';
        saveTripData();
        render();
      });
      bottomRow.appendChild(addComment);
    }

    contentCol.appendChild(bottomRow);

    // Column 4: Map link
    const mapCol = document.createElement('div');
    mapCol.className = 'trip-location-col-map';

    if (entry.mapLink) {
      const mapLink = document.createElement('a');
      mapLink.href = entry.mapLink;
      mapLink.className = 'trip-location-map-link';
      mapLink.textContent = 'Map';
      mapLink.target = '_blank';
      mapLink.rel = 'noopener noreferrer';
      mapLink.addEventListener('click', (e) => e.stopPropagation());
      mapCol.appendChild(mapLink);
    }

    // Column 5: Edit button
    const editCol = document.createElement('div');
    editCol.className = 'trip-location-col-action';

    const editBtn = document.createElement('button');
    editBtn.className = 'trip-location-edit';
    editBtn.innerHTML = '&#9998;';
    editBtn.title = 'Edit details';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showEditLocationModal(dayId, entry);
    });
    editCol.appendChild(editBtn);

    // Column 6: Remove button
    const removeCol = document.createElement('div');
    removeCol.className = 'trip-location-col-action';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'trip-location-remove';
    removeBtn.textContent = '\u00d7';
    removeBtn.title = 'Remove location';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeLocation(dayId, loc.id);
    });
    removeCol.appendChild(removeBtn);

    li.appendChild(numberCol);
    li.appendChild(timeCol);
    li.appendChild(contentCol);
    li.appendChild(mapCol);
    li.appendChild(editCol);
    li.appendChild(removeCol);

    // Hover interaction: highlight corresponding map marker
    li.addEventListener('mouseenter', () => {
      highlightMapMarker(dayId, index, true);
    });
    li.addEventListener('mouseleave', () => {
      highlightMapMarker(dayId, index, false);
    });

    return li;
  }

  /**
   * Store map markers by day for hover highlighting
   */
  let dayMarkers = {};

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
      // Bring marker to front
      marker.setZIndexOffset(1000);
    } else {
      circle.classList.remove('trip-marker-highlighted');
      marker.setZIndexOffset(0);
    }
  }

  /**
   * Show modal to edit a location entry
   */
  function showEditLocationModal(dayId, entry) {
    const loc = getLocation(entry.id, entry);
    const isCustom = entry.custom;

    const overlay = document.createElement('div');
    overlay.className = 'trip-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'trip-modal trip-modal-edit';

    // Build custom fields HTML if this is a custom location
    const customFieldsHtml = isCustom ? `
        <label class="trip-edit-label">
          <span>Name *</span>
          <input type="text" class="trip-edit-title" value="${escapeHtml(entry.title || '')}" required>
        </label>
        <label class="trip-edit-label">
          <span>City</span>
          <input type="text" class="trip-edit-city" value="${escapeHtml(entry.city || '')}">
        </label>
    ` : '';

    const coordsFieldsHtml = isCustom ? `
        <div class="trip-custom-coords">
          <label class="trip-edit-label trip-edit-label-half">
            <span>Latitude</span>
            <input type="number" step="any" class="trip-edit-lat" value="${entry.lat || ''}" placeholder="e.g., 43.7696">
          </label>
          <label class="trip-edit-label trip-edit-label-half">
            <span>Longitude</span>
            <input type="number" step="any" class="trip-edit-lng" value="${entry.lng || ''}" placeholder="e.g., 11.2558">
          </label>
        </div>
    ` : '';

    modal.innerHTML = `
      <div class="trip-modal-header">
        <h3>${escapeHtml(loc.title)}${isCustom ? ' <span class="trip-custom-badge">Custom</span>' : ''}</h3>
        <button class="trip-modal-close">&times;</button>
      </div>
      <div class="trip-edit-form">
        ${customFieldsHtml}
        <label class="trip-edit-label">
          <span>Time (24hr)</span>
          <input type="time" class="trip-edit-time" value="${entry.time || ''}">
        </label>
        <label class="trip-edit-label">
          <span>Note</span>
          <input type="text" class="trip-edit-comment" value="${escapeHtml(entry.comment || '')}" placeholder="Add a note...">
        </label>
        <label class="trip-edit-label">
          <span>Google Maps Link</span>
          <input type="url" class="trip-edit-maplink" value="${escapeHtml(entry.mapLink || '')}" placeholder="https://maps.google.com/...">
        </label>
        ${coordsFieldsHtml}
        <div class="trip-edit-actions">
          <button class="trip-edit-save">Save</button>
          <button class="trip-edit-cancel">Cancel</button>
        </div>
      </div>
    `;

    function closeModal() {
      overlay.remove();
    }

    function save() {
      if (isCustom) {
        const title = modal.querySelector('.trip-edit-title').value.trim();
        if (!title) {
          modal.querySelector('.trip-edit-title').focus();
          return;
        }
        entry.title = title;
        entry.city = modal.querySelector('.trip-edit-city').value.trim();
        entry.lat = parseFloat(modal.querySelector('.trip-edit-lat').value) || null;
        entry.lng = parseFloat(modal.querySelector('.trip-edit-lng').value) || null;
      }
      entry.time = modal.querySelector('.trip-edit-time').value;
      entry.comment = modal.querySelector('.trip-edit-comment').value;
      entry.mapLink = modal.querySelector('.trip-edit-maplink').value;
      saveTripData();
      closeModal();
      render();
    }

    modal.querySelector('.trip-modal-close').addEventListener('click', closeModal);
    modal.querySelector('.trip-edit-cancel').addEventListener('click', closeModal);
    modal.querySelector('.trip-edit-save').addEventListener('click', save);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    // Enter to save
    modal.querySelectorAll('input').forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') save();
      });
    });

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Focus the first input
    const firstInput = isCustom ? modal.querySelector('.trip-edit-title') : modal.querySelector('.trip-edit-time');
    firstInput.focus();
  }

  /**
   * Setup drag-and-drop for a location list
   */
  function setupDragAndDrop(listEl, day) {
    let draggedItem = null;
    let draggedIndex = null;

    listEl.addEventListener('dragstart', (e) => {
      if (e.target.classList.contains('trip-location-item')) {
        draggedItem = e.target;
        draggedIndex = Array.from(listEl.children).indexOf(draggedItem);
        e.target.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', e.target.dataset.locationId);
      }
    });

    listEl.addEventListener('dragend', (e) => {
      if (e.target.classList.contains('trip-location-item')) {
        e.target.classList.remove('dragging');
        draggedItem = null;
        draggedIndex = null;
        // Remove all drop indicators
        listEl.querySelectorAll('.drop-indicator').forEach(el => el.remove());
      }
    });

    listEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      const afterElement = getDragAfterElement(listEl, e.clientY);
      const indicator = listEl.querySelector('.drop-indicator') || createDropIndicator();

      if (afterElement) {
        listEl.insertBefore(indicator, afterElement);
      } else {
        listEl.appendChild(indicator);
      }
    });

    listEl.addEventListener('dragleave', (e) => {
      if (!listEl.contains(e.relatedTarget)) {
        listEl.querySelectorAll('.drop-indicator').forEach(el => el.remove());
      }
    });

    listEl.addEventListener('drop', (e) => {
      e.preventDefault();
      listEl.querySelectorAll('.drop-indicator').forEach(el => el.remove());

      if (!draggedItem) return;

      const afterElement = getDragAfterElement(listEl, e.clientY);
      let newIndex;

      if (afterElement) {
        listEl.insertBefore(draggedItem, afterElement);
        newIndex = Array.from(listEl.children).indexOf(draggedItem);
      } else {
        listEl.appendChild(draggedItem);
        newIndex = listEl.children.length - 1;
      }

      // Update data model
      if (draggedIndex !== newIndex) {
        const [removed] = day.locations.splice(draggedIndex, 1);
        day.locations.splice(newIndex, 0, removed);
        saveTripData();
        // Re-render to update numbers and map
        render();
      }
    });
  }

  function createDropIndicator() {
    const indicator = document.createElement('li');
    indicator.className = 'drop-indicator';
    return indicator;
  }

  function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.trip-location-item:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  /**
   * Create the route legend element (matching map legend style)
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

    // Get locations with coordinates (entries are objects with id property)
    // We need to track original indices for hover highlighting
    const locsWithIndex = day.locations.map((entry, idx) => ({
      loc: getLocation(entry.id, entry),
      originalIndex: idx
    })).filter(item => item.loc.lat && item.loc.lng);

    if (locsWithIndex.length === 0) {
      container.innerHTML = '<p class="trip-map-empty">Add locations with coordinates to see the map</p>';
      return;
    }

    // Create map
    const map = L.map(containerId, {
      scrollWheelZoom: false
    });
    dayMaps[day.id] = map;

    // Add CartoDB Positron tiles - matching main map style
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(map);

    // Add numbered markers and store them by original index
    locsWithIndex.forEach((item, displayIndex) => {
      const loc = item.loc;
      const marker = L.marker([loc.lat, loc.lng], {
        icon: createNumberedIcon(item.originalIndex + 1)
      }).addTo(map);

      const popupContent = `
        <div class="trip-popup">
          <strong>${escapeHtml(loc.title)}</strong>
          ${loc.city ? `<span class="trip-popup-city">${escapeHtml(loc.city.replace(/, Italy$/, ''))}</span>` : ''}
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
        const from = locsWithIndex[i].loc;
        const to = locsWithIndex[i + 1].loc;
        const polyline = L.polyline(
          [[from.lat, from.lng], [to.lat, to.lng]],
          {
            color: '#B85C38',
            weight: 3,
            opacity: 0.7,
            dashArray: '5, 10'
          }
        ).addTo(map);

        // Click handler opens Google Maps directions
        polyline.on('click', () => {
          const url = `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=walking`;
          window.open(url, '_blank');
        });

        // Style on hover
        polyline.on('mouseover', function() {
          this.setStyle({ weight: 5, opacity: 1 });
        });
        polyline.on('mouseout', function() {
          this.setStyle({ weight: 3, opacity: 0.7 });
        });
      }

      // Add route legend
      container.appendChild(createRouteLegend());
    }

    // Fit bounds
    const bounds = L.latLngBounds(locsWithIndex.map(item => [item.loc.lat, item.loc.lng]));
    map.fitBounds(bounds, { padding: [40, 40] });
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
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
  }

  /**
   * Show modal to add a location to a day
   */
  function showAddLocationModal(dayId) {
    const day = tripData.days.find(d => d.id === dayId);
    if (!day) return;

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'trip-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'trip-modal';

    const header = document.createElement('div');
    header.className = 'trip-modal-header';
    header.innerHTML = `
      <h3>Add Location</h3>
      <button class="trip-modal-close">&times;</button>
    `;

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'trip-modal-search';
    searchInput.placeholder = 'Search locations...';

    const listContainer = document.createElement('div');
    listContainer.className = 'trip-modal-list';

    // Group locations by city
    const byCity = {};
    Object.values(allLocations).forEach(loc => {
      const city = loc.city ? loc.city.replace(/, Italy$/, '') : 'Other';
      if (!byCity[city]) byCity[city] = [];
      byCity[city].push(loc);
    });

    // Sort cities and locations
    const sortedCities = Object.keys(byCity).sort();
    sortedCities.forEach(city => {
      byCity[city].sort((a, b) => a.title.localeCompare(b.title));
    });

    // Helper to check if location is already in day
    function isLocationInDay(locationId) {
      return day.locations.some(entry => entry.id === locationId);
    }

    function renderLocationList(filter = '') {
      listContainer.innerHTML = '';
      const lowerFilter = filter.toLowerCase();

      sortedCities.forEach(city => {
        const locs = byCity[city].filter(loc =>
          loc.title.toLowerCase().includes(lowerFilter) ||
          city.toLowerCase().includes(lowerFilter)
        );
        if (locs.length === 0) return;

        const cityHeader = document.createElement('h4');
        cityHeader.className = 'trip-modal-city';
        cityHeader.textContent = city;
        listContainer.appendChild(cityHeader);

        locs.forEach(loc => {
          const item = document.createElement('div');
          item.className = 'trip-modal-item';
          const alreadyAdded = isLocationInDay(loc.id);
          if (alreadyAdded) {
            item.classList.add('already-added');
          }

          const name = document.createElement('span');
          name.className = 'trip-modal-item-name';
          name.textContent = loc.title;

          item.appendChild(name);

          if (!alreadyAdded) {
            item.addEventListener('click', () => {
              addLocation(dayId, loc.id);
              closeModal();
            });
          } else {
            const badge = document.createElement('span');
            badge.className = 'trip-modal-item-badge';
            badge.textContent = 'Added';
            item.appendChild(badge);
          }

          listContainer.appendChild(item);
        });
      });
    }

    renderLocationList();

    searchInput.addEventListener('input', () => {
      renderLocationList(searchInput.value);
    });

    function closeModal() {
      overlay.remove();
    }

    header.querySelector('.trip-modal-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    // Add custom location button
    const customBtn = document.createElement('button');
    customBtn.className = 'trip-add-custom-btn';
    customBtn.textContent = '+ Add Custom Location';
    customBtn.addEventListener('click', () => {
      closeModal();
      showAddCustomLocationModal(dayId);
    });

    modal.appendChild(header);
    modal.appendChild(customBtn);
    modal.appendChild(searchInput);
    modal.appendChild(listContainer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    searchInput.focus();
  }

  /**
   * Show modal to add a custom location
   */
  function showAddCustomLocationModal(dayId) {
    const overlay = document.createElement('div');
    overlay.className = 'trip-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'trip-modal trip-modal-custom';

    modal.innerHTML = `
      <div class="trip-modal-header">
        <h3>Add Custom Location</h3>
        <button class="trip-modal-close">&times;</button>
      </div>
      <div class="trip-edit-form">
        <label class="trip-edit-label">
          <span>Name *</span>
          <input type="text" class="trip-custom-title" placeholder="Restaurant, hotel, landmark..." required>
        </label>
        <label class="trip-edit-label">
          <span>City</span>
          <input type="text" class="trip-custom-city" placeholder="e.g., Florence">
        </label>
        <label class="trip-edit-label">
          <span>Time (24hr)</span>
          <input type="time" class="trip-custom-time">
        </label>
        <label class="trip-edit-label">
          <span>Note</span>
          <input type="text" class="trip-custom-comment" placeholder="Add a note...">
        </label>
        <label class="trip-edit-label">
          <span>Google Maps Link</span>
          <input type="url" class="trip-custom-maplink" placeholder="https://maps.google.com/...">
        </label>
        <div class="trip-custom-coords">
          <label class="trip-edit-label trip-edit-label-half">
            <span>Latitude</span>
            <input type="number" step="any" class="trip-custom-lat" placeholder="e.g., 43.7696">
          </label>
          <label class="trip-edit-label trip-edit-label-half">
            <span>Longitude</span>
            <input type="number" step="any" class="trip-custom-lng" placeholder="e.g., 11.2558">
          </label>
        </div>
        <p class="trip-custom-hint">Tip: Get coordinates from Google Maps by right-clicking a location</p>
        <div class="trip-edit-actions">
          <button class="trip-edit-save">Add Location</button>
          <button class="trip-edit-cancel">Cancel</button>
        </div>
      </div>
    `;

    function closeModal() {
      overlay.remove();
    }

    function save() {
      const title = modal.querySelector('.trip-custom-title').value.trim();
      if (!title) {
        modal.querySelector('.trip-custom-title').focus();
        return;
      }

      const entry = {
        id: 'custom-' + Date.now(),
        custom: true,
        title: title,
        city: modal.querySelector('.trip-custom-city').value.trim(),
        time: modal.querySelector('.trip-custom-time').value,
        comment: modal.querySelector('.trip-custom-comment').value.trim(),
        mapLink: modal.querySelector('.trip-custom-maplink').value.trim(),
        lat: parseFloat(modal.querySelector('.trip-custom-lat').value) || null,
        lng: parseFloat(modal.querySelector('.trip-custom-lng').value) || null
      };

      addCustomLocation(dayId, entry);
      closeModal();
    }

    modal.querySelector('.trip-modal-close').addEventListener('click', closeModal);
    modal.querySelector('.trip-edit-cancel').addEventListener('click', closeModal);
    modal.querySelector('.trip-edit-save').addEventListener('click', save);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    // Enter to save (on text inputs, not time)
    modal.querySelectorAll('input[type="text"], input[type="url"], input[type="number"]').forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') save();
      });
    });

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    modal.querySelector('.trip-custom-title').focus();
  }

  /**
   * Add a custom location to a day
   */
  function addCustomLocation(dayId, entry) {
    const day = tripData.days.find(d => d.id === dayId);
    if (!day) return;

    day.locations.push(entry);
    saveTripData();
    render();
  }

  /**
   * Add a location to a day
   */
  function addLocation(dayId, locationId) {
    const day = tripData.days.find(d => d.id === dayId);
    if (!day) return;

    // Check if already exists
    if (!day.locations.some(entry => entry.id === locationId)) {
      // Create new entry object
      day.locations.push({
        id: locationId,
        time: '',
        comment: '',
        mapLink: ''
      });
      saveTripData();
      render();
    }
  }

  /**
   * Remove a location from a day
   */
  function removeLocation(dayId, locationId) {
    const day = tripData.days.find(d => d.id === dayId);
    if (!day) return;

    const index = day.locations.findIndex(entry => entry.id === locationId);
    if (index > -1) {
      day.locations.splice(index, 1);
      saveTripData();
      render();
    }
  }

  /**
   * Add a new day
   */
  function addDay() {
    const newDay = {
      id: generateDayId(),
      label: `Day ${tripData.days.length + 1}`,
      locations: []
    };
    tripData.days.push(newDay);
    saveTripData();
    render();
  }

  /**
   * Delete a day
   */
  function deleteDay(dayId) {
    const day = tripData.days.find(d => d.id === dayId);
    if (!day) return;

    if (day.locations.length > 0) {
      if (!confirm(`Delete "${day.label}" with ${day.locations.length} locations?`)) {
        return;
      }
    }

    const index = tripData.days.findIndex(d => d.id === dayId);
    if (index > -1) {
      // Clean up map
      if (dayMaps[dayId]) {
        dayMaps[dayId].remove();
        delete dayMaps[dayId];
      }
      tripData.days.splice(index, 1);
      saveTripData();
      render();
    }
  }

  /**
   * Reset trip data to default
   */
  function resetToDefault() {
    if (!confirm('Reset trip planner to default? Your changes will be lost.')) {
      return;
    }

    localStorage.removeItem(STORAGE_KEY);

    // Clean up all maps
    Object.keys(dayMaps).forEach(dayId => {
      dayMaps[dayId].remove();
    });
    dayMaps = {};

    tripData = loadTripData();
    render();
  }

  /**
   * Initialize the trip tab
   */
  function init() {
    if (initialized) return;

    tripData = loadTripData();
    if (!tripData) return;

    initialized = true;
    render();
  }

  // Initialize when trip tab is shown
  document.addEventListener('trip-tab-shown', init);

  // Also check if trip tab is already active on page load
  document.addEventListener('DOMContentLoaded', () => {
    const tripPanel = document.querySelector('.tab-panel[data-tab="trip"]');
    if (tripPanel && tripPanel.classList.contains('active')) {
      init();
    }

    // Check URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('tab') === 'trip') {
      init();
    }
  });
})();
