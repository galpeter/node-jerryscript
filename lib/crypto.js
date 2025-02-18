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
// Note: In 0.8 and before, crypto functions all defaulted to using
// binary-encoded strings rather than buffers.
'use strict';

var internalUtil = require('internal/util');

internalUtil.assertCrypto();
exports.DEFAULT_ENCODING = 'buffer';
var constants = process.binding('constants').crypto;
var binding = process.binding('crypto');
var randomBytes = binding.randomBytes;
var getCiphers = binding.getCiphers;
var getHashes = binding.getHashes;
var getCurves = binding.getCurves;
var getFipsCrypto = binding.getFipsCrypto;
var setFipsCrypto = binding.setFipsCrypto;
var timingSafeEqual = binding.timingSafeEqual;

var Buffer = require('buffer').Buffer;

var kBufferMaxLength = require('buffer').kMaxLength;

var stream = require('stream');

var util = require('util');

var _require = require('internal/util/types'),
    isArrayBufferView = _require.isArrayBufferView,
    isUint8Array = _require.isUint8Array;

var LazyTransform = require('internal/streams/lazy_transform');

var DH_GENERATOR = 2;
Object.defineProperty(exports, 'constants', {
  configurable: false,
  enumerable: true,
  value: constants
}); // This is here because many functions accepted binary strings without
// any explicit encoding in older versions of node, and we don't want
// to break them unnecessarily.

function toBuf(str, encoding) {
  if (typeof str === 'string') {
    if (encoding === 'buffer' || !encoding) encoding = 'utf8';
    return Buffer.from(str, encoding);
  }

  return str;
}

exports._toBuf = toBuf;

var assert = require('assert');

var StringDecoder = require('string_decoder').StringDecoder;

exports.Hash = Hash;

function Hash(algorithm, options) {
  if (!(this instanceof Hash)) return new Hash(algorithm, options);
  this._handle = new binding.Hash(algorithm);
  LazyTransform.call(this, options);
}

util.inherits(Hash, LazyTransform);

Hash.prototype._transform = function _transform(chunk, encoding, callback) {
  this._handle.update(chunk, encoding);

  callback();
};

Hash.prototype._flush = function _flush(callback) {
  this.push(this._handle.digest());
  callback();
};

Hash.prototype.update = function update(data, encoding) {
  encoding = encoding || exports.DEFAULT_ENCODING;

  this._handle.update(data, encoding);

  return this;
};

Hash.prototype.digest = function digest(outputEncoding) {
  outputEncoding = outputEncoding || exports.DEFAULT_ENCODING; // Explicit conversion for backward compatibility.

  return this._handle.digest("".concat(outputEncoding));
};

exports.Hmac = Hmac;

function Hmac(hmac, key, options) {
  if (!(this instanceof Hmac)) return new Hmac(hmac, key, options);
  this._handle = new binding.Hmac();

  this._handle.init(hmac, toBuf(key));

  LazyTransform.call(this, options);
}

util.inherits(Hmac, LazyTransform);
Hmac.prototype.update = Hash.prototype.update;
Hmac.prototype.digest = Hash.prototype.digest;
Hmac.prototype._flush = Hash.prototype._flush;
Hmac.prototype._transform = Hash.prototype._transform;

function getDecoder(decoder, encoding) {
  encoding = internalUtil.normalizeEncoding(encoding);
  decoder = decoder || new StringDecoder(encoding);
  assert(decoder.encoding === encoding, 'Cannot change encoding');
  return decoder;
}

exports.Cipher = Cipher;

function Cipher(cipher, password, options) {
  if (!(this instanceof Cipher)) return new Cipher(cipher, password, options);
  this._handle = new binding.CipherBase(true);

  this._handle.init(cipher, toBuf(password));

  this._decoder = null;
  LazyTransform.call(this, options);
}

util.inherits(Cipher, LazyTransform);

Cipher.prototype._transform = function _transform(chunk, encoding, callback) {
  this.push(this._handle.update(chunk, encoding));
  callback();
};

Cipher.prototype._flush = function _flush(callback) {
  try {
    this.push(this._handle["final"]());
  } catch (e) {
    callback(e);
    return;
  }

  callback();
};

