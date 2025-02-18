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

function _typeof(obj) { if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }

var EventEmitter = require('events');

var stream = require('stream');

var timers = require('timers');

var util = require('util');

var internalUtil = require('internal/util');

var _require = require('internal/net'),
    isLegalPort = _require.isLegalPort,
    normalizedArgsSymbol = _require.normalizedArgsSymbol,
    makeSyncWrite = _require.makeSyncWrite;

var assert = require('assert');

var cares = process.binding('cares_wrap');
var uv = process.binding('uv');

var _require2 = require('buffer'),
    Buffer = _require2.Buffer;

var TTYWrap = process.binding('tty_wrap');

var _process$binding = process.binding('tcp_wrap'),
    TCP = _process$binding.TCP,
    TCPConstants = _process$binding.constants;

var _process$binding2 = process.binding('pipe_wrap'),
    Pipe = _process$binding2.Pipe,
    PipeConstants = _process$binding2.constants;

var _process$binding3 = process.binding('tcp_wrap'),
    TCPConnectWrap = _process$binding3.TCPConnectWrap;

var _process$binding4 = process.binding('pipe_wrap'),
    PipeConnectWrap = _process$binding4.PipeConnectWrap;

var _process$binding5 = process.binding('stream_wrap'),
    ShutdownWrap = _process$binding5.ShutdownWrap,
    WriteWrap = _process$binding5.WriteWrap;

var _process$binding6 = process.binding('async_wrap'),
    async_id_symbol = _process$binding6.async_id_symbol;

var _require3 = require('internal/async_hooks'),
    newUid = _require3.newUid,
    defaultTriggerAsyncIdScope = _require3.defaultTriggerAsyncIdScope;

var _require4 = require('internal/process/next_tick'),
    nextTick = _require4.nextTick;

var errors = require('internal/errors');

var dns = require('dns'); // `cluster` is only used by `listenInCluster` so for startup performance
// reasons it's lazy loaded.


var cluster = null;
var errnoException = errors.errnoException;
var exceptionWithHostPort = errors.exceptionWithHostPort;

function noop() {}

function createHandle(fd, is_server) {
  var type = TTYWrap.guessHandleType(fd);

  if (type === 'PIPE') {
    return new Pipe(is_server ? PipeConstants.SERVER : PipeConstants.SOCKET);
  }

  if (type === 'TCP') {
    return new TCP(is_server ? TCPConstants.SERVER : TCPConstants.SOCKET);
  }

  throw new TypeError('Unsupported fd type: ' + type);
}

function getNewAsyncId(handle) {
  return !handle || typeof handle.getAsyncId !== 'function' ? newUid() : handle.getAsyncId();
}

var debug = util.debuglog('net');

function isPipeName(s) {
  return typeof s === 'string' && toNumber(s) === false;
}

function createServer(options, connectionListener) {
  return new Server(options, connectionListener);
} // Target API:
//
// var s = net.connect({port: 80, host: 'google.com'}, function() {
//   ...
// });
//
// There are various forms:
//
// connect(options, [cb])
// connect(port, [host], [cb])
// connect(path, [cb]);
//


function connect() {
  for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
    args[_key] = arguments[_key];
  }

  var normalized = normalizeArgs(args);
  var options = normalized[0];
  debug('createConnection', normalized);
  var socket = new Socket(options);

  if (options.timeout) {
    socket.setTimeout(options.timeout);
  }

  return Socket.prototype.connect.call(socket, normalized);
} // Returns an array [options, cb], where options is an object,
// cb is either a function or null.
// Used to normalize arguments of Socket.prototype.connect() and
// Server.prototype.listen(). Possible combinations of parameters:
//   (options[...][, cb])
//   (path[...][, cb])
//   ([port][, host][...][, cb])
// For Socket.prototype.connect(), the [...] part is ignored
// For Server.prototype.listen(), the [...] part is [, backlog]
// but will not be handled here (handled in listen())


function normalizeArgs(args) {
  var arr;

  if (args.length === 0) {
    arr = [{}, null];
    arr[normalizedArgsSymbol] = true;
    return arr;
  }

  var arg0 = args[0];
  var options = {};

  if (_typeof(arg0) === 'object' && arg0 !== null) {
    // (options[...][, cb])
    options = arg0;
  } else if (isPipeName(arg0)) {
    // (path[...][, cb])
    options.path = arg0;
  } else {
    // ([port][, host][...][, cb])
    options.port = arg0;

    if (args.length > 1 && typeof args[1] === 'string') {
      options.host = args[1];
    }
  }

  var cb = args[args.length - 1];
  if (typeof cb !== 'function') arr = [options, null];else arr = [options, cb];
  arr[normalizedArgsSymbol] = true;
  return arr;
} // called when creating new Socket, or when re-using a closed Socket


function initSocketHandle(self) {
  self._undestroy();

  self._bytesDispatched = 0;
  self._sockname = null; // Handle creation may be deferred to bind() or connect() time.

  if (self._handle) {
    self._handle.owner = self;
    self._handle.onread = onread;
    self[async_id_symbol] = getNewAsyncId(self._handle); // If handle doesn't support writev - neither do we

    if (!self._handle.writev) self._writev = null;
  }
}

var BYTES_READ = Symbol('bytesRead');

