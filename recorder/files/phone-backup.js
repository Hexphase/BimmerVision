"use strict";
// Phone credentials never enter this broker. Registered remote objects remain
// untrusted until the car inspects them through its Wi-Fi-only Drive client.
var fs = require('fs'), crypto = require('crypto'), url = require('url'), io = require('./io');
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, MAX = 1048576;
var SOURCE_CHANGED = "Recording changed after phone selection. Reconnect Google Drive, then select the recording again; existing cloud files are preserved.";
var MAX_PENDING_JOBS = 64, MAX_STATE_BYTES = 24 * 1024 * 1024;
var CAPACITY = 'Connect car to Wi-Fi to verify pending phone backups before starting this drive backup';
function pendingJobs(w) {
    return (w.data.phoneJobs || []).filter(function (j) { return !j.adopted; }).length;
}
function saveBounded(w) {
    // State.load caps reads at 32 MiB. Leave headroom for the worker's later
    // verification/checkpoints; never persist an unreadable phone-job ledger.
    if (Buffer.byteLength(JSON.stringify(w.data), 'utf8') > MAX_STATE_BYTES)
        throw Error(CAPACITY + ' (phone backup state limit reached)');
    return w.save();
}
function sig(s) {
    return [s.dev, s.ino, s.size, s.mtime.getTime(), s.ctime.getTime()].join(':');
}
function tag(s) {
    return crypto.createHash('sha256').update(s).digest('hex');
}
function identity(s) {
    return typeof s === 'string' && /^[^\s@]+@[^\s@]+$/.test(s) ? s.toLowerCase() : null;
}
function id(s) {
    if (typeof s !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(s))
        throw Error('Invalid remote identity');
    return s;
}
function session(s, remote) {
    var u;
    try {
        u = new url.URL(s || '');
    }
    catch (e) {
        throw Error('Invalid bound Google upload session');
    }
    if (typeof s !== 'string' || s.length > 4096 || u.protocol !== 'https:' || u.host !== 'www.googleapis.com' || u.username || u.password || u.hash || u.pathname !== '/upload/drive/v3/files/' + id(remote) || !u.search || !/(^|&)upload_id=[A-Za-z0-9_%.-]+(&|$)/.test(u.search.slice(1)))
        throw Error('Invalid bound Google upload session');
    return s;
}
function PhoneBackup(o) {
    this.worker = o.worker;
    this.context = o.context;
    this.permitted = o.permitted;
    this.now = o.now || Date.now;
    this.active = null;
    this.revision = 0;
}
PhoneBackup.prototype.status = function () {
    // Status must not call context(): production context includes recorder
    // status, which itself includes this status. Use the worker's last snapshot.
    var a = this.worker.data.account, e = a && identity(a.email), c = this.worker.lastContext, source = c && c.guard && c.guard.identity;
    return {
        available: !!e, accountEmail: e, reason: (this.worker.data.phoneJobs || []).some(function (j) {
            return j.sourceChanged;
        }) ? SOURCE_CHANGED : !e ? 'Connect car to Wi-Fi once to verify the linked Google account' : !this.permitted() ? 'Waiting until the car is stationary' : '', chunkBytes: MAX, speedPermitted: this.permitted(), pauseRecording: !!this.worker.data.settings.pauseRecording, active: !!this.live(), pending: this.worker.data.queue.filter(function (r) {
            return r.manual && !r.excluded && !r.done && (!c || source && r.source === source);
        }).length
    };
};
PhoneBackup.prototype.live = function () {
    if (this.active && this.now() >= this.active.expiresAt)
        this.revoke();
    return this.active;
};
PhoneBackup.prototype.revoke = function () {
    var a = this.active;
    this.revision++;
    this.active = null;
    if (a)
        a.releases.forEach(function (r) {
            r();
        });
};
PhoneBackup.prototype.owns = function (clip) {
    var a = this.live();
    return !!a && a.job.clipIds.indexOf(clip) !== -1;
};
PhoneBackup.prototype.check = async function (a, fd) {
    if (!a || this.active !== a || this.now() >= a.expiresAt) {
        this.live();
        throw Error('Phone upload lease expired');
    }
    if (!this.permitted())
        throw Error('Waiting until the car is stationary');
    var c = this.context();
    if (!this.worker.data.account || this.worker.data.account.generation !== a.job.generation || c.library !== a.library || !c.guard || c.guard.identity !== a.job.source)
        throw Error('USB source changed');
    await c.guard.check(fd);
    if (this.active !== a)
        throw Error('Phone upload lease expired');
    var r = c.readRecording ? c.readRecording() : c.recording;
    if (r && (r.finalizing || r.metrics && r.metrics.queuedBytes > 4 * MAX))
        throw Error('Recording takes priority');
};
// During claim, an automatic capture pause may be draining the writer. Yield
// asynchronously until it drains instead of aborting and resuming capture.
PhoneBackup.prototype.waitForRead = async function (a, fd) {
    for (;;) {
        try {
            return await this.check(a, fd);
        }
        catch (e) {
            if (e.message !== 'Recording takes priority')
                throw e;
            await new Promise(function (resolve) {
                setTimeout(resolve, 25);
            });
        }
    }
};
PhoneBackup.prototype.authorize = function (jobId, b) {
    var a = this.live();
    if (!a || a.job.id !== jobId || !b || typeof b.leaseToken !== 'string' || !/^[a-f0-9]{64}$/.test(b.leaseToken) || !crypto.timingSafeEqual(Buffer.from(a.token), Buffer.from(b.leaseToken)))
        throw Error('Phone upload lease expired');
    return a;
};
// Persist the whole selection before the browser begins any bounded claim.
// These are ordinary manual receipts: no remote targets or completion evidence
// are invented, and an existing verified receipt remains intact.
PhoneBackup.prototype.enqueue = async function (b) {
    var w = this.worker, c = this.context(), account = w.data.account,
        email = account && identity(account.email), accountGeneration = account && account.generation, source = c.guard && c.guard.identity,
        generation = w.cancelGeneration, revision = this.revision, releases = [], self = this;
    if (!email)
        throw Error('Connect car to Wi-Fi once to verify the linked Google account');
    if (!b || b.consent !== true || identity(b.accountEmail) !== email)
        throw Error('Sign in with the same Google account linked to the car and consent to phone upload');
    if (!Array.isArray(b.clipIds) || !b.clipIds.length || b.clipIds.length > 1000 || b.clipIds.some(function (x) {
        return typeof x !== 'string' || !UUID.test(x);
    }) || new Set(b.clipIds.map(function (x) { return x.toLowerCase(); })).size !== b.clipIds.length)
        throw Error('Select up to 1000 distinct recordings');
    if (this.live()) throw Error('A phone upload is already active');
    if (!c.library || !c.guard) throw Error('Waiting for USB');
    // Reserve enough bounded batches for this entire selection before the
    // browser uploads any part of it. Claim enforces the same global limit.
    if (pendingJobs(w) + Math.ceil(b.clipIds.length / 20) > MAX_PENDING_JOBS)
        throw Error(CAPACITY);
    var clips = b.clipIds.slice();
    async function check() {
        var current = self.context();
        if (w.data.account !== account || account.generation !== accountGeneration || identity(account.email) !== email ||
            w.cancelGeneration !== generation || self.revision !== revision || current.library !== c.library || !current.guard || current.guard.identity !== source || self.live())
            throw Error('USB source changed');
        await c.guard.check();
        current = self.context();
        if (current.library !== c.library || !current.guard || current.guard.identity !== source || w.data.account !== account ||
            account.generation !== accountGeneration || identity(account.email) !== email || w.cancelGeneration !== generation || self.revision !== revision || self.live())
            throw Error('USB source changed');
    }
    function complete(manifests) {
        clips.forEach(function (clip) {
            if (!manifests.some(function (m) { return m.id === clip && m.complete === true; }))
                throw Error('Recording is not complete');
        });
    }
    try {
        complete(await c.library.backupManifests());
        await check();
        for (var i = 0; i < clips.length; i++) {
            releases.push(await c.library.acquire(clips[i]));
            await check();
        }
        complete(await c.library.backupManifests());
        await check();
        var previous = w.data.queue, queue = previous.slice();
        clips.forEach(function (clip) {
            var index = queue.findIndex(function (r) { return r.clipId === clip && r.source === source; });
            if (index >= 0) queue[index] = Object.assign({}, queue[index], { manual: true, excluded: false });
            else queue.push({clipId: clip, source: source, manual: true, done: false, files: [], folder: {}});
        });
        w.data.queue = queue;
        try { await saveBounded(w); }
        catch (e) { w.data.queue = previous; throw e; }
        w.scanAt = 0;
        w.retryAt = 0;
        return {queued: clips.length, pending: true};
    }
    finally { releases.forEach(function (release) { release(); }); }
};
PhoneBackup.prototype.claim = async function (b) {
    var w = this.worker, c = this.context(), email = w.data.account && identity(w.data.account.email);
    if (!email)
        throw Error('Connect car to Wi-Fi once to verify the linked Google account');
    if (!b || b.consent !== true || identity(b.accountEmail) !== email)
        throw Error('Sign in with the same Google account linked to the car and consent to phone upload');
    if (!Array.isArray(b.clipIds) || !b.clipIds.length || b.clipIds.length > 20 || b.clipIds.some(function (x) {
        return !UUID.test(x);
    }) || new Set(b.clipIds).size !== b.clipIds.length)
        throw Error('Select up to 20 recordings');
    if (this.live())
        throw Error('A phone upload is already active');
    if (!c.library || !c.guard)
        throw Error('Waiting for USB');
    if (pendingJobs(w) >= MAX_PENDING_JOBS)
        throw Error(CAPACITY);
    var manifests = await c.library.backupManifests();
    b.clipIds.forEach(function (x) {
        if (!manifests.some(function (m) {
            return m.id === x && m.complete === true;
        }))
            throw Error('Recording is not complete');
        if ((w.data.phoneJobs || []).some(function (j) {
            return !j.adopted && j.source === c.guard.identity && j.clipIds.indexOf(x) !== -1;
        }))
            throw Error('Connect car to Wi-Fi to verify the previous phone backup first');
    });
    var job = {
        id: crypto.randomBytes(16).toString('hex'), generation: w.data.account.generation, email: email, source: c.guard.identity, clipIds: b.clipIds.slice(), files: [], root: { name: 'BimmerVision', tag: tag(w.data.account.generation + ':phone-root:' + crypto.randomBytes(16).toString('hex')) }, folders: []
    }, a = {
        job: job, library: c.library, token: crypto.randomBytes(32).toString('hex'), expiresAt: this.now() + 30000, releases: []
    };
    this.active = a;
    var roots = job.clipIds.map(function (clip) {
        var r = w.data.queue.filter(function (v) {
            return v.clipId === clip && v.source === job.source;
        })[0];
        return r && r.root && r.root.created ? r.root : w.data.folder;
    }).filter(function (r) {
        return r && r.created && r.id;
    });
    if (roots.length) {
        if (roots.some(function (r) {
            return r.id !== roots[0].id;
        })) {
            this.revoke();
            throw Error('Select recordings from the same backup folder');
        }
        job.root.id = roots[0].id;
        job.root.trustedExisting = true;
    }
    try {
        for (var ci = 0; ci < job.clipIds.length; ci++) {
            var clip = job.clipIds[ci];
            a.releases.push(await c.library.acquire(clip));
            var priorRecord = w.data.queue.filter(function (v) {
                return v.clipId === clip && v.source === job.source;
            })[0], folderInfo = { clipId: clip, name: clip, tag: tag(job.generation + ':folder:' + clip) };
            if (priorRecord && priorRecord.folder && priorRecord.folder.created) {
                folderInfo.id = priorRecord.folder.id;
                folderInfo.trustedExisting = true;
            }
            job.folders.push(folderInfo);
            var bundle = await c.library.bundle(clip);
            for (var fi = 0; fi < bundle.length; fi++) {
                var f = bundle[fi], st = await io.safePath(f.path, 'file'), fd = await io.open(f.path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)), md5 = crypto.createHash('md5');
                try {
                    for (var at = 0; at < st.size; at += MAX) {
                        await this.waitForRead(a, fd);
                        var bytes = await io.readAt(fd, Math.min(MAX, st.size - at), at);
                        if (bytes.length !== Math.min(MAX, st.size - at))
                            throw Error('USB source changed');
                        md5.update(bytes);
                        await new Promise(function (r) {
                            setTimeout(r, 0);
                        });
                        a.expiresAt = this.now() + 30000;
                    }
                    if (sig(await io.fstat(fd)) !== sig(st))
                        throw Error('USB source changed');
                }
                finally {
                    await io.close(fd);
                }
                var sum = md5.digest('hex'), prior = priorRecord && priorRecord.files.filter(function (v) {
                    return v.name === f.name;
                })[0];
                if (prior && prior.remoteId && (prior.md5 !== sum || prior.size !== st.size))
                    throw Error('USB source changed; existing cloud copy preserved');
                var prepared = {
                    index: job.files.length, clipId: clip, name: f.name, path: f.path, size: st.size, md5: sum, signature: sig(st), tag: tag(job.generation + ':' + clip + ':' + f.name + ':' + sum)
                };
                if (prior && prior.remoteId) {
                    prepared.remoteId = prior.remoteId;
                    prepared.parent = prior.parent;
                    prepared.session = prior.session || '';
                    prepared.done = !!prior.done;
                    prepared.offset = prior.offset || 0;
                    prepared.trustedExisting = true;
                }
                job.files.push(prepared);
            }
        }
        await this.check(a);
        var previousQueue = w.data.queue, previousJobs = w.data.phoneJobs, committed = false;
        // Stage receipt edits separately so a size or disk failure preserves
        // every existing remote identity, session, and completion receipt.
        w.data.queue = previousQueue.map(function (r) { return Object.assign({}, r); });
        job.clipIds.forEach(function (clip) {
            var receipt = w.data.queue.filter(function (r) {
                return r.clipId === clip && r.source === job.source;
            })[0];
            if (!receipt) {
                receipt = {
                    clipId: clip, source: job.source, folder: {}, files: []
                };
                w.data.queue.push(receipt);
            }
            receipt.manual = true;
            receipt.excluded = false;
            receipt.phoneJob = job.id;
            receipt.done = false;
            receipt.files = job.files.filter(function (f) {
                return f.clipId === clip;
            }).map(function (f) {
                return Object.assign({}, f, { offset: f.offset || 0, done: !!f.done });
            });
        });
        w.data.phoneJobs = (w.data.phoneJobs || []).filter(function (old) {
            return w.data.queue.some(function (r) {
                return r.phoneJob === old.id && !r.done;
            });
        }).concat((w.data.phoneJobs || []).filter(function (old) {
            return !w.data.queue.some(function (r) {
                return r.phoneJob === old.id && !r.done;
            });
        }).slice(-20));
        w.data.phoneJobs.push(job);
        await saveBounded(w);
        committed = true;
        await this.check(a);
        return {
            jobId: job.id, leaseToken: a.token, expiresAt: a.expiresAt, accountEmail: email, chunkBytes: MAX, root: job.root, folders: job.folders, files: job.files.map(function (f) {
                return {
                    index: f.index, clipId: f.clipId, name: f.name, size: f.size, md5: f.md5, tag: f.tag, remoteId: f.remoteId, session: f.session, parent: f.parent, trustedExisting: !!f.trustedExisting, done: !!f.done
                };
            })
        };
    }
    catch (e) {
        if (previousQueue && !committed) {
            w.data.queue = previousQueue;
            if (previousJobs === undefined) delete w.data.phoneJobs;
            else w.data.phoneJobs = previousJobs;
        }
        this.revoke();
        throw e;
    }
};
PhoneBackup.prototype.heartbeat = async function (j, b) {
    var a = this.authorize(j, b);
    await this.check(a);
    a.expiresAt = this.now() + 30000;
    // Browser-reported progress is display-only; never completion evidence.
    var total = a.job.files.reduce(function(n,f){return n + f.size;},0);
    if (b.progress && Number.isSafeInteger(b.progress.bytes) && b.progress.bytes >= 0 && b.progress.bytes <= total)
        a.progress = {bytes:b.progress.bytes,total:total};
    return { expiresAt: a.expiresAt, speedPermitted: this.permitted(), pauseRecording: !!this.worker.data.settings.pauseRecording };
};
PhoneBackup.prototype.release = async function (j, b) {
    this.authorize(j, b);
    this.revoke();
    return { pending: true, verified: false };
};
PhoneBackup.prototype.read = async function (j, b) {
    var a = this.authorize(j, b);
    if (!a.registered)
        throw Error("Register remote upload targets before reading source bytes");
    if (a.readBusy)
        throw Error('A phone source read is already active');
    a.readBusy = true;
    try {
        return await this.readFile(a, b);
    }
    finally {
        a.readBusy = false;
    }
};
PhoneBackup.prototype.readFile = async function (a, b) {
    var f = a.job.files[b.index];
    if (!Number.isInteger(b.index) || !f || !Number.isSafeInteger(b.offset) || b.offset < 0 || !Number.isSafeInteger(b.length) || b.length < 1 || b.length > MAX || b.offset + b.length > f.size)
        throw Error('Invalid bounded file range');
    await this.check(a);
    a.currentClipId = f.clipId;
    var fd = await io.open(f.path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
        await this.check(a, fd);
        if (sig(await io.fstat(fd)) !== f.signature)
            throw Error('USB source changed');
        var bytes = await io.readAt(fd, b.length, b.offset);
        if (bytes.length !== b.length || sig(await io.fstat(fd)) !== f.signature)
            throw Error('USB source changed');
        await this.check(a, fd);
        return bytes;
    }
    finally {
        await io.close(fd);
    }
};
PhoneBackup.prototype.register = async function (j, b) {
    var a = this.authorize(j, b);
    await this.check(a);
    var job = a.job;
    if (!b.folders || !Array.isArray(b.files) || b.files.length !== job.files.length)
        throw Error('Incomplete remote registration');
    var r = { rootId: id(b.rootId), folders: {}, files: [] }, ids = new Set([r.rootId]);
    if (job.root.id && job.root.id !== r.rootId)
        throw Error('Car remote identity cannot change');
    job.folders.forEach(function (f) {
        var value = id(b.folders[f.clipId]);
        if (f.id && f.id !== value)
            throw Error('Car remote identity cannot change');
        if (ids.has(value))
            throw Error('Duplicate remote identity');
        ids.add(value);
        r.folders[f.clipId] = value;
    });
    job.files.forEach(function (f) {
        var v = b.files.filter(function (x) {
            return x.index === f.index;
        })[0];
        if (!v)
            throw Error('Incomplete remote registration');
        var remote = id(v.remoteId);
        if (f.remoteId && f.remoteId !== remote)
            throw Error('Car remote identity cannot change');
        if (ids.has(remote))
            throw Error('Duplicate remote identity');
        ids.add(remote);
        var registeredSession;
        if (f.trustedExisting && f.session) {
            if (v.session !== f.session)
                throw Error('Car upload session cannot change');
            registeredSession = f.session;
        }
        else if (f.trustedExisting && f.done && !v.session)
            registeredSession = '';
        else
            registeredSession = session(v.session, remote);
        r.files.push({ index: f.index, remoteId: remote, session: registeredSession });
    });
    if (job.registration && JSON.stringify(job.registration) !== JSON.stringify(r))
        throw Error('Remote registration is immutable');
    var previousRegistration = job.registration;
    job.registration = r;
    try { await saveBounded(this.worker); }
    catch (e) {
        if (previousRegistration === undefined) delete job.registration;
        else job.registration = previousRegistration;
        throw e;
    }
    a.registered = true;
    return { registered: true, verified: false };
};
PhoneBackup.prototype.adopt = async function (context) {
    var w = this.worker, self = this;
    if (!context.network || !context.network.eligible)
        return;
    var jobs = w.data.phoneJobs || [];
    for (var ji = 0; ji < jobs.length; ji++) {
        var j = jobs[ji];
        if (j.adopted || j.generation !== w.data.account.generation || j.source !== context.guard.identity || j.clipIds.some(function (x) {
            return self.owns(x);
        }))
            continue;
        if (j.sourceChanged)
            throw Error(SOURCE_CHANGED);
        if (!j.registration) {
            j.adopted = true;
            await w.save();
            continue;
        }
        var releases = [];
        try {
            for (var ai = 0; ai < j.clipIds.length; ai++)
                releases.push(await context.library.acquire(j.clipIds[ai]));
            var about = await w.google.about();
            if (identity(about.email) !== j.email)
                throw Error('Phone upload account could not be verified');
            var r = j.registration;
            async function inspect(remote, name, parent, t, folder, trusted) {
                var f = await w.google.inspectFile(remote);
                if (f.id !== remote || f.name !== name || f.trashed || !trusted && (!f.appProperties || f.appProperties.bimmervision !== t) || folder && f.mimeType !== 'application/vnd.google-apps.folder' || !folder && f.mimeType === 'application/vnd.google-apps.folder' || parent && (!Array.isArray(f.parents) || f.parents.length !== 1 || f.parents[0] !== parent))
                    throw Error('Untrusted phone upload metadata; cloud copy preserved');
                return f;
            }
            await inspect(r.rootId, j.root.name, null, j.root.tag, true, j.root.trustedExisting);
            for (var k = 0; k < j.folders.length; k++) {
                var folder = j.folders[k];
                await inspect(r.folders[folder.clipId], folder.name, r.rootId, folder.tag, true, folder.trustedExisting);
            }
            for (var i = 0; i < j.files.length; i++) {
                var f = j.files[i], reg = r.files[i];
                if (!f.trustedExisting)
                    session(reg.session, reg.remoteId);
                else if (reg.remoteId !== f.remoteId || f.session && reg.session !== f.session)
                    throw Error('Car remote identity cannot change');
                try {
                    var remoteFile = await inspect(reg.remoteId, f.name, r.folders[f.clipId], f.tag, false);
                    if (Number(remoteFile.size) !== 0 && (Number(remoteFile.size) !== f.size || remoteFile.md5Checksum !== f.md5))
                        throw Error('Unexpected phone upload content; cloud copy preserved');
                }
                catch (e) {
                    if (!f.trustedExisting || !f.session || e.code !== 'not-found')
                        throw e;
                }
                if (w.hashes)
                    w.hashes.delete(f.path);
                var local = await w.hash(f.path, context, w.cancelGeneration);
                if (local.md5 !== f.md5 || local.size !== f.size || local.signature !== f.signature) {
                    j.sourceChanged = true;
                    await w.save();
                    throw Error(SOURCE_CHANGED);
                }
            }
            for (var ri = 0; ri < j.clipIds.length; ri++) {
                var receipt = w.data.queue.filter(function (v) {
                    return v.phoneJob === j.id && v.clipId === j.clipIds[ri];
                })[0];
                if (!receipt)
                    throw Error('Phone backup receipt missing');
                receipt.root = { id: r.rootId, created: true };
                receipt.folder = { id: r.folders[receipt.clipId], created: true };
                receipt.files.forEach(function (f) {
                    var original = j.files.filter(function (v) {
                        return v.clipId === receipt.clipId && v.name === f.name;
                    })[0], reg = r.files[original.index];
                    f.remoteId = reg.remoteId;
                    // Client URLs are audit data only. A Google upload_id cannot be
                    // proven to belong to its apparent path offline. Only a session
                    // originally created by the car may be resumed verbatim.
                    f.session = original.trustedExisting && original.session ? original.session : null;
                    if (!f.session)
                        f.replacing = true;
                    f.parent = receipt.folder.id;
                    f.offset = 0;
                    f.done = false;
                });
            }
            j.adopted = true;
            await w.save();
        }
        finally {
            releases.forEach(function (release) {
                release();
            });
        }
    }
};
module.exports = { PhoneBackup: PhoneBackup };