Cipher.prototype.update = function update(data, inputEncoding, outputEncoding) {
  inputEncoding = inputEncoding || exports.DEFAULT_ENCODING;
  outputEncoding = outputEncoding || exports.DEFAULT_ENCODING;

  var ret = this._handle.update(data, inputEncoding);

  if (outputEncoding && outputEncoding !== 'buffer') {
    this._decoder = getDecoder(this._decoder, outputEncoding);
    ret = this._decoder.write(ret);
  }

  return ret;
};

Cipher.prototype["final"] = function _final(outputEncoding) {
  outputEncoding = outputEncoding || exports.DEFAULT_ENCODING;

  var ret = this._handle["final"]();

  if (outputEncoding && outputEncoding !== 'buffer') {
    this._decoder = getDecoder(this._decoder, outputEncoding);
    ret = this._decoder.end(ret);
  }

  return ret;
};

Cipher.prototype.setAutoPadding = function setAutoPadding(ap) {
  this._handle.setAutoPadding(ap);

  return this;
};

Cipher.prototype.getAuthTag = function getAuthTag() {
  return this._handle.getAuthTag();
};

Cipher.prototype.setAuthTag = function setAuthTag(tagbuf) {
  this._handle.setAuthTag(tagbuf);

  return this;
};

Cipher.prototype.setAAD = function setAAD(aadbuf) {
  this._handle.setAAD(aadbuf);

  return this;
};

exports.Cipheriv = Cipheriv;

function Cipheriv(cipher, key, iv, options) {
  if (!(this instanceof Cipheriv)) return new Cipheriv(cipher, key, iv, options);
  this._handle = new binding.CipherBase(true);

  this._handle.initiv(cipher, toBuf(key), toBuf(iv));

  this._decoder = null;
  LazyTransform.call(this, options);
}

util.inherits(Cipheriv, LazyTransform);
Cipheriv.prototype._transform = Cipher.prototype._transform;
Cipheriv.prototype._flush = Cipher.prototype._flush;
Cipheriv.prototype.update = Cipher.prototype.update;
Cipheriv.prototype["final"] = Cipher.prototype["final"];
Cipheriv.prototype.setAutoPadding = Cipher.prototype.setAutoPadding;
Cipheriv.prototype.getAuthTag = Cipher.prototype.getAuthTag;
Cipheriv.prototype.setAuthTag = Cipher.prototype.setAuthTag;
Cipheriv.prototype.setAAD = Cipher.prototype.setAAD;
exports.Decipher = Decipher;

function Decipher(cipher, password, options) {
  if (!(this instanceof Decipher)) return new Decipher(cipher, password, options);
  this._handle = new binding.CipherBase(false);

  this._handle.init(cipher, toBuf(password));

  this._decoder = null;
  LazyTransform.call(this, options);
}

util.inherits(Decipher, LazyTransform);
Decipher.prototype._transform = Cipher.prototype._transform;
Decipher.prototype._flush = Cipher.prototype._flush;
Decipher.prototype.update = Cipher.prototype.update;
Decipher.prototype["final"] = Cipher.prototype["final"];
Decipher.prototype.finaltol = Cipher.prototype["final"];
Decipher.prototype.setAutoPadding = Cipher.prototype.setAutoPadding;
Decipher.prototype.getAuthTag = Cipher.prototype.getAuthTag;
Decipher.prototype.setAuthTag = Cipher.prototype.setAuthTag;
Decipher.prototype.setAAD = Cipher.prototype.setAAD;
exports.Decipheriv = Decipheriv;

function Decipheriv(cipher, key, iv, options) {
  if (!(this instanceof Decipheriv)) return new Decipheriv(cipher, key, iv, options);
  this._handle = new binding.CipherBase(false);

  this._handle.initiv(cipher, toBuf(key), toBuf(iv));

  this._decoder = null;
  LazyTransform.call(this, options);
}

util.inherits(Decipheriv, LazyTransform);
Decipheriv.prototype._transform = Cipher.prototype._transform;
Decipheriv.prototype._flush = Cipher.prototype._flush;
Decipheriv.prototype.update = Cipher.prototype.update;
Decipheriv.prototype["final"] = Cipher.prototype["final"];
Decipheriv.prototype.finaltol = Cipher.prototype["final"];
Decipheriv.prototype.setAutoPadding = Cipher.prototype.setAutoPadding;
Decipheriv.prototype.getAuthTag = Cipher.prototype.getAuthTag;
Decipheriv.prototype.setAuthTag = Cipher.prototype.setAuthTag;
Decipheriv.prototype.setAAD = Cipher.prototype.setAAD;
exports.Sign = Sign;