function Socket(options) {
  if (!(this instanceof Socket)) return new Socket(options);
  this.connecting = false; // Problem with this is that users can supply their own handle, that may not
  // have _handle.getAsyncId(). In this case an[async_id_symbol] should
  // probably be supplied by async_hooks.

  this[async_id_symbol] = -1;
  this._hadError = false;
  this._handle = null;
  this._parent = null;
  this._host = null;
  if (typeof options === 'number') options = {
    fd: options
  }; // Legacy interface.
  else if (options === undefined) options = {};
  stream.Duplex.call(this, options);

  if (options.handle) {
    this._handle = options.handle; // private

    this[async_id_symbol] = getNewAsyncId(this._handle);
  } else if (options.fd !== undefined) {
    var fd = options.fd;
    this._handle = createHandle(fd, false);

    this._handle.open(fd);

    this[async_id_symbol] = this._handle.getAsyncId(); // options.fd can be string (since it is user-defined),
    // so changing this to === would be semver-major
    // See: https://github.com/nodejs/node/pull/11513
    // eslint-disable-next-line eqeqeq

    if ((fd == 1 || fd == 2) && this._handle instanceof Pipe && process.platform === 'win32') {
      // Make stdout and stderr blocking on Windows
      var err = this._handle.setBlocking(true);

      if (err) throw errnoException(err, 'setBlocking');
      this._writev = null;
      this._write = makeSyncWrite(fd);
    }

    this.readable = options.readable !== false;
    this.writable = options.writable !== false;
  } else {
    // these will be set once there is a connection
    this.readable = this.writable = false;
  } // shut down the socket when we're finished with it.


  this.on('_socketEnd', onSocketEnd);
  initSocketHandle(this);
  this._pendingData = null;
  this._pendingEncoding = ''; // handle strings directly

  this._writableState.decodeStrings = false; // default to *not* allowing half open sockets

  this.allowHalfOpen = options && options.allowHalfOpen || false; // if we have a handle, then start the flow of data into the
  // buffer.  if not, then this will happen when we connect

  if (this._handle && options.readable !== false) {
    if (options.pauseOnCreate) {
      // stop the handle from reading and pause the stream
      this._handle.reading = false;

      this._handle.readStop();

      this._readableState.flowing = false;
    } else if (!options.manualStart) {
      this.read(0);
    }
  } // Reserve properties


  this.server = null;
  this._server = null; // Used after `.destroy()`

  this[BYTES_READ] = 0;
}

util.inherits(Socket, stream.Duplex);

Socket.prototype._unrefTimer = function _unrefTimer() {
  for (var s = this; s !== null; s = s._parent) {
    timers._unrefActive(s);
  }
};

function shutdownSocket(self, callback) {
  var req = new ShutdownWrap();
  req.oncomplete = afterShutdown;
  req.handle = self._handle;
  req.callback = callback;
  return self._handle.shutdown(req);
} // the user has called .end(), and all the bytes have been
// sent out to the other side.


Socket.prototype._final = function (cb) {
  var _this = this;

  // If still connecting - defer handling `_final` until 'connect' will happen
  if (this.connecting) {
    debug('_final: not yet connected');
    return this.once('connect', function () {
      return _this._final(cb);
    });
  }

  if (!this.readable || this._readableState.ended) {
    debug('_final: ended, destroy', this._readableState);
    cb();
    return this.destroy();
  }

  debug('_final: not ended, call shutdown()'); // otherwise, just shutdown, or destroy() if not possible

  if (!this._handle || !this._handle.shutdown) {
    cb();
    return this.destroy();
  }

  var err = defaultTriggerAsyncIdScope(this[async_id_symbol], shutdownSocket, this, cb);
  if (err) return this.destroy(errnoException(err, 'shutdown'));
};

function afterShutdown(status, handle, req) {
  var self = handle.owner;
  debug('afterShutdown destroyed=%j', self.destroyed, self._readableState);
  this.callback(); // callback may come after call to destroy.

  if (self.destroyed) return;

  if (self._readableState.ended) {
    debug('readableState ended, destroying');
    self.destroy();
  } else {
    self.once('_socketEnd', self.destroy);
  }
} // the EOF has been received, and no more bytes are coming.
// if the writable side has ended already, then clean everything
// up.


function onSocketEnd() {
  // XXX Should not have to do as much in this function.
  // ended should already be true, since this is called *after*
  // the EOF errno and onread has eof'ed
  debug('onSocketEnd', this._readableState);
  this._readableState.ended = true;

  if (this._readableState.endEmitted) {
    this.readable = false;
    maybeDestroy(this);
  } else {
    this.once('end', function end() {
      this.readable = false;
      maybeDestroy(this);
    });
    this.read(0);
  }

  if (!this.allowHalfOpen) {
    this.write = writeAfterFIN;
    this.destroySoon();
  }
} // Provide a better error message when we call end() as a result
// of the other side sending a FIN.  The standard 'write after end'
// is overly vague, and makes it seem like the user's code is to blame.


function writeAfterFIN(chunk, encoding, cb) {
  if (typeof encoding === 'function') {
    cb = encoding;
    encoding = null;
  }

  var er = new Error('This socket has been ended by the other party');
  er.code = 'EPIPE'; // TODO: defer error events consistently everywhere, not just the cb

  this.emit('error', er);

  if (typeof cb === 'function') {
    nextTick(this[async_id_symbol], cb, er);
  }
} // FIXME(joyeecheung): this method is neither documented nor tested


Socket.prototype.listen = function () {
  debug('socket.listen');
  this.on('connection', arguments[0]);
  listenInCluster(this, null, null, null);
};

Socket.prototype.setTimeout = function (msecs, callback) {
  if (msecs === 0) {
    timers.unenroll(this);

    if (callback) {
      this.removeListener('timeout', callback);
    }
  } else {
    timers.enroll(this, msecs);

    timers._unrefActive(this);

    if (callback) {
      this.once('timeout', callback);
    }
  }

  return this;
};

