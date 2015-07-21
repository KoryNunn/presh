var lex = require('../lex'),
    parse = require('../parse'),
    execute = require('../execute'),
    global = require('../global'),
    merge = require('flat-merge');

var fs = require('fs');


var lexed = lex(fs.readFileSync(__dirname + '/test.txt').toString());
var parsed = parse(lexed);

console.log(parsed);

var x = execute(parsed, merge(
    global,
    {
        language: function(){
            return 'STUFF';
        }
    }
)).value;

window.x = x;

console.log(x);
