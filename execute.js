var Scope = require('./scope'),
    toValue = require('./toValue'),
    toArray = function(list){return Array.prototype.slice.call(list);};

var reservedKeywords = {
    'true': true,
    'false': false,
    'null': null
};

function lessThan(lessThan, scope){
    return executeToken(lessThan.left, scope).value < executeToken(lessThan.right, scope).value;
}

function functionCall(functionCall, scope){
    var fn = executeToken(functionCall.target, scope).value,
        result;

    if(!fn){
        throw 'bang';
    }

    return fn.apply(null, functionCall.arguments.map(function(argument, index){
        return executeToken(argument, scope).value;
    }));
}

function functionExpression(functionExpression, scope){
    var fn = function(){
        var functionScope = new Scope(scope);

        toArray(arguments).forEach(function(argument, index){
            if(functionExpression.parameters.length <= index){
                return;
            }
            functionScope.set(functionExpression.parameters[index].name, argument);
        });

        return execute(functionExpression.content, functionScope).value;
    };

    if(functionExpression.identifier){
        scope.set(functionExpression.identifier, fn);
    }

    return fn;
}

function turnary(turnary, scope){
    return executeToken(turnary.condition, scope).value ? executeToken(turnary.left, scope).value : executeToken(turnary.right, scope).value;
}

function identifier(identifier, scope){
    var name = identifier.name;
    if(name in reservedKeywords){
        return reservedKeywords[name];
    }
    return scope.get(identifier.name);
}

function number(number, scope){
    return number.value;
}

function string(string, scope){
    return string.value;
}

function period(period, scope){
    var target = executeToken(period.target, scope).value;

    if(!target || !(typeof target === 'object' || typeof target === 'function')){
        throw 'target is not an object';
    }

    return target[period.identifier.name];
}

function set(set, scope){
    if(set.content.length === 1 && set.content[0].type === 'range'){
        var range = set.content[0],
            start = executeToken(range.start, scope).value,
            end = executeToken(range.end, scope).value,
            reverse = end < start,
            length = Math.abs(end - start),
            result = [];

        for (var i = start; reverse ? i >= end : i <= end; reverse ? i-- : i++) {
            result.push(i);
        };
    }

    return result;
}

function value(value, scope){
    return value.value;
}

var handlers = {
    turnary: turnary,
    functionCall: functionCall,
    functionExpression: functionExpression,
    number: number,
    string: string,
    identifier: identifier,
    set: set,
    period: period,
    value: value,
    lessThan: lessThan
};

function executeToken(token, scope){
    return toValue(handlers[token.type](token, scope));
}

function execute(tokens, scope){
    var scope = scope instanceof Scope ? scope : new Scope(scope);

    return tokens.map(function(token){
        return executeToken(token, scope);
    }).pop();
}

module.exports = execute;