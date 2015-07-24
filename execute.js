var Scope = require('./scope'),
    toValue = require('./toValue'),
    operators = require('./operators'),
    toArray = function(list){return Array.prototype.slice.call(list);};

var reservedKeywords = {
    'true': true,
    'false': false,
    'null': null,
    'undefined': undefined
};

function lessThan(lessThan, scope){
    return executeToken(lessThan.left, scope).value < executeToken(lessThan.right, scope).value;
}

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

function functionCall(functionCall, scope){
    var fn = executeToken(functionCall.target, scope).value,
        result;

    if(typeof fn !== 'function'){
        scope.throw(fn + ' is not a function');
    }

    return fn.apply(null, resolveSpreads(functionCall.content, scope));
}

function functionExpression(functionExpression, scope){
    var fn = function(){
        var args = arguments,
            functionScope = new Scope(scope);

        functionExpression.parameters.forEach(function(parameter, index){

            if(parameter.name === 'spread'){
                functionScope.set(parameter.right.name, Array.prototype.slice.call(args, index));
                return;
            }

            functionScope.set(parameter.name, args[index]);
        });

        return execute(functionExpression.content, functionScope).value;
    };

    if(functionExpression.identifier){
        scope.set(functionExpression.identifier.name, fn);
    }

    return fn;
}

function ternary(ternary, scope){

    if(scope._debug){
        console.log('Executing operator: ' + operator.name, operator.left, operator.right);
    }

    return executeToken(ternary.left, scope).value ? executeToken(ternary.middle, scope).value : executeToken(ternary.right, scope).value;
}

function identifier(identifier, scope){
    var name = identifier.name;
    if(name in reservedKeywords){
        return reservedKeywords[name];
    }
    if(!scope.isDefined(name)){
        scope.throw(name + ' is not defined');
    }
    return scope.get(name);
}

function number(number, scope){
    return number.value;
}

function string(string, scope){
    return string.value;
}

function period(period, scope){
    var target = executeToken(period.left, scope).value;

    if(!target || !(typeof target === 'object' || typeof target === 'function')){
        scope.throw('target is not an object');
        return;
    }

    return target[period.right.name];
}

function spread(spread, scope){
    var target = executeToken(spread.right, scope).value;

    if(!Array.isArray(target)){
        scope.throw('target did not resolve to an array');
    }

    return target;
}

function accessor(accessor, scope){
    var accessorValue = execute(accessor.content, scope).value,
        target = executeToken(accessor.target, scope).value;

    if(!target || !(typeof target === 'object' || typeof target === 'function')){
        scope.throw('target is not an object');
    }

    return target[accessorValue];
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
        return result;
    }

    return resolveSpreads(set.content, scope);
}

function value(value, scope){
    return value.value;
}

function operator(operator, scope){
    if(operator.name in handlers){
        return toValue(handlers[operator.name](operator, scope), scope);
    }

    if(operator.left){
        if(scope._debug){
            console.log('Executing operator: ' + operator.name, operator.left, operator.right);
        }
        return operator.operator.fn(executeToken(operator.left, scope).value, executeToken(operator.right, scope).value);
    }

    if(scope._debug){
        console.log('Executing operator: ' + operator.name. operator.right);
    }
    return operator.operator.fn(executeToken(operator.right, scope).value);
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
    spread: spread,
    accessor: accessor,
    value: value,
    operator: operator,
    parenthesisGroup: contentHolder,
    statement: contentHolder
};

function executeToken(token, scope){
    if(scope._error){
        return {error: scope._error}
    }
    return toValue(handlers[token.type](token, scope), scope);
}

function execute(tokens, scope, debug){
    var scope = scope instanceof Scope ? scope : new Scope(scope, debug);

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