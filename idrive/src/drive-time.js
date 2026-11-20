"use strict";
// Head-unit Linux runs in UTC; use an explicit display zone, never its locale
// default. Original recording timestamps remain UTC for sorting and uploads.
function format(value, timeZone) {
  var d = new Date(value);
  if (!value || !isFinite(d.getTime())) return "Recorded drive";
  var options = { timeZone: timeZone || "UTC", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  try {
    return d.toLocaleString("en-US", options) + (!timeZone || timeZone === "UTC" ? " UTC" : "");
  } catch (e) {
    options.timeZone = "UTC";
    return d.toLocaleString("en-US", options) + " UTC";
  }
}
module.exports = { format: format };
