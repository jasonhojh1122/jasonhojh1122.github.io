/* analytics.js — loads Umami (cookieless) and tells it what gets clicked:
   which link, button, picture or video, and on which page. Nothing typed into a
   field is ever read. The Italian art pages pull this in from italy/tabs.js;
   every other page has its own script tag. */

(function () {
  'use strict';

  /* Umami is asked for through this site's own /dz/ path (a Cloudflare
     Worker, tools/umami-proxy-worker.js, passes it on). If that path is not
     answering, the tracker is fetched from Umami directly instead. */

  function load(src, host, fallback) {
    var s = document.createElement('script');
    s.defer = true;
    s.src = src;
    s.setAttribute('data-website-id', '2b3ed455-15e9-42fb-a838-b1b119f4f8d4');
    /* only the live site counts; a local preview stays out of the numbers */
    s.setAttribute('data-domains', 'www.deithzireael.net,deithzireael.net');
    if (host) s.setAttribute('data-host-url', host);
    if (fallback) s.onerror = fallback;
    document.head.appendChild(s);
  }

  load('/dz/script.js', location.origin + '/dz', function () {
    load('https://cloud.umami.is/script.js');
  });

  /* --- what a click is called ------------------------------------------- */

  function clean(t) {
    return (t || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  }

  function label(el) {
    var img = el.querySelector('img[alt]');
    return clean(el.getAttribute('data-track')) ||
           clean(el.getAttribute('aria-label')) ||
           clean(el.textContent) ||
           clean(img && img.alt) ||
           clean(el.title) ||
           clean(el.id || el.className) ||
           '(unnamed)';
  }

  /* the box a thing sits in: the project a video belongs to, say */
  function within(el) {
    var box = el.closest('article, section, li');
    var h = box && box.querySelector('h1, h2, h3');
    return h ? clean(h.textContent) : '';
  }

  /* the file name is what tells one picture from the next */
  function file(src) {
    return clean(decodeURIComponent((src || '').split(/[?#]/)[0].split('/').pop()));
  }

  function send(name, data) {
    for (var k in data) if (!data[k]) delete data[k];
    window.umami.track(name, data);
  }

  /* --- clicks ---------------------------------------------------------------
     Caught on the way down, so a handler that stops the event further in
     cannot hide it. Umami sends with keepalive, so a click that leaves the
     page is still delivered. */

  document.addEventListener('click', function (e) {
    if (!window.umami || !e.target.closest) return;
    var el = e.target.closest('a[href], button, summary, [role="button"]');

    /* a bare picture, linked to nothing */
    if (!el) {
      if (e.target.tagName !== 'IMG') return;
      var src = e.target.currentSrc || e.target.src;
      send('image', { label: /^(img|image)?$/i.test(clean(e.target.alt)) ? file(src) : clean(e.target.alt), file: file(src), 'in': within(e.target) });
      return;
    }

    /* a video's play button: say which project, and which video */
    var video = el.closest('[data-yt]');
    if (video) {
      send('video', { label: within(el) || label(el), video: video.getAttribute('data-yt') });
      return;
    }

    if (el.tagName !== 'A') {
      send(el.tagName === 'SUMMARY' ? 'toggle' : 'button', { label: label(el), 'in': within(el) });
      return;
    }

    /* a picture that opens larger: a screenshot, a photograph, a game's cover */
    var pic = el.querySelector('img');
    if (pic || /\.(jpe?g|png|gif|webp|avif|svg)$/i.test(el.pathname)) {
      send('image', {
        label: label(el),
        file: file(pic && !/\.(jpe?g|png|gif|webp|avif|svg)$/i.test(el.pathname) ? pic.currentSrc || pic.src : el.href),
        'in': within(el)
      });
      return;
    }

    var out = el.host && el.host !== location.host;
    send(out ? 'outbound' : 'link', {
      label: label(el),
      to: out ? el.href : el.pathname + el.hash
    });
  }, true);
})();
