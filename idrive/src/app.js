"use strict";
var fs = require("fs"),
  path = require("path"),
  UI = require("./native-ui").UI,
  Recording = require("./recording").Recording,
  QRDisplay = require("./qr-display").QRDisplay,
  RecordingHealth = require("./recording-health").RecordingHealth;
async function start(options) {
  options = options || {};
  var config = options.config || require("../config/cameras.json"),
    app = options.app || new (require("oap-sdk").OnlineApp)(),
    log =
      options.log ||
      function (e) {
        var text = "BimmerVision: " + String((e && e.message) || e).slice(0, 200);
        console.error(text);
        try {
          fs.appendFileSync("/tmp/bimmervision-ui.log", text + "\n");
        } catch (err) {}
      };
  var dir = path.join("/tmp", "bimmervision-" + process.getuid());
  try {
    fs.mkdirSync(dir, 448);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  var recording = options.recording || new Recording(dir),
    display =
      options.display ||
      new QRDisplay({
        verified: config.qrRendererVerified === true,
        file: path.join("/dev/shm", "mgu-video-bimmervision-qr-" + process.getuid() + ".frame"),
        report: log,
      }),
    ui = null,
    timer = null,
    closed = false,
    pending = false,
    launchedEntry = null,
    painting = false;
  var health=options.health||new RecordingHealth(),lastTestId=null,lastTestMs=-Infinity;
  var monotonicMs=options.nowMs||function(){var t=process.hrtime();return t[0]*1000+t[1]/1000000;};
  async function checkHealth(){
    if(closed||!ui)return;
    var now=monotonicMs(),intent=recording.intent(),notice=health.update(recording.read(),intent,now),test=intent.notificationTest;
    if(!notice&&test&&typeof test.id==='string'&&/^[a-f0-9-]{36}$/i.test(test.id)&&test.id!==lastTestId&&Number.isFinite(test.requestedAtMonotonicMs)&&now-test.requestedAtMonotonicMs>=0&&now-test.requestedAtMonotonicMs<=10000&&now-lastTestMs>=30000){
      lastTestId=test.id;lastTestMs=now;recording.update({notificationTest:null});
      notice={kind:'test',message:'BimmerVision\nTest notification\nRecording settings unchanged.'};
    }
    if(!notice)return;
    var timer;
    try{await Promise.race([ui.showRecordingAlert(notice),new Promise(function(resolve,reject){timer=setTimeout(function(){reject(Error('Recording notification timed out'));},2000);})]);}
    catch(e){if(health.deliveryFailed)health.deliveryFailed(notice.kind,monotonicMs());throw e;}
    finally{clearTimeout(timer);}
  }
  function close() {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    timer = null;
    if (ui) ui.close();
    else display.hide();
  }
  function active() {
    if (!closed && app.registerActive)
      Promise.resolve(app.registerActive()).catch(log);
  }
  app.on("appStatusProxyReady", active);
  app.on("entryPointExecute", function (id) {
    if (closed) return;
    pending = true;
    if (typeof id === "string" && id) launchedEntry = id;
    if (ui) {
      ui.entry = launchedEntry || config.entryUuid;
      ui.openMenu().catch(log);
    }
  });
  app.on("shutdown", close);
  await app.start();
  if (closed) return { app: app, close: close };
  active();
  for (var n = 0; !app.rhmiApplication && !closed && n < 90; n++)
    await new Promise(function (resolve) {
      setTimeout(resolve, 1000);
    });
  if (closed) return { app: app, close: close };
  if (!app.rhmiApplication) {
    close();
    throw new Error("Native RHMI screen unavailable");
  }
  if (app.initialized) await app.initialized();
  if (closed) return { app: app, close: close };
  ui = new UI({
    rhmi: app.rhmiApplication,
    entry: launchedEntry || config.entryUuid,
    recording: recording,
    display: display,
    preferExternalQr: config.qrBottomRight === true,
  });
  await ui.initialize();
  var points = app.entryPoints,
    point = points && points.get && points.get(ui.entry);
  if (point && point.setText && point.setIcon) {
    await point.setText("SID_CAMERAS_TITLE");
    await point.setIcon("bimmervision2.png");
  }
  if (
    pending ||
    ["ENTRY_POINT", "BOOKMARK", "LUM"].indexOf(String(app.startReason)) >= 0 ||
    (process.argv.indexOf("--startReason") >= 0 &&
      ["ENTRY_POINT", "BOOKMARK", "LUM"].indexOf(process.argv[process.argv.indexOf("--startReason") + 1]) >= 0)
  )
    await ui.openMenu();
  if (options.openPage === "connect") await ui.press("HOME_LEFT");
  if (closed) {
    ui.close();
    return { app: app, ui: ui, close: close };
  }
  timer = setInterval(function () {
    if (closed) return;
    // The phone visit lease must outlive slow RHMI/QR/alert painting.
    try { ui.beat(); } catch (e) { log(e); }
    if (painting) return;
    painting = true;
    checkHealth().then(function(){return ui.paint();})
      .catch(log)
      .then(function () {
        painting = false;
      });
  }, 500);
  return { app: app, ui: ui, close: close, checkHealth: checkHealth };
}
if (require.main === module)
  start({
    openPage: process.argv.indexOf("--openPage") >= 0
      ? process.argv[process.argv.indexOf("--openPage") + 1]
      : "",
  })
    .then(function (runtime) {
      process.on("SIGTERM", function () {
        runtime.close();
        process.exit(0);
      });
      process.on("SIGINT", function () {
        runtime.close();
        process.exit(0);
      });
    })
    .catch(function (e) {
      var text = "BimmerVision startup: " + String((e && e.message) || e);
      console.error(text);
      try {
        fs.appendFileSync("/tmp/bimmervision-ui.log", text + "\n");
      } catch (err) {}
      process.exitCode = 1;
    });
module.exports = { start: start };
