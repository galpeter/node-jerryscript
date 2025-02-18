// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.
'use strict';

var contextify = process.binding('contextify');

var Script = contextify.ContextifyScript;
var kParsingContext = contextify.kParsingContext;
var makeContext = contextify.makeContext;
var isContext = contextify.isContext;
var runInDebugContext = contextify.runInDebugContext;

// The binding provides a few useful primitives:
// - Script(code, { filename = "evalmachine.anonymous",
//                  displayErrors = true } = {})
//   with methods:
//   - runInThisContext({ displayErrors = true } = {})
//   - runInContext(sandbox, { displayErrors = true, timeout = undefined } = {})
// - makeContext(sandbox)
// - isContext(sandbox)
// From this we build the entire documented API.

var realRunInThisContext = Script.prototype.runInThisContext;
var realRunInContext = Script.prototype.runInContext;

Script.prototype.runInThisContext = function (options) {
  if (options && options.breakOnSigint && process._events.SIGINT) {
    return sigintHandlersWrap(realRunInThisContext, this, [options]);
  } else {
    return realRunInThisContext.call(this, options);
  }
};

Script.prototype.runInContext = function (contextifiedSandbox, options) {
  if (options && options.breakOnSigint && process._events.SIGINT) {
    return sigintHandlersWrap(realRunInContext, this, [contextifiedSandbox, options]);
  } else {
    return realRunInContext.call(this, contextifiedSandbox, options);
  }
};

Script.prototype.runInNewContext = function (sandbox, options) {
  var context = createContext(sandbox);
  return this.runInContext(context, options);
};

function createContext(sandbox) {
  if (sandbox === undefined) {
    sandbox = {};
  } else if (isContext(sandbox)) {
    return sandbox;
  }
  makeContext(sandbox);
  return sandbox;
}

function createScript(code, options) {
  return new Script(code, options);
}

// Remove all SIGINT listeners and re-attach them after the wrapped function
// has executed, so that caught SIGINT are handled by the listeners again.
function sigintHandlersWrap(fn, thisArg, argsArray) {
  // Using the internal list here to make sure `.once()` wrappers are used,
  // not the original ones.
  var sigintListeners = process._events.SIGINT;
  if (Array.isArray(sigintListeners))
    sigintListeners = sigintListeners.slice();
  else
    sigintListeners = [sigintListeners];

  process.removeAllListeners('SIGINT');

  try {
    return fn.apply(thisArg, argsArray);
  } finally {
    var size = sigintListeners.length();
    for (var idx in sigintListeners) {
      var listener = sigintListeners[idx];
      process.addListener('SIGINT', listener);
    }
  }
}

function runInContext(code, contextifiedSandbox, options) {
  if (typeof options === 'string') {
    options = {
      filename: options,
      [kParsingContext]: contextifiedSandbox
    };
  } else {
    options = Object.assign({}, options, {
      [kParsingContext]: contextifiedSandbox
    });
  }
  return createScript(code, options).runInContext(contextifiedSandbox, options);
}

function runInNewContext(code, sandbox, options) {
  sandbox = createContext(sandbox);
  if (typeof options === 'string') {
    options = {
      filename: options,
      [kParsingContext]: sandbox
    };
  } else {
    options = Object.assign({}, options, {
      [kParsingContext]: sandbox
    });
  }
  return createScript(code, options).runInNewContext(sandbox, options);
}

function runInThisContext(code, options) {
  return createScript(code, options).runInThisContext(options);
}

module.exports = {
  Script: Script,
  createContext: createContext,
  createScript: createScript,
  runInDebugContext: runInDebugContext,
  runInContext: runInContext,
  runInNewContext: runInNewContext,
  runInThisContext: runInThisContext,
  isContext: isContext
};