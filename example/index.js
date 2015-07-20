var lex = require('../lex'),
    parse = require('../parse'),
    execute = require('../execute'),
    global = require('../global'),
    merge = require('flat-merge');

var fs = require('fs');


var lexed = lex(fs.readFileSync(__dirname + '/test.txt').toString());
var parsed = parse(lexed);

console.log(parsed);

console.log(execute(parsed, merge(
    global,
    {
        language: function(){
            return 'STUFF';
        }
    }
)).value);

var loops = 100000;

console.time('loops');
while(loops--){
    execute(parsed, merge(
        global,
        {
            language: function(){
                return 'STUFF';
            }
        }
    ))
}
console.timeEnd('loops');
