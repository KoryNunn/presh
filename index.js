var lex = require('./lex'),
    parse = require('./parse'),
    execute = require('./execute'),
    global = require('./global'),
    merge = require('flat-merge');

module.exports = function(expression, scope){
    var lexed = lex(expression);
    var parsed = parse(lexed);

    var result = execute(parsed, merge(
        global,
        scope
    ));

    return result.value;
};