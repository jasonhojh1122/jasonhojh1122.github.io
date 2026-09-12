/* main.js — the wall responds to where you are pointing, and nothing else. */

(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.remove('no-js');
  root.classList.add('js');

  var ground = document.querySelector('.ground');
  var cap    = document.getElementById('cap');
  var items  = Array.prototype.slice.call(document.querySelectorAll('.item'));
  var frames = {};

  Array.prototype.forEach.call(document.querySelectorAll('.frame'), function (el) {
    frames[el.dataset.frame] = el;
  });

  var restCap = cap.textContent;
  var fine    = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* --- loading -----------------------------------------------------------
     The resting wall is in the CSS and paints immediately. The other five are
     held behind .is-warm so they queue after the page, not in front of it. */

  var warm = false;

  function warmUp() {
    if (warm) return;
    warm = true;
    ground.classList.add('is-warm');
  }

  if (document.readyState === 'complete') warmUp();
  else window.addEventListener('load', warmUp);
  setTimeout(warmUp, 2500);   /* a stalled asset never holds the wall hostage */

  /* --- showing a frame ---------------------------------------------------- */

  var showing = 'rest';

  function show(name, item) {
    items.forEach(function (el) { el.classList.remove('is-live'); });

    if (warm && name !== showing) {
      if (frames[showing]) frames[showing].classList.remove('is-on');
      if (frames[name])    frames[name].classList.add('is-on');
      showing = name;
    }

    if (item) {
      item.classList.add('is-live');
      cap.textContent = item.dataset.cap +
        (item.classList.contains('is-pending') ? ' · in preparation' : '');
    } else {
      cap.textContent = restCap;
    }
  }

  function rest() { show('rest', null); }

  /* --- pointer ------------------------------------------------------------ */

  items.forEach(function (item) {
    var name = item.dataset.frame;

    if (fine) {
      item.addEventListener('mouseenter', function () { show(name, item); });
    }

    /* On touch, pressing an entry reveals its wall for as long as the press
       lasts; letting go follows the link. Same idea, no hover required. */
    item.addEventListener('pointerdown', function () { show(name, item); });

    item.addEventListener('focus', function () { show(name, item); });
    item.addEventListener('blur',  function () { if (fine) rest(); });

    item.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (item.tagName === 'A') return;   /* the browser handles real links */
      e.preventDefault();
      show(name, item);
    });
  });

  if (fine) {
    document.querySelector('.nav').addEventListener('mouseleave', rest);
  } else {
    document.addEventListener('pointerup', function (e) {
      if (!e.target.closest || !e.target.closest('.item')) rest();
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { rest(); if (document.activeElement) document.activeElement.blur(); }
  });
})();
