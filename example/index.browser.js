(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
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
},{"../":4,"crel":6,"debounce":8}],2:[function(require,module,exports){
var Scope = require('./scope'),
    toValue = require('./toValue'),
    isInstance = require('is-instance');

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

    if(fn.__preshFunction__){
        return fn.apply(functionToken.context, resolveSpreads(token.content, scope));
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

        return execute(token.content, functionScope).value;
    };

    if(token.identifier){
        scope.set(token.identifier.name, fn);
    }

    fn.__preshFunction__ = true;

    return fn;
}

function ternary(token, scope){

    if(scope._debug){
        console.log('Executing operator: ' + operator.name, operator.left, operator.right);
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


    var result = target.hasOwnProperty(accessor) ? target[accessor] : undefined;

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


            Object.keys(source).forEach(function(key){
                result[key] = source[key];
            });
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
},{"./scope":14,"./toValue":15,"is-instance":10}],3:[function(require,module,exports){
module.exports = {
    log: function(x){
        console.log.apply(console, arguments);
        return x;
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
},{"./execute":2,"./global":3,"./lex":5,"./parse":13,"flat-merge":9}],5:[function(require,module,exports){
var operators = require('./operators');

function lexString(source){
    var startChar = source.charAt(0);

    if(startChar !== '"' && startChar !== '\''){
        return;
    }

    var index = 0,
        escapes = 0;

    while (source.charAt(++index) !== startChar)
    {
       if(index >= source.length){
               throw 'Unclosed string';
       }
       if (source.charAt(index) === '\\' && source.charAt(index+1) === startChar) {
               source = source.slice(0, index) + source.slice(index + 1);
               escapes++;
       }
    }

    return {
        type: 'string',
        stringChar: startChar,
        source: source.slice(0, index+1),
        length: index + escapes + 1
    };
}

function lexWord(source){
    var match = source.match(/^(?!\-)[\w-$]+/);

    if(!match){
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
    var match = source.match(/^(\/\*[^]*?\/)/);

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
    lexOperators,
    lexCharacters,
    lexString,
    lexWord,
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
                element[setAttribute](key, settings[key]);
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
module.exports = Date.now || now

function now() {
    return new Date().getTime()
}

},{}],8:[function(require,module,exports){

/**
 * Module dependencies.
 */

var now = require('date-now');

/**
 * Returns a function, that, as long as it continues to be invoked, will not
 * be triggered. The function will be called after it stops being called for
 * N milliseconds. If `immediate` is passed, trigger the function on the
 * leading edge, instead of the trailing.
 *
 * @source underscore.js
 * @see http://unscriptable.com/2009/03/20/debouncing-javascript-methods/
 * @param {Function} function to wrap
 * @param {Number} timeout in ms (`100`)
 * @param {Boolean} whether to execute at the beginning (`false`)
 * @api public
 */

module.exports = function debounce(func, wait, immediate){
  var timeout, args, context, timestamp, result;
  if (null == wait) wait = 100;

  function later() {
    var last = now() - timestamp;

    if (last < wait && last > 0) {
      timeout = setTimeout(later, wait - last);
    } else {
      timeout = null;
      if (!immediate) {
        result = func.apply(context, args);
        if (!timeout) context = args = null;
      }
    }
  };

  return function debounced() {
    context = this;
    args = arguments;
    timestamp = now();
    var callNow = immediate && !timeout;
    if (!timeout) timeout = setTimeout(later, wait);
    if (callNow) {
      result = func.apply(context, args);
      context = args = null;
    }

    return result;
  };
};

},{"date-now":7}],9:[function(require,module,exports){
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
},{}],10:[function(require,module,exports){
module.exports = function(value){
    return value && typeof value === 'object' || typeof value === 'function';
};
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

        if(operatorsForSource.binary && !startOfStatement){
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

function parseString(tokens, ast){
    if(tokens[0].type === 'string'){
        ast.push({
            type: 'string',
            value: tokens.shift().source.slice(1,-1)
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
    parsePeriod,
    parseParenthesis,
    parseSet,
    parseBlock,
    parseOperator,
    parseSemicolon
];

function parseOperators(ast){
    ast.filter(function(token){
        return token.type === 'operator';
    })
    .sort(function(a,b){
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
},{"./operators":12,"string-template":11}],14:[function(require,module,exports){
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
    while(scope && !scope.__scope__.hasOwnProperty(key)){
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy5udm0vdmVyc2lvbnMvbm9kZS92NS4zLjAvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3Nlci1wYWNrL19wcmVsdWRlLmpzIiwiZXhhbXBsZS9pbmRleC5qcyIsImV4ZWN1dGUuanMiLCJnbG9iYWwuanMiLCJpbmRleC5qcyIsImxleC5qcyIsIm5vZGVfbW9kdWxlcy9jcmVsL2NyZWwuanMiLCJub2RlX21vZHVsZXMvZGF0ZS1ub3cvaW5kZXguanMiLCJub2RlX21vZHVsZXMvZGVib3VuY2UvaW5kZXguanMiLCJub2RlX21vZHVsZXMvZmxhdC1tZXJnZS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9pcy1pbnN0YW5jZS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9zdHJpbmctdGVtcGxhdGUvaW5kZXguanMiLCJvcGVyYXRvcnMuanMiLCJwYXJzZS5qcyIsInNjb3BlLmpzIiwidG9WYWx1ZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNmQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM1FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4QkE7QUFDQTtBQUNBOztBQ0ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbENBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVjQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsInZhciBwcmVzaCA9IHJlcXVpcmUoJy4uLycpLFxuICAgIGRlYm91bmNlID0gcmVxdWlyZSgnZGVib3VuY2UnKSxcbiAgICBjcmVsID0gcmVxdWlyZSgnY3JlbCcpO1xuXG52YXIgZGVmYXVsdFNjb3BlID0gXCJ7IGE6IDEwLCBiOiAyMCwgZm9vOiBmdW5jdGlvbihpbnB1dCl7IHJldHVybiBpbnB1dCArICcgV29ybGQnfX1cIlxudmFyIGRlZmF1bHRDb2RlID0gYGJhcih4KXtcbiAgICB4ID4gYSAmJiB4IDwgYiA/IGZvbyh4KSA6IGZvbygnSGVsbG8nKTtcbn1cblxuW2JhcigxMykgYmFyKDgpXWBcblxudmFyIHNjb3BlSW5wdXQsIGNvZGVJbnB1dCwgb3V0cHV0LCB1aSA9IGNyZWwoJ2RpdicsXG4gICAgICAgIGNyZWwoJ2gyJywgJ1Njb3BlOicpLFxuICAgICAgICBzY29wZUlucHV0ID0gY3JlbCgncHJlJywgeydjb250ZW50ZWRpdGFibGUnOiB0cnVlfSwgZGVmYXVsdFNjb3BlKSxcbiAgICAgICAgY3JlbCgnaDInLCAnSW5wdXQ6JyksXG4gICAgICAgIGNvZGVJbnB1dCA9IGNyZWwoJ3ByZScsIHsnY29udGVudGVkaXRhYmxlJzogdHJ1ZX0sIGRlZmF1bHRDb2RlKSxcbiAgICAgICAgY3JlbCgnaDInLCAnT3V0cHV0OicpLFxuICAgICAgICBvdXRwdXQgPSBjcmVsKCdkaXYnKVxuICAgICk7XG5cbnZhciB1cGRhdGUgPSBkZWJvdW5jZShmdW5jdGlvbigpe1xuXG4gICAgdmFyIHNjb3BlID0ge307XG5cbiAgICAgdHJ5e1xuICAgICAgICBzY29wZSA9IHNjb3BlSW5wdXQudGV4dENvbnRlbnQgPyBldmFsKCcoJyArIHNjb3BlSW5wdXQudGV4dENvbnRlbnQgKyAnKScpIDogc2NvcGU7XG4gICAgICAgIHNjb3BlSW5wdXQucmVtb3ZlQXR0cmlidXRlKCdlcnJvcicpO1xuICAgIH1jYXRjaChlcnJvcil7XG4gICAgICAgIHNjb3BlSW5wdXQuc2V0QXR0cmlidXRlKCdlcnJvcicsIGVycm9yKTtcbiAgICB9XG5cbiAgICB0cnl7XG4gICAgICAgIHZhciByZXN1bHQgPSBwcmVzaChjb2RlSW5wdXQudGV4dENvbnRlbnQsIHNjb3BlKTtcblxuICAgICAgICBvdXRwdXQudGV4dENvbnRlbnQgPSByZXN1bHQuZXJyb3IgfHwgSlNPTi5zdHJpbmdpZnkocmVzdWx0LnZhbHVlLCBudWxsLCA0KTtcbiAgICAgICAgY29kZUlucHV0LnJlbW92ZUF0dHJpYnV0ZSgnZXJyb3InKTtcbiAgICB9Y2F0Y2goZXJyb3Ipe1xuICAgICAgICBjb2RlSW5wdXQuc2V0QXR0cmlidXRlKCdlcnJvcicsIGVycm9yKTtcbiAgICB9XG59KTtcbnVwZGF0ZSgpO1xuXG5zY29wZUlucHV0LmFkZEV2ZW50TGlzdGVuZXIoJ2tleXVwJywgdXBkYXRlKTtcbmNvZGVJbnB1dC5hZGRFdmVudExpc3RlbmVyKCdrZXl1cCcsIHVwZGF0ZSk7XG5cbmZ1bmN0aW9uIHRhYihldmVudCl7XG4gICAgaWYoZXZlbnQud2hpY2ggPT09IDkpe1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuXG4gICAgICAgIHZhciBzZWxlY3Rpb24gPSBkb2N1bWVudC5nZXRTZWxlY3Rpb24oKSxcbiAgICAgICAgICAgIHJhbmdlID0gc2VsZWN0aW9uLmdldFJhbmdlQXQoMCksXG4gICAgICAgICAgICB0YWJOb2RlID0gZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoJyAgICAnKTtcblxuICAgICAgICByYW5nZS5pbnNlcnROb2RlKHRhYk5vZGUpO1xuICAgICAgICByYW5nZS5zZXRTdGFydEFmdGVyKHRhYk5vZGUpO1xuICAgICAgICByYW5nZS5zZXRFbmRBZnRlcih0YWJOb2RlKTtcbiAgICAgICAgc2VsZWN0aW9uLnJlbW92ZUFsbFJhbmdlcygpO1xuICAgICAgICBzZWxlY3Rpb24uYWRkUmFuZ2UocmFuZ2UpO1xuICAgIH1cbn1cblxuc2NvcGVJbnB1dC5hZGRFdmVudExpc3RlbmVyKCdrZXlkb3duJywgdGFiKTtcbmNvZGVJbnB1dC5hZGRFdmVudExpc3RlbmVyKCdrZXlkb3duJywgdGFiKTtcblxud2luZG93Lm9ubG9hZCA9IGZ1bmN0aW9uKCl7XG4gICAgY3JlbChkb2N1bWVudC5ib2R5LCB1aSk7XG59OyIsInZhciBTY29wZSA9IHJlcXVpcmUoJy4vc2NvcGUnKSxcbiAgICB0b1ZhbHVlID0gcmVxdWlyZSgnLi90b1ZhbHVlJyksXG4gICAgaXNJbnN0YW5jZSA9IHJlcXVpcmUoJ2lzLWluc3RhbmNlJyk7XG5cbnZhciByZXNlcnZlZEtleXdvcmRzID0ge1xuICAgICd0cnVlJzogdHJ1ZSxcbiAgICAnZmFsc2UnOiBmYWxzZSxcbiAgICAnbnVsbCc6IG51bGwsXG4gICAgJ3VuZGVmaW5lZCc6IHVuZGVmaW5lZFxufTtcblxuZnVuY3Rpb24gcmVzb2x2ZVNwcmVhZHMoY29udGVudCwgc2NvcGUpe1xuICAgIHZhciByZXN1bHQgPSBbXTtcblxuICAgIGNvbnRlbnQuZm9yRWFjaChmdW5jdGlvbih0b2tlbil7XG5cbiAgICAgICAgaWYodG9rZW4ubmFtZSA9PT0gJ3NwcmVhZCcpe1xuICAgICAgICAgICAgcmVzdWx0LnB1c2guYXBwbHkocmVzdWx0LCBleGVjdXRlVG9rZW4odG9rZW4sIHNjb3BlKS52YWx1ZSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICByZXN1bHQucHVzaChleGVjdXRlVG9rZW4odG9rZW4sIHNjb3BlKS52YWx1ZSk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiBmdW5jdGlvbkNhbGwodG9rZW4sIHNjb3BlKXtcbiAgICB2YXIgZnVuY3Rpb25Ub2tlbiA9IGV4ZWN1dGVUb2tlbih0b2tlbi50YXJnZXQsIHNjb3BlKSxcbiAgICAgICAgZm4gPSBmdW5jdGlvblRva2VuLnZhbHVlO1xuXG4gICAgaWYodHlwZW9mIGZuICE9PSAnZnVuY3Rpb24nKXtcbiAgICAgICAgc2NvcGUudGhyb3coZm4gKyAnIGlzIG5vdCBhIGZ1bmN0aW9uJyk7XG4gICAgfVxuXG4gICAgaWYoc2NvcGUuaGFzRXJyb3IoKSl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZihmbi5fX3ByZXNoRnVuY3Rpb25fXyl7XG4gICAgICAgIHJldHVybiBmbi5hcHBseShmdW5jdGlvblRva2VuLmNvbnRleHQsIHJlc29sdmVTcHJlYWRzKHRva2VuLmNvbnRlbnQsIHNjb3BlKSk7XG4gICAgfVxuXG4gICAgdHJ5e1xuICAgICAgICByZXR1cm4gZm4uYXBwbHkoZnVuY3Rpb25Ub2tlbi5jb250ZXh0LCByZXNvbHZlU3ByZWFkcyh0b2tlbi5jb250ZW50LCBzY29wZSkpO1xuICAgIH1jYXRjaChlcnJvcil7XG4gICAgICAgIHNjb3BlLnRocm93KGVycm9yKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGZ1bmN0aW9uRXhwcmVzc2lvbih0b2tlbiwgc2NvcGUpe1xuICAgIHZhciBmbiA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIHZhciBhcmdzID0gYXJndW1lbnRzLFxuICAgICAgICAgICAgZnVuY3Rpb25TY29wZSA9IG5ldyBTY29wZShzY29wZSk7XG5cbiAgICAgICAgdG9rZW4ucGFyYW1ldGVycy5mb3JFYWNoKGZ1bmN0aW9uKHBhcmFtZXRlciwgaW5kZXgpe1xuXG4gICAgICAgICAgICBpZihwYXJhbWV0ZXIubmFtZSA9PT0gJ3NwcmVhZCcpe1xuICAgICAgICAgICAgICAgIGZ1bmN0aW9uU2NvcGUuc2V0KHBhcmFtZXRlci5yaWdodC5uYW1lLCBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmdzLCBpbmRleCkpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZnVuY3Rpb25TY29wZS5zZXQocGFyYW1ldGVyLm5hbWUsIGFyZ3NbaW5kZXhdKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIGV4ZWN1dGUodG9rZW4uY29udGVudCwgZnVuY3Rpb25TY29wZSkudmFsdWU7XG4gICAgfTtcblxuICAgIGlmKHRva2VuLmlkZW50aWZpZXIpe1xuICAgICAgICBzY29wZS5zZXQodG9rZW4uaWRlbnRpZmllci5uYW1lLCBmbik7XG4gICAgfVxuXG4gICAgZm4uX19wcmVzaEZ1bmN0aW9uX18gPSB0cnVlO1xuXG4gICAgcmV0dXJuIGZuO1xufVxuXG5mdW5jdGlvbiB0ZXJuYXJ5KHRva2VuLCBzY29wZSl7XG5cbiAgICBpZihzY29wZS5fZGVidWcpe1xuICAgICAgICBjb25zb2xlLmxvZygnRXhlY3V0aW5nIG9wZXJhdG9yOiAnICsgb3BlcmF0b3IubmFtZSwgb3BlcmF0b3IubGVmdCwgb3BlcmF0b3IucmlnaHQpO1xuICAgIH1cblxuICAgIHJldHVybiBleGVjdXRlVG9rZW4odG9rZW4ubGVmdCwgc2NvcGUpLnZhbHVlID9cbiAgICAgICAgZXhlY3V0ZVRva2VuKHRva2VuLm1pZGRsZSwgc2NvcGUpLnZhbHVlIDpcbiAgICAgICAgZXhlY3V0ZVRva2VuKHRva2VuLnJpZ2h0LCBzY29wZSkudmFsdWU7XG59XG5cbmZ1bmN0aW9uIGlkZW50aWZpZXIodG9rZW4sIHNjb3BlKXtcbiAgICB2YXIgbmFtZSA9IHRva2VuLm5hbWU7XG4gICAgaWYobmFtZSBpbiByZXNlcnZlZEtleXdvcmRzKXtcbiAgICAgICAgcmV0dXJuIHJlc2VydmVkS2V5d29yZHNbbmFtZV07XG4gICAgfVxuICAgIGlmKCFzY29wZS5pc0RlZmluZWQobmFtZSkpe1xuICAgICAgICBzY29wZS50aHJvdyhuYW1lICsgJyBpcyBub3QgZGVmaW5lZCcpO1xuICAgIH1cbiAgICByZXR1cm4gc2NvcGUuZ2V0KG5hbWUpO1xufVxuXG5mdW5jdGlvbiBudW1iZXIodG9rZW4pe1xuICAgIHJldHVybiB0b2tlbi52YWx1ZTtcbn1cblxuZnVuY3Rpb24gc3RyaW5nKHRva2VuKXtcbiAgICByZXR1cm4gdG9rZW4udmFsdWU7XG59XG5cbmZ1bmN0aW9uIGdldFByb3BlcnR5KHRva2VuLCBzY29wZSwgdGFyZ2V0LCBhY2Nlc3Nvcil7XG5cbiAgICBpZighdGFyZ2V0IHx8ICEodHlwZW9mIHRhcmdldCA9PT0gJ29iamVjdCcgfHwgdHlwZW9mIHRhcmdldCA9PT0gJ2Z1bmN0aW9uJykpe1xuICAgICAgICBzY29wZS50aHJvdygndGFyZ2V0IGlzIG5vdCBhbiBvYmplY3QnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuXG4gICAgdmFyIHJlc3VsdCA9IHRhcmdldC5oYXNPd25Qcm9wZXJ0eShhY2Nlc3NvcikgPyB0YXJnZXRbYWNjZXNzb3JdIDogdW5kZWZpbmVkO1xuXG4gICAgaWYodHlwZW9mIHJlc3VsdCA9PT0gJ2Z1bmN0aW9uJyl7XG4gICAgICAgIHJlc3VsdCA9IHRvVmFsdWUocmVzdWx0LCBzY29wZSwgdGFyZ2V0KTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiBwZXJpb2QodG9rZW4sIHNjb3BlKXtcbiAgICB2YXIgdGFyZ2V0ID0gZXhlY3V0ZVRva2VuKHRva2VuLmxlZnQsIHNjb3BlKS52YWx1ZTtcblxuICAgIHJldHVybiBnZXRQcm9wZXJ0eSh0b2tlbiwgc2NvcGUsIHRhcmdldCwgdG9rZW4ucmlnaHQubmFtZSk7XG59XG5cbmZ1bmN0aW9uIGFjY2Vzc29yKHRva2VuLCBzY29wZSl7XG4gICAgdmFyIGFjY2Vzc29yVmFsdWUgPSBleGVjdXRlKHRva2VuLmNvbnRlbnQsIHNjb3BlKS52YWx1ZSxcbiAgICAgICAgdGFyZ2V0ID0gZXhlY3V0ZVRva2VuKHRva2VuLnRhcmdldCwgc2NvcGUpLnZhbHVlO1xuXG4gICAgcmV0dXJuIGdldFByb3BlcnR5KHRva2VuLCBzY29wZSwgdGFyZ2V0LCBhY2Nlc3NvclZhbHVlKTtcbn1cblxuZnVuY3Rpb24gc3ByZWFkKHRva2VuLCBzY29wZSl7XG4gICAgdmFyIHRhcmdldCA9IGV4ZWN1dGVUb2tlbih0b2tlbi5yaWdodCwgc2NvcGUpLnZhbHVlO1xuXG4gICAgaWYoIUFycmF5LmlzQXJyYXkodGFyZ2V0KSl7XG4gICAgICAgIHNjb3BlLnRocm93KCd0YXJnZXQgZGlkIG5vdCByZXNvbHZlIHRvIGFuIGFycmF5Jyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRhcmdldDtcbn1cblxuZnVuY3Rpb24gc2V0KHRva2VuLCBzY29wZSl7XG4gICAgaWYodG9rZW4uY29udGVudC5sZW5ndGggPT09IDEgJiYgdG9rZW4uY29udGVudFswXS5uYW1lID09PSAncmFuZ2UnKXtcbiAgICAgICAgdmFyIHJhbmdlID0gdG9rZW4uY29udGVudFswXSxcbiAgICAgICAgICAgIHN0YXJ0ID0gZXhlY3V0ZVRva2VuKHJhbmdlLmxlZnQsIHNjb3BlKS52YWx1ZSxcbiAgICAgICAgICAgIGVuZCA9IGV4ZWN1dGVUb2tlbihyYW5nZS5yaWdodCwgc2NvcGUpLnZhbHVlLFxuICAgICAgICAgICAgcmV2ZXJzZSA9IGVuZCA8IHN0YXJ0LFxuICAgICAgICAgICAgcmVzdWx0ID0gW107XG5cbiAgICAgICAgZm9yICh2YXIgaSA9IHN0YXJ0OyByZXZlcnNlID8gaSA+PSBlbmQgOiBpIDw9IGVuZDsgcmV2ZXJzZSA/IGktLSA6IGkrKykge1xuICAgICAgICAgICAgcmVzdWx0LnB1c2goaSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIHJldHVybiByZXNvbHZlU3ByZWFkcyh0b2tlbi5jb250ZW50LCBzY29wZSk7XG59XG5cbmZ1bmN0aW9uIHZhbHVlKHRva2VuKXtcbiAgICByZXR1cm4gdG9rZW4udmFsdWU7XG59XG5cbmZ1bmN0aW9uIG9iamVjdCh0b2tlbiwgc2NvcGUpe1xuICAgIHZhciByZXN1bHQgPSB7fTtcblxuICAgIHZhciBjb250ZW50ID0gdG9rZW4uY29udGVudDtcblxuICAgIGZvcih2YXIgaSA9IDA7IGkgPCBjb250ZW50Lmxlbmd0aDsgaSArKykge1xuICAgICAgICB2YXIgY2hpbGQgPSBjb250ZW50W2ldLFxuICAgICAgICAgICAga2V5LFxuICAgICAgICAgICAgdmFsdWU7XG5cbiAgICAgICAgaWYoY2hpbGQubmFtZSA9PT0gJ3R1cGxlJyl7XG4gICAgICAgICAgICBpZihjaGlsZC5sZWZ0LnR5cGUgPT09ICdpZGVudGlmaWVyJyl7XG4gICAgICAgICAgICAgICAga2V5ID0gY2hpbGQubGVmdC5uYW1lO1xuICAgICAgICAgICAgfWVsc2UgaWYoY2hpbGQubGVmdC50eXBlID09PSAnc2V0JyAmJiBjaGlsZC5sZWZ0LmNvbnRlbnQubGVuZ3RoID09PSAxKXtcbiAgICAgICAgICAgICAgICBrZXkgPSBleGVjdXRlVG9rZW4oY2hpbGQubGVmdC5jb250ZW50WzBdLCBzY29wZSkudmFsdWU7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICBzY29wZS50aHJvdygnVW5leHBlY3RlZCB0b2tlbiBpbiBvYmplY3QgY29uc3RydWN0b3I6ICcgKyBjaGlsZC50eXBlKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHZhbHVlID0gZXhlY3V0ZVRva2VuKGNoaWxkLnJpZ2h0LCBzY29wZSkudmFsdWU7XG4gICAgICAgIH1lbHNlIGlmKGNoaWxkLnR5cGUgPT09ICdpZGVudGlmaWVyJyl7XG4gICAgICAgICAgICBrZXkgPSBjaGlsZC5uYW1lO1xuICAgICAgICAgICAgdmFsdWUgPSBleGVjdXRlVG9rZW4oY2hpbGQsIHNjb3BlKS52YWx1ZTtcbiAgICAgICAgfWVsc2UgaWYoY2hpbGQubmFtZSA9PT0gJ3NwcmVhZCcpe1xuICAgICAgICAgICAgdmFyIHNvdXJjZSA9IGV4ZWN1dGVUb2tlbihjaGlsZC5yaWdodCwgc2NvcGUpLnZhbHVlO1xuXG4gICAgICAgICAgICBpZighaXNJbnN0YW5jZShzb3VyY2UpKXtcbiAgICAgICAgICAgICAgICBzY29wZS50aHJvdygnVGFyZ2V0IGRpZCBub3QgcmVzb2x2ZSB0byBhbiBpbnN0YW5jZSBvZiBhbiBvYmplY3QnKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cblxuICAgICAgICAgICAgT2JqZWN0LmtleXMoc291cmNlKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSl7XG4gICAgICAgICAgICAgICAgcmVzdWx0W2tleV0gPSBzb3VyY2Vba2V5XTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1lbHNlIGlmKGNoaWxkLm5hbWUgPT09ICdkZWxldGUnKXtcbiAgICAgICAgICAgIHZhciB0YXJnZXRJZGVudGlmaWVyID0gY2hpbGQucmlnaHQ7XG5cbiAgICAgICAgICAgIGlmKHRhcmdldElkZW50aWZpZXIudHlwZSAhPT0gJ2lkZW50aWZpZXInKXtcbiAgICAgICAgICAgICAgICBzY29wZS50aHJvdygnVGFyZ2V0IG9mIGRlbGV0ZSB3YXMgbm90IGFuIGlkZW50aWZpZXInKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGRlbGV0ZSByZXN1bHRbdGFyZ2V0SWRlbnRpZmllci5uYW1lXTtcblxuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgICAgc2NvcGUudGhyb3coJ1VuZXhwZWN0ZWQgdG9rZW4gaW4gb2JqZWN0IGNvbnN0cnVjdG9yOiAnICsgY2hpbGQudHlwZSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICByZXN1bHRba2V5XSA9IHZhbHVlO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbnZhciBoYW5kbGVycyA9IHtcbiAgICB0ZXJuYXJ5OiB0ZXJuYXJ5LFxuICAgIGZ1bmN0aW9uQ2FsbDogZnVuY3Rpb25DYWxsLFxuICAgIGZ1bmN0aW9uRXhwcmVzc2lvbjogZnVuY3Rpb25FeHByZXNzaW9uLFxuICAgIG51bWJlcjogbnVtYmVyLFxuICAgIHN0cmluZzogc3RyaW5nLFxuICAgIGlkZW50aWZpZXI6IGlkZW50aWZpZXIsXG4gICAgc2V0OiBzZXQsXG4gICAgcGVyaW9kOiBwZXJpb2QsXG4gICAgc3ByZWFkOiBzcHJlYWQsXG4gICAgYWNjZXNzb3I6IGFjY2Vzc29yLFxuICAgIHZhbHVlOiB2YWx1ZSxcbiAgICBvcGVyYXRvcjogb3BlcmF0b3IsXG4gICAgcGFyZW50aGVzaXNHcm91cDogY29udGVudEhvbGRlcixcbiAgICBzdGF0ZW1lbnQ6IGNvbnRlbnRIb2xkZXIsXG4gICAgYnJhY2VHcm91cDogb2JqZWN0XG59O1xuXG5mdW5jdGlvbiBuZXh0T3BlcmF0b3JUb2tlbih0b2tlbiwgc2NvcGUpe1xuICAgIHJldHVybiBmdW5jdGlvbigpe1xuICAgICAgICByZXR1cm4gZXhlY3V0ZVRva2VuKHRva2VuLCBzY29wZSkudmFsdWU7XG4gICAgfTtcbn1cblxuZnVuY3Rpb24gb3BlcmF0b3IodG9rZW4sIHNjb3BlKXtcbiAgICBpZih0b2tlbi5uYW1lIGluIGhhbmRsZXJzKXtcbiAgICAgICAgcmV0dXJuIHRvVmFsdWUoaGFuZGxlcnNbdG9rZW4ubmFtZV0odG9rZW4sIHNjb3BlKSwgc2NvcGUpO1xuICAgIH1cblxuICAgIGlmKHRva2VuLmxlZnQpe1xuICAgICAgICBpZihzY29wZS5fZGVidWcpe1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ0V4ZWN1dGluZyB0b2tlbjogJyArIHRva2VuLm5hbWUsIHRva2VuLmxlZnQsIHRva2VuLnJpZ2h0KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdG9rZW4ub3BlcmF0b3IuZm4obmV4dE9wZXJhdG9yVG9rZW4odG9rZW4ubGVmdCwgc2NvcGUpLCBuZXh0T3BlcmF0b3JUb2tlbih0b2tlbi5yaWdodCwgc2NvcGUpKTtcbiAgICB9XG5cbiAgICBpZihzY29wZS5fZGVidWcpe1xuICAgICAgICBjb25zb2xlLmxvZygnRXhlY3V0aW5nIG9wZXJhdG9yOiAnICsgdG9rZW4ubmFtZS4gdG9rZW4ucmlnaHQpO1xuICAgIH1cblxuICAgIHJldHVybiB0b2tlbi5vcGVyYXRvci5mbihuZXh0T3BlcmF0b3JUb2tlbih0b2tlbi5yaWdodCwgc2NvcGUpKTtcbn1cblxuZnVuY3Rpb24gY29udGVudEhvbGRlcihwYXJlbnRoZXNpc0dyb3VwLCBzY29wZSl7XG4gICAgcmV0dXJuIGV4ZWN1dGUocGFyZW50aGVzaXNHcm91cC5jb250ZW50LCBzY29wZSkudmFsdWU7XG59XG5cbmZ1bmN0aW9uIGV4ZWN1dGVUb2tlbih0b2tlbiwgc2NvcGUpe1xuICAgIGlmKHNjb3BlLl9lcnJvcil7XG4gICAgICAgIHJldHVybiB7ZXJyb3I6IHNjb3BlLl9lcnJvcn07XG4gICAgfVxuICAgIHJldHVybiB0b1ZhbHVlKGhhbmRsZXJzW3Rva2VuLnR5cGVdKHRva2VuLCBzY29wZSksIHNjb3BlKTtcbn1cblxuZnVuY3Rpb24gZXhlY3V0ZSh0b2tlbnMsIHNjb3BlLCBkZWJ1Zyl7XG4gICAgc2NvcGUgPSBzY29wZSBpbnN0YW5jZW9mIFNjb3BlID8gc2NvcGUgOiBuZXcgU2NvcGUoc2NvcGUsIGRlYnVnKTtcblxuICAgIHZhciByZXN1bHQ7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0b2tlbnMubGVuZ3RoOyBpKyspIHtcblxuICAgICAgICByZXN1bHQgPSBleGVjdXRlVG9rZW4odG9rZW5zW2ldLCBzY29wZSk7XG5cbiAgICAgICAgaWYocmVzdWx0LmVycm9yKXtcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZighcmVzdWx0KXtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGVycm9yOiBuZXcgRXJyb3IoJ1Vua25vd24gZXhlY3V0aW9uIGVycm9yJylcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGV4ZWN1dGU7IiwibW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgbG9nOiBmdW5jdGlvbih4KXtcbiAgICAgICAgY29uc29sZS5sb2cuYXBwbHkoY29uc29sZSwgYXJndW1lbnRzKTtcbiAgICAgICAgcmV0dXJuIHg7XG4gICAgfSxcbiAgICBtYXA6IGZ1bmN0aW9uKGl0ZW1zLCBmbil7XG4gICAgICAgIHJldHVybiBpdGVtcy5tYXAoZm4pO1xuICAgIH0sXG4gICAgZm9sZDogZnVuY3Rpb24oaXRlbXMsIHNlZWQsIGZuKXtcbiAgICAgICAgaWYoYXJndW1lbnRzLmxlbmd0aCA9PT0gMil7XG4gICAgICAgICAgICByZXR1cm4gaXRlbXMucmVkdWNlKHNlZWQpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBpdGVtcy5yZWR1Y2UoZm4sIHNlZWQpO1xuICAgIH0sXG4gICAgbWF0aDogTWF0aFxufTsiLCJ2YXIgbGV4ID0gcmVxdWlyZSgnLi9sZXgnKSxcbiAgICBwYXJzZSA9IHJlcXVpcmUoJy4vcGFyc2UnKSxcbiAgICBleGVjdXRlID0gcmVxdWlyZSgnLi9leGVjdXRlJyksXG4gICAgZ2xvYmFsID0gcmVxdWlyZSgnLi9nbG9iYWwnKSxcbiAgICBtZXJnZSA9IHJlcXVpcmUoJ2ZsYXQtbWVyZ2UnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihleHByZXNzaW9uLCBzY29wZSwgY2FsbGJhY2ssIGRlYnVnKXtcbiAgICB2YXIgbGV4ZWQgPSBsZXgoZXhwcmVzc2lvbik7XG4gICAgdmFyIHBhcnNlZCA9IHBhcnNlKGxleGVkKTtcblxuICAgIHJldHVybiBleGVjdXRlKHBhcnNlZCwgbWVyZ2UoXG4gICAgICAgIGdsb2JhbCxcbiAgICAgICAgc2NvcGVcbiAgICApLCBjYWxsYmFjaywgZGVidWcpO1xufTsiLCJ2YXIgb3BlcmF0b3JzID0gcmVxdWlyZSgnLi9vcGVyYXRvcnMnKTtcblxuZnVuY3Rpb24gbGV4U3RyaW5nKHNvdXJjZSl7XG4gICAgdmFyIHN0YXJ0Q2hhciA9IHNvdXJjZS5jaGFyQXQoMCk7XG5cbiAgICBpZihzdGFydENoYXIgIT09ICdcIicgJiYgc3RhcnRDaGFyICE9PSAnXFwnJyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgaW5kZXggPSAwLFxuICAgICAgICBlc2NhcGVzID0gMDtcblxuICAgIHdoaWxlIChzb3VyY2UuY2hhckF0KCsraW5kZXgpICE9PSBzdGFydENoYXIpXG4gICAge1xuICAgICAgIGlmKGluZGV4ID49IHNvdXJjZS5sZW5ndGgpe1xuICAgICAgICAgICAgICAgdGhyb3cgJ1VuY2xvc2VkIHN0cmluZyc7XG4gICAgICAgfVxuICAgICAgIGlmIChzb3VyY2UuY2hhckF0KGluZGV4KSA9PT0gJ1xcXFwnICYmIHNvdXJjZS5jaGFyQXQoaW5kZXgrMSkgPT09IHN0YXJ0Q2hhcikge1xuICAgICAgICAgICAgICAgc291cmNlID0gc291cmNlLnNsaWNlKDAsIGluZGV4KSArIHNvdXJjZS5zbGljZShpbmRleCArIDEpO1xuICAgICAgICAgICAgICAgZXNjYXBlcysrO1xuICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgc3RyaW5nQ2hhcjogc3RhcnRDaGFyLFxuICAgICAgICBzb3VyY2U6IHNvdXJjZS5zbGljZSgwLCBpbmRleCsxKSxcbiAgICAgICAgbGVuZ3RoOiBpbmRleCArIGVzY2FwZXMgKyAxXG4gICAgfTtcbn1cblxuZnVuY3Rpb24gbGV4V29yZChzb3VyY2Upe1xuICAgIHZhciBtYXRjaCA9IHNvdXJjZS5tYXRjaCgvXig/IVxcLSlbXFx3LSRdKy8pO1xuXG4gICAgaWYoIW1hdGNoKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIHR5cGU6ICd3b3JkJyxcbiAgICAgICAgc291cmNlOiBtYXRjaFswXSxcbiAgICAgICAgbGVuZ3RoOiBtYXRjaFswXS5sZW5ndGhcbiAgICB9O1xufVxuXG5mdW5jdGlvbiBsZXhOdW1iZXIoc291cmNlKXtcbiAgICB2YXIgc3BlY2lhbHMgPSB7XG4gICAgICAgICdOYU4nOiBOdW1iZXIuTmFOLFxuICAgICAgICAnSW5maW5pdHknOiBJbmZpbml0eVxuICAgIH07XG5cbiAgICB2YXIgdG9rZW4gPSB7XG4gICAgICAgIHR5cGU6ICdudW1iZXInXG4gICAgfTtcblxuICAgIGZvciAodmFyIGtleSBpbiBzcGVjaWFscykge1xuICAgICAgICBpZiAoc291cmNlLnNsaWNlKDAsIGtleS5sZW5ndGgpID09PSBrZXkpIHtcbiAgICAgICAgICAgIHRva2VuLnNvdXJjZSA9IGtleTtcbiAgICAgICAgICAgIHRva2VuLmxlbmd0aCA9IHRva2VuLnNvdXJjZS5sZW5ndGg7XG5cbiAgICAgICAgICAgIHJldHVybiB0b2tlbjtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHZhciBtYXRjaEV4cG9uZW50ID0gc291cmNlLm1hdGNoKC9eWzAtOV0rKD86XFwuWzAtOV0rKT9bZUVdLT9bMC05XSsvKTtcblxuICAgIGlmKG1hdGNoRXhwb25lbnQpe1xuICAgICAgICB0b2tlbi5zb3VyY2UgPSBtYXRjaEV4cG9uZW50WzBdO1xuICAgICAgICB0b2tlbi5sZW5ndGggPSB0b2tlbi5zb3VyY2UubGVuZ3RoO1xuXG4gICAgICAgIHJldHVybiB0b2tlbjtcbiAgICB9XG5cbiAgICB2YXIgbWF0Y2hIZXggPSBzb3VyY2UubWF0Y2goL14wW3hYXVswLTldKy8pO1xuXG4gICAgaWYobWF0Y2hIZXgpe1xuICAgICAgICB0b2tlbi5zb3VyY2UgPSBtYXRjaEhleFswXTtcbiAgICAgICAgdG9rZW4ubGVuZ3RoID0gdG9rZW4uc291cmNlLmxlbmd0aDtcblxuICAgICAgICByZXR1cm4gdG9rZW47XG4gICAgfVxuXG4gICAgdmFyIG1hdGNoSGVhZGxlc3NEZWNpbWFsID0gc291cmNlLm1hdGNoKC9eXFwuWzAtOV0rLyk7XG5cbiAgICBpZihtYXRjaEhlYWRsZXNzRGVjaW1hbCl7XG4gICAgICAgIHRva2VuLnNvdXJjZSA9IG1hdGNoSGVhZGxlc3NEZWNpbWFsWzBdO1xuICAgICAgICB0b2tlbi5sZW5ndGggPSB0b2tlbi5zb3VyY2UubGVuZ3RoO1xuXG4gICAgICAgIHJldHVybiB0b2tlbjtcbiAgICB9XG5cbiAgICB2YXIgbWF0Y2hOb3JtYWxEZWNpbWFsID0gc291cmNlLm1hdGNoKC9eWzAtOV0rKD86XFwuWzAtOV0rKT8vKTtcblxuICAgIGlmKG1hdGNoTm9ybWFsRGVjaW1hbCl7XG4gICAgICAgIHRva2VuLnNvdXJjZSA9IG1hdGNoTm9ybWFsRGVjaW1hbFswXTtcbiAgICAgICAgdG9rZW4ubGVuZ3RoID0gdG9rZW4uc291cmNlLmxlbmd0aDtcblxuICAgICAgICByZXR1cm4gdG9rZW47XG4gICAgfVxufVxuXG5mdW5jdGlvbiBsZXhDb21tZW50KHNvdXJjZSl7XG4gICAgdmFyIG1hdGNoID0gc291cmNlLm1hdGNoKC9eKFxcL1xcKlteXSo/XFwvKS8pO1xuXG4gICAgaWYoIW1hdGNoKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIHR5cGU6ICdjb21tZW50JyxcbiAgICAgICAgc291cmNlOiBtYXRjaFswXSxcbiAgICAgICAgbGVuZ3RoOiBtYXRjaFswXS5sZW5ndGhcbiAgICB9O1xufVxuXG52YXIgY2hhcmFjdGVycyA9IHtcbiAgICAnLic6ICdwZXJpb2QnLFxuICAgICc7JzogJ3NlbWljb2xvbicsXG4gICAgJ3snOiAnYnJhY2VPcGVuJyxcbiAgICAnfSc6ICdicmFjZUNsb3NlJyxcbiAgICAnKCc6ICdwYXJlbnRoZXNpc09wZW4nLFxuICAgICcpJzogJ3BhcmVudGhlc2lzQ2xvc2UnLFxuICAgICdbJzogJ3NxdWFyZUJyYWNlT3BlbicsXG4gICAgJ10nOiAnc3F1YXJlQnJhY2VDbG9zZSdcbn07XG5cbmZ1bmN0aW9uIGxleENoYXJhY3RlcnMoc291cmNlKXtcbiAgICB2YXIgbmFtZSxcbiAgICAgICAga2V5O1xuXG4gICAgZm9yKGtleSBpbiBjaGFyYWN0ZXJzKXtcbiAgICAgICAgaWYoc291cmNlLmluZGV4T2Yoa2V5KSA9PT0gMCl7XG4gICAgICAgICAgICBuYW1lID0gY2hhcmFjdGVyc1trZXldO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZighbmFtZSl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICB0eXBlOiBuYW1lLFxuICAgICAgICBzb3VyY2U6IGtleSxcbiAgICAgICAgbGVuZ3RoOiAxXG4gICAgfTtcbn1cblxuZnVuY3Rpb24gbGV4T3BlcmF0b3JzKHNvdXJjZSl7XG4gICAgdmFyIG9wZXJhdG9yLFxuICAgICAgICBrZXk7XG5cbiAgICBmb3Ioa2V5IGluIG9wZXJhdG9ycyl7XG4gICAgICAgIGlmKHNvdXJjZS5pbmRleE9mKGtleSkgPT09IDApe1xuICAgICAgICAgICAgb3BlcmF0b3IgPSBvcGVyYXRvcnNba2V5XTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgaWYoIW9wZXJhdG9yKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIHR5cGU6ICdvcGVyYXRvcicsXG4gICAgICAgIHNvdXJjZToga2V5LFxuICAgICAgICBsZW5ndGg6IGtleS5sZW5ndGhcbiAgICB9O1xufVxuXG5mdW5jdGlvbiBsZXhTcHJlYWQoc291cmNlKXtcbiAgICB2YXIgbWF0Y2ggPSBzb3VyY2UubWF0Y2goL15cXC5cXC5cXC4vKTtcblxuICAgIGlmKCFtYXRjaCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICB0eXBlOiAnc3ByZWFkJyxcbiAgICAgICAgc291cmNlOiBtYXRjaFswXSxcbiAgICAgICAgbGVuZ3RoOiBtYXRjaFswXS5sZW5ndGhcbiAgICB9O1xufVxuXG5mdW5jdGlvbiBsZXhEZWxpbWl0ZXIoc291cmNlKXtcbiAgICB2YXIgbWF0Y2ggPSBzb3VyY2UubWF0Y2goL15bXFxzXFxuXSsvKTtcblxuICAgIGlmKCFtYXRjaCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICB0eXBlOiAnZGVsaW1pdGVyJyxcbiAgICAgICAgc291cmNlOiBtYXRjaFswXSxcbiAgICAgICAgbGVuZ3RoOiBtYXRjaFswXS5sZW5ndGhcbiAgICB9O1xufVxuXG52YXIgbGV4ZXJzID0gW1xuICAgIGxleERlbGltaXRlcixcbiAgICBsZXhDb21tZW50LFxuICAgIGxleE51bWJlcixcbiAgICBsZXhPcGVyYXRvcnMsXG4gICAgbGV4Q2hhcmFjdGVycyxcbiAgICBsZXhTdHJpbmcsXG4gICAgbGV4V29yZCxcbiAgICBsZXhTcHJlYWRcbl07XG5cbmZ1bmN0aW9uIHNjYW5Gb3JUb2tlbih0b2tlbmlzZXJzLCBleHByZXNzaW9uKXtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRva2VuaXNlcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIHRva2VuID0gdG9rZW5pc2Vyc1tpXShleHByZXNzaW9uKTtcbiAgICAgICAgaWYgKHRva2VuKSB7XG4gICAgICAgICAgICByZXR1cm4gdG9rZW47XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIGxleChzb3VyY2UsIG1lbW9pc2VkVG9rZW5zKSB7XG4gICAgdmFyIHNvdXJjZVJlZiA9IHtcbiAgICAgICAgc291cmNlOiBzb3VyY2UsXG4gICAgICAgIHRvSlNPTjogZnVuY3Rpb24oKXt9XG4gICAgfTtcblxuICAgIGlmKCFzb3VyY2Upe1xuICAgICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgaWYobWVtb2lzZWRUb2tlbnMgJiYgbWVtb2lzZWRUb2tlbnNbc291cmNlXSl7XG4gICAgICAgIHJldHVybiBtZW1vaXNlZFRva2Vuc1tzb3VyY2VdLnNsaWNlKCk7XG4gICAgfVxuXG4gICAgdmFyIG9yaWdpbmFsU291cmNlID0gc291cmNlLFxuICAgICAgICB0b2tlbnMgPSBbXSxcbiAgICAgICAgdG90YWxDaGFyc1Byb2Nlc3NlZCA9IDAsXG4gICAgICAgIHByZXZpb3VzTGVuZ3RoO1xuXG4gICAgZG8ge1xuICAgICAgICBwcmV2aW91c0xlbmd0aCA9IHNvdXJjZS5sZW5ndGg7XG5cbiAgICAgICAgdmFyIHRva2VuO1xuXG4gICAgICAgIHRva2VuID0gc2NhbkZvclRva2VuKGxleGVycywgc291cmNlKTtcblxuICAgICAgICBpZih0b2tlbil7XG4gICAgICAgICAgICB0b2tlbi5zb3VyY2VSZWYgPSBzb3VyY2VSZWY7XG4gICAgICAgICAgICB0b2tlbi5pbmRleCA9IHRvdGFsQ2hhcnNQcm9jZXNzZWQ7XG4gICAgICAgICAgICBzb3VyY2UgPSBzb3VyY2Uuc2xpY2UodG9rZW4ubGVuZ3RoKTtcbiAgICAgICAgICAgIHRvdGFsQ2hhcnNQcm9jZXNzZWQgKz0gdG9rZW4ubGVuZ3RoO1xuICAgICAgICAgICAgdG9rZW5zLnB1c2godG9rZW4pO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuXG4gICAgICAgIGlmKHNvdXJjZS5sZW5ndGggPT09IHByZXZpb3VzTGVuZ3RoKXtcbiAgICAgICAgICAgIHRocm93ICdTeW50YXggZXJyb3I6IFVuYWJsZSB0byBkZXRlcm1pbmUgbmV4dCB0b2tlbiBpbiBzb3VyY2U6ICcgKyBzb3VyY2Uuc2xpY2UoMCwgMTAwKTtcbiAgICAgICAgfVxuXG4gICAgfSB3aGlsZSAoc291cmNlKTtcblxuICAgIGlmKG1lbW9pc2VkVG9rZW5zKXtcbiAgICAgICAgbWVtb2lzZWRUb2tlbnNbb3JpZ2luYWxTb3VyY2VdID0gdG9rZW5zLnNsaWNlKCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRva2Vucztcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBsZXg7IiwiLy9Db3B5cmlnaHQgKEMpIDIwMTIgS29yeSBOdW5uXHJcblxyXG4vL1Blcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGUgXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbCBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCwgZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdCBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGUgZm9sbG93aW5nIGNvbmRpdGlvbnM6XHJcblxyXG4vL1RoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkIGluIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxyXG5cclxuLy9USEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTIE9SIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTiBOTyBFVkVOVCBTSEFMTCBUSEUgQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSwgREFNQUdFUyBPUiBPVEhFUiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEUgVVNFIE9SIE9USEVSIERFQUxJTkdTIElOIFRIRSBTT0ZUV0FSRS5cclxuXHJcbi8qXHJcblxyXG4gICAgVGhpcyBjb2RlIGlzIG5vdCBmb3JtYXR0ZWQgZm9yIHJlYWRhYmlsaXR5LCBidXQgcmF0aGVyIHJ1bi1zcGVlZCBhbmQgdG8gYXNzaXN0IGNvbXBpbGVycy5cclxuXHJcbiAgICBIb3dldmVyLCB0aGUgY29kZSdzIGludGVudGlvbiBzaG91bGQgYmUgdHJhbnNwYXJlbnQuXHJcblxyXG4gICAgKioqIElFIFNVUFBPUlQgKioqXHJcblxyXG4gICAgSWYgeW91IHJlcXVpcmUgdGhpcyBsaWJyYXJ5IHRvIHdvcmsgaW4gSUU3LCBhZGQgdGhlIGZvbGxvd2luZyBhZnRlciBkZWNsYXJpbmcgY3JlbC5cclxuXHJcbiAgICB2YXIgdGVzdERpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpLFxyXG4gICAgICAgIHRlc3RMYWJlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2xhYmVsJyk7XHJcblxyXG4gICAgdGVzdERpdi5zZXRBdHRyaWJ1dGUoJ2NsYXNzJywgJ2EnKTtcclxuICAgIHRlc3REaXZbJ2NsYXNzTmFtZSddICE9PSAnYScgPyBjcmVsLmF0dHJNYXBbJ2NsYXNzJ10gPSAnY2xhc3NOYW1lJzp1bmRlZmluZWQ7XHJcbiAgICB0ZXN0RGl2LnNldEF0dHJpYnV0ZSgnbmFtZScsJ2EnKTtcclxuICAgIHRlc3REaXZbJ25hbWUnXSAhPT0gJ2EnID8gY3JlbC5hdHRyTWFwWyduYW1lJ10gPSBmdW5jdGlvbihlbGVtZW50LCB2YWx1ZSl7XHJcbiAgICAgICAgZWxlbWVudC5pZCA9IHZhbHVlO1xyXG4gICAgfTp1bmRlZmluZWQ7XHJcblxyXG5cclxuICAgIHRlc3RMYWJlbC5zZXRBdHRyaWJ1dGUoJ2ZvcicsICdhJyk7XHJcbiAgICB0ZXN0TGFiZWxbJ2h0bWxGb3InXSAhPT0gJ2EnID8gY3JlbC5hdHRyTWFwWydmb3InXSA9ICdodG1sRm9yJzp1bmRlZmluZWQ7XHJcblxyXG5cclxuXHJcbiovXHJcblxyXG4oZnVuY3Rpb24gKHJvb3QsIGZhY3RvcnkpIHtcclxuICAgIGlmICh0eXBlb2YgZXhwb3J0cyA9PT0gJ29iamVjdCcpIHtcclxuICAgICAgICBtb2R1bGUuZXhwb3J0cyA9IGZhY3RvcnkoKTtcclxuICAgIH0gZWxzZSBpZiAodHlwZW9mIGRlZmluZSA9PT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUuYW1kKSB7XHJcbiAgICAgICAgZGVmaW5lKGZhY3RvcnkpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICByb290LmNyZWwgPSBmYWN0b3J5KCk7XHJcbiAgICB9XHJcbn0odGhpcywgZnVuY3Rpb24gKCkge1xyXG4gICAgdmFyIGZuID0gJ2Z1bmN0aW9uJyxcclxuICAgICAgICBvYmogPSAnb2JqZWN0JyxcclxuICAgICAgICBub2RlVHlwZSA9ICdub2RlVHlwZScsXHJcbiAgICAgICAgdGV4dENvbnRlbnQgPSAndGV4dENvbnRlbnQnLFxyXG4gICAgICAgIHNldEF0dHJpYnV0ZSA9ICdzZXRBdHRyaWJ1dGUnLFxyXG4gICAgICAgIGF0dHJNYXBTdHJpbmcgPSAnYXR0ck1hcCcsXHJcbiAgICAgICAgaXNOb2RlU3RyaW5nID0gJ2lzTm9kZScsXHJcbiAgICAgICAgaXNFbGVtZW50U3RyaW5nID0gJ2lzRWxlbWVudCcsXHJcbiAgICAgICAgZCA9IHR5cGVvZiBkb2N1bWVudCA9PT0gb2JqID8gZG9jdW1lbnQgOiB7fSxcclxuICAgICAgICBpc1R5cGUgPSBmdW5jdGlvbihhLCB0eXBlKXtcclxuICAgICAgICAgICAgcmV0dXJuIHR5cGVvZiBhID09PSB0eXBlO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgaXNOb2RlID0gdHlwZW9mIE5vZGUgPT09IGZuID8gZnVuY3Rpb24gKG9iamVjdCkge1xyXG4gICAgICAgICAgICByZXR1cm4gb2JqZWN0IGluc3RhbmNlb2YgTm9kZTtcclxuICAgICAgICB9IDpcclxuICAgICAgICAvLyBpbiBJRSA8PSA4IE5vZGUgaXMgYW4gb2JqZWN0LCBvYnZpb3VzbHkuLlxyXG4gICAgICAgIGZ1bmN0aW9uKG9iamVjdCl7XHJcbiAgICAgICAgICAgIHJldHVybiBvYmplY3QgJiZcclxuICAgICAgICAgICAgICAgIGlzVHlwZShvYmplY3QsIG9iaikgJiZcclxuICAgICAgICAgICAgICAgIChub2RlVHlwZSBpbiBvYmplY3QpICYmXHJcbiAgICAgICAgICAgICAgICBpc1R5cGUob2JqZWN0Lm93bmVyRG9jdW1lbnQsb2JqKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIGlzRWxlbWVudCA9IGZ1bmN0aW9uIChvYmplY3QpIHtcclxuICAgICAgICAgICAgcmV0dXJuIGNyZWxbaXNOb2RlU3RyaW5nXShvYmplY3QpICYmIG9iamVjdFtub2RlVHlwZV0gPT09IDE7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBpc0FycmF5ID0gZnVuY3Rpb24oYSl7XHJcbiAgICAgICAgICAgIHJldHVybiBhIGluc3RhbmNlb2YgQXJyYXk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBhcHBlbmRDaGlsZCA9IGZ1bmN0aW9uKGVsZW1lbnQsIGNoaWxkKSB7XHJcbiAgICAgICAgICBpZighY3JlbFtpc05vZGVTdHJpbmddKGNoaWxkKSl7XHJcbiAgICAgICAgICAgICAgY2hpbGQgPSBkLmNyZWF0ZVRleHROb2RlKGNoaWxkKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGVsZW1lbnQuYXBwZW5kQ2hpbGQoY2hpbGQpO1xyXG4gICAgICAgIH07XHJcblxyXG5cclxuICAgIGZ1bmN0aW9uIGNyZWwoKXtcclxuICAgICAgICB2YXIgYXJncyA9IGFyZ3VtZW50cywgLy9Ob3RlOiBhc3NpZ25lZCB0byBhIHZhcmlhYmxlIHRvIGFzc2lzdCBjb21waWxlcnMuIFNhdmVzIGFib3V0IDQwIGJ5dGVzIGluIGNsb3N1cmUgY29tcGlsZXIuIEhhcyBuZWdsaWdhYmxlIGVmZmVjdCBvbiBwZXJmb3JtYW5jZS5cclxuICAgICAgICAgICAgZWxlbWVudCA9IGFyZ3NbMF0sXHJcbiAgICAgICAgICAgIGNoaWxkLFxyXG4gICAgICAgICAgICBzZXR0aW5ncyA9IGFyZ3NbMV0sXHJcbiAgICAgICAgICAgIGNoaWxkSW5kZXggPSAyLFxyXG4gICAgICAgICAgICBhcmd1bWVudHNMZW5ndGggPSBhcmdzLmxlbmd0aCxcclxuICAgICAgICAgICAgYXR0cmlidXRlTWFwID0gY3JlbFthdHRyTWFwU3RyaW5nXTtcclxuXHJcbiAgICAgICAgZWxlbWVudCA9IGNyZWxbaXNFbGVtZW50U3RyaW5nXShlbGVtZW50KSA/IGVsZW1lbnQgOiBkLmNyZWF0ZUVsZW1lbnQoZWxlbWVudCk7XHJcbiAgICAgICAgLy8gc2hvcnRjdXRcclxuICAgICAgICBpZihhcmd1bWVudHNMZW5ndGggPT09IDEpe1xyXG4gICAgICAgICAgICByZXR1cm4gZWxlbWVudDtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmKCFpc1R5cGUoc2V0dGluZ3Msb2JqKSB8fCBjcmVsW2lzTm9kZVN0cmluZ10oc2V0dGluZ3MpIHx8IGlzQXJyYXkoc2V0dGluZ3MpKSB7XHJcbiAgICAgICAgICAgIC0tY2hpbGRJbmRleDtcclxuICAgICAgICAgICAgc2V0dGluZ3MgPSBudWxsO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gc2hvcnRjdXQgaWYgdGhlcmUgaXMgb25seSBvbmUgY2hpbGQgdGhhdCBpcyBhIHN0cmluZ1xyXG4gICAgICAgIGlmKChhcmd1bWVudHNMZW5ndGggLSBjaGlsZEluZGV4KSA9PT0gMSAmJiBpc1R5cGUoYXJnc1tjaGlsZEluZGV4XSwgJ3N0cmluZycpICYmIGVsZW1lbnRbdGV4dENvbnRlbnRdICE9PSB1bmRlZmluZWQpe1xyXG4gICAgICAgICAgICBlbGVtZW50W3RleHRDb250ZW50XSA9IGFyZ3NbY2hpbGRJbmRleF07XHJcbiAgICAgICAgfWVsc2V7XHJcbiAgICAgICAgICAgIGZvcig7IGNoaWxkSW5kZXggPCBhcmd1bWVudHNMZW5ndGg7ICsrY2hpbGRJbmRleCl7XHJcbiAgICAgICAgICAgICAgICBjaGlsZCA9IGFyZ3NbY2hpbGRJbmRleF07XHJcblxyXG4gICAgICAgICAgICAgICAgaWYoY2hpbGQgPT0gbnVsbCl7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKGlzQXJyYXkoY2hpbGQpKSB7XHJcbiAgICAgICAgICAgICAgICAgIGZvciAodmFyIGk9MDsgaSA8IGNoaWxkLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgYXBwZW5kQ2hpbGQoZWxlbWVudCwgY2hpbGRbaV0pO1xyXG4gICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICBhcHBlbmRDaGlsZChlbGVtZW50LCBjaGlsZCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGZvcih2YXIga2V5IGluIHNldHRpbmdzKXtcclxuICAgICAgICAgICAgaWYoIWF0dHJpYnV0ZU1hcFtrZXldKXtcclxuICAgICAgICAgICAgICAgIGVsZW1lbnRbc2V0QXR0cmlidXRlXShrZXksIHNldHRpbmdzW2tleV0pO1xyXG4gICAgICAgICAgICB9ZWxzZXtcclxuICAgICAgICAgICAgICAgIHZhciBhdHRyID0gYXR0cmlidXRlTWFwW2tleV07XHJcbiAgICAgICAgICAgICAgICBpZih0eXBlb2YgYXR0ciA9PT0gZm4pe1xyXG4gICAgICAgICAgICAgICAgICAgIGF0dHIoZWxlbWVudCwgc2V0dGluZ3Nba2V5XSk7XHJcbiAgICAgICAgICAgICAgICB9ZWxzZXtcclxuICAgICAgICAgICAgICAgICAgICBlbGVtZW50W3NldEF0dHJpYnV0ZV0oYXR0ciwgc2V0dGluZ3Nba2V5XSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJldHVybiBlbGVtZW50O1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFVzZWQgZm9yIG1hcHBpbmcgb25lIGtpbmQgb2YgYXR0cmlidXRlIHRvIHRoZSBzdXBwb3J0ZWQgdmVyc2lvbiBvZiB0aGF0IGluIGJhZCBicm93c2Vycy5cclxuICAgIGNyZWxbYXR0ck1hcFN0cmluZ10gPSB7fTtcclxuXHJcbiAgICBjcmVsW2lzRWxlbWVudFN0cmluZ10gPSBpc0VsZW1lbnQ7XHJcblxyXG4gICAgY3JlbFtpc05vZGVTdHJpbmddID0gaXNOb2RlO1xyXG5cclxuICAgIGlmKHR5cGVvZiBQcm94eSAhPT0gJ3VuZGVmaW5lZCcpe1xyXG4gICAgICAgIGNyZWwucHJveHkgPSBuZXcgUHJveHkoY3JlbCwge1xyXG4gICAgICAgICAgICBnZXQ6IGZ1bmN0aW9uKHRhcmdldCwga2V5KXtcclxuICAgICAgICAgICAgICAgICEoa2V5IGluIGNyZWwpICYmIChjcmVsW2tleV0gPSBjcmVsLmJpbmQobnVsbCwga2V5KSk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gY3JlbFtrZXldO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGNyZWw7XHJcbn0pKTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBEYXRlLm5vdyB8fCBub3dcblxuZnVuY3Rpb24gbm93KCkge1xuICAgIHJldHVybiBuZXcgRGF0ZSgpLmdldFRpbWUoKVxufVxuIiwiXG4vKipcbiAqIE1vZHVsZSBkZXBlbmRlbmNpZXMuXG4gKi9cblxudmFyIG5vdyA9IHJlcXVpcmUoJ2RhdGUtbm93Jyk7XG5cbi8qKlxuICogUmV0dXJucyBhIGZ1bmN0aW9uLCB0aGF0LCBhcyBsb25nIGFzIGl0IGNvbnRpbnVlcyB0byBiZSBpbnZva2VkLCB3aWxsIG5vdFxuICogYmUgdHJpZ2dlcmVkLiBUaGUgZnVuY3Rpb24gd2lsbCBiZSBjYWxsZWQgYWZ0ZXIgaXQgc3RvcHMgYmVpbmcgY2FsbGVkIGZvclxuICogTiBtaWxsaXNlY29uZHMuIElmIGBpbW1lZGlhdGVgIGlzIHBhc3NlZCwgdHJpZ2dlciB0aGUgZnVuY3Rpb24gb24gdGhlXG4gKiBsZWFkaW5nIGVkZ2UsIGluc3RlYWQgb2YgdGhlIHRyYWlsaW5nLlxuICpcbiAqIEBzb3VyY2UgdW5kZXJzY29yZS5qc1xuICogQHNlZSBodHRwOi8vdW5zY3JpcHRhYmxlLmNvbS8yMDA5LzAzLzIwL2RlYm91bmNpbmctamF2YXNjcmlwdC1tZXRob2RzL1xuICogQHBhcmFtIHtGdW5jdGlvbn0gZnVuY3Rpb24gdG8gd3JhcFxuICogQHBhcmFtIHtOdW1iZXJ9IHRpbWVvdXQgaW4gbXMgKGAxMDBgKVxuICogQHBhcmFtIHtCb29sZWFufSB3aGV0aGVyIHRvIGV4ZWN1dGUgYXQgdGhlIGJlZ2lubmluZyAoYGZhbHNlYClcbiAqIEBhcGkgcHVibGljXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBkZWJvdW5jZShmdW5jLCB3YWl0LCBpbW1lZGlhdGUpe1xuICB2YXIgdGltZW91dCwgYXJncywgY29udGV4dCwgdGltZXN0YW1wLCByZXN1bHQ7XG4gIGlmIChudWxsID09IHdhaXQpIHdhaXQgPSAxMDA7XG5cbiAgZnVuY3Rpb24gbGF0ZXIoKSB7XG4gICAgdmFyIGxhc3QgPSBub3coKSAtIHRpbWVzdGFtcDtcblxuICAgIGlmIChsYXN0IDwgd2FpdCAmJiBsYXN0ID4gMCkge1xuICAgICAgdGltZW91dCA9IHNldFRpbWVvdXQobGF0ZXIsIHdhaXQgLSBsYXN0KTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGltZW91dCA9IG51bGw7XG4gICAgICBpZiAoIWltbWVkaWF0ZSkge1xuICAgICAgICByZXN1bHQgPSBmdW5jLmFwcGx5KGNvbnRleHQsIGFyZ3MpO1xuICAgICAgICBpZiAoIXRpbWVvdXQpIGNvbnRleHQgPSBhcmdzID0gbnVsbDtcbiAgICAgIH1cbiAgICB9XG4gIH07XG5cbiAgcmV0dXJuIGZ1bmN0aW9uIGRlYm91bmNlZCgpIHtcbiAgICBjb250ZXh0ID0gdGhpcztcbiAgICBhcmdzID0gYXJndW1lbnRzO1xuICAgIHRpbWVzdGFtcCA9IG5vdygpO1xuICAgIHZhciBjYWxsTm93ID0gaW1tZWRpYXRlICYmICF0aW1lb3V0O1xuICAgIGlmICghdGltZW91dCkgdGltZW91dCA9IHNldFRpbWVvdXQobGF0ZXIsIHdhaXQpO1xuICAgIGlmIChjYWxsTm93KSB7XG4gICAgICByZXN1bHQgPSBmdW5jLmFwcGx5KGNvbnRleHQsIGFyZ3MpO1xuICAgICAgY29udGV4dCA9IGFyZ3MgPSBudWxsO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG59O1xuIiwiZnVuY3Rpb24gZmxhdE1lcmdlKGEsYil7XG4gICAgaWYoIWIgfHwgdHlwZW9mIGIgIT09ICdvYmplY3QnKXtcbiAgICAgICAgYiA9IHt9O1xuICAgIH1cblxuICAgIGlmKCFhIHx8IHR5cGVvZiBhICE9PSAnb2JqZWN0Jyl7XG4gICAgICAgIGEgPSBuZXcgYi5jb25zdHJ1Y3RvcigpO1xuICAgIH1cblxuICAgIHZhciByZXN1bHQgPSBuZXcgYS5jb25zdHJ1Y3RvcigpLFxuICAgICAgICBhS2V5cyA9IE9iamVjdC5rZXlzKGEpLFxuICAgICAgICBiS2V5cyA9IE9iamVjdC5rZXlzKGIpO1xuXG4gICAgZm9yKHZhciBpID0gMDsgaSA8IGFLZXlzLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgcmVzdWx0W2FLZXlzW2ldXSA9IGFbYUtleXNbaV1dO1xuICAgIH1cblxuICAgIGZvcih2YXIgaSA9IDA7IGkgPCBiS2V5cy5sZW5ndGg7IGkrKyl7XG4gICAgICAgIHJlc3VsdFtiS2V5c1tpXV0gPSBiW2JLZXlzW2ldXTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZsYXRNZXJnZTsiLCJtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKHZhbHVlKXtcclxuICAgIHJldHVybiB2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnIHx8IHR5cGVvZiB2YWx1ZSA9PT0gJ2Z1bmN0aW9uJztcclxufTsiLCJ2YXIgbmFyZ3MgPSAvXFx7KFswLTlhLXpBLVpdKylcXH0vZ1xudmFyIHNsaWNlID0gQXJyYXkucHJvdG90eXBlLnNsaWNlXG5cbm1vZHVsZS5leHBvcnRzID0gdGVtcGxhdGVcblxuZnVuY3Rpb24gdGVtcGxhdGUoc3RyaW5nKSB7XG4gICAgdmFyIGFyZ3NcblxuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAyICYmIHR5cGVvZiBhcmd1bWVudHNbMV0gPT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgYXJncyA9IGFyZ3VtZW50c1sxXVxuICAgIH0gZWxzZSB7XG4gICAgICAgIGFyZ3MgPSBzbGljZS5jYWxsKGFyZ3VtZW50cywgMSlcbiAgICB9XG5cbiAgICBpZiAoIWFyZ3MgfHwgIWFyZ3MuaGFzT3duUHJvcGVydHkpIHtcbiAgICAgICAgYXJncyA9IHt9XG4gICAgfVxuXG4gICAgcmV0dXJuIHN0cmluZy5yZXBsYWNlKG5hcmdzLCBmdW5jdGlvbiByZXBsYWNlQXJnKG1hdGNoLCBpLCBpbmRleCkge1xuICAgICAgICB2YXIgcmVzdWx0XG5cbiAgICAgICAgaWYgKHN0cmluZ1tpbmRleCAtIDFdID09PSBcIntcIiAmJlxuICAgICAgICAgICAgc3RyaW5nW2luZGV4ICsgbWF0Y2gubGVuZ3RoXSA9PT0gXCJ9XCIpIHtcbiAgICAgICAgICAgIHJldHVybiBpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXN1bHQgPSBhcmdzLmhhc093blByb3BlcnR5KGkpID8gYXJnc1tpXSA6IG51bGxcbiAgICAgICAgICAgIGlmIChyZXN1bHQgPT09IG51bGwgfHwgcmVzdWx0ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gXCJcIlxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0XG4gICAgICAgIH1cbiAgICB9KVxufVxuIiwibW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgJ2RlbGV0ZSc6IHtcbiAgICAgICAgdW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdkZWxldGUnLFxuICAgICAgICAgICAgZGlyZWN0aW9uOiAncmlnaHQnLFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMjBcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJy4uLic6IHtcbiAgICAgICAgdW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdzcHJlYWQnLFxuICAgICAgICAgICAgZGlyZWN0aW9uOiAncmlnaHQnLFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTlcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJy4uJzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdyYW5nZScsXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAzXG4gICAgICAgIH1cbiAgICB9LFxuICAgICcrJzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdhZGQnLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpICsgYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDEzXG4gICAgICAgIH0sXG4gICAgICAgIHVuYXJ5OntcbiAgICAgICAgICAgIG5hbWU6ICdwb3NpdGl2ZScsXG4gICAgICAgICAgICBkaXJlY3Rpb246ICdyaWdodCcsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSkge1xuICAgICAgICAgICAgICAgIHJldHVybiArYSgpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDE1XG4gICAgICAgIH1cbiAgICB9LFxuICAgICctJzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdzdWJ0cmFjdCcsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhKCkgLSBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTNcbiAgICAgICAgfSxcbiAgICAgICAgdW5hcnk6e1xuICAgICAgICAgICAgbmFtZTogJ25lZ2F0aXZlJyxcbiAgICAgICAgICAgIGRpcmVjdGlvbjogJ3JpZ2h0JyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIC1hKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTVcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJyonOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ211bHRpcGx5JyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSAqIGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxNFxuICAgICAgICB9XG4gICAgfSxcbiAgICAnLyc6IHtcbiAgICAgICAgYmluYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAnZGl2aWRlJyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSAvIGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxNFxuICAgICAgICB9XG4gICAgfSxcbiAgICAnJSc6IHtcbiAgICAgICAgYmluYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAncmVtYWluZGVyJyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSAlIGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxNFxuICAgICAgICB9XG4gICAgfSxcbiAgICAnaW4nOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2luJyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSBpbiBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTFcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJz09PSc6IHtcbiAgICAgICAgYmluYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAnZXhhY3RseUVxdWFsJyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSA9PT0gYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDEwXG4gICAgICAgIH1cbiAgICB9LFxuICAgICchPT0nOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ25vdEV4YWN0bHlFcXVhbCcsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhKCkgIT09IGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxMFxuICAgICAgICB9XG4gICAgfSxcbiAgICAnPT0nOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2VxdWFsJyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSA9PSBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTBcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJyE9Jzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdub3RFcXVhbCcsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhKCkgIT0gYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDEwXG4gICAgICAgIH1cbiAgICB9LFxuICAgICc+PSc6IHtcbiAgICAgICAgYmluYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAnZ3JlYXRlclRoYW5PckVxdWFsJyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSA+PSBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTFcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJzw9Jzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdsZXNzVGhhbk9yRXF1YWwnLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpIDw9IGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiAxMVxuICAgICAgICB9XG4gICAgfSxcbiAgICAnPic6IHtcbiAgICAgICAgYmluYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAnZ3JlYXRlclRoYW4nLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpID4gYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDExXG4gICAgICAgIH1cbiAgICB9LFxuICAgICc8Jzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdsZXNzVGhhbicsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhKCkgPCBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTFcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJyYmJzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdhbmQnLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpICYmIGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiA2XG4gICAgICAgIH1cbiAgICB9LFxuICAgICd8fCc6IHtcbiAgICAgICAgYmluYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAnb3InLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpIHx8IGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiA1XG4gICAgICAgIH1cbiAgICB9LFxuICAgICchJzoge1xuICAgICAgICB1bmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ25vdCcsXG4gICAgICAgICAgICBkaXJlY3Rpb246ICdyaWdodCcsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSkge1xuICAgICAgICAgICAgICAgIHJldHVybiAhYSgpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDE1XG4gICAgICAgIH1cbiAgICB9LFxuICAgICcmJzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdiaXR3aXNlQW5kJyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSAmIGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiA5XG4gICAgICAgIH1cbiAgICB9LFxuICAgICdeJzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdiaXR3aXNlWE9yJyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSBeIGIoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcmVjZWRlbmNlOiA4XG4gICAgICAgIH1cbiAgICB9LFxuICAgICd8Jzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdiaXR3aXNlT3InLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpIHwgYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDdcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJ34nOiB7XG4gICAgICAgIHVuYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAnYml0d2lzZU5vdCcsXG4gICAgICAgICAgICBkaXJlY3Rpb246ICdyaWdodCcsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSkge1xuICAgICAgICAgICAgICAgIHJldHVybiB+YSgpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDE1XG4gICAgICAgIH1cbiAgICB9LFxuICAgICd0eXBlb2YnOiB7XG4gICAgICAgIHVuYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAndHlwZW9mJyxcbiAgICAgICAgICAgIGRpcmVjdGlvbjogJ3JpZ2h0JyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHR5cGVvZiBhKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTVcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJzw8Jzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdiaXR3aXNlTGVmdFNoaWZ0JyxcbiAgICAgICAgICAgIGZuOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGEoKSA8PCBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTJcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJz4+Jzoge1xuICAgICAgICBiaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICdiaXR3aXNlUmlnaHRTaGlmdCcsXG4gICAgICAgICAgICBmbjogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhKCkgPj4gYigpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByZWNlZGVuY2U6IDEyXG4gICAgICAgIH1cbiAgICB9LFxuICAgICc+Pj4nOiB7XG4gICAgICAgIGJpbmFyeToge1xuICAgICAgICAgICAgbmFtZTogJ2JpdHdpc2VVbnNpZ25lZFJpZ2h0U2hpZnQnLFxuICAgICAgICAgICAgZm46IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYSgpID4+PiBiKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogMTJcbiAgICAgICAgfVxuICAgIH0sXG4gICAgJz8nOiB7XG4gICAgICAgIHRyaW5hcnk6IHtcbiAgICAgICAgICAgIG5hbWU6ICd0ZXJuYXJ5JyxcbiAgICAgICAgICAgIHRyaW5hcnk6ICd0dXBsZScsXG4gICAgICAgICAgICBhc3NvY2lhdGl2aXR5OiAncmlnaHQnLFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogNFxuICAgICAgICB9XG4gICAgfSxcbiAgICAnOic6IHtcbiAgICAgICAgYmluYXJ5OiB7XG4gICAgICAgICAgICBuYW1lOiAndHVwbGUnLFxuICAgICAgICAgICAgcHJlY2VkZW5jZTogM1xuICAgICAgICB9XG4gICAgfVxufTsiLCJ2YXIgb3BlcmF0b3JzID0gcmVxdWlyZSgnLi9vcGVyYXRvcnMnKSxcbiAgICB0ZW1wbGF0ZSA9IHJlcXVpcmUoJ3N0cmluZy10ZW1wbGF0ZScpLFxuICAgIGVycm9yVGVtcGxhdGUgPSAnUGFyc2UgZXJyb3IsXFxue21lc3NhZ2V9LFxcbkF0IHtpbmRleH0gXCJ7c25pcHBldH1cIicsXG4gICAgc25pcHBldFRlbXBsYXRlID0gJy0tPnswfTwtLSc7XG5cbmZ1bmN0aW9uIHBhcnNlRXJyb3IobWVzc2FnZSwgdG9rZW4pe1xuICAgIHZhciBzdGFydCA9IE1hdGgubWF4KHRva2VuLmluZGV4IC0gNTAsIDApLFxuICAgICAgICBlcnJvckluZGV4ID0gTWF0aC5taW4oNTAsIHRva2VuLmluZGV4KSxcbiAgICAgICAgc3Vycm91bmRpbmdTb3VyY2UgPSB0b2tlbi5zb3VyY2VSZWYuc291cmNlLnNsaWNlKHN0YXJ0LCB0b2tlbi5pbmRleCArIDUwKSxcbiAgICAgICAgZXJyb3JNZXNzYWdlID0gdGVtcGxhdGUoZXJyb3JUZW1wbGF0ZSwge1xuICAgICAgICAgICAgbWVzc2FnZTogbWVzc2FnZSxcbiAgICAgICAgICAgIGluZGV4OiB0b2tlbi5pbmRleCxcbiAgICAgICAgICAgIHNuaXBwZXQ6IFtcbiAgICAgICAgICAgICAgICAoc3RhcnQgPT09IDAgPyAnJyA6ICcuLi5cXG4nKSxcbiAgICAgICAgICAgICAgICBzdXJyb3VuZGluZ1NvdXJjZS5zbGljZSgwLCBlcnJvckluZGV4KSxcbiAgICAgICAgICAgICAgICB0ZW1wbGF0ZShzbmlwcGV0VGVtcGxhdGUsIHN1cnJvdW5kaW5nU291cmNlLnNsaWNlKGVycm9ySW5kZXgsIGVycm9ySW5kZXgrMSkpLFxuICAgICAgICAgICAgICAgIHN1cnJvdW5kaW5nU291cmNlLnNsaWNlKGVycm9ySW5kZXggKyAxKSArICcnLFxuICAgICAgICAgICAgICAgIChzdXJyb3VuZGluZ1NvdXJjZS5sZW5ndGggPCAxMDAgPyAnJyA6ICcuLi4nKVxuICAgICAgICAgICAgXS5qb2luKCcnKVxuICAgICAgICB9KTtcblxuICAgIHRocm93IGVycm9yTWVzc2FnZTtcbn1cblxuZnVuY3Rpb24gZmluZE5leHROb25EZWxpbWl0ZXIodG9rZW5zKXtcbiAgICB2YXIgcmVzdWx0O1xuXG4gICAgd2hpbGUocmVzdWx0ID0gdG9rZW5zLnNoaWZ0KCkpe1xuICAgICAgICBpZighcmVzdWx0IHx8IHJlc3VsdC50eXBlICE9PSAnZGVsaW1pdGVyJyl7XG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICB9XG4gICAgfVxufVxuXG5mdW5jdGlvbiBsYXN0VG9rZW5NYXRjaGVzKGFzdCwgdHlwZXMsIHBvcCl7XG4gICAgdmFyIGxhc3RUb2tlbiA9IGFzdFthc3QubGVuZ3RoIC0gMV0sXG4gICAgICAgIGxhc3RUb2tlblR5cGUsXG4gICAgICAgIG1hdGNoZWQ7XG5cbiAgICBpZighbGFzdFRva2VuKXtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGxhc3RUb2tlblR5cGUgPSBsYXN0VG9rZW4udHlwZTtcblxuICAgIGZvciAodmFyIGkgPSB0eXBlcy5sZW5ndGgtMSwgdHlwZSA9IHR5cGVzW2ldOyBpID49IDA7IGktLSwgdHlwZSA9IHR5cGVzW2ldKSB7XG4gICAgICAgIGlmKHR5cGUgPT09ICchJyArIGxhc3RUb2tlblR5cGUpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYodHlwZSA9PT0gJyonIHx8IHR5cGUgPT09IGxhc3RUb2tlblR5cGUpe1xuICAgICAgICAgICAgbWF0Y2hlZCA9IHRydWU7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZighbWF0Y2hlZCl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZihwb3Ape1xuICAgICAgICBhc3QucG9wKCk7XG4gICAgfVxuICAgIHJldHVybiBsYXN0VG9rZW47XG59XG5cbmZ1bmN0aW9uIHBhcnNlSWRlbnRpZmllcih0b2tlbnMsIGFzdCl7XG4gICAgaWYodG9rZW5zWzBdLnR5cGUgPT09ICd3b3JkJyl7XG4gICAgICAgIGFzdC5wdXNoKHtcbiAgICAgICAgICAgIHR5cGU6ICdpZGVudGlmaWVyJyxcbiAgICAgICAgICAgIG5hbWU6IHRva2Vucy5zaGlmdCgpLnNvdXJjZVxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZU51bWJlcih0b2tlbnMsIGFzdCl7XG4gICAgaWYodG9rZW5zWzBdLnR5cGUgPT09ICdudW1iZXInKXtcbiAgICAgICAgYXN0LnB1c2goe1xuICAgICAgICAgICAgdHlwZTogJ251bWJlcicsXG4gICAgICAgICAgICB2YWx1ZTogcGFyc2VGbG9hdCh0b2tlbnMuc2hpZnQoKS5zb3VyY2UpXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGZ1bmN0aW9uQ2FsbCh0YXJnZXQsIGNvbnRlbnQpe1xuICAgIHJldHVybiB7XG4gICAgICAgIHR5cGU6ICdmdW5jdGlvbkNhbGwnLFxuICAgICAgICB0YXJnZXQ6IHRhcmdldCxcbiAgICAgICAgY29udGVudDogY29udGVudFxuICAgIH07XG59XG5cbmZ1bmN0aW9uIHBhcnNlUGFyZW50aGVzaXModG9rZW5zLCBhc3QpIHtcbiAgICBpZih0b2tlbnNbMF0udHlwZSAhPT0gJ3BhcmVudGhlc2lzT3Blbicpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIG9wZW5Ub2tlbiA9IHRva2Vuc1swXSxcbiAgICAgICAgcG9zaXRpb24gPSAwLFxuICAgICAgICBvcGVucyA9IDE7XG5cbiAgICB3aGlsZSgrK3Bvc2l0aW9uLCBwb3NpdGlvbiA8PSB0b2tlbnMubGVuZ3RoICYmIG9wZW5zKXtcbiAgICAgICAgaWYoIXRva2Vuc1twb3NpdGlvbl0pe1xuICAgICAgICAgICAgcGFyc2VFcnJvcignaW52YWxpZCBuZXN0aW5nLiBObyBjbG9zaW5nIHRva2VuIHdhcyBmb3VuZCcsIHRva2Vuc1twb3NpdGlvbi0xXSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYodG9rZW5zW3Bvc2l0aW9uXS50eXBlID09PSAncGFyZW50aGVzaXNPcGVuJykge1xuICAgICAgICAgICAgb3BlbnMrKztcbiAgICAgICAgfVxuICAgICAgICBpZih0b2tlbnNbcG9zaXRpb25dLnR5cGUgPT09ICdwYXJlbnRoZXNpc0Nsb3NlJykge1xuICAgICAgICAgICAgb3BlbnMtLTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHZhciB0YXJnZXQgPSAhb3BlblRva2VuLmRlbGltaXRlclByZWZpeCAmJiBsYXN0VG9rZW5NYXRjaGVzKGFzdCwgWycqJywgJyFzdGF0ZW1lbnQnLCAnIW9wZXJhdG9yJywgJyFzZXQnXSwgdHJ1ZSksXG4gICAgICAgIGNvbnRlbnQgPSBwYXJzZSh0b2tlbnMuc3BsaWNlKDAsIHBvc2l0aW9uKS5zbGljZSgxLC0xKSksXG4gICAgICAgIGFzdE5vZGU7XG5cbiAgICBpZih0YXJnZXQpe1xuICAgICAgICBhc3ROb2RlID0gZnVuY3Rpb25DYWxsKHRhcmdldCwgY29udGVudCk7XG4gICAgfWVsc2V7XG4gICAgICAgIGFzdE5vZGUgPSB7XG4gICAgICAgICAgICB0eXBlOiAncGFyZW50aGVzaXNHcm91cCcsXG4gICAgICAgICAgICBjb250ZW50OiBjb250ZW50XG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgYXN0LnB1c2goYXN0Tm9kZSk7XG5cbiAgICByZXR1cm4gdHJ1ZTtcbn1cblxuZnVuY3Rpb24gcGFyc2VQYXJhbWV0ZXJzKGZ1bmN0aW9uQ2FsbCl7XG4gICAgcmV0dXJuIGZ1bmN0aW9uQ2FsbC5jb250ZW50Lm1hcChmdW5jdGlvbih0b2tlbil7XG4gICAgICAgIGlmKHRva2VuLnR5cGUgPT09ICdpZGVudGlmaWVyJyB8fCAodG9rZW4ubmFtZSA9PT0gJ3NwcmVhZCcgJiYgdG9rZW4ucmlnaHQudHlwZSA9PT0gJ2lkZW50aWZpZXInKSl7XG4gICAgICAgICAgICByZXR1cm4gdG9rZW47XG4gICAgICAgIH1cblxuICAgICAgICBwYXJzZUVycm9yKCdVbmV4cGVjdGVkIHRva2VuIGluIHBhcmFtZXRlciBsaXN0JywgZnVuY3Rpb25DYWxsKTtcbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gbmFtZWRGdW5jdGlvbkV4cHJlc3Npb24oZnVuY3Rpb25DYWxsLCBjb250ZW50KXtcbiAgICBpZihmdW5jdGlvbkNhbGwudGFyZ2V0LnR5cGUgIT09ICdpZGVudGlmaWVyJyl7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICB0eXBlOiAnZnVuY3Rpb25FeHByZXNzaW9uJyxcbiAgICAgICAgaWRlbnRpZmllcjogZnVuY3Rpb25DYWxsLnRhcmdldCxcbiAgICAgICAgcGFyYW1ldGVyczogcGFyc2VQYXJhbWV0ZXJzKGZ1bmN0aW9uQ2FsbCksXG4gICAgICAgIGNvbnRlbnQ6IGNvbnRlbnRcbiAgICB9O1xufVxuXG5mdW5jdGlvbiBhbm9ueW1vdXNGdW5jdGlvbkV4cHJlc3Npb24ocGFyZW50aGVzaXNHcm91cCwgY29udGVudCl7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgdHlwZTogJ2Z1bmN0aW9uRXhwcmVzc2lvbicsXG4gICAgICAgIHBhcmFtZXRlcnM6IHBhcnNlUGFyYW1ldGVycyhwYXJlbnRoZXNpc0dyb3VwKSxcbiAgICAgICAgY29udGVudDogY29udGVudFxuICAgIH07XG59XG5cbmZ1bmN0aW9uIHBhcnNlQmxvY2sodG9rZW5zLCBhc3Qpe1xuICAgIGlmKHRva2Vuc1swXS50eXBlICE9PSAnYnJhY2VPcGVuJyl7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgcG9zaXRpb24gPSAwLFxuICAgICAgICBvcGVucyA9IDE7XG5cbiAgICB3aGlsZSgrK3Bvc2l0aW9uLCBwb3NpdGlvbiA8PSB0b2tlbnMubGVuZ3RoICYmIG9wZW5zKXtcbiAgICAgICAgaWYoIXRva2Vuc1twb3NpdGlvbl0pe1xuICAgICAgICAgICAgcGFyc2VFcnJvcignaW52YWxpZCBuZXN0aW5nLiBObyBjbG9zaW5nIHRva2VuIHdhcyBmb3VuZCcsIHRva2Vuc1twb3NpdGlvbi0xXSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYodG9rZW5zW3Bvc2l0aW9uXS50eXBlID09PSAnYnJhY2VPcGVuJyl7XG4gICAgICAgICAgICBvcGVucysrO1xuICAgICAgICB9XG4gICAgICAgIGlmKHRva2Vuc1twb3NpdGlvbl0udHlwZSA9PT0gJ2JyYWNlQ2xvc2UnKXtcbiAgICAgICAgICAgIG9wZW5zLS07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB2YXIgdGFyZ2V0VG9rZW4gPSB0b2tlbnNbMF0sXG4gICAgICAgIGNvbnRlbnQgPSBwYXJzZSh0b2tlbnMuc3BsaWNlKDAsIHBvc2l0aW9uKS5zbGljZSgxLC0xKSk7XG5cbiAgICB2YXIgZnVuY3Rpb25DYWxsID0gbGFzdFRva2VuTWF0Y2hlcyhhc3QsIFsnZnVuY3Rpb25DYWxsJ10sIHRydWUpLFxuICAgICAgICBwYXJlbnRoZXNpc0dyb3VwID0gbGFzdFRva2VuTWF0Y2hlcyhhc3QsIFsncGFyZW50aGVzaXNHcm91cCddLCB0cnVlKSxcbiAgICAgICAgYXN0Tm9kZTtcblxuICAgIGlmKGZ1bmN0aW9uQ2FsbCl7XG4gICAgICAgIGFzdE5vZGUgPSBuYW1lZEZ1bmN0aW9uRXhwcmVzc2lvbihmdW5jdGlvbkNhbGwsIGNvbnRlbnQpO1xuICAgIH1lbHNlIGlmKHBhcmVudGhlc2lzR3JvdXApe1xuICAgICAgICBhc3ROb2RlID0gYW5vbnltb3VzRnVuY3Rpb25FeHByZXNzaW9uKHBhcmVudGhlc2lzR3JvdXAsIGNvbnRlbnQpO1xuICAgIH1lbHNle1xuICAgICAgICBhc3ROb2RlID0ge1xuICAgICAgICAgICAgdHlwZTogJ2JyYWNlR3JvdXAnLFxuICAgICAgICAgICAgY29udGVudDogY29udGVudFxuICAgICAgICB9O1xuICAgIH1cblxuICAgIGlmKCFhc3ROb2RlKXtcbiAgICAgICAgcGFyc2VFcnJvcigndW5leHBlY3RlZCB0b2tlbi4nLCB0YXJnZXRUb2tlbik7XG4gICAgfVxuXG4gICAgYXN0LnB1c2goYXN0Tm9kZSk7XG5cbiAgICByZXR1cm4gdHJ1ZTtcbn1cblxuZnVuY3Rpb24gcGFyc2VTZXQodG9rZW5zLCBhc3QpIHtcbiAgICBpZih0b2tlbnNbMF0udHlwZSAhPT0gJ3NxdWFyZUJyYWNlT3Blbicpe1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIG9wZW5Ub2tlbiA9IHRva2Vuc1swXSxcbiAgICAgICAgcG9zaXRpb24gPSAwLFxuICAgICAgICBvcGVucyA9IDE7XG5cbiAgICB3aGlsZSgrK3Bvc2l0aW9uLCBwb3NpdGlvbiA8PSB0b2tlbnMubGVuZ3RoICYmIG9wZW5zKXtcbiAgICAgICAgaWYoIXRva2Vuc1twb3NpdGlvbl0pe1xuICAgICAgICAgICAgcGFyc2VFcnJvcignaW52YWxpZCBuZXN0aW5nLiBObyBjbG9zaW5nIHRva2VuIHdhcyBmb3VuZCcsIHRva2Vuc1twb3NpdGlvbi0xXSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYodG9rZW5zW3Bvc2l0aW9uXS50eXBlID09PSAnc3F1YXJlQnJhY2VPcGVuJykge1xuICAgICAgICAgICAgb3BlbnMrKztcbiAgICAgICAgfVxuICAgICAgICBpZih0b2tlbnNbcG9zaXRpb25dLnR5cGUgPT09ICdzcXVhcmVCcmFjZUNsb3NlJykge1xuICAgICAgICAgICAgb3BlbnMtLTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHZhciBjb250ZW50ID0gcGFyc2UodG9rZW5zLnNwbGljZSgwLCBwb3NpdGlvbikuc2xpY2UoMSwtMSkpLFxuICAgICAgICB0YXJnZXQgPSAhb3BlblRva2VuLmRlbGltaXRlclByZWZpeCAmJiBsYXN0VG9rZW5NYXRjaGVzKGFzdCwgWycqJywgJyFmdW5jdGlvbkV4cHJlc3Npb24nLCAnIWJyYWNlR3JvdXAnLCAnIXN0YXRlbWVudCcsICchb3BlcmF0b3InXSwgdHJ1ZSk7XG5cbiAgICBpZih0YXJnZXQpe1xuICAgICAgICBhc3QucHVzaCh7XG4gICAgICAgICAgICB0eXBlOiAnYWNjZXNzb3InLFxuICAgICAgICAgICAgdGFyZ2V0OiB0YXJnZXQsXG4gICAgICAgICAgICBjb250ZW50OiBjb250ZW50XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIGFzdC5wdXNoKHtcbiAgICAgICAgdHlwZTogJ3NldCcsXG4gICAgICAgIGNvbnRlbnQ6IGNvbnRlbnRcbiAgICB9KTtcblxuICAgIHJldHVybiB0cnVlO1xufVxuXG5cbmZ1bmN0aW9uIHBhcnNlRGVsaW1pdGVycyh0b2tlbnMpe1xuICAgIGlmKHRva2Vuc1swXS50eXBlID09PSAnZGVsaW1pdGVyJyl7XG4gICAgICAgIHRva2Vucy5zcGxpY2UoMCwxKTtcbiAgICAgICAgaWYodG9rZW5zWzBdKXtcbiAgICAgICAgICAgIHRva2Vuc1swXS5kZWxpbWl0ZXJQcmVmaXggPSB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VDb21tZW50cyh0b2tlbnMpe1xuICAgIGlmKHRva2Vuc1swXS50eXBlID09PSAnY29tbWVudCcpe1xuICAgICAgICB0b2tlbnMuc2hpZnQoKTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZU9wZXJhdG9yKHRva2VucywgYXN0KXtcbiAgICBpZih0b2tlbnNbMF0udHlwZSA9PT0gJ29wZXJhdG9yJyl7XG4gICAgICAgIHZhciB0b2tlbiA9IHRva2Vucy5zaGlmdCgpLFxuICAgICAgICAgICAgb3BlcmF0b3JzRm9yU291cmNlID0gb3BlcmF0b3JzW3Rva2VuLnNvdXJjZV0sXG4gICAgICAgICAgICBzdGFydE9mU3RhdGVtZW50ID0gIWxhc3RUb2tlbk1hdGNoZXMoYXN0LCBbJyonLCAnIXN0YXRlbWVudCcsICchb3BlcmF0b3InXSk7XG5cbiAgICAgICAgaWYob3BlcmF0b3JzRm9yU291cmNlLmJpbmFyeSAmJiAhc3RhcnRPZlN0YXRlbWVudCl7XG4gICAgICAgICAgICBhc3QucHVzaCh7XG4gICAgICAgICAgICAgICAgdHlwZTogJ29wZXJhdG9yJyxcbiAgICAgICAgICAgICAgICBuYW1lOiBvcGVyYXRvcnNGb3JTb3VyY2UuYmluYXJ5Lm5hbWUsXG4gICAgICAgICAgICAgICAgb3BlcmF0b3I6IG9wZXJhdG9yc0ZvclNvdXJjZS5iaW5hcnksXG4gICAgICAgICAgICAgICAgc291cmNlUmVmOiB0b2tlbi5zb3VyY2VSZWYsXG4gICAgICAgICAgICAgICAgaW5kZXg6IHRva2VuLmluZGV4XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYob3BlcmF0b3JzRm9yU291cmNlLnVuYXJ5KXtcbiAgICAgICAgICAgIGFzdC5wdXNoKHtcbiAgICAgICAgICAgICAgICB0eXBlOiAnb3BlcmF0b3InLFxuICAgICAgICAgICAgICAgIG5hbWU6IG9wZXJhdG9yc0ZvclNvdXJjZS51bmFyeS5uYW1lLFxuICAgICAgICAgICAgICAgIG9wZXJhdG9yOiBvcGVyYXRvcnNGb3JTb3VyY2UudW5hcnksXG4gICAgICAgICAgICAgICAgc291cmNlUmVmOiB0b2tlbi5zb3VyY2VSZWYsXG4gICAgICAgICAgICAgICAgaW5kZXg6IHRva2VuLmluZGV4XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYob3BlcmF0b3JzRm9yU291cmNlLnRyaW5hcnkgJiYgIXN0YXJ0T2ZTdGF0ZW1lbnQpe1xuICAgICAgICAgICAgYXN0LnB1c2goe1xuICAgICAgICAgICAgICAgIHR5cGU6ICdvcGVyYXRvcicsXG4gICAgICAgICAgICAgICAgbmFtZTogb3BlcmF0b3JzRm9yU291cmNlLnRyaW5hcnkubmFtZSxcbiAgICAgICAgICAgICAgICBvcGVyYXRvcjogb3BlcmF0b3JzRm9yU291cmNlLnRyaW5hcnksXG4gICAgICAgICAgICAgICAgc291cmNlUmVmOiB0b2tlbi5zb3VyY2VSZWYsXG4gICAgICAgICAgICAgICAgaW5kZXg6IHRva2VuLmluZGV4XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgcGFyc2VFcnJvcignVW5leHBlY3RlZCB0b2tlbicsIHRva2VuKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlUGVyaW9kKHRva2VucywgYXN0KXtcbiAgICBpZih0b2tlbnNbMF0udHlwZSA9PT0gJ3BlcmlvZCcpe1xuICAgICAgICB2YXIgdG9rZW4gPSB0b2tlbnMuc2hpZnQoKSxcbiAgICAgICAgICAgIHJpZ2h0ID0gZmluZE5leHROb25EZWxpbWl0ZXIodG9rZW5zKTtcblxuICAgICAgICBpZighcmlnaHQpe1xuICAgICAgICAgICAgcmV0dXJuIHBhcnNlRXJyb3IoJ1VuZXhwZWN0ZWQgdG9rZW4nLCB0b2tlbik7XG4gICAgICAgIH1cblxuICAgICAgICBhc3QucHVzaCh7XG4gICAgICAgICAgICB0eXBlOiAncGVyaW9kJyxcbiAgICAgICAgICAgIGxlZnQ6IGFzdC5wb3AoKSxcbiAgICAgICAgICAgIHJpZ2h0OiBwYXJzZVRva2VuKFtyaWdodF0pLnBvcCgpXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VTdHJpbmcodG9rZW5zLCBhc3Qpe1xuICAgIGlmKHRva2Vuc1swXS50eXBlID09PSAnc3RyaW5nJyl7XG4gICAgICAgIGFzdC5wdXNoKHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgdmFsdWU6IHRva2Vucy5zaGlmdCgpLnNvdXJjZS5zbGljZSgxLC0xKVxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZVNlbWljb2xvbih0b2tlbnMsIGFzdCl7XG4gICAgaWYodG9rZW5zWzBdLnR5cGUgPT09ICdzZW1pY29sb24nKXtcbiAgICAgICAgdG9rZW5zLnNoaWZ0KCk7XG4gICAgICAgIGFzdC5wdXNoKHtcbiAgICAgICAgICAgIHR5cGU6ICdzdGF0ZW1lbnQnLFxuICAgICAgICAgICAgY29udGVudDogW2FzdC5wb3AoKV1cbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbn1cblxudmFyIHBhcnNlcnMgPSBbXG4gICAgcGFyc2VEZWxpbWl0ZXJzLFxuICAgIHBhcnNlQ29tbWVudHMsXG4gICAgcGFyc2VOdW1iZXIsXG4gICAgcGFyc2VTdHJpbmcsXG4gICAgcGFyc2VJZGVudGlmaWVyLFxuICAgIHBhcnNlUGVyaW9kLFxuICAgIHBhcnNlUGFyZW50aGVzaXMsXG4gICAgcGFyc2VTZXQsXG4gICAgcGFyc2VCbG9jayxcbiAgICBwYXJzZU9wZXJhdG9yLFxuICAgIHBhcnNlU2VtaWNvbG9uXG5dO1xuXG5mdW5jdGlvbiBwYXJzZU9wZXJhdG9ycyhhc3Qpe1xuICAgIGFzdC5maWx0ZXIoZnVuY3Rpb24odG9rZW4pe1xuICAgICAgICByZXR1cm4gdG9rZW4udHlwZSA9PT0gJ29wZXJhdG9yJztcbiAgICB9KVxuICAgIC5zb3J0KGZ1bmN0aW9uKGEsYil7XG4gICAgICAgIGlmKGEub3BlcmF0b3IucHJlY2VkZW5jZSA9PT0gYi5vcGVyYXRvci5wcmVjZWRlbmNlICYmIGEub3BlcmF0b3IuYXNzb2NpYXRpdml0eSA9PT0gJ3JpZ2h0Jyl7XG4gICAgICAgICAgICByZXR1cm4gMTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBiLm9wZXJhdG9yLnByZWNlZGVuY2UgLSBhLm9wZXJhdG9yLnByZWNlZGVuY2U7XG4gICAgfSlcbiAgICAuZm9yRWFjaChmdW5jdGlvbih0b2tlbil7XG4gICAgICAgIHZhciBpbmRleCA9IGFzdC5pbmRleE9mKHRva2VuKSxcbiAgICAgICAgICAgIG9wZXJhdG9yID0gdG9rZW4ub3BlcmF0b3IsXG4gICAgICAgICAgICBsZWZ0LFxuICAgICAgICAgICAgbWlkZGxlLFxuICAgICAgICAgICAgcmlnaHQ7XG5cbiAgICAgICAgLy8gVG9rZW4gd2FzIHBhcnNlZCBieSBzb21lIG90aGVyIHBhcnNlciBzdGVwLlxuICAgICAgICBpZighfmluZGV4KXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKG9wZXJhdG9yLnRyaW5hcnkpe1xuICAgICAgICAgICAgbGVmdCA9IGFzdC5zcGxpY2UoaW5kZXgtMSwxKTtcbiAgICAgICAgICAgIG1pZGRsZSA9IGFzdC5zcGxpY2UoaW5kZXgsMSk7XG4gICAgICAgICAgICB2YXIgdHJpbmFyeSA9IGFzdC5zcGxpY2UoaW5kZXgsMSk7XG4gICAgICAgICAgICByaWdodCA9IGFzdC5zcGxpY2UoaW5kZXgsMSk7XG4gICAgICAgICAgICBpZighdHJpbmFyeS5sZW5ndGggfHwgdHJpbmFyeVswXS5uYW1lICE9PSBvcGVyYXRvci50cmluYXJ5KXtcbiAgICAgICAgICAgICAgICBwYXJzZUVycm9yKCdVbmV4cGVjdGVkIHRva2VuLicsIHRva2VuKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfWVsc2UgaWYob3BlcmF0b3IuZGlyZWN0aW9uID09PSAnbGVmdCcpe1xuICAgICAgICAgICAgbGVmdCA9IGFzdC5zcGxpY2UoaW5kZXgtMSwxKTtcbiAgICAgICAgfWVsc2UgaWYob3BlcmF0b3IuZGlyZWN0aW9uID09PSAncmlnaHQnKXtcbiAgICAgICAgICAgIHJpZ2h0ID0gYXN0LnNwbGljZShpbmRleCArIDEsMSk7XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgICAgbGVmdCA9IGFzdC5zcGxpY2UoaW5kZXgtMSwxKTtcbiAgICAgICAgICAgIHJpZ2h0ID0gYXN0LnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZihcbiAgICAgICAgICAgIGxlZnQgJiYgbGVmdC5sZW5ndGggIT09IDEgfHxcbiAgICAgICAgICAgIG1pZGRsZSAmJiBtaWRkbGUubGVuZ3RoICE9PSAxIHx8XG4gICAgICAgICAgICByaWdodCAmJiByaWdodC5sZW5ndGggIT09IDFcbiAgICAgICAgKXtcbiAgICAgICAgICAgIHBhcnNlRXJyb3IoJ3VuZXhwZWN0ZWQgdG9rZW4uJywgdG9rZW4pO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYobGVmdCl7XG4gICAgICAgICAgICB0b2tlbi5sZWZ0ID0gbGVmdFswXTtcbiAgICAgICAgfVxuICAgICAgICBpZihtaWRkbGUpe1xuICAgICAgICAgICAgdG9rZW4ubWlkZGxlID0gbWlkZGxlWzBdO1xuICAgICAgICB9XG4gICAgICAgIGlmKHJpZ2h0KXtcbiAgICAgICAgICAgIHRva2VuLnJpZ2h0ID0gcmlnaHRbMF07XG4gICAgICAgIH1cbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gcGFyc2VUb2tlbih0b2tlbnMsIGFzdCl7XG4gICAgaWYoIWFzdCl7XG4gICAgICAgIGFzdCA9IFtdO1xuICAgIH1cblxuICAgIGZvcih2YXIgaSA9IDA7IGkgPD0gcGFyc2Vycy5sZW5ndGggJiYgdG9rZW5zLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgaWYoaSA9PT0gcGFyc2Vycy5sZW5ndGggJiYgdG9rZW5zLmxlbmd0aCl7XG4gICAgICAgICAgICBwYXJzZUVycm9yKCd1bmtub3duIHRva2VuJywgdG9rZW5zWzBdKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKHBhcnNlcnNbaV0odG9rZW5zLCBhc3QpKXtcbiAgICAgICAgICAgIHJldHVybiBhc3Q7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlKHRva2VucywgbXV0YXRlKXtcbiAgICB2YXIgYXN0ID0gW107XG5cbiAgICBpZighbXV0YXRlKXtcbiAgICAgICAgdG9rZW5zID0gdG9rZW5zLnNsaWNlKCk7XG4gICAgfVxuXG4gICAgd2hpbGUodG9rZW5zLmxlbmd0aCl7XG4gICAgICAgIHBhcnNlVG9rZW4odG9rZW5zLCBhc3QpO1xuICAgIH1cblxuICAgIHBhcnNlT3BlcmF0b3JzKGFzdCk7XG5cbiAgICByZXR1cm4gYXN0O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHBhcnNlOyIsInZhciB0b1ZhbHVlID0gcmVxdWlyZSgnLi90b1ZhbHVlJyk7XG5cbmZ1bmN0aW9uIHdyYXBTY29wZShfX3Njb3BlX18pe1xuICAgIHZhciBzY29wZSA9IG5ldyBTY29wZSgpO1xuICAgIHNjb3BlLl9fc2NvcGVfXyA9IF9fc2NvcGVfXztcbiAgICByZXR1cm4gc2NvcGU7XG59XG5cbmZ1bmN0aW9uIFNjb3BlKG9sZFNjb3BlLCBkZWJ1Zyl7XG4gICAgdGhpcy5fX3Njb3BlX18gPSB7fTtcbiAgICB0aGlzLl9kZWJ1ZyA9IGRlYnVnO1xuICAgIGlmKG9sZFNjb3BlKXtcbiAgICAgICAgdGhpcy5fX291dGVyU2NvcGVfXyA9IG9sZFNjb3BlIGluc3RhbmNlb2YgU2NvcGUgPyBvbGRTY29wZSA6IHdyYXBTY29wZShvbGRTY29wZSk7XG4gICAgICAgIHRoaXMuX2RlYnVnID0gdGhpcy5fX291dGVyU2NvcGVfXy5fZGVidWc7XG4gICAgfVxufVxuU2NvcGUucHJvdG90eXBlLnRocm93ID0gZnVuY3Rpb24obWVzc2FnZSl7XG4gICAgdGhpcy5fZXJyb3IgPSBuZXcgRXJyb3IoJ1ByZXNoIGV4ZWN1dGlvbiBlcnJvcjogJyArIG1lc3NhZ2UpO1xuICAgIHRoaXMuX2Vycm9yLnNjb3BlID0gdGhpcztcbn07XG5TY29wZS5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oa2V5KXtcbiAgICB2YXIgc2NvcGUgPSB0aGlzO1xuICAgIHdoaWxlKHNjb3BlICYmICFzY29wZS5fX3Njb3BlX18uaGFzT3duUHJvcGVydHkoa2V5KSl7XG4gICAgICAgIHNjb3BlID0gc2NvcGUuX19vdXRlclNjb3BlX187XG4gICAgfVxuICAgIHJldHVybiBzY29wZSAmJiB0b1ZhbHVlLnZhbHVlKHNjb3BlLl9fc2NvcGVfX1trZXldLCB0aGlzKTtcbn07XG5TY29wZS5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24oa2V5LCB2YWx1ZSwgYnViYmxlKXtcbiAgICBpZihidWJibGUpe1xuICAgICAgICB2YXIgY3VycmVudFNjb3BlID0gdGhpcztcbiAgICAgICAgd2hpbGUoY3VycmVudFNjb3BlICYmICEoa2V5IGluIGN1cnJlbnRTY29wZS5fX3Njb3BlX18pKXtcbiAgICAgICAgICAgIGN1cnJlbnRTY29wZSA9IGN1cnJlbnRTY29wZS5fX291dGVyU2NvcGVfXztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGN1cnJlbnRTY29wZSl7XG4gICAgICAgICAgICBjdXJyZW50U2NvcGUuc2V0KGtleSwgdmFsdWUpO1xuICAgICAgICB9XG4gICAgfVxuICAgIHRoaXMuX19zY29wZV9fW2tleV0gPSB0b1ZhbHVlKHZhbHVlLCB0aGlzKTtcbiAgICByZXR1cm4gdGhpcztcbn07XG5TY29wZS5wcm90b3R5cGUuZGVmaW5lID0gZnVuY3Rpb24ob2JqKXtcbiAgICBmb3IodmFyIGtleSBpbiBvYmope1xuICAgICAgICB0aGlzLl9fc2NvcGVfX1trZXldID0gdG9WYWx1ZShvYmpba2V5XSwgdGhpcyk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzO1xufTtcblNjb3BlLnByb3RvdHlwZS5pc0RlZmluZWQgPSBmdW5jdGlvbihrZXkpe1xuICAgIGlmKGtleSBpbiB0aGlzLl9fc2NvcGVfXyl7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5fX291dGVyU2NvcGVfXyAmJiB0aGlzLl9fb3V0ZXJTY29wZV9fLmlzRGVmaW5lZChrZXkpIHx8IGZhbHNlO1xufTtcblNjb3BlLnByb3RvdHlwZS5oYXNFcnJvciA9IGZ1bmN0aW9uKCl7XG4gICAgcmV0dXJuIHRoaXMuX2Vycm9yO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBTY29wZTsiLCJ2YXIgdiA9IHt9O1xuXG5mdW5jdGlvbiBpc1ZhbHVlKHZhbHVlKXtcbiAgICByZXR1cm4gdmFsdWUgJiYgdmFsdWUuX3ZhbHVlID09PSB2O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIHRvVmFsdWUodmFsdWUsIHNjb3BlLCBjb250ZXh0KXtcbiAgICBpZihzY29wZS5fZXJyb3Ipe1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZXJyb3I6IHNjb3BlLl9lcnJvclxuICAgICAgICB9O1xuICAgIH1cblxuICAgIGlmKGlzVmFsdWUodmFsdWUpKXtcbiAgICAgICAgaWYodHlwZW9mIGNvbnRleHQgPT09ICdvYmplY3QnIHx8IHR5cGVvZiBjb250ZXh0ID09PSAnZnVuY3Rpb24nKXtcbiAgICAgICAgICAgIHZhbHVlLmNvbnRleHQgPSBjb250ZXh0O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICB0eXBlOiAndmFsdWUnLFxuICAgICAgICBjb250ZXh0OiBjb250ZXh0LFxuICAgICAgICB2YWx1ZTogdmFsdWUsXG4gICAgICAgIF92YWx1ZTogdlxuICAgIH07XG59O1xuXG5tb2R1bGUuZXhwb3J0cy5pc1ZhbHVlID0gaXNWYWx1ZTtcblxubW9kdWxlLmV4cG9ydHMudmFsdWUgPSBmdW5jdGlvbih2YWx1ZSl7XG4gICAgcmV0dXJuIGlzVmFsdWUodmFsdWUpID8gdmFsdWUudmFsdWUgOiB2YWx1ZTtcbn07Il19
