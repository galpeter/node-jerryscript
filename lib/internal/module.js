'use strict'; // Invoke with makeRequireFunction(module) where |module| is the Module object
// to use as the context for the require() function.

function makeRequireFunction(mod) {
  var Module = mod.constructor;

  function require(path) {
    try {
      exports.requireDepth += 1;
      return mod.require(path);
    } finally {
      exports.requireDepth -= 1;
    }
  }

  function resolve(request, options) {
    return Module._resolveFilename(request, mod, false, options);
  }

  require.resolve = resolve;

  function paths(request) {
    return Module._resolveLookupPaths(request, mod, true);
  }

  resolve.paths = paths;
  require.main = process.mainModule; // Enable support to add extra extension types.

  require.extensions = Module._extensions;
  require.cache = Module._cache;
  return require;
}
/**
 * Remove byte order marker. This catches EF BB BF (the UTF-8 BOM)
 * because the buffer-to-string conversion in `fs.readFileSync()`
 * translates it to FEFF, the UTF-16 BOM.
 */


function stripBOM(content) {
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }

  return content;
}
/**
 * Find end of shebang line and slice it off
 */


function stripShebang(content) {
  // Remove shebang
  var contLen = content.length;

  if (contLen >= 2) {
    if (content.charCodeAt(0) === 35
    /*#*/
    && content.charCodeAt(1) === 33
    /*!*/
    ) {
        if (contLen === 2) {
          // Exact match
          content = '';
        } else {
          // Find end of shebang line and slice it off
          var i = 2;

          for (; i < contLen; ++i) {
            var code = content.charCodeAt(i);
            if (code === 10
            /*\n*/
            || code === 13
            /*\r*/
            ) break;
          }

          if (i === contLen) content = '';else {
            // Note that this actually includes the newline character(s) in the
            // new output. This duplicates the behavior of the regular expression
            // that was previously used to replace the shebang line
            content = content.slice(i);
          }
        }
      }
  }

  return content;
}

var builtinLibs = ['assert', 'async_hooks', 'buffer', 'child_process',
/*'cluster',*/
'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http',
/*'https',*/
'net', 'os', 'path',
/*'perf_hooks',*/
'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder',
/*'tls',*/
'tty', 'url', 'util',
/*'v8',*/
'vm', 'zlib'];

var _process$binding = process.binding('config'),
    exposeHTTP2 = _process$binding.exposeHTTP2;

if (exposeHTTP2) builtinLibs.push('http2');

/* TODO: remove the comment "guard"
try {
  if (typeof process.binding('inspector').connect === 'function') {
    builtinLibs.push('inspector');
    builtinLibs.sort();
  }
} catch (e) {}
*/

function addBuiltinLibsToObject(object) {
  // Make built-in modules available directly (loaded lazily).
  builtinLibs.forEach(function (name) {
    // Goals of this mechanism are:
    // - Lazy loading of built-in modules
    // - Having all built-in modules available as non-enumerable properties
    // - Allowing the user to re-assign these variables as if there were no
    //   pre-existing globals with the same name.
    var setReal = function setReal(val) {
      // Deleting the property before re-assigning it disables the
      // getter/setter mechanism.
      delete object[name];
      object[name] = val;
    };

    Object.defineProperty(object, name, {
      get: function get() {
        var lib = require(name); // Disable the current getter/setter and set up a new
        // non-enumerable property.


        delete object[name];
        Object.defineProperty(object, name, {
          get: function get() {
            return lib;
          },
          set: setReal,
          configurable: true,
          enumerable: false
        });
        return lib;
      },
      set: setReal,
      configurable: true,
      enumerable: false
    });
  });
}

module.exports = exports = {
  addBuiltinLibsToObject: addBuiltinLibsToObject,
  builtinLibs: builtinLibs,
  makeRequireFunction: makeRequireFunction,
  requireDepth: 0,
  stripBOM: stripBOM,
  stripShebang: stripShebang
};