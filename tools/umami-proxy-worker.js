/* umami-proxy-worker.js — a Cloudflare Worker, not part of the site itself.
   It answers www.deithzireael.net/dz/* by passing the request on to Umami,
   so the browser only ever talks to this domain. Deployed by hand in the
   Cloudflare dashboard; this copy is kept here for the record.

     /dz/script.js  ->  https://cloud.umami.is/script.js     (the tracker)
     /dz/api/send   ->  https://gateway.umami.is/api/send    (what it reports) */

const ROUTES = {
  '/dz/script.js': 'https://cloud.umami.is/script.js',
  '/dz/api/send':  'https://gateway.umami.is/api/send'
};

export default {
  async fetch(request) {
    const target = ROUTES[new URL(request.url).pathname];
    if (!target) return new Response('Not found', { status: 404 });

    const headers = new Headers(request.headers);
    headers.delete('cookie');
    /* pass the visitor's address along, so countries are still theirs */
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) headers.set('X-Forwarded-For', ip);

    return fetch(target, {
      method: request.method,
      headers: headers,
      body: request.method === 'POST' ? request.body : undefined
    });
  }
};
