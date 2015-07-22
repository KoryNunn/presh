var presh = require('../');
var fs = require('fs');

var expression = fs.readFileSync(__dirname + '/test.txt').toString();

window.x = presh(expression, {
    bar: {
        baz: 'baz'
    }
});

console.log(x);
