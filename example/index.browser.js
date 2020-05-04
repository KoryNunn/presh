(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
var presh = require('../'),
    debounce = require('debounce'),
    crel = require('crel');

var defaultScope = "{ a: 10, b: 20, foo: function(input){ return input + ' World'}}"
var defaultCode = `bar(x){
    x > a && x < b ? foo(x) : foo('Hello');
}

[bar(13) bar(8)]`

var scopeInput, codeInput, output, ui = crel('div',
        crel('h2', 'Scope:'),
        scopeInput = crel('pre', {'contenteditable': true}, defaultScope),
        crel('h2', 'Input:'),
        codeInput = crel('pre', {'contenteditable': true}, defaultCode),
        crel('h2', 'Output:'),
        output = crel('div')
    );

var update = debounce(function(){

    var scope = {};

     try{
        scope = scopeInput.textContent ? eval('(' + scopeInput.textContent + ')') : scope;
        scopeInput.removeAttribute('error');
    }catch(error){
        scopeInput.setAttribute('error', error);
    }

    try{
        var result = presh(codeInput.textContent, scope);

        output.textContent = result.error || JSON.stringify(result.value, null, 4);
        codeInput.removeAttribute('error');
    }catch(error){
        codeInput.setAttribute('error', error);
    }
});
update();

scopeInput.addEventListener('keyup', update);
codeInput.addEventListener('keyup', update);

function tab(event){
    if(event.which === 9){
        event.preventDefault();

        var selection = document.getSelection(),
            range = selection.getRangeAt(0),
            tabNode = document.createTextNode('    ');

        range.insertNode(tabNode);
        range.setStartAfter(tabNode);
        range.setEndAfter(tabNode);
        selection.removeAllRanges();
        selection.addRange(range);
    }
}

scopeInput.addEventListener('keydown', tab);
codeInput.addEventListener('keydown', tab);

window.onload = function(){
    crel(document.body, ui);
};
},{"../":4,"crel":6,"debounce":7}],2:[function(require,module,exports){
var Scope = require('./scope'),
    toValue = require('./toValue'),
    isInstance = require('is-instance'),
    preshFunctions = new WeakMap();

var reservedKeywords = {
    'true': true,
    'false': false,
    'null': null,
    'undefined': undefined
};

function resolveSpreads(content, scope){
    var result = [];

    content.forEach(function(token){

        if(token.name === 'spread'){
            result.push.apply(result, executeToken(token, scope).value);
            return;
        }

        result.push(executeToken(token, scope).value);
    });

    return result;
}

function functionCall(token, scope){
    var functionToken = executeToken(token.target, scope),
        fn = functionToken.value;

    if(typeof fn !== 'function'){
        scope.throw(fn + ' is not a function');
    }

    if(scope.hasError()){
        return;
    }

    if(preshFunctions.has(fn)){
        var result = preshFunctions.get(fn).apply(functionToken.context, resolveSpreads(token.content, scope));

        if(result.error){
            scope.throw(result.error)
        }

        return result.value;
    }

    try{
        return fn.apply(functionToken.context, resolveSpreads(token.content, scope));
    }catch(error){
        scope.throw(error);
    }
}

function functionExpression(token, scope){
    var fn = function(){
        var args = arguments,
            functionScope = new Scope(scope);

        token.parameters.forEach(function(parameter, index){

            if(parameter.name === 'spread'){
                functionScope.set(parameter.right.name, Array.prototype.slice.call(args, index));
                return;
            }

            functionScope.set(parameter.name, args[index]);
        });

        return execute(token.content, functionScope);
    };

    if(token.identifier){
        scope.set(token.identifier.name, fn);
    }

    var resultFn = function(){
        return fn.apply(this, arguments).value;
    }

    preshFunctions.set(resultFn, fn);

    return resultFn;
}

function assignment(token, scope){
    if(scope.isDefined(token.left.name)){
        scope.throw('Cannot reassign already defined identifier: ' + token.left.name);
    }

    var value = executeToken(token.right, scope).value;

    scope.set(token.left.name, value);

    return value;
}

function ternary(token, scope){

    if(scope._debug){
        console.log('Executing operator: ' + token.name, token.left, token.right);
    }

    return executeToken(token.left, scope).value ?
        executeToken(token.middle, scope).value :
        executeToken(token.right, scope).value;
}

function identifier(token, scope){
    var name = token.name;
    if(name in reservedKeywords){
        return reservedKeywords[name];
    }
    if(!scope.isDefined(name)){
        scope.throw(name + ' is not defined');
    }
    return scope.get(name);
}

function number(token){
    return token.value;
}

function string(token){
    return token.value;
}

function getProperty(token, scope, target, accessor){

    if(!target || !(typeof target === 'object' || typeof target === 'function')){
        scope.throw('target is not an object');
        return;
    }


    var result = Object.hasOwnProperty.call(target, accessor) ? target[accessor] : undefined;

    if(typeof result === 'function'){
        result = toValue(result, scope, target);
    }

    return result;
}

function period(token, scope){
    var target = executeToken(token.left, scope).value;

    return getProperty(token, scope, target, token.right.name);
}

function accessor(token, scope){
    var accessorValue = execute(token.content, scope).value,
        target = executeToken(token.target, scope).value;

    return getProperty(token, scope, target, accessorValue);
}

function spread(token, scope){
    var target = executeToken(token.right, scope).value;

    if(!Array.isArray(target)){
        scope.throw('target did not resolve to an array');
    }

    return target;
}

function set(token, scope){
    if(token.content.length === 1 && token.content[0].name === 'range'){
        var range = token.content[0],
            start = executeToken(range.left, scope).value,
            end = executeToken(range.right, scope).value,
            reverse = end < start,
            result = [];

        if(Math.abs(start) === Infinity || Math.abs(end) === Infinity){
            scope.throw('Range values can not be infinite');
            return;
        }

        for (var i = start; reverse ? i >= end : i <= end; reverse ? i-- : i++) {
            result.push(i);
        }

        return result;
    }

    return resolveSpreads(token.content, scope);
}

function value(token){
    return token.value;
}

function object(token, scope){
    var result = {};

    var content = token.content;

    for(var i = 0; i < content.length; i ++) {
        var child = content[i],
            key,
            value;

        if(child.name === 'tuple'){
            if(child.left.type === 'identifier'){
                key = child.left.name;
            }else if(child.left.type === 'set' && child.left.content.length === 1){
                key = executeToken(child.left.content[0], scope).value;
            }else{
                scope.throw('Unexpected token in object constructor: ' + child.type);
                return;
            }

            value = executeToken(child.right, scope).value;
        }else if(child.type === 'identifier'){
            key = child.name;
            value = executeToken(child, scope).value;
        }else if(child.name === 'spread'){
            var source = executeToken(child.right, scope).value;

            if(!isInstance(source)){
                scope.throw('Target did not resolve to an instance of an object');
                return;
            }

            Object.assign(result, source);
            continue;
        }else if(child.name === 'delete'){
            var targetIdentifier = child.right;

            if(targetIdentifier.type !== 'identifier'){
                scope.throw('Target of delete was not an identifier');
                return;
            }

            delete result[targetIdentifier.name];

            continue;
        }else{
            scope.throw('Unexpected token in object constructor: ' + child.type);
            return;
        }

        result[key] = value;
    }

    return result;
}

var handlers = {
    assignment: assignment,
    ternary: ternary,
    functionCall: functionCall,
    functionExpression: functionExpression,
    number: number,
    string: string,
    identifier: identifier,
    set: set,
    period: period,
    spread: spread,
    accessor: accessor,
    value: value,
    operator: operator,
    parenthesisGroup: contentHolder,
    statement: contentHolder,
    braceGroup: object
};

function nextOperatorToken(token, scope){
    return function(){
        return executeToken(token, scope).value;
    };
}

function operator(token, scope){
    if(token.name in handlers){
        return toValue(handlers[token.name](token, scope), scope);
    }

    if(token.left){
        if(scope._debug){
            console.log('Executing token: ' + token.name, token.left, token.right);
        }
        return token.operator.fn(nextOperatorToken(token.left, scope), nextOperatorToken(token.right, scope));
    }

    if(scope._debug){
        console.log('Executing operator: ' + token.name. token.right);
    }

    return token.operator.fn(nextOperatorToken(token.right, scope));
}

function contentHolder(parenthesisGroup, scope){
    return execute(parenthesisGroup.content, scope).value;
}

function executeToken(token, scope){
    if(scope._error){
        return {error: scope._error};
    }
    return toValue(handlers[token.type](token, scope), scope);
}

function execute(tokens, scope, debug){
    scope = scope instanceof Scope ? scope : new Scope(scope, debug);

    var result;
    for (var i = 0; i < tokens.length; i++) {

        result = executeToken(tokens[i], scope);

        if(result.error){
            return result;
        }
    }

    if(!result){
        return {
            error: new Error('Unknown execution error')
        };
    }

    return result;
}

module.exports = execute;
},{"./scope":14,"./toValue":15,"is-instance":9}],3:[function(require,module,exports){
module.exports = {
    log: function(x){
        console.log.apply(console, arguments);
        return x;
    },
    slice: function(items, start, end){
        return items.slice(start, end);
    },
    find: function(items, fn){
        return items.find(fn);
    },
    indexOf: function(items, value){
        return items.indexOf(value);
    },
    map: function(items, fn){
        return items.map(fn);
    },
    fold: function(items, seed, fn){
        if(arguments.length === 2){
            return items.reduce(seed);
        }
        return items.reduce(fn, seed);
    },
    String: String,
    Number: Number,
    math: Math
};
},{}],4:[function(require,module,exports){
var lex = require('./lex'),
    parse = require('./parse'),
    execute = require('./execute'),
    global = require('./global'),
    merge = require('flat-merge');

module.exports = function(expression, scope, callback, debug){
    var lexed = lex(expression);
    var parsed = parse(lexed);

    return execute(parsed, merge(
        global,
        scope
    ), callback, debug);
};
},{"./execute":2,"./global":3,"./lex":5,"./parse":13,"flat-merge":8}],5:[function(require,module,exports){
var operators = require('./operators');

function lexString(source){
    var stringMatch = source.match(/^((["'])(?:[^\\]|\\.)*?\2)/);

    if(stringMatch){
        return {
            type: 'string',
            stringChar: stringMatch[1].charAt(0),
            source: stringMatch[1],//.replace(/\\(['"])/g, "$1"),
            length: stringMatch[1].length
        };
    }
}

function lexWord(source){
    var match = source.match(/^(?!\-)[\w-$]+/);

    if(!match){
        return;
    }

    if(match in operators){
        return;
    }

    return {
        type: 'word',
        source: match[0],
        length: match[0].length
    };
}

function lexNumber(source){
    var specials = {
        'NaN': Number.NaN,
        'Infinity': Infinity
    };

    var token = {
        type: 'number'
    };

    for (var key in specials) {
        if (source.slice(0, key.length) === key) {
            token.source = key;
            token.length = token.source.length;

            return token;
        }
    }

    var matchExponent = source.match(/^[0-9]+(?:\.[0-9]+)?[eE]-?[0-9]+/);

    if(matchExponent){
        token.source = matchExponent[0];
        token.length = token.source.length;

        return token;
    }

    var matchHex = source.match(/^0[xX][0-9]+/);

    if(matchHex){
        token.source = matchHex[0];
        token.length = token.source.length;

        return token;
    }

    var matchHeadlessDecimal = source.match(/^\.[0-9]+/);

    if(matchHeadlessDecimal){
        token.source = matchHeadlessDecimal[0];
        token.length = token.source.length;

        return token;
    }

    var matchNormalDecimal = source.match(/^[0-9]+(?:\.[0-9]+)?/);

    if(matchNormalDecimal){
        token.source = matchNormalDecimal[0];
        token.length = token.source.length;

        return token;
    }
}

function lexComment(source){
    var match = source.match(/^(\/\*[^]*?\*\/)/);

    if(!match){
        return;
    }

    return {
        type: 'comment',
        source: match[0],
        length: match[0].length
    };
}

var characters = {
    ',': 'comma',
    '.': 'period',
    ';': 'semicolon',
    '{': 'braceOpen',
    '}': 'braceClose',
    '(': 'parenthesisOpen',
    ')': 'parenthesisClose',
    '[': 'squareBraceOpen',
    ']': 'squareBraceClose'
};

function lexCharacters(source){
    var name,
        key;

    for(key in characters){
        if(source.indexOf(key) === 0){
            name = characters[key];
            break;
        }
    }

    if(!name){
        return;
    }

    return {
        type: name,
        source: key,
        length: 1
    };
}

function lexOperators(source){
    var operator,
        key;

    for(key in operators){
        if(source.indexOf(key) === 0){
            operator = operators[key];
            break;
        }
    }

    if(!operator){
        return;
    }

    return {
        type: 'operator',
        source: key,
        length: key.length
    };
}

function lexSpread(source){
    var match = source.match(/^\.\.\./);

    if(!match){
        return;
    }

    return {
        type: 'spread',
        source: match[0],
        length: match[0].length
    };
}

function lexDelimiter(source){
    var match = source.match(/^[\s\n]+/);

    if(!match){
        return;
    }

    return {
        type: 'delimiter',
        source: match[0],
        length: match[0].length
    };
}

var lexers = [
    lexDelimiter,
    lexComment,
    lexNumber,
    lexWord,
    lexOperators,
    lexCharacters,
    lexString,
    lexSpread
];

function scanForToken(tokenisers, expression){
    for (var i = 0; i < tokenisers.length; i++) {
        var token = tokenisers[i](expression);
        if (token) {
            return token;
        }
    }
}

function lex(source, memoisedTokens) {
    var sourceRef = {
        source: source,
        toJSON: function(){}
    };

    if(!source){
        return [];
    }

    if(memoisedTokens && memoisedTokens[source]){
        return memoisedTokens[source].slice();
    }

    var originalSource = source,
        tokens = [],
        totalCharsProcessed = 0,
        previousLength;

    do {
        previousLength = source.length;

        var token;

        token = scanForToken(lexers, source);

        if(token){
            token.sourceRef = sourceRef;
            token.index = totalCharsProcessed;
            source = source.slice(token.length);
            totalCharsProcessed += token.length;
            tokens.push(token);
            continue;
        }


        if(source.length === previousLength){
            throw 'Syntax error: Unable to determine next token in source: ' + source.slice(0, 100);
        }

    } while (source);

    if(memoisedTokens){
        memoisedTokens[originalSource] = tokens.slice();
    }

    return tokens;
}

module.exports = lex;
},{"./operators":12}],6:[function(require,module,exports){
//Copyright (C) 2012 Kory Nunn

//Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

//The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

//THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

/*

    This code is not formatted for readability, but rather run-speed and to assist compilers.

    However, the code's intention should be transparent.

    *** IE SUPPORT ***

    If you require this library to work in IE7, add the following after declaring crel.

    var testDiv = document.createElement('div'),
        testLabel = document.createElement('label');

    testDiv.setAttribute('class', 'a');
    testDiv['className'] !== 'a' ? crel.attrMap['class'] = 'className':undefined;
    testDiv.setAttribute('name','a');
    testDiv['name'] !== 'a' ? crel.attrMap['name'] = function(element, value){
        element.id = value;
    }:undefined;


    testLabel.setAttribute('for', 'a');
    testLabel['htmlFor'] !== 'a' ? crel.attrMap['for'] = 'htmlFor':undefined;



*/

(function (root, factory) {
    if (typeof exports === 'object') {
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        define(factory);
    } else {
        root.crel = factory();
    }
}(this, function () {
    var fn = 'function',
        obj = 'object',
        nodeType = 'nodeType',
        textContent = 'textContent',
        setAttribute = 'setAttribute',
        attrMapString = 'attrMap',
        isNodeString = 'isNode',
        isElementString = 'isElement',
        d = typeof document === obj ? document : {},
        isType = function(a, type){
            return typeof a === type;
        },
        isNode = typeof Node === fn ? function (object) {
            return object instanceof Node;
        } :
        // in IE <= 8 Node is an object, obviously..
        function(object){
            return object &&
                isType(object, obj) &&
                (nodeType in object) &&
                isType(object.ownerDocument,obj);
        },
        isElement = function (object) {
            return crel[isNodeString](object) && object[nodeType] === 1;
        },
        isArray = function(a){
            return a instanceof Array;
        },
        appendChild = function(element, child) {
            if (isArray(child)) {
                child.map(function(subChild){
                    appendChild(element, subChild);
                });
                return;
            }
            if(!crel[isNodeString](child)){
                child = d.createTextNode(child);
            }
            element.appendChild(child);
        };


    function crel(){
        var args = arguments, //Note: assigned to a variable to assist compilers. Saves about 40 bytes in closure compiler. Has negligable effect on performance.
            element = args[0],
            child,
            settings = args[1],
            childIndex = 2,
            argumentsLength = args.length,
            attributeMap = crel[attrMapString];

        element = crel[isElementString](element) ? element : d.createElement(element);
        // shortcut
        if(argumentsLength === 1){
            return element;
        }

        if(!isType(settings,obj) || crel[isNodeString](settings) || isArray(settings)) {
            --childIndex;
            settings = null;
        }

        // shortcut if there is only one child that is a string
        if((argumentsLength - childIndex) === 1 && isType(args[childIndex], 'string') && element[textContent] !== undefined){
            element[textContent] = args[childIndex];
        }else{
            for(; childIndex < argumentsLength; ++childIndex){
                child = args[childIndex];

                if(child == null){
                    continue;
                }

                if (isArray(child)) {
                  for (var i=0; i < child.length; ++i) {
                    appendChild(element, child[i]);
                  }
                } else {
                  appendChild(element, child);
                }
            }
        }

        for(var key in settings){
            if(!attributeMap[key]){
                if(isType(settings[key],fn)){
                    element[key] = settings[key];
                }else{
                    element[setAttribute](key, settings[key]);
                }
            }else{
                var attr = attributeMap[key];
                if(typeof attr === fn){
                    attr(element, settings[key]);
                }else{
                    element[setAttribute](attr, settings[key]);
                }
            }
        }

        return element;
    }

    // Used for mapping one kind of attribute to the supported version of that in bad browsers.
    crel[attrMapString] = {};

    crel[isElementString] = isElement;

    crel[isNodeString] = isNode;

    if(typeof Proxy !== 'undefined'){
        crel.proxy = new Proxy(crel, {
            get: function(target, key){
                !(key in crel) && (crel[key] = crel.bind(null, key));
                return crel[key];
            }
        });
    }

    return crel;
}));

},{}],7:[function(require,module,exports){
/**
 * Returns a function, that, as long as it continues to be invoked, will not
 * be triggered. The function will be called after it stops being called for
 * N milliseconds. If `immediate` is passed, trigger the function on the
 * leading edge, instead of the trailing. The function also has a property 'clear' 
 * that is a function which will clear the timer to prevent previously scheduled executions. 
 *
 * @source underscore.js
 * @see http://unscriptable.com/2009/03/20/debouncing-javascript-methods/
 * @param {Function} function to wrap
 * @param {Number} timeout in ms (`100`)
 * @param {Boolean} whether to execute at the beginning (`false`)
 * @api public
 */
function debounce(func, wait, immediate){
  var timeout, args, context, timestamp, result;
  if (null == wait) wait = 100;

  function later() {
    var last = Date.now() - timestamp;

    if (last < wait && last >= 0) {
      timeout = setTimeout(later, wait - last);
    } else {
      timeout = null;
      if (!immediate) {
        result = func.apply(context, args);
        context = args = null;
      }
    }
  };

  var debounced = function(){
    context = this;
    args = arguments;
    timestamp = Date.now();
    var callNow = immediate && !timeout;
    if (!timeout) timeout = setTimeout(later, wait);
    if (callNow) {
      result = func.apply(context, args);
      context = args = null;
    }

    return result;
  };

  debounced.clear = function() {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };
  
  debounced.flush = function() {
    if (timeout) {
      result = func.apply(context, args);
      context = args = null;
      
      clearTimeout(timeout);
      timeout = null;
    }
  };

  return debounced;
};

// Adds compatibility for ES modules
debounce.debounce = debounce;

module.exports = debounce;

},{}],8:[function(require,module,exports){
function flatMerge(a,b){
    if(!b || typeof b !== 'object'){
        b = {};
    }

    if(!a || typeof a !== 'object'){
        a = new b.constructor();
    }

    var result = new a.constructor(),
        aKeys = Object.keys(a),
        bKeys = Object.keys(b);

    for(var i = 0; i < aKeys.length; i++){
        result[aKeys[i]] = a[aKeys[i]];
    }

    for(var i = 0; i < bKeys.length; i++){
        result[bKeys[i]] = b[bKeys[i]];
    }

    return result;
}

module.exports = flatMerge;
},{}],9:[function(require,module,exports){
module.exports = function(value){
    return value && typeof value === 'object' || typeof value === 'function';
};
},{}],10:[function(require,module,exports){
//! stable.js 0.1.8, https://github.com/Two-Screen/stable
//! © 2018 Angry Bytes and contributors. MIT licensed.

(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  (global.stable = factory());
}(this, (function () { 'use strict';

  // A stable array sort, because `Array#sort()` is not guaranteed stable.
  // This is an implementation of merge sort, without recursion.

  var stable = function (arr, comp) {
    return exec(arr.slice(), comp)
  };

  stable.inplace = function (arr, comp) {
    var result = exec(arr, comp);

    // This simply copies back if the result isn't in the original array,
    // which happens on an odd number of passes.
    if (result !== arr) {
      pass(result, null, arr.length, arr);
    }

    return arr
  };

  // Execute the sort using the input array and a second buffer as work space.
  // Returns one of those two, containing the final result.
  function exec(arr, comp) {
    if (typeof(comp) !== 'function') {
      comp = function (a, b) {
        return String(a).localeCompare(b)
      };
    }

    // Short-circuit when there's nothing to sort.
    var len = arr.length;
    if (len <= 1) {
      return arr
    }

    // Rather than dividing input, simply iterate chunks of 1, 2, 4, 8, etc.
    // Chunks are the size of the left or right hand in merge sort.
    // Stop when the left-hand covers all of the array.
    var buffer = new Array(len);
    for (var chk = 1; chk < len; chk *= 2) {
      pass(arr, comp, chk, buffer);

      var tmp = arr;
      arr = buffer;
      buffer = tmp;
    }

    return arr
  }

  // Run a single pass with the given chunk size.
  var pass = function (arr, comp, chk, result) {
    var len = arr.length;
    var i = 0;
    // Step size / double chunk size.
    var dbl = chk * 2;
    // Bounds of the left and right chunks.
    var l, r, e;
    // Iterators over the left and right chunk.
    var li, ri;

    // Iterate over pairs of chunks.
    for (l = 0; l < len; l += dbl) {
      r = l + chk;
      e = r + chk;
      if (r > len) r = len;
      if (e > len) e = len;

      // Iterate both chunks in parallel.
      li = l;
      ri = r;
      while (true) {
        // Compare the chunks.
        if (li < r && ri < e) {
          // This works for a regular `sort()` compatible comparator,
          // but also for a simple comparator like: `a > b`
          if (comp(arr[li], arr[ri]) <= 0) {
            result[i++] = arr[li++];
          }
          else {
            result[i++] = arr[ri++];
          }
        }
        // Nothing to compare, just flush what's left.
        else if (li < r) {
          result[i++] = arr[li++];
        }
        else if (ri < e) {
          result[i++] = arr[ri++];
        }
        // Both iterators are at the chunk ends.
        else {
          break
        }
      }
    }
  };

  return stable;

})));

},{}],11:[function(require,module,exports){
var nargs = /\{([0-9a-zA-Z]+)\}/g
var slice = Array.prototype.slice

module.exports = template

function template(string) {
    var args

    if (arguments.length === 2 && typeof arguments[1] === "object") {
        args = arguments[1]
    } else {
        args = slice.call(arguments, 1)
    }

    if (!args || !args.hasOwnProperty) {
        args = {}
    }

    return string.replace(nargs, function replaceArg(match, i, index) {
        var result

        if (string[index - 1] === "{" &&
            string[index + match.length] === "}") {
            return i
        } else {
            result = args.hasOwnProperty(i) ? args[i] : null
            if (result === null || result === undefined) {
                return ""
            }

            return result
        }
    })
}

},{}],12:[function(require,module,exports){
module.exports = {
    'delete': {
        unary: {
            name: 'delete',
            direction: 'right',
            precedence: 20
        }
    },
    '...': {
        unary: {
            name: 'spread',
            direction: 'right',
            precedence: 19
        }
    },
    '..': {
        binary: {
            name: 'range',
            precedence: 3
        }
    },
    '+': {
        binary: {
            name: 'add',
            fn: function(a, b) {
                return a() + b();
            },
            precedence: 13
        },
        unary:{
            name: 'positive',
            direction: 'right',
            fn: function(a) {
                return +a();
            },
            precedence: 15
        }
    },
    '-': {
        binary: {
            name: 'subtract',
            fn: function(a, b) {
                return a() - b();
            },
            precedence: 13
        },
        unary:{
            name: 'negative',
            direction: 'right',
            fn: function(a) {
                return -a();
            },
            precedence: 15
        }
    },
    '*': {
        binary: {
            name: 'multiply',
            fn: function(a, b) {
                return a() * b();
            },
            precedence: 14
        }
    },
    '/': {
        binary: {
            name: 'divide',
            fn: function(a, b) {
                return a() / b();
            },
            precedence: 14
        }
    },
    '%': {
        binary: {
            name: 'remainder',
            fn: function(a, b) {
                return a() % b();
            },
            precedence: 14
        }
    },
    'in': {
        binary: {
            name: 'in',
            fn: function(a, b) {
                return a() in b();
            },
            precedence: 11
        }
    },
    '===': {
        binary: {
            name: 'exactlyEqual',
            fn: function(a, b) {
                return a() === b();
            },
            precedence: 10
        }
    },
    '!==': {
        binary: {
            name: 'notExactlyEqual',
            fn: function(a, b) {
                return a() !== b();
            },
            precedence: 10
        }
    },
    '==': {
        binary: {
            name: 'equal',
            fn: function(a, b) {
                return a() == b();
            },
            precedence: 10
        }
    },
    '!=': {
        binary: {
            name: 'notEqual',
            fn: function(a, b) {
                return a() != b();
            },
            precedence: 10
        }
    },
    '>=': {
        binary: {
            name: 'greaterThanOrEqual',
            fn: function(a, b) {
                return a() >= b();
            },
            precedence: 11
        }
    },
    '<=': {
        binary: {
            name: 'lessThanOrEqual',
            fn: function(a, b) {
                return a() <= b();
            },
            precedence: 11
        }
    },
    '>': {
        binary: {
            name: 'greaterThan',
            fn: function(a, b) {
                return a() > b();
            },
            precedence: 11
        }
    },
    '<': {
        binary: {
            name: 'lessThan',
            fn: function(a, b) {
                return a() < b();
            },
            precedence: 11
        }
    },
    '&&': {
        binary: {
            name: 'and',
            fn: function(a, b) {
                return a() && b();
            },
            precedence: 6
        }
    },
    '||': {
        binary: {
            name: 'or',
            fn: function(a, b) {
                return a() || b();
            },
            precedence: 5
        }
    },
    '!': {
        unary: {
            name: 'not',
            direction: 'right',
            fn: function(a) {
                return !a();
            },
            precedence: 15
        }
    },
    '&': {
        binary: {
            name: 'bitwiseAnd',
            fn: function(a, b) {
                return a() & b();
            },
            precedence: 9
        }
    },
    '^': {
        binary: {
            name: 'bitwiseXOr',
            fn: function(a, b) {
                return a() ^ b();
            },
            precedence: 8
        }
    },
    '|': {
        binary: {
            name: 'bitwiseOr',
            fn: function(a, b) {
                return a() | b();
            },
            precedence: 7
        }
    },
    '~': {
        unary: {
            name: 'bitwiseNot',
            direction: 'right',
            fn: function(a) {
                return ~a();
            },
            precedence: 15
        }
    },
    'typeof': {
        unary: {
            name: 'typeof',
            direction: 'right',
            fn: function(a) {
                return typeof a();
            },
            precedence: 15
        }
    },
    '<<': {
        binary: {
            name: 'bitwiseLeftShift',
            fn: function(a, b) {
                return a() << b();
            },
            precedence: 12
        }
    },
    '>>': {
        binary: {
            name: 'bitwiseRightShift',
            fn: function(a, b) {
                return a() >> b();
            },
            precedence: 12
        }
    },
    '>>>': {
        binary: {
            name: 'bitwiseUnsignedRightShift',
            fn: function(a, b) {
                return a() >>> b();
            },
            precedence: 12
        }
    },
    '=': {
        binary: {
            name: 'assignment',
            precedence: 12
        }
    },
    '?': {
        trinary: {
            name: 'ternary',
            trinary: 'tuple',
            associativity: 'right',
            precedence: 4
        }
    },
    ':': {
        binary: {
            name: 'tuple',
            precedence: 3
        }
    }
};
},{}],13:[function(require,module,exports){
var operators = require('./operators'),
    template = require('string-template'),
    stableSort = require('stable'),
    errorTemplate = 'Parse error,\n{message},\nAt {index} "{snippet}"',
    snippetTemplate = '-->{0}<--';

function parseError(message, token){
    var start = Math.max(token.index - 50, 0),
        errorIndex = Math.min(50, token.index),
        surroundingSource = token.sourceRef.source.slice(start, token.index + 50),
        errorMessage = template(errorTemplate, {
            message: message,
            index: token.index,
            snippet: [
                (start === 0 ? '' : '...\n'),
                surroundingSource.slice(0, errorIndex),
                template(snippetTemplate, surroundingSource.slice(errorIndex, errorIndex+1)),
                surroundingSource.slice(errorIndex + 1) + '',
                (surroundingSource.length < 100 ? '' : '...')
            ].join('')
        });

    throw errorMessage;
}

function findNextNonDelimiter(tokens){
    var result;

    while(result = tokens.shift()){
        if(!result || result.type !== 'delimiter'){
            return result;
        }
    }
}

function lastTokenMatches(ast, types, pop){
    var lastToken = ast[ast.length - 1],
        lastTokenType,
        matched;

    if(!lastToken){
        return;
    }

    lastTokenType = lastToken.type;

    for (var i = types.length-1, type = types[i]; i >= 0; i--, type = types[i]) {
        if(type === '!' + lastTokenType){
            return;
        }

        if(type === '*' || type === lastTokenType){
            matched = true;
        }
    }

    if(!matched){
        return;
    }

    if(pop){
        ast.pop();
    }
    return lastToken;
}

function parseIdentifier(tokens, ast){
    if(tokens[0].type === 'word'){
        ast.push({
            type: 'identifier',
            name: tokens.shift().source
        });
        return true;
    }
}

function parseNumber(tokens, ast){
    if(tokens[0].type === 'number'){
        ast.push({
            type: 'number',
            value: parseFloat(tokens.shift().source)
        });
        return true;
    }
}

function functionCall(target, content){
    return {
        type: 'functionCall',
        target: target,
        content: content
    };
}

function parseParenthesis(tokens, ast) {
    if(tokens[0].type !== 'parenthesisOpen'){
        return;
    }

    var openToken = tokens[0],
        position = 0,
        opens = 1;

    while(++position, position <= tokens.length && opens){
        if(!tokens[position]){
            parseError('invalid nesting. No closing token was found', tokens[position-1]);
        }
        if(tokens[position].type === 'parenthesisOpen') {
            opens++;
        }
        if(tokens[position].type === 'parenthesisClose') {
            opens--;
        }
    }

    var target = !openToken.delimiterPrefix && lastTokenMatches(ast, ['*', '!statement', '!operator', '!set'], true),
        content = parse(tokens.splice(0, position).slice(1,-1)),
        astNode;

    if(target){
        astNode = functionCall(target, content);
    }else{
        astNode = {
            type: 'parenthesisGroup',
            content: content
        };
    }

    ast.push(astNode);

    return true;
}

function parseParameters(functionCall){
    return functionCall.content.map(function(token){
        if(token.type === 'identifier' || (token.name === 'spread' && token.right.type === 'identifier')){
            return token;
        }

        parseError('Unexpected token in parameter list', functionCall);
    });
}

function namedFunctionExpression(functionCall, content){
    if(functionCall.target.type !== 'identifier'){
        return false;
    }

    return {
        type: 'functionExpression',
        identifier: functionCall.target,
        parameters: parseParameters(functionCall),
        content: content
    };
}

function anonymousFunctionExpression(parenthesisGroup, content){
    return {
        type: 'functionExpression',
        parameters: parseParameters(parenthesisGroup),
        content: content
    };
}

function parseBlock(tokens, ast){
    if(tokens[0].type !== 'braceOpen'){
        return;
    }

    var position = 0,
        opens = 1;

    while(++position, position <= tokens.length && opens){
        if(!tokens[position]){
            parseError('invalid nesting. No closing token was found', tokens[position-1]);
        }
        if(tokens[position].type === 'braceOpen'){
            opens++;
        }
        if(tokens[position].type === 'braceClose'){
            opens--;
        }
    }

    var targetToken = tokens[0],
        content = parse(tokens.splice(0, position).slice(1,-1));

    var functionCall = lastTokenMatches(ast, ['functionCall'], true),
        parenthesisGroup = lastTokenMatches(ast, ['parenthesisGroup'], true),
        astNode;

    if(functionCall){
        astNode = namedFunctionExpression(functionCall, content);
    }else if(parenthesisGroup){
        astNode = anonymousFunctionExpression(parenthesisGroup, content);
    }else{
        astNode = {
            type: 'braceGroup',
            content: content
        };
    }

    if(!astNode){
        parseError('unexpected token.', targetToken);
    }

    ast.push(astNode);

    return true;
}

function parseSet(tokens, ast) {
    if(tokens[0].type !== 'squareBraceOpen'){
        return;
    }

    var openToken = tokens[0],
        position = 0,
        opens = 1;

    while(++position, position <= tokens.length && opens){
        if(!tokens[position]){
            parseError('invalid nesting. No closing token was found', tokens[position-1]);
        }
        if(tokens[position].type === 'squareBraceOpen') {
            opens++;
        }
        if(tokens[position].type === 'squareBraceClose') {
            opens--;
        }
    }

    var content = parse(tokens.splice(0, position).slice(1,-1)),
        target = !openToken.delimiterPrefix && lastTokenMatches(ast, ['*', '!functionExpression', '!braceGroup', '!statement', '!operator'], true);

    if(target){
        ast.push({
            type: 'accessor',
            target: target,
            content: content
        });

        return true;
    }

    ast.push({
        type: 'set',
        content: content
    });

    return true;
}


function parseDelimiters(tokens){
    if(tokens[0].type === 'delimiter'){
        tokens.splice(0,1);
        if(tokens[0]){
            tokens[0].delimiterPrefix = true;
        }
        return true;
    }
}

function parseComments(tokens){
    if(tokens[0].type === 'comment'){
        tokens.shift();
        return true;
    }
}

function parseOperator(tokens, ast){
    if(tokens[0].type === 'operator'){
        var token = tokens.shift(),
            operatorsForSource = operators[token.source],
            startOfStatement = !lastTokenMatches(ast, ['*', '!statement', '!operator']);

        if(operatorsForSource.binary && !startOfStatement &&
            !(
                operatorsForSource.unary &&
                (
                    token.delimiterPrefix &&
                    tokens[0].type !== 'delimiter'
                )
            )
        ){
            ast.push({
                type: 'operator',
                name: operatorsForSource.binary.name,
                operator: operatorsForSource.binary,
                sourceRef: token.sourceRef,
                index: token.index
            });
            return true;
        }

        if(operatorsForSource.unary){
            ast.push({
                type: 'operator',
                name: operatorsForSource.unary.name,
                operator: operatorsForSource.unary,
                sourceRef: token.sourceRef,
                index: token.index
            });
            return true;
        }


        if(operatorsForSource.trinary && !startOfStatement){
            ast.push({
                type: 'operator',
                name: operatorsForSource.trinary.name,
                operator: operatorsForSource.trinary,
                sourceRef: token.sourceRef,
                index: token.index
            });
            return true;
        }

        parseError('Unexpected token', token);
    }
}

function parsePeriod(tokens, ast){
    if(tokens[0].type === 'period'){
        var token = tokens.shift(),
            right = findNextNonDelimiter(tokens);

        if(!right){
            return parseError('Unexpected token', token);
        }

        ast.push({
            type: 'period',
            left: ast.pop(),
            right: parseToken([right]).pop()
        });

        return true;
    }
}

function parseComma(tokens, ast){
    if(tokens[0].type === 'comma'){
        tokens.shift();
        return true;
    }
}

function parseString(tokens, ast){
    if(tokens[0].type === 'string'){
        ast.push({
            type: 'string',
            value: JSON.parse('"' + tokens.shift().source.slice(1,-1) + '"')
        });
        return true;
    }
}

function parseSemicolon(tokens, ast){
    if(tokens[0].type === 'semicolon'){
        tokens.shift();
        ast.push({
            type: 'statement',
            content: [ast.pop()]
        });
        return true;
    }
}

var parsers = [
    parseDelimiters,
    parseComments,
    parseNumber,
    parseString,
    parseIdentifier,
    parseComma,
    parsePeriod,
    parseParenthesis,
    parseSet,
    parseBlock,
    parseOperator,
    parseSemicolon
];

function parseOperators(ast){
    stableSort(ast.filter(function(token){
        return token.type === 'operator';
    }), function(a,b){
        if(a.operator.precedence === b.operator.precedence && a.operator.associativity === 'right'){
            return 1;
        }

        return b.operator.precedence - a.operator.precedence;
    })
    .forEach(function(token){
        var index = ast.indexOf(token),
            operator = token.operator,
            left,
            middle,
            right;

        // Token was parsed by some other parser step.
        if(!~index){
            return;
        }

        if(operator.trinary){
            left = ast.splice(index-1,1);
            middle = ast.splice(index,1);
            var trinary = ast.splice(index,1);
            right = ast.splice(index,1);
            if(!trinary.length || trinary[0].name !== operator.trinary){
                parseError('Unexpected token.', token);
            }
        }else if(operator.direction === 'left'){
            left = ast.splice(index-1,1);
        }else if(operator.direction === 'right'){
            right = ast.splice(index + 1,1);
        }else{
            left = ast.splice(index-1,1);
            right = ast.splice(index, 1);
        }

        if(
            left && left.length !== 1 ||
            middle && middle.length !== 1 ||
            right && right.length !== 1
        ){
            parseError('unexpected token.', token);
        }

        if(operator.name === 'assignment' && left[0].type !== 'identifier'){
            parseError('Unexpected token.', token);
        }

        if(left){
            token.left = left[0];
        }
        if(middle){
            token.middle = middle[0];
        }
        if(right){
            token.right = right[0];
        }
    });
}

function parseToken(tokens, ast){
    if(!ast){
        ast = [];
    }

    for(var i = 0; i <= parsers.length && tokens.length; i++){
        if(i === parsers.length && tokens.length){
            parseError('unknown token', tokens[0]);
            return;
        }

        if(parsers[i](tokens, ast)){
            return ast;
        }
    }
}

function parse(tokens, mutate){
    var ast = [];

    if(!mutate){
        tokens = tokens.slice();
    }

    while(tokens.length){
        parseToken(tokens, ast);
    }

    parseOperators(ast);

    return ast;
}

module.exports = parse;
},{"./operators":12,"stable":10,"string-template":11}],14:[function(require,module,exports){
var toValue = require('./toValue');

function wrapScope(__scope__){
    var scope = new Scope();
    scope.__scope__ = __scope__;
    return scope;
}

function Scope(oldScope, debug){
    this.__scope__ = {};
    this._debug = debug;
    if(oldScope){
        this.__outerScope__ = oldScope instanceof Scope ? oldScope : wrapScope(oldScope);
        this._debug = this.__outerScope__._debug;
    }
}
Scope.prototype.throw = function(message){
    this._error = new Error('Presh execution error: ' + message);
    this._error.scope = this;
};
Scope.prototype.get = function(key){
    var scope = this;
    while(scope && !Object.hasOwnProperty.call(scope.__scope__, key)){
        scope = scope.__outerScope__;
    }
    return scope && toValue.value(scope.__scope__[key], this);
};
Scope.prototype.set = function(key, value, bubble){
    if(bubble){
        var currentScope = this;
        while(currentScope && !(key in currentScope.__scope__)){
            currentScope = currentScope.__outerScope__;
        }

        if(currentScope){
            currentScope.set(key, value);
        }
    }
    this.__scope__[key] = toValue(value, this);
    return this;
};
Scope.prototype.define = function(obj){
    for(var key in obj){
        this.__scope__[key] = toValue(obj[key], this);
    }
    return this;
};
Scope.prototype.isDefined = function(key){
    if(key in this.__scope__){
        return true;
    }
    return this.__outerScope__ && this.__outerScope__.isDefined(key) || false;
};
Scope.prototype.hasError = function(){
    return this._error;
};

module.exports = Scope;
},{"./toValue":15}],15:[function(require,module,exports){
var v = {};

function isValue(value){
    return value && value._value === v;
}

module.exports = function toValue(value, scope, context){
    if(scope._error){
        return {
            error: scope._error
        };
    }

    if(isValue(value)){
        if(typeof context === 'object' || typeof context === 'function'){
            value.context = context;
        }
        return value;
    }

    return {
        type: 'value',
        context: context,
        value: value,
        _value: v
    };
};

module.exports.isValue = isValue;

module.exports.value = function(value){
    return isValue(value) ? value.value : value;
};
},{}]},{},[1])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJleGFtcGxlL2luZGV4LmpzIiwiZXhlY3V0ZS5qcyIsImdsb2JhbC5qcyIsImluZGV4LmpzIiwibGV4LmpzIiwibm9kZV9tb2R1bGVzL2NyZWwvY3JlbC5qcyIsIm5vZGVfbW9kdWxlcy9kZWJvdW5jZS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9mbGF0LW1lcmdlL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2lzLWluc3RhbmNlL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3N0YWJsZS9zdGFibGUuanMiLCJub2RlX21vZHVsZXMvc3RyaW5nLXRlbXBsYXRlL2luZGV4LmpzIiwib3BlcmF0b3JzLmpzIiwicGFyc2UuanMiLCJzY29wZS5qcyIsInRvVmFsdWUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMVVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaFFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEtBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hCQTtBQUNBO0FBQ0E7O0FDRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3R0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN1JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDamVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbigpe2Z1bmN0aW9uIHIoZSxuLHQpe2Z1bmN0aW9uIG8oaSxmKXtpZighbltpXSl7aWYoIWVbaV0pe3ZhciBjPVwiZnVuY3Rpb25cIj09dHlwZW9mIHJlcXVpcmUmJnJlcXVpcmU7aWYoIWYmJmMpcmV0dXJuIGMoaSwhMCk7aWYodSlyZXR1cm4gdShpLCEwKTt2YXIgYT1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK2krXCInXCIpO3Rocm93IGEuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixhfXZhciBwPW5baV09e2V4cG9ydHM6e319O2VbaV1bMF0uY2FsbChwLmV4cG9ydHMsZnVuY3Rpb24ocil7dmFyIG49ZVtpXVsxXVtyXTtyZXR1cm4gbyhufHxyKX0scCxwLmV4cG9ydHMscixlLG4sdCl9cmV0dXJuIG5baV0uZXhwb3J0c31mb3IodmFyIHU9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZSxpPTA7aTx0Lmxlbmd0aDtpKyspbyh0W2ldKTtyZXR1cm4gb31yZXR1cm4gcn0pKCkiLCJ2YXIgcHJlc2ggPSByZXF1aXJlKCcuLi8nKSxcbiAgICBkZWJvdW5jZSA9IHJlcXVpcmUoJ2RlYm91bmNlJyksXG4gICAgY3JlbCA9IHJlcXVpcmUoJ2NyZWwnKTtcblxudmFyIGRlZmF1bHRTY29wZSA9IFwieyBhOiAxMCwgYjogMjAsIGZvbzogZnVuY3Rpb24oaW5wdXQpeyByZXR1cm4gaW5wdXQgKyAnIFdvcmxkJ319XCJcbnZhciBkZWZhdWx0Q29kZSA9IGBiYXIoeCl7XG4gICAgeCA+IGEgJiYgeCA8IGIgPyBmb28oeCkgOiBmb28oJ0hlbGxvJyk7XG59XG5cbltiYXIoMTMpIGJhcig4KV1gXG5cbnZhciBzY29wZUlucHV0LCBjb2RlSW5wdXQsIG91dHB1dCwgdWkgPSBjcmVsKCdkaXYnLFxuICAgICAgICBjcmVsKCdoMicsICdTY29wZTonKSxcbiAgICAgICAgc2NvcGVJbnB1dCA9IGNyZWwoJ3ByZScsIHsnY29udGVudGVkaXRhYmxlJzogdHJ1ZX0sIGRlZmF1bHRTY29wZSksXG4gICAgICAgIGNyZWwoJ2gyJywgJ0lucHV0OicpLFxuICAgICAgICBjb2RlSW5wdXQgPSBjcmVsKCdwcmUnLCB7J2NvbnRlbnRlZGl0YWJsZSc6IHRydWV9LCBkZWZhdWx0Q29kZSksXG4gICAgICAgIGNyZWwoJ2gyJywgJ091dHB1dDonKSxcbiAgICAgICAgb3V0cHV0ID0gY3JlbCgnZGl2JylcbiAgICApO1xuXG52YXIgdXBkYXRlID0gZGVib3VuY2UoZnVuY3Rpb24oKXtcblxuICAgIHZhciBzY29wZSA9IHt9O1xuXG4gICAgIHRyeXtcbiAgICAgICAgc2NvcGUgPSBzY29wZUlucHV0LnRleHRDb250ZW50ID8gZXZhbCgnKCcgKyBzY29wZUlucHV0LnRleHRDb250ZW50ICsgJyknKSA6IHNjb3BlO1xuICAgICAgICBzY29wZUlucHV0LnJlbW92ZUF0dHJpYnV0ZSgnZXJyb3InKTtcbiAgICB9Y2F0Y2goZXJyb3Ipe1xuICAgICAgICBzY29wZUlucHV0LnNldEF0dHJpYnV0ZSgnZXJyb3InLCBlcnJvcik7XG4gICAgfVxuXG4gICAgdHJ5e1xuICAgICAgICB2YXIgcmVzdWx0ID0gcHJlc2goY29kZUlucHV0LnRleHRDb250ZW50LCBzY29wZSk7XG5cbiAgICAgICAgb3V0cHV0LnRleHRDb250ZW50ID0gcmVzdWx0LmVycm9yIHx8IEpTT04uc3RyaW5naWZ5KHJlc3VsdC52YWx1ZSwgbnVsbCwgNCk7XG4gICAgICAgIGNvZGVJbnB1dC5yZW1vdmVBdHRyaWJ1dGUoJ2Vycm9yJyk7XG4gICAgfWNhdGNoKGVycm9yKXtcbiAgICAgICAgY29kZUlucHV0LnNldEF0dHJpYnV0ZSgnZXJyb3InLCBlcnJvcik7XG4gICAgfVxufSk7XG51cGRhdGUoKTtcblxuc2NvcGVJbnB1dC5hZGRFdmVudExpc3RlbmVyKCdrZXl1cCcsIHVwZGF0ZSk7XG5jb2RlSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcigna2V5dXAnLCB1cGRhdGUpO1xuXG5mdW5jdGlvbiB0YWIoZXZlbnQpe1xuICAgIGlmKGV2ZW50LndoaWNoID09PSA5KXtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcblxuICAgICAgICB2YXIgc2VsZWN0aW9uID0gZG9jdW1lbnQuZ2V0U2VsZWN0aW9uKCksXG4gICAgICAgICAgICByYW5nZSA9IHNlbGVjdGlvbi5nZXRSYW5nZUF0KDApLFxuICAgICAgICAgICAgdGFiTm9kZSA9IGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKCcgICAgJyk7XG5cbiAgICAgICAgcmFuZ2UuaW5zZXJ0Tm9kZSh0YWJOb2RlKTtcbiAgICAgICAgcmFuZ2Uuc2V0U3RhcnRBZnRlcih0YWJOb2RlKTtcbiAgICAgICAgcmFuZ2Uuc2V0RW5kQWZ0ZXIodGFiTm9kZSk7XG4gICAgICAgIHNlbGVjdGlvbi5yZW1vdmVBbGxSYW5nZXMoKTtcbiAgICAgICAgc2VsZWN0aW9uLmFkZFJhbmdlKHJhbmdlKTtcbiAgICB9XG59XG5cbnNjb3BlSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIHRhYik7XG5jb2RlSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIHRhYik7XG5cbndpbmRvdy5vbmxvYWQgPSBmdW5jdGlvbigpe1xuICAgIGNyZWwoZG9jdW1lbnQuYm9keSwgdWkpO1xufTsiLCJ2YXIgU2NvcGUgPSByZXF1aXJlKCcuL3Njb3BlJyksXG4gICAgdG9WYWx1ZSA9IHJlcXVpcmUoJy4vdG9WYWx1ZScpLFxuICAgIGlzSW5zdGFuY2UgPSByZXF1aXJlKCdpcy1pbnN0YW5jZScpLFxuICAgIHByZXNoRnVuY3Rpb25zID0gbmV3IFdlYWtNYXAoKTtcblxudmFyIHJlc2VydmVkS2V5d29yZHMgPSB7XG4gICAgJ3RydWUnOiB0cnVlLFxuICAgICdmYWxzZSc6IGZhbHNlLFxuICAgICdudWxsJzogbnVsbCxcbiAgICAndW5kZWZpbmVkJzogdW5kZWZpbmVkXG59O1xuXG5mdW5jdGlvbiByZXNvbHZlU3ByZWFkcyhjb250ZW50LCBzY29wZSl7XG4gICAgdmFyIHJlc3VsdCA9IFtdO1xuXG4gICAgY29udGVudC5mb3JFYWNoKGZ1bmN0aW9uKHRva2VuKXtcblxuICAgICAgICBpZih0b2tlbi5uYW1lID09PSAnc3ByZWFkJyl7XG4gICAgICAgICAgICByZXN1bHQucHVzaC5hcHBseShyZXN1bHQsIGV4ZWN1dGVUb2tlbih0b2tlbiwgc2NvcGUpLnZhbHVlKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHJlc3VsdC5wdXNoKGV4ZWN1dGVUb2tlbih0b2tlbiwgc2NvcGUpLnZhbHVlKTtcbiAgICB9KTtcblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbmZ1bmN0aW9uIGZ1bmN0aW9uQ2FsbCh0b2tlbiwgc2NvcGUpe1xuICAgIHZhciBmdW5jdGlvblRva2VuID0gZXhlY3V0ZVRva2VuKHRva2VuLnRhcmdldCwgc2NvcGUpLFxuICAgICAgICBmbiA9IGZ1bmN0aW9uVG9rZW4udmFsdWU7XG5cbiAgICBpZih0eXBlb2YgZm4gIT09ICdmdW5jdGlvbicpe1xuICAgICAgICBzY29wZS50aHJvdyhmbiArICcgaXMgbm90IGEgZnVuY3Rpb24nKTtcbiAgICB9XG5cbiAgICBpZihzY29wZS5oYXNFcnJvcigpKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmKHByZXNoRnVuY3Rpb25zLmhhcyhmbikpe1xuICAgICAgICB2YXIgcmVzdWx0ID0gcHJlc2hGdW5jdGlvbnMuZ2V0KGZuKS5hcHBseShmdW5jdGlvblRva2VuLmNvbnRleHQsIHJlc29sdmVTcHJlYWRzKHRva2VuLmNvbnRlbnQsIHNjb3BlKSk7XG5cbiAgICAgICAgaWYocmVzdWx0LmVycm9yKXtcbiAgICAgICAgICAgIHNjb3BlLnRocm93KHJlc3VsdC5lcnJvcilcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiByZXN1bHQudmFsdWU7XG4gICAgfVxuXG4gICAgdHJ5e1xuICAgICAgICByZXR1cm4gZm4uYXBwbHkoZnVuY3Rpb25Ub2tlbi5jb250ZXh0LCByZXNvbHZlU3ByZWFkcyh0b2tlbi5jb250ZW50LCBzY29wZSkpO1xuICAgIH1jYXRjaChlcnJvcil7XG4gICAgICAgIHNjb3BlLnRocm93KGVycm9yKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGZ1bmN0aW9uRXhwcmVzc2lvbih0b2tlbiwgc2NvcGUpe1xuICAgIHZhciBmbiA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIHZhciBhcmdzID0gYXJndW1lbnRzLFxuICAgICAgICAgICAgZnVuY3Rpb25TY29wZSA9IG5ldyBTY29wZShzY29wZSk7XG5cbiAgICAgICAgdG9rZW4ucGFyYW1ldGVycy5mb3JFYWNoKGZ1bmN0aW9uKHBhcmFtZXRlciwgaW5kZXgpe1xuXG4gICAgICAgICAgICBpZihwYXJhbWV0ZXIubmFtZSA9PT0gJ3NwcmVhZCcpe1xuICAgICAgICAgICAgICAgIGZ1bmN0aW9uU2NvcGUuc2V0KHBhcmFtZXRlci5yaWdodC5uYW1lLCBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmdzLCBpbmRleCkpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZnVuY3Rpb25TY29wZS5zZXQocGFyYW1ldGVyLm5hbWUsIGFyZ3NbaW5kZXhdKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIGV4ZWN1dGUodG9rZW4uY29udGVudCwgZnVuY3Rpb25TY29wZSk7XG4gICAgfTtcblxuICAgIGlmKHRva2VuLmlkZW50aWZpZXIpe1xuICAgICAgICBzY29wZS5zZXQodG9rZW4uaWRlbnRpZmllci5uYW1lLCBmbik7XG4gICAgfVxuXG4gICAgdmFyIHJlc3VsdEZuID0gZnVuY3Rpb24oKXtcbiAgICAgICAgcmV0dXJuIGZuLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykudmFsdWU7XG4gICAgfVxuXG4gICAgcHJlc2hGdW5jdGlvbnMuc2V0KHJlc3VsdEZuLCBmbik7XG5cbiAgICByZXR1cm4gcmVzdWx0Rm47XG59XG5cbmZ1bmN0aW9uIGFzc2lnbm1lbnQodG9rZW4sIHNjb3BlKXtcbiAgICBpZihzY29wZS5pc0RlZmluZWQodG9rZW4ubGVmdC5uYW1lKSl7XG4gICAgICAgIHNjb3BlLnRocm93KCdDYW5ub3QgcmVhc3NpZ24gYWxyZWFkeSBkZWZpbmVkIGlkZW50aWZpZXI6ICcgKyB0b2tlbi5sZWZ0Lm5hbWUpO1xuICAgIH1cblxuICAgIHZhciB2YWx1ZSA9IGV4ZWN1dGVUb2tlbih0b2tlbi5yaWdodCwgc2NvcGUpLnZhbHVlO1xuXG4gICAgc2NvcGUuc2V0KHRva2VuLmxlZnQubmFtZSwgdmFsdWUpO1xuXG4gICAgcmV0dXJuIHZhbHVlO1xufVxuXG5mdW5jdGlvbiB0ZXJuYXJ5KHRva2VuLCBzY29wZSl7XG5cbiAgICBpZihzY29wZS5fZGVidWcpe1xuICAgICAgICBjb25zb2xlLmxvZygnRXhlY3V0aW5nIG9wZXJhdG9yOiAnICsgdG9rZW4ubmFtZSwgdG9rZW4ubGVmdCwgdG9rZW4ucmlnaHQpO1xuICAgIH1cblxuICAgIHJldHVybiBleGVjdXRlVG9rZW4odG9rZW4ubGVmdCwgc2NvcGUpLnZhbHVlID9cbiAgICAgICAgZXhlY3V0ZVRva2VuKHRva2VuLm1pZGRsZSwgc2NvcGUpLnZhbHVlIDpcbiAgICAgICAgZXhlY3V0ZVRva2VuKHRva2VuLnJpZ2h0LCBzY29wZSkudmFsdWU7XG59XG5cbmZ1bmN0aW9uIGlkZW50aWZpZXIodG9rZW4sIHNjb3BlKXtcbiAgICB2YXIgbmFtZSA9IHRva2VuLm5hbWU7XG4gICAgaWYobmFtZSBpbiByZXNlcnZlZEtleXdvcmRzKXtcbiAgICAgICAgcmV0dXJuIHJlc2VydmVkS2V5d29yZHNbbmFtZV07XG4gICAgfVxuICAgIGlmKCFzY29wZS5pc0RlZmluZWQobmFtZSkpe1xuICAgICAgICBzY29wZS50aHJvdyhuYW1lICsgJyBpcyBub3QgZGVmaW5lZCcpO1xuICAgIH1cbiAgICByZXR1cm4gc2NvcGUuZ2V0KG5hbWUpO1xufVxuXG5mdW5jdGlvbiBudW1iZXIodG9rZW4pe1xuICAgIHJldHVybiB0b2tlbi52YWx1ZTtcbn1cblxuZnVuY3Rpb24gc3RyaW5nKHRva2VuKXtcbiAgICByZXR1cm4gdG9rZW4udmFsdWU7XG59XG5cbmZ1bmN0aW9uIGdldFByb3BlcnR5KHRva2VuLCBzY29wZSwgdGFyZ2V0LCBhY2Nlc3Nvcil7XG5cbiAgICBpZighdGFyZ2V0IHx8ICEodHlwZW9mIHRhcmdldCA9PT0gJ29iamVjdCcgfHwgdHlwZW9mIHRhcmdldCA9PT0gJ2Z1bmN0aW9uJykpe1xuICAgICAgICBzY29wZS50aHJvdygndGFyZ2V0IGlzIG5vdCBhbiBvYmplY3QnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuXG4gICAgdmFyIHJlc3VsdCA9IE9iamVjdC5oYXNPd25Qcm9wZXJ0eS5jYWxsKHRhcmdldCwgYWNjZXNzb3IpID8gdGFyZ2V0W2FjY2Vzc29yXSA6IHVuZGVmaW5lZDtcblxuICAgIGlmKHR5cGVvZiByZXN1bHQgPT09ICdmdW5jdGlvbicpe1xuICAgICAgICByZXN1bHQgPSB0b1ZhbHVlKHJlc3VsdCwgc2NvcGUsIHRhcmdldCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn1cblxuZnVuY3Rpb24gcGVyaW9kKHRva2VuLCBzY29wZSl7XG4gICAgdmFyIHRhcmdldCA9IGV4ZWN1dGVUb2tlbih0b2tlbi5sZWZ0LCBzY29wZSkudmFsdWU7XG5cbiAgICByZXR1cm4gZ2V0UHJvcGVydHkodG9rZW4sIHNjb3BlLCB0YXJnZXQsIHRva2VuLnJpZ2h0Lm5hbWUpO1xufVxuXG5mdW5jdGlvbiBhY2Nlc3Nvcih0b2tlbiwgc2NvcGUpe1xuICAgIHZhciBhY2Nlc3NvclZhbHVlID0gZXhlY3V0ZSh0b2tlbi5jb250ZW50LCBzY29wZSkudmFsdWUsXG4gICAgICAgIHRhcmdldCA9IGV4ZWN1dGVUb2tlbih0b2tlbi50YXJnZXQsIHNjb3BlKS52YWx1ZTtcblxuICAgIHJldHVybiBnZXRQcm9wZXJ0eSh0b2tlbiwgc2NvcGUsIHRhcmdldCwgYWNjZXNzb3JWYWx1ZSk7XG59XG5cbmZ1bmN0aW9uIHNwcmVhZCh0b2tlbiwgc2NvcGUpe1xuICAgIHZhciB0YXJnZXQgPSBleGVjdXRlVG9rZW4odG9rZW4ucmlnaHQsIHNjb3BlKS52YWx1ZTtcblxuICAgIGlmKCFBcnJheS5pc0FycmF5KHRhcmdldCkpe1xuICAgICAgICBzY29wZS50aHJvdygndGFyZ2V0IGRpZCBub3QgcmVzb2x2ZSB0byBhbiBhcnJheScpO1xuICAgIH1cblxuICAgIHJldHVybiB0YXJnZXQ7XG59XG5cbmZ1bmN0aW9uIHNldCh0b2tlbiwgc2NvcGUpe1xuICAgIGlmKHRva2VuLmNvbnRlbnQubGVuZ3RoID09PSAxICYmIHRva2VuLmNvbnRlbnRbMF0ubmFtZSA9PT0gJ3JhbmdlJyl7XG4gICAgICAgIHZhciByYW5nZSA9IHRva2VuLmNvbnRlbnRbMF0sXG4gICAgICAgICAgICBzdGFydCA9IGV4ZWN1dGVUb2tlbihyYW5nZS5sZWZ0LCBzY29wZSkudmFsdWUsXG4gICAgICAgICAgICBlbmQgPSBleGVjdXRlVG9rZW4ocmFuZ2UucmlnaHQsIHNjb3BlKS52YWx1ZSxcbiAgICAgICAgICAgIHJldmVyc2UgPSBlbmQgPCBzdGFydCxcbiAgICAgICAgICAgIHJlc3VsdCA9IFtdO1xuXG4gICAgICAgIGlmKE1hdGguYWJzKHN0YXJ0KSA9PT0gSW5maW5pdHkgfHwgTWF0aC5hYnMoZW5kKSA9PT0gSW5maW5pdHkpe1xuICAgICAgICAgICAgc2NvcGUudGhyb3coJ1JhbmdlIHZhbHVlcyBjYW4gbm90IGJlIGluZmluaXRlJyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKHZhciBpID0gc3RhcnQ7IHJldmVyc2UgPyBpID49IGVuZCA6IGkgPD0gZW5kOyByZXZlcnNlID8gaS0tIDogaSsrKSB7XG4gICAgICAgICAgICByZXN1bHQucHVzaChpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc29sdmVTcHJlYWRzKHRva2VuLmNvbnRlbnQsIHNjb3BlKTtcbn1cblxuZnVuY3Rpb24gdmFsdWUodG9rZW4pe1xuICAgIHJldHVybiB0b2tlbi52YWx1ZTtcbn1cblxuZnVuY3Rpb24gb2JqZWN0KHRva2VuLCBzY29wZSl7XG4gICAgdmFyIHJlc3VsdCA9IHt9O1xuXG4gICAgdmFyIGNvbnRlbnQgPSB0b2tlbi5jb250ZW50O1xuXG4gICAgZm9yKHZhciBpID0gMDsgaSA8IGNvbnRlbnQubGVuZ3RoOyBpICsrKSB7XG4gICAgICAgIHZhciBjaGlsZCA9IGNvbnRlbnRbaV0sXG4gICAgICAgICAgICBrZXksXG4gICAgICAgICAgICB2YWx1ZTtcblxuICAgICAgICBpZihjaGlsZC5uYW1lID09PSAndHVwbGUnKXtcbiAgICAgICAgICAgIGlmKGNoaWxkLmxlZnQudHlwZSA9PT0gJ2lkZW50aWZpZXInKXtcbiAgICAgICAgICAgICAgICBrZXkgPSBjaGlsZC5sZWZ0Lm5hbWU7XG4gICAgICAgICAgICB9ZWxzZSBpZihjaGlsZC5sZWZ0LnR5cGUgPT09ICdzZXQnICYmIGNoaWxkLmxlZnQuY29udGVudC5sZW5ndGggPT09IDEpe1xuICAgICAgICAgICAgICAgIGtleSA9IGV4ZWN1dGVUb2tlbihjaGlsZC5sZWZ0LmNvbnRlbnRbMF0sIHNjb3BlKS52YWx1ZTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIHNjb3BlLnRocm93KCdVbmV4cGVjdGVkIHRva2VuIGluIG9iamVjdCBjb25zdHJ1Y3RvcjogJyArIGNoaWxkLnR5cGUpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFsdWUgPSBleGVjdXRlVG9rZW4oY2hpbGQucmlnaHQsIHNjb3BlKS52YWx1ZTtcbiAgICAgICAgfWVsc2UgaWYoY2hpbGQudHlwZSA9PT0gJ2lkZW50aWZpZXInKXtcbiAgICAgICAgICAgIGtleSA9IGNoaWxkLm5hbWU7XG4gICAgICAgICAgICB2YWx1ZSA9IGV4ZWN1dGVUb2tlbihjaGlsZCwgc2NvcGUpLnZhbHVlO1xuICAgICAgICB9ZWxzZSBpZihjaGlsZC5uYW1lID09PSAnc3ByZWFkJyl7XG4gICAgICAgICAgICB2YXIgc291cmNlID0gZXhlY3V0ZVRva2VuKGNoaWxkLnJpZ2h0LCBzY29wZSkudmFsdWU7XG5cbiAgICAgICAgICAgIGlmKCFpc0luc3RhbmNlKHNvdXJjZSkpe1xuICAgICAgICAgICAgICAgIHNjb3BlLnRocm93KCdUYXJnZXQgZGlkIG5vdCByZXNvbHZlIHRvIGFuIGluc3RhbmNlIG9mIGFuIG9iamVjdCcpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgT2JqZWN0LmFzc2lnbihyZXN1bHQsIHNvdXJjZSk7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfWVsc2UgaWYoY2hpbGQubmFtZSA9PT0gJ2RlbGV0ZScpe1xuICAgICAgICAgICAgdmFyIHRhcmdldElkZW50aWZpZXIgPSBjaGlsZC5yaWdodDtcblxuICAgICAgICAgICAgaWYodGFyZ2V0SWRlbnRpZmllci50eXBlICE9PSAnaWRlbnRpZmllcicpe1xuICAgICAgICAgICAgICAgIHNjb3BlLnRocm93KCdUYXJnZXQgb2YgZGVsZXRlIHdhcyBub3QgYW4gaWRlbnRpZmllcicpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZGVsZXRlIHJlc3VsdFt0YXJnZXRJZGVudGlmaWVyLm5hbWVdO1xuXG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICBzY29wZS50aHJvdygnVW5leHBlY3RlZCB0b2tlbiBpbiBvYmplY3QgY29uc3RydWN0b3I6ICcgKyBjaGlsZC50eXBlKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHJlc3VsdFtrZXldID0gdmFsdWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn1cblxudmFyIGhhbmRsZXJzID0ge1xuICAgIGFzc2lnbm1lbnQ6IGFzc2lnbm1lbnQsXG4gICAgdGVybmFyeTogdGVybmFyeSxcbiAgICBmdW5jdGlvbkNhbGw6IGZ1bmN0aW9uQ2FsbCxcbiAgICBmdW5jdGlvbkV4cHJlc3Npb246IGZ1bmN0aW9uRXhwcmVzc2lvbixcbiAgICBudW1iZXI6IG51bWJlcixcbiAgICBzdHJpbmc6IHN0cmluZyxcbiAgICBpZGVudGlmaWVyOiBpZGVudGlmaWVyLFxuICAgIHNldDogc2V0LFxuICAgIHBlcmlvZDogcGVyaW9kLFxuICAgIHNwcmVhZDogc3ByZWFkLFxuICAgIGFjY2Vzc29yOiBhY2Nlc3NvcixcbiAgICB2YWx1ZTogdmFsdWUsXG4gICAgb3BlcmF0b3I6IG9wZXJhdG9yLFxuICAgIHBhcmVudGhlc2lzR3JvdXA6IGNvbnRlbnRIb2xkZXIsXG4gICAgc3RhdGVtZW50OiBjb250ZW50SG9sZGVyLFxuICAgIGJyYWNlR3JvdXA6IG9iamVjdFxufTtcblxuZnVuY3Rpb24gbmV4dE9wZXJhdG9yVG9rZW4odG9rZW4sIHNjb3BlKXtcbiAgICByZXR1cm4gZnVuY3Rpb24oKXtcbiAgICAgICAgcmV0dXJuIGV4ZWN1dGVUb2tlbih0b2tlbiwgc2NvcGUpLnZhbHVlO1xuICAgIH07XG59XG5cbmZ1bmN0aW9uIG9wZXJhdG9yKHRva2VuLCBzY29wZSl7XG4gICAgaWYodG9rZW4ubmFtZSBpbiBoYW5kbGVycyl7XG4gICAgICAgIHJldHVybiB0b1ZhbHVlKGhhbmRsZXJzW3Rva2VuLm5hbWVdKHRva2VuLCBzY29wZSksIHNjb3BlKTtcbiAgICB9XG5cbiAgICBpZih0b2tlbi5sZWZ0KXtcbiAgICAgICAgaWYoc2NvcGUuX2RlYnVnKXtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdFeGVjdXRpbmcgdG9rZW46ICcgKyB0b2tlbi5uYW1lLCB0b2tlbi5sZWZ0LCB0b2tlbi5yaWdodCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRva2VuLm9wZXJhdG9yLmZuKG5leHRPcGVyYXRvclRva2VuKHRva2VuLmxlZnQsIHNjb3BlKSwgbmV4dE9wZXJhdG9yVG9rZW4odG9rZW4ucmlnaHQsIHNjb3BlKSk7XG4gICAgfVxuXG4gICAgaWYoc2NvcGUuX2RlYnVnKXtcbiAgICAgICAgY29uc29sZS5sb2coJ0V4ZWN1dGluZyBvcGVyYXRvcjogJyArIHRva2VuLm5hbWUuIHRva2VuLnJpZ2h0KTtcbiAgICB9XG5cbiAgICByZXR1cm4gdG9rZW4ub3BlcmF0b3IuZm4obmV4dE9wZXJhdG9yVG9rZW4odG9rZW4ucmlnaHQsIHNjb3BlKSk7XG59XG5cbmZ1bmN0aW9uIGNvbnRlbnRIb2xkZXIocGFyZW50aGVzaXNHcm91cCwgc2NvcGUpe1xuICAgIHJldHVybiBleGVjdXRlKHBhcmVudGhlc2lzR3JvdXAuY29udGVudCwgc2NvcGUpLnZhbHVlO1xufVxuXG5mdW5jdGlvbiBleGVjdXRlVG9rZW4odG9rZW4sIHNjb3BlKXtcbiAgICBpZihzY29wZS5fZXJyb3Ipe1xuICAgICAgICByZXR1cm4ge2Vycm9yOiBzY29wZS5fZXJyb3J9O1xuICAgIH1cbiAgICByZXR1cm4gdG9WYWx1ZShoYW5kbGVyc1t0b2tlbi50eXBlXSh0b2tlbiwgc2NvcGUpLCBzY29wZSk7XG59XG5cbmZ1bmN0aW9uIGV4ZWN1dGUodG9rZW5zLCBzY29wZSwgZGVidWcpe1xuICAgIHNjb3BlID0gc2NvcGUgaW5zdGFuY2VvZiBTY29wZSA/IHNjb3BlIDogbmV3IFNjb3BlKHNjb3BlLCBkZWJ1Zyk7XG5cbiAgICB2YXIgcmVzdWx0O1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdG9rZW5zLmxlbmd0aDsgaSsrKSB7XG5cbiAgICAgICAgcmVzdWx0ID0gZXhlY3V0ZVRva2VuKHRva2Vuc1tpXSwgc2NvcGUpO1xuXG4gICAgICAgIGlmKHJlc3VsdC5lcnJvcil7XG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgaWYoIXJlc3VsdCl7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBlcnJvcjogbmV3IEVycm9yKCdVbmtub3duIGV4ZWN1dGlvbiBlcnJvcicpXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBleGVjdXRlOyIsIm1vZHVsZS5leHBvcnRzID0ge1xuICAgIGxvZzogZnVuY3Rpb24oeCl7XG4gICAgICAgIGNvbnNvbGUubG9nLmFwcGx5KGNvbnNvbGUsIGFyZ3VtZW50cyk7XG4gICAgICAgIHJldHVybiB4O1xuICAgIH0sXG4gICAgc2xpY2U6IGZ1bmN0aW9uKGl0ZW1zLCBzdGFydCwgZW5kKXtcbiAgICAgICAgcmV0dXJuIGl0ZW1zLnNsaWNlKHN0YXJ0LCBlbmQpO1xuICAgIH0sXG4gICAgZmluZDogZnVuY3Rpb24oaXRlbXMsIGZuKXtcbiAgICAgICAgcmV0dXJuIGl0ZW1zLmZpbmQoZm4pO1xuICAgIH0sXG4gICAgaW5kZXhPZjogZnVuY3Rpb24oaXRlbXMsIHZhbHVlKXtcbiAgICAgICAgcmV0dXJuIGl0ZW1zLmluZGV4T2YodmFsdWUpO1xuICAgIH0sXG4gICAgbWFwOiBmdW5jdGlvbihpdGVtcywgZm4pe1xuICAgICAgICByZXR1cm4gaXRlbXMubWFwKGZuKTtcbiAgICB9LFxuICAgIGZvbGQ6IGZ1bmN0aW9uKGl0ZW1zLCBzZWVkLCBmbil7XG4gICAgICAgIGlmKGFyZ3VtZW50cy5sZW5ndGggPT09IDIpe1xuICAgICAgICAgICAgcmV0dXJuIGl0ZW1zLnJlZHVjZShzZWVkKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gaXRlbXMucmVkdWNlKGZuLCBzZWVkKTtcbiAgICB9LFxuICAgIFN0cmluZzogU3RyaW5nLFxuICAgIE51bWJlcjogTnVtYmVyLFxuICAgIG1hdGg6IE1hdGhcbn07IiwidmFyIGxleCA9IHJlcXVpcmUoJy4vbGV4JyksXG4gICAgcGFyc2UgPSByZXF1aXJlKCcuL3BhcnNlJyksXG4gICAgZXhlY3V0ZSA9IHJlcXVpcmUoJy4vZXhlY3V0ZScpLFxuICAgIGdsb2JhbCA9IHJlcXVpcmUoJy4vZ2xvYmFsJyksXG4gICAgbWVyZ2UgPSByZXF1aXJlKCdmbGF0LW1lcmdlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZXhwcmVzc2lvbiwgc2NvcGUsIGNhbGxiYWNrLCBkZWJ1Zyl7XG4gICAgdmFyIGxleGVkID0gbGV4KGV4cHJlc3Npb24pO1xuICAgIHZhciBwYXJzZWQgPSBwYXJzZShsZXhlZCk7XG5cbiAgICByZXR1cm4gZXhlY3V0ZShwYXJzZWQsIG1lcmdlKFxuICAgICAgICBnbG9iYWwsXG4gICAgICAgIHNjb3BlXG4gICAgKSwgY2FsbGJhY2ssIGRlYnVnKTtcbn07IiwidmFyIG9wZXJhdG9ycyA9IHJlcXVpcmUoJy4vb3BlcmF0b3JzJyk7XG5cbmZ1bmN0aW9uIGxleFN0cmluZyhzb3VyY2Upe1xuICAgIHZhciBzdHJpbmdNYXRjaCA9IHNvdXJjZS5tYXRjaCgvXigoW1wiJ10pKD86W15cXFxcXXxcXFxcLikqP1xcMikvKTtcblxuICAgIGlmKHN0cmluZ01hdGNoKXtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgc3RyaW5nQ2hhcjogc3RyaW5nTWF0Y2hbMV0uY2hhckF0KDApLFxuICAgICAgICAgICAgc291cmNlOiBzdHJpbmdNYXRjaFsxXSwvLy5yZXBsYWNlKC9cXFxcKFsnXCJdKS9nLCBcIiQxXCIpLFxuICAgICAgICAgICAgbGVuZ3RoOiBzdHJpbmdNYXRjaFsxXS5sZW5ndGhcbiAgICAgICAgfTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGxleFdvcmQoc291cmNlKXtcbiAgICB2YXIgbWF0Y2ggPSBzb3VyY2UubWF0Y2goL14oPyFcXC0pW1xcdy0kXSsvKTtcblxuICAgIGlmKCFtYXRjaCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZihtYXRjaCBpbiBvcGVyYXRvcnMpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgdHlwZTogJ3dvcmQnLFxuICAgICAgICBzb3VyY2U6IG1hdGNoWzBdLFxuICAgICAgICBsZW5ndGg6IG1hdGNoWzBdLmxlbmd0aFxuICAgIH07XG59XG5cbmZ1bmN0aW9uIGxleE51bWJlcihzb3VyY2Upe1xuICAgIHZhciBzcGVjaWFscyA9IHtcbiAgICAgICAgJ05hTic6IE51bWJlci5OYU4sXG4gICAgICAgICdJbmZpbml0eSc6IEluZmluaXR5XG4gICAgfTtcblxuICAgIHZhciB0b2tlbiA9IHtcbiAgICAgICAgdHlwZTogJ251bWJlcidcbiAgICB9O1xuXG4gICAgZm9yICh2YXIga2V5IGluIHNwZWNpYWxzKSB7XG4gICAgICAgIGlmIChzb3VyY2Uuc2xpY2UoMCwga2V5Lmxlbmd0aCkgPT09IGtleSkge1xuICAgICAgICAgICAgdG9rZW4uc291cmNlID0ga2V5O1xuICAgICAgICAgICAgdG9rZW4ubGVuZ3RoID0gdG9rZW4uc291cmNlLmxlbmd0aDtcblxuICAgICAgICAgICAgcmV0dXJuIHRva2VuO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgdmFyIG1hdGNoRXhwb25lbnQgPSBzb3VyY2UubWF0Y2goL15bMC05XSsoPzpcXC5bMC05XSspP1tlRV0tP1swLTldKy8pO1xuXG4gICAgaWYobWF0Y2hFeHBvbmVudCl7XG4gICAgICAgIHRva2VuLnNvdXJjZSA9IG1hdGNoRXhwb25lbnRbMF07XG4gICAgICAgIHRva2VuLmxlbmd0aCA9IHRva2VuLnNvdXJjZS5sZW5ndGg7XG5cbiAgICAgICAgcmV0dXJuIHRva2VuO1xuICAgIH1cblxuICAgIHZhciBtYXRjaEhleCA9IHNvdXJjZS5tYXRjaCgvXjBbeFhdWzAtOV0rLyk7XG5cbiAgICBpZihtYXRjaEhleCl7XG4gICAgICAgIHRva2VuLnNvdXJjZSA9IG1hdGNoSGV4WzBdO1xuICAgICAgICB0b2tlbi5sZW5ndGggPSB0b2tlbi5zb3VyY2UubGVuZ3RoO1xuXG4gICAgICAgIHJldHVybiB0b2tlbjtcbiAgICB9XG5cbiAgICB2YXIgbWF0Y2hIZWFkbGVzc0RlY2ltYWwgPSBzb3VyY2UubWF0Y2goL15cXC5bMC05XSsvKTtcblxuICAgIGlmKG1hdGNoSGVhZGxlc3NEZWNpbWFsKXtcbiAgICAgICAgdG9rZW4uc291cmNlID0gbWF0Y2hIZWFkbGVzc0RlY2ltYWxbMF07XG4gICAgICAgIHRva2VuLmxlbmd0aCA9IHRva2VuLnNvdXJjZS5sZW5ndGg7XG5cbiAgICAgICAgcmV0dXJuIHRva2VuO1xuICAgIH1cblxuICAgIHZhciBtYXRjaE5vcm1hbERlY2ltYWwgPSBzb3VyY2UubWF0Y2goL15bMC05XSsoPzpcXC5bMC05XSspPy8pO1xuXG4gICAgaWYobWF0Y2hOb3JtYWxEZWNpbWFsKXtcbiAgICAgICAgdG9rZW4uc291cmNlID0gbWF0Y2hOb3JtYWxEZWNpbWFsWzBdO1xuICAgICAgICB0b2tlbi5sZW5ndGggPSB0b2tlbi5zb3VyY2UubGVuZ3RoO1xuXG4gICAgICAgIHJldHVybiB0b2tlbjtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGxleENvbW1lbnQoc291cmNlKXtcbiAgICB2YXIgbWF0Y2ggPSBzb3VyY2UubWF0Y2goL14oXFwvXFwqW15dKj9cXCpcXC8pLyk7XG5cbiAgICBpZighbWF0Y2gpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgdHlwZTogJ2NvbW1lbnQnLFxuICAgICAgICBzb3VyY2U6IG1hdGNoWzBdLFxuICAgICAgICBsZW5ndGg6IG1hdGNoWzBdLmxlbmd0aFxuICAgIH07XG59XG5cbnZhciBjaGFyYWN0ZXJzID0ge1xuICAgICcsJzogJ2NvbW1hJyxcbiAgICAnLic6ICdwZXJpb2QnLFxuICAgICc7JzogJ3NlbWljb2xvbicsXG4gICAgJ3snOiAnYnJhY2VPcGVuJyxcbiAgICAnfSc6ICdicmFjZUNsb3NlJyxcbiAgICAnKCc6ICdwYXJlbnRoZXNpc09wZW4nLFxuICAgICcpJzogJ3BhcmVudGhlc2lzQ2xvc2UnLFxuICAgICdbJzogJ3NxdWFyZUJyYWNlT3BlbicsXG4gICAgJ10nOiAnc3F1YXJlQnJhY2VDbG9zZSdcbn07XG5cbmZ1bmN0aW9uIGxleENoYXJhY3RlcnMoc291cmNlKXtcbiAgICB2YXIgbmFtZSxcbiAgICAgICAga2V5O1xuXG4gICAgZm9yKGtleSBpbiBjaGFyYWN0ZXJzKXtcbiAgICAgICAgaWYoc291cmNlLmluZGV4T2Yoa2V5KSA9PT0gMCl7XG4gICAgICAgICAgICBuYW1lID0gY2hhcmFjdGVyc1trZXldO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZighbmFtZSl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICB0eXBlOiBuYW1lLFxuICAgICAgICBzb3VyY2U6IGtleSxcbiAgICAgICAgbGVuZ3RoOiAxXG4gICAgfTtcbn1cblxuZnVuY3Rpb24gbGV4T3BlcmF0b3JzKHNvdXJjZSl7XG4gICAgdmFyIG9wZXJhdG9yLFxuICAgICAgICBrZXk7XG5cbiAgICBmb3Ioa2V5IGluIG9wZXJhdG9ycyl7XG4gICAgICAgIGlmKHNvdXJjZS5pbmRleE9mKGtleSkgPT09IDApe1xuICAgICAgICAgICAgb3BlcmF0b3IgPSBvcGVyYXRvcnNba2V5XTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgaWYoIW9wZXJhdG9yKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIHR5cGU6ICdvcGVyYXRvcicsXG4gICAgICAgIHNvdXJjZToga2V5LFxuICAgICAgICBsZW5ndGg6IGtleS5sZW5ndGhcbiAgICB9O1xufVxuXG5mdW5jdGlvbiBsZXhTcHJlYWQoc291cmNlKXtcbiAgICB2YXIgbWF0Y2ggPSBzb3VyY2UubWF0Y2goL15cXC5cXC5cXC4vKTtcblxuICAgIGlmKCFtYXRjaCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICB0eXBlOiAnc3ByZWFkJyxcbiAgICAgICAgc291cmNlOiBtYXRjaFswXSxcbiAgICAgICAgbGVuZ3RoOiBtYXRjaFswXS5sZW5ndGhcbiAgICB9O1xufVxuXG5mdW5jdGlvbiBsZXhEZWxpbWl0ZXIoc291cmNlKXtcbiAgICB2YXIgbWF0Y2ggPSBzb3VyY2UubWF0Y2goL15bXFxzXFxuXSsvKTtcblxuICAgIGlmKCFtYXRjaCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICB0eXBlOiAnZGVsaW1pdGVyJyxcbiAgICAgICAgc291cmNlOiBtYXRjaFswXSxcbiAgICAgICAgbGVuZ3RoOiBtYXRjaFswXS5sZW5ndGhcbiAgICB9O1xufVxuXG52YXIgbGV4ZXJzID0gW1xuICAgIGxleERlbGltaXRlcixcbiAgICBsZXhDb21tZW50LFxuICAgIGxleE51bWJlcixcbiAgICBsZXhXb3JkLFxuICAgIGxleE9wZXJhdG9ycyxcbiAgICBsZXhDaGFyYWN0ZXJzLFxuICAgIGxleFN0cmluZyxcbiAgICBsZXhTcHJlYWRcbl07XG5cbmZ1bmN0aW9uIHNjYW5Gb3JUb2tlbih0b2tlbmlzZXJzLCBleHByZXNzaW9uKXtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRva2VuaXNlcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIHRva2VuID0gdG9rZW5pc2Vyc1tpXShleHByZXNzaW9uKTtcbiAgICAgICAgaWYgKHRva2VuKSB7XG4gICAgICAgICAgICByZXR1cm4gdG9rZW47XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIGxleChzb3VyY2UsIG1lbW9pc2VkVG9rZW5zKSB7XG4gICAgdmFyIHNvdXJjZVJlZiA9IHtcbiAgICAgICAgc291cmNlOiBzb3VyY2UsXG4gICAgICAgIHRvSlNPTjogZnVuY3Rpb24oKXt9XG4gICAgfTtcblxuICAgIGlmKCFzb3VyY2Upe1xuICAgICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgaWYobWVtb2lzZWRUb2tlbnMgJiYgbWVtb2lzZWRUb2tlbnNbc291cmNlXSl7XG4gICAgICAgIHJldHVybiBtZW1vaXNlZFRva2Vuc1tzb3VyY2VdLnNsaWNlKCk7XG4gICAgfVxuXG4gICAgdmFyIG9yaWdpbmFsU291cmNlID0gc291cmNlLFxuICAgICAgICB0b2tlbnMgPSBbXSxcbiAgICAgICAgdG90YWxDaGFyc1Byb2Nlc3NlZCA9IDAsXG4gICAgICAgIHByZXZpb3VzTGVuZ3RoO1xuXG4gICAgZG8ge1xuICAgICAgICBwcmV2aW91c0xlbmd0aCA9IHNvdXJjZS5sZW5ndGg7XG5cbiAgICAgICAgdmFyIHRva2VuO1xuXG4gICAgICAgIHRva2VuID0gc2NhbkZvclRva2VuKGxleGVycywgc291cmNlKTtcblxuICAgICAgICBpZih0b2tlbil7XG4gICAgICAgICAgICB0b2tlbi5zb3VyY2VSZWYgPSBzb3VyY2VSZWY7XG4gICAgICAgICAgICB0b2tlbi5pbmRleCA9IHRvdGFsQ2hhcnNQcm9jZXNzZWQ7XG4gICAgICAgICAgICBzb3VyY2UgPSBzb3VyY2Uuc2xpY2UodG9rZW4ubGVuZ3RoKTtcbiAgICAgICAgICAgIHRvdGFsQ2hhcnNQcm9jZXNzZWQgKz0gdG9rZW4ubGVuZ3RoO1xuICAgICAgICAgICAgdG9rZW5zLnB1c2godG9rZW4pO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuXG4gICAgICAgIGlmKHNvdXJjZS5sZW5ndGggPT09IHByZXZpb3VzTGVuZ3RoKXtcbiAgICAgICAgICAgIHRocm93ICdTeW50YXggZXJyb3I6IFVuYWJsZSB0byBkZXRlcm1pbmUgbmV4dCB0b2tlbiBpbiBzb3VyY2U6ICcgKyBzb3VyY2Uuc2xpY2UoMCwgMTAwKTtcbiAgICAgICAgfVxuXG4gICAgfSB3aGlsZSAoc291cmNlKTtcblxuICAgIGlmKG1lbW9pc2VkVG9rZW5zKXtcbiAgICAgICAgbWVtb2lzZWRUb2tlbnNbb3JpZ2luYWxTb3VyY2VdID0gdG9rZW5zLnNsaWNlKCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRva2Vucztcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBsZXg7IiwiLy9Db3B5cmlnaHQgKEMpIDIwMTIgS29yeSBOdW5uXHJcblxyXG4vL1Blcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGUgXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbCBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCwgZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdCBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGUgZm9sbG93aW5nIGNvbmRpdGlvbnM6XHJcblxyXG4vL1RoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkIGluIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxyXG5cclxuLy9USEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTIE9SIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTiBOTyBFVkVOVCBTSEFMTCBUSEUgQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSwgREFNQUdFUyBPUiBPVEhFUiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEUgVVNFIE9SIE9USEVSIERFQUxJTkdTIElOIFRIRSBTT0ZUV0FSRS5cclxuXHJcbi8qXHJcblxyXG4gICAgVGhpcyBjb2RlIGlzIG5vdCBmb3JtYXR0ZWQgZm9yIHJlYWRhYmlsaXR5LCBidXQgcmF0aGVyIHJ1bi1zcGVlZCBhbmQgdG8gYXNzaXN0IGNvbXBpbGVycy5cclxuXHJcbiAgICBIb3dldmVyLCB0aGUgY29kZSdzIGludGVudGlvbiBzaG91bGQgYmUgdHJhbnNwYXJlbnQuXHJcblxyXG4gICAgKioqIElFIFNVUFBPUlQgKioqXHJcblxyXG4gICAgSWYgeW91IHJlcXVpcmUgdGhpcyBsaWJyYXJ5IHRvIHdvcmsgaW4gSUU3LCBhZGQgdGhlIGZvbGxvd2luZyBhZnRlciBkZWNsYXJpbmcgY3JlbC5cclxuXHJcbiAgICB2YXIgdGVzdERpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpLFxyXG4gICAgICAgIHRlc3RMYWJlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2xhYmVsJyk7XHJcblxyXG4gICAgdGVzdERpdi5zZXRBdHRyaWJ1dGUoJ2NsYXNzJywgJ2EnKTtcclxuICAgIHRlc3REaXZbJ2NsYXNzTmFtZSddICE9PSAnYScgPyBjcmVsLmF0dHJNYXBbJ2NsYXNzJ10gPSAnY2xhc3NOYW1lJzp1bmRlZmluZWQ7XHJcbiAgICB0ZXN0RGl2LnNldEF0dHJpYnV0ZSgnbmFtZScsJ2EnKTtcclxuICAgIHRlc3REaXZbJ25hbWUnXSAhPT0gJ2EnID8gY3JlbC5hdHRyTWFwWyduYW1lJ10gPSBmdW5jdGlvbihlbGVtZW50LCB2YWx1ZSl7XHJcbiAgICAgICAgZWxlbWVudC5pZCA9IHZhbHVlO1xyXG4gICAgfTp1bmRlZmluZWQ7XHJcblxyXG5cclxuICAgIHRlc3RMYWJlbC5zZXRBdHRyaWJ1dGUoJ2ZvcicsICdhJyk7XHJcbiAgICB0ZXN0TGFiZWxbJ2h0bWxGb3InXSAhPT0gJ2EnID8gY3JlbC5hdHRyTWFwWydmb3InXSA9ICdodG1sRm9yJzp1bmRlZmluZWQ7XHJcblxyXG5cclxuXHJcbiovXHJcblxyXG4oZnVuY3Rpb24gKHJvb3QsIGZhY3RvcnkpIHtcclxuICAgIGlmICh0eXBlb2YgZXhwb3J0cyA9PT0gJ29iamVjdCcpIHtcclxuICAgICAgICBtb2R1bGUuZXhwb3J0cyA9IGZhY3RvcnkoKTtcclxuICAgIH0gZWxzZSBpZiAodHlwZW9mIGRlZmluZSA9PT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUuYW1kKSB7XHJcbiAgICAgICAgZGVmaW5lKGZhY3RvcnkpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICByb290LmNyZWwgPSBmYWN0b3J5KCk7XHJcbiAgICB9XHJcbn0odGhpcywgZnVuY3Rpb24gKCkge1xyXG4gICAgdmFyIGZuID0gJ2Z1bmN0aW9uJyxcclxuICAgICAgICBvYmogPSAnb2JqZWN0JyxcclxuICAgICAgICBub2RlVHlwZSA9ICdub2RlVHlwZScsXHJcbiAgICAgICAgdGV4dENvbnRlbnQgPSAndGV4dENvbnRlbnQnLFxyXG4gICAgICAgIHNldEF0dHJpYnV0ZSA9ICdzZXRBdHRyaWJ1dGUnLFxyXG4gICAgICAgIGF0dHJNYXBTdHJpbmcgPSAnYXR0ck1hcCcsXHJcbiAgICAgICAgaXNOb2RlU3RyaW5nID0gJ2lzTm9kZScsXHJcbiAgICAgICAgaXNFbGVtZW50U3RyaW5nID0gJ2lzRWxlbWVudCcsXHJcbiAgICAgICAgZCA9IHR5cGVvZiBkb2N1bWVudCA9PT0gb2JqID8gZG9jdW1lbnQgOiB7fSxcclxuICAgICAgICBpc1R5cGUgPSBmdW5jdGlvbihhLCB0eXBlKXtcclxuICAgICAgICAgICAgcmV0dXJuIHR5cGVvZiBhID09PSB0eXBlO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgaXNOb2RlID0gdHlwZW9mIE5vZGUgPT09IGZuID8gZnVuY3Rpb24gKG9iamVjdCkge1xyXG4gICAgICAgICAgICByZXR1cm4gb2JqZWN0IGluc3RhbmNlb2YgTm9kZTtcclxuICAgICAgICB9IDpcclxuICAgICAgICAvLyBpbiBJRSA8PSA4IE5vZGUgaXMgYW4gb2JqZWN0LCBvYnZpb3VzbHkuLlxyXG4gICAgICAgIGZ1bmN0aW9uKG9iamVjdCl7XHJcbiAgICAgICAgICAgIHJldHVybiBvYmplY3QgJiZcclxuICAgICAgICAgICAgICAgIGlzVHlwZShvYmplY3QsIG9iaikgJiZcclxuICAgICAgICAgICAgICAgIChub2RlVHlwZSBpbiBvYmplY3QpICYmXHJcbiAgICAgICAgICAgICAgICBpc1R5cGUob2JqZWN0Lm93bmVyRG9jdW1lbnQsb2JqKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIGlzRWxlbWVudCA9IGZ1bmN0aW9uIChvYmplY3QpIHtcclxuICAgICAgICAgICAgcmV0dXJuIGNyZWxbaXNOb2RlU3RyaW5nXShvYmplY3QpICYmIG9iamVjdFtub2RlVHlwZV0gPT09IDE7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBpc0FycmF5ID0gZnVuY3Rpb24oYSl7XHJcbiAgICAgICAgICAgIHJldHVybiBhIGluc3RhbmNlb2YgQXJyYXk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBhcHBlbmRDaGlsZCA9IGZ1bmN0aW9uKGVsZW1lbnQsIGNoaWxkKSB7XHJcbiAgICAgICAgICAgIGlmIChpc0FycmF5KGNoaWxkKSkge1xyXG4gICAgICAgICAgICAgICAgY2hpbGQubWFwKGZ1bmN0aW9uKHN1YkNoaWxkKXtcclxuICAgICAgICAgICAgICAgICAgICBhcHBlbmRDaGlsZChlbGVtZW50LCBzdWJDaGlsZCk7XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZighY3JlbFtpc05vZGVTdHJpbmddKGNoaWxkKSl7XHJcbiAgICAgICAgICAgICAgICBjaGlsZCA9IGQuY3JlYXRlVGV4dE5vZGUoY2hpbGQpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGVsZW1lbnQuYXBwZW5kQ2hpbGQoY2hpbGQpO1xyXG4gICAgICAgIH07XHJcblxyXG5cclxuICAgIGZ1bmN0aW9uIGNyZWwoKXtcclxuICAgICAgICB2YXIgYXJncyA9IGFyZ3VtZW50cywgLy9Ob3RlOiBhc3NpZ25lZCB0byBhIHZhcmlhYmxlIHRvIGFzc2lzdCBjb21waWxlcnMuIFNhdmVzIGFib3V0IDQwIGJ5dGVzIGluIGNsb3N1cmUgY29tcGlsZXIuIEhhcyBuZWdsaWdhYmxlIGVmZmVjdCBvbiBwZXJmb3JtYW5jZS5cclxuICAgICAgICAgICAgZWxlbWVudCA9IGFyZ3NbMF0sXHJcbiAgICAgICAgICAgIGNoaWxkLFxyXG4gICAgICAgICAgICBzZXR0aW5ncyA9IGFyZ3NbMV0sXHJcbiAgICAgICAgICAgIGNoaWxkSW5kZXggPSAyLFxyXG4gICAgICAgICAgICBhcmd1bWVudHNMZW5ndGggPSBhcmdzLmxlbmd0aCxcclxuICAgICAgICAgICAgYXR0cmlidXRlTWFwID0gY3JlbFthdHRyTWFwU3RyaW5nXTtcclxuXHJcbiAgICAgICAgZWxlbWVudCA9IGNyZWxbaXNFbGVtZW50U3RyaW5nXShlbGVtZW50KSA/IGVsZW1lbnQgOiBkLmNyZWF0ZUVsZW1lbnQoZWxlbWVudCk7XHJcbiAgICAgICAgLy8gc2hvcnRjdXRcclxuICAgICAgICBpZihhcmd1bWVudHNMZW5ndGggPT09IDEpe1xyXG4gICAgICAgICAgICByZXR1cm4gZWxlbWVudDtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmKCFpc1R5cGUoc2V0dGluZ3Msb2JqKSB8fCBjcmVsW2lzTm9kZVN0cmluZ10oc2V0dGluZ3MpIHx8IGlzQXJyYXkoc2V0dGluZ3MpKSB7XHJcbiAgICAgICAgICAgIC0tY2hpbGRJbmRleDtcclxuICAgICAgICAgICAgc2V0dGluZ3MgPSBudWxsO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gc2hvcnRjdXQgaWYgdGhlcmUgaXMgb25seSBvbmUgY2hpbGQgdGhhdCBpcyBhIHN0cmluZ1xyXG4gICAgICAgIGlmKChhcmd1bWVudHNMZW5ndGggLSBjaGlsZEluZGV4KSA9PT0gMSAmJiBpc1R5cGUoYXJnc1tjaGlsZEluZGV4XSwgJ3N0cmluZycpICYmIGVsZW1lbnRbdGV4dENvbnRlbnRdICE9PSB1bmRlZmluZWQpe1xyXG4gICAgICAgICAgICBlbGVtZW50W3RleHRDb250ZW50XSA9IGFyZ3NbY2hpbGRJbmRleF07XHJcbiAgICAgICAgfWVsc2V7XHJcbiAgICAgICAgICAgIGZvcig7IGNoaWxkSW5kZXggPCBhcmd1bWVudHNMZW5ndGg7ICsrY2hpbGRJbmRleCl7XHJcbiAgICAgICAgICAgICAgICBjaGlsZCA9IGFyZ3NbY2hpbGRJbmRleF07XHJcblxyXG4gICAgICAgICAgICAgICAgaWYoY2hpbGQgPT0gbnVsbCl7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKGlzQXJyYXkoY2hpbGQpKSB7XHJcbiAgICAgICAgICAgICAgICAgIGZvciAodmFyIGk9MDsgaSA8IGNoaWxkLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgYXBwZW5kQ2hpbGQoZWxlbWVudCwgY2hpbGRbaV0pO1xyXG4gICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICBhcHBlbmRDaGlsZChlbGVtZW50LCBjaGlsZCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGZvcih2YXIga2V5IGluIHNldHRpbmdzKXtcclxuICAgICAgICAgICAgaWYoIWF0dHJpYnV0ZU1hcFtrZXldKXtcclxuICAgICAgICAgICAgICAgIGlmKGlzVHlwZShzZXR0aW5nc1trZXldLGZuKSl7XHJcbiAgICAgICAgICAgICAgICAgICAgZWxlbWVudFtrZXldID0gc2V0dGluZ3Nba2V5XTtcclxuICAgICAgICAgICAgICAgIH1lbHNle1xyXG4gICAgICAgICAgICAgICAgICAgIGVsZW1lbnRbc2V0QXR0cmlidXRlXShrZXksIHNldHRpbmdzW2tleV0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9ZWxzZXtcclxuICAgICAgICAgICAgICAgIHZhciBhdHRyID0gYXR0cmlidXRlTWFwW2tleV07XHJcbiAgICAgICAgICAgICAgICBpZih0eXBlb2YgYXR0ciA9PT0gZm4pe1xyXG4gICAgICAgICAgICAgICAgICAgIGF0dHIoZWxlbWVudCwgc2V0dGluZ3Nba2V5XSk7XHJcbiAgICAgICAgICAgICAgICB9ZWxzZXtcclxuICAgICAgICAgICAgICAgICAgICBlbGVtZW50W3NldEF0dHJpYnV0ZV0oYXR0ciwgc2V0dGluZ3Nba2V5XSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJldHVybiBlbGVtZW50O1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFVzZWQgZm9yIG1hcHBpbmcgb25lIGtpbmQgb2YgYXR0cmlidXRlIHRvIHRoZSBzdXBwb3J0ZWQgdmVyc2lvbiBvZiB0aGF0IGluIGJhZCBicm93c2Vycy5cclxuICAgIGNyZWxbYXR0ck1hcFN0cmluZ10gPSB7fTtcclxuXHJcbiAgICBjcmVsW2lzRWxlbWVudFN0cmluZ10gPSBpc0VsZW1lbnQ7XHJcblxyXG4gICAgY3JlbFtpc05vZGVTdHJpbmddID0gaXNOb2RlO1xyXG5cclxuICAgIGlmKHR5cGVvZiBQcm94eSAhPT0gJ3VuZGVmaW5lZCcpe1xyXG4gICAgICAgIGNyZWwucHJveHkgPSBuZXcgUHJveHkoY3JlbCwge1xyXG4gICAgICAgICAgICBnZXQ6IGZ1bmN0aW9uKHRhcmdldCwga2V5KXtcclxuICAgICAgICAgICAgICAgICEoa2V5IGluIGNyZWwpICYmIChjcmVsW2tleV0gPSBjcmVsLmJpbmQobnVsbCwga2V5KSk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gY3JlbFtrZXldO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGNyZWw7XHJcbn0pKTtcclxuIiwiLyoqXG4gKiBSZXR1cm5zIGEgZnVuY3Rpb24sIHRoYXQsIGFzIGxvbmcgYXMgaXQgY29udGludWVzIHRvIGJlIGludm9rZWQsIHdpbGwgbm90XG4gKiBiZSB0cmlnZ2VyZWQuIFRoZSBmdW5jdGlvbiB3aWxsIGJlIGNhbGxlZCBhZnRlciBpdCBzdG9wcyBiZWluZyBjYWxsZWQgZm9yXG4gKiBOIG1pbGxpc2Vjb25kcy4gSWYgYGltbWVkaWF0ZWAgaXMgcGFzc2VkLCB0cmlnZ2VyIHRoZSBmdW5jdGlvbiBvbiB0aGVcbiAqIGxlYWRpbmcgZWRnZSwgaW5zdGVhZCBvZiB0aGUgdHJhaWxpbmcuIFRoZSBmdW5jdGlvbiBhbHNvIGhhcyBhIHByb3BlcnR5ICdjbGVhcicgXG4gKiB0aGF0IGlzIGEgZnVuY3Rpb24gd2hpY2ggd2lsbCBjbGVhciB0aGUgdGltZXIgdG8gcHJldmVudCBwcmV2aW91c2x5IHNjaGVkdWxlZCBleGVjdXRpb25zLiBcbiAqXG4gKiBAc291cmNlIHVuZGVyc2NvcmUuanNcbiAqIEBzZWUgaHR0cDovL3Vuc2NyaXB0YWJsZS5jb20vMjAwOS8wMy8yMC9kZWJvdW5jaW5nLWphdmFzY3JpcHQtbWV0aG9kcy9cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZ1bmN0aW9uIHRvIHdyYXBcbiAqIEBwYXJhbSB7TnVtYmVyfSB0aW1lb3V0IGluIG1zIChgMTAwYClcbiAqIEBwYXJhbSB7Qm9vbGVhbn0gd2hldGhlciB0byBleGVjdXRlIGF0IHRoZSBiZWdpbm5pbmcgKGBmYWxzZWApXG4gKiBAYXBpIHB1YmxpY1xuICovXG5mdW5jdGlvbiBkZWJvdW5jZShmdW5jLCB3YWl0LCBpbW1lZGlhdGUpe1xuICB2YXIgdGltZW91dCwgYXJncywgY29udGV4dCwgdGltZXN0YW1wLCByZXN1bHQ7XG4gIGlmIChudWxsID09IHdhaXQpIHdhaXQgPSAxMDA7XG5cbiAgZnVuY3Rpb24gbGF0ZXIoKSB7XG4gICAgdmFyIGxhc3QgPSBEYXRlLm5vdygpIC0gdGltZXN0YW1wO1xuXG4gICAgaWYgKGxhc3QgPCB3YWl0ICYmIGxhc3QgPj0gMCkge1xuICAgICAgdGltZW91dCA9IHNldFRpbWVvdXQobGF0ZXIsIHdhaXQgLSBsYXN0KTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGltZW91dCA9IG51bGw7XG4gICAgICBpZiAoIWltbWVkaWF0ZSkge1xuICAgICAgICByZXN1bHQgPSBmdW5jLmFwcGx5KGNvbnRleHQsIGFyZ3MpO1xuICAgICAgICBjb250ZXh0ID0gYXJncyA9IG51bGw7XG4gICAgICB9XG4gICAgfVxuICB9O1xuXG4gIHZhciBkZWJvdW5jZWQgPSBmdW5jdGlvbigpe1xuICAgIGNvbnRleHQgPSB0aGlzO1xuICAgIGFyZ3MgPSBhcmd1bWVudHM7XG4gICAgdGltZXN0YW1wID0gRGF0ZS5ub3coKTtcbiAgICB2YXIgY2FsbE5vdyA9IGltbWVkaWF0ZSAmJiAhdGltZW91dDtcbiAgICBpZiAoIXRpbWVvdXQpIHRpbWVvdXQgPSBzZXRUaW1lb3V0KGxhdGVyLCB3YWl0KTtcbiAgICBpZiAoY2FsbE5vdykge1xuICAgICAgcmVzdWx0ID0gZnVuYy5hcHBseShjb250ZXh0LCBhcmdzKTtcbiAgICAgIGNvbnRleHQgPSBhcmdzID0gbnVsbDtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuXG4gIGRlYm91bmNlZC5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aW1lb3V0KSB7XG4gICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICB0aW1lb3V0ID0gbnVsbDtcbiAgICB9XG4gIH07XG4gIFxuICBkZWJvdW5jZWQuZmx1c2ggPSBmdW5jdGlvbigpIHtcbiAgICBpZiAodGltZW91dCkge1xuICAgICAgcmVzdWx0ID0gZnVuYy5hcHBseShjb250ZXh0LCBhcmdzKTtcbiAgICAgIGNvbnRleHQgPSBhcmdzID0gbnVsbDtcbiAgICAgIFxuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgICAgdGltZW91dCA9IG51bGw7XG4gICAgfVxuICB9O1xuXG4gIHJldHVybiBkZWJvdW5jZWQ7XG59O1xuXG4vLyBBZGRzIGNvbXBhdGliaWxpdHkgZm9yIEVTIG1vZHVsZXNcbmRlYm91bmNlLmRlYm91bmNlID0gZGVib3VuY2U7XG5cbm1vZHVsZS5leHBvcnRzID0gZGVib3VuY2U7XG4iLCJmdW5jdGlvbiBmbGF0TWVyZ2UoYSxiKXtcbiAgICBpZighYiB8fCB0eXBlb2YgYiAhPT0gJ29iamVjdCcpe1xuICAgICAgICBiID0ge307XG4gICAgfVxuXG4gICAgaWYoIWEgfHwgdHlwZW9mIGEgIT09ICdvYmplY3QnKXtcbiAgICAgICAgYSA9IG5ldyBiLmNvbnN0cnVjdG9yKCk7XG4gICAgfVxuXG4gICAgdmFyIHJlc3VsdCA9IG5ldyBhLmNvbnN0cnVjdG9yKCksXG4gICAgICAgIGFLZXlzID0gT2JqZWN0LmtleXMoYSksXG4gICAgICAgIGJLZXlzID0gT2JqZWN0LmtleXMoYik7XG5cbiAgICBmb3IodmFyIGkgPSAwOyBpIDwgYUtleXMubGVuZ3RoOyBpKyspe1xuICAgICAgICByZXN1bHRbYUtleXNbaV1dID0gYVthS2V5c1tpXV07XG4gICAgfVxuXG4gICAgZm9yKHZhciBpID0gMDsgaSA8IGJLZXlzLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgcmVzdWx0W2JLZXlzW2ldXSA9IGJbYktleXNbaV1dO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZmxhdE1lcmdlOyIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24odmFsdWUpe1xyXG4gICAgcmV0dXJuIHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgfHwgdHlwZW9mIHZhbHVlID09PSAnZnVuY3Rpb24nO1xyXG59OyIsIi8vISBzdGFibGUuanMgMC4xLjgsIGh0dHBzOi8vZ2l0aHViLmNvbS9Ud28tU2NyZWVuL3N0YWJsZVxuLy8hIMKpIDIwMTggQW5ncnkgQnl0ZXMgYW5kIGNvbnRyaWJ1dG9ycy4gTUlUIGxpY2Vuc2VkLlxuXG4oZnVuY3Rpb24gKGdsb2JhbCwgZmFjdG9yeSkge1xuICB0eXBlb2YgZXhwb3J0cyA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcgPyBtb2R1bGUuZXhwb3J0cyA9IGZhY3RvcnkoKSA6XG4gIHR5cGVvZiBkZWZpbmUgPT09ICdmdW5jdGlvbicgJiYgZGVmaW5lLmFtZCA/IGRlZmluZShmYWN0b3J5KSA6XG4gIChnbG9iYWwuc3RhYmxlID0gZmFjdG9yeSgpKTtcbn0odGhpcywgKGZ1bmN0aW9uICgpIHsgJ3VzZSBzdHJpY3QnO1xuXG4gIC8vIEEgc3RhYmxlIGFycmF5IHNvcnQsIGJlY2F1c2UgYEFycmF5I3NvcnQoKWAgaXMgbm90IGd1YXJhbnRlZWQgc3RhYmxlLlxuICAvLyBUaGlzIGlzIGFuIGltcGxlbWVudGF0aW9uIG9mIG1lcmdlIHNvcnQsIHdpdGhvdXQgcmVjdXJzaW9uLlxuXG4gIHZhciBzdGFibGUgPSBmdW5jdGlvbiAoYXJyLCBjb21wKSB7XG4gICAgcmV0dXJuIGV4ZWMoYXJyLnNsaWNlKCksIGNvbXApXG4gIH07XG5cbiAgc3RhYmxlLmlucGxhY2UgPSBmdW5jdGlvbiAoYXJyLCBjb21wKSB7XG4gICAgdmFyIHJlc3VsdCA9IGV4ZWMoYXJyLCBjb21wKTtcblxuICAgIC8vIFRoaXMgc2ltcGx5IGNvcGllcyBiYWNrIGlmIHRoZSByZXN1bHQgaXNuJ3QgaW4gdGhlIG9yaWdpbmFsIGFycmF5LFxuICAgIC8vIHdoaWNoIGhhcHBlbnMgb24gYW4gb2RkIG51bWJlciBvZiBwYXNzZXMuXG4gICAgaWYgKHJlc3VsdCAhPT0gYXJyKSB7XG4gICAgICBwYXNzKHJlc3VsdCwgbnVsbCwgYXJyLmxlbmd0aCwgYXJyKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXJyXG4gIH07XG5cbiAgLy8gRXhlY3V0ZSB0aGUgc29ydCB1c2luZyB0aGUgaW5wdXQgYXJyYXkgYW5kIGEgc2Vjb25kIGJ1ZmZlciBhcyB3b3JrIHNwYWNlLlxuICAvLyBSZXR1cm5zIG9uZSBvZiB0aG9zZSB0d28sIGNvbnRhaW5pbmcgdGhlIGZpbmFsIHJlc3VsdC5cbiAgZnVuY3Rpb24gZXhlYyhhcnIsIGNvbXApIHtcbiAgICBpZiAodHlwZW9mKGNvbXApICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICBjb21wID0gZnVuY3Rpb24gKGEsIGIpIHtcbiAgICAgICAgcmV0dXJuIFN0cmluZyhhKS5sb2NhbGVDb21wYXJlKGIpXG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIFNob3J0LWNpcmN1aXQgd2hlbiB0aGVyZSdzIG5vdGhpbmcgdG8gc29ydC5cbiAgICB2YXIgbGVuID0gYXJyLmxlbmd0aDtcbiAgICBpZiAobGVuIDw9IDEpIHtcbiAgICAgIHJldHVybiBhcnJcbiAgICB9XG5cbiAgICAvLyBSYXRoZXIgdGhhbiBkaXZpZGluZyBpbnB1dCwgc2ltcGx5IGl0ZXJhdGUgY2h1bmtzIG9mIDEsIDIsIDQsIDgsIGV0Yy5cbiAgICAvLyBDaHVua3MgYXJlIHRoZSBzaXplIG9mIHRoZSBsZWZ0IG9yIHJpZ2h0IGhhbmQgaW4gbWVyZ2Ugc29ydC5cbiAgICAvLyBTdG9wIHdoZW4gdGhlIGxlZnQtaGFuZCBjb3ZlcnMgYWxsIG9mIHRoZSBhcnJheS5cbiAgICB2YXIgYnVmZmVyID0gbmV3IEFycmF5KGxlbik7XG4gICAgZm9yICh2YXIgY2hrID0gMTsgY2hrIDwgbGVuOyBjaGsgKj0gMikge1xuICAgICAgcGFzcyhhcnIsIGNvbXAsIGNoaywgYnVmZmVyKTtcblxuICAgICAgdmFyIHRtcCA9IGFycjtcbiAgICAgIGFyciA9IGJ1ZmZlcjtcbiAgICAgIGJ1ZmZlciA9IHRtcDtcbiAgICB9XG5cbiAgICByZXR1cm4gYXJyXG4gIH1cblxuICAvLyBSdW4gYSBzaW5nbGUgcGFzcyB3aXRoIHRoZSBnaXZlbiBjaHVuayBzaXplLlxuICB2YXIgcGFzcyA9IGZ1bmN0aW9uIChhcnIsIGNvbXAsIGNoaywgcmVzdWx0KSB7XG4gICAgdmFyIGxlbiA9IGFyci5sZW5ndGg7XG4gICAgdmFyIGkgPSAwO1xuICAgIC8vIFN0ZXAgc2l6ZSAvIGRvdWJsZSBjaHVuayBzaXplLlxuICAgIHZhciBkYmwgPSBjaGsgKiAyO1xuICAgIC8vIEJvdW5kcyBvZiB0aGUgbGVmdCBhbmQgcmlnaHQgY2h1bmtzLlxuICAgIHZhciBsLCByLCBlO1xuICAgIC8vIEl0ZXJhdG9ycyBvdmVyIHRoZSBsZWZ0IGFuZCByaWdodCBjaHVuay5cbiAgICB2YXIgbGksIHJpO1xuXG4gICAgLy8gSXRlcmF0ZSBvdmVyIHBhaXJzIG9mIGNodW5rcy5cbiAgICBmb3IgKGwgPSAwOyBsIDwgbGVuOyBsICs9IGRibCkge1xuICAgICAgciA9IGwgKyBjaGs7XG4gICAgICBlID0gciArIGNoaztcbiAgICAgIGlmIChyID4gbGVuKSByID0gbGVuO1xuICAgICAgaWYgKGUgPiBsZW4pIGUgPSBsZW47XG5cbiAgICAgIC8vIEl0ZXJhdGUgYm90aCBjaHVua3MgaW4gcGFyYWxsZWwuXG4gICAgICBsaSA9IGw7XG4gICAgICByaSA9IHI7XG4gICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICAvLyBDb21wYXJlIHRoZSBjaHVua3MuXG4gICAgICAgIGlmIChsaSA8IHIgJiYgcmkgPCBlKSB7XG4gICAgICAgICAgLy8gVGhpcyB3b3JrcyBmb3IgYSByZWd1bGFyIGBzb3J0KClgIGNvbXBhdGlibGUgY29tcGFyYXRvcixcbiAgICAgICAgICAvLyBidXQgYWxzbyBmb3IgYSBzaW1wbGUgY29tcGFyYXRvciBsaWtlOiBgYSA+IGJgXG4gICAgICAgICAgaWYgKGNvbXAoYXJyW2xpXSwgYXJyW3JpXSkgPD0gMCkge1xuICAgICAgICAgICAgcmVzdWx0W2krK10gPSBhcnJbbGkrK107XG4gICAgICAgICAgfVxuICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgcmVzdWx0W2krK10gPSBhcnJbcmkrK107XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIC8vIE5vdGhpbmcgdG8gY29tcGFyZSwganVzdCBmbHVzaCB3aGF0J3MgbGVmdC5cbiAgICAgICAgZWxzZSBpZiAobGkgPCByKSB7XG4gICAgICAgICAgcmVzdWx0W2krK10gPSBhcnJbbGkrK107XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAocmkgPCBlKSB7XG4gICAgICAgICAgcmVzdWx0W2krK10gPSBhcnJbcmkrK107XG4gICAgICAgIH1cbiAgICAgICAgLy8gQm90aCBpdGVyYXRvcnMgYXJlIGF0IHRoZSBjaHVuayBlbmRzLlxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICBicmVha1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9O1xuXG4gIHJldHVybiBzdGFibGU7XG5cbn0pKSk7XG4iLCJ2YXIgbmFyZ3MgPSAvXFx7KFswLTlhLXpBLVpdKylcXH0vZ1xudmFyIHNsaWNlID0gQXJyYXkucHJvdG90eXBlLnNsaWNlXG5cbm1vZHVsZS5leHBvcnRzID0gdGVtcGxhdGVcblxuZnVuY3Rpb24gdGVtcGxhdGUoc3RyaW5nKSB7XG4gICAgdmFyIGFyZ3NcblxuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAyICYmIHR5cGVvZiBhcmd1bWVudHNbMV0gPT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgYXJncyA9IGFyZ3VtZW50c1sxXVxuICAgIH0gZWxzZSB7XG4gICAgICAgIGFyZ3MgPSBzbGljZS5jYWxsKGFyZ3VtZW50cywgMSlcbiAgICB9XG5cbiAgICBpZiAoIWFyZ3MgfHwgIWFyZ3MuaGFzT3duUHJvcGVydHkpIHtcbiAgICAgICAgYXJncyA9IHt9XG4gICAgfVxuXG4gICAgcmV0dXJuIHN0cmluZy5yZXBsYWNlKG5hcmdzLCBmdW5jdGlvbiByZXBsYWNlQXJnKG1hdGNoLCBpLCBpbmRleCkge1xuICAgICAgICB2YXIgcmVzdWx0XG5cbiAgICAgICAgaWYgKHN0cmluZ1tpbmRleCAtIDFdID09PSBcIntcIiAmJlxuICAgICAgICAgICAgc3RyaW5nW2luZGV4ICsgbWF0Y2gubGVuZ3RoXSA9PT0gXCJ9XCIpIHtcbiAgICAgICAgICAgIHJldHVybiBpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXN1bHQgPSBhcmdzLmhhc093blByb3BlcnR5KGkpID8gYXJnc1tpXSA6IG51bGxcbiAgICAgICAgICAgIGlmIChyZXN1bHQgPT09IG51bGwgfHwgcmVzdWx0ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gXCJcIlxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0XG4gICAgICAgIH1cbiAgICB9KVxufVxuIiwibW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgJ2RlbGV0ZSc6IHtcbiAgICAgICAgdW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdkZWxldGUnLFxuICAgICAgICAgICAgZGlyZWN0aW9uOiAncmlnaHQnLFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMjBcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJy4uLic6IHtcbiAgICAgICAgdW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdzcHJlYWQnLFxuICAgICAgICAgICAgZGlyZWN0aW9uOiAncmlnaHQnLFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTlcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJy4uJzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdyYW5nZScsXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAzXG4gICAgICAgIH1cbiAgICB9LFxuICAgICcrJzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdhZGQnLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpICsgYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDEzXG4gICAgICAgIH0sXG4gICAgICAgIHVuYXJ5OntcbiAgICAgICAgICAgIG5hbWU6ICdwb3NpdGl2ZScsXG4gICAgICAgICAgICBkaXJlY3Rpb246ICdyaWdodCcsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSkge1xuICAgICAgICAgICAgICAgIHJldHVybiArYSgpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDE1XG4gICAgICAgIH1cbiAgICB9LFxuICAgICctJzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdzdWJ0cmFjdCcsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhKCkgLSBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTNcbiAgICAgICAgfSxcbiAgICAgICAgdW5hcnk6e1xuICAgICAgICAgICAgbmFtZTogJ25lZ2F0aXZlJyxcbiAgICAgICAgICAgIGRpcmVjdGlvbjogJ3JpZ2h0JyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIC1hKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTVcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJyonOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ211bHRpcGx5JyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSAqIGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxNFxuICAgICAgICB9XG4gICAgfSxcbiAgICAnLyc6IHtcbiAgICAgICAgYmluYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAnZGl2aWRlJyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSAvIGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxNFxuICAgICAgICB9XG4gICAgfSxcbiAgICAnJSc6IHtcbiAgICAgICAgYmluYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAncmVtYWluZGVyJyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSAlIGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxNFxuICAgICAgICB9XG4gICAgfSxcbiAgICAnaW4nOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2luJyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSBpbiBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTFcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJz09PSc6IHtcbiAgICAgICAgYmluYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAnZXhhY3RseUVxdWFsJyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSA9PT0gYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDEwXG4gICAgICAgIH1cbiAgICB9LFxuICAgICchPT0nOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ25vdEV4YWN0bHlFcXVhbCcsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhKCkgIT09IGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxMFxuICAgICAgICB9XG4gICAgfSxcbiAgICAnPT0nOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2VxdWFsJyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSA9PSBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTBcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJyE9Jzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdub3RFcXVhbCcsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhKCkgIT0gYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDEwXG4gICAgICAgIH1cbiAgICB9LFxuICAgICc+PSc6IHtcbiAgICAgICAgYmluYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAnZ3JlYXRlclRoYW5PckVxdWFsJyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSA+PSBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTFcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJzw9Jzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdsZXNzVGhhbk9yRXF1YWwnLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpIDw9IGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxMVxuICAgICAgICB9XG4gICAgfSxcbiAgICAnPic6IHtcbiAgICAgICAgYmluYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAnZ3JlYXRlclRoYW4nLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpID4gYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDExXG4gICAgICAgIH1cbiAgICB9LFxuICAgICc8Jzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdsZXNzVGhhbicsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhKCkgPCBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTFcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJyYmJzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdhbmQnLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpICYmIGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiA2XG4gICAgICAgIH1cbiAgICB9LFxuICAgICd8fCc6IHtcbiAgICAgICAgYmluYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAnb3InLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpIHx8IGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiA1XG4gICAgICAgIH1cbiAgICB9LFxuICAgICchJzoge1xuICAgICAgICB1bmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ25vdCcsXG4gICAgICAgICAgICBkaXJlY3Rpb246ICdyaWdodCcsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSkge1xuICAgICAgICAgICAgICAgIHJldHVybiAhYSgpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDE1XG4gICAgICAgIH1cbiAgICB9LFxuICAgICcmJzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdiaXR3aXNlQW5kJyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSAmIGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiA5XG4gICAgICAgIH1cbiAgICB9LFxuICAgICdeJzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdiaXR3aXNlWE9yJyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSBeIGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiA4XG4gICAgICAgIH1cbiAgICB9LFxuICAgICd8Jzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdiaXR3aXNlT3InLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpIHwgYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDdcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJ34nOiB7XG4gICAgICAgIHVuYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAnYml0d2lzZU5vdCcsXG4gICAgICAgICAgICBkaXJlY3Rpb246ICdyaWdodCcsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSkge1xuICAgICAgICAgICAgICAgIHJldHVybiB+YSgpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDE1XG4gICAgICAgIH1cbiAgICB9LFxuICAgICd0eXBlb2YnOiB7XG4gICAgICAgIHVuYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAndHlwZW9mJyxcbiAgICAgICAgICAgIGRpcmVjdGlvbjogJ3JpZ2h0JyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHR5cGVvZiBhKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTVcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJzw8Jzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdiaXR3aXNlTGVmdFNoaWZ0JyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSA8PCBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTJcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJz4+Jzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdiaXR3aXNlUmlnaHRTaGlmdCcsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhKCkgPj4gYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDEyXG4gICAgICAgIH1cbiAgICB9LFxuICAgICc+Pj4nOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2JpdHdpc2VVbnNpZ25lZFJpZ2h0U2hpZnQnLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpID4+PiBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTJcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJz0nOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2Fzc2lnbm1lbnQnLFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTJcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJz8nOiB7XG4gICAgICAgIHRyaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICd0ZXJuYXJ5JyxcbiAgICAgICAgICAgIHRyaW5hcnk6ICd0dXBsZScsXG4gICAgICAgICAgICBhc3NvY2lhdGl2aXR5OiAncmlnaHQnLFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogNFxuICAgICAgICB9XG4gICAgfSxcbiAgICAnOic6IHtcbiAgICAgICAgYmluYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAndHVwbGUnLFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogM1xuICAgICAgICB9XG4gICAgfVxufTsiLCJ2YXIgb3BlcmF0b3JzID0gcmVxdWlyZSgnLi9vcGVyYXRvcnMnKSxcbiAgICB0ZW1wbGF0ZSA9IHJlcXVpcmUoJ3N0cmluZy10ZW1wbGF0ZScpLFxuICAgIHN0YWJsZVNvcnQgPSByZXF1aXJlKCdzdGFibGUnKSxcbiAgICBlcnJvclRlbXBsYXRlID0gJ1BhcnNlIGVycm9yLFxcbnttZXNzYWdlfSxcXG5BdCB7aW5kZXh9IFwie3NuaXBwZXR9XCInLFxuICAgIHNuaXBwZXRUZW1wbGF0ZSA9ICctLT57MH08LS0nO1xuXG5mdW5jdGlvbiBwYXJzZUVycm9yKG1lc3NhZ2UsIHRva2VuKXtcbiAgICB2YXIgc3RhcnQgPSBNYXRoLm1heCh0b2tlbi5pbmRleCAtIDUwLCAwKSxcbiAgICAgICAgZXJyb3JJbmRleCA9IE1hdGgubWluKDUwLCB0b2tlbi5pbmRleCksXG4gICAgICAgIHN1cnJvdW5kaW5nU291cmNlID0gdG9rZW4uc291cmNlUmVmLnNvdXJjZS5zbGljZShzdGFydCwgdG9rZW4uaW5kZXggKyA1MCksXG4gICAgICAgIGVycm9yTWVzc2FnZSA9IHRlbXBsYXRlKGVycm9yVGVtcGxhdGUsIHtcbiAgICAgICAgICAgIG1lc3NhZ2U6IG1lc3NhZ2UsXG4gICAgICAgICAgICBpbmRleDogdG9rZW4uaW5kZXgsXG4gICAgICAgICAgICBzbmlwcGV0OiBbXG4gICAgICAgICAgICAgICAgKHN0YXJ0ID09PSAwID8gJycgOiAnLi4uXFxuJyksXG4gICAgICAgICAgICAgICAgc3Vycm91bmRpbmdTb3VyY2Uuc2xpY2UoMCwgZXJyb3JJbmRleCksXG4gICAgICAgICAgICAgICAgdGVtcGxhdGUoc25pcHBldFRlbXBsYXRlLCBzdXJyb3VuZGluZ1NvdXJjZS5zbGljZShlcnJvckluZGV4LCBlcnJvckluZGV4KzEpKSxcbiAgICAgICAgICAgICAgICBzdXJyb3VuZGluZ1NvdXJjZS5zbGljZShlcnJvckluZGV4ICsgMSkgKyAnJyxcbiAgICAgICAgICAgICAgICAoc3Vycm91bmRpbmdTb3VyY2UubGVuZ3RoIDwgMTAwID8gJycgOiAnLi4uJylcbiAgICAgICAgICAgIF0uam9pbignJylcbiAgICAgICAgfSk7XG5cbiAgICB0aHJvdyBlcnJvck1lc3NhZ2U7XG59XG5cbmZ1bmN0aW9uIGZpbmROZXh0Tm9uRGVsaW1pdGVyKHRva2Vucyl7XG4gICAgdmFyIHJlc3VsdDtcblxuICAgIHdoaWxlKHJlc3VsdCA9IHRva2Vucy5zaGlmdCgpKXtcbiAgICAgICAgaWYoIXJlc3VsdCB8fCByZXN1bHQudHlwZSAhPT0gJ2RlbGltaXRlcicpe1xuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gbGFzdFRva2VuTWF0Y2hlcyhhc3QsIHR5cGVzLCBwb3Ape1xuICAgIHZhciBsYXN0VG9rZW4gPSBhc3RbYXN0Lmxlbmd0aCAtIDFdLFxuICAgICAgICBsYXN0VG9rZW5UeXBlLFxuICAgICAgICBtYXRjaGVkO1xuXG4gICAgaWYoIWxhc3RUb2tlbil7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBsYXN0VG9rZW5UeXBlID0gbGFzdFRva2VuLnR5cGU7XG5cbiAgICBmb3IgKHZhciBpID0gdHlwZXMubGVuZ3RoLTEsIHR5cGUgPSB0eXBlc1tpXTsgaSA+PSAwOyBpLS0sIHR5cGUgPSB0eXBlc1tpXSkge1xuICAgICAgICBpZih0eXBlID09PSAnIScgKyBsYXN0VG9rZW5UeXBlKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKHR5cGUgPT09ICcqJyB8fCB0eXBlID09PSBsYXN0VG9rZW5UeXBlKXtcbiAgICAgICAgICAgIG1hdGNoZWQgPSB0cnVlO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgaWYoIW1hdGNoZWQpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYocG9wKXtcbiAgICAgICAgYXN0LnBvcCgpO1xuICAgIH1cbiAgICByZXR1cm4gbGFzdFRva2VuO1xufVxuXG5mdW5jdGlvbiBwYXJzZUlkZW50aWZpZXIodG9rZW5zLCBhc3Qpe1xuICAgIGlmKHRva2Vuc1swXS50eXBlID09PSAnd29yZCcpe1xuICAgICAgICBhc3QucHVzaCh7XG4gICAgICAgICAgICB0eXBlOiAnaWRlbnRpZmllcicsXG4gICAgICAgICAgICBuYW1lOiB0b2tlbnMuc2hpZnQoKS5zb3VyY2VcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VOdW1iZXIodG9rZW5zLCBhc3Qpe1xuICAgIGlmKHRva2Vuc1swXS50eXBlID09PSAnbnVtYmVyJyl7XG4gICAgICAgIGFzdC5wdXNoKHtcbiAgICAgICAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgICAgICAgdmFsdWU6IHBhcnNlRmxvYXQodG9rZW5zLnNoaWZ0KCkuc291cmNlKVxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBmdW5jdGlvbkNhbGwodGFyZ2V0LCBjb250ZW50KXtcbiAgICByZXR1cm4ge1xuICAgICAgICB0eXBlOiAnZnVuY3Rpb25DYWxsJyxcbiAgICAgICAgdGFyZ2V0OiB0YXJnZXQsXG4gICAgICAgIGNvbnRlbnQ6IGNvbnRlbnRcbiAgICB9O1xufVxuXG5mdW5jdGlvbiBwYXJzZVBhcmVudGhlc2lzKHRva2VucywgYXN0KSB7XG4gICAgaWYodG9rZW5zWzBdLnR5cGUgIT09ICdwYXJlbnRoZXNpc09wZW4nKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBvcGVuVG9rZW4gPSB0b2tlbnNbMF0sXG4gICAgICAgIHBvc2l0aW9uID0gMCxcbiAgICAgICAgb3BlbnMgPSAxO1xuXG4gICAgd2hpbGUoKytwb3NpdGlvbiwgcG9zaXRpb24gPD0gdG9rZW5zLmxlbmd0aCAmJiBvcGVucyl7XG4gICAgICAgIGlmKCF0b2tlbnNbcG9zaXRpb25dKXtcbiAgICAgICAgICAgIHBhcnNlRXJyb3IoJ2ludmFsaWQgbmVzdGluZy4gTm8gY2xvc2luZyB0b2tlbiB3YXMgZm91bmQnLCB0b2tlbnNbcG9zaXRpb24tMV0pO1xuICAgICAgICB9XG4gICAgICAgIGlmKHRva2Vuc1twb3NpdGlvbl0udHlwZSA9PT0gJ3BhcmVudGhlc2lzT3BlbicpIHtcbiAgICAgICAgICAgIG9wZW5zKys7XG4gICAgICAgIH1cbiAgICAgICAgaWYodG9rZW5zW3Bvc2l0aW9uXS50eXBlID09PSAncGFyZW50aGVzaXNDbG9zZScpIHtcbiAgICAgICAgICAgIG9wZW5zLS07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB2YXIgdGFyZ2V0ID0gIW9wZW5Ub2tlbi5kZWxpbWl0ZXJQcmVmaXggJiYgbGFzdFRva2VuTWF0Y2hlcyhhc3QsIFsnKicsICchc3RhdGVtZW50JywgJyFvcGVyYXRvcicsICchc2V0J10sIHRydWUpLFxuICAgICAgICBjb250ZW50ID0gcGFyc2UodG9rZW5zLnNwbGljZSgwLCBwb3NpdGlvbikuc2xpY2UoMSwtMSkpLFxuICAgICAgICBhc3ROb2RlO1xuXG4gICAgaWYodGFyZ2V0KXtcbiAgICAgICAgYXN0Tm9kZSA9IGZ1bmN0aW9uQ2FsbCh0YXJnZXQsIGNvbnRlbnQpO1xuICAgIH1lbHNle1xuICAgICAgICBhc3ROb2RlID0ge1xuICAgICAgICAgICAgdHlwZTogJ3BhcmVudGhlc2lzR3JvdXAnLFxuICAgICAgICAgICAgY29udGVudDogY29udGVudFxuICAgICAgICB9O1xuICAgIH1cblxuICAgIGFzdC5wdXNoKGFzdE5vZGUpO1xuXG4gICAgcmV0dXJuIHRydWU7XG59XG5cbmZ1bmN0aW9uIHBhcnNlUGFyYW1ldGVycyhmdW5jdGlvbkNhbGwpe1xuICAgIHJldHVybiBmdW5jdGlvbkNhbGwuY29udGVudC5tYXAoZnVuY3Rpb24odG9rZW4pe1xuICAgICAgICBpZih0b2tlbi50eXBlID09PSAnaWRlbnRpZmllcicgfHwgKHRva2VuLm5hbWUgPT09ICdzcHJlYWQnICYmIHRva2VuLnJpZ2h0LnR5cGUgPT09ICdpZGVudGlmaWVyJykpe1xuICAgICAgICAgICAgcmV0dXJuIHRva2VuO1xuICAgICAgICB9XG5cbiAgICAgICAgcGFyc2VFcnJvcignVW5leHBlY3RlZCB0b2tlbiBpbiBwYXJhbWV0ZXIgbGlzdCcsIGZ1bmN0aW9uQ2FsbCk7XG4gICAgfSk7XG59XG5cbmZ1bmN0aW9uIG5hbWVkRnVuY3Rpb25FeHByZXNzaW9uKGZ1bmN0aW9uQ2FsbCwgY29udGVudCl7XG4gICAgaWYoZnVuY3Rpb25DYWxsLnRhcmdldC50eXBlICE9PSAnaWRlbnRpZmllcicpe1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgdHlwZTogJ2Z1bmN0aW9uRXhwcmVzc2lvbicsXG4gICAgICAgIGlkZW50aWZpZXI6IGZ1bmN0aW9uQ2FsbC50YXJnZXQsXG4gICAgICAgIHBhcmFtZXRlcnM6IHBhcnNlUGFyYW1ldGVycyhmdW5jdGlvbkNhbGwpLFxuICAgICAgICBjb250ZW50OiBjb250ZW50XG4gICAgfTtcbn1cblxuZnVuY3Rpb24gYW5vbnltb3VzRnVuY3Rpb25FeHByZXNzaW9uKHBhcmVudGhlc2lzR3JvdXAsIGNvbnRlbnQpe1xuICAgIHJldHVybiB7XG4gICAgICAgIHR5cGU6ICdmdW5jdGlvbkV4cHJlc3Npb24nLFxuICAgICAgICBwYXJhbWV0ZXJzOiBwYXJzZVBhcmFtZXRlcnMocGFyZW50aGVzaXNHcm91cCksXG4gICAgICAgIGNvbnRlbnQ6IGNvbnRlbnRcbiAgICB9O1xufVxuXG5mdW5jdGlvbiBwYXJzZUJsb2NrKHRva2VucywgYXN0KXtcbiAgICBpZih0b2tlbnNbMF0udHlwZSAhPT0gJ2JyYWNlT3Blbicpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIHBvc2l0aW9uID0gMCxcbiAgICAgICAgb3BlbnMgPSAxO1xuXG4gICAgd2hpbGUoKytwb3NpdGlvbiwgcG9zaXRpb24gPD0gdG9rZW5zLmxlbmd0aCAmJiBvcGVucyl7XG4gICAgICAgIGlmKCF0b2tlbnNbcG9zaXRpb25dKXtcbiAgICAgICAgICAgIHBhcnNlRXJyb3IoJ2ludmFsaWQgbmVzdGluZy4gTm8gY2xvc2luZyB0b2tlbiB3YXMgZm91bmQnLCB0b2tlbnNbcG9zaXRpb24tMV0pO1xuICAgICAgICB9XG4gICAgICAgIGlmKHRva2Vuc1twb3NpdGlvbl0udHlwZSA9PT0gJ2JyYWNlT3Blbicpe1xuICAgICAgICAgICAgb3BlbnMrKztcbiAgICAgICAgfVxuICAgICAgICBpZih0b2tlbnNbcG9zaXRpb25dLnR5cGUgPT09ICdicmFjZUNsb3NlJyl7XG4gICAgICAgICAgICBvcGVucy0tO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgdmFyIHRhcmdldFRva2VuID0gdG9rZW5zWzBdLFxuICAgICAgICBjb250ZW50ID0gcGFyc2UodG9rZW5zLnNwbGljZSgwLCBwb3NpdGlvbikuc2xpY2UoMSwtMSkpO1xuXG4gICAgdmFyIGZ1bmN0aW9uQ2FsbCA9IGxhc3RUb2tlbk1hdGNoZXMoYXN0LCBbJ2Z1bmN0aW9uQ2FsbCddLCB0cnVlKSxcbiAgICAgICAgcGFyZW50aGVzaXNHcm91cCA9IGxhc3RUb2tlbk1hdGNoZXMoYXN0LCBbJ3BhcmVudGhlc2lzR3JvdXAnXSwgdHJ1ZSksXG4gICAgICAgIGFzdE5vZGU7XG5cbiAgICBpZihmdW5jdGlvbkNhbGwpe1xuICAgICAgICBhc3ROb2RlID0gbmFtZWRGdW5jdGlvbkV4cHJlc3Npb24oZnVuY3Rpb25DYWxsLCBjb250ZW50KTtcbiAgICB9ZWxzZSBpZihwYXJlbnRoZXNpc0dyb3VwKXtcbiAgICAgICAgYXN0Tm9kZSA9IGFub255bW91c0Z1bmN0aW9uRXhwcmVzc2lvbihwYXJlbnRoZXNpc0dyb3VwLCBjb250ZW50KTtcbiAgICB9ZWxzZXtcbiAgICAgICAgYXN0Tm9kZSA9IHtcbiAgICAgICAgICAgIHR5cGU6ICdicmFjZUdyb3VwJyxcbiAgICAgICAgICAgIGNvbnRlbnQ6IGNvbnRlbnRcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBpZighYXN0Tm9kZSl7XG4gICAgICAgIHBhcnNlRXJyb3IoJ3VuZXhwZWN0ZWQgdG9rZW4uJywgdGFyZ2V0VG9rZW4pO1xuICAgIH1cblxuICAgIGFzdC5wdXNoKGFzdE5vZGUpO1xuXG4gICAgcmV0dXJuIHRydWU7XG59XG5cbmZ1bmN0aW9uIHBhcnNlU2V0KHRva2VucywgYXN0KSB7XG4gICAgaWYodG9rZW5zWzBdLnR5cGUgIT09ICdzcXVhcmVCcmFjZU9wZW4nKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBvcGVuVG9rZW4gPSB0b2tlbnNbMF0sXG4gICAgICAgIHBvc2l0aW9uID0gMCxcbiAgICAgICAgb3BlbnMgPSAxO1xuXG4gICAgd2hpbGUoKytwb3NpdGlvbiwgcG9zaXRpb24gPD0gdG9rZW5zLmxlbmd0aCAmJiBvcGVucyl7XG4gICAgICAgIGlmKCF0b2tlbnNbcG9zaXRpb25dKXtcbiAgICAgICAgICAgIHBhcnNlRXJyb3IoJ2ludmFsaWQgbmVzdGluZy4gTm8gY2xvc2luZyB0b2tlbiB3YXMgZm91bmQnLCB0b2tlbnNbcG9zaXRpb24tMV0pO1xuICAgICAgICB9XG4gICAgICAgIGlmKHRva2Vuc1twb3NpdGlvbl0udHlwZSA9PT0gJ3NxdWFyZUJyYWNlT3BlbicpIHtcbiAgICAgICAgICAgIG9wZW5zKys7XG4gICAgICAgIH1cbiAgICAgICAgaWYodG9rZW5zW3Bvc2l0aW9uXS50eXBlID09PSAnc3F1YXJlQnJhY2VDbG9zZScpIHtcbiAgICAgICAgICAgIG9wZW5zLS07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB2YXIgY29udGVudCA9IHBhcnNlKHRva2Vucy5zcGxpY2UoMCwgcG9zaXRpb24pLnNsaWNlKDEsLTEpKSxcbiAgICAgICAgdGFyZ2V0ID0gIW9wZW5Ub2tlbi5kZWxpbWl0ZXJQcmVmaXggJiYgbGFzdFRva2VuTWF0Y2hlcyhhc3QsIFsnKicsICchZnVuY3Rpb25FeHByZXNzaW9uJywgJyFicmFjZUdyb3VwJywgJyFzdGF0ZW1lbnQnLCAnIW9wZXJhdG9yJ10sIHRydWUpO1xuXG4gICAgaWYodGFyZ2V0KXtcbiAgICAgICAgYXN0LnB1c2goe1xuICAgICAgICAgICAgdHlwZTogJ2FjY2Vzc29yJyxcbiAgICAgICAgICAgIHRhcmdldDogdGFyZ2V0LFxuICAgICAgICAgICAgY29udGVudDogY29udGVudFxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBhc3QucHVzaCh7XG4gICAgICAgIHR5cGU6ICdzZXQnLFxuICAgICAgICBjb250ZW50OiBjb250ZW50XG4gICAgfSk7XG5cbiAgICByZXR1cm4gdHJ1ZTtcbn1cblxuXG5mdW5jdGlvbiBwYXJzZURlbGltaXRlcnModG9rZW5zKXtcbiAgICBpZih0b2tlbnNbMF0udHlwZSA9PT0gJ2RlbGltaXRlcicpe1xuICAgICAgICB0b2tlbnMuc3BsaWNlKDAsMSk7XG4gICAgICAgIGlmKHRva2Vuc1swXSl7XG4gICAgICAgICAgICB0b2tlbnNbMF0uZGVsaW1pdGVyUHJlZml4ID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlQ29tbWVudHModG9rZW5zKXtcbiAgICBpZih0b2tlbnNbMF0udHlwZSA9PT0gJ2NvbW1lbnQnKXtcbiAgICAgICAgdG9rZW5zLnNoaWZ0KCk7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VPcGVyYXRvcih0b2tlbnMsIGFzdCl7XG4gICAgaWYodG9rZW5zWzBdLnR5cGUgPT09ICdvcGVyYXRvcicpe1xuICAgICAgICB2YXIgdG9rZW4gPSB0b2tlbnMuc2hpZnQoKSxcbiAgICAgICAgICAgIG9wZXJhdG9yc0ZvclNvdXJjZSA9IG9wZXJhdG9yc1t0b2tlbi5zb3VyY2VdLFxuICAgICAgICAgICAgc3RhcnRPZlN0YXRlbWVudCA9ICFsYXN0VG9rZW5NYXRjaGVzKGFzdCwgWycqJywgJyFzdGF0ZW1lbnQnLCAnIW9wZXJhdG9yJ10pO1xuXG4gICAgICAgIGlmKG9wZXJhdG9yc0ZvclNvdXJjZS5iaW5hcnkgJiYgIXN0YXJ0T2ZTdGF0ZW1lbnQgJiZcbiAgICAgICAgICAgICEoXG4gICAgICAgICAgICAgICAgb3BlcmF0b3JzRm9yU291cmNlLnVuYXJ5ICYmXG4gICAgICAgICAgICAgICAgKFxuICAgICAgICAgICAgICAgICAgICB0b2tlbi5kZWxpbWl0ZXJQcmVmaXggJiZcbiAgICAgICAgICAgICAgICAgICAgdG9rZW5zWzBdLnR5cGUgIT09ICdkZWxpbWl0ZXInXG4gICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKVxuICAgICAgICApe1xuICAgICAgICAgICAgYXN0LnB1c2goe1xuICAgICAgICAgICAgICAgIHR5cGU6ICdvcGVyYXRvcicsXG4gICAgICAgICAgICAgICAgbmFtZTogb3BlcmF0b3JzRm9yU291cmNlLmJpbmFyeS5uYW1lLFxuICAgICAgICAgICAgICAgIG9wZXJhdG9yOiBvcGVyYXRvcnNGb3JTb3VyY2UuYmluYXJ5LFxuICAgICAgICAgICAgICAgIHNvdXJjZVJlZjogdG9rZW4uc291cmNlUmVmLFxuICAgICAgICAgICAgICAgIGluZGV4OiB0b2tlbi5pbmRleFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKG9wZXJhdG9yc0ZvclNvdXJjZS51bmFyeSl7XG4gICAgICAgICAgICBhc3QucHVzaCh7XG4gICAgICAgICAgICAgICAgdHlwZTogJ29wZXJhdG9yJyxcbiAgICAgICAgICAgICAgICBuYW1lOiBvcGVyYXRvcnNGb3JTb3VyY2UudW5hcnkubmFtZSxcbiAgICAgICAgICAgICAgICBvcGVyYXRvcjogb3BlcmF0b3JzRm9yU291cmNlLnVuYXJ5LFxuICAgICAgICAgICAgICAgIHNvdXJjZVJlZjogdG9rZW4uc291cmNlUmVmLFxuICAgICAgICAgICAgICAgIGluZGV4OiB0b2tlbi5pbmRleFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuXG5cbiAgICAgICAgaWYob3BlcmF0b3JzRm9yU291cmNlLnRyaW5hcnkgJiYgIXN0YXJ0T2ZTdGF0ZW1lbnQpe1xuICAgICAgICAgICAgYXN0LnB1c2goe1xuICAgICAgICAgICAgICAgIHR5cGU6ICdvcGVyYXRvcicsXG4gICAgICAgICAgICAgICAgbmFtZTogb3BlcmF0b3JzRm9yU291cmNlLnRyaW5hcnkubmFtZSxcbiAgICAgICAgICAgICAgICBvcGVyYXRvcjogb3BlcmF0b3JzRm9yU291cmNlLnRyaW5hcnksXG4gICAgICAgICAgICAgICAgc291cmNlUmVmOiB0b2tlbi5zb3VyY2VSZWYsXG4gICAgICAgICAgICAgICAgaW5kZXg6IHRva2VuLmluZGV4XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgcGFyc2VFcnJvcignVW5leHBlY3RlZCB0b2tlbicsIHRva2VuKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlUGVyaW9kKHRva2VucywgYXN0KXtcbiAgICBpZih0b2tlbnNbMF0udHlwZSA9PT0gJ3BlcmlvZCcpe1xuICAgICAgICB2YXIgdG9rZW4gPSB0b2tlbnMuc2hpZnQoKSxcbiAgICAgICAgICAgIHJpZ2h0ID0gZmluZE5leHROb25EZWxpbWl0ZXIodG9rZW5zKTtcblxuICAgICAgICBpZighcmlnaHQpe1xuICAgICAgICAgICAgcmV0dXJuIHBhcnNlRXJyb3IoJ1VuZXhwZWN0ZWQgdG9rZW4nLCB0b2tlbik7XG4gICAgICAgIH1cblxuICAgICAgICBhc3QucHVzaCh7XG4gICAgICAgICAgICB0eXBlOiAncGVyaW9kJyxcbiAgICAgICAgICAgIGxlZnQ6IGFzdC5wb3AoKSxcbiAgICAgICAgICAgIHJpZ2h0OiBwYXJzZVRva2VuKFtyaWdodF0pLnBvcCgpXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VDb21tYSh0b2tlbnMsIGFzdCl7XG4gICAgaWYodG9rZW5zWzBdLnR5cGUgPT09ICdjb21tYScpe1xuICAgICAgICB0b2tlbnMuc2hpZnQoKTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZVN0cmluZyh0b2tlbnMsIGFzdCl7XG4gICAgaWYodG9rZW5zWzBdLnR5cGUgPT09ICdzdHJpbmcnKXtcbiAgICAgICAgYXN0LnB1c2goe1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICB2YWx1ZTogSlNPTi5wYXJzZSgnXCInICsgdG9rZW5zLnNoaWZ0KCkuc291cmNlLnNsaWNlKDEsLTEpICsgJ1wiJylcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VTZW1pY29sb24odG9rZW5zLCBhc3Qpe1xuICAgIGlmKHRva2Vuc1swXS50eXBlID09PSAnc2VtaWNvbG9uJyl7XG4gICAgICAgIHRva2Vucy5zaGlmdCgpO1xuICAgICAgICBhc3QucHVzaCh7XG4gICAgICAgICAgICB0eXBlOiAnc3RhdGVtZW50JyxcbiAgICAgICAgICAgIGNvbnRlbnQ6IFthc3QucG9wKCldXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG59XG5cbnZhciBwYXJzZXJzID0gW1xuICAgIHBhcnNlRGVsaW1pdGVycyxcbiAgICBwYXJzZUNvbW1lbnRzLFxuICAgIHBhcnNlTnVtYmVyLFxuICAgIHBhcnNlU3RyaW5nLFxuICAgIHBhcnNlSWRlbnRpZmllcixcbiAgICBwYXJzZUNvbW1hLFxuICAgIHBhcnNlUGVyaW9kLFxuICAgIHBhcnNlUGFyZW50aGVzaXMsXG4gICAgcGFyc2VTZXQsXG4gICAgcGFyc2VCbG9jayxcbiAgICBwYXJzZU9wZXJhdG9yLFxuICAgIHBhcnNlU2VtaWNvbG9uXG5dO1xuXG5mdW5jdGlvbiBwYXJzZU9wZXJhdG9ycyhhc3Qpe1xuICAgIHN0YWJsZVNvcnQoYXN0LmZpbHRlcihmdW5jdGlvbih0b2tlbil7XG4gICAgICAgIHJldHVybiB0b2tlbi50eXBlID09PSAnb3BlcmF0b3InO1xuICAgIH0pLCBmdW5jdGlvbihhLGIpe1xuICAgICAgICBpZihhLm9wZXJhdG9yLnByZWNlZGVuY2UgPT09IGIub3BlcmF0b3IucHJlY2VkZW5jZSAmJiBhLm9wZXJhdG9yLmFzc29jaWF0aXZpdHkgPT09ICdyaWdodCcpe1xuICAgICAgICAgICAgcmV0dXJuIDE7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYi5vcGVyYXRvci5wcmVjZWRlbmNlIC0gYS5vcGVyYXRvci5wcmVjZWRlbmNlO1xuICAgIH0pXG4gICAgLmZvckVhY2goZnVuY3Rpb24odG9rZW4pe1xuICAgICAgICB2YXIgaW5kZXggPSBhc3QuaW5kZXhPZih0b2tlbiksXG4gICAgICAgICAgICBvcGVyYXRvciA9IHRva2VuLm9wZXJhdG9yLFxuICAgICAgICAgICAgbGVmdCxcbiAgICAgICAgICAgIG1pZGRsZSxcbiAgICAgICAgICAgIHJpZ2h0O1xuXG4gICAgICAgIC8vIFRva2VuIHdhcyBwYXJzZWQgYnkgc29tZSBvdGhlciBwYXJzZXIgc3RlcC5cbiAgICAgICAgaWYoIX5pbmRleCl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZihvcGVyYXRvci50cmluYXJ5KXtcbiAgICAgICAgICAgIGxlZnQgPSBhc3Quc3BsaWNlKGluZGV4LTEsMSk7XG4gICAgICAgICAgICBtaWRkbGUgPSBhc3Quc3BsaWNlKGluZGV4LDEpO1xuICAgICAgICAgICAgdmFyIHRyaW5hcnkgPSBhc3Quc3BsaWNlKGluZGV4LDEpO1xuICAgICAgICAgICAgcmlnaHQgPSBhc3Quc3BsaWNlKGluZGV4LDEpO1xuICAgICAgICAgICAgaWYoIXRyaW5hcnkubGVuZ3RoIHx8IHRyaW5hcnlbMF0ubmFtZSAhPT0gb3BlcmF0b3IudHJpbmFyeSl7XG4gICAgICAgICAgICAgICAgcGFyc2VFcnJvcignVW5leHBlY3RlZCB0b2tlbi4nLCB0b2tlbik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1lbHNlIGlmKG9wZXJhdG9yLmRpcmVjdGlvbiA9PT0gJ2xlZnQnKXtcbiAgICAgICAgICAgIGxlZnQgPSBhc3Quc3BsaWNlKGluZGV4LTEsMSk7XG4gICAgICAgIH1lbHNlIGlmKG9wZXJhdG9yLmRpcmVjdGlvbiA9PT0gJ3JpZ2h0Jyl7XG4gICAgICAgICAgICByaWdodCA9IGFzdC5zcGxpY2UoaW5kZXggKyAxLDEpO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIGxlZnQgPSBhc3Quc3BsaWNlKGluZGV4LTEsMSk7XG4gICAgICAgICAgICByaWdodCA9IGFzdC5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoXG4gICAgICAgICAgICBsZWZ0ICYmIGxlZnQubGVuZ3RoICE9PSAxIHx8XG4gICAgICAgICAgICBtaWRkbGUgJiYgbWlkZGxlLmxlbmd0aCAhPT0gMSB8fFxuICAgICAgICAgICAgcmlnaHQgJiYgcmlnaHQubGVuZ3RoICE9PSAxXG4gICAgICAgICl7XG4gICAgICAgICAgICBwYXJzZUVycm9yKCd1bmV4cGVjdGVkIHRva2VuLicsIHRva2VuKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKG9wZXJhdG9yLm5hbWUgPT09ICdhc3NpZ25tZW50JyAmJiBsZWZ0WzBdLnR5cGUgIT09ICdpZGVudGlmaWVyJyl7XG4gICAgICAgICAgICBwYXJzZUVycm9yKCdVbmV4cGVjdGVkIHRva2VuLicsIHRva2VuKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGxlZnQpe1xuICAgICAgICAgICAgdG9rZW4ubGVmdCA9IGxlZnRbMF07XG4gICAgICAgIH1cbiAgICAgICAgaWYobWlkZGxlKXtcbiAgICAgICAgICAgIHRva2VuLm1pZGRsZSA9IG1pZGRsZVswXTtcbiAgICAgICAgfVxuICAgICAgICBpZihyaWdodCl7XG4gICAgICAgICAgICB0b2tlbi5yaWdodCA9IHJpZ2h0WzBdO1xuICAgICAgICB9XG4gICAgfSk7XG59XG5cbmZ1bmN0aW9uIHBhcnNlVG9rZW4odG9rZW5zLCBhc3Qpe1xuICAgIGlmKCFhc3Qpe1xuICAgICAgICBhc3QgPSBbXTtcbiAgICB9XG5cbiAgICBmb3IodmFyIGkgPSAwOyBpIDw9IHBhcnNlcnMubGVuZ3RoICYmIHRva2Vucy5sZW5ndGg7IGkrKyl7XG4gICAgICAgIGlmKGkgPT09IHBhcnNlcnMubGVuZ3RoICYmIHRva2Vucy5sZW5ndGgpe1xuICAgICAgICAgICAgcGFyc2VFcnJvcigndW5rbm93biB0b2tlbicsIHRva2Vuc1swXSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZihwYXJzZXJzW2ldKHRva2VucywgYXN0KSl7XG4gICAgICAgICAgICByZXR1cm4gYXN0O1xuICAgICAgICB9XG4gICAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZSh0b2tlbnMsIG11dGF0ZSl7XG4gICAgdmFyIGFzdCA9IFtdO1xuXG4gICAgaWYoIW11dGF0ZSl7XG4gICAgICAgIHRva2VucyA9IHRva2Vucy5zbGljZSgpO1xuICAgIH1cblxuICAgIHdoaWxlKHRva2Vucy5sZW5ndGgpe1xuICAgICAgICBwYXJzZVRva2VuKHRva2VucywgYXN0KTtcbiAgICB9XG5cbiAgICBwYXJzZU9wZXJhdG9ycyhhc3QpO1xuXG4gICAgcmV0dXJuIGFzdDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBwYXJzZTsiLCJ2YXIgdG9WYWx1ZSA9IHJlcXVpcmUoJy4vdG9WYWx1ZScpO1xuXG5mdW5jdGlvbiB3cmFwU2NvcGUoX19zY29wZV9fKXtcbiAgICB2YXIgc2NvcGUgPSBuZXcgU2NvcGUoKTtcbiAgICBzY29wZS5fX3Njb3BlX18gPSBfX3Njb3BlX187XG4gICAgcmV0dXJuIHNjb3BlO1xufVxuXG5mdW5jdGlvbiBTY29wZShvbGRTY29wZSwgZGVidWcpe1xuICAgIHRoaXMuX19zY29wZV9fID0ge307XG4gICAgdGhpcy5fZGVidWcgPSBkZWJ1ZztcbiAgICBpZihvbGRTY29wZSl7XG4gICAgICAgIHRoaXMuX19vdXRlclNjb3BlX18gPSBvbGRTY29wZSBpbnN0YW5jZW9mIFNjb3BlID8gb2xkU2NvcGUgOiB3cmFwU2NvcGUob2xkU2NvcGUpO1xuICAgICAgICB0aGlzLl9kZWJ1ZyA9IHRoaXMuX19vdXRlclNjb3BlX18uX2RlYnVnO1xuICAgIH1cbn1cblNjb3BlLnByb3RvdHlwZS50aHJvdyA9IGZ1bmN0aW9uKG1lc3NhZ2Upe1xuICAgIHRoaXMuX2Vycm9yID0gbmV3IEVycm9yKCdQcmVzaCBleGVjdXRpb24gZXJyb3I6ICcgKyBtZXNzYWdlKTtcbiAgICB0aGlzLl9lcnJvci5zY29wZSA9IHRoaXM7XG59O1xuU2NvcGUucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKGtleSl7XG4gICAgdmFyIHNjb3BlID0gdGhpcztcbiAgICB3aGlsZShzY29wZSAmJiAhT2JqZWN0Lmhhc093blByb3BlcnR5LmNhbGwoc2NvcGUuX19zY29wZV9fLCBrZXkpKXtcbiAgICAgICAgc2NvcGUgPSBzY29wZS5fX291dGVyU2NvcGVfXztcbiAgICB9XG4gICAgcmV0dXJuIHNjb3BlICYmIHRvVmFsdWUudmFsdWUoc2NvcGUuX19zY29wZV9fW2tleV0sIHRoaXMpO1xufTtcblNjb3BlLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbihrZXksIHZhbHVlLCBidWJibGUpe1xuICAgIGlmKGJ1YmJsZSl7XG4gICAgICAgIHZhciBjdXJyZW50U2NvcGUgPSB0aGlzO1xuICAgICAgICB3aGlsZShjdXJyZW50U2NvcGUgJiYgIShrZXkgaW4gY3VycmVudFNjb3BlLl9fc2NvcGVfXykpe1xuICAgICAgICAgICAgY3VycmVudFNjb3BlID0gY3VycmVudFNjb3BlLl9fb3V0ZXJTY29wZV9fO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoY3VycmVudFNjb3BlKXtcbiAgICAgICAgICAgIGN1cnJlbnRTY29wZS5zZXQoa2V5LCB2YWx1ZSk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5fX3Njb3BlX19ba2V5XSA9IHRvVmFsdWUodmFsdWUsIHRoaXMpO1xuICAgIHJldHVybiB0aGlzO1xufTtcblNjb3BlLnByb3RvdHlwZS5kZWZpbmUgPSBmdW5jdGlvbihvYmope1xuICAgIGZvcih2YXIga2V5IGluIG9iail7XG4gICAgICAgIHRoaXMuX19zY29wZV9fW2tleV0gPSB0b1ZhbHVlKG9ialtrZXldLCB0aGlzKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXM7XG59O1xuU2NvcGUucHJvdG90eXBlLmlzRGVmaW5lZCA9IGZ1bmN0aW9uKGtleSl7XG4gICAgaWYoa2V5IGluIHRoaXMuX19zY29wZV9fKXtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLl9fb3V0ZXJTY29wZV9fICYmIHRoaXMuX19vdXRlclNjb3BlX18uaXNEZWZpbmVkKGtleSkgfHwgZmFsc2U7XG59O1xuU2NvcGUucHJvdG90eXBlLmhhc0Vycm9yID0gZnVuY3Rpb24oKXtcbiAgICByZXR1cm4gdGhpcy5fZXJyb3I7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNjb3BlOyIsInZhciB2ID0ge307XG5cbmZ1bmN0aW9uIGlzVmFsdWUodmFsdWUpe1xuICAgIHJldHVybiB2YWx1ZSAmJiB2YWx1ZS5fdmFsdWUgPT09IHY7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gdG9WYWx1ZSh2YWx1ZSwgc2NvcGUsIGNvbnRleHQpe1xuICAgIGlmKHNjb3BlLl9lcnJvcil7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBlcnJvcjogc2NvcGUuX2Vycm9yXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgaWYoaXNWYWx1ZSh2YWx1ZSkpe1xuICAgICAgICBpZih0eXBlb2YgY29udGV4dCA9PT0gJ29iamVjdCcgfHwgdHlwZW9mIGNvbnRleHQgPT09ICdmdW5jdGlvbicpe1xuICAgICAgICAgICAgdmFsdWUuY29udGV4dCA9IGNvbnRleHQ7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIHR5cGU6ICd2YWx1ZScsXG4gICAgICAgIGNvbnRleHQ6IGNvbnRleHQsXG4gICAgICAgIHZhbHVlOiB2YWx1ZSxcbiAgICAgICAgX3ZhbHVlOiB2XG4gICAgfTtcbn07XG5cbm1vZHVsZS5leHBvcnRzLmlzVmFsdWUgPSBpc1ZhbHVlO1xuXG5tb2R1bGUuZXhwb3J0cy52YWx1ZSA9IGZ1bmN0aW9uKHZhbHVlKXtcbiAgICByZXR1cm4gaXNWYWx1ZSh2YWx1ZSkgPyB2YWx1ZS52YWx1ZSA6IHZhbHVlO1xufTsiXX0=
