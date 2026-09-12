/* works.js — each box has a reel: dots follow the reel, dots drive the reel,
   a video slide swaps its poster for the player when pressed, and a
   screenshot opens full-size. The wall behind the sheet drifts up slowly
   as the page scrolls. Nothing else. The Photos page shares it: its prints
   open in the same lightbox, with the camera's note underneath. */

(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.remove('no-js');
  root.classList.add('js');

  /* --- the wall ------------------------------------------------------ */
  /* The frame is taller than the window by --drift (works.css). It slides
     up by exactly that much between the top and the bottom of the page, so
     however long the page is, the wall moves at a steady fraction of the
     scroll and never runs out. */

  (function () {
    var frame = document.querySelector('.ground .frame');
    if (!frame) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var travel = 0, range = 1, ticking = false;

    function measure() {
      travel = frame.offsetHeight - window.innerHeight;
      range  = Math.max(1, root.scrollHeight - window.innerHeight);
      place();
    }
    function place() {
      ticking = false;
      var y = Math.min(1, Math.max(0, window.scrollY / range));
      frame.style.transform = 'translate3d(0,' + (-y * travel).toFixed(1) + 'px,0)';
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(place); }
    }, { passive: true });
    window.addEventListener('resize', measure);
    if (window.ResizeObserver) new ResizeObserver(measure).observe(document.body);
    measure();
  })();

  /* --- reels --------------------------------------------------------- */
  /* Each reel loops: a copy of the last slide sits before the first and a
     copy of the first after the last, so there is always a next slide to
     scroll onto. Coming to rest on a copy jumps, without animation, to
     the slide it copies, which looks the same, so the seam is never seen.
     The dots follow the scroll as it moves, not once it has stopped. */

  Array.prototype.forEach.call(document.querySelectorAll('.media'), function (media) {
    var reel = media.querySelector('.reel');
    var dots = Array.prototype.slice.call(media.querySelectorAll('.dots button'));
    var slides = Array.prototype.slice.call(reel.children);
    var n = slides.length;
    if (n < 2) return;

    slides.forEach(function (s, i) { s.dataset.index = i; });
    [slides[n - 1], slides[0]].forEach(function (s, k) {
      var copy = s.cloneNode(true);
      copy.dataset.clone = '';
      copy.setAttribute('aria-hidden', 'true');
      Array.prototype.forEach.call(copy.querySelectorAll('a, button'), function (el) { el.tabIndex = -1; });
      if (copy.matches('a')) copy.tabIndex = -1;
      if (k === 0) reel.insertBefore(copy, slides[0]); else reel.appendChild(copy);
    });

    var at = 0;                                   /* the slide the dots show */
    function width() { return reel.clientWidth; }
    function pos()   { return reel.scrollLeft / width() - 1; }   /* -1 (copy) .. n (copy) */
    function real(i) { return ((i % n) + n) % n; }
    function jump(i) { reel.scrollTo({ left: (i + 1) * width(), behavior: 'auto' }); }
    function mark(i) {
      if (i === at) return;
      at = i;
      dots.forEach(function (d, k) {
        if (k === i) d.setAttribute('aria-selected', 'true');
        else d.removeAttribute('aria-selected');
      });
    }
    function go(i) {                              /* i may be -1 or n: onto a copy, then settle */
      reel.scrollTo({ left: (i + 1) * width(), behavior: 'smooth' });
      mark(real(i));
    }
    function settle() {                           /* at rest on a copy: jump to the real slide */
      var p = pos();
      if (Math.abs(p - Math.round(p)) > 0.02) return;
      var i = Math.round(p);
      if (i < 0 || i >= n) jump(real(i));
    }

    jump(0);
    var ticking = false, t;
    reel.addEventListener('scroll', function () {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(function () { ticking = false; mark(real(Math.round(pos()))); });
      }
      if (!('onscrollend' in window)) { clearTimeout(t); t = setTimeout(settle, 80); }
    }, { passive: true });
    reel.addEventListener('scrollend', settle);
    window.addEventListener('resize', function () { jump(at); });

    dots.forEach(function (d, k) {
      d.addEventListener('click', function () { go(k); });
    });

    reel.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(at + 1); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); go(at - 1); }
    });
  });

  /* a copy of a slide stands in for the slide it copies: anything done to
     it is done to the real one, after an unseen jump onto it */
  function original(slide) {
    if (!('clone' in slide.dataset)) return slide;
    var reel = slide.parentNode;
    var real = reel.querySelector('.slide[data-index="' + slide.dataset.index + '"]:not([data-clone])');
    reel.scrollTo({ left: (Number(slide.dataset.index) + 1) * reel.clientWidth, behavior: 'auto' });
    return real;
  }

  /* --- video ----------------------------------------------------------- */

  document.addEventListener('click', function (e) {
    var play = e.target.closest('.play');
    if (!play) return;
    var slide = original(play.closest('.slide'));
    var id = slide.dataset.yt;
    var f = document.createElement('iframe');
    f.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0';
    f.title = 'Video';
    f.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen';
    f.setAttribute('allowfullscreen', '');
    slide.replaceChildren(f);
  });

  /* --- lightbox -------------------------------------------------------- */

  var light = document.getElementById('light');
  if (!light || typeof light.showModal !== 'function') return;

  var img = light.querySelector('img');
  var note = light.querySelector('.light-note');   /* the photos page only */
  var set = [];        /* the shots of the box that was opened */
  var at  = 0;

  /* the note under a photograph: when and where on one line, the exposure
     on the next, from the data the build wrote on the link */
  function caption(d) {
    note.textContent = '';
    var l1 = line('when', [d.when, d.where && link(d.where, d.map)]);
    var l2 = line('expo', [d.expo]);
    if (l1) note.appendChild(l1);
    if (l2) note.appendChild(l2);
  }
  function line(cls, parts) {
    var el = null;
    parts.forEach(function (p) {
      if (!p) return;
      if (!el) { el = document.createElement('span'); el.className = cls; }
      if (typeof p === 'string') { var s = document.createElement('span'); s.textContent = p; p = s; }
      el.appendChild(p);
    });
    return el;
  }
  function link(text, href) {
    var el = document.createElement(href ? 'a' : 'span');
    el.textContent = text;
    if (href) { el.href = href; el.target = '_blank'; el.rel = 'noopener'; }
    return el;
  }

  function open(i) {
    at = (i + set.length) % set.length;
    var a = set[at];
    img.src = a.href;
    img.alt = a.querySelector('img').alt;
    if (note) caption(a.dataset);
    if (!light.open) light.showModal();
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest('.shot');
    if (!a) return;
    e.preventDefault();
    a = original(a);
    set = Array.prototype.slice.call(a.closest('.reel, .board').querySelectorAll('.shot:not([data-clone])'));
    open(set.indexOf(a));
  });

  light.addEventListener('click', function (e) {
    var step = e.target.closest('[data-step]');
    if (step) { open(at + Number(step.dataset.step)); return; }
    if (e.target.closest('[data-close]') || e.target === light) light.close();
  });

  light.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') open(at + 1);
    if (e.key === 'ArrowLeft')  open(at - 1);
  });

  light.addEventListener('close', function () {
    img.removeAttribute('src');
    if (set[at]) set[at].focus();
  });
})();
