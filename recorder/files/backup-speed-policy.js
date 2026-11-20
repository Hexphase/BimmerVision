"use strict";
function permitted(speed, nowUs) {
  if (!speed || speed.valid !== true || !Number.isFinite(speed.value) ||
      speed.value < 0 || !Number.isSafeInteger(speed.atUs) ||
      !Number.isSafeInteger(nowUs) || nowUs < speed.atUs ||
      nowUs - speed.atUs > 2000000) return false;
  if (speed.unit === "mph") return speed.value <= 0.1;
  if (speed.unit === "km/h") return speed.value <= 0.1609344;
  return false;
}
module.exports = { permitted: permitted };
