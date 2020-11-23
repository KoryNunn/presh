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
    printError = require('./printError'),
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
        scope.throw(printError('target is not an object', token.sourceToken));
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
},{"./printError":14,"./scope":15,"./toValue":16,"is-instance":9}],3:[function(require,module,exports){
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
    math: Math,
    isNaN: isNaN
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
    var match = source.match(/^[\s\n,]+/);

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
            throw new Error('Syntax error: Unable to determine next token in source: ' + source.slice(0, 100));
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
    stableSort = require('stable'),
    printError = require('./printError');

function parseError(message, token){
    throw printError(message, token);
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
            sourceToken: tokens[0],
            type: 'identifier',
            name: tokens.shift().source
        });
        return true;
    }
}

function parseNumber(tokens, ast){
    if(tokens[0].type === 'number'){
        ast.push({
            sourceToken: tokens[0],
            type: 'number',
            value: parseFloat(tokens.shift().source)
        });
        return true;
    }
}

function functionCall(target, content){
    return {
        sourceToken: target,
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
            sourceToken: openToken,
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

function namedFunctionExpression(sourceToken, functionCall, content){
    if(functionCall.target.type !== 'identifier'){
        return false;
    }

    return {
        sourceToken,
        type: 'functionExpression',
        identifier: functionCall.target,
        parameters: parseParameters(functionCall),
        content: content
    };
}

function anonymousFunctionExpression(sourceToken, parenthesisGroup, content){
    return {
        sourceToken,
        type: 'functionExpression',
        parameters: parseParameters(parenthesisGroup),
        content: content
    };
}

function parseBlock(tokens, ast){
    if(tokens[0].type !== 'braceOpen'){
        return;
    }

    var wasDelimiterPrefixed = tokens[0].delimiterPrefix,
        position = 0,
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

    var functionCall = !wasDelimiterPrefixed && lastTokenMatches(ast, ['functionCall'], true),
        parenthesisGroup = !wasDelimiterPrefixed && lastTokenMatches(ast, ['parenthesisGroup'], true),
        astNode;

    if(functionCall){
        astNode = namedFunctionExpression(targetToken, functionCall, content);
    }else if(parenthesisGroup){
        astNode = anonymousFunctionExpression(targetToken, parenthesisGroup, content);
    }else{
        astNode = {
            sourceToken: targetToken,
            type: 'braceGroup',
            content: content
        }
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
            sourceToken: openToken,
            type: 'accessor',
            target: target,
            content: content
        });

        return true;
    }

    ast.push({
        sourceToken: openToken,
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
                sourceToken: token,
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
                sourceToken: token,
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
                sourceToken: token,
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
            sourceToken: token,
            type: 'period',
            left: ast.pop(),
            right: parseToken([right]).pop()
        });

        return true;
    }
}

function parseString(tokens, ast){
    if(tokens[0].type === 'string'){
        ast.push({
            sourceToken: tokens[0],
            type: 'string',
            value: JSON.parse('"' + tokens.shift().source.slice(1,-1) + '"')
        });
        return true;
    }
}

