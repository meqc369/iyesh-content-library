(() => {
  const navs = document.querySelectorAll('.primary-nav');
  if (!navs.length || !window.matchMedia('(max-width: 760px)').matches) return;
  navs.forEach(nav => {
    const active = nav.querySelector('.active');
    if (!active || nav.scrollWidth <= nav.clientWidth) return;
    const target = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
    nav.scrollLeft = Math.max(0, Math.min(target, nav.scrollWidth - nav.clientWidth));
  });
})();
