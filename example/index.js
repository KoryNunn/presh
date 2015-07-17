var lex = require('../lex'),
    parse = require('../parse'),
    execute = require('../execute'),
    global = require('../global');

var fs = require('fs');


var lexed = lex(fs.readFileSync(__dirname + '/test.txt').toString());
var parsed = parse(lexed);

console.log(parsed);

console.log(execute(parsed, global).value);