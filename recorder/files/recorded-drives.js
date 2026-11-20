"use strict";
function RecordedDrives(options) {
  this.options = options;
  this.initialized = false;
  this.seen = null;
  this.pending = Promise.resolve();
  this.busy = false;
  this.closed = false;
  this.view = {
    drives: [],
    page: 0,
    total: 0,
    pageCount: 1,
    message: "Open Recorded Drives to load recordings",
  };
}
RecordedDrives.prototype.status = function (token) {
  if (!token || token !== this.view.volumeToken)
    return {
      drives: [],
      page: 0,
      total: 0,
      pageCount: 1,
      busy: false,
      message: token ? "Loading recorded drives…" : "Connect a USB drive",
    };
  return Object.assign({}, this.view, { busy: this.busy });
};
RecordedDrives.prototype.refresh = async function (context, page) {
  var drives = await context.library.driveGroups();
  if (context.volumeToken !== this.options.context().volumeToken)
    throw Error("The connected USB drive changed. Refresh the list.");
  var count = Math.max(1, Math.ceil(drives.length / 20)),
    selected = Math.max(
      0,
      Math.min(count - 1, Number.isInteger(page) ? page : 0),
    );
  this.view = Object.assign({}, this.view, {
    volumeToken: context.volumeToken,
    drives: drives.slice(selected * 20, selected * 20 + 20),
    page: selected,
    total: drives.length,
    pageCount: count,
  });
};
RecordedDrives.prototype.command = function (command) {
  var id = command && command.id;
  if (!this.initialized) {
    this.initialized = true;
    this.seen = id || null;
    return Promise.resolve();
  }
  if (
    this.closed ||
    !id ||
    id === this.seen ||
    !/^[A-Za-z0-9-]{1,64}$/.test(id)
  )
    return Promise.resolve();
  this.seen = id;
  var self = this;
  var next = this.pending.then(async function () {
    if (self.closed) return;
    var context = self.options.context();
    self.busy = true;
    self.view.commandId = id;
    try {
      if (
        !context.library ||
        !context.volumeToken ||
        command.volumeToken !== context.volumeToken
      )
        throw Error("The connected USB drive changed. Refresh the list.");
      if (command.action === "lock") {
        await self.options.mutate(async function () {
          if (context.volumeToken !== self.options.context().volumeToken)
            throw Error("The connected USB drive changed.");
          await context.library.setDriveLocked(
            command.driveId,
            command.membership,
            command.locked,
          );
        });
        if (self.options.afterChange) await self.options.afterChange();
      } else if (command.action !== "list")
        throw Error("Unknown recorded drive action");
      await self.refresh(context, command.page);
      self.view.message =
        command.action === "lock"
          ? command.locked
            ? "Drive locked"
            : "Drive unlocked"
          : "";
    } catch (e) {
      self.view.message = String(e.message || e);
      if (
        context.library &&
        context.volumeToken === self.options.context().volumeToken
      ) {
        try {
          await self.refresh(context, command.page);
        } catch (ignore) {}
      }
    } finally {
      self.view.commandId = id;
      self.busy = false;
    }
  });
  this.pending = next.catch(function () {});
  return next;
};
RecordedDrives.prototype.close = async function () {
  this.closed = true;
  await this.pending;
};
module.exports = { RecordedDrives: RecordedDrives };