Socket.prototype._onTimeout = function () {
  if (this._handle) {
    // `.prevWriteQueueSize` !== `.updateWriteQueueSize()` means there is
    // an active write in progress, so we suppress the timeout.
    var prevWriteQueueSize = this._handle.writeQueueSize;

    if (prevWriteQueueSize > 0 && prevWriteQueueSize !== this._handle.updateWriteQueueSize()) {
      this._unrefTimer();

      return;
    }
  }

  debug('_onTimeout');
  this.emit('timeout');
};

Socket.prototype.setNoDelay = function (enable) {
  var _this2 = this;

  if (!this._handle) {
    this.once('connect', enable ? this.setNoDelay : function () {
      return _this2.setNoDelay(enable);
    });
    return this;
  } // backwards compatibility: assume true when `enable` is omitted


  if (this._handle.setNoDelay) this._handle.setNoDelay(enable === undefined ? true : !!enable);
  return this;
};

Socket.prototype.setKeepAlive = function (setting, msecs) {
  var _this3 = this;

  if (!this._handle) {
    this.once('connect', function () {
      return _this3.setKeepAlive(setting, msecs);
    });
    return this;
  }

  if (this._handle.setKeepAlive) this._handle.setKeepAlive(setting, ~~(msecs / 1000));
  return this;
};

Socket.prototype.address = function () {
  return this._getsockname();
};

Object.defineProperty(Socket.prototype, '_connecting', {
  get: function get() {
    return this.connecting;
  }
});
Object.defineProperty(Socket.prototype, 'readyState', {
  get: function get() {
    if (this.connecting) {
      return 'opening';
    } else if (this.readable && this.writable) {
      return 'open';
    } else if (this.readable && !this.writable) {
      return 'readOnly';
    } else if (!this.readable && this.writable) {
      return 'writeOnly';
    } else {
      return 'closed';
    }
  }
});
Object.defineProperty(Socket.prototype, 'bufferSize', {
  get: function get() {
    if (this._handle) {
      return this._handle.writeQueueSize + this._writableState.length;
    }
  }
}); // Just call handle.readStart until we have enough in the buffer

Socket.prototype._read = function (n) {
  var _this4 = this;

  debug('_read');

  if (this.connecting || !this._handle) {
    debug('_read wait for connection');
    this.once('connect', function () {
      return _this4._read(n);
    });
  } else if (!this._handle.reading) {
    // not already reading, start the flow
    debug('Socket._read readStart');
    this._handle.reading = true;

    var err = this._handle.readStart();

    if (err) this.destroy(errnoException(err, 'read'));
  }
};

Socket.prototype.end = function (data, encoding, callback) {
  stream.Duplex.prototype.end.call(this, data, encoding, callback);
  DTRACE_NET_STREAM_END(this);
  LTTNG_NET_STREAM_END(this);
  return this;
}; // Call whenever we set writable=false or readable=false


function maybeDestroy(socket) {
  if (!socket.readable && !socket.writable && !socket.destroyed && !socket.connecting && !socket._writableState.length) {
    socket.destroy();
  }
}

Socket.prototype.destroySoon = function () {
  if (this.writable) this.end();
  if (this._writableState.finished) this.destroy();else this.once('finish', this.destroy);
};

Socket.prototype._destroy = function (exception, cb) {
  var _this5 = this;

  debug('destroy');
  this.connecting = false;
  this.readable = this.writable = false;

  for (var s = this; s !== null; s = s._parent) {
    timers.unenroll(s);
  }

  debug('close');

  if (this._handle) {
    if (this !== process.stderr) debug('close handle');
    var isException = exception ? true : false; // `bytesRead` should be accessible after `.destroy()`

    this[BYTES_READ] = this._handle.bytesRead;

    this._handle.close(function () {
      debug('emit close');

      _this5.emit('close', isException);
    });

    this._handle.onread = noop;
    this._handle = null;
    this._sockname = null;
  }

  cb(exception);

  if (this._server) {
    COUNTER_NET_SERVER_CONNECTION_CLOSE(this);
    debug('has server');
    this._server._connections--;

    if (this._server._emitCloseIfDrained) {
      this._server._emitCloseIfDrained();
    }
  }
}; // This function is called whenever the handle gets a
// buffer, or when there's an error reading.


function onread(nread, buffer) {
  var handle = this;
  var self = handle.owner;
  assert(handle === self._handle, 'handle != self._handle');

  self._unrefTimer();

  debug('onread', nread);

  if (nread > 0) {
    debug('got data'); // read success.
    // In theory (and in practice) calling readStop right now
    // will prevent this from being called again until _read() gets
    // called again.
    // Optimization: emit the original buffer with end points

    var ret = self.push(buffer);

    if (handle.reading && !ret) {
      handle.reading = false;
      debug('readStop');
      var err = handle.readStop();
      if (err) self.destroy(errnoException(err, 'read'));
    }

    return;
  } // if we didn't get any bytes, that doesn't necessarily mean EOF.
  // wait for the next one.


  if (nread === 0) {
    debug('not any data, keep waiting');
    return;
  } // Error, possibly EOF.


  if (nread !== uv.UV_EOF) {
    return self.destroy(errnoException(nread, 'read'));
  }

  debug('EOF'); // push a null to signal the end of data.
  // Do it before `maybeDestroy` for correct order of events:
  // `end` -> `close`

  self.push(null);

  if (self._readableState.length === 0) {
    self.readable = false;
    maybeDestroy(self);
  } // internal end event so that we know that the actual socket
  // is no longer readable, and we can start the shutdown
  // procedure. No need to wait for all the data to be consumed.


  self.emit('_socketEnd');
}

Socket.prototype._getpeername = function () {
  if (!this._peername) {
    if (!this._handle || !this._handle.getpeername) {
      return {};
    }

    var out = {};

    var err = this._handle.getpeername(out);

    if (err) return {}; // FIXME(bnoordhuis) Throw?

    this._peername = out;
  }

  return this._peername;
};

