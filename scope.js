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