function Sign(algorithm, options) {
  if (!(this instanceof Sign)) return new Sign(algorithm, options);
  this._handle = new binding.Sign();

  this._handle.init(algorithm);

  stream.Writable.call(this, options);
}

util.inherits(Sign, stream.Writable);

Sign.prototype._write = function _write(chunk, encoding, callback) {
  this._handle.update(chunk, encoding);

  callback();
};

Sign.prototype.update = Hash.prototype.update;

Sign.prototype.sign = function sign(options, encoding) {
  if (!options) throw new Error('No key provided to sign');
  var key = options.key || options;
  var passphrase = options.passphrase || null; // Options specific to RSA

  var rsaPadding = constants.RSA_PKCS1_PADDING;

  if (options.hasOwnProperty('padding')) {
    if (options.padding === options.padding >> 0) {
      rsaPadding = options.padding;
    } else {
      throw new TypeError('padding must be an integer');
    }
  }

  var pssSaltLength = constants.RSA_PSS_SALTLEN_AUTO;

  if (options.hasOwnProperty('saltLength')) {
    if (options.saltLength === options.saltLength >> 0) {
      pssSaltLength = options.saltLength;
    } else {
      throw new TypeError('saltLength must be an integer');
    }
  }

  var ret = this._handle.sign(toBuf(key), passphrase, rsaPadding, pssSaltLength);

  encoding = encoding || exports.DEFAULT_ENCODING;
  if (encoding && encoding !== 'buffer') ret = ret.toString(encoding);
  return ret;
};

exports.Verify = Verify;

function Verify(algorithm, options) {
  if (!(this instanceof Verify)) return new Verify(algorithm, options);
  this._handle = new binding.Verify();

  this._handle.init(algorithm);

  stream.Writable.call(this, options);
}

util.inherits(Verify, stream.Writable);
Verify.prototype._write = Sign.prototype._write;
Verify.prototype.update = Sign.prototype.update;

Verify.prototype.verify = function verify(options, signature, sigEncoding) {
  var key = options.key || options;
  sigEncoding = sigEncoding || exports.DEFAULT_ENCODING; // Options specific to RSA

  var rsaPadding = constants.RSA_PKCS1_PADDING;

  if (options.hasOwnProperty('padding')) {
    if (options.padding === options.padding >> 0) {
      rsaPadding = options.padding;
    } else {
      throw new TypeError('padding must be an integer');
    }
  }

  var pssSaltLength = constants.RSA_PSS_SALTLEN_AUTO;

  if (options.hasOwnProperty('saltLength')) {
    if (options.saltLength === options.saltLength >> 0) {
      pssSaltLength = options.saltLength;
    } else {
      throw new TypeError('saltLength must be an integer');
    }
  }

  return this._handle.verify(toBuf(key), toBuf(signature, sigEncoding), rsaPadding, pssSaltLength);
};

function rsaPublic(method, defaultPadding) {
  return function (options, buffer) {
    var key = options.key || options;
    var padding = options.padding || defaultPadding;
    var passphrase = options.passphrase || null;
    return method(toBuf(key), buffer, padding, passphrase);
  };
}

function rsaPrivate(method, defaultPadding) {
  return function (options, buffer) {
    var key = options.key || options;
    var passphrase = options.passphrase || null;
    var padding = options.padding || defaultPadding;
    return method(toBuf(key), buffer, padding, passphrase);
  };
}

exports.publicEncrypt = rsaPublic(binding.publicEncrypt, constants.RSA_PKCS1_OAEP_PADDING);
exports.publicDecrypt = rsaPublic(binding.publicDecrypt, constants.RSA_PKCS1_PADDING);
exports.privateEncrypt = rsaPrivate(binding.privateEncrypt, constants.RSA_PKCS1_PADDING);
exports.privateDecrypt = rsaPrivate(binding.privateDecrypt, constants.RSA_PKCS1_OAEP_PADDING);
exports.DiffieHellman = DiffieHellman;