function protoGetter(name, callback) {
  Object.defineProperty(Socket.prototype, name, {
    configurable: false,
    enumerable: true,
    get: callback
  });
}

protoGetter('bytesRead', function bytesRead() {
  return this._handle ? this._handle.bytesRead : this[BYTES_READ];
});
protoGetter('remoteAddress', function remoteAddress() {
  return this._getpeername().address;
});
protoGetter('remoteFamily', function remoteFamily() {
  return this._getpeername().family;
});
protoGetter('remotePort', function remotePort() {
  return this._getpeername().port;
});

Socket.prototype._getsockname = function () {
  if (!this._handle || !this._handle.getsockname) {
    return {};
  }

  if (!this._sockname) {
    var out = {};

    var err = this._handle.getsockname(out);

    if (err) return {}; // FIXME(bnoordhuis) Throw?

    this._sockname = out;
  }

  return this._sockname;
};

protoGetter('localAddress', function localAddress() {
  return this._getsockname().address;
});
protoGetter('localPort', function localPort() {
  return this._getsockname().port;
});

Socket.prototype.write = function (chunk, encoding, cb) {
  if (typeof chunk !== 'string' && !(chunk instanceof Buffer)) {
    throw new TypeError('Invalid data, chunk must be a string or buffer, not ' + _typeof(chunk));
  }

  return stream.Duplex.prototype.write.apply(this, arguments);
};

Socket.prototype._writeGeneric = function (writev, data, encoding, cb) {
  // If we are still connecting, then buffer this for later.
  // The Writable logic will buffer up any more writes while
  // waiting for this one to be done.
  if (this.connecting) {
    this._pendingData = data;
    this._pendingEncoding = encoding;
    this.once('connect', function connect() {
      this._writeGeneric(writev, data, encoding, cb);
    });
    return;
  }

  this._pendingData = null;
  this._pendingEncoding = '';

  this._unrefTimer();

  if (!this._handle) {
    this.destroy(new Error('This socket is closed'), cb);
    return false;
  }

  var req = new WriteWrap();
  req.handle = this._handle;
  req.oncomplete = afterWrite;
  req.async = false;
  var err;

  if (writev) {
    var allBuffers = data.allBuffers;
    var chunks;
    var i;

    if (allBuffers) {
      chunks = data;

      for (i = 0; i < data.length; i++) {
        data[i] = data[i].chunk;
      }
    } else {
      chunks = new Array(data.length << 1);

      for (i = 0; i < data.length; i++) {
        var entry = data[i];
        chunks[i * 2] = entry.chunk;
        chunks[i * 2 + 1] = entry.encoding;
      }
    }

    err = this._handle.writev(req, chunks, allBuffers); // Retain chunks

    if (err === 0) req._chunks = chunks;
  } else {
    err = createWriteReq(req, this._handle, data, encoding);
  }

  if (err) return this.destroy(errnoException(err, 'write', req.error), cb);
  this._bytesDispatched += req.bytes; // If it was entirely flushed, we can write some more right now.
  // However, if more is left in the queue, then wait until that clears.

  if (req.async && this._handle.writeQueueSize !== 0) req.cb = cb;else cb();
};

Socket.prototype._writev = function (chunks, cb) {
  this._writeGeneric(true, chunks, '', cb);
};

Socket.prototype._write = function (data, encoding, cb) {
  this._writeGeneric(false, data, encoding, cb);
};

function createWriteReq(req, handle, data, encoding) {
  switch (encoding) {
    case 'latin1':
    case 'binary':
      return handle.writeLatin1String(req, data);

    case 'buffer':
      return handle.writeBuffer(req, data);

    case 'utf8':
    case 'utf-8':
      return handle.writeUtf8String(req, data);

    case 'ascii':
      return handle.writeAsciiString(req, data);

    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return handle.writeUcs2String(req, data);

    default:
      return handle.writeBuffer(req, Buffer.from(data, encoding));
  }
}

protoGetter('bytesWritten', function bytesWritten() {
  var bytes = this._bytesDispatched;
  var state = this._writableState;
  var data = this._pendingData;
  var encoding = this._pendingEncoding;
  if (!state) return undefined;
  state.getBuffer().forEach(function (el) {
    if (el.chunk instanceof Buffer) bytes += el.chunk.length;else bytes += Buffer.byteLength(el.chunk, el.encoding);
  });

  if (Array.isArray(data)) {
    // was a writev, iterate over chunks to get total length
    for (var i = 0; i < data.length; i++) {
      var chunk = data[i];
      if (data.allBuffers || chunk instanceof Buffer) bytes += chunk.length;else bytes += Buffer.byteLength(chunk.chunk, chunk.encoding);
    }
  } else if (data) {
    // Writes are either a string or a Buffer.
    if (typeof data !== 'string') bytes += data.length;else bytes += Buffer.byteLength(data, encoding);
  }

  return bytes;
});

function afterWrite(status, handle, req, err) {
  var self = handle.owner;
  if (self !== process.stderr && self !== process.stdout) debug('afterWrite', status); // callback may come after call to destroy.

  if (self.destroyed) {
    debug('afterWrite destroyed');
    return;
  }

  if (status < 0) {
    var ex = errnoException(status, 'write', req.error);
    debug('write failure', ex);
    self.destroy(ex, req.cb);
    return;
  }

  self._unrefTimer();

  if (self !== process.stderr && self !== process.stdout) debug('afterWrite call cb');
  if (req.cb) req.cb.call(self);
}