function parseSemicolon(tokens, ast){
    if(tokens[0].type === 'semicolon'){
        ast.push({
            sourceToken: tokens.shift(),
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
},{"./operators":12,"./printError":14,"stable":10}],14:[function(require,module,exports){
var template = require('string-template'),
    errorTemplate = 'Parse error,\n{message},\nAt {index} "{snippet}"',
    snippetTemplate = '-->{0}<--';

function printError(message, token){
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

    return errorMessage;
}

module.exports = printError;
},{"string-template":11}],15:[function(require,module,exports){
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
},{"./toValue":16}],16:[function(require,module,exports){
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJleGFtcGxlL2luZGV4LmpzIiwiZXhlY3V0ZS5qcyIsImdsb2JhbC5qcyIsImluZGV4LmpzIiwibGV4LmpzIiwibm9kZV9tb2R1bGVzL2NyZWwvY3JlbC5qcyIsIm5vZGVfbW9kdWxlcy9kZWJvdW5jZS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9mbGF0LW1lcmdlL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2lzLWluc3RhbmNlL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3N0YWJsZS9zdGFibGUuanMiLCJub2RlX21vZHVsZXMvc3RyaW5nLXRlbXBsYXRlL2luZGV4LmpzIiwib3BlcmF0b3JzLmpzIiwicGFyc2UuanMiLCJwcmludEVycm9yLmpzIiwic2NvcGUuanMiLCJ0b1ZhbHVlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM1VBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEtBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hCQTtBQUNBO0FBQ0E7O0FDRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3R0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN1JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZkQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbigpe2Z1bmN0aW9uIHIoZSxuLHQpe2Z1bmN0aW9uIG8oaSxmKXtpZighbltpXSl7aWYoIWVbaV0pe3ZhciBjPVwiZnVuY3Rpb25cIj09dHlwZW9mIHJlcXVpcmUmJnJlcXVpcmU7aWYoIWYmJmMpcmV0dXJuIGMoaSwhMCk7aWYodSlyZXR1cm4gdShpLCEwKTt2YXIgYT1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK2krXCInXCIpO3Rocm93IGEuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixhfXZhciBwPW5baV09e2V4cG9ydHM6e319O2VbaV1bMF0uY2FsbChwLmV4cG9ydHMsZnVuY3Rpb24ocil7dmFyIG49ZVtpXVsxXVtyXTtyZXR1cm4gbyhufHxyKX0scCxwLmV4cG9ydHMscixlLG4sdCl9cmV0dXJuIG5baV0uZXhwb3J0c31mb3IodmFyIHU9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZSxpPTA7aTx0Lmxlbmd0aDtpKyspbyh0W2ldKTtyZXR1cm4gb31yZXR1cm4gcn0pKCkiLCJ2YXIgcHJlc2ggPSByZXF1aXJlKCcuLi8nKSxcbiAgICBkZWJvdW5jZSA9IHJlcXVpcmUoJ2RlYm91bmNlJyksXG4gICAgY3JlbCA9IHJlcXVpcmUoJ2NyZWwnKTtcblxudmFyIGRlZmF1bHRTY29wZSA9IFwieyBhOiAxMCwgYjogMjAsIGZvbzogZnVuY3Rpb24oaW5wdXQpeyByZXR1cm4gaW5wdXQgKyAnIFdvcmxkJ319XCJcbnZhciBkZWZhdWx0Q29kZSA9IGBiYXIoeCl7XG4gICAgeCA+IGEgJiYgeCA8IGIgPyBmb28oeCkgOiBmb28oJ0hlbGxvJyk7XG59XG5cbltiYXIoMTMpIGJhcig4KV1gXG5cbnZhciBzY29wZUlucHV0LCBjb2RlSW5wdXQsIG91dHB1dCwgdWkgPSBjcmVsKCdkaXYnLFxuICAgICAgICBjcmVsKCdoMicsICdTY29wZTonKSxcbiAgICAgICAgc2NvcGVJbnB1dCA9IGNyZWwoJ3ByZScsIHsnY29udGVudGVkaXRhYmxlJzogdHJ1ZX0sIGRlZmF1bHRTY29wZSksXG4gICAgICAgIGNyZWwoJ2gyJywgJ0lucHV0OicpLFxuICAgICAgICBjb2RlSW5wdXQgPSBjcmVsKCdwcmUnLCB7J2NvbnRlbnRlZGl0YWJsZSc6IHRydWV9LCBkZWZhdWx0Q29kZSksXG4gICAgICAgIGNyZWwoJ2gyJywgJ091dHB1dDonKSxcbiAgICAgICAgb3V0cHV0ID0gY3JlbCgnZGl2JylcbiAgICApO1xuXG52YXIgdXBkYXRlID0gZGVib3VuY2UoZnVuY3Rpb24oKXtcblxuICAgIHZhciBzY29wZSA9IHt9O1xuXG4gICAgIHRyeXtcbiAgICAgICAgc2NvcGUgPSBzY29wZUlucHV0LnRleHRDb250ZW50ID8gZXZhbCgnKCcgKyBzY29wZUlucHV0LnRleHRDb250ZW50ICsgJyknKSA6IHNjb3BlO1xuICAgICAgICBzY29wZUlucHV0LnJlbW92ZUF0dHJpYnV0ZSgnZXJyb3InKTtcbiAgICB9Y2F0Y2goZXJyb3Ipe1xuICAgICAgICBzY29wZUlucHV0LnNldEF0dHJpYnV0ZSgnZXJyb3InLCBlcnJvcik7XG4gICAgfVxuXG4gICAgdHJ5e1xuICAgICAgICB2YXIgcmVzdWx0ID0gcHJlc2goY29kZUlucHV0LnRleHRDb250ZW50LCBzY29wZSk7XG5cbiAgICAgICAgb3V0cHV0LnRleHRDb250ZW50ID0gcmVzdWx0LmVycm9yIHx8IEpTT04uc3RyaW5naWZ5KHJlc3VsdC52YWx1ZSwgbnVsbCwgNCk7XG4gICAgICAgIGNvZGVJbnB1dC5yZW1vdmVBdHRyaWJ1dGUoJ2Vycm9yJyk7XG4gICAgfWNhdGNoKGVycm9yKXtcbiAgICAgICAgY29kZUlucHV0LnNldEF0dHJpYnV0ZSgnZXJyb3InLCBlcnJvcik7XG4gICAgfVxufSk7XG51cGRhdGUoKTtcblxuc2NvcGVJbnB1dC5hZGRFdmVudExpc3RlbmVyKCdrZXl1cCcsIHVwZGF0ZSk7XG5jb2RlSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcigna2V5dXAnLCB1cGRhdGUpO1xuXG5mdW5jdGlvbiB0YWIoZXZlbnQpe1xuICAgIGlmKGV2ZW50LndoaWNoID09PSA5KXtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcblxuICAgICAgICB2YXIgc2VsZWN0aW9uID0gZG9jdW1lbnQuZ2V0U2VsZWN0aW9uKCksXG4gICAgICAgICAgICByYW5nZSA9IHNlbGVjdGlvbi5nZXRSYW5nZUF0KDApLFxuICAgICAgICAgICAgdGFiTm9kZSA9IGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKCcgICAgJyk7XG5cbiAgICAgICAgcmFuZ2UuaW5zZXJ0Tm9kZSh0YWJOb2RlKTtcbiAgICAgICAgcmFuZ2Uuc2V0U3RhcnRBZnRlcih0YWJOb2RlKTtcbiAgICAgICAgcmFuZ2Uuc2V0RW5kQWZ0ZXIodGFiTm9kZSk7XG4gICAgICAgIHNlbGVjdGlvbi5yZW1vdmVBbGxSYW5nZXMoKTtcbiAgICAgICAgc2VsZWN0aW9uLmFkZFJhbmdlKHJhbmdlKTtcbiAgICB9XG59XG5cbnNjb3BlSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIHRhYik7XG5jb2RlSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIHRhYik7XG5cbndpbmRvdy5vbmxvYWQgPSBmdW5jdGlvbigpe1xuICAgIGNyZWwoZG9jdW1lbnQuYm9keSwgdWkpO1xufTsiLCJ2YXIgU2NvcGUgPSByZXF1aXJlKCcuL3Njb3BlJyksXG4gICAgdG9WYWx1ZSA9IHJlcXVpcmUoJy4vdG9WYWx1ZScpLFxuICAgIGlzSW5zdGFuY2UgPSByZXF1aXJlKCdpcy1pbnN0YW5jZScpLFxuICAgIHByaW50RXJyb3IgPSByZXF1aXJlKCcuL3ByaW50RXJyb3InKSxcbiAgICBwcmVzaEZ1bmN0aW9ucyA9IG5ldyBXZWFrTWFwKCk7XG5cbnZhciByZXNlcnZlZEtleXdvcmRzID0ge1xuICAgICd0cnVlJzogdHJ1ZSxcbiAgICAnZmFsc2UnOiBmYWxzZSxcbiAgICAnbnVsbCc6IG51bGwsXG4gICAgJ3VuZGVmaW5lZCc6IHVuZGVmaW5lZFxufTtcblxuZnVuY3Rpb24gcmVzb2x2ZVNwcmVhZHMoY29udGVudCwgc2NvcGUpe1xuICAgIHZhciByZXN1bHQgPSBbXTtcblxuICAgIGNvbnRlbnQuZm9yRWFjaChmdW5jdGlvbih0b2tlbil7XG5cbiAgICAgICAgaWYodG9rZW4ubmFtZSA9PT0gJ3NwcmVhZCcpe1xuICAgICAgICAgICAgcmVzdWx0LnB1c2guYXBwbHkocmVzdWx0LCBleGVjdXRlVG9rZW4odG9rZW4sIHNjb3BlKS52YWx1ZSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICByZXN1bHQucHVzaChleGVjdXRlVG9rZW4odG9rZW4sIHNjb3BlKS52YWx1ZSk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiBmdW5jdGlvbkNhbGwodG9rZW4sIHNjb3BlKXtcbiAgICB2YXIgZnVuY3Rpb25Ub2tlbiA9IGV4ZWN1dGVUb2tlbih0b2tlbi50YXJnZXQsIHNjb3BlKSxcbiAgICAgICAgZm4gPSBmdW5jdGlvblRva2VuLnZhbHVlO1xuXG4gICAgaWYodHlwZW9mIGZuICE9PSAnZnVuY3Rpb24nKXtcbiAgICAgICAgc2NvcGUudGhyb3coZm4gKyAnIGlzIG5vdCBhIGZ1bmN0aW9uJyk7XG4gICAgfVxuXG4gICAgaWYoc2NvcGUuaGFzRXJyb3IoKSl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZihwcmVzaEZ1bmN0aW9ucy5oYXMoZm4pKXtcbiAgICAgICAgdmFyIHJlc3VsdCA9IHByZXNoRnVuY3Rpb25zLmdldChmbikuYXBwbHkoZnVuY3Rpb25Ub2tlbi5jb250ZXh0LCByZXNvbHZlU3ByZWFkcyh0b2tlbi5jb250ZW50LCBzY29wZSkpO1xuXG4gICAgICAgIGlmKHJlc3VsdC5lcnJvcil7XG4gICAgICAgICAgICBzY29wZS50aHJvdyhyZXN1bHQuZXJyb3IpXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVzdWx0LnZhbHVlO1xuICAgIH1cblxuICAgIHRyeXtcbiAgICAgICAgcmV0dXJuIGZuLmFwcGx5KGZ1bmN0aW9uVG9rZW4uY29udGV4dCwgcmVzb2x2ZVNwcmVhZHModG9rZW4uY29udGVudCwgc2NvcGUpKTtcbiAgICB9Y2F0Y2goZXJyb3Ipe1xuICAgICAgICBzY29wZS50aHJvdyhlcnJvcik7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBmdW5jdGlvbkV4cHJlc3Npb24odG9rZW4sIHNjb3BlKXtcbiAgICB2YXIgZm4gPSBmdW5jdGlvbigpe1xuICAgICAgICB2YXIgYXJncyA9IGFyZ3VtZW50cyxcbiAgICAgICAgICAgIGZ1bmN0aW9uU2NvcGUgPSBuZXcgU2NvcGUoc2NvcGUpO1xuXG4gICAgICAgIHRva2VuLnBhcmFtZXRlcnMuZm9yRWFjaChmdW5jdGlvbihwYXJhbWV0ZXIsIGluZGV4KXtcblxuICAgICAgICAgICAgaWYocGFyYW1ldGVyLm5hbWUgPT09ICdzcHJlYWQnKXtcbiAgICAgICAgICAgICAgICBmdW5jdGlvblNjb3BlLnNldChwYXJhbWV0ZXIucmlnaHQubmFtZSwgQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJncywgaW5kZXgpKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGZ1bmN0aW9uU2NvcGUuc2V0KHBhcmFtZXRlci5uYW1lLCBhcmdzW2luZGV4XSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBleGVjdXRlKHRva2VuLmNvbnRlbnQsIGZ1bmN0aW9uU2NvcGUpO1xuICAgIH07XG5cbiAgICBpZih0b2tlbi5pZGVudGlmaWVyKXtcbiAgICAgICAgc2NvcGUuc2V0KHRva2VuLmlkZW50aWZpZXIubmFtZSwgZm4pO1xuICAgIH1cblxuICAgIHZhciByZXN1bHRGbiA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIHJldHVybiBmbi5hcHBseSh0aGlzLCBhcmd1bWVudHMpLnZhbHVlO1xuICAgIH1cblxuICAgIHByZXNoRnVuY3Rpb25zLnNldChyZXN1bHRGbiwgZm4pO1xuXG4gICAgcmV0dXJuIHJlc3VsdEZuO1xufVxuXG5mdW5jdGlvbiBhc3NpZ25tZW50KHRva2VuLCBzY29wZSl7XG4gICAgaWYoc2NvcGUuaXNEZWZpbmVkKHRva2VuLmxlZnQubmFtZSkpe1xuICAgICAgICBzY29wZS50aHJvdygnQ2Fubm90IHJlYXNzaWduIGFscmVhZHkgZGVmaW5lZCBpZGVudGlmaWVyOiAnICsgdG9rZW4ubGVmdC5uYW1lKTtcbiAgICB9XG5cbiAgICB2YXIgdmFsdWUgPSBleGVjdXRlVG9rZW4odG9rZW4ucmlnaHQsIHNjb3BlKS52YWx1ZTtcblxuICAgIHNjb3BlLnNldCh0b2tlbi5sZWZ0Lm5hbWUsIHZhbHVlKTtcblxuICAgIHJldHVybiB2YWx1ZTtcbn1cblxuZnVuY3Rpb24gdGVybmFyeSh0b2tlbiwgc2NvcGUpe1xuXG4gICAgaWYoc2NvcGUuX2RlYnVnKXtcbiAgICAgICAgY29uc29sZS5sb2coJ0V4ZWN1dGluZyBvcGVyYXRvcjogJyArIHRva2VuLm5hbWUsIHRva2VuLmxlZnQsIHRva2VuLnJpZ2h0KTtcbiAgICB9XG5cbiAgICByZXR1cm4gZXhlY3V0ZVRva2VuKHRva2VuLmxlZnQsIHNjb3BlKS52YWx1ZSA/XG4gICAgICAgIGV4ZWN1dGVUb2tlbih0b2tlbi5taWRkbGUsIHNjb3BlKS52YWx1ZSA6XG4gICAgICAgIGV4ZWN1dGVUb2tlbih0b2tlbi5yaWdodCwgc2NvcGUpLnZhbHVlO1xufVxuXG5mdW5jdGlvbiBpZGVudGlmaWVyKHRva2VuLCBzY29wZSl7XG4gICAgdmFyIG5hbWUgPSB0b2tlbi5uYW1lO1xuICAgIGlmKG5hbWUgaW4gcmVzZXJ2ZWRLZXl3b3Jkcyl7XG4gICAgICAgIHJldHVybiByZXNlcnZlZEtleXdvcmRzW25hbWVdO1xuICAgIH1cbiAgICBpZighc2NvcGUuaXNEZWZpbmVkKG5hbWUpKXtcbiAgICAgICAgc2NvcGUudGhyb3cobmFtZSArICcgaXMgbm90IGRlZmluZWQnKTtcbiAgICB9XG4gICAgcmV0dXJuIHNjb3BlLmdldChuYW1lKTtcbn1cblxuZnVuY3Rpb24gbnVtYmVyKHRva2VuKXtcbiAgICByZXR1cm4gdG9rZW4udmFsdWU7XG59XG5cbmZ1bmN0aW9uIHN0cmluZyh0b2tlbil7XG4gICAgcmV0dXJuIHRva2VuLnZhbHVlO1xufVxuXG5mdW5jdGlvbiBnZXRQcm9wZXJ0eSh0b2tlbiwgc2NvcGUsIHRhcmdldCwgYWNjZXNzb3Ipe1xuXG4gICAgaWYoIXRhcmdldCB8fCAhKHR5cGVvZiB0YXJnZXQgPT09ICdvYmplY3QnIHx8IHR5cGVvZiB0YXJnZXQgPT09ICdmdW5jdGlvbicpKXtcbiAgICAgICAgc2NvcGUudGhyb3cocHJpbnRFcnJvcigndGFyZ2V0IGlzIG5vdCBhbiBvYmplY3QnLCB0b2tlbi5zb3VyY2VUb2tlbikpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG5cbiAgICB2YXIgcmVzdWx0ID0gT2JqZWN0Lmhhc093blByb3BlcnR5LmNhbGwodGFyZ2V0LCBhY2Nlc3NvcikgPyB0YXJnZXRbYWNjZXNzb3JdIDogdW5kZWZpbmVkO1xuXG4gICAgaWYodHlwZW9mIHJlc3VsdCA9PT0gJ2Z1bmN0aW9uJyl7XG4gICAgICAgIHJlc3VsdCA9IHRvVmFsdWUocmVzdWx0LCBzY29wZSwgdGFyZ2V0KTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiBwZXJpb2QodG9rZW4sIHNjb3BlKXtcbiAgICB2YXIgdGFyZ2V0ID0gZXhlY3V0ZVRva2VuKHRva2VuLmxlZnQsIHNjb3BlKS52YWx1ZTtcblxuICAgIHJldHVybiBnZXRQcm9wZXJ0eSh0b2tlbiwgc2NvcGUsIHRhcmdldCwgdG9rZW4ucmlnaHQubmFtZSk7XG59XG5cbmZ1bmN0aW9uIGFjY2Vzc29yKHRva2VuLCBzY29wZSl7XG4gICAgdmFyIGFjY2Vzc29yVmFsdWUgPSBleGVjdXRlKHRva2VuLmNvbnRlbnQsIHNjb3BlKS52YWx1ZSxcbiAgICAgICAgdGFyZ2V0ID0gZXhlY3V0ZVRva2VuKHRva2VuLnRhcmdldCwgc2NvcGUpLnZhbHVlO1xuXG4gICAgcmV0dXJuIGdldFByb3BlcnR5KHRva2VuLCBzY29wZSwgdGFyZ2V0LCBhY2Nlc3NvclZhbHVlKTtcbn1cblxuZnVuY3Rpb24gc3ByZWFkKHRva2VuLCBzY29wZSl7XG4gICAgdmFyIHRhcmdldCA9IGV4ZWN1dGVUb2tlbih0b2tlbi5yaWdodCwgc2NvcGUpLnZhbHVlO1xuXG4gICAgaWYoIUFycmF5LmlzQXJyYXkodGFyZ2V0KSl7XG4gICAgICAgIHNjb3BlLnRocm93KCd0YXJnZXQgZGlkIG5vdCByZXNvbHZlIHRvIGFuIGFycmF5Jyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRhcmdldDtcbn1cblxuZnVuY3Rpb24gc2V0KHRva2VuLCBzY29wZSl7XG4gICAgaWYodG9rZW4uY29udGVudC5sZW5ndGggPT09IDEgJiYgdG9rZW4uY29udGVudFswXS5uYW1lID09PSAncmFuZ2UnKXtcbiAgICAgICAgdmFyIHJhbmdlID0gdG9rZW4uY29udGVudFswXSxcbiAgICAgICAgICAgIHN0YXJ0ID0gZXhlY3V0ZVRva2VuKHJhbmdlLmxlZnQsIHNjb3BlKS52YWx1ZSxcbiAgICAgICAgICAgIGVuZCA9IGV4ZWN1dGVUb2tlbihyYW5nZS5yaWdodCwgc2NvcGUpLnZhbHVlLFxuICAgICAgICAgICAgcmV2ZXJzZSA9IGVuZCA8IHN0YXJ0LFxuICAgICAgICAgICAgcmVzdWx0ID0gW107XG5cbiAgICAgICAgaWYoTWF0aC5hYnMoc3RhcnQpID09PSBJbmZpbml0eSB8fCBNYXRoLmFicyhlbmQpID09PSBJbmZpbml0eSl7XG4gICAgICAgICAgICBzY29wZS50aHJvdygnUmFuZ2UgdmFsdWVzIGNhbiBub3QgYmUgaW5maW5pdGUnKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAodmFyIGkgPSBzdGFydDsgcmV2ZXJzZSA/IGkgPj0gZW5kIDogaSA8PSBlbmQ7IHJldmVyc2UgPyBpLS0gOiBpKyspIHtcbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKGkpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzb2x2ZVNwcmVhZHModG9rZW4uY29udGVudCwgc2NvcGUpO1xufVxuXG5mdW5jdGlvbiB2YWx1ZSh0b2tlbil7XG4gICAgcmV0dXJuIHRva2VuLnZhbHVlO1xufVxuXG5mdW5jdGlvbiBvYmplY3QodG9rZW4sIHNjb3BlKXtcbiAgICB2YXIgcmVzdWx0ID0ge307XG5cbiAgICB2YXIgY29udGVudCA9IHRva2VuLmNvbnRlbnQ7XG5cbiAgICBmb3IodmFyIGkgPSAwOyBpIDwgY29udGVudC5sZW5ndGg7IGkgKyspIHtcbiAgICAgICAgdmFyIGNoaWxkID0gY29udGVudFtpXSxcbiAgICAgICAgICAgIGtleSxcbiAgICAgICAgICAgIHZhbHVlO1xuXG4gICAgICAgIGlmKGNoaWxkLm5hbWUgPT09ICd0dXBsZScpe1xuICAgICAgICAgICAgaWYoY2hpbGQubGVmdC50eXBlID09PSAnaWRlbnRpZmllcicpe1xuICAgICAgICAgICAgICAgIGtleSA9IGNoaWxkLmxlZnQubmFtZTtcbiAgICAgICAgICAgIH1lbHNlIGlmKGNoaWxkLmxlZnQudHlwZSA9PT0gJ3NldCcgJiYgY2hpbGQubGVmdC5jb250ZW50Lmxlbmd0aCA9PT0gMSl7XG4gICAgICAgICAgICAgICAga2V5ID0gZXhlY3V0ZVRva2VuKGNoaWxkLmxlZnQuY29udGVudFswXSwgc2NvcGUpLnZhbHVlO1xuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgc2NvcGUudGhyb3coJ1VuZXhwZWN0ZWQgdG9rZW4gaW4gb2JqZWN0IGNvbnN0cnVjdG9yOiAnICsgY2hpbGQudHlwZSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YWx1ZSA9IGV4ZWN1dGVUb2tlbihjaGlsZC5yaWdodCwgc2NvcGUpLnZhbHVlO1xuICAgICAgICB9ZWxzZSBpZihjaGlsZC50eXBlID09PSAnaWRlbnRpZmllcicpe1xuICAgICAgICAgICAga2V5ID0gY2hpbGQubmFtZTtcbiAgICAgICAgICAgIHZhbHVlID0gZXhlY3V0ZVRva2VuKGNoaWxkLCBzY29wZSkudmFsdWU7XG4gICAgICAgIH1lbHNlIGlmKGNoaWxkLm5hbWUgPT09ICdzcHJlYWQnKXtcbiAgICAgICAgICAgIHZhciBzb3VyY2UgPSBleGVjdXRlVG9rZW4oY2hpbGQucmlnaHQsIHNjb3BlKS52YWx1ZTtcblxuICAgICAgICAgICAgaWYoIWlzSW5zdGFuY2Uoc291cmNlKSl7XG4gICAgICAgICAgICAgICAgc2NvcGUudGhyb3coJ1RhcmdldCBkaWQgbm90IHJlc29sdmUgdG8gYW4gaW5zdGFuY2Ugb2YgYW4gb2JqZWN0Jyk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBPYmplY3QuYXNzaWduKHJlc3VsdCwgc291cmNlKTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9ZWxzZSBpZihjaGlsZC5uYW1lID09PSAnZGVsZXRlJyl7XG4gICAgICAgICAgICB2YXIgdGFyZ2V0SWRlbnRpZmllciA9IGNoaWxkLnJpZ2h0O1xuXG4gICAgICAgICAgICBpZih0YXJnZXRJZGVudGlmaWVyLnR5cGUgIT09ICdpZGVudGlmaWVyJyl7XG4gICAgICAgICAgICAgICAgc2NvcGUudGhyb3coJ1RhcmdldCBvZiBkZWxldGUgd2FzIG5vdCBhbiBpZGVudGlmaWVyJyk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBkZWxldGUgcmVzdWx0W3RhcmdldElkZW50aWZpZXIubmFtZV07XG5cbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIHNjb3BlLnRocm93KCdVbmV4cGVjdGVkIHRva2VuIGluIG9iamVjdCBjb25zdHJ1Y3RvcjogJyArIGNoaWxkLnR5cGUpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgcmVzdWx0W2tleV0gPSB2YWx1ZTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG52YXIgaGFuZGxlcnMgPSB7XG4gICAgYXNzaWdubWVudDogYXNzaWdubWVudCxcbiAgICB0ZXJuYXJ5OiB0ZXJuYXJ5LFxuICAgIGZ1bmN0aW9uQ2FsbDogZnVuY3Rpb25DYWxsLFxuICAgIGZ1bmN0aW9uRXhwcmVzc2lvbjogZnVuY3Rpb25FeHByZXNzaW9uLFxuICAgIG51bWJlcjogbnVtYmVyLFxuICAgIHN0cmluZzogc3RyaW5nLFxuICAgIGlkZW50aWZpZXI6IGlkZW50aWZpZXIsXG4gICAgc2V0OiBzZXQsXG4gICAgcGVyaW9kOiBwZXJpb2QsXG4gICAgc3ByZWFkOiBzcHJlYWQsXG4gICAgYWNjZXNzb3I6IGFjY2Vzc29yLFxuICAgIHZhbHVlOiB2YWx1ZSxcbiAgICBvcGVyYXRvcjogb3BlcmF0b3IsXG4gICAgcGFyZW50aGVzaXNHcm91cDogY29udGVudEhvbGRlcixcbiAgICBzdGF0ZW1lbnQ6IGNvbnRlbnRIb2xkZXIsXG4gICAgYnJhY2VHcm91cDogb2JqZWN0XG59O1xuXG5mdW5jdGlvbiBuZXh0T3BlcmF0b3JUb2tlbih0b2tlbiwgc2NvcGUpe1xuICAgIHJldHVybiBmdW5jdGlvbigpe1xuICAgICAgICByZXR1cm4gZXhlY3V0ZVRva2VuKHRva2VuLCBzY29wZSkudmFsdWU7XG4gICAgfTtcbn1cblxuZnVuY3Rpb24gb3BlcmF0b3IodG9rZW4sIHNjb3BlKXtcbiAgICBpZih0b2tlbi5uYW1lIGluIGhhbmRsZXJzKXtcbiAgICAgICAgcmV0dXJuIHRvVmFsdWUoaGFuZGxlcnNbdG9rZW4ubmFtZV0odG9rZW4sIHNjb3BlKSwgc2NvcGUpO1xuICAgIH1cblxuICAgIGlmKHRva2VuLmxlZnQpe1xuICAgICAgICBpZihzY29wZS5fZGVidWcpe1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ0V4ZWN1dGluZyB0b2tlbjogJyArIHRva2VuLm5hbWUsIHRva2VuLmxlZnQsIHRva2VuLnJpZ2h0KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdG9rZW4ub3BlcmF0b3IuZm4obmV4dE9wZXJhdG9yVG9rZW4odG9rZW4ubGVmdCwgc2NvcGUpLCBuZXh0T3BlcmF0b3JUb2tlbih0b2tlbi5yaWdodCwgc2NvcGUpKTtcbiAgICB9XG5cbiAgICBpZihzY29wZS5fZGVidWcpe1xuICAgICAgICBjb25zb2xlLmxvZygnRXhlY3V0aW5nIG9wZXJhdG9yOiAnICsgdG9rZW4ubmFtZS4gdG9rZW4ucmlnaHQpO1xuICAgIH1cblxuICAgIHJldHVybiB0b2tlbi5vcGVyYXRvci5mbihuZXh0T3BlcmF0b3JUb2tlbih0b2tlbi5yaWdodCwgc2NvcGUpKTtcbn1cblxuZnVuY3Rpb24gY29udGVudEhvbGRlcihwYXJlbnRoZXNpc0dyb3VwLCBzY29wZSl7XG4gICAgcmV0dXJuIGV4ZWN1dGUocGFyZW50aGVzaXNHcm91cC5jb250ZW50LCBzY29wZSkudmFsdWU7XG59XG5cbmZ1bmN0aW9uIGV4ZWN1dGVUb2tlbih0b2tlbiwgc2NvcGUpe1xuICAgIGlmKHNjb3BlLl9lcnJvcil7XG4gICAgICAgIHJldHVybiB7ZXJyb3I6IHNjb3BlLl9lcnJvcn07XG4gICAgfVxuICAgIHJldHVybiB0b1ZhbHVlKGhhbmRsZXJzW3Rva2VuLnR5cGVdKHRva2VuLCBzY29wZSksIHNjb3BlKTtcbn1cblxuZnVuY3Rpb24gZXhlY3V0ZSh0b2tlbnMsIHNjb3BlLCBkZWJ1Zyl7XG4gICAgc2NvcGUgPSBzY29wZSBpbnN0YW5jZW9mIFNjb3BlID8gc2NvcGUgOiBuZXcgU2NvcGUoc2NvcGUsIGRlYnVnKTtcblxuICAgIHZhciByZXN1bHQ7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0b2tlbnMubGVuZ3RoOyBpKyspIHtcblxuICAgICAgICByZXN1bHQgPSBleGVjdXRlVG9rZW4odG9rZW5zW2ldLCBzY29wZSk7XG5cbiAgICAgICAgaWYocmVzdWx0LmVycm9yKXtcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZighcmVzdWx0KXtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGVycm9yOiBuZXcgRXJyb3IoJ1Vua25vd24gZXhlY3V0aW9uIGVycm9yJylcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGV4ZWN1dGU7IiwibW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgbG9nOiBmdW5jdGlvbih4KXtcbiAgICAgICAgY29uc29sZS5sb2cuYXBwbHkoY29uc29sZSwgYXJndW1lbnRzKTtcbiAgICAgICAgcmV0dXJuIHg7XG4gICAgfSxcbiAgICBzbGljZTogZnVuY3Rpb24oaXRlbXMsIHN0YXJ0LCBlbmQpe1xuICAgICAgICByZXR1cm4gaXRlbXMuc2xpY2Uoc3RhcnQsIGVuZCk7XG4gICAgfSxcbiAgICBmaW5kOiBmdW5jdGlvbihpdGVtcywgZm4pe1xuICAgICAgICByZXR1cm4gaXRlbXMuZmluZChmbik7XG4gICAgfSxcbiAgICBpbmRleE9mOiBmdW5jdGlvbihpdGVtcywgdmFsdWUpe1xuICAgICAgICByZXR1cm4gaXRlbXMuaW5kZXhPZih2YWx1ZSk7XG4gICAgfSxcbiAgICBtYXA6IGZ1bmN0aW9uKGl0ZW1zLCBmbil7XG4gICAgICAgIHJldHVybiBpdGVtcy5tYXAoZm4pO1xuICAgIH0sXG4gICAgZm9sZDogZnVuY3Rpb24oaXRlbXMsIHNlZWQsIGZuKXtcbiAgICAgICAgaWYoYXJndW1lbnRzLmxlbmd0aCA9PT0gMil7XG4gICAgICAgICAgICByZXR1cm4gaXRlbXMucmVkdWNlKHNlZWQpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBpdGVtcy5yZWR1Y2UoZm4sIHNlZWQpO1xuICAgIH0sXG4gICAgU3RyaW5nOiBTdHJpbmcsXG4gICAgTnVtYmVyOiBOdW1iZXIsXG4gICAgbWF0aDogTWF0aCxcbiAgICBpc05hTjogaXNOYU5cbn07IiwidmFyIGxleCA9IHJlcXVpcmUoJy4vbGV4JyksXG4gICAgcGFyc2UgPSByZXF1aXJlKCcuL3BhcnNlJyksXG4gICAgZXhlY3V0ZSA9IHJlcXVpcmUoJy4vZXhlY3V0ZScpLFxuICAgIGdsb2JhbCA9IHJlcXVpcmUoJy4vZ2xvYmFsJyksXG4gICAgbWVyZ2UgPSByZXF1aXJlKCdmbGF0LW1lcmdlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZXhwcmVzc2lvbiwgc2NvcGUsIGNhbGxiYWNrLCBkZWJ1Zyl7XG4gICAgdmFyIGxleGVkID0gbGV4KGV4cHJlc3Npb24pO1xuICAgIHZhciBwYXJzZWQgPSBwYXJzZShsZXhlZCk7XG5cbiAgICByZXR1cm4gZXhlY3V0ZShwYXJzZWQsIG1lcmdlKFxuICAgICAgICBnbG9iYWwsXG4gICAgICAgIHNjb3BlXG4gICAgKSwgY2FsbGJhY2ssIGRlYnVnKTtcbn07IiwidmFyIG9wZXJhdG9ycyA9IHJlcXVpcmUoJy4vb3BlcmF0b3JzJyk7XG5cbmZ1bmN0aW9uIGxleFN0cmluZyhzb3VyY2Upe1xuICAgIHZhciBzdHJpbmdNYXRjaCA9IHNvdXJjZS5tYXRjaCgvXigoW1wiJ10pKD86W15cXFxcXXxcXFxcLikqP1xcMikvKTtcblxuICAgIGlmKHN0cmluZ01hdGNoKXtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgc3RyaW5nQ2hhcjogc3RyaW5nTWF0Y2hbMV0uY2hhckF0KDApLFxuICAgICAgICAgICAgc291cmNlOiBzdHJpbmdNYXRjaFsxXSwvLy5yZXBsYWNlKC9cXFxcKFsnXCJdKS9nLCBcIiQxXCIpLFxuICAgICAgICAgICAgbGVuZ3RoOiBzdHJpbmdNYXRjaFsxXS5sZW5ndGhcbiAgICAgICAgfTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGxleFdvcmQoc291cmNlKXtcbiAgICB2YXIgbWF0Y2ggPSBzb3VyY2UubWF0Y2goL14oPyFcXC0pW1xcdy0kXSsvKTtcblxuICAgIGlmKCFtYXRjaCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZihtYXRjaCBpbiBvcGVyYXRvcnMpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgdHlwZTogJ3dvcmQnLFxuICAgICAgICBzb3VyY2U6IG1hdGNoWzBdLFxuICAgICAgICBsZW5ndGg6IG1hdGNoWzBdLmxlbmd0aFxuICAgIH07XG59XG5cbmZ1bmN0aW9uIGxleE51bWJlcihzb3VyY2Upe1xuICAgIHZhciBzcGVjaWFscyA9IHtcbiAgICAgICAgJ05hTic6IE51bWJlci5OYU4sXG4gICAgICAgICdJbmZpbml0eSc6IEluZmluaXR5XG4gICAgfTtcblxuICAgIHZhciB0b2tlbiA9IHtcbiAgICAgICAgdHlwZTogJ251bWJlcidcbiAgICB9O1xuXG4gICAgZm9yICh2YXIga2V5IGluIHNwZWNpYWxzKSB7XG4gICAgICAgIGlmIChzb3VyY2Uuc2xpY2UoMCwga2V5Lmxlbmd0aCkgPT09IGtleSkge1xuICAgICAgICAgICAgdG9rZW4uc291cmNlID0ga2V5O1xuICAgICAgICAgICAgdG9rZW4ubGVuZ3RoID0gdG9rZW4uc291cmNlLmxlbmd0aDtcblxuICAgICAgICAgICAgcmV0dXJuIHRva2VuO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgdmFyIG1hdGNoRXhwb25lbnQgPSBzb3VyY2UubWF0Y2goL15bMC05XSsoPzpcXC5bMC05XSspP1tlRV0tP1swLTldKy8pO1xuXG4gICAgaWYobWF0Y2hFeHBvbmVudCl7XG4gICAgICAgIHRva2VuLnNvdXJjZSA9IG1hdGNoRXhwb25lbnRbMF07XG4gICAgICAgIHRva2VuLmxlbmd0aCA9IHRva2VuLnNvdXJjZS5sZW5ndGg7XG5cbiAgICAgICAgcmV0dXJuIHRva2VuO1xuICAgIH1cblxuICAgIHZhciBtYXRjaEhleCA9IHNvdXJjZS5tYXRjaCgvXjBbeFhdWzAtOV0rLyk7XG5cbiAgICBpZihtYXRjaEhleCl7XG4gICAgICAgIHRva2VuLnNvdXJjZSA9IG1hdGNoSGV4WzBdO1xuICAgICAgICB0b2tlbi5sZW5ndGggPSB0b2tlbi5zb3VyY2UubGVuZ3RoO1xuXG4gICAgICAgIHJldHVybiB0b2tlbjtcbiAgICB9XG5cbiAgICB2YXIgbWF0Y2hIZWFkbGVzc0RlY2ltYWwgPSBzb3VyY2UubWF0Y2goL15cXC5bMC05XSsvKTtcblxuICAgIGlmKG1hdGNoSGVhZGxlc3NEZWNpbWFsKXtcbiAgICAgICAgdG9rZW4uc291cmNlID0gbWF0Y2hIZWFkbGVzc0RlY2ltYWxbMF07XG4gICAgICAgIHRva2VuLmxlbmd0aCA9IHRva2VuLnNvdXJjZS5sZW5ndGg7XG5cbiAgICAgICAgcmV0dXJuIHRva2VuO1xuICAgIH1cblxuICAgIHZhciBtYXRjaE5vcm1hbERlY2ltYWwgPSBzb3VyY2UubWF0Y2goL15bMC05XSsoPzpcXC5bMC05XSspPy8pO1xuXG4gICAgaWYobWF0Y2hOb3JtYWxEZWNpbWFsKXtcbiAgICAgICAgdG9rZW4uc291cmNlID0gbWF0Y2hOb3JtYWxEZWNpbWFsWzBdO1xuICAgICAgICB0b2tlbi5sZW5ndGggPSB0b2tlbi5zb3VyY2UubGVuZ3RoO1xuXG4gICAgICAgIHJldHVybiB0b2tlbjtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGxleENvbW1lbnQoc291cmNlKXtcbiAgICB2YXIgbWF0Y2ggPSBzb3VyY2UubWF0Y2goL14oXFwvXFwqW15dKj9cXCpcXC8pLyk7XG5cbiAgICBpZighbWF0Y2gpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgdHlwZTogJ2NvbW1lbnQnLFxuICAgICAgICBzb3VyY2U6IG1hdGNoWzBdLFxuICAgICAgICBsZW5ndGg6IG1hdGNoWzBdLmxlbmd0aFxuICAgIH07XG59XG5cbnZhciBjaGFyYWN0ZXJzID0ge1xuICAgICcuJzogJ3BlcmlvZCcsXG4gICAgJzsnOiAnc2VtaWNvbG9uJyxcbiAgICAneyc6ICdicmFjZU9wZW4nLFxuICAgICd9JzogJ2JyYWNlQ2xvc2UnLFxuICAgICcoJzogJ3BhcmVudGhlc2lzT3BlbicsXG4gICAgJyknOiAncGFyZW50aGVzaXNDbG9zZScsXG4gICAgJ1snOiAnc3F1YXJlQnJhY2VPcGVuJyxcbiAgICAnXSc6ICdzcXVhcmVCcmFjZUNsb3NlJ1xufTtcblxuZnVuY3Rpb24gbGV4Q2hhcmFjdGVycyhzb3VyY2Upe1xuICAgIHZhciBuYW1lLFxuICAgICAgICBrZXk7XG5cbiAgICBmb3Ioa2V5IGluIGNoYXJhY3RlcnMpe1xuICAgICAgICBpZihzb3VyY2UuaW5kZXhPZihrZXkpID09PSAwKXtcbiAgICAgICAgICAgIG5hbWUgPSBjaGFyYWN0ZXJzW2tleV07XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGlmKCFuYW1lKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIHR5cGU6IG5hbWUsXG4gICAgICAgIHNvdXJjZToga2V5LFxuICAgICAgICBsZW5ndGg6IDFcbiAgICB9O1xufVxuXG5mdW5jdGlvbiBsZXhPcGVyYXRvcnMoc291cmNlKXtcbiAgICB2YXIgb3BlcmF0b3IsXG4gICAgICAgIGtleTtcblxuICAgIGZvcihrZXkgaW4gb3BlcmF0b3JzKXtcbiAgICAgICAgaWYoc291cmNlLmluZGV4T2Yoa2V5KSA9PT0gMCl7XG4gICAgICAgICAgICBvcGVyYXRvciA9IG9wZXJhdG9yc1trZXldO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZighb3BlcmF0b3Ipe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgdHlwZTogJ29wZXJhdG9yJyxcbiAgICAgICAgc291cmNlOiBrZXksXG4gICAgICAgIGxlbmd0aDoga2V5Lmxlbmd0aFxuICAgIH07XG59XG5cbmZ1bmN0aW9uIGxleFNwcmVhZChzb3VyY2Upe1xuICAgIHZhciBtYXRjaCA9IHNvdXJjZS5tYXRjaCgvXlxcLlxcLlxcLi8pO1xuXG4gICAgaWYoIW1hdGNoKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIHR5cGU6ICdzcHJlYWQnLFxuICAgICAgICBzb3VyY2U6IG1hdGNoWzBdLFxuICAgICAgICBsZW5ndGg6IG1hdGNoWzBdLmxlbmd0aFxuICAgIH07XG59XG5cbmZ1bmN0aW9uIGxleERlbGltaXRlcihzb3VyY2Upe1xuICAgIHZhciBtYXRjaCA9IHNvdXJjZS5tYXRjaCgvXltcXHNcXG4sXSsvKTtcblxuICAgIGlmKCFtYXRjaCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICB0eXBlOiAnZGVsaW1pdGVyJyxcbiAgICAgICAgc291cmNlOiBtYXRjaFswXSxcbiAgICAgICAgbGVuZ3RoOiBtYXRjaFswXS5sZW5ndGhcbiAgICB9O1xufVxuXG52YXIgbGV4ZXJzID0gW1xuICAgIGxleERlbGltaXRlcixcbiAgICBsZXhDb21tZW50LFxuICAgIGxleE51bWJlcixcbiAgICBsZXhXb3JkLFxuICAgIGxleE9wZXJhdG9ycyxcbiAgICBsZXhDaGFyYWN0ZXJzLFxuICAgIGxleFN0cmluZyxcbiAgICBsZXhTcHJlYWRcbl07XG5cbmZ1bmN0aW9uIHNjYW5Gb3JUb2tlbih0b2tlbmlzZXJzLCBleHByZXNzaW9uKXtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRva2VuaXNlcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIHRva2VuID0gdG9rZW5pc2Vyc1tpXShleHByZXNzaW9uKTtcbiAgICAgICAgaWYgKHRva2VuKSB7XG4gICAgICAgICAgICByZXR1cm4gdG9rZW47XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIGxleChzb3VyY2UsIG1lbW9pc2VkVG9rZW5zKSB7XG4gICAgdmFyIHNvdXJjZVJlZiA9IHtcbiAgICAgICAgc291cmNlOiBzb3VyY2UsXG4gICAgICAgIHRvSlNPTjogZnVuY3Rpb24oKXt9XG4gICAgfTtcblxuICAgIGlmKCFzb3VyY2Upe1xuICAgICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgaWYobWVtb2lzZWRUb2tlbnMgJiYgbWVtb2lzZWRUb2tlbnNbc291cmNlXSl7XG4gICAgICAgIHJldHVybiBtZW1vaXNlZFRva2Vuc1tzb3VyY2VdLnNsaWNlKCk7XG4gICAgfVxuXG4gICAgdmFyIG9yaWdpbmFsU291cmNlID0gc291cmNlLFxuICAgICAgICB0b2tlbnMgPSBbXSxcbiAgICAgICAgdG90YWxDaGFyc1Byb2Nlc3NlZCA9IDAsXG4gICAgICAgIHByZXZpb3VzTGVuZ3RoO1xuXG4gICAgZG8ge1xuICAgICAgICBwcmV2aW91c0xlbmd0aCA9IHNvdXJjZS5sZW5ndGg7XG5cbiAgICAgICAgdmFyIHRva2VuO1xuXG4gICAgICAgIHRva2VuID0gc2NhbkZvclRva2VuKGxleGVycywgc291cmNlKTtcblxuICAgICAgICBpZih0b2tlbil7XG4gICAgICAgICAgICB0b2tlbi5zb3VyY2VSZWYgPSBzb3VyY2VSZWY7XG4gICAgICAgICAgICB0b2tlbi5pbmRleCA9IHRvdGFsQ2hhcnNQcm9jZXNzZWQ7XG4gICAgICAgICAgICBzb3VyY2UgPSBzb3VyY2Uuc2xpY2UodG9rZW4ubGVuZ3RoKTtcbiAgICAgICAgICAgIHRvdGFsQ2hhcnNQcm9jZXNzZWQgKz0gdG9rZW4ubGVuZ3RoO1xuICAgICAgICAgICAgdG9rZW5zLnB1c2godG9rZW4pO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuXG4gICAgICAgIGlmKHNvdXJjZS5sZW5ndGggPT09IHByZXZpb3VzTGVuZ3RoKXtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignU3ludGF4IGVycm9yOiBVbmFibGUgdG8gZGV0ZXJtaW5lIG5leHQgdG9rZW4gaW4gc291cmNlOiAnICsgc291cmNlLnNsaWNlKDAsIDEwMCkpO1xuICAgICAgICB9XG5cbiAgICB9IHdoaWxlIChzb3VyY2UpO1xuXG4gICAgaWYobWVtb2lzZWRUb2tlbnMpe1xuICAgICAgICBtZW1vaXNlZFRva2Vuc1tvcmlnaW5hbFNvdXJjZV0gPSB0b2tlbnMuc2xpY2UoKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdG9rZW5zO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGxleDsiLCIvL0NvcHlyaWdodCAoQykgMjAxMiBLb3J5IE51bm5cclxuXHJcbi8vUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGEgY29weSBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZSBcIlNvZnR3YXJlXCIpLCB0byBkZWFsIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmcgd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLCBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbCBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0IHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXMgZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZSBmb2xsb3dpbmcgY29uZGl0aW9uczpcclxuXHJcbi8vVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWQgaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXHJcblxyXG4vL1RIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1MgT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFksIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOIE5PIEVWRU5UIFNIQUxMIFRIRSBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLCBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1IgT1RIRVJXSVNFLCBBUklTSU5HIEZST00sIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRSBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU4gVEhFIFNPRlRXQVJFLlxyXG5cclxuLypcclxuXHJcbiAgICBUaGlzIGNvZGUgaXMgbm90IGZvcm1hdHRlZCBmb3IgcmVhZGFiaWxpdHksIGJ1dCByYXRoZXIgcnVuLXNwZWVkIGFuZCB0byBhc3Npc3QgY29tcGlsZXJzLlxyXG5cclxuICAgIEhvd2V2ZXIsIHRoZSBjb2RlJ3MgaW50ZW50aW9uIHNob3VsZCBiZSB0cmFuc3BhcmVudC5cclxuXHJcbiAgICAqKiogSUUgU1VQUE9SVCAqKipcclxuXHJcbiAgICBJZiB5b3UgcmVxdWlyZSB0aGlzIGxpYnJhcnkgdG8gd29yayBpbiBJRTcsIGFkZCB0aGUgZm9sbG93aW5nIGFmdGVyIGRlY2xhcmluZyBjcmVsLlxyXG5cclxuICAgIHZhciB0ZXN0RGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2JyksXHJcbiAgICAgICAgdGVzdExhYmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnbGFiZWwnKTtcclxuXHJcbiAgICB0ZXN0RGl2LnNldEF0dHJpYnV0ZSgnY2xhc3MnLCAnYScpO1xyXG4gICAgdGVzdERpdlsnY2xhc3NOYW1lJ10gIT09ICdhJyA/IGNyZWwuYXR0ck1hcFsnY2xhc3MnXSA9ICdjbGFzc05hbWUnOnVuZGVmaW5lZDtcclxuICAgIHRlc3REaXYuc2V0QXR0cmlidXRlKCduYW1lJywnYScpO1xyXG4gICAgdGVzdERpdlsnbmFtZSddICE9PSAnYScgPyBjcmVsLmF0dHJNYXBbJ25hbWUnXSA9IGZ1bmN0aW9uKGVsZW1lbnQsIHZhbHVlKXtcclxuICAgICAgICBlbGVtZW50LmlkID0gdmFsdWU7XHJcbiAgICB9OnVuZGVmaW5lZDtcclxuXHJcblxyXG4gICAgdGVzdExhYmVsLnNldEF0dHJpYnV0ZSgnZm9yJywgJ2EnKTtcclxuICAgIHRlc3RMYWJlbFsnaHRtbEZvciddICE9PSAnYScgPyBjcmVsLmF0dHJNYXBbJ2ZvciddID0gJ2h0bWxGb3InOnVuZGVmaW5lZDtcclxuXHJcblxyXG5cclxuKi9cclxuXHJcbihmdW5jdGlvbiAocm9vdCwgZmFjdG9yeSkge1xyXG4gICAgaWYgKHR5cGVvZiBleHBvcnRzID09PSAnb2JqZWN0Jykge1xyXG4gICAgICAgIG1vZHVsZS5leHBvcnRzID0gZmFjdG9yeSgpO1xyXG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpIHtcclxuICAgICAgICBkZWZpbmUoZmFjdG9yeSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIHJvb3QuY3JlbCA9IGZhY3RvcnkoKTtcclxuICAgIH1cclxufSh0aGlzLCBmdW5jdGlvbiAoKSB7XHJcbiAgICB2YXIgZm4gPSAnZnVuY3Rpb24nLFxyXG4gICAgICAgIG9iaiA9ICdvYmplY3QnLFxyXG4gICAgICAgIG5vZGVUeXBlID0gJ25vZGVUeXBlJyxcclxuICAgICAgICB0ZXh0Q29udGVudCA9ICd0ZXh0Q29udGVudCcsXHJcbiAgICAgICAgc2V0QXR0cmlidXRlID0gJ3NldEF0dHJpYnV0ZScsXHJcbiAgICAgICAgYXR0ck1hcFN0cmluZyA9ICdhdHRyTWFwJyxcclxuICAgICAgICBpc05vZGVTdHJpbmcgPSAnaXNOb2RlJyxcclxuICAgICAgICBpc0VsZW1lbnRTdHJpbmcgPSAnaXNFbGVtZW50JyxcclxuICAgICAgICBkID0gdHlwZW9mIGRvY3VtZW50ID09PSBvYmogPyBkb2N1bWVudCA6IHt9LFxyXG4gICAgICAgIGlzVHlwZSA9IGZ1bmN0aW9uKGEsIHR5cGUpe1xyXG4gICAgICAgICAgICByZXR1cm4gdHlwZW9mIGEgPT09IHR5cGU7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBpc05vZGUgPSB0eXBlb2YgTm9kZSA9PT0gZm4gPyBmdW5jdGlvbiAob2JqZWN0KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBvYmplY3QgaW5zdGFuY2VvZiBOb2RlO1xyXG4gICAgICAgIH0gOlxyXG4gICAgICAgIC8vIGluIElFIDw9IDggTm9kZSBpcyBhbiBvYmplY3QsIG9idmlvdXNseS4uXHJcbiAgICAgICAgZnVuY3Rpb24ob2JqZWN0KXtcclxuICAgICAgICAgICAgcmV0dXJuIG9iamVjdCAmJlxyXG4gICAgICAgICAgICAgICAgaXNUeXBlKG9iamVjdCwgb2JqKSAmJlxyXG4gICAgICAgICAgICAgICAgKG5vZGVUeXBlIGluIG9iamVjdCkgJiZcclxuICAgICAgICAgICAgICAgIGlzVHlwZShvYmplY3Qub3duZXJEb2N1bWVudCxvYmopO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgaXNFbGVtZW50ID0gZnVuY3Rpb24gKG9iamVjdCkge1xyXG4gICAgICAgICAgICByZXR1cm4gY3JlbFtpc05vZGVTdHJpbmddKG9iamVjdCkgJiYgb2JqZWN0W25vZGVUeXBlXSA9PT0gMTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIGlzQXJyYXkgPSBmdW5jdGlvbihhKXtcclxuICAgICAgICAgICAgcmV0dXJuIGEgaW5zdGFuY2VvZiBBcnJheTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIGFwcGVuZENoaWxkID0gZnVuY3Rpb24oZWxlbWVudCwgY2hpbGQpIHtcclxuICAgICAgICAgICAgaWYgKGlzQXJyYXkoY2hpbGQpKSB7XHJcbiAgICAgICAgICAgICAgICBjaGlsZC5tYXAoZnVuY3Rpb24oc3ViQ2hpbGQpe1xyXG4gICAgICAgICAgICAgICAgICAgIGFwcGVuZENoaWxkKGVsZW1lbnQsIHN1YkNoaWxkKTtcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmKCFjcmVsW2lzTm9kZVN0cmluZ10oY2hpbGQpKXtcclxuICAgICAgICAgICAgICAgIGNoaWxkID0gZC5jcmVhdGVUZXh0Tm9kZShjaGlsZCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZWxlbWVudC5hcHBlbmRDaGlsZChjaGlsZCk7XHJcbiAgICAgICAgfTtcclxuXHJcblxyXG4gICAgZnVuY3Rpb24gY3JlbCgpe1xyXG4gICAgICAgIHZhciBhcmdzID0gYXJndW1lbnRzLCAvL05vdGU6IGFzc2lnbmVkIHRvIGEgdmFyaWFibGUgdG8gYXNzaXN0IGNvbXBpbGVycy4gU2F2ZXMgYWJvdXQgNDAgYnl0ZXMgaW4gY2xvc3VyZSBjb21waWxlci4gSGFzIG5lZ2xpZ2FibGUgZWZmZWN0IG9uIHBlcmZvcm1hbmNlLlxyXG4gICAgICAgICAgICBlbGVtZW50ID0gYXJnc1swXSxcclxuICAgICAgICAgICAgY2hpbGQsXHJcbiAgICAgICAgICAgIHNldHRpbmdzID0gYXJnc1sxXSxcclxuICAgICAgICAgICAgY2hpbGRJbmRleCA9IDIsXHJcbiAgICAgICAgICAgIGFyZ3VtZW50c0xlbmd0aCA9IGFyZ3MubGVuZ3RoLFxyXG4gICAgICAgICAgICBhdHRyaWJ1dGVNYXAgPSBjcmVsW2F0dHJNYXBTdHJpbmddO1xyXG5cclxuICAgICAgICBlbGVtZW50ID0gY3JlbFtpc0VsZW1lbnRTdHJpbmddKGVsZW1lbnQpID8gZWxlbWVudCA6IGQuY3JlYXRlRWxlbWVudChlbGVtZW50KTtcclxuICAgICAgICAvLyBzaG9ydGN1dFxyXG4gICAgICAgIGlmKGFyZ3VtZW50c0xlbmd0aCA9PT0gMSl7XHJcbiAgICAgICAgICAgIHJldHVybiBlbGVtZW50O1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYoIWlzVHlwZShzZXR0aW5ncyxvYmopIHx8IGNyZWxbaXNOb2RlU3RyaW5nXShzZXR0aW5ncykgfHwgaXNBcnJheShzZXR0aW5ncykpIHtcclxuICAgICAgICAgICAgLS1jaGlsZEluZGV4O1xyXG4gICAgICAgICAgICBzZXR0aW5ncyA9IG51bGw7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBzaG9ydGN1dCBpZiB0aGVyZSBpcyBvbmx5IG9uZSBjaGlsZCB0aGF0IGlzIGEgc3RyaW5nXHJcbiAgICAgICAgaWYoKGFyZ3VtZW50c0xlbmd0aCAtIGNoaWxkSW5kZXgpID09PSAxICYmIGlzVHlwZShhcmdzW2NoaWxkSW5kZXhdLCAnc3RyaW5nJykgJiYgZWxlbWVudFt0ZXh0Q29udGVudF0gIT09IHVuZGVmaW5lZCl7XHJcbiAgICAgICAgICAgIGVsZW1lbnRbdGV4dENvbnRlbnRdID0gYXJnc1tjaGlsZEluZGV4XTtcclxuICAgICAgICB9ZWxzZXtcclxuICAgICAgICAgICAgZm9yKDsgY2hpbGRJbmRleCA8IGFyZ3VtZW50c0xlbmd0aDsgKytjaGlsZEluZGV4KXtcclxuICAgICAgICAgICAgICAgIGNoaWxkID0gYXJnc1tjaGlsZEluZGV4XTtcclxuXHJcbiAgICAgICAgICAgICAgICBpZihjaGlsZCA9PSBudWxsKXtcclxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoaXNBcnJheShjaGlsZCkpIHtcclxuICAgICAgICAgICAgICAgICAgZm9yICh2YXIgaT0wOyBpIDwgY2hpbGQubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgICAgICAgICBhcHBlbmRDaGlsZChlbGVtZW50LCBjaGlsZFtpXSk7XHJcbiAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgIGFwcGVuZENoaWxkKGVsZW1lbnQsIGNoaWxkKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZm9yKHZhciBrZXkgaW4gc2V0dGluZ3Mpe1xyXG4gICAgICAgICAgICBpZighYXR0cmlidXRlTWFwW2tleV0pe1xyXG4gICAgICAgICAgICAgICAgaWYoaXNUeXBlKHNldHRpbmdzW2tleV0sZm4pKXtcclxuICAgICAgICAgICAgICAgICAgICBlbGVtZW50W2tleV0gPSBzZXR0aW5nc1trZXldO1xyXG4gICAgICAgICAgICAgICAgfWVsc2V7XHJcbiAgICAgICAgICAgICAgICAgICAgZWxlbWVudFtzZXRBdHRyaWJ1dGVdKGtleSwgc2V0dGluZ3Nba2V5XSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1lbHNle1xyXG4gICAgICAgICAgICAgICAgdmFyIGF0dHIgPSBhdHRyaWJ1dGVNYXBba2V5XTtcclxuICAgICAgICAgICAgICAgIGlmKHR5cGVvZiBhdHRyID09PSBmbil7XHJcbiAgICAgICAgICAgICAgICAgICAgYXR0cihlbGVtZW50LCBzZXR0aW5nc1trZXldKTtcclxuICAgICAgICAgICAgICAgIH1lbHNle1xyXG4gICAgICAgICAgICAgICAgICAgIGVsZW1lbnRbc2V0QXR0cmlidXRlXShhdHRyLCBzZXR0aW5nc1trZXldKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIGVsZW1lbnQ7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gVXNlZCBmb3IgbWFwcGluZyBvbmUga2luZCBvZiBhdHRyaWJ1dGUgdG8gdGhlIHN1cHBvcnRlZCB2ZXJzaW9uIG9mIHRoYXQgaW4gYmFkIGJyb3dzZXJzLlxyXG4gICAgY3JlbFthdHRyTWFwU3RyaW5nXSA9IHt9O1xyXG5cclxuICAgIGNyZWxbaXNFbGVtZW50U3RyaW5nXSA9IGlzRWxlbWVudDtcclxuXHJcbiAgICBjcmVsW2lzTm9kZVN0cmluZ10gPSBpc05vZGU7XHJcblxyXG4gICAgaWYodHlwZW9mIFByb3h5ICE9PSAndW5kZWZpbmVkJyl7XHJcbiAgICAgICAgY3JlbC5wcm94eSA9IG5ldyBQcm94eShjcmVsLCB7XHJcbiAgICAgICAgICAgIGdldDogZnVuY3Rpb24odGFyZ2V0LCBrZXkpe1xyXG4gICAgICAgICAgICAgICAgIShrZXkgaW4gY3JlbCkgJiYgKGNyZWxba2V5XSA9IGNyZWwuYmluZChudWxsLCBrZXkpKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiBjcmVsW2tleV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gY3JlbDtcclxufSkpO1xyXG4iLCIvKipcbiAqIFJldHVybnMgYSBmdW5jdGlvbiwgdGhhdCwgYXMgbG9uZyBhcyBpdCBjb250aW51ZXMgdG8gYmUgaW52b2tlZCwgd2lsbCBub3RcbiAqIGJlIHRyaWdnZXJlZC4gVGhlIGZ1bmN0aW9uIHdpbGwgYmUgY2FsbGVkIGFmdGVyIGl0IHN0b3BzIGJlaW5nIGNhbGxlZCBmb3JcbiAqIE4gbWlsbGlzZWNvbmRzLiBJZiBgaW1tZWRpYXRlYCBpcyBwYXNzZWQsIHRyaWdnZXIgdGhlIGZ1bmN0aW9uIG9uIHRoZVxuICogbGVhZGluZyBlZGdlLCBpbnN0ZWFkIG9mIHRoZSB0cmFpbGluZy4gVGhlIGZ1bmN0aW9uIGFsc28gaGFzIGEgcHJvcGVydHkgJ2NsZWFyJyBcbiAqIHRoYXQgaXMgYSBmdW5jdGlvbiB3aGljaCB3aWxsIGNsZWFyIHRoZSB0aW1lciB0byBwcmV2ZW50IHByZXZpb3VzbHkgc2NoZWR1bGVkIGV4ZWN1dGlvbnMuIFxuICpcbiAqIEBzb3VyY2UgdW5kZXJzY29yZS5qc1xuICogQHNlZSBodHRwOi8vdW5zY3JpcHRhYmxlLmNvbS8yMDA5LzAzLzIwL2RlYm91bmNpbmctamF2YXNjcmlwdC1tZXRob2RzL1xuICogQHBhcmFtIHtGdW5jdGlvbn0gZnVuY3Rpb24gdG8gd3JhcFxuICogQHBhcmFtIHtOdW1iZXJ9IHRpbWVvdXQgaW4gbXMgKGAxMDBgKVxuICogQHBhcmFtIHtCb29sZWFufSB3aGV0aGVyIHRvIGV4ZWN1dGUgYXQgdGhlIGJlZ2lubmluZyAoYGZhbHNlYClcbiAqIEBhcGkgcHVibGljXG4gKi9cbmZ1bmN0aW9uIGRlYm91bmNlKGZ1bmMsIHdhaXQsIGltbWVkaWF0ZSl7XG4gIHZhciB0aW1lb3V0LCBhcmdzLCBjb250ZXh0LCB0aW1lc3RhbXAsIHJlc3VsdDtcbiAgaWYgKG51bGwgPT0gd2FpdCkgd2FpdCA9IDEwMDtcblxuICBmdW5jdGlvbiBsYXRlcigpIHtcbiAgICB2YXIgbGFzdCA9IERhdGUubm93KCkgLSB0aW1lc3RhbXA7XG5cbiAgICBpZiAobGFzdCA8IHdhaXQgJiYgbGFzdCA+PSAwKSB7XG4gICAgICB0aW1lb3V0ID0gc2V0VGltZW91dChsYXRlciwgd2FpdCAtIGxhc3QpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aW1lb3V0ID0gbnVsbDtcbiAgICAgIGlmICghaW1tZWRpYXRlKSB7XG4gICAgICAgIHJlc3VsdCA9IGZ1bmMuYXBwbHkoY29udGV4dCwgYXJncyk7XG4gICAgICAgIGNvbnRleHQgPSBhcmdzID0gbnVsbDtcbiAgICAgIH1cbiAgICB9XG4gIH07XG5cbiAgdmFyIGRlYm91bmNlZCA9IGZ1bmN0aW9uKCl7XG4gICAgY29udGV4dCA9IHRoaXM7XG4gICAgYXJncyA9IGFyZ3VtZW50cztcbiAgICB0aW1lc3RhbXAgPSBEYXRlLm5vdygpO1xuICAgIHZhciBjYWxsTm93ID0gaW1tZWRpYXRlICYmICF0aW1lb3V0O1xuICAgIGlmICghdGltZW91dCkgdGltZW91dCA9IHNldFRpbWVvdXQobGF0ZXIsIHdhaXQpO1xuICAgIGlmIChjYWxsTm93KSB7XG4gICAgICByZXN1bHQgPSBmdW5jLmFwcGx5KGNvbnRleHQsIGFyZ3MpO1xuICAgICAgY29udGV4dCA9IGFyZ3MgPSBudWxsO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgZGVib3VuY2VkLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRpbWVvdXQpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgIHRpbWVvdXQgPSBudWxsO1xuICAgIH1cbiAgfTtcbiAgXG4gIGRlYm91bmNlZC5mbHVzaCA9IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aW1lb3V0KSB7XG4gICAgICByZXN1bHQgPSBmdW5jLmFwcGx5KGNvbnRleHQsIGFyZ3MpO1xuICAgICAgY29udGV4dCA9IGFyZ3MgPSBudWxsO1xuICAgICAgXG4gICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICB0aW1lb3V0ID0gbnVsbDtcbiAgICB9XG4gIH07XG5cbiAgcmV0dXJuIGRlYm91bmNlZDtcbn07XG5cbi8vIEFkZHMgY29tcGF0aWJpbGl0eSBmb3IgRVMgbW9kdWxlc1xuZGVib3VuY2UuZGVib3VuY2UgPSBkZWJvdW5jZTtcblxubW9kdWxlLmV4cG9ydHMgPSBkZWJvdW5jZTtcbiIsImZ1bmN0aW9uIGZsYXRNZXJnZShhLGIpe1xuICAgIGlmKCFiIHx8IHR5cGVvZiBiICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIGIgPSB7fTtcbiAgICB9XG5cbiAgICBpZighYSB8fCB0eXBlb2YgYSAhPT0gJ29iamVjdCcpe1xuICAgICAgICBhID0gbmV3IGIuY29uc3RydWN0b3IoKTtcbiAgICB9XG5cbiAgICB2YXIgcmVzdWx0ID0gbmV3IGEuY29uc3RydWN0b3IoKSxcbiAgICAgICAgYUtleXMgPSBPYmplY3Qua2V5cyhhKSxcbiAgICAgICAgYktleXMgPSBPYmplY3Qua2V5cyhiKTtcblxuICAgIGZvcih2YXIgaSA9IDA7IGkgPCBhS2V5cy5sZW5ndGg7IGkrKyl7XG4gICAgICAgIHJlc3VsdFthS2V5c1tpXV0gPSBhW2FLZXlzW2ldXTtcbiAgICB9XG5cbiAgICBmb3IodmFyIGkgPSAwOyBpIDwgYktleXMubGVuZ3RoOyBpKyspe1xuICAgICAgICByZXN1bHRbYktleXNbaV1dID0gYltiS2V5c1tpXV07XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBmbGF0TWVyZ2U7IiwibW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbih2YWx1ZSl7XHJcbiAgICByZXR1cm4gdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyB8fCB0eXBlb2YgdmFsdWUgPT09ICdmdW5jdGlvbic7XHJcbn07IiwiLy8hIHN0YWJsZS5qcyAwLjEuOCwgaHR0cHM6Ly9naXRodWIuY29tL1R3by1TY3JlZW4vc3RhYmxlXG4vLyEgwqkgMjAxOCBBbmdyeSBCeXRlcyBhbmQgY29udHJpYnV0b3JzLiBNSVQgbGljZW5zZWQuXG5cbihmdW5jdGlvbiAoZ2xvYmFsLCBmYWN0b3J5KSB7XG4gIHR5cGVvZiBleHBvcnRzID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgbW9kdWxlICE9PSAndW5kZWZpbmVkJyA/IG1vZHVsZS5leHBvcnRzID0gZmFjdG9yeSgpIDpcbiAgdHlwZW9mIGRlZmluZSA9PT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUuYW1kID8gZGVmaW5lKGZhY3RvcnkpIDpcbiAgKGdsb2JhbC5zdGFibGUgPSBmYWN0b3J5KCkpO1xufSh0aGlzLCAoZnVuY3Rpb24gKCkgeyAndXNlIHN0cmljdCc7XG5cbiAgLy8gQSBzdGFibGUgYXJyYXkgc29ydCwgYmVjYXVzZSBgQXJyYXkjc29ydCgpYCBpcyBub3QgZ3VhcmFudGVlZCBzdGFibGUuXG4gIC8vIFRoaXMgaXMgYW4gaW1wbGVtZW50YXRpb24gb2YgbWVyZ2Ugc29ydCwgd2l0aG91dCByZWN1cnNpb24uXG5cbiAgdmFyIHN0YWJsZSA9IGZ1bmN0aW9uIChhcnIsIGNvbXApIHtcbiAgICByZXR1cm4gZXhlYyhhcnIuc2xpY2UoKSwgY29tcClcbiAgfTtcblxuICBzdGFibGUuaW5wbGFjZSA9IGZ1bmN0aW9uIChhcnIsIGNvbXApIHtcbiAgICB2YXIgcmVzdWx0ID0gZXhlYyhhcnIsIGNvbXApO1xuXG4gICAgLy8gVGhpcyBzaW1wbHkgY29waWVzIGJhY2sgaWYgdGhlIHJlc3VsdCBpc24ndCBpbiB0aGUgb3JpZ2luYWwgYXJyYXksXG4gICAgLy8gd2hpY2ggaGFwcGVucyBvbiBhbiBvZGQgbnVtYmVyIG9mIHBhc3Nlcy5cbiAgICBpZiAocmVzdWx0ICE9PSBhcnIpIHtcbiAgICAgIHBhc3MocmVzdWx0LCBudWxsLCBhcnIubGVuZ3RoLCBhcnIpO1xuICAgIH1cblxuICAgIHJldHVybiBhcnJcbiAgfTtcblxuICAvLyBFeGVjdXRlIHRoZSBzb3J0IHVzaW5nIHRoZSBpbnB1dCBhcnJheSBhbmQgYSBzZWNvbmQgYnVmZmVyIGFzIHdvcmsgc3BhY2UuXG4gIC8vIFJldHVybnMgb25lIG9mIHRob3NlIHR3bywgY29udGFpbmluZyB0aGUgZmluYWwgcmVzdWx0LlxuICBmdW5jdGlvbiBleGVjKGFyciwgY29tcCkge1xuICAgIGlmICh0eXBlb2YoY29tcCkgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGNvbXAgPSBmdW5jdGlvbiAoYSwgYikge1xuICAgICAgICByZXR1cm4gU3RyaW5nKGEpLmxvY2FsZUNvbXBhcmUoYilcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gU2hvcnQtY2lyY3VpdCB3aGVuIHRoZXJlJ3Mgbm90aGluZyB0byBzb3J0LlxuICAgIHZhciBsZW4gPSBhcnIubGVuZ3RoO1xuICAgIGlmIChsZW4gPD0gMSkge1xuICAgICAgcmV0dXJuIGFyclxuICAgIH1cblxuICAgIC8vIFJhdGhlciB0aGFuIGRpdmlkaW5nIGlucHV0LCBzaW1wbHkgaXRlcmF0ZSBjaHVua3Mgb2YgMSwgMiwgNCwgOCwgZXRjLlxuICAgIC8vIENodW5rcyBhcmUgdGhlIHNpemUgb2YgdGhlIGxlZnQgb3IgcmlnaHQgaGFuZCBpbiBtZXJnZSBzb3J0LlxuICAgIC8vIFN0b3Agd2hlbiB0aGUgbGVmdC1oYW5kIGNvdmVycyBhbGwgb2YgdGhlIGFycmF5LlxuICAgIHZhciBidWZmZXIgPSBuZXcgQXJyYXkobGVuKTtcbiAgICBmb3IgKHZhciBjaGsgPSAxOyBjaGsgPCBsZW47IGNoayAqPSAyKSB7XG4gICAgICBwYXNzKGFyciwgY29tcCwgY2hrLCBidWZmZXIpO1xuXG4gICAgICB2YXIgdG1wID0gYXJyO1xuICAgICAgYXJyID0gYnVmZmVyO1xuICAgICAgYnVmZmVyID0gdG1wO1xuICAgIH1cblxuICAgIHJldHVybiBhcnJcbiAgfVxuXG4gIC8vIFJ1biBhIHNpbmdsZSBwYXNzIHdpdGggdGhlIGdpdmVuIGNodW5rIHNpemUuXG4gIHZhciBwYXNzID0gZnVuY3Rpb24gKGFyciwgY29tcCwgY2hrLCByZXN1bHQpIHtcbiAgICB2YXIgbGVuID0gYXJyLmxlbmd0aDtcbiAgICB2YXIgaSA9IDA7XG4gICAgLy8gU3RlcCBzaXplIC8gZG91YmxlIGNodW5rIHNpemUuXG4gICAgdmFyIGRibCA9IGNoayAqIDI7XG4gICAgLy8gQm91bmRzIG9mIHRoZSBsZWZ0IGFuZCByaWdodCBjaHVua3MuXG4gICAgdmFyIGwsIHIsIGU7XG4gICAgLy8gSXRlcmF0b3JzIG92ZXIgdGhlIGxlZnQgYW5kIHJpZ2h0IGNodW5rLlxuICAgIHZhciBsaSwgcmk7XG5cbiAgICAvLyBJdGVyYXRlIG92ZXIgcGFpcnMgb2YgY2h1bmtzLlxuICAgIGZvciAobCA9IDA7IGwgPCBsZW47IGwgKz0gZGJsKSB7XG4gICAgICByID0gbCArIGNoaztcbiAgICAgIGUgPSByICsgY2hrO1xuICAgICAgaWYgKHIgPiBsZW4pIHIgPSBsZW47XG4gICAgICBpZiAoZSA+IGxlbikgZSA9IGxlbjtcblxuICAgICAgLy8gSXRlcmF0ZSBib3RoIGNodW5rcyBpbiBwYXJhbGxlbC5cbiAgICAgIGxpID0gbDtcbiAgICAgIHJpID0gcjtcbiAgICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgIC8vIENvbXBhcmUgdGhlIGNodW5rcy5cbiAgICAgICAgaWYgKGxpIDwgciAmJiByaSA8IGUpIHtcbiAgICAgICAgICAvLyBUaGlzIHdvcmtzIGZvciBhIHJlZ3VsYXIgYHNvcnQoKWAgY29tcGF0aWJsZSBjb21wYXJhdG9yLFxuICAgICAgICAgIC8vIGJ1dCBhbHNvIGZvciBhIHNpbXBsZSBjb21wYXJhdG9yIGxpa2U6IGBhID4gYmBcbiAgICAgICAgICBpZiAoY29tcChhcnJbbGldLCBhcnJbcmldKSA8PSAwKSB7XG4gICAgICAgICAgICByZXN1bHRbaSsrXSA9IGFycltsaSsrXTtcbiAgICAgICAgICB9XG4gICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICByZXN1bHRbaSsrXSA9IGFycltyaSsrXTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgLy8gTm90aGluZyB0byBjb21wYXJlLCBqdXN0IGZsdXNoIHdoYXQncyBsZWZ0LlxuICAgICAgICBlbHNlIGlmIChsaSA8IHIpIHtcbiAgICAgICAgICByZXN1bHRbaSsrXSA9IGFycltsaSsrXTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChyaSA8IGUpIHtcbiAgICAgICAgICByZXN1bHRbaSsrXSA9IGFycltyaSsrXTtcbiAgICAgICAgfVxuICAgICAgICAvLyBCb3RoIGl0ZXJhdG9ycyBhcmUgYXQgdGhlIGNodW5rIGVuZHMuXG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgIGJyZWFrXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH07XG5cbiAgcmV0dXJuIHN0YWJsZTtcblxufSkpKTtcbiIsInZhciBuYXJncyA9IC9cXHsoWzAtOWEtekEtWl0rKVxcfS9nXG52YXIgc2xpY2UgPSBBcnJheS5wcm90b3R5cGUuc2xpY2VcblxubW9kdWxlLmV4cG9ydHMgPSB0ZW1wbGF0ZVxuXG5mdW5jdGlvbiB0ZW1wbGF0ZShzdHJpbmcpIHtcbiAgICB2YXIgYXJnc1xuXG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDIgJiYgdHlwZW9mIGFyZ3VtZW50c1sxXSA9PT0gXCJvYmplY3RcIikge1xuICAgICAgICBhcmdzID0gYXJndW1lbnRzWzFdXG4gICAgfSBlbHNlIHtcbiAgICAgICAgYXJncyA9IHNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKVxuICAgIH1cblxuICAgIGlmICghYXJncyB8fCAhYXJncy5oYXNPd25Qcm9wZXJ0eSkge1xuICAgICAgICBhcmdzID0ge31cbiAgICB9XG5cbiAgICByZXR1cm4gc3RyaW5nLnJlcGxhY2UobmFyZ3MsIGZ1bmN0aW9uIHJlcGxhY2VBcmcobWF0Y2gsIGksIGluZGV4KSB7XG4gICAgICAgIHZhciByZXN1bHRcblxuICAgICAgICBpZiAoc3RyaW5nW2luZGV4IC0gMV0gPT09IFwie1wiICYmXG4gICAgICAgICAgICBzdHJpbmdbaW5kZXggKyBtYXRjaC5sZW5ndGhdID09PSBcIn1cIikge1xuICAgICAgICAgICAgcmV0dXJuIGlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlc3VsdCA9IGFyZ3MuaGFzT3duUHJvcGVydHkoaSkgPyBhcmdzW2ldIDogbnVsbFxuICAgICAgICAgICAgaWYgKHJlc3VsdCA9PT0gbnVsbCB8fCByZXN1bHQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBcIlwiXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiByZXN1bHRcbiAgICAgICAgfVxuICAgIH0pXG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHtcbiAgICAnZGVsZXRlJzoge1xuICAgICAgICB1bmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2RlbGV0ZScsXG4gICAgICAgICAgICBkaXJlY3Rpb246ICdyaWdodCcsXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAyMFxuICAgICAgICB9XG4gICAgfSxcbiAgICAnLi4uJzoge1xuICAgICAgICB1bmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ3NwcmVhZCcsXG4gICAgICAgICAgICBkaXJlY3Rpb246ICdyaWdodCcsXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxOVxuICAgICAgICB9XG4gICAgfSxcbiAgICAnLi4nOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ3JhbmdlJyxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDNcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJysnOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2FkZCcsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhKCkgKyBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTNcbiAgICAgICAgfSxcbiAgICAgICAgdW5hcnk6e1xuICAgICAgICAgICAgbmFtZTogJ3Bvc2l0aXZlJyxcbiAgICAgICAgICAgIGRpcmVjdGlvbjogJ3JpZ2h0JyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICthKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTVcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJy0nOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ3N1YnRyYWN0JyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSAtIGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxM1xuICAgICAgICB9LFxuICAgICAgICB1bmFyeTp7XG4gICAgICAgICAgICBuYW1lOiAnbmVnYXRpdmUnLFxuICAgICAgICAgICAgZGlyZWN0aW9uOiAncmlnaHQnLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gLWEoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxNVxuICAgICAgICB9XG4gICAgfSxcbiAgICAnKic6IHtcbiAgICAgICAgYmluYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAnbXVsdGlwbHknLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpICogYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDE0XG4gICAgICAgIH1cbiAgICB9LFxuICAgICcvJzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdkaXZpZGUnLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpIC8gYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDE0XG4gICAgICAgIH1cbiAgICB9LFxuICAgICclJzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdyZW1haW5kZXInLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpICUgYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDE0XG4gICAgICAgIH1cbiAgICB9LFxuICAgICdpbic6IHtcbiAgICAgICAgYmluYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAnaW4nLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpIGluIGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxMVxuICAgICAgICB9XG4gICAgfSxcbiAgICAnPT09Jzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdleGFjdGx5RXF1YWwnLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpID09PSBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTBcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJyE9PSc6IHtcbiAgICAgICAgYmluYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAnbm90RXhhY3RseUVxdWFsJyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSAhPT0gYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDEwXG4gICAgICAgIH1cbiAgICB9LFxuICAgICc9PSc6IHtcbiAgICAgICAgYmluYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAnZXF1YWwnLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpID09IGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxMFxuICAgICAgICB9XG4gICAgfSxcbiAgICAnIT0nOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ25vdEVxdWFsJyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSAhPSBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTBcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJz49Jzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdncmVhdGVyVGhhbk9yRXF1YWwnLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpID49IGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxMVxuICAgICAgICB9XG4gICAgfSxcbiAgICAnPD0nOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2xlc3NUaGFuT3JFcXVhbCcsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhKCkgPD0gYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDExXG4gICAgICAgIH1cbiAgICB9LFxuICAgICc+Jzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdncmVhdGVyVGhhbicsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhKCkgPiBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTFcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJzwnOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2xlc3NUaGFuJyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSA8IGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxMVxuICAgICAgICB9XG4gICAgfSxcbiAgICAnJiYnOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2FuZCcsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhKCkgJiYgYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDZcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJ3x8Jzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdvcicsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhKCkgfHwgYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDVcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJyEnOiB7XG4gICAgICAgIHVuYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAnbm90JyxcbiAgICAgICAgICAgIGRpcmVjdGlvbjogJ3JpZ2h0JyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICFhKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTVcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJyYnOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2JpdHdpc2VBbmQnLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpICYgYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDlcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJ14nOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2JpdHdpc2VYT3InLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpIF4gYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDhcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJ3wnOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2JpdHdpc2VPcicsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhKCkgfCBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogN1xuICAgICAgICB9XG4gICAgfSxcbiAgICAnfic6IHtcbiAgICAgICAgdW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdiaXR3aXNlTm90JyxcbiAgICAgICAgICAgIGRpcmVjdGlvbjogJ3JpZ2h0JyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIH5hKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTVcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJ3R5cGVvZic6IHtcbiAgICAgICAgdW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICd0eXBlb2YnLFxuICAgICAgICAgICAgZGlyZWN0aW9uOiAncmlnaHQnLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdHlwZW9mIGEoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxNVxuICAgICAgICB9XG4gICAgfSxcbiAgICAnPDwnOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2JpdHdpc2VMZWZ0U2hpZnQnLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpIDw8IGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxMlxuICAgICAgICB9XG4gICAgfSxcbiAgICAnPj4nOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2JpdHdpc2VSaWdodFNoaWZ0JyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSA+PiBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTJcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJz4+Pic6IHtcbiAgICAgICAgYmluYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAnYml0d2lzZVVuc2lnbmVkUmlnaHRTaGlmdCcsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhKCkgPj4+IGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxMlxuICAgICAgICB9XG4gICAgfSxcbiAgICAnPSc6IHtcbiAgICAgICAgYmluYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAnYXNzaWdubWVudCcsXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxMlxuICAgICAgICB9XG4gICAgfSxcbiAgICAnPyc6IHtcbiAgICAgICAgdHJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ3Rlcm5hcnknLFxuICAgICAgICAgICAgdHJpbmFyeTogJ3R1cGxlJyxcbiAgICAgICAgICAgIGFzc29jaWF0aXZpdHk6ICdyaWdodCcsXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiA0XG4gICAgICAgIH1cbiAgICB9LFxuICAgICc6Jzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICd0dXBsZScsXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAzXG4gICAgICAgIH1cbiAgICB9XG59OyIsInZhciBvcGVyYXRvcnMgPSByZXF1aXJlKCcuL29wZXJhdG9ycycpLFxuICAgIHN0YWJsZVNvcnQgPSByZXF1aXJlKCdzdGFibGUnKSxcbiAgICBwcmludEVycm9yID0gcmVxdWlyZSgnLi9wcmludEVycm9yJyk7XG5cbmZ1bmN0aW9uIHBhcnNlRXJyb3IobWVzc2FnZSwgdG9rZW4pe1xuICAgIHRocm93IHByaW50RXJyb3IobWVzc2FnZSwgdG9rZW4pO1xufVxuXG5mdW5jdGlvbiBmaW5kTmV4dE5vbkRlbGltaXRlcih0b2tlbnMpe1xuICAgIHZhciByZXN1bHQ7XG5cbiAgICB3aGlsZShyZXN1bHQgPSB0b2tlbnMuc2hpZnQoKSl7XG4gICAgICAgIGlmKCFyZXN1bHQgfHwgcmVzdWx0LnR5cGUgIT09ICdkZWxpbWl0ZXInKXtcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIGxhc3RUb2tlbk1hdGNoZXMoYXN0LCB0eXBlcywgcG9wKXtcbiAgICB2YXIgbGFzdFRva2VuID0gYXN0W2FzdC5sZW5ndGggLSAxXSxcbiAgICAgICAgbGFzdFRva2VuVHlwZSxcbiAgICAgICAgbWF0Y2hlZDtcblxuICAgIGlmKCFsYXN0VG9rZW4pe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgbGFzdFRva2VuVHlwZSA9IGxhc3RUb2tlbi50eXBlO1xuXG4gICAgZm9yICh2YXIgaSA9IHR5cGVzLmxlbmd0aC0xLCB0eXBlID0gdHlwZXNbaV07IGkgPj0gMDsgaS0tLCB0eXBlID0gdHlwZXNbaV0pIHtcbiAgICAgICAgaWYodHlwZSA9PT0gJyEnICsgbGFzdFRva2VuVHlwZSl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZih0eXBlID09PSAnKicgfHwgdHlwZSA9PT0gbGFzdFRva2VuVHlwZSl7XG4gICAgICAgICAgICBtYXRjaGVkID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGlmKCFtYXRjaGVkKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmKHBvcCl7XG4gICAgICAgIGFzdC5wb3AoKTtcbiAgICB9XG4gICAgcmV0dXJuIGxhc3RUb2tlbjtcbn1cblxuZnVuY3Rpb24gcGFyc2VJZGVudGlmaWVyKHRva2VucywgYXN0KXtcbiAgICBpZih0b2tlbnNbMF0udHlwZSA9PT0gJ3dvcmQnKXtcbiAgICAgICAgYXN0LnB1c2goe1xuICAgICAgICAgICAgc291cmNlVG9rZW46IHRva2Vuc1swXSxcbiAgICAgICAgICAgIHR5cGU6ICdpZGVudGlmaWVyJyxcbiAgICAgICAgICAgIG5hbWU6IHRva2Vucy5zaGlmdCgpLnNvdXJjZVxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZU51bWJlcih0b2tlbnMsIGFzdCl7XG4gICAgaWYodG9rZW5zWzBdLnR5cGUgPT09ICdudW1iZXInKXtcbiAgICAgICAgYXN0LnB1c2goe1xuICAgICAgICAgICAgc291cmNlVG9rZW46IHRva2Vuc1swXSxcbiAgICAgICAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgICAgICAgdmFsdWU6IHBhcnNlRmxvYXQodG9rZW5zLnNoaWZ0KCkuc291cmNlKVxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBmdW5jdGlvbkNhbGwodGFyZ2V0LCBjb250ZW50KXtcbiAgICByZXR1cm4ge1xuICAgICAgICBzb3VyY2VUb2tlbjogdGFyZ2V0LFxuICAgICAgICB0eXBlOiAnZnVuY3Rpb25DYWxsJyxcbiAgICAgICAgdGFyZ2V0OiB0YXJnZXQsXG4gICAgICAgIGNvbnRlbnQ6IGNvbnRlbnRcbiAgICB9O1xufVxuXG5mdW5jdGlvbiBwYXJzZVBhcmVudGhlc2lzKHRva2VucywgYXN0KSB7XG4gICAgaWYodG9rZW5zWzBdLnR5cGUgIT09ICdwYXJlbnRoZXNpc09wZW4nKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBvcGVuVG9rZW4gPSB0b2tlbnNbMF0sXG4gICAgICAgIHBvc2l0aW9uID0gMCxcbiAgICAgICAgb3BlbnMgPSAxO1xuXG4gICAgd2hpbGUoKytwb3NpdGlvbiwgcG9zaXRpb24gPD0gdG9rZW5zLmxlbmd0aCAmJiBvcGVucyl7XG4gICAgICAgIGlmKCF0b2tlbnNbcG9zaXRpb25dKXtcbiAgICAgICAgICAgIHBhcnNlRXJyb3IoJ2ludmFsaWQgbmVzdGluZy4gTm8gY2xvc2luZyB0b2tlbiB3YXMgZm91bmQnLCB0b2tlbnNbcG9zaXRpb24tMV0pO1xuICAgICAgICB9XG4gICAgICAgIGlmKHRva2Vuc1twb3NpdGlvbl0udHlwZSA9PT0gJ3BhcmVudGhlc2lzT3BlbicpIHtcbiAgICAgICAgICAgIG9wZW5zKys7XG4gICAgICAgIH1cbiAgICAgICAgaWYodG9rZW5zW3Bvc2l0aW9uXS50eXBlID09PSAncGFyZW50aGVzaXNDbG9zZScpIHtcbiAgICAgICAgICAgIG9wZW5zLS07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB2YXIgdGFyZ2V0ID0gIW9wZW5Ub2tlbi5kZWxpbWl0ZXJQcmVmaXggJiYgbGFzdFRva2VuTWF0Y2hlcyhhc3QsIFsnKicsICchc3RhdGVtZW50JywgJyFvcGVyYXRvcicsICchc2V0J10sIHRydWUpLFxuICAgICAgICBjb250ZW50ID0gcGFyc2UodG9rZW5zLnNwbGljZSgwLCBwb3NpdGlvbikuc2xpY2UoMSwtMSkpLFxuICAgICAgICBhc3ROb2RlO1xuXG4gICAgaWYodGFyZ2V0KXtcbiAgICAgICAgYXN0Tm9kZSA9IGZ1bmN0aW9uQ2FsbCh0YXJnZXQsIGNvbnRlbnQpO1xuICAgIH1lbHNle1xuICAgICAgICBhc3ROb2RlID0ge1xuICAgICAgICAgICAgc291cmNlVG9rZW46IG9wZW5Ub2tlbixcbiAgICAgICAgICAgIHR5cGU6ICdwYXJlbnRoZXNpc0dyb3VwJyxcbiAgICAgICAgICAgIGNvbnRlbnQ6IGNvbnRlbnRcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBhc3QucHVzaChhc3ROb2RlKTtcblxuICAgIHJldHVybiB0cnVlO1xufVxuXG5mdW5jdGlvbiBwYXJzZVBhcmFtZXRlcnMoZnVuY3Rpb25DYWxsKXtcbiAgICByZXR1cm4gZnVuY3Rpb25DYWxsLmNvbnRlbnQubWFwKGZ1bmN0aW9uKHRva2VuKXtcbiAgICAgICAgaWYodG9rZW4udHlwZSA9PT0gJ2lkZW50aWZpZXInIHx8ICh0b2tlbi5uYW1lID09PSAnc3ByZWFkJyAmJiB0b2tlbi5yaWdodC50eXBlID09PSAnaWRlbnRpZmllcicpKXtcbiAgICAgICAgICAgIHJldHVybiB0b2tlbjtcbiAgICAgICAgfVxuXG4gICAgICAgIHBhcnNlRXJyb3IoJ1VuZXhwZWN0ZWQgdG9rZW4gaW4gcGFyYW1ldGVyIGxpc3QnLCBmdW5jdGlvbkNhbGwpO1xuICAgIH0pO1xufVxuXG5mdW5jdGlvbiBuYW1lZEZ1bmN0aW9uRXhwcmVzc2lvbihzb3VyY2VUb2tlbiwgZnVuY3Rpb25DYWxsLCBjb250ZW50KXtcbiAgICBpZihmdW5jdGlvbkNhbGwudGFyZ2V0LnR5cGUgIT09ICdpZGVudGlmaWVyJyl7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBzb3VyY2VUb2tlbixcbiAgICAgICAgdHlwZTogJ2Z1bmN0aW9uRXhwcmVzc2lvbicsXG4gICAgICAgIGlkZW50aWZpZXI6IGZ1bmN0aW9uQ2FsbC50YXJnZXQsXG4gICAgICAgIHBhcmFtZXRlcnM6IHBhcnNlUGFyYW1ldGVycyhmdW5jdGlvbkNhbGwpLFxuICAgICAgICBjb250ZW50OiBjb250ZW50XG4gICAgfTtcbn1cblxuZnVuY3Rpb24gYW5vbnltb3VzRnVuY3Rpb25FeHByZXNzaW9uKHNvdXJjZVRva2VuLCBwYXJlbnRoZXNpc0dyb3VwLCBjb250ZW50KXtcbiAgICByZXR1cm4ge1xuICAgICAgICBzb3VyY2VUb2tlbixcbiAgICAgICAgdHlwZTogJ2Z1bmN0aW9uRXhwcmVzc2lvbicsXG4gICAgICAgIHBhcmFtZXRlcnM6IHBhcnNlUGFyYW1ldGVycyhwYXJlbnRoZXNpc0dyb3VwKSxcbiAgICAgICAgY29udGVudDogY29udGVudFxuICAgIH07XG59XG5cbmZ1bmN0aW9uIHBhcnNlQmxvY2sodG9rZW5zLCBhc3Qpe1xuICAgIGlmKHRva2Vuc1swXS50eXBlICE9PSAnYnJhY2VPcGVuJyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgd2FzRGVsaW1pdGVyUHJlZml4ZWQgPSB0b2tlbnNbMF0uZGVsaW1pdGVyUHJlZml4LFxuICAgICAgICBwb3NpdGlvbiA9IDAsXG4gICAgICAgIG9wZW5zID0gMTtcblxuICAgIHdoaWxlKCsrcG9zaXRpb24sIHBvc2l0aW9uIDw9IHRva2Vucy5sZW5ndGggJiYgb3BlbnMpe1xuICAgICAgICBpZighdG9rZW5zW3Bvc2l0aW9uXSl7XG4gICAgICAgICAgICBwYXJzZUVycm9yKCdpbnZhbGlkIG5lc3RpbmcuIE5vIGNsb3NpbmcgdG9rZW4gd2FzIGZvdW5kJywgdG9rZW5zW3Bvc2l0aW9uLTFdKTtcbiAgICAgICAgfVxuICAgICAgICBpZih0b2tlbnNbcG9zaXRpb25dLnR5cGUgPT09ICdicmFjZU9wZW4nKXtcbiAgICAgICAgICAgIG9wZW5zKys7XG4gICAgICAgIH1cbiAgICAgICAgaWYodG9rZW5zW3Bvc2l0aW9uXS50eXBlID09PSAnYnJhY2VDbG9zZScpe1xuICAgICAgICAgICAgb3BlbnMtLTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHZhciB0YXJnZXRUb2tlbiA9IHRva2Vuc1swXSxcbiAgICAgICAgY29udGVudCA9IHBhcnNlKHRva2Vucy5zcGxpY2UoMCwgcG9zaXRpb24pLnNsaWNlKDEsLTEpKTtcblxuICAgIHZhciBmdW5jdGlvbkNhbGwgPSAhd2FzRGVsaW1pdGVyUHJlZml4ZWQgJiYgbGFzdFRva2VuTWF0Y2hlcyhhc3QsIFsnZnVuY3Rpb25DYWxsJ10sIHRydWUpLFxuICAgICAgICBwYXJlbnRoZXNpc0dyb3VwID0gIXdhc0RlbGltaXRlclByZWZpeGVkICYmIGxhc3RUb2tlbk1hdGNoZXMoYXN0LCBbJ3BhcmVudGhlc2lzR3JvdXAnXSwgdHJ1ZSksXG4gICAgICAgIGFzdE5vZGU7XG5cbiAgICBpZihmdW5jdGlvbkNhbGwpe1xuICAgICAgICBhc3ROb2RlID0gbmFtZWRGdW5jdGlvbkV4cHJlc3Npb24odGFyZ2V0VG9rZW4sIGZ1bmN0aW9uQ2FsbCwgY29udGVudCk7XG4gICAgfWVsc2UgaWYocGFyZW50aGVzaXNHcm91cCl7XG4gICAgICAgIGFzdE5vZGUgPSBhbm9ueW1vdXNGdW5jdGlvbkV4cHJlc3Npb24odGFyZ2V0VG9rZW4sIHBhcmVudGhlc2lzR3JvdXAsIGNvbnRlbnQpO1xuICAgIH1lbHNle1xuICAgICAgICBhc3ROb2RlID0ge1xuICAgICAgICAgICAgc291cmNlVG9rZW46IHRhcmdldFRva2VuLFxuICAgICAgICAgICAgdHlwZTogJ2JyYWNlR3JvdXAnLFxuICAgICAgICAgICAgY29udGVudDogY29udGVudFxuICAgICAgICB9XG4gICAgfVxuXG4gICAgaWYoIWFzdE5vZGUpe1xuICAgICAgICBwYXJzZUVycm9yKCd1bmV4cGVjdGVkIHRva2VuLicsIHRhcmdldFRva2VuKTtcbiAgICB9XG5cbiAgICBhc3QucHVzaChhc3ROb2RlKTtcblxuICAgIHJldHVybiB0cnVlO1xufVxuXG5mdW5jdGlvbiBwYXJzZVNldCh0b2tlbnMsIGFzdCkge1xuICAgIGlmKHRva2Vuc1swXS50eXBlICE9PSAnc3F1YXJlQnJhY2VPcGVuJyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgb3BlblRva2VuID0gdG9rZW5zWzBdLFxuICAgICAgICBwb3NpdGlvbiA9IDAsXG4gICAgICAgIG9wZW5zID0gMTtcblxuICAgIHdoaWxlKCsrcG9zaXRpb24sIHBvc2l0aW9uIDw9IHRva2Vucy5sZW5ndGggJiYgb3BlbnMpe1xuICAgICAgICBpZighdG9rZW5zW3Bvc2l0aW9uXSl7XG4gICAgICAgICAgICBwYXJzZUVycm9yKCdpbnZhbGlkIG5lc3RpbmcuIE5vIGNsb3NpbmcgdG9rZW4gd2FzIGZvdW5kJywgdG9rZW5zW3Bvc2l0aW9uLTFdKTtcbiAgICAgICAgfVxuICAgICAgICBpZih0b2tlbnNbcG9zaXRpb25dLnR5cGUgPT09ICdzcXVhcmVCcmFjZU9wZW4nKSB7XG4gICAgICAgICAgICBvcGVucysrO1xuICAgICAgICB9XG4gICAgICAgIGlmKHRva2Vuc1twb3NpdGlvbl0udHlwZSA9PT0gJ3NxdWFyZUJyYWNlQ2xvc2UnKSB7XG4gICAgICAgICAgICBvcGVucy0tO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgdmFyIGNvbnRlbnQgPSBwYXJzZSh0b2tlbnMuc3BsaWNlKDAsIHBvc2l0aW9uKS5zbGljZSgxLC0xKSksXG4gICAgICAgIHRhcmdldCA9ICFvcGVuVG9rZW4uZGVsaW1pdGVyUHJlZml4ICYmIGxhc3RUb2tlbk1hdGNoZXMoYXN0LCBbJyonLCAnIWZ1bmN0aW9uRXhwcmVzc2lvbicsICchYnJhY2VHcm91cCcsICchc3RhdGVtZW50JywgJyFvcGVyYXRvciddLCB0cnVlKTtcblxuICAgIGlmKHRhcmdldCl7XG4gICAgICAgIGFzdC5wdXNoKHtcbiAgICAgICAgICAgIHNvdXJjZVRva2VuOiBvcGVuVG9rZW4sXG4gICAgICAgICAgICB0eXBlOiAnYWNjZXNzb3InLFxuICAgICAgICAgICAgdGFyZ2V0OiB0YXJnZXQsXG4gICAgICAgICAgICBjb250ZW50OiBjb250ZW50XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIGFzdC5wdXNoKHtcbiAgICAgICAgc291cmNlVG9rZW46IG9wZW5Ub2tlbixcbiAgICAgICAgdHlwZTogJ3NldCcsXG4gICAgICAgIGNvbnRlbnQ6IGNvbnRlbnRcbiAgICB9KTtcblxuICAgIHJldHVybiB0cnVlO1xufVxuXG5cbmZ1bmN0aW9uIHBhcnNlRGVsaW1pdGVycyh0b2tlbnMpe1xuICAgIGlmKHRva2Vuc1swXS50eXBlID09PSAnZGVsaW1pdGVyJyl7XG4gICAgICAgIHRva2Vucy5zcGxpY2UoMCwxKTtcbiAgICAgICAgaWYodG9rZW5zWzBdKXtcbiAgICAgICAgICAgIHRva2Vuc1swXS5kZWxpbWl0ZXJQcmVmaXggPSB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VDb21tZW50cyh0b2tlbnMpe1xuICAgIGlmKHRva2Vuc1swXS50eXBlID09PSAnY29tbWVudCcpe1xuICAgICAgICB0b2tlbnMuc2hpZnQoKTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZU9wZXJhdG9yKHRva2VucywgYXN0KXtcbiAgICBpZih0b2tlbnNbMF0udHlwZSA9PT0gJ29wZXJhdG9yJyl7XG4gICAgICAgIHZhciB0b2tlbiA9IHRva2Vucy5zaGlmdCgpLFxuICAgICAgICAgICAgb3BlcmF0b3JzRm9yU291cmNlID0gb3BlcmF0b3JzW3Rva2VuLnNvdXJjZV0sXG4gICAgICAgICAgICBzdGFydE9mU3RhdGVtZW50ID0gIWxhc3RUb2tlbk1hdGNoZXMoYXN0LCBbJyonLCAnIXN0YXRlbWVudCcsICchb3BlcmF0b3InXSk7XG5cbiAgICAgICAgaWYob3BlcmF0b3JzRm9yU291cmNlLmJpbmFyeSAmJiAhc3RhcnRPZlN0YXRlbWVudCAmJlxuICAgICAgICAgICAgIShcbiAgICAgICAgICAgICAgICBvcGVyYXRvcnNGb3JTb3VyY2UudW5hcnkgJiZcbiAgICAgICAgICAgICAgICAoXG4gICAgICAgICAgICAgICAgICAgIHRva2VuLmRlbGltaXRlclByZWZpeCAmJlxuICAgICAgICAgICAgICAgICAgICB0b2tlbnNbMF0udHlwZSAhPT0gJ2RlbGltaXRlcidcbiAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICApXG4gICAgICAgICl7XG4gICAgICAgICAgICBhc3QucHVzaCh7XG4gICAgICAgICAgICAgICAgc291cmNlVG9rZW46IHRva2VuLFxuICAgICAgICAgICAgICAgIHR5cGU6ICdvcGVyYXRvcicsXG4gICAgICAgICAgICAgICAgbmFtZTogb3BlcmF0b3JzRm9yU291cmNlLmJpbmFyeS5uYW1lLFxuICAgICAgICAgICAgICAgIG9wZXJhdG9yOiBvcGVyYXRvcnNGb3JTb3VyY2UuYmluYXJ5LFxuICAgICAgICAgICAgICAgIHNvdXJjZVJlZjogdG9rZW4uc291cmNlUmVmLFxuICAgICAgICAgICAgICAgIGluZGV4OiB0b2tlbi5pbmRleFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKG9wZXJhdG9yc0ZvclNvdXJjZS51bmFyeSl7XG4gICAgICAgICAgICBhc3QucHVzaCh7XG4gICAgICAgICAgICAgICAgc291cmNlVG9rZW46IHRva2VuLFxuICAgICAgICAgICAgICAgIHR5cGU6ICdvcGVyYXRvcicsXG4gICAgICAgICAgICAgICAgbmFtZTogb3BlcmF0b3JzRm9yU291cmNlLnVuYXJ5Lm5hbWUsXG4gICAgICAgICAgICAgICAgb3BlcmF0b3I6IG9wZXJhdG9yc0ZvclNvdXJjZS51bmFyeSxcbiAgICAgICAgICAgICAgICBzb3VyY2VSZWY6IHRva2VuLnNvdXJjZVJlZixcbiAgICAgICAgICAgICAgICBpbmRleDogdG9rZW4uaW5kZXhcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cblxuXG4gICAgICAgIGlmKG9wZXJhdG9yc0ZvclNvdXJjZS50cmluYXJ5ICYmICFzdGFydE9mU3RhdGVtZW50KXtcbiAgICAgICAgICAgIGFzdC5wdXNoKHtcbiAgICAgICAgICAgICAgICBzb3VyY2VUb2tlbjogdG9rZW4sXG4gICAgICAgICAgICAgICAgdHlwZTogJ29wZXJhdG9yJyxcbiAgICAgICAgICAgICAgICBuYW1lOiBvcGVyYXRvcnNGb3JTb3VyY2UudHJpbmFyeS5uYW1lLFxuICAgICAgICAgICAgICAgIG9wZXJhdG9yOiBvcGVyYXRvcnNGb3JTb3VyY2UudHJpbmFyeSxcbiAgICAgICAgICAgICAgICBzb3VyY2VSZWY6IHRva2VuLnNvdXJjZVJlZixcbiAgICAgICAgICAgICAgICBpbmRleDogdG9rZW4uaW5kZXhcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICBwYXJzZUVycm9yKCdVbmV4cGVjdGVkIHRva2VuJywgdG9rZW4pO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VQZXJpb2QodG9rZW5zLCBhc3Qpe1xuICAgIGlmKHRva2Vuc1swXS50eXBlID09PSAncGVyaW9kJyl7XG4gICAgICAgIHZhciB0b2tlbiA9IHRva2Vucy5zaGlmdCgpLFxuICAgICAgICAgICAgcmlnaHQgPSBmaW5kTmV4dE5vbkRlbGltaXRlcih0b2tlbnMpO1xuXG4gICAgICAgIGlmKCFyaWdodCl7XG4gICAgICAgICAgICByZXR1cm4gcGFyc2VFcnJvcignVW5leHBlY3RlZCB0b2tlbicsIHRva2VuKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGFzdC5wdXNoKHtcbiAgICAgICAgICAgIHNvdXJjZVRva2VuOiB0b2tlbixcbiAgICAgICAgICAgIHR5cGU6ICdwZXJpb2QnLFxuICAgICAgICAgICAgbGVmdDogYXN0LnBvcCgpLFxuICAgICAgICAgICAgcmlnaHQ6IHBhcnNlVG9rZW4oW3JpZ2h0XSkucG9wKClcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZVN0cmluZyh0b2tlbnMsIGFzdCl7XG4gICAgaWYodG9rZW5zWzBdLnR5cGUgPT09ICdzdHJpbmcnKXtcbiAgICAgICAgYXN0LnB1c2goe1xuICAgICAgICAgICAgc291cmNlVG9rZW46IHRva2Vuc1swXSxcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgdmFsdWU6IEpTT04ucGFyc2UoJ1wiJyArIHRva2Vucy5zaGlmdCgpLnNvdXJjZS5zbGljZSgxLC0xKSArICdcIicpXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlU2VtaWNvbG9uKHRva2VucywgYXN0KXtcbiAgICBpZih0b2tlbnNbMF0udHlwZSA9PT0gJ3NlbWljb2xvbicpe1xuICAgICAgICBhc3QucHVzaCh7XG4gICAgICAgICAgICBzb3VyY2VUb2tlbjogdG9rZW5zLnNoaWZ0KCksXG4gICAgICAgICAgICB0eXBlOiAnc3RhdGVtZW50JyxcbiAgICAgICAgICAgIGNvbnRlbnQ6IFthc3QucG9wKCldXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG59XG5cbnZhciBwYXJzZXJzID0gW1xuICAgIHBhcnNlRGVsaW1pdGVycyxcbiAgICBwYXJzZUNvbW1lbnRzLFxuICAgIHBhcnNlTnVtYmVyLFxuICAgIHBhcnNlU3RyaW5nLFxuICAgIHBhcnNlSWRlbnRpZmllcixcbiAgICBwYXJzZVBlcmlvZCxcbiAgICBwYXJzZVBhcmVudGhlc2lzLFxuICAgIHBhcnNlU2V0LFxuICAgIHBhcnNlQmxvY2ssXG4gICAgcGFyc2VPcGVyYXRvcixcbiAgICBwYXJzZVNlbWljb2xvblxuXTtcblxuZnVuY3Rpb24gcGFyc2VPcGVyYXRvcnMoYXN0KXtcbiAgICBzdGFibGVTb3J0KGFzdC5maWx0ZXIoZnVuY3Rpb24odG9rZW4pe1xuICAgICAgICByZXR1cm4gdG9rZW4udHlwZSA9PT0gJ29wZXJhdG9yJztcbiAgICB9KSwgZnVuY3Rpb24oYSxiKXtcbiAgICAgICAgaWYoYS5vcGVyYXRvci5wcmVjZWRlbmNlID09PSBiLm9wZXJhdG9yLnByZWNlZGVuY2UgJiYgYS5vcGVyYXRvci5hc3NvY2lhdGl2aXR5ID09PSAncmlnaHQnKXtcbiAgICAgICAgICAgIHJldHVybiAxO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGIub3BlcmF0b3IucHJlY2VkZW5jZSAtIGEub3BlcmF0b3IucHJlY2VkZW5jZTtcbiAgICB9KVxuICAgIC5mb3JFYWNoKGZ1bmN0aW9uKHRva2VuKXtcbiAgICAgICAgdmFyIGluZGV4ID0gYXN0LmluZGV4T2YodG9rZW4pLFxuICAgICAgICAgICAgb3BlcmF0b3IgPSB0b2tlbi5vcGVyYXRvcixcbiAgICAgICAgICAgIGxlZnQsXG4gICAgICAgICAgICBtaWRkbGUsXG4gICAgICAgICAgICByaWdodDtcblxuICAgICAgICAvLyBUb2tlbiB3YXMgcGFyc2VkIGJ5IHNvbWUgb3RoZXIgcGFyc2VyIHN0ZXAuXG4gICAgICAgIGlmKCF+aW5kZXgpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYob3BlcmF0b3IudHJpbmFyeSl7XG4gICAgICAgICAgICBsZWZ0ID0gYXN0LnNwbGljZShpbmRleC0xLDEpO1xuICAgICAgICAgICAgbWlkZGxlID0gYXN0LnNwbGljZShpbmRleCwxKTtcbiAgICAgICAgICAgIHZhciB0cmluYXJ5ID0gYXN0LnNwbGljZShpbmRleCwxKTtcbiAgICAgICAgICAgIHJpZ2h0ID0gYXN0LnNwbGljZShpbmRleCwxKTtcbiAgICAgICAgICAgIGlmKCF0cmluYXJ5Lmxlbmd0aCB8fCB0cmluYXJ5WzBdLm5hbWUgIT09IG9wZXJhdG9yLnRyaW5hcnkpe1xuICAgICAgICAgICAgICAgIHBhcnNlRXJyb3IoJ1VuZXhwZWN0ZWQgdG9rZW4uJywgdG9rZW4pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9ZWxzZSBpZihvcGVyYXRvci5kaXJlY3Rpb24gPT09ICdsZWZ0Jyl7XG4gICAgICAgICAgICBsZWZ0ID0gYXN0LnNwbGljZShpbmRleC0xLDEpO1xuICAgICAgICB9ZWxzZSBpZihvcGVyYXRvci5kaXJlY3Rpb24gPT09ICdyaWdodCcpe1xuICAgICAgICAgICAgcmlnaHQgPSBhc3Quc3BsaWNlKGluZGV4ICsgMSwxKTtcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICBsZWZ0ID0gYXN0LnNwbGljZShpbmRleC0xLDEpO1xuICAgICAgICAgICAgcmlnaHQgPSBhc3Quc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKFxuICAgICAgICAgICAgbGVmdCAmJiBsZWZ0Lmxlbmd0aCAhPT0gMSB8fFxuICAgICAgICAgICAgbWlkZGxlICYmIG1pZGRsZS5sZW5ndGggIT09IDEgfHxcbiAgICAgICAgICAgIHJpZ2h0ICYmIHJpZ2h0Lmxlbmd0aCAhPT0gMVxuICAgICAgICApe1xuICAgICAgICAgICAgcGFyc2VFcnJvcigndW5leHBlY3RlZCB0b2tlbi4nLCB0b2tlbik7XG4gICAgICAgIH1cblxuICAgICAgICBpZihvcGVyYXRvci5uYW1lID09PSAnYXNzaWdubWVudCcgJiYgbGVmdFswXS50eXBlICE9PSAnaWRlbnRpZmllcicpe1xuICAgICAgICAgICAgcGFyc2VFcnJvcignVW5leHBlY3RlZCB0b2tlbi4nLCB0b2tlbik7XG4gICAgICAgIH1cblxuICAgICAgICBpZihsZWZ0KXtcbiAgICAgICAgICAgIHRva2VuLmxlZnQgPSBsZWZ0WzBdO1xuICAgICAgICB9XG4gICAgICAgIGlmKG1pZGRsZSl7XG4gICAgICAgICAgICB0b2tlbi5taWRkbGUgPSBtaWRkbGVbMF07XG4gICAgICAgIH1cbiAgICAgICAgaWYocmlnaHQpe1xuICAgICAgICAgICAgdG9rZW4ucmlnaHQgPSByaWdodFswXTtcbiAgICAgICAgfVxuICAgIH0pO1xufVxuXG5mdW5jdGlvbiBwYXJzZVRva2VuKHRva2VucywgYXN0KXtcbiAgICBpZighYXN0KXtcbiAgICAgICAgYXN0ID0gW107XG4gICAgfVxuXG4gICAgZm9yKHZhciBpID0gMDsgaSA8PSBwYXJzZXJzLmxlbmd0aCAmJiB0b2tlbnMubGVuZ3RoOyBpKyspe1xuICAgICAgICBpZihpID09PSBwYXJzZXJzLmxlbmd0aCAmJiB0b2tlbnMubGVuZ3RoKXtcbiAgICAgICAgICAgIHBhcnNlRXJyb3IoJ3Vua25vd24gdG9rZW4nLCB0b2tlbnNbMF0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYocGFyc2Vyc1tpXSh0b2tlbnMsIGFzdCkpe1xuICAgICAgICAgICAgcmV0dXJuIGFzdDtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gcGFyc2UodG9rZW5zLCBtdXRhdGUpe1xuICAgIHZhciBhc3QgPSBbXTtcblxuICAgIGlmKCFtdXRhdGUpe1xuICAgICAgICB0b2tlbnMgPSB0b2tlbnMuc2xpY2UoKTtcbiAgICB9XG5cbiAgICB3aGlsZSh0b2tlbnMubGVuZ3RoKXtcbiAgICAgICAgcGFyc2VUb2tlbih0b2tlbnMsIGFzdCk7XG4gICAgfVxuXG4gICAgcGFyc2VPcGVyYXRvcnMoYXN0KTtcblxuICAgIHJldHVybiBhc3Q7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gcGFyc2U7IiwidmFyIHRlbXBsYXRlID0gcmVxdWlyZSgnc3RyaW5nLXRlbXBsYXRlJyksXG4gICAgZXJyb3JUZW1wbGF0ZSA9ICdQYXJzZSBlcnJvcixcXG57bWVzc2FnZX0sXFxuQXQge2luZGV4fSBcIntzbmlwcGV0fVwiJyxcbiAgICBzbmlwcGV0VGVtcGxhdGUgPSAnLS0+ezB9PC0tJztcblxuZnVuY3Rpb24gcHJpbnRFcnJvcihtZXNzYWdlLCB0b2tlbil7XG4gICAgdmFyIHN0YXJ0ID0gTWF0aC5tYXgodG9rZW4uaW5kZXggLSA1MCwgMCksXG4gICAgICAgIGVycm9ySW5kZXggPSBNYXRoLm1pbig1MCwgdG9rZW4uaW5kZXgpLFxuICAgICAgICBzdXJyb3VuZGluZ1NvdXJjZSA9IHRva2VuLnNvdXJjZVJlZi5zb3VyY2Uuc2xpY2Uoc3RhcnQsIHRva2VuLmluZGV4ICsgNTApLFxuICAgICAgICBlcnJvck1lc3NhZ2UgPSB0ZW1wbGF0ZShlcnJvclRlbXBsYXRlLCB7XG4gICAgICAgICAgICBtZXNzYWdlOiBtZXNzYWdlLFxuICAgICAgICAgICAgaW5kZXg6IHRva2VuLmluZGV4LFxuICAgICAgICAgICAgc25pcHBldDogW1xuICAgICAgICAgICAgICAgIChzdGFydCA9PT0gMCA/ICcnIDogJy4uLlxcbicpLFxuICAgICAgICAgICAgICAgIHN1cnJvdW5kaW5nU291cmNlLnNsaWNlKDAsIGVycm9ySW5kZXgpLFxuICAgICAgICAgICAgICAgIHRlbXBsYXRlKHNuaXBwZXRUZW1wbGF0ZSwgc3Vycm91bmRpbmdTb3VyY2Uuc2xpY2UoZXJyb3JJbmRleCwgZXJyb3JJbmRleCsxKSksXG4gICAgICAgICAgICAgICAgc3Vycm91bmRpbmdTb3VyY2Uuc2xpY2UoZXJyb3JJbmRleCArIDEpICsgJycsXG4gICAgICAgICAgICAgICAgKHN1cnJvdW5kaW5nU291cmNlLmxlbmd0aCA8IDEwMCA/ICcnIDogJy4uLicpXG4gICAgICAgICAgICBdLmpvaW4oJycpXG4gICAgICAgIH0pO1xuXG4gICAgcmV0dXJuIGVycm9yTWVzc2FnZTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBwcmludEVycm9yOyIsInZhciB0b1ZhbHVlID0gcmVxdWlyZSgnLi90b1ZhbHVlJyk7XG5cbmZ1bmN0aW9uIHdyYXBTY29wZShfX3Njb3BlX18pe1xuICAgIHZhciBzY29wZSA9IG5ldyBTY29wZSgpO1xuICAgIHNjb3BlLl9fc2NvcGVfXyA9IF9fc2NvcGVfXztcbiAgICByZXR1cm4gc2NvcGU7XG59XG5cbmZ1bmN0aW9uIFNjb3BlKG9sZFNjb3BlLCBkZWJ1Zyl7XG4gICAgdGhpcy5fX3Njb3BlX18gPSB7fTtcbiAgICB0aGlzLl9kZWJ1ZyA9IGRlYnVnO1xuICAgIGlmKG9sZFNjb3BlKXtcbiAgICAgICAgdGhpcy5fX291dGVyU2NvcGVfXyA9IG9sZFNjb3BlIGluc3RhbmNlb2YgU2NvcGUgPyBvbGRTY29wZSA6IHdyYXBTY29wZShvbGRTY29wZSk7XG4gICAgICAgIHRoaXMuX2RlYnVnID0gdGhpcy5fX291dGVyU2NvcGVfXy5fZGVidWc7XG4gICAgfVxufVxuU2NvcGUucHJvdG90eXBlLnRocm93ID0gZnVuY3Rpb24obWVzc2FnZSl7XG4gICAgdGhpcy5fZXJyb3IgPSBuZXcgRXJyb3IoJ1ByZXNoIGV4ZWN1dGlvbiBlcnJvcjogJyArIG1lc3NhZ2UpO1xuICAgIHRoaXMuX2Vycm9yLnNjb3BlID0gdGhpcztcbn07XG5TY29wZS5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oa2V5KXtcbiAgICB2YXIgc2NvcGUgPSB0aGlzO1xuICAgIHdoaWxlKHNjb3BlICYmICFPYmplY3QuaGFzT3duUHJvcGVydHkuY2FsbChzY29wZS5fX3Njb3BlX18sIGtleSkpe1xuICAgICAgICBzY29wZSA9IHNjb3BlLl9fb3V0ZXJTY29wZV9fO1xuICAgIH1cbiAgICByZXR1cm4gc2NvcGUgJiYgdG9WYWx1ZS52YWx1ZShzY29wZS5fX3Njb3BlX19ba2V5XSwgdGhpcyk7XG59O1xuU2NvcGUucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKGtleSwgdmFsdWUsIGJ1YmJsZSl7XG4gICAgaWYoYnViYmxlKXtcbiAgICAgICAgdmFyIGN1cnJlbnRTY29wZSA9IHRoaXM7XG4gICAgICAgIHdoaWxlKGN1cnJlbnRTY29wZSAmJiAhKGtleSBpbiBjdXJyZW50U2NvcGUuX19zY29wZV9fKSl7XG4gICAgICAgICAgICBjdXJyZW50U2NvcGUgPSBjdXJyZW50U2NvcGUuX19vdXRlclNjb3BlX187XG4gICAgICAgIH1cblxuICAgICAgICBpZihjdXJyZW50U2NvcGUpe1xuICAgICAgICAgICAgY3VycmVudFNjb3BlLnNldChrZXksIHZhbHVlKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICB0aGlzLl9fc2NvcGVfX1trZXldID0gdG9WYWx1ZSh2YWx1ZSwgdGhpcyk7XG4gICAgcmV0dXJuIHRoaXM7XG59O1xuU2NvcGUucHJvdG90eXBlLmRlZmluZSA9IGZ1bmN0aW9uKG9iail7XG4gICAgZm9yKHZhciBrZXkgaW4gb2JqKXtcbiAgICAgICAgdGhpcy5fX3Njb3BlX19ba2V5XSA9IHRvVmFsdWUob2JqW2tleV0sIHRoaXMpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcztcbn07XG5TY29wZS5wcm90b3R5cGUuaXNEZWZpbmVkID0gZnVuY3Rpb24oa2V5KXtcbiAgICBpZihrZXkgaW4gdGhpcy5fX3Njb3BlX18pe1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuX19vdXRlclNjb3BlX18gJiYgdGhpcy5fX291dGVyU2NvcGVfXy5pc0RlZmluZWQoa2V5KSB8fCBmYWxzZTtcbn07XG5TY29wZS5wcm90b3R5cGUuaGFzRXJyb3IgPSBmdW5jdGlvbigpe1xuICAgIHJldHVybiB0aGlzLl9lcnJvcjtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gU2NvcGU7IiwidmFyIHYgPSB7fTtcblxuZnVuY3Rpb24gaXNWYWx1ZSh2YWx1ZSl7XG4gICAgcmV0dXJuIHZhbHVlICYmIHZhbHVlLl92YWx1ZSA9PT0gdjtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiB0b1ZhbHVlKHZhbHVlLCBzY29wZSwgY29udGV4dCl7XG4gICAgaWYoc2NvcGUuX2Vycm9yKXtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGVycm9yOiBzY29wZS5fZXJyb3JcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBpZihpc1ZhbHVlKHZhbHVlKSl7XG4gICAgICAgIGlmKHR5cGVvZiBjb250ZXh0ID09PSAnb2JqZWN0JyB8fCB0eXBlb2YgY29udGV4dCA9PT0gJ2Z1bmN0aW9uJyl7XG4gICAgICAgICAgICB2YWx1ZS5jb250ZXh0ID0gY29udGV4dDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgdHlwZTogJ3ZhbHVlJyxcbiAgICAgICAgY29udGV4dDogY29udGV4dCxcbiAgICAgICAgdmFsdWU6IHZhbHVlLFxuICAgICAgICBfdmFsdWU6IHZcbiAgICB9O1xufTtcblxubW9kdWxlLmV4cG9ydHMuaXNWYWx1ZSA9IGlzVmFsdWU7XG5cbm1vZHVsZS5leHBvcnRzLnZhbHVlID0gZnVuY3Rpb24odmFsdWUpe1xuICAgIHJldHVybiBpc1ZhbHVlKHZhbHVlKSA/IHZhbHVlLnZhbHVlIDogdmFsdWU7XG59OyJdfQ==
