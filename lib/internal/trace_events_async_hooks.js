'use strict';

var trace_events = process.binding('trace_events');
var async_wrap = process.binding('async_wrap');

var async_hooks = require('async_hooks'); // Use small letters such that chrome://tracing groups by the name.
// The behaviour is not only useful but the same as the events emitted using
// the specific C++ macros.


var BEFORE_EVENT = 'b'.charCodeAt(0);
var END_EVENT = 'e'.charCodeAt(0); // In trace_events it is not only the id but also the name that needs to be
// repeated. Since async_hooks doesn't expose the provider type in the
// non-init events, use a map to manually map the asyncId to the type name.

var typeMemory = new Map(); // It is faster to emit trace_events directly from C++. Thus, this happens in
// async_wrap.cc. However, events emitted from the JavaScript API or the
// Embedder C++ API can't be emitted from async_wrap.cc. Thus they are
// emitted using the JavaScript API. To prevent emitting the same event
// twice the async_wrap.Providers list is used to filter the events.

var nativeProviders = new Set(Object.keys(async_wrap.Providers));
var hook = async_hooks.createHook({
  init: function init(asyncId, type, triggerAsyncId, resource) {
    if (nativeProviders.has(type)) return;
    typeMemory.set(asyncId, type);
    trace_events.emit(BEFORE_EVENT, 'node.async_hooks', type, asyncId, 'triggerAsyncId', triggerAsyncId, 'executionAsyncId', async_hooks.executionAsyncId());
  },
  before: function before(asyncId) {
    var type = typeMemory.get(asyncId);
    if (type === undefined) return;
    trace_events.emit(BEFORE_EVENT, 'node.async_hooks', type + '_CALLBACK', asyncId);
  },
  after: function after(asyncId) {
    var type = typeMemory.get(asyncId);
    if (type === undefined) return;
    trace_events.emit(END_EVENT, 'node.async_hooks', type + '_CALLBACK', asyncId);
  },
  destroy: function destroy(asyncId) {
    var type = typeMemory.get(asyncId);
    if (type === undefined) return;
    trace_events.emit(END_EVENT, 'node.async_hooks', type, asyncId); // cleanup asyncId to type map

    typeMemory["delete"](asyncId);
  }
});

exports.setup = function () {
  if (trace_events.categoryGroupEnabled('node.async_hooks')) {
    hook.enable();
  }
};