function checkBindError(err, port, handle) {
  // EADDRINUSE may not be reported until we call listen() or connect().
  // To complicate matters, a failed bind() followed by listen() or connect()
  // will implicitly bind to a random port. Ergo, check that the socket is
  // bound to the expected port before calling listen() or connect().
  //
  // FIXME(bnoordhuis) Doesn't work for pipe handles, they don't have a
  // getsockname() method. Non-issue for now, the cluster module doesn't
  // really support pipes anyway.
  if (err === 0 && port > 0 && handle.getsockname) {
    var out = {};
    err = handle.getsockname(out);

    if (err === 0 && port !== out.port) {
      debug("checkBindError, bound to ".concat(out.port, " instead of ").concat(port));
      err = uv.UV_EADDRINUSE;
    }
  }

  return err;
}

function internalConnect(self, address, port, addressType, localAddress, localPort) {
  // TODO return promise from Socket.prototype.connect which
  // wraps _connectReq.
  assert(self.connecting);
  var err;

  if (localAddress || localPort) {
    if (addressType === 4) {
      localAddress = localAddress || '0.0.0.0';
      err = self._handle.bind(localAddress, localPort);
    } else if (addressType === 6) {
      localAddress = localAddress || '::';
      err = self._handle.bind6(localAddress, localPort);
    } else {
      self.destroy(new TypeError('Invalid addressType: ' + addressType));
      return;
    }

    debug('binding to localAddress: %s and localPort: %d (addressType: %d)', localAddress, localPort, addressType);
    err = checkBindError(err, localPort, self._handle);

    if (err) {
      var ex = exceptionWithHostPort(err, 'bind', localAddress, localPort);
      self.destroy(ex);
      return;
    }
  }

  if (addressType === 6 || addressType === 4) {
    var req = new TCPConnectWrap();
    req.oncomplete = afterConnect;
    req.address = address;
    req.port = port;
    req.localAddress = localAddress;
    req.localPort = localPort;
    if (addressType === 4) err = self._handle.connect(req, address, port);else err = self._handle.connect6(req, address, port);
  } else {
    var _req = new PipeConnectWrap();

    _req.address = address;
    _req.oncomplete = afterConnect;
    err = self._handle.connect(_req, address, afterConnect);
  }

  if (err) {
    var sockname = self._getsockname();

    var details;

    if (sockname) {
      details = sockname.address + ':' + sockname.port;
    }

    var _ex = exceptionWithHostPort(err, 'connect', address, port, details);

    self.destroy(_ex);
  }
}

Socket.prototype.connect = function () {
  var normalized; // If passed an array, it's treated as an array of arguments that have
  // already been normalized (so we don't normalize more than once). This has
  // been solved before in https://github.com/nodejs/node/pull/12342, but was
  // reverted as it had unintended side effects.

  for (var _len2 = arguments.length, args = new Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
    args[_key2] = arguments[_key2];
  }

  if (Array.isArray(args[0]) && args[0][normalizedArgsSymbol]) {
    normalized = args[0];
  } else {
    normalized = normalizeArgs(args);
  }

  var options = normalized[0];
  var cb = normalized[1];
  if (this.write !== Socket.prototype.write) this.write = Socket.prototype.write;

  if (this.destroyed) {
    this._undestroy();

    this._handle = null;
    this._peername = null;
    this._sockname = null;
  }

  var path = options.path;
  var pipe = !!path;
  debug('pipe', pipe, path);

  if (!this._handle) {
    this._handle = pipe ? new Pipe(PipeConstants.SOCKET) : new TCP(TCPConstants.SOCKET);
    initSocketHandle(this);
  }

  if (cb !== null) {
    this.once('connect', cb);
  }

  this._unrefTimer();

  this.connecting = true;
  this.writable = true;

  if (pipe) {
    if (typeof path !== 'string') {
      throw new errors.TypeError('ERR_INVALID_ARG_TYPE', 'options.path', 'string', path);
    }

    defaultTriggerAsyncIdScope(this[async_id_symbol], internalConnect, this, path);
  } else {
    lookupAndConnect(this, options);
  }

  return this;
};

function lookupAndConnect(self, options) {
  var host = options.host || 'localhost';
  var port = options.port;
  var localAddress = options.localAddress;
  var localPort = options.localPort;

  if (localAddress && !cares.isIP(localAddress)) {
    throw new TypeError('"localAddress" option must be a valid IP: ' + localAddress);
  }

  if (localPort && typeof localPort !== 'number') {
    throw new TypeError('"localPort" option should be a number: ' + localPort);
  }

  if (typeof port !== 'undefined') {
    if (typeof port !== 'number' && typeof port !== 'string') {
      throw new TypeError('"port" option should be a number or string: ' + port);
    }

    if (!isLegalPort(port)) {
      throw new RangeError('"port" option should be >= 0 and < 65536: ' + port);
    }
  }

  port |= 0; // If host is an IP, skip performing a lookup

  var addressType = cares.isIP(host);

  if (addressType) {
    nextTick(self[async_id_symbol], function () {
      if (self.connecting) defaultTriggerAsyncIdScope(self[async_id_symbol], internalConnect, self, host, port, addressType, localAddress, localPort);
    });
    return;
  }

  if (options.lookup && typeof options.lookup !== 'function') throw new TypeError('"lookup" option should be a function');
  var dnsopts = {
    family: options.family,
    hints: options.hints || 0
  };

  if (process.platform !== 'win32' && dnsopts.family !== 4 && dnsopts.family !== 6 && dnsopts.hints === 0) {
    dnsopts.hints = dns.ADDRCONFIG;
  }

  debug('connect: find host', host);
  debug('connect: dns options', dnsopts);
  self._host = host;
  var lookup = options.lookup || dns.lookup;
  defaultTriggerAsyncIdScope(self[async_id_symbol], function () {
    lookup(host, dnsopts, function emitLookup(err, ip, addressType) {
      self.emit('lookup', err, ip, addressType, host); // It's possible we were destroyed while looking this up.
      // XXX it would be great if we could cancel the promise returned by
      // the look up.

      if (!self.connecting) return;

      if (err) {
        // net.createConnection() creates a net.Socket object and
        // immediately calls net.Socket.connect() on it (that's us).
        // There are no event listeners registered yet so defer the
        // error event to the next tick.
        err.host = options.host;
        err.port = options.port;
        err.message = err.message + ' ' + options.host + ':' + options.port;
        process.nextTick(connectErrorNT, self, err);
      } else {
        self._unrefTimer();

        defaultTriggerAsyncIdScope(self[async_id_symbol], internalConnect, self, ip, port, addressType, localAddress, localPort);
      }
    });
  });
}

