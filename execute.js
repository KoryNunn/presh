var Scope = require('./scope'),
    toValue = require('./toValue'),
    operators = require('./operators'),
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

    if(typeof fn !== 'function'){
        throw fn + ' is not a function';
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
        scope.set(functionExpression.identifier.name, fn);
    }

    return fn;
}

function ternary(ternary, scope){
    return executeToken(ternary.left, scope).value ? executeToken(ternary.right.left, scope).value : executeToken(ternary.right.right, scope).value;
}

function identifier(identifier, scope){
    var name = identifier.name;
    if(name in reservedKeywords){
        return reservedKeywords[name];
    }
    if(!scope.isDefined(identifier.name)){
        throw identifier.name + ' is not defined';
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
    if(set.content.length === 1 && set.content[0].name === 'range'){
        var range = set.content[0],
            start = executeToken(range.left, scope).value,
            end = executeToken(range.right, scope).value,
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

function operator(operator, scope){
    if(operator.name in handlers){
        return toValue(handlers[operator.name](operator, scope));
    }

    if(operator.left){
        return operators[operator.operator].fn(executeToken(operator.left, scope).value, executeToken(operator.right, scope).value);
    }

    return operators[operator.operator].fn(executeToken(operator.right, scope).value);
}

function contentHolder(parenthesisGroup, scope){
    return execute(parenthesisGroup.content, scope).value;
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
    value: value,
    operator: operator,
    parenthesisGroup: contentHolder,
    statement: contentHolder
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