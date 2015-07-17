var v = {};
module.exports = function toValue(value){
    if(value && value._value === v){
        return value;
    }

    return {
        type: 'value',
        value: value,
        _value: v
    };
};

module.exports.isValue = function(value){
    return value && value._value === v;
};

module.exports.value = function(value){
    return module.exports.isValue(value) ? value.value : value;
};