function DiffieHellman(sizeOrKey, keyEncoding, generator, genEncoding) {
  if (!(this instanceof DiffieHellman)) return new DiffieHellman(sizeOrKey, keyEncoding, generator, genEncoding);

  if (typeof sizeOrKey !== 'number' && typeof sizeOrKey !== 'string' && !isArrayBufferView(sizeOrKey)) {
    throw new TypeError('First argument should be number, string, ' + 'Buffer, TypedArray, or DataView');
  }

  if (keyEncoding) {
    if (typeof keyEncoding !== 'string' || !Buffer.isEncoding(keyEncoding) && keyEncoding !== 'buffer') {
      genEncoding = generator;
      generator = keyEncoding;
      keyEncoding = false;
    }
  }

  keyEncoding = keyEncoding || exports.DEFAULT_ENCODING;
  genEncoding = genEncoding || exports.DEFAULT_ENCODING;
  if (typeof sizeOrKey !== 'number') sizeOrKey = toBuf(sizeOrKey, keyEncoding);
  if (!generator) generator = DH_GENERATOR;else if (typeof generator !== 'number') generator = toBuf(generator, genEncoding);
  this._handle = new binding.DiffieHellman(sizeOrKey, generator);
  Object.defineProperty(this, 'verifyError', {
    enumerable: true,
    value: this._handle.verifyError,
    writable: false
  });
}

exports.DiffieHellmanGroup = DiffieHellmanGroup;

function DiffieHellmanGroup(name) {
  if (!(this instanceof DiffieHellmanGroup)) return new DiffieHellmanGroup(name);
  this._handle = new binding.DiffieHellmanGroup(name);
  Object.defineProperty(this, 'verifyError', {
    enumerable: true,
    value: this._handle.verifyError,
    writable: false
  });
}

DiffieHellmanGroup.prototype.generateKeys = DiffieHellman.prototype.generateKeys = dhGenerateKeys;

function dhGenerateKeys(encoding) {
  var keys = this._handle.generateKeys();

  encoding = encoding || exports.DEFAULT_ENCODING;
  if (encoding && encoding !== 'buffer') keys = keys.toString(encoding);
  return keys;
}

DiffieHellmanGroup.prototype.computeSecret = DiffieHellman.prototype.computeSecret = dhComputeSecret;

function dhComputeSecret(key, inEnc, outEnc) {
  inEnc = inEnc || exports.DEFAULT_ENCODING;
  outEnc = outEnc || exports.DEFAULT_ENCODING;

  var ret = this._handle.computeSecret(toBuf(key, inEnc));

  if (outEnc && outEnc !== 'buffer') ret = ret.toString(outEnc);
  return ret;
}

DiffieHellmanGroup.prototype.getPrime = DiffieHellman.prototype.getPrime = dhGetPrime;

function dhGetPrime(encoding) {
  var prime = this._handle.getPrime();

  encoding = encoding || exports.DEFAULT_ENCODING;
  if (encoding && encoding !== 'buffer') prime = prime.toString(encoding);
  return prime;
}

DiffieHellmanGroup.prototype.getGenerator = DiffieHellman.prototype.getGenerator = dhGetGenerator;

function dhGetGenerator(encoding) {
  var generator = this._handle.getGenerator();

  encoding = encoding || exports.DEFAULT_ENCODING;
  if (encoding && encoding !== 'buffer') generator = generator.toString(encoding);
  return generator;
}

DiffieHellmanGroup.prototype.getPublicKey = DiffieHellman.prototype.getPublicKey = dhGetPublicKey;

function dhGetPublicKey(encoding) {
  var key = this._handle.getPublicKey();

  encoding = encoding || exports.DEFAULT_ENCODING;
  if (encoding && encoding !== 'buffer') key = key.toString(encoding);
  return key;
}

DiffieHellmanGroup.prototype.getPrivateKey = DiffieHellman.prototype.getPrivateKey = dhGetPrivateKey;

function dhGetPrivateKey(encoding) {
  var key = this._handle.getPrivateKey();

  encoding = encoding || exports.DEFAULT_ENCODING;
  if (encoding && encoding !== 'buffer') key = key.toString(encoding);
  return key;
}

DiffieHellman.prototype.setPublicKey = function setPublicKey(key, encoding) {
  encoding = encoding || exports.DEFAULT_ENCODING;

  this._handle.setPublicKey(toBuf(key, encoding));

  return this;
};

DiffieHellman.prototype.setPrivateKey = function setPrivateKey(key, encoding) {
  encoding = encoding || exports.DEFAULT_ENCODING;

  this._handle.setPrivateKey(toBuf(key, encoding));

  return this;
};

exports.ECDH = ECDH;

