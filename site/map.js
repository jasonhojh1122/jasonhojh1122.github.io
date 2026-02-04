/**
 * Interactive map for location pins with tiered artwork count labels
 * Renaissance Cartographer's Atlas design with Stamen Toner Lite tiles
 * Lazy-loaded when the map tab is activated
 */
(function() {
  let map = null;
  let mapInitialized = false;

  // Get marker size tier based on artwork count
  function getMarkerTier(count) {
    if (count >= 16) return 'lg';
    if (count >= 6) return 'md';
    return 'sm';
  }

  // Get icon size based on tier
  function getIconSize(tier) {
    switch (tier) {
      case 'lg': return 40;
      case 'md': return 32;
      default: return 24;
    }
  }

  // Create a div icon with the artwork count and tiered sizing
  function createCountIcon(count) {
    const tier = getMarkerTier(count);
    const size = getIconSize(tier);
    return L.divIcon({
      className: 'map-count-marker',
      html: `<div class="map-count-circle map-count-circle--${tier}">${count}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });
  }

  // Create the legend element
  function createLegend() {
    const legend = document.createElement('div');
    legend.className = 'map-legend';
    legend.innerHTML = `
      <div class="map-legend-title">Artworks</div>
      <div class="map-legend-items">
        <div class="map-legend-item">
          <span class="map-legend-dot map-legend-dot--sm"></span>
          <span>1–5</span>
        </div>
        <div class="map-legend-item">
          <span class="map-legend-dot map-legend-dot--md"></span>
          <span>6–15</span>
        </div>
        <div class="map-legend-item">
          <span class="map-legend-dot map-legend-dot--lg"></span>
          <span>16+</span>
        </div>
      </div>
    `;
    return legend;
  }

  function initMap() {
    if (mapInitialized) {
      if (map) {
        map.invalidateSize();
      }
      return;
    }

    const container = document.getElementById('map-container');
    const dataEl = document.getElementById('map-locations-data');

    if (!container || !dataEl) return;

    let locations;
    try {
      locations = JSON.parse(dataEl.textContent);
    } catch (e) {
      console.error('Failed to parse map locations data:', e);
      return;
    }

    if (!locations || locations.length === 0) {
      container.innerHTML = '<p class="no-artworks">No locations with coordinates available.</p>';
      return;
    }

    // Initialize map centered on Italy
    map = L.map('map-container').setView([43.0, 12.5], 6);

    // Add CartoDB Positron tiles for clean, minimal black & white aesthetic
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(map);

    // Add markers for each location
    const markers = [];
    locations.forEach(loc => {
      if (loc.lat && loc.lng) {
        const icon = createCountIcon(loc.artworkCount);

        const marker = L.marker([loc.lat, loc.lng], { icon }).addTo(map);

        const artworkText = loc.artworkCount === 1 ? '1 artwork' : `${loc.artworkCount} artworks`;
        const popupContent = `
          <div class="map-popup">
            <h4>${escapeHtml(loc.title)}</h4>
            <p class="map-popup-count">${artworkText}</p>
            <a href="locations/${loc.id}.html" class="map-popup-link">View Collection →</a>
          </div>
        `;

        marker.bindPopup(popupContent, {
          className: 'map-popup-container'
        });

        markers.push(marker);
      }
    });

    // Fit map to show all markers if there are any
    if (markers.length > 0) {
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.1));
    }

    // Add legend to container
    container.appendChild(createLegend());

    mapInitialized = true;
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Listen for map tab activation
  document.addEventListener('map-tab-shown', function() {
    setTimeout(initMap, 50);
  });

  // Also check if map tab is already active on page load
  document.addEventListener('DOMContentLoaded', function() {
    const mapPanel = document.querySelector('.tab-panel[data-tab="map"]');
    if (mapPanel && mapPanel.classList.contains('active')) {
      initMap();
    }
  });
})();
