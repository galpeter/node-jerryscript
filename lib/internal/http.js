'use strict';

var timers = require('timers');

var nowCache;
var utcCache;

function nowDate() {
  if (!nowCache) cache();
  return nowCache;
}

function utcDate() {
  if (!utcCache) cache();
  return utcCache;
}

function cache() {
  var d = new Date();
  nowCache = d.valueOf();
  utcCache = d.toUTCString();
  timers.enroll(cache, 1000 - d.getMilliseconds());

  timers._unrefActive(cache);
}

cache._onTimeout = function () {
  nowCache = undefined;
  utcCache = undefined;
};

function ondrain() {
  if (this._httpMessage) this._httpMessage.emit('drain');
}

module.exports = {
  outHeadersKey: Symbol('outHeadersKey'),
  ondrain: ondrain,
  nowDate: nowDate,
  utcDate: utcDate
};