"use strict";
// Read-only BMW schemas/decoders retained from the original v0.1.4 backup.
var BRAKE = {
  member: "dummy2",
  pressed: ["BLS_MINUS_BETAETIGUNG"],
  released: ["KEINE_BLS_MINUS_BETAETIGUNG"],
};
var GAS = {
  member: "dummy2",
  pressed: [
    "FAHRPEDAL_MINUS__FAHRER_MINUS___ANFORDERUNG__KEINE_FAS_MINUS_ANFORDERUNG",
    "FAHRPEDAL_MINUS__FAHRER_MINUS___ANFORDERUNG_GROESSER_FAS_MINUS_ANFORDERUNG",
    "FAHRPEDAL_MINUS__FAHRER_MINUS___ANFORDERUNG_KLEINER_FAS_MINUS_ANFORDERUNG",
  ],
  released: [
    "KEINE_FAHRPEDAL_MINUS__FAHRER_MINUS___ANFORDERUNG__KEINE_FAS_MINUS_ANFORDERUNG",
    "KEINE_FAHRPEDAL_MINUS__FAHRER_MINUS___ANFORDERUNG__FAS_MINUS_ANFORDERUNG",
  ],
};
var INDICATOR = {
  member: "controlIndicateDirection",
  left: ["DAUER_BLINKEN_LINKS_EIN", "TIPP_BLINKEN_LINKS_EIN"],
  right: ["DAUER_BLINKEN_RECHTS_EIN", "TIPP_BLINKEN_RECHTS_EIN"],
  hazard: ["BEIDSEITIGES_BLINKEN_EIN"],
  off: ["BLINKEN_AUS"],
};
var HORN = {
  member: "operationHornButton",
  pressed: ["HORN_MINUS_TASTER_GEDRUECKT"],
  released: ["KEINE_AKTION"],
};
var SOURCES = [
  {dir: "/var/opt/public/oap/oap_12236/someipInterfaces", name: "de.bmw.infotainment.KombiIF",
   instance: "1", field: "statusShowTimeDate", serviceId: 46363, kind: "displayClock"},
  {
    dir: "/var/opt/public/oap/oap_12247/someipInterfaces",
    name: "de.bmw.dass.driverassistanceapplications.StatusDisplayXADAndSpeed",
    instance: "1",
    field: "statusDisplaySpeed",
    serviceId: 12643,
    kind: "speed",
  },
  {
    dir: "/var/opt/public/oap/oap_12203/someipInterfaces",
    name: "de.bmw.powertrain.Powertrain",
    instance: "1",
    field: "InformationVehicleDrive",
    serviceId: 38192,
    kind: "brake",
  },
  {
    dir: "/var/opt/public/oap/oap_12247/someipInterfaces",
    name: "de.bmw.powertrain.AcceleratorPedal",
    instance: "1",
    field: "AngleAcceleratorPedal",
    serviceId: 38193,
    kind: "gas",
  },
  {
    dir: "/var/opt/public/oap/oap_12257/someipInterfaces",
    name: "de.bmw.body.Light",
    instance: "1",
    field: "StatusFunctionsIndicators",
    serviceId: 21810,
    kind: "indicator",
  },
  {
    dir: "/var/opt/public/oap/oap_12203/someipInterfaces",
    name: "de.bmw.chassis.SpeedAcceleration",
    instance: "1",
    field: "vehicleSpeed",
    serviceId: 30003,
    kind: "pace",
  },
  {
    dir: "/var/opt/public/oap/oap_12203/someipInterfaces",
    name: "de.bmw.infotainment.navigation.positioning.Positioning",
    instance: "Main_Instance",
    field: "currentLocation",
    serviceId: 64268,
    kind: "position",
  },
  {
    dir: "/var/opt/public/oap/oap_12231/someipInterfaces",
    name: "de.bmw.chassis.SteeringAngle",
    instance: "1",
    field: "ActualSteeringAngleDriver",
    serviceId: 30002,
    kind: "steering",
  },
  {
    dir: "/var/opt/public/oap/oap_12230/someipInterfaces",
    name: "de.bmw.infrastructure.analytics.BasicDataSet",
    instance: "1",
    field: "basicDataSet",
    serviceId: 4096,
    kind: "horn",
  },
];

