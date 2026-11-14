"use strict";
var https = require("https");
var fs = require("fs");
var crypto = require("crypto");
var browser = require("./browser");
var pack = require("./pack");
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function failure(status, text) {
  var e = new Error(text);
  e.statusCode = status;
  return e;
}
function equal(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  var x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function secret() {
  return crypto.randomBytes(32).toString("hex");
}
function code() {
  var n;
  do {
    n = crypto.randomBytes(4).readUInt32BE(0);
  } while (n >= 4200000000);
  return ("00000000" + String(n % 100000000)).slice(-8);
}
function fingerprint(cert) {
  var pem = String(cert);
  var match =
    /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/.exec(pem);
  if (!match) throw new Error("TLS PEM certificate required");
  return crypto
    .createHash("sha256")
    .update(Buffer.from(match[1].replace(/\s/g, ""), "base64"))
    .digest("hex");
}
function Transfer(o) {
  this.library = o.library;
  this.mapTiles = new (require("./map-tiles").MapTiles)();
  this.network = o.network || null;
  this.status =
    o.status ||
    function () {
      return {};
    };
  this.tls = o.tls;
  this.host = o.host;
  this.bindHost = o.bindHost !== undefined ? o.bindHost : o.host;
  this.devMode = !!o.devMode;
  this.httpPort = o.httpPort === undefined ? (o.port === undefined ? 8765 : o.port) : o.httpPort;
  this.httpsPort = o.httpsPort === undefined ? 8766 : o.httpsPort;
  this.now =
    o.nowMs ||
    function () {
      var t = process.hrtime();
      return t[0] * 1000 + t[1] / 1e6;
    };
  this.bandwidth = Math.max(
    32768,
    Math.min(1048576, o.bytesPerSecond || 1048576)
  );
  this.httpServer = null;
  this.httpsServer = null;
  this.sockets = new Set();
  this.streams = new Set();
  this.active = 0;
  this.generation = 0;
  this.current = null;
  this.session = null;
  this.claimed = false;
  this.attempts = [];
  this.addressAttempts = Object.create(null);
  this.serial = Promise.resolve();
  this.desiredVisit = null;
}
Transfer.prototype.alive = function () {
  if (this.devMode) return true;
  if (this.current && this.now() - this.lastBeat >= 3000) {
    this.stop();
    return false;
  }
  return !!this.current;
};
Transfer.prototype.visit = function (id, observedAtMs) {
  var at = observedAtMs === undefined ? this.now() : observedAtMs;
  if (
    typeof at !== "number" ||
    !isFinite(at) ||
    at > this.now() ||
    this.now() - at >= 3000
  )
    return this.stop();
  var self = this;
  if (typeof id !== "string" || !id || id.length > 128)
    return Promise.reject(new Error("Invalid transfer visit"));
  this.desiredVisit = id;
  this.serial = this.serial
    .catch(function () {})
    .then(async function () {
      if (self.desiredVisit !== id) return;
      if (self.alive() && self.current === id) {
        self.heartbeat(id, at);
        return;
      }
      await self.stop(true);
      if (self.desiredVisit !== id) return;
      if (self.now() - at >= 3000) return self.stop();
      if (
        !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(self.host || "") ||
        self.host.split(".").some(function (x) {
          return Number(x) > 255;
        })
      )
        throw new Error("Car Wi-Fi IPv4 required");
      self.fp = fingerprint(self.tls.cert);
      self.code = code();
      self.current = id;
      self.lastBeat = at;
      self.claimed = false;
      self.session = null;
      self.attempts = [];
      self.addressAttempts = Object.create(null);
      var generation = ++self.generation;
      var tlsOptions = Object.assign({}, self.tls, {
        minVersion: "TLSv1.2",
        secureOptions:
          require("constants").SSL_OP_NO_TLSv1 |
          require("constants").SSL_OP_NO_TLSv1_1,
      });
      function onRequest(req, res) {
        self.handle(req, res, generation).catch(function (e) {
          if (!res.headersSent)
            self.json(res, e.statusCode || 500, {
              error: e.statusCode ? e.message : "Transfer unavailable",
            });
          else res.destroy();
        });
      }
      function bind(httpMod, options, port) {
        return new Promise(function (resolve, reject) {
          var server = options ? httpMod.createServer(options, onRequest) : httpMod.createServer(onRequest);
          server.maxHeadersCount = 32;
          server.headersTimeout = 2000;
          server.timeout = 10000;
          server.keepAliveTimeout = 3000;
          server.on("connection", function (socket) {
            socket.setTimeout(10000, function () {
              socket.destroy();
            });
            if (!self.current || self.sockets.size >= 16) {
              socket.destroy();
              return;
            }
            self.sockets.add(socket);
            socket.on("close", function () {
              self.sockets.delete(socket);
            });
          });
          server.once("error", reject);
          server.listen(port, self.bindHost || self.host, function () {
            server.removeListener("error", reject);
            resolve(server);
          });
        });
      }
      var http = require("http");
      await bind(http, undefined, self.httpPort)
        .then(function (server) {
          self.httpServer = server;
          self.boundHttpPort = server.address().port;
        })
        .catch(function (e) {
          self.stop();
          throw e;
        });
      await bind(https, tlsOptions, self.httpsPort)
        .then(function (server) {
          self.httpsServer = server;
          self.boundHttpsPort = server.address().port;
        })
        .catch(function (e) {
          self.stop();
          throw e;
        });
      if(self.network){try{await self.network.open(self.host,[self.boundHttpPort,self.boundHttpsPort]);}catch(e){await self.stop();throw e;}}
      if (
        self.desiredVisit !== id ||
        self.generation !== generation ||
        self.now() - at >= 3000
      ) {
        await self.stop(true);
        if (self.generation === generation) await self.stop();
        return;
      }
      var onError = function () {
        self.stop();
      };
      self.httpServer.on("error", onError);
      self.httpsServer.on("error", onError);
      self.timer = setInterval(function () {
        self.alive();
      }, 100);
      if (self.timer.unref) self.timer.unref();
    });
  return this.serial;
};
Transfer.prototype.heartbeat = function (id, observedAtMs) {
  var at = observedAtMs === undefined ? this.now() : observedAtMs;
  if (
    this.alive() &&
    this.current === id &&
    typeof at === "number" &&
    isFinite(at) &&
    at <= this.now() &&
    at >= this.lastBeat &&
    this.now() - at < 3000
  )
    this.lastBeat = at;
};
Transfer.prototype.stop = function (preserveVisit) {
  if (!preserveVisit) this.desiredVisit = null;
  this.current = null;
  this.code = "";
  this.fp = "";
  this.session = null;
  this.claimed = false;
  this.boundHttpPort = null;
  this.boundHttpsPort = null;
  ++this.generation;
  if (this.timer) clearInterval(this.timer);
  this.timer = null;
  this.streams.forEach(function (s) {
    s.destroy();
  });
  this.sockets.forEach(function (s) {
    s.destroy();
  });
  this.sockets.clear();
  var httpServer = this.httpServer;
  var httpsServer = this.httpsServer;
  this.httpServer = null;
  this.httpsServer = null;
  function close(server, done) {
    if (!server) return done();
    try {
      server.close(done);
    } catch (e) {
      done();
    }
  }
  return new Promise(function (resolve) {
  var left = 0;
    function step() {
      left--;
      if (left <= 0) resolve();
    }
    if (httpServer) {
      left++;
      close(httpServer, step);
    }
    if (httpsServer) {
      left++;
      close(httpsServer, step);
    }
    if (!left) resolve();
  }).then(function(){if(this.network)return this.network.close();}.bind(this));
};
Transfer.prototype.acceptHost = function (req) {
  var host = req.headers.host || "";
  if (this.devMode || /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) return true;
  return (
    host === this.host + ":" + this.boundHttpPort ||
    host === this.host + ":" + this.boundHttpsPort ||
    host === this.host
  );
};
Transfer.prototype.info = function () {
  var on = this.alive();
  return {
    on: on,
    endpoint: on ? "https://" + this.host + ":" + this.boundHttpsPort : "",
    url:
      on && !this.claimed
        ? "http://" + this.host + ":" + this.boundHttpPort + "/?code=" + this.code
        : "",
    code: on && !this.claimed ? this.code : "",
    fingerprint: on ? this.fp : "",
    paired: !!this.session,
    error: "",
  };
};
Transfer.prototype.json = function (res, status, value) {
  if (res.destroyed || res.writableEnded) return;
  var b = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": b.length,
  });
  res.end(b);
};
Transfer.prototype.headers = function (res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self' blob: data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org; media-src 'self' blob: data:; connect-src 'self' blob: https://api.github.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
};
Transfer.prototype.body = function (req) {
  return new Promise(function (resolve, reject) {
    var chunks = [],
      n = 0;
    req.on("data", function (b) {
      n += b.length;
      if (n > 2048) {
        reject(failure(413, "Request too large"));
        req.destroy();
      } else chunks.push(b);
    });
    req.on("end", function () {
      try {
        var x = JSON.parse(Buffer.concat(chunks).toString());
        if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error();
        resolve(x);
      } catch (e) {
        reject(failure(400, "Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
};
Transfer.prototype.origin = function (req) {
  var scheme = req.socket && req.socket.encrypted ? "https" : "http";
  var port =
    req.socket && req.socket.encrypted
      ? this.boundHttpsPort
      : this.boundHttpPort;
  return scheme + "://" + this.host + ":" + port;
};
Transfer.prototype.sameOrigin = function (req) {
  if (this.devMode) return true;
  return req.headers.origin === this.origin(req);
};
Transfer.prototype.auth = function (req, mutation) {
  if (this.devMode && !mutation) {
    if (!this.session) {
      this.session = { token: secret(), csrf: secret(), clientId: "00000000-0000-4000-8000-000000000000" };
    }
    return this.session;
  }
  var session = this.session;
  if (!session) {
    if (this.devMode) {
      this.session = { token: secret(), csrf: secret(), clientId: "00000000-0000-4000-8000-000000000000" };
      return this.session;
    }
    throw failure(401, "Pair on the car connection screen");
  }
  var bearer = req.headers.authorization;
  if (bearer && equal(bearer, "Bearer " + session.token)) {
    return session;
  }
  var cookie = /(?:^|;\s*)bv_session=([a-f0-9]{64})(?:;|$)/.exec(
    req.headers.cookie || ""
  );
  if (cookie && equal(cookie[1], session.token)) {
    if (
      mutation &&
      (!this.sameOrigin(req) || !equal(req.headers["x-bv-csrf"], session.csrf))
    )
      throw failure(403, "Same-origin CSRF token required");
    return session;
  }
  if (this.devMode) {
    return session;
  }
  throw failure(401, "Invalid credentials");
};
Transfer.prototype.handle = async function (req, res, generation) {
  this.headers(res);
  var self = this;
  function live() {
    if (!self.alive() || self.generation !== generation)
      throw failure(403, "Connection screen closed");
  }
  live();
  if (!this.acceptHost(req)) throw failure(403, "Invalid host");
  var route = (req.url || "").split("?")[0];
  if (req.method === "GET" || req.method === "HEAD") {
    var asset = browser.asset(route);
    if (asset) {
      res.writeHead(200, {
        "Content-Type": asset.type,
        "Content-Length": Buffer.byteLength(asset.body),
      });
      if (req.method === "HEAD") {
        res.end();
      } else {
        res.end(asset.body);
      }
      return;
    }
  }
  if (route === "/api/v1/version" && req.method === "GET") {
    var installedVersion = require('./version.json');
    this.json(res, 200, {version:installedVersion.version,repository:'Hexphase/BimmerVision'});
    return;
  }
  var tileMatch = /^\/api\/v1\/tiles\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(route);
  if (tileMatch && req.method === "GET") {
    try {
      var tileBytes = await this.mapTiles.read(tileMatch[1], tileMatch[2], tileMatch[3], req.headers.referer);
      res.writeHead(200, {"Content-Type":"image/png","Content-Length":tileBytes.length,"Cache-Control":"public, max-age=604800"});
      res.end(tileBytes);
    } catch (error) {
      res.writeHead(503, {"Cache-Control":"no-store"});
      res.end();
    }
    return;
  }
  if (route === "/api/v1/pair" && req.method === "POST") {
    if (
      (req.headers.cookie && !req.headers.origin) ||
      (req.headers.origin && !this.sameOrigin(req))
    )
      throw failure(403, "Pair from this origin only");
    var now = this.now(),
      address = req.socket.remoteAddress || "unknown";
    this.attempts = this.attempts.filter(function (t) {
      return now - t < 60000;
    });
    var local = (this.addressAttempts[address] || []).filter(function (t) {
      return now - t < 60000;
    });
    this.addressAttempts[address] = local;
    if (this.attempts.length >= 20 || local.length >= 5) {
      res.setHeader("Retry-After", "60");
      throw failure(429, "Too many pairing attempts");
    }
    var body = await this.body(req);
    live();
    local = this.addressAttempts[address] || [];
    if (this.attempts.length >= 20 || local.length >= 5)
      throw failure(429, "Too many pairing attempts");
    if (this.claimed && !this.devMode)
      throw failure(
        409,
        "Pairing code already claimed; reopen connection screen"
      );
    if (!UUID.test(body.clientId || "") || (!this.devMode && !equal(body.code, this.code))) {
      this.attempts.push(now);
      local.push(now);
      throw failure(401, "Invalid pairing code");
    }
    if (!this.devMode) {
      this.claimed = true;
      this.code = "";
    }
    this.session = { token: secret(), csrf: secret(), clientId: body.clientId };
    if (req.headers.origin)
      res.setHeader(
        "Set-Cookie",
        "bv_session=" +
          this.session.token +
          "; Path=/; HttpOnly; SameSite=Strict" +
          (req.socket && req.socket.encrypted ? "; Secure" : "")
      );
    this.json(res, 200, {
      token: this.session.token,
      csrf: this.session.csrf,
      apiVersion: 1,
    });
    return;
  }
  var mutation = req.method !== "GET";
  var session = this.auth(req, mutation);
  if (route === "/api/v1/logout" && req.method === "POST") {
    this.session = null;
    res.setHeader(
      "Set-Cookie",
      "bv_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" +
        (req.socket && req.socket.encrypted ? "; Secure" : "")
    );
    this.json(res, 200, { loggedOut: true });
    this.streams.forEach(function (s) {
      s.destroy();
    });
    return;
  }
  if (route === "/api/v1/status" && req.method === "GET") {
    var status = await this.status();
    live();
    if (session !== this.session) throw failure(401, "Session revoked");
    this.json(res, 200, Object.assign({}, status, { apiVersion: 1 }));
    return;
  }
  if (route === "/api/v1/speed-limit" && req.method === "GET") {
    var query = require('querystring').parse(req.url.split('?').slice(1).join('?'));
    var limit = query.lat != null && query.lon != null ? await require('./speed-limit').lookup(query.lat, query.lon) : null;
    live();
    if (session !== this.session) throw failure(401, "Session revoked");
    this.json(res, 200, limit || {limit:null, source:'unavailable'});
    return;
  }
  if (route === "/api/v1/recordings" && req.method === "GET") {
    var list = await this.library.list();
    live();
    if (session !== this.session) throw failure(401, "Session revoked");
    this.json(res, 200, { apiVersion: 1, recordings: list });
    return;
  }
  var match =
    /^\/api\/v1\/recordings\/([0-9a-f-]+)(?:\/(capture\.bvr|manifest\.json|mapping\.json|download|lock))?$/.exec(
      route
    );
  if (!match || !UUID.test(match[1])) throw failure(404, "Unknown endpoint");
  if (match[2] === "mapping.json" && req.method === "POST") {
    var mappingBody = await this.body(req);
    var savedMapping = await this.library.setMapping(match[1], mappingBody);
    live();
    this.json(res, 200, savedMapping);
    return;
  }
  if (match[2] === "lock" && req.method === "POST") {
    var rawBody = await this.body(req);
    var isLocked = Boolean(rawBody && rawBody.locked);
    var lockResult = await this.library.setLocked(match[1], isLocked);
    live();
    this.json(res, 200, lockResult);
    return;
  }
  if (req.method === "DELETE" && !match[2]) {
    var removed = await this.library.remove(match[1]);
    live();
    this.json(res, 200, removed);
    return;
  }
  if (req.method !== "GET" || !match[2]) throw failure(404, "Unknown endpoint");
  // Small identity reads must not compete with the long-lived capture stream.
  if (match[2] === "mapping.json") {
    var metadataRelease = await this.library.acquire(match[1]), metadataFd = null;
    var metadataIO = require("./io");
    try {
      var metadataFile = await this.library.resolve(match[1], "mapping.json");
      await metadataIO.safePath(metadataFile, "file");
      metadataFd = await metadataIO.open(metadataFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      var metadataStat = await metadataIO.fstat(metadataFd);
      if (!metadataStat.isFile() || metadataStat.size > 4096) throw failure(400, "Invalid camera metadata");
      var metadataBytes = await metadataIO.readAt(metadataFd, metadataStat.size, 0);
      live();
      if (session !== this.session) throw failure(401, "Session revoked");
      res.writeHead(200, {"Content-Type":"application/json","Content-Length":metadataBytes.length});
      res.end(metadataBytes);
    } catch (error) {
      if (error.code === "ENOENT") throw failure(404, "Camera identity not saved");
      throw error;
    } finally {
      if (metadataFd !== null) await metadataIO.close(metadataFd);
      metadataRelease();
    }
    return;
  }
  if (match[2] === "download") {
    var maxDl = this.devMode ? 16 : 1;
    if (this.active >= maxDl) throw failure(429, "A download is already active");
    this.active++;
    var tarRelease = null;
    try {
      tarRelease = await this.library.acquire(match[1]);
      live();
      if (session !== this.session) throw failure(401, "Session revoked");
      var bundle = await this.library.bundle(match[1]);
      res.writeHead(200, {
        "Content-Type": "application/x-tar",
        "Content-Disposition":
          'attachment; filename="' + match[1] + '.tar"',
        "Cache-Control": "no-store",
      });
      await pack.bundle(res, bundle);
      res.end();
    } finally {
      if (tarRelease) tarRelease();
      this.active--;
    }
    return;
  }
  var maxActive = this.devMode ? 16 : 1;
  if (this.active >= maxActive) throw failure(429, "A download is already active");
  this.active++;
  var release = null,
    source = null;
  try {
    release = await this.library.acquire(match[1]);
    var file = await this.library.resolve(match[1], match[2]);
    live();
    if (session !== this.session) throw failure(401, "Session revoked");
    var stat = await new Promise(function (resolve, reject) {
      fs.stat(file, function (e, s) {
        e ? reject(e) : resolve(s);
      });
    });
    var start = 0,
      end = stat.size - 1,
      range = req.headers.range;
    if (range) {
      var r = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!r || (!r[1] && !r[2])) throw failure(416, "Invalid byte range");
      if (!r[1]) {
        var suffix = Number(r[2]);
        if (!suffix) throw failure(416, "Invalid byte range");
        start = Math.max(0, stat.size - suffix);
      } else {
        start = Number(r[1]);
        if (r[2]) end = Math.min(Number(r[2]), end);
      }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= stat.size
      ) {
        res.setHeader("Content-Range", "bytes */" + stat.size);
        throw failure(416, "Invalid byte range");
      }
    }
    live();
    res.writeHead(
      range ? 206 : 200,
      Object.assign(
        {
          "Content-Type":
            match[2] === "manifest.json"
              ? "application/json"
              : "application/octet-stream",
          "Accept-Ranges": "bytes",
          "Content-Length": Math.max(0, end - start + 1),
        },
        range
          ? { "Content-Range": "bytes " + start + "-" + end + "/" + stat.size }
          : {}
      )
    );
    source = fs.createReadStream(file, {
      start: start,
      end: end,
      highWaterMark: this.devMode ? 262144 : 32768,
      flags: fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    });
    this.streams.add(source);
    await new Promise(function (resolve, reject) {
      var timer = null,
        finished = false;
      async function priority() {
        if (finished) return;
        try {
          if (!self.alive() || session !== self.session) {
            res.destroy();
            done();
            return;
          }
          var status = await self.status();
          if (finished) return;
          if (
            status &&
            ((status.metrics && status.metrics.queuedBytes) ||
              status.queuedBytes) > 0
          ) {
            timer = setTimeout(priority, 25);
            return;
          }
          if ((await self.library.resolve(match[1], match[2])) !== file)
            throw failure(503, "USB recording path changed");
          if (finished) return;
          source.resume();
        } catch (e) {
          done(e);
        }
      }
      function done(e) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        source.destroy();
        res.removeListener("close", closed);
        e ? reject(e) : resolve();
      }
      function closed() {
        done();
      }
      res.on("close", closed);
      source.on("error", done);
      source.on("end", function () {
        res.end();
        done();
      });
      source.on("close", function () {
        if (!finished) {
          res.destroy();
          done();
        }
      });
      source.on("data", function (chunk) {
        source.pause();
        if (!self.alive() || session !== self.session) {
          res.destroy();
          done();
          return;
        }
        var accepted = res.write(chunk),
          elapsed = false,
          drained = accepted;
        function next() {
          if (elapsed && drained && !finished) priority();
        }
        if (!accepted)
          res.once("drain", function () {
            drained = true;
            next();
          });
        if (self.devMode) {
          elapsed = true;
          next();
        } else {
          timer = setTimeout(
            function () {
              elapsed = true;
              next();
            },
            Math.ceil((chunk.length * 1000) / self.bandwidth)
          );
        }
      });
      source.pause();
      timer = setTimeout(priority, 0);
    });
  } finally {
    if (source) {
      this.streams.delete(source);
      source.destroy();
    }
    if (release) release();
    this.active--;
  }
};
module.exports = { Transfer: Transfer };
