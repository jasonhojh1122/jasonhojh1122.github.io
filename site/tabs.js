/**
 * Tab navigation for index page
 */
document.addEventListener('DOMContentLoaded', () => {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  // Only initialize if we have tabs
  if (tabBtns.length === 0) return;

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active from all
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));

      // Add active to clicked
      btn.classList.add('active');
      const targetPanel = document.querySelector(`.tab-panel[data-tab="${btn.dataset.tab}"]`);
      if (targetPanel) {
        targetPanel.classList.add('active');

        // Dispatch event for map tab to enable lazy initialization
        if (btn.dataset.tab === 'map') {
          document.dispatchEvent(new CustomEvent('map-tab-shown'));
        }
      }
    });
  });
});
