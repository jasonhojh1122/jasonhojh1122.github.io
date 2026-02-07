/**
 * Tab navigation for index page
 * Supports URL parameter ?tab=<tabname> to remember/share active tab
 */
document.addEventListener('DOMContentLoaded', () => {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  // Only initialize if we have tabs
  if (tabBtns.length === 0) return;

  function activateTab(tabName) {
    const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    const panel = document.querySelector(`.tab-panel[data-tab="${tabName}"]`);

    if (!btn || !panel) return false;

    // Remove active from all
    tabBtns.forEach(b => b.classList.remove('active'));
    tabPanels.forEach(p => p.classList.remove('active'));

    // Add active to target
    btn.classList.add('active');
    panel.classList.add('active');

    // Dispatch event for map tab to enable lazy initialization
    if (tabName === 'map') {
      document.dispatchEvent(new CustomEvent('map-tab-shown'));
    }

    // Dispatch event for trip tab to enable lazy initialization
    if (tabName === 'trip') {
      document.dispatchEvent(new CustomEvent('trip-tab-shown'));
    }

    return true;
  }

  function updateUrlParam(tabName) {
    const url = new URL(window.location);
    url.searchParams.set('tab', tabName);
    history.replaceState(null, '', url);
  }

  // Check URL parameter on load
  const urlParams = new URLSearchParams(window.location.search);
  const tabParam = urlParams.get('tab');
  if (tabParam) {
    activateTab(tabParam);
    // Scroll to hash fragment after tab is visible
    if (window.location.hash) {
      const target = document.getElementById(window.location.hash.slice(1));
      if (target) target.scrollIntoView();
    }
  }

  // Handle tab clicks
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      activateTab(tabName);
      updateUrlParam(tabName);
    });
  });
});
