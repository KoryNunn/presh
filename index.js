var lex = require('./lex'),
    parse = require('./parse'),
    execute = require('./execute'),
    global = require('./global'),
    merge = require('flat-merge');

module.exports = function(expression, scope, callback, debug){
    var lexed = lex(expression);
    var parsed = parse(lexed);

    return execute(parsed, merge(
        global,
        scope
    ), callback, debug);
};