function ECDH(curve) {
  if (!(this instanceof ECDH)) return new ECDH(curve);
  if (typeof curve !== 'string') throw new TypeError('"curve" argument should be a string');
  this._handle = new binding.ECDH(curve);
}

ECDH.prototype.computeSecret = DiffieHellman.prototype.computeSecret;
ECDH.prototype.setPrivateKey = DiffieHellman.prototype.setPrivateKey;
ECDH.prototype.setPublicKey = DiffieHellman.prototype.setPublicKey;
ECDH.prototype.getPrivateKey = DiffieHellman.prototype.getPrivateKey;

ECDH.prototype.generateKeys = function generateKeys(encoding, format) {
  this._handle.generateKeys();

  return this.getPublicKey(encoding, format);
};

ECDH.prototype.getPublicKey = function getPublicKey(encoding, format) {
  var f;

  if (format) {
    if (typeof format === 'number') f = format;
    if (format === 'compressed') f = constants.POINT_CONVERSION_COMPRESSED;else if (format === 'hybrid') f = constants.POINT_CONVERSION_HYBRID; // Default
    else if (format === 'uncompressed') f = constants.POINT_CONVERSION_UNCOMPRESSED;else throw new TypeError('Bad format: ' + format);
  } else {
    f = constants.POINT_CONVERSION_UNCOMPRESSED;
  }

  var key = this._handle.getPublicKey(f);

  encoding = encoding || exports.DEFAULT_ENCODING;
  if (encoding && encoding !== 'buffer') key = key.toString(encoding);
  return key;
}; // These helper functions are needed because the constructors can
// use new, in which case V8 cannot inline the recursive constructor call


function createHash(algorithm, options) {
  return new Hash(algorithm, options);
}

function createCipher(cipher, password, options) {
  return new Cipher(cipher, password, options);
}

function createCipheriv(cipher, key, iv, options) {
  return new Cipheriv(cipher, key, iv, options);
}

function createDecipher(cipher, password, options) {
  return new Decipher(cipher, password, options);
}

function createDecipheriv(cipher, key, iv, options) {
  return new Decipheriv(cipher, key, iv, options);
}

function createDiffieHellman(sizeOrKey, keyEncoding, generator, genEncoding) {
  return new DiffieHellman(sizeOrKey, keyEncoding, generator, genEncoding);
}

function createDiffieHellmanGroup(name) {
  return new DiffieHellmanGroup(name);
}

function createECDH(curve) {
  return new ECDH(curve);
}

function createHmac(hmac, key, options) {
  return new Hmac(hmac, key, options);
}

function createSign(algorithm, options) {
  return new Sign(algorithm, options);
}

function createVerify(algorithm, options) {
  return new Verify(algorithm, options);
}

exports.createHash = createHash;
exports.createCipher = createCipher;
exports.createCipheriv = createCipheriv;
exports.createDecipher = createDecipher;
exports.createDecipheriv = createDecipheriv;
exports.createDiffieHellman = createDiffieHellman;
exports.createDiffieHellmanGroup = exports.getDiffieHellman = createDiffieHellmanGroup;
exports.createECDH = createECDH;
exports.createHmac = createHmac;
exports.createSign = createSign;
exports.createVerify = createVerify;

exports.pbkdf2 = function (password, salt, iterations, keylen, digest, callback) {
  if (typeof digest === 'function') {
    callback = digest;
    digest = undefined;
  }

  if (typeof callback !== 'function') throw new Error('No callback provided to pbkdf2');
  return pbkdf2(password, salt, iterations, keylen, digest, callback);
};

exports.pbkdf2Sync = function (password, salt, iterations, keylen, digest) {
  return pbkdf2(password, salt, iterations, keylen, digest);
};

function pbkdf2(password, salt, iterations, keylen, digest, callback) {
  if (digest === undefined) {
    throw new TypeError('The "digest" argument is required and must not be undefined');
  }

  password = toBuf(password);
  salt = toBuf(salt);
  if (exports.DEFAULT_ENCODING === 'buffer') return binding.PBKDF2(password, salt, iterations, keylen, digest, callback); // at this point, we need to handle encodings.

  var encoding = exports.DEFAULT_ENCODING;

  if (callback) {
    var next = function next(er, ret) {
      if (ret) ret = ret.toString(encoding);
      callback(er, ret);
    };

    binding.PBKDF2(password, salt, iterations, keylen, digest, next);
  } else {
    var ret = binding.PBKDF2(password, salt, iterations, keylen, digest);
    return ret.toString(encoding);
  }
}

