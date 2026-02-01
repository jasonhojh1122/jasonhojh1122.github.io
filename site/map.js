/**
 * Interactive map for location pins with heat map visualization
 * Marker size and color intensity indicate artwork count
 * Lazy-loaded when the map tab is activated
 */
(function() {
  let map = null;
  let mapInitialized = false;

  // Color gradient from light gold to deep terracotta based on artwork count
  function getMarkerStyle(count, maxCount) {
    // Normalize count to 0-1 range (using sqrt for better distribution)
    const normalized = maxCount > 0 ? Math.sqrt(count) / Math.sqrt(maxCount) : 0;

    // Size: minimum 12px, maximum 40px
    const radius = 12 + (normalized * 28);

    // Color interpolation from gold (#C7A66B) to terracotta (#B85C38) to deep terracotta (#8B3A2F)
    let color;
    if (normalized < 0.5) {
      // Gold to terracotta
      const t = normalized * 2;
      color = interpolateColor('#C7A66B', '#B85C38', t);
    } else {
      // Terracotta to deep terracotta
      const t = (normalized - 0.5) * 2;
      color = interpolateColor('#B85C38', '#8B3A2F', t);
    }

    // Opacity: 0.6 to 0.9 based on count
    const opacity = 0.6 + (normalized * 0.3);

    return { radius, color, opacity };
  }

  function interpolateColor(color1, color2, t) {
    const r1 = parseInt(color1.slice(1, 3), 16);
    const g1 = parseInt(color1.slice(3, 5), 16);
    const b1 = parseInt(color1.slice(5, 7), 16);

    const r2 = parseInt(color2.slice(1, 3), 16);
    const g2 = parseInt(color2.slice(3, 5), 16);
    const b2 = parseInt(color2.slice(5, 7), 16);

    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);

    return `rgb(${r}, ${g}, ${b})`;
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

    // Find max artwork count for normalization
    const maxCount = Math.max(...locations.map(l => l.artworkCount));

    // Initialize map centered on Italy
    map = L.map('map-container').setView([43.0, 12.5], 6);

    // Add OpenStreetMap tiles with a subtle style
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(map);

    // Sort locations by artwork count (ascending) so larger circles render on top
    const sortedLocations = [...locations].sort((a, b) => a.artworkCount - b.artworkCount);

    // Add circle markers for each location
    const markers = [];
    sortedLocations.forEach(loc => {
      if (loc.lat && loc.lng) {
        const style = getMarkerStyle(loc.artworkCount, maxCount);

        const circle = L.circleMarker([loc.lat, loc.lng], {
          radius: style.radius,
          fillColor: style.color,
          fillOpacity: style.opacity,
          color: '#FFFDF9',
          weight: 2,
          opacity: 1
        }).addTo(map);

        const artworkText = loc.artworkCount === 1 ? '1 artwork' : `${loc.artworkCount} artworks`;
        const popupContent = `
          <div class="map-popup">
            <h4><a href="locations/${loc.id}.html">${escapeHtml(loc.title)}</a></h4>
            ${loc.city ? `<p class="map-popup-city">${escapeHtml(loc.city)}</p>` : ''}
            <p class="map-popup-count">${artworkText}</p>
          </div>
        `;

        circle.bindPopup(popupContent, {
          className: 'map-popup-container'
        });

        markers.push(circle);
      }
    });

    // Add legend
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = function() {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = `
        <div class="map-legend-title">Artworks</div>
        <div class="map-legend-items">
          <div class="map-legend-item">
            <span class="map-legend-circle map-legend-sm"></span>
            <span>Few</span>
          </div>
          <div class="map-legend-item">
            <span class="map-legend-circle map-legend-md"></span>
            <span>Some</span>
          </div>
          <div class="map-legend-item">
            <span class="map-legend-circle map-legend-lg"></span>
            <span>Many</span>
          </div>
        </div>
      `;
      return div;
    };
    legend.addTo(map);

    // Fit map to show all markers if there are any
    if (markers.length > 0) {
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.1));
    }

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
