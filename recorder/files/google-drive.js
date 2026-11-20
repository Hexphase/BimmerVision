"use strict";
var query = require("querystring"),
  crypto = require("crypto"),
  destination = require("./backup-http").destination;
var SCOPE = "https://www.googleapis.com/auth/drive.file",
  BASE = "https://www.googleapis.com/drive/v3/";
function failure(code, message) {
  var e = Error(message);
  e.code = code;
  return e;
}
function decode(response) {
  if (!response.body || !response.body.length) return {};
  try {
    return JSON.parse(response.body.toString("utf8"));
  } catch (e) {
    throw failure("response", "Google returned an invalid response");
  }
}
function check(response) {
  if (
    (response.status >= 200 && response.status < 300) ||
    response.status === 308
  )
    return;
  var value = decode(response),
    reasons = (value.error && value.error.errors) || [],
    storage = reasons.some(function (e) {
      return e.reason === "storageQuotaExceeded";
    });
  if (storage)
    throw failure(
      "storage-full",
      "REMOTE BACKUP PAUSED -  REMOTE STORAGE FULL",
    );
  if (response.status === 401)
    throw failure("auth-required", "Reconnect Google Drive");
  if (
    response.status === 429 ||
    reasons.some(function (e) {
      return /rateLimitExceeded|userRateLimitExceeded/.test(e.reason);
    })
  )
    throw failure("rate-limit", "Google rate limit; retrying later");
  if (response.status === 404 || response.status === 410)
    throw failure("not-found", "Google upload or file expired");
  if (response.status === 409)
    throw failure("exists", "Google file already exists");
  throw failure(
    response.status >= 500 ? "retry" : "permission",
    "Google Drive request failed (" + response.status + ")",
  );
}
function GoogleDrive(options) {
  var o = options || {};
  this.client = o.client || {};
  this.transport = o.transport;
  this.account = o.account || null;
  this.now = o.now || Date.now;
  this.commitAccount = o.commitAccount || async function () {};
  this.setup = null;
  this.pendingAccount = null;
  this.finishingSetup = null;
  this.epoch = 0;
  this.committing = null;
}
GoogleDrive.prototype.commit = async function (candidate, epoch) {
  if (this.committing) await this.committing;
  if (epoch !== this.epoch) return false;
  var self = this,
    previous = this.account;
  this.committing = (async function () {
    var rollback = await self.commitAccount(candidate);
    if (epoch !== self.epoch) {
      if (typeof rollback === "function") await rollback();
      else await self.commitAccount(previous);
      self.account = previous;
      return false;
    }
    self.account = candidate;
    return true;
  })();
  try {
    return await this.committing;
  } finally {
    this.committing = null;
  }
};
GoogleDrive.prototype.form = async function (endpoint, value) {
  return this.transport.request({
    url: "https://oauth2.googleapis.com/" + endpoint,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: query.stringify(value),
  });
};
GoogleDrive.prototype.setupStatus = function () {
  var epoch = this.epoch,
    s = this.setup;
  if (!s) return null;
  return {
    verificationUrl: s.verificationUrl,
    userCode: s.userCode,
    expiresAt: s.expiresAt,
  };
};
GoogleDrive.prototype.beginSetup = async function () {
  var epoch = ++this.epoch;
  if (this.committing) await this.committing;
  if (!this.client.client_id || !this.client.client_secret)
    throw failure(
      "configuration",
      "Google Drive development credentials are not installed",
    );
  var r = await this.form("device/code", {
    client_id: this.client.client_id,
    scope: SCOPE,
  });
  if (epoch !== this.epoch)
    throw failure("cancelled", "Google setup cancelled");
  check(r);
  var v = decode(r);
  if (
    !/^https:\/\/(www\.google\.com|google\.com)\//.test(
      v.verification_url || "",
    ) ||
    typeof v.user_code !== "string" ||
    v.user_code.length > 64 ||
    typeof v.device_code !== "string" ||
    !Number.isFinite(v.expires_in) ||
    v.expires_in <= 0
  )
    throw failure("response", "Invalid Google sign-in response");
  this.pendingAccount = null;
  this.setup = {
    deviceCode: v.device_code,
    userCode: v.user_code,
    verificationUrl: v.verification_url,
    expiresAt: this.now() + v.expires_in * 1000,
    interval: Math.max(1000, (v.interval || 5) * 1000),
    nextAt: this.now() + Math.max(1000, (v.interval || 5) * 1000),
  };
  return this.setupStatus();
};
// Resolve identity using the newly consented token without installing it as
// this.account. A failed lookup must leave the previous account untouched.
GoogleDrive.prototype.finishSetup = function (candidate, epoch, setup) {
  if (this.finishingSetup && this.finishingSetup.candidate === candidate &&
      this.finishingSetup.epoch === epoch) return this.finishingSetup.promise;
  var self = this, task = {candidate:candidate,epoch:epoch};
  function current() {
    if (epoch !== self.epoch || self.pendingAccount !== candidate || self.setup !== setup)
      throw failure("cancelled", "Google sign-in cancelled");
  }
  task.promise = (async function () {
    current();
    if (!candidate.email) {
      // A successful device grant can remain pending while storage/network
      // recovers. Refresh only this candidate if its access token has aged out.
      if (Number.isFinite(candidate.expiresAt) && candidate.expiresAt <= self.now() + 60000) {
        var refresh = await self.form("token", {
          client_id:self.client.client_id,client_secret:self.client.client_secret,
          refresh_token:candidate.refreshToken,grant_type:"refresh_token"
        });
        current();check(refresh);
        var token = decode(refresh);
        if (typeof token.access_token !== "string" || !token.access_token ||
            !Number.isFinite(token.expires_in) || token.expires_in <= 0)
          throw failure("response", "Invalid pending Google token response");
        candidate.accessToken = token.access_token;
        candidate.expiresAt = self.now() + token.expires_in * 1000;
      }
      var response = await self.transport.request({
        url:BASE + "about?fields=user(displayName,emailAddress)",
        headers:{Authorization:"Bearer " + candidate.accessToken}
      });
      current();check(response);
      var value = decode(response), email = value.user && value.user.emailAddress;
      if (typeof email !== "string" || email.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(email))
        throw failure("response", "Google account email identity is unavailable; retry sign-in");
      candidate.email = email.toLowerCase();
      candidate.label = email;
    }
    current();
    var committed = await self.commit(candidate, epoch);
    if (committed && self.pendingAccount === candidate && epoch === self.epoch) {
      self.pendingAccount = null;self.setup = null;
    }
    return committed;
  })();
  this.finishingSetup = task;
  // Preserve the same candidate on identity or durable-save failure so a retry
  // does not consume the one-use device authorization grant again.
  task.promise = task.promise.then(function(value){if(self.finishingSetup === task)self.finishingSetup = null;return value;},function(error){if(self.finishingSetup === task)self.finishingSetup = null;throw error;});
  return task.promise;
};
GoogleDrive.prototype.pollSetup = async function () {
  if (this.pendingAccount) return this.finishSetup(this.pendingAccount, this.epoch, this.setup);
  var epoch = this.epoch,
    s = this.setup;
  if (!s) return false;
  if (this.now() >= s.expiresAt) {
    this.setup = null;
    throw failure("expired", "Google sign-in code expired");
  }
  if (this.now() < s.nextAt) return false;
  s.nextAt = this.now() + s.interval;
  var r = await this.form("token", {
      client_id: this.client.client_id,
      client_secret: this.client.client_secret,
      device_code: s.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
    v = decode(r);
  if (epoch !== this.epoch || s !== this.setup)
    throw failure("cancelled", "Google sign-in cancelled");
  if (v.error === "authorization_pending") return false;
  if (v.error === "slow_down") {
    s.interval += 5000;
    s.nextAt = this.now() + s.interval;
    return false;
  }
  if (v.error) {
    this.setup = null;
    throw failure("auth-denied", "Google sign-in denied or expired");
  }
  check(r);
  if (
    !v.access_token ||
    !v.refresh_token ||
    !Number.isFinite(v.expires_in) ||
    (v.scope && v.scope.split(" ").indexOf(SCOPE) < 0)
  )
    throw failure("scope", "Google Drive permission was not granted");
  this.pendingAccount = {
    accessToken: v.access_token,
    refreshToken: v.refresh_token,
    expiresAt: this.now() + v.expires_in * 1000,
    generation: crypto.randomBytes(16).toString("hex"),
    label: "Google Drive",
  };
  return this.pollSetup();
};
GoogleDrive.prototype.cancelSetup = function () {
  this.epoch++;
  this.setup = null;
  this.pendingAccount = null;
  return this.committing || Promise.resolve();
};
GoogleDrive.prototype.refresh = async function () {
  var epoch = this.epoch,
    a = this.account;
  if (!a) throw failure("auth-required", "Set up Remote Backup");
  if (a.expiresAt > this.now() + 60000) return a.accessToken;
  var r = await this.form("token", {
      client_id: this.client.client_id,
      client_secret: this.client.client_secret,
      refresh_token: a.refreshToken,
      grant_type: "refresh_token",
    }),
    v = decode(r);
  if (epoch !== this.epoch || a !== this.account)
    throw failure("cancelled", "Google refresh cancelled");
  if (v.error) throw failure("auth-required", "Reconnect Google Drive");
  check(r);
  if (!v.access_token || !Number.isFinite(v.expires_in))
    throw failure("response", "Invalid Google token response");
  var next = Object.assign({}, a, {
    accessToken: v.access_token,
    expiresAt: this.now() + v.expires_in * 1000,
  });
  if (!(await this.commit(next, epoch)))
    throw failure("cancelled", "Google refresh cancelled");
  return next.accessToken;
};
GoogleDrive.prototype.request = async function (o) {
  var token = await this.refresh(),
    options = Object.assign({}, o, {
      headers: Object.assign({}, o.headers, {
        Authorization: "Bearer " + token,
      }),
    }),
    r = await this.transport.request(options);
  check(r);
  return r;
};
GoogleDrive.prototype.about = async function () {
  var r = await this.request({
      url: BASE + "about?fields=user(displayName,emailAddress),storageQuota",
    }),
    v = decode(r);
  return {
    email: v.user && v.user.emailAddress || null,
    label:
      (v.user && (v.user.emailAddress || v.user.displayName)) || "Google Drive",
    limit:
      v.storageQuota && v.storageQuota.limit != null
        ? Number(v.storageQuota.limit)
        : null,
    usage: v.storageQuota ? Number(v.storageQuota.usage) : null,
  };
};
GoogleDrive.prototype.allocateId = async function () {
  var v = decode(
    await this.request({
      url: BASE + "files/generateIds?count=1&space=drive&type=files",
    }),
  );
  if (!v.ids || !v.ids[0] || !/^[A-Za-z0-9_-]+$/.test(v.ids[0]))
    throw failure("response", "Invalid Google file identity");
  return v.ids[0];
};
GoogleDrive.prototype.createFolder = async function (id, name, parent) {
  var value = {
    id: id,
    name: name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parent) value.parents = [parent];
  return decode(
    await this.request({
      url: BASE + "files?fields=id",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    }),
  );
};
GoogleDrive.prototype.beginUpload = async function (file) {
  var meta = {
    id: file.remoteId,
    name: file.name,
    parents: [file.parent],
    appProperties: {
      bimmervision: crypto.createHash("sha256").update(file.key).digest("hex"),
    },
  };
  if (file.replacing) {
    delete meta.id;
    delete meta.parents;
  }
  var r = await this.request({
    url:
      "https://www.googleapis.com/upload/drive/v3/files" +
      (file.replacing ? "/" + encodeURIComponent(file.remoteId) : "") +
      "?uploadType=resumable&fields=id,size,md5Checksum",
    method: file.replacing ? "PATCH" : "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Upload-Content-Type": "application/octet-stream",
      "X-Upload-Content-Length": String(file.size),
    },
    body: JSON.stringify(meta),
  });
  if (!r.headers.location)
    throw failure("response", "Missing Google upload session");
  return destination(r.headers.location);
};
GoogleDrive.prototype.queryUpload = async function (session, total) {
  var r = await this.request({
    url: destination(session),
    method: "PUT",
    headers: { "Content-Length": "0", "Content-Range": "bytes */" + total },
    body: Buffer.alloc(0),
  });
  return this.uploadResult(r, total);
};
GoogleDrive.prototype.uploadResult = function (r, total) {
  if (r.status !== 308)
    return { offset: total, complete: true, file: decode(r) };
  var match = /^bytes=0-([0-9]+)$/.exec(r.headers.range || ""),
    offset = match ? Number(match[1]) + 1 : 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > total)
    throw failure("response", "Invalid Google upload offset");
  return { offset: offset, complete: false };
};
GoogleDrive.prototype.uploadChunk = async function (
  session,
  offset,
  bytes,
  total,
) {
  var r = await this.request({
    url: destination(session),
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Range":
        "bytes " + offset + "-" + (offset + bytes.length - 1) + "/" + total,
    },
    body: bytes,
    uploadBody: true,
  });
  return this.uploadResult(r, total);
};
GoogleDrive.prototype.inspectFile = async function (id) {
  if (!/^[A-Za-z0-9_-]+$/.test(id))
    throw failure("response", "Invalid remote file identity");
  return decode(
    await this.request({
      url:
        BASE +
        "files/" +
        id +
        "?fields=id,name,size,md5Checksum,appProperties,trashed,mimeType,parents",
    }),
  );
};
GoogleDrive.prototype.disconnect = async function () {
  await this.cancelSetup();
  await this.commitAccount(null);
  this.account = null;
};
module.exports = { GoogleDrive: GoogleDrive, failure: failure };
