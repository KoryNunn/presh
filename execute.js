var Scope = require('./scope'),
    toValue = require('./toValue'),
    isInstance = require('is-instance'),
    righto = require('righto');

var reservedKeywords = {
    'true': true,
    'false': false,
    'null': null,
    'undefined': undefined
};

function resolveSpreads(content, scope){
    var resolved = righto.all(content.map(function(token){
        return righto.from(executeToken(token, scope).value).get(result => [token, result]);
    }));

    return resolved.get(results => results.reduce(function(result, item){
        if(item[0].name === 'spread'){
            return result.concat(item[1]);
        }

        result.push(item[1]);

        return result;
    }, []));
}

function functionCall(token, scope){
    var functionToken = executeToken(token.target, scope),
        fn = functionToken.value;

    return righto.from(fn).get(function(fn){
        if(typeof fn !== 'function'){
            scope.throw(fn + ' is not a function');
        }

        if(scope.hasError()){
            return;
        }

        if(fn.__preshFunction__){
            return righto.sync(fn.apply.bind(fn), functionToken.context, resolveSpreads(token.content, scope));
        }

        return righto.sync(function(){
            try{
                return fn.apply.apply(fn, arguments);
            }catch(error){
                scope.throw(error);
            }
        }, functionToken.context, resolveSpreads(token.content, scope)).get(result => {
            if(typeof result === 'object'){
                return righto.resolve(result);
            }

            return result;
        });
    });
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

        return execute(token.content, functionScope).value.get(result => {
            if(typeof result === 'object'){
                return righto.resolve(result);
            }

            return result;
        });
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

    return righto.from(executeToken(token.left, scope).value).get(function(result){
        return result ?
            executeToken(token.middle, scope).value :
            executeToken(token.right, scope).value;
    });
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

    return result;
}

function period(token, scope){
    var target = executeToken(token.left, scope).value;

    return toValue(righto.sync(getProperty, token, scope, target, token.right.name), scope, target);
}

function accessor(token, scope){
    var accessorValue = execute(token.content, scope).value,
        target = executeToken(token.target, scope).value;

    return toValue(righto.sync(getProperty, token, scope, target, accessorValue), scope, target);
}

function spread(token, scope){
    return righto.from(executeToken(token.right, scope).value).get(function(target){
        if(!Array.isArray(target)){
            scope.throw('target did not resolve to an array');
        }

        return target;
    });
}

function set(token, scope){
    if(token.content.length === 1 && token.content[0].name === 'range'){
        var range = token.content[0];

        return righto(function(start, end, callback){
            var reverse = end < start,
                result = [];

            if (scope.incrementCycles(end - start)) {
                return callback(scope.hasError());
            }

            for (var i = start; reverse ? i >= end : i <= end; reverse ? i-- : i++) {
                result.push(i);
            }

            callback(null, result);
        }, executeToken(range.left, scope).value, executeToken(range.right, scope).value);
    }

    return resolveSpreads(token.content, scope);
}

function value(token){
    return token.value;
}

function object(token, scope){
    var result = {};

    function addResultPair(a, b){
        result[a] = b;
    }

    var content = token.content;

    // Eventuals required as keys or values are immediatly executed, but adding of values to the object is done in order.

    return righto.reduce(content.map(function(child){
        if(child.name === 'tuple'){
            if(child.left.type === 'identifier'){
                key = child.left.name;
            }else if(child.left.type === 'set' && child.left.content.length === 1){
                key = executeToken(child.left.content[0], scope).value();
            }else{
                scope.throw('Unexpected token in object constructor: ' + child.type);
                return;
            }

            return righto.sync(addResultPair, key, executeToken(child.right, scope).value());
        }else if(child.type === 'identifier'){
            return righto.sync(addResultPair, child.name, executeToken(child, scope).value());
        }else if(child.name === 'spread'){
            return executeToken(child.right, scope).value().get(function(source){
                if(!isInstance(source)){
                    scope.throw('Target did not resolve to an instance of an object');
                    return;
                }

                Object.assign(result, source);
            });
        }else if(child.name === 'delete'){
            return righto.sync(function(){
                var targetIdentifier = child.right;

                if(targetIdentifier.type !== 'identifier'){
                    scope.throw('Target of delete was not an identifier');
                    return;
                }

                delete result[targetIdentifier.name];
            });
        }else{
            scope.throw('Unexpected token in object constructor: ' + child.type);
            return;
        }

    })).get(() => result);
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

    scope.incrementCycles(1);

    return toValue(handlers[token.type](token, scope), scope);
}

function execute(tokens, scope, debug){
    scope = scope instanceof Scope ? scope : new Scope(scope, debug);

    if(!tokens.length){
        return toValue(undefined, scope);
    }

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