function connectErrorNT(self, err) {
  self.destroy(err);
}

Socket.prototype.ref = function () {
  if (!this._handle) {
    this.once('connect', this.ref);
    return this;
  }

  if (typeof this._handle.ref === 'function') {
    this._handle.ref();
  }

  return this;
};

Socket.prototype.unref = function () {
  if (!this._handle) {
    this.once('connect', this.unref);
    return this;
  }

  if (typeof this._handle.unref === 'function') {
    this._handle.unref();
  }

  return this;
};

function afterConnect(status, handle, req, readable, writable) {
  var self = handle.owner; // callback may come after call to destroy

  if (self.destroyed) {
    return;
  } // Update handle if it was wrapped
  // TODO(indutny): assert that the handle is actually an ancestor of old one


  handle = self._handle;
  debug('afterConnect');
  assert(self.connecting);
  self.connecting = false;
  self._sockname = null;

  if (status === 0) {
    self.readable = readable;
    self.writable = writable;

    self._unrefTimer();

    self.emit('connect');
    self.emit('ready'); // start the first read, or get an immediate EOF.
    // this doesn't actually consume any bytes, because len=0.

    if (readable && !self.isPaused()) self.read(0);
  } else {
    self.connecting = false;
    var details;

    if (req.localAddress && req.localPort) {
      details = req.localAddress + ':' + req.localPort;
    }

    var ex = exceptionWithHostPort(status, 'connect', req.address, req.port, details);

    if (details) {
      ex.localAddress = req.localAddress;
      ex.localPort = req.localPort;
    }

    self.destroy(ex);
  }
}

function Server(options, connectionListener) {
  var _this6 = this;

  if (!(this instanceof Server)) return new Server(options, connectionListener);
  EventEmitter.call(this);

  if (typeof options === 'function') {
    connectionListener = options;
    options = {};
    this.on('connection', connectionListener);
  } else if (options == null || _typeof(options) === 'object') {
    options = options || {};

    if (typeof connectionListener === 'function') {
      this.on('connection', connectionListener);
    }
  } else {
    throw new TypeError('options must be an object');
  }

  this._connections = 0;
  Object.defineProperty(this, 'connections', {
    get: internalUtil.deprecate(function () {
      if (_this6._usingSlaves) {
        return null;
      }

      return _this6._connections;
    }, 'Server.connections property is deprecated. ' + 'Use Server.getConnections method instead.', 'DEP0020'),
    set: internalUtil.deprecate(function (val) {
      return _this6._connections = val;
    }, 'Server.connections property is deprecated.', 'DEP0020'),
    configurable: true,
    enumerable: false
  });
  this[async_id_symbol] = -1;
  this._handle = null;
  this._usingSlaves = false;
  this._slaves = [];
  this._unref = false;
  this.allowHalfOpen = options.allowHalfOpen || false;
  this.pauseOnConnect = !!options.pauseOnConnect;
}

util.inherits(Server, EventEmitter);

function toNumber(x) {
  return (x = Number(x)) >= 0 ? x : false;
} // Returns handle if it can be created, or error code if it can't


function createServerHandle(address, port, addressType, fd) {
  var err = 0; // assign handle in listen, and clean up if bind or listen fails

  var handle;
  var isTCP = false;

  if (typeof fd === 'number' && fd >= 0) {
    try {
      handle = createHandle(fd, true);
    } catch (e) {
      // Not a fd we can listen on.  This will trigger an error.
      debug('listen invalid fd=%d:', fd, e.message);
      return uv.UV_EINVAL;
    }

    handle.open(fd);
    handle.readable = true;
    handle.writable = true;
    assert(!address && !port);
  } else if (port === -1 && addressType === -1) {
    handle = new Pipe(PipeConstants.SERVER);

    if (process.platform === 'win32') {
      var instances = parseInt(process.env.NODE_PENDING_PIPE_INSTANCES);

      if (!isNaN(instances)) {
        handle.setPendingInstances(instances);
      }
    }
  } else {
    handle = new TCP(TCPConstants.SERVER);
    isTCP = true;
  }

  if (address || port || isTCP) {
    debug('bind to', address || 'any');

    if (!address) {
      // Try binding to ipv6 first
      err = handle.bind6('::', port);

      if (err) {
        handle.close(); // Fallback to ipv4

        return createServerHandle('0.0.0.0', port);
      }
    } else if (addressType === 6) {
      err = handle.bind6(address, port);
    } else {
      err = handle.bind(address, port);
    }
  }

  if (err) {
    handle.close();
    return err;
  }

  return handle;
}

