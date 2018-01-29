var righto = require('righto');
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
        value: righto.from(value),
        _value: v
    };
};

module.exports.isValue = isValue;

module.exports.value = function(value){
    return isValue(value) ? value.value : value;
};