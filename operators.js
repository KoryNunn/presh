module.exports = {
    '...': {
        name: 'spread',
        unary: 'right',
        precedence: 19
    },
    '..': {
        name: 'range',
        precedence: 19
    },
    '.': {
        name: 'period',
        precedence: 18
    },
    '+': {
        fn: function(a, b){
            return a + b;
        },
        name: 'add',
        precedence: 13
    },
    '-': {
        fn: function(a, b){
            return a - b;
        },
        name: 'subtract',
        precedence: 13
    },
    '*': {
        fn: function(a, b){
            return a * b;
        },
        name: 'multiply',
        precedence: 14
    },
    '/': {
        fn: function(a, b){
            return a / b;
        },
        name: 'divide',
        precedence: 14
    },
    '%': {
        fn: function(a, b){
            return a % b;
        },
        name: 'remainder',
        precedence: 14
    },
    'in': {
        fn: function(a, b){
            return a in b;
        },
        name: 'in',
        precedence: 11
    },
    '==': {
        fn: function(a, b){
            return a == b;
        },
        name: 'equal',
        precedence: 10
    },
    '!=': {
        fn: function(a, b){
            return a != b;
        },
        name: 'notEqual',
        precedence: 10
    },
    '===': {
        fn: function(a, b){
            return a === b;
        },
        name: 'exactlyEqual',
        precedence: 10
    },
    '!==': {
        fn: function(a, b){
            return a !== b;
        },
        name: 'netExactlyEqual',
        precedence: 10
    },
    '>': {
        fn: function(a, b){
            return a > b;
        },
        name: 'greaterThan',
        precedence: 11
    },
    '<': {
        fn: function(a, b){
            return a < b;
        },
        name: 'lessThan',
        precedence: 11
    },
    '>=': {
        fn: function(a, b){
            return a >= b;
        },
        name: 'greaterThanOrEqual',
        precedence: 11
    },
    '<=': {
        fn: function(a, b){
            return a <= b;
        },
        name: 'lessThanOrEqual',
        precedence: 11
    },
    '&&': {
        fn: function(a, b){
            return a && b;
        },
        name: 'and',
        precedence: 6
    },
    '||': {
        fn: function(a, b){
            return a || b;
        },
        name: 'or',
        precedence: 5
    },
    '!': {
        fn: function(a){
            return !a;
        },
        name: 'not',
        unary: 'right',
        precedence: 15
    },
    '&': {
        fn: function(a, b){
            return a & b;
        },
        name: 'bitwiseAnd',
        precedence: 9
    },
    '^': {
        fn: function(a, b){
            return a ^ b;
        },
        name: 'bitwiseXOr',
        precedence: 8
    },
    '|': {
        fn: function(a, b){
            return a | b;
        },
        name: 'bitwiseOr',
        precedence: 7
    },
    '~': {
        fn: function(a){
            return ~a;
        },
        name: 'bitwiseNot',
        unary: 'right',
        precedence: 15
    },
    'typeof': {
        fn: function(a){
            return typeof a;
        },
        name: 'typeof',
        unary: 'right',
        precedence: 15
    },
    '<<': {
        fn: function(a, b){
            return a << b;
        },
        name: 'bitwiseLeftShift',
        precedence: 12
    },
    '>>': {
        fn: function(a, b){
            return a >> b;
        },
        name: 'bitwiseRightShift',
        precedence: 12
    },
    '>>>': {
        fn: function(a, b){
            return a >>> b;
        },
        name: 'bitwiseUnsignedRightShift',
        precedence: 12
    },
    ':': {
        name: 'tuple',
        precedence: 4
    },
    '?': {
        name: 'ternary',
        precedence: 3
    }
};