function setupListenHandle(address, port, addressType, backlog, fd) {
  debug('setupListenHandle', address, port, addressType, backlog, fd); // If there is not yet a handle, we need to create one and bind.
  // In the case of a server sent via IPC, we don't need to do this.

  if (this._handle) {
    debug('setupListenHandle: have a handle already');
  } else {
    debug('setupListenHandle: create a handle');
    var rval = null; // Try to bind to the unspecified IPv6 address, see if IPv6 is available

    if (!address && typeof fd !== 'number') {
      rval = createServerHandle('::', port, 6, fd);

      if (typeof rval === 'number') {
        rval = null;
        address = '0.0.0.0';
        addressType = 4;
      } else {
        address = '::';
        addressType = 6;
      }
    }

    if (rval === null) rval = createServerHandle(address, port, addressType, fd);

    if (typeof rval === 'number') {
      var error = exceptionWithHostPort(rval, 'listen', address, port);
      process.nextTick(emitErrorNT, this, error);
      return;
    }

    this._handle = rval;
  }

  this[async_id_symbol] = getNewAsyncId(this._handle);
  this._handle.onconnection = onconnection;
  this._handle.owner = this; // Use a backlog of 512 entries. We pass 511 to the listen() call because
  // the kernel does: backlogsize = roundup_pow_of_two(backlogsize + 1);
  // which will thus give us a backlog of 512 entries.

  var err = this._handle.listen(backlog || 511);

  if (err) {
    var ex = exceptionWithHostPort(err, 'listen', address, port);

    this._handle.close();

    this._handle = null;
    nextTick(this[async_id_symbol], emitErrorNT, this, ex);
    return;
  } // generate connection key, this should be unique to the connection


  this._connectionKey = addressType + ':' + address + ':' + port; // unref the handle if the server was unref'ed prior to listening

  if (this._unref) this.unref();
  nextTick(this[async_id_symbol], emitListeningNT, this);
}

Server.prototype._listen2 = setupListenHandle; // legacy alias

function emitErrorNT(self, err) {
  self.emit('error', err);
}

function emitListeningNT(self) {
  // ensure handle hasn't closed
  if (self._handle) self.emit('listening');
}

function listenInCluster(server, address, port, addressType, backlog, fd, exclusive) {
  exclusive = !!exclusive;
  if (cluster === null) cluster = require('cluster');

  if (cluster.isMaster || exclusive) {
    // Will create a new handle
    // _listen2 sets up the listened handle, it is still named like this
    // to avoid breaking code that wraps this method
    server._listen2(address, port, addressType, backlog, fd);

    return;
  }

  var serverQuery = {
    address: address,
    port: port,
    addressType: addressType,
    fd: fd,
    flags: 0
  }; // Get the master's server handle, and listen on it

  cluster._getServer(server, serverQuery, listenOnMasterHandle);

  function listenOnMasterHandle(err, handle) {
    err = checkBindError(err, port, handle);

    if (err) {
      var ex = exceptionWithHostPort(err, 'bind', address, port);
      return server.emit('error', ex);
    } // Reuse master's server handle


    server._handle = handle; // _listen2 sets up the listened handle, it is still named like this
    // to avoid breaking code that wraps this method

    server._listen2(address, port, addressType, backlog, fd);
  }
}

Server.prototype.listen = function () {
  for (var _len3 = arguments.length, args = new Array(_len3), _key3 = 0; _key3 < _len3; _key3++) {
    args[_key3] = arguments[_key3];
  }

  var normalized = normalizeArgs(args);
  var options = normalized[0];
  var cb = normalized[1];
  var hasCallback = cb !== null;

  if (hasCallback) {
    this.once('listening', cb);
  }

  var backlogFromArgs = // (handle, backlog) or (path, backlog) or (port, backlog)
  toNumber(args.length > 1 && args[1]) || toNumber(args.length > 2 && args[2]); // (port, host, backlog)

  options = options._handle || options.handle || options; // (handle[, backlog][, cb]) where handle is an object with a handle

  if (options instanceof TCP) {
    this._handle = options;
    this[async_id_symbol] = this._handle.getAsyncId();
    listenInCluster(this, null, -1, -1, backlogFromArgs);
    return this;
  } // (handle[, backlog][, cb]) where handle is an object with a fd


  if (typeof options.fd === 'number' && options.fd >= 0) {
    listenInCluster(this, null, null, null, backlogFromArgs, options.fd);
    return this;
  } // ([port][, host][, backlog][, cb]) where port is omitted,
  // that is, listen(), listen(null), listen(cb), or listen(null, cb)
  // or (options[, cb]) where options.port is explicitly set as undefined or
  // null, bind to an arbitrary unused port


  if (args.length === 0 || typeof args[0] === 'function' || typeof options.port === 'undefined' && 'port' in options || options.port === null) {
    options.port = 0;
  } // ([port][, host][, backlog][, cb]) where port is specified
  // or (options[, cb]) where options.port is specified
  // or if options.port is normalized as 0 before


  var backlog;

  if (typeof options.port === 'number' || typeof options.port === 'string') {
    if (!isLegalPort(options.port)) {
      throw new RangeError('"port" argument must be >= 0 and < 65536');
    }

    backlog = options.backlog || backlogFromArgs; // start TCP server listening on host:port

    if (options.host) {
      lookupAndListen(this, options.port | 0, options.host, backlog, options.exclusive);
    } else {
      // Undefined host, listens on unspecified address
      // Default addressType 4 will be used to search for master server
      listenInCluster(this, null, options.port | 0, 4, backlog, undefined, options.exclusive);
    }

    return this;
  } // (path[, backlog][, cb]) or (options[, cb])
  // where path or options.path is a UNIX domain socket or Windows pipe


  if (options.path && isPipeName(options.path)) {
    var pipeName = this._pipeName = options.path;
    backlog = options.backlog || backlogFromArgs;
    listenInCluster(this, pipeName, -1, -1, backlog, undefined, options.exclusive);
    return this;
  }

  throw new Error('Invalid listen argument: ' + util.inspect(options));
};