exports.Certificate = Certificate;

function Certificate() {
  if (!(this instanceof Certificate)) return new Certificate();
}

Certificate.prototype.verifySpkac = function verifySpkac(object) {
  return binding.certVerifySpkac(object);
};

Certificate.prototype.exportPublicKey = function exportPublicKey(object, encoding) {
  return binding.certExportPublicKey(toBuf(object, encoding));
};

Certificate.prototype.exportChallenge = function exportChallenge(object, encoding) {
  return binding.certExportChallenge(toBuf(object, encoding));
};

exports.setEngine = function setEngine(id, flags) {
  if (typeof id !== 'string') throw new TypeError('"id" argument should be a string');
  if (flags && typeof flags !== 'number') throw new TypeError('"flags" argument should be a number, if present');
  flags = flags >>> 0; // Use provided engine for everything by default

  if (flags === 0) flags = constants.ENGINE_METHOD_ALL;
  return binding.setEngine(id, flags);
};

var kMaxUint32 = Math.pow(2, 32) - 1;

function randomFillSync(buf) {
  var offset = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
  var size = arguments.length > 2 ? arguments[2] : undefined;

  if (!isUint8Array(buf)) {
    throw new TypeError('"buf" argument must be a Buffer or Uint8Array');
  }

  assertOffset(offset, buf.length);
  if (size === undefined) size = buf.length - offset;
  assertSize(size, offset, buf.length);
  return binding.randomFill(buf, offset, size);
}

exports.randomFillSync = randomFillSync;

function randomFill(buf, offset, size, cb) {
  if (!isUint8Array(buf)) {
    throw new TypeError('"buf" argument must be a Buffer or Uint8Array');
  }

  if (typeof offset === 'function') {
    cb = offset;
    offset = 0;
    size = buf.length;
  } else if (typeof size === 'function') {
    cb = size;
    size = buf.length - offset;
  } else if (typeof cb !== 'function') {
    throw new TypeError('"cb" argument must be a function');
  }

  assertOffset(offset, buf.length);
  assertSize(size, offset, buf.length);
  return binding.randomFill(buf, offset, size, cb);
}

exports.randomFill = randomFill;

function assertOffset(offset, length) {
  if (typeof offset !== 'number' || offset !== offset) {
    throw new TypeError('offset must be a number');
  }

  if (offset > kMaxUint32 || offset < 0) {
    throw new TypeError('offset must be a uint32');
  }

  if (offset > kBufferMaxLength || offset > length) {
    throw new RangeError('offset out of range');
  }
}

function assertSize(size, offset, length) {
  if (typeof size !== 'number' || size !== size) {
    throw new TypeError('size must be a number');
  }

  if (size > kMaxUint32 || size < 0) {
    throw new TypeError('size must be a uint32');
  }

  if (size + offset > length || size > kBufferMaxLength) {
    throw new RangeError('buffer too small');
  }
}

exports.randomBytes = exports.pseudoRandomBytes = randomBytes;
exports.rng = exports.prng = randomBytes;
exports.getCiphers = internalUtil.cachedResult(function () {
  return internalUtil.filterDuplicateStrings(getCiphers());
});
exports.getHashes = internalUtil.cachedResult(function () {
  return internalUtil.filterDuplicateStrings(getHashes());
});
exports.getCurves = internalUtil.cachedResult(function () {
  return internalUtil.filterDuplicateStrings(getCurves());
});
Object.defineProperty(exports, 'fips', {
  get: getFipsCrypto,
  set: setFipsCrypto
});
exports.timingSafeEqual = timingSafeEqual; // Legacy API

Object.defineProperty(exports, 'createCredentials', {
  configurable: true,
  enumerable: true,
  get: internalUtil.deprecate(function () {
    return require('tls').createSecureContext;
  }, 'crypto.createCredentials is deprecated. ' + 'Use tls.createSecureContext instead.', 'DEP0010')
});
Object.defineProperty(exports, 'Credentials', {
  configurable: true,
  enumerable: true,
  get: internalUtil.deprecate(function () {
    return require('tls').SecureContext;
  }, 'crypto.Credentials is deprecated. ' + 'Use tls.SecureContext instead.', 'DEP0011')
});