function structMember(schema, name) {
  var list = schema && schema.e;
  if (!Array.isArray(list)) return null;
  for (var i = 0; i < list.length; i++) if (list[i] && list[i].n === name) return list[i];
  return null;
}
function enumName(memberSchema, value) {
  if (!memberSchema || !memberSchema.e || typeof memberSchema.e !== "object") return null;
  if (typeof value === "string" && Object.prototype.hasOwnProperty.call(memberSchema.e, value))
    return value;
  if (typeof value !== "number") return null;
  var names = Object.keys(memberSchema.e);
  for (var i = 0; i < names.length; i++) if (memberSchema.e[names[i]] === value) return names[i];
  return null;
}
function namedState(schema, spec, value) {
  if (!value || typeof value !== "object") return null;
  var name = enumName(structMember(schema, spec.member), value[spec.member]);
  if (!name) return null;
  if (spec.pressed && spec.pressed.indexOf(name) !== -1) return true;
  if (spec.released && spec.released.indexOf(name) !== -1) return false;
  if (spec.left && spec.left.indexOf(name) !== -1) return "left";
  if (spec.right && spec.right.indexOf(name) !== -1) return "right";
  if (spec.hazard && spec.hazard.indexOf(name) !== -1) return "hazard";
  if (spec.off && spec.off.indexOf(name) !== -1) return "off";
  return null;
}
function readSignal(kind, schema, value) {
  if (kind === "displayClock") {
    if (!value) return null;
    var parts = [value.displayDateYear, value.displayDateMonth, value.displayDateDay,
      value.displayHour, value.displayMinute, value.displaySecond];
    if (!parts.every(Number.isInteger) || parts[0] < 2000 || parts[0] > 2099 ||
        parts[1] < 1 || parts[1] > 12 || parts[2] < 1 || parts[2] > 31 ||
        parts[3] < 0 || parts[3] > 23 || parts[4] < 0 || parts[4] > 59 ||
        parts[5] < 0 || parts[5] > 59) return null;
    // Encode the dashboard's calendar fields without applying the Linux timezone.
    var wallMs = Date.UTC(parts[0], parts[1]-1, parts[2], parts[3], parts[4], parts[5]);
    return new Date(wallMs).getUTCDate() === parts[2] ? {wallMs:wallMs} : null;
  }
  if (kind === "speed") {
    if (!value || typeof value.displayedValueSpeed !== "number") return null;
    var speed = value.displayedValueSpeed;
    if (!isFinite(speed) || speed < 0 || speed > 400) return null;
    var unitName = enumName(structMember(schema, "unitSpeed"), value.unitSpeed);
    var unit = unitName === "UNIT_MPH" ? "mph" : unitName === "UNIT_KMH" ? "km/h" : null;
    if (!unit) return null;
    return { speed: Math.round(speed * 10) / 10, speedUnit: unit };
  }
  if (kind === "horn") {
    var horn = namedState(schema, HORN, value);
    return typeof horn === "boolean" ? { horn: horn } : null;
  }
  if (kind === "brake") {
    var braking = namedState(schema, BRAKE, value);
    return typeof braking === "boolean" ? { braking: braking } : null;
  }
  if (kind === "gas") {
    var accelerator = namedState(schema, GAS, value);
    if (typeof accelerator === "boolean") return { accelerator: accelerator };
    var angle = value && value.actualValueAngleAcceleratorPedal;
    var pedalName = enumName(
      structMember(schema, "qualifierActualValueAngleAcceleratorPedal"),
      value && value.qualifierActualValueAngleAcceleratorPedal,
    );
    if (typeof angle !== "number" || !isFinite(angle) || angle < 0 || angle >= 4095) return null;
    if (!pedalName || pedalName.indexOf("UNGUELTIG") !== -1 || pedalName.indexOf("INITIALISIERUNG") !== -1)
      return null;
    return { accelerator: angle > 0 };
  }
  if (kind === "indicator") {
    var indicator = namedState(schema, INDICATOR, value);
    return typeof indicator === "string" ? { indicator: indicator } : null;
  }
  if (kind === "pace") {
    if (!value) return null;
    var qualifier = enumName(
      structMember(schema, "qualifierSpeedVehicleCentreOfGravity"),
      value.qualifierSpeedVehicleCentreOfGravity,
    );
    if (!qualifier || qualifier === "SIGNAL_UNGUELTIG" || qualifier === "INITIALISIERUNG") return null;
    var stand = enumName(
      structMember(schema, "statusSpeedVehicleNearStandstill"),
      value.statusSpeedVehicleNearStandstill,
    );
    var pace = null;
    if (stand === "FAHRZEUG_IM_STILLSTANDSNAHEN_BEREICH") pace = { nearStandstill: true };
    else if (stand === "FAHRZEUG_NICHT_IM_STILLSTANDSNAHEN_BEREICH") pace = { nearStandstill: false };
    var rawSpeed = value.speedVehicleCentreOfGravity;
    var speedName = enumName(
      structMember(schema, "qualifierSpeedVehicleCentreOfGravity"),
      value.qualifierSpeedVehicleCentreOfGravity,
    );
    if (
      pace &&
      typeof rawSpeed === "number" &&
      isFinite(rawSpeed) &&
      rawSpeed >= 0 &&
      rawSpeed < 65535 &&
      speedName &&
      speedName.indexOf("UNGUELTIG") === -1 &&
      speedName.indexOf("INITIALISIERUNG") === -1 &&
      speedName.indexOf("GUELTIG") !== -1
    ) {
      // The schema's empty value is 65535. Stopped on this car reads 0.
      // One count is 1/64 of a kilometer per hour, which is the width that
      // fills that 16-bit value.
      pace.speed = Math.round(rawSpeed * 0.015625 * 10) / 10;
      pace.speedUnit = "km/h";
    }
    return pace;
  }
  if (kind === "steering") {
    if (!value || typeof value.actualValueSteeringAngleDriver !== "number") return null;
    var raw = value.actualValueSteeringAngleDriver;
    if (!isFinite(raw) || raw < 0 || raw > 65535 || raw === 65535) return null;
    var steerName = enumName(
      structMember(schema, "qualifierActualValueSteeringAngleDriver"),
      value.qualifierActualValueSteeringAngleDriver,
    );
    var steerValid = false;
    if (steerName && steerName.indexOf("UNGUELTIG") === -1 && steerName.indexOf("INITIALISIERUNG") === -1 && steerName.indexOf("ERSATZWERT") === -1 && steerName.indexOf("SENSOR_NICHT_VORHANDEN") === -1)
      steerValid = steerName.indexOf("GUELTIG") !== -1;
    var counts = steeringCounts(raw);
    return { raw: raw, counts: counts, degrees: steeringDegrees(counts), qualifier: steerName || "", valid: steerValid };
  }
  if (kind === "position") {
    if (!value || (value.coordinatesValid !== true && value.coordinatesValid !== 1)) return null;
    var lat = value.latitude;
    var lon = value.longitude;
    if (typeof lat !== "number" || typeof lon !== "number") return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    if (lat === 0 && lon === 0) return null;
    return {
      latitude: Math.round(lat * 1e6) / 1e6,
      longitude: Math.round(lon * 1e6) / 1e6,
    };
  }
  return null;
}
function steeringCounts(raw) {
  return ((raw & 255) << 8) | (raw >> 8);
}
function steeringDegrees(counts) {
  return Math.round((((counts - 32790) * 36) / 605) * 10) / 10;
}
module.exports={SOURCES:SOURCES,readSignal:readSignal};