function lookupAndListen(self, port, address, backlog, exclusive) {
  dns.lookup(address, function doListen(err, ip, addressType) {
    if (err) {
      self.emit('error', err);
    } else {
      addressType = ip ? addressType : 4;
      listenInCluster(self, ip, port, addressType, backlog, undefined, exclusive);
    }
  });
}

Object.defineProperty(Server.prototype, 'listening', {
  get: function get() {
    return !!this._handle;
  },
  configurable: true,
  enumerable: true
});

Server.prototype.address = function () {
  if (this._handle && this._handle.getsockname) {
    var out = {};

    var err = this._handle.getsockname(out);

    if (err) {
      throw errnoException(err, 'address');
    }

    return out;
  } else if (this._pipeName) {
    return this._pipeName;
  } else {
    return null;
  }
};

function onconnection(err, clientHandle) {
  var handle = this;
  var self = handle.owner;
  debug('onconnection');

  if (err) {
    self.emit('error', errnoException(err, 'accept'));
    return;
  }

  if (self.maxConnections && self._connections >= self.maxConnections) {
    clientHandle.close();
    return;
  }

  var socket = new Socket({
    handle: clientHandle,
    allowHalfOpen: self.allowHalfOpen,
    pauseOnCreate: self.pauseOnConnect
  });
  socket.readable = socket.writable = true;
  self._connections++;
  socket.server = self;
  socket._server = self;
  DTRACE_NET_SERVER_CONNECTION(socket);
  LTTNG_NET_SERVER_CONNECTION(socket);
  COUNTER_NET_SERVER_CONNECTION(socket);
  self.emit('connection', socket);
}

Server.prototype.getConnections = function (cb) {
  var self = this;

  function end(err, connections) {
    var asyncId = self._handle ? self[async_id_symbol] : null;
    nextTick(asyncId, cb, err, connections);
  }

  if (!this._usingSlaves) {
    end(null, this._connections);
    return this;
  } // Poll slaves


  var left = this._slaves.length;
  var total = this._connections;

  function oncount(err, count) {
    if (err) {
      left = -1;
      return end(err);
    }

    total += count;
    if (--left === 0) return end(null, total);
  }

  for (var n = 0; n < this._slaves.length; n++) {
    this._slaves[n].getConnections(oncount);
  }

  return this;
};

Server.prototype.close = function (cb) {
  var _this7 = this;

  if (typeof cb === 'function') {
    if (!this._handle) {
      this.once('close', function close() {
        cb(new Error('Not running'));
      });
    } else {
      this.once('close', cb);
    }
  }

  if (this._handle) {
    this._handle.close();

    this._handle = null;
  }

  if (this._usingSlaves) {
    var left = this._slaves.length;

    var onSlaveClose = function onSlaveClose() {
      if (--left !== 0) return;
      _this7._connections = 0;

      _this7._emitCloseIfDrained();
    }; // Increment connections to be sure that, even if all sockets will be closed
    // during polling of slaves, `close` event will be emitted only once.


    this._connections++; // Poll slaves

    for (var n = 0; n < this._slaves.length; n++) {
      this._slaves[n].close(onSlaveClose);
    }
  } else {
    this._emitCloseIfDrained();
  }

  return this;
};

Server.prototype._emitCloseIfDrained = function () {
  debug('SERVER _emitCloseIfDrained');

  if (this._handle || this._connections) {
    debug('SERVER handle? %j   connections? %d', !!this._handle, this._connections);
    return;
  }

  var asyncId = this._handle ? this[async_id_symbol] : null;
  nextTick(asyncId, emitCloseNT, this);
};

function emitCloseNT(self) {
  debug('SERVER: emit close');
  self.emit('close');
}

Server.prototype.listenFD = internalUtil.deprecate(function (fd, type) {
  return this.listen({
    fd: fd
  });
}, 'Server.listenFD is deprecated. Use Server.listen({fd: <number>}) instead.', 'DEP0021');

Server.prototype._setupSlave = function (socketList) {
  var _this8 = this;

  this._usingSlaves = true;

  this._slaves.push(socketList);

  socketList.once('exit', function (socketList) {
    var index = _this8._slaves.indexOf(socketList);

    _this8._slaves.splice(index, 1);
  });
};

Server.prototype.ref = function () {
  this._unref = false;
  if (this._handle) this._handle.ref();
  return this;
};

Server.prototype.unref = function () {
  this._unref = true;
  if (this._handle) this._handle.unref();
  return this;
};

var _setSimultaneousAccepts;

if (process.platform === 'win32') {
  var simultaneousAccepts;

  _setSimultaneousAccepts = function _setSimultaneousAccepts(handle) {
    if (handle === undefined) {
      return;
    }

    if (simultaneousAccepts === undefined) {
      simultaneousAccepts = process.env.NODE_MANY_ACCEPTS && process.env.NODE_MANY_ACCEPTS !== '0';
    }

    if (handle._simultaneousAccepts !== simultaneousAccepts) {
      handle.setSimultaneousAccepts(simultaneousAccepts);
      handle._simultaneousAccepts = simultaneousAccepts;
    }
  };
} else {
  _setSimultaneousAccepts = function _setSimultaneousAccepts(handle) {};
}

module.exports = {
  _createServerHandle: createServerHandle,
  _normalizeArgs: normalizeArgs,
  _setSimultaneousAccepts: _setSimultaneousAccepts,
  connect: connect,
  createConnection: connect,
  createServer: createServer,
  isIP: cares.isIP,
  isIPv4: cares.isIPv4,
  isIPv6: cares.isIPv6,
  Server: Server,
  Socket: Socket,
  Stream: Socket // Legacy naming

};