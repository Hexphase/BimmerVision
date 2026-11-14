"use strict";
var fs = require("fs");
var path = require("path");

var installedWeb = path.join(__dirname, "mobile-web");
var WEB_DIR = fs.existsSync(path.join(installedWeb, "index.html")) ? installedWeb : path.resolve(__dirname, "../mobile-web");

var MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4"
};

exports.asset = function (route) {
  var rel = route === "/" || route === "" ? "index.html" : route.replace(/^\/+/, "");
  var filePath = path.resolve(WEB_DIR, rel);
  if (filePath.indexOf(WEB_DIR + path.sep) !== 0) return null;
  if (fs.existsSync(filePath)) {
    var realRoot = fs.realpathSync(WEB_DIR), realFile = fs.realpathSync(filePath);
    if (realFile.indexOf(realRoot + path.sep) !== 0) return null;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    var ext = path.extname(filePath).toLowerCase();
    var mime = MIME_TYPES[ext] || "application/octet-stream";
    return {
      body: fs.readFileSync(filePath),
      type: mime
    };
  }

  return null;
};
