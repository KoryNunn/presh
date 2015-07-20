module.exports = {
    '+': function(a, b){
        return a + b;
    },
    '-': function(a, b){
        return a - b;
    },
    '*': function(a, b){
        return a * b;
    },
    '/': function(a, b){
        return a / b;
    },
    '%': function(a, b){
        return a % b;
    },
    '==': function(a, b){
        return a == b;
    },
    '!=': function(a, b){
        return a != b;
    },
    '>': function(a, b){
        return a > b;
    },
    '<': function(a, b){
        return a < b;
    },
    '&&': function(a, b){
        return a && b;
    },
    '||': function(a, b){
        return a || b;
    },
    '!': function(a){
        return !a;
    },
    '&': function(a, b){
        return a & b;
    },
    '^': function(a, b){
        return a ^ b;
    },
    '|': function(a, b){
        return a | b;
    },
    '~': function(a, b){
        return ~a;
    },
    '<<': function(a, b){
        return a << b;
    },
    '>>': function(a, b){
        return a >> b;
    },
    '>>>': function(a, b){
        return a >>> b;
    }
};