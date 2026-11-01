/**
 * cPanel entry point — the "Application startup file" in Setup Node.js App.
 * ---------------------------------------------------------------------------
 * WebHoster.pk (and every cPanel host with the CloudLinux Node.js Selector)
 * runs Node apps under Phusion Passenger. Point the panel at THIS file, never at
 * src/server.js. Two things about how Passenger starts an app make server.js
 * unusable as the startup file, and both fail without a useful message:
 *
 *   1. PASSENGER LOADS THE STARTUP FILE WITH require().
 *      This package is "type": "module", so every .js file in it is an ES
 *      module. On Node releases older than 20.19 / 22.12, require() of an ES
 *      module throws ERR_REQUIRE_ESM, and the panel reports only "It appears
 *      that the application has not started". A .cjs file is CommonJS whatever
 *      package.json says, so require() works on every version the panel offers,
 *      and the dynamic import() below crosses into ESM legitimately.
 *
 *   2. server.js ONLY STARTS ITSELF WHEN IT IS THE SCRIPT NODE WAS GIVEN.
 *      This one bites on every Node version, including those that can require()
 *      ES modules. Under Passenger, process.argv[1] is Passenger's own loader,
 *      so that check is false: server.js loads, defines startServer, and nothing
 *      ever listens. Passenger waits for a listen() that never comes and gives
 *      up after its start timeout with a generic 503. So this file calls
 *      startServer() itself.
 *
 * The PORT is irrelevant here. Passenger replaces http.Server.prototype.listen
 * before loading this file, so the server's listen(PORT) is redirected to a
 * private socket Passenger chooses. The callback still fires and boot carries on
 * exactly as it does locally.
 *
 * Also runs as plain `node cpanel-start.cjs`, e.g. in the cPanel terminal, where
 * it binds PORT like `npm start` does. server.js does not start a second copy:
 * its own check sees this file as argv[1], not itself.
 */
'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

/*
 * Graceful shutdown under Passenger.
 *
 * When Passenger stops or restarts the app (the panel's Restart button, an idle
 * timeout, a redeploy), its loader emits 'exit' on this global if anything is
 * listening, and otherwise calls process.exit(0) on the spot — abandoning
 * in-flight requests, including a half-written order. Turning it into SIGTERM
 * routes it through server.js's own drain-then-close shutdown.
 *
 * Absent outside Passenger (LiteSpeed's loader, plain node), where the real
 * signal arrives instead and the same handler runs.
 */
if (global.PhusionPassenger && typeof global.PhusionPassenger.on === 'function') {
  global.PhusionPassenger.on('exit', () => process.kill(process.pid, 'SIGTERM'));
}

const entry = pathToFileURL(path.join(__dirname, 'src', 'server.js')).href;

import(entry)
  .then(({ startServer }) => startServer())
  .catch((error) => {
    /*
     * stderr is the one channel cPanel keeps: it lands in stderr.log in the
     * application root (and Passenger's log). Configuration errors from
     * env.config.js are printed there too, before it exits.
     */
    console.error('\n✖ Feather & Bone API failed to start under cPanel.');
    console.error(error && error.stack ? error.stack : error);
    console.error("  Check backend/.env (or the panel's environment variables), then press Restart.\n");
    process.exit(1);
  });
