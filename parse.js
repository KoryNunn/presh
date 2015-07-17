var ansi = require('ansi-styles');

function parseError(message, token){
    var start = token.index > 50 ? token.index - 50 : 0,
        errorIndex = token.index > 50 ? 50 : token.index,
        surroundingSource = token.sourceRef.source.slice(start, token.index + 50),
        errorMessage = 'Parse error, ' + message + '\n' +
        'At ' + token.index + '\n"' +
        (start === 0 ? '' : '...\n') +
        surroundingSource.slice(0, errorIndex) +
        ansi.red.open +
        surroundingSource.slice(errorIndex, errorIndex+1) +
        ansi.red.close +
        surroundingSource.slice(errorIndex + 1) + '' +
        (surroundingSource.length < 100 ? '' : '...') + '"';

    throw errorMessage;
}

function matchStructure(tokens, structure) {
    if(tokens.length < structure.length){
        return;
    }
    for(var i = 0; i < structure.length; i++){
        if(structure[i] !== '*' && tokens[i].type !== structure[i]){
            return;
        }
    }
    return true;
}

function findFirstIndex(tokens, type){
    for (var i = 0; i < tokens.length; i++) {
        if(tokens[i].type === type){
            return i;
        }
    }
    return -1;
}

function findLastIndex(tokens, type){
    for (var i = tokens.length-1; i >= 0; i--) {
        if(tokens[i].type === type){
            return i;
        }
    }
    return -1;
}

function lastTokenMatches(ast, types, pop){
    var lastToken = ast[ast.length - 1];
    if(!lastToken){
        return;
    }
    for (var i = types.length-1; i >= 0; i--) {
        if(types[i].type === lastToken.type){
            if(pop){
                ast.pop();
            }
            return lastToken;
        }
    }
}

function cleanDelimiters(tokens){
    tokens = tokens.slice();
    for (var i = 0; i < tokens.length; i++) {
        if(tokens[i].type === 'delimiter'){
            tokens.splice(i,1);
            i--;
        }
    };

    return tokens;
}

function parseIdentifier(tokens, ast){
    if(tokens[0].type === 'word'){
        ast.push({
            type: 'identifier',
            name: tokens.shift().source
        });
        return true;
    }
}

function parseNumber(tokens, ast){
    if(tokens[0].type === 'number'){
        ast.push({
            type: 'number',
            value: parseFloat(tokens.shift().source)
        });
        return true;
    }
}

function parseParenthesis(tokens, ast) {
    if(tokens[0].type !== 'parenthesisOpen'){
        return;
    }

    var position = 0,
        opens = 1;

    while(++position, position <= tokens.length && opens){
        if(!tokens[position]){
            parseError('invalid nesting. No closing token was found', tokens[position-1]);
        }
        if(tokens[position].type === 'parenthesisOpen') {
            opens++;
        }
        if(tokens[position].type === 'parenthesisClose') {
            opens--;
        }
    }

    var content = parse(tokens.splice(0, position).slice(1,-1));

    var parenthesisGroup = {
        type: 'parenthesisGroup',
        content: content
    };

    ast.push(parenthesisGroup);

    return true;
}

function parseBlock(tokens, ast){
    if(tokens[0].type !== 'braceOpen'){
        return;
    }

    var position = 0,
        opens = 1;

    while(++position, position <= tokens.length && opens){
        if(!tokens[position]){
            parseError('invalid nesting. No closing token was found', tokens[position-1]);
        }
        if(tokens[position].type === 'braceOpen'){
            opens++;
        }
        if(tokens[position].type === 'braceClose'){
            opens--;
        }
    }

    var content = parse(tokens.splice(0, position).slice(1,-1));

    ast.push({
        type: 'braceGroup',
        content: content
    });

    return true;
}

function parseSet(tokens, ast) {
    if(tokens[0].type !== 'squareBraceOpen'){
        return;
    }

    var position = 0,
        opens = 1;

    while(++position, position <= tokens.length && opens){
        if(!tokens[position]){
            parseError('invalid nesting. No closing token was found', tokens[position-1]);
        }
        if(tokens[position].type === 'squareBraceOpen') {
            opens++;
        }
        if(tokens[position].type === 'squareBraceClose') {
            opens--;
        }
    }

    var content = parse(tokens.splice(0, position).slice(1,-1));

    if(ast.length){
        ast.push({
            type: 'accessor',
            target: ast.pop(),
            content: content
        });

        return true;
    }

    ast.push({
        type: 'set',
        content: content
    });

    return true;
}


function parseDelimiters(tokens){
    if(tokens[0].type === 'delimiter'){
        tokens.splice(0,1);
        return true;
    }
}

function parseComments(tokens, ast){
    if(tokens[0].type !== 'comment'){
        return;
    }

    var comment = {
        type: 'comment',
        value: tokens[0].source.slice(2,-2)
    };

    tokens.splice(0,1);

    ast.push(comment);

    return true;
}

function parseOpperator(tokens, ast){
    if(tokens[0].type === 'opperator'){
        var token = tokens.shift(),
            right = parse(tokens, true);

        if(right.length !== 1){
            parseError('unexpected token.', right[0]);
        }

        ast.push({
            type: token.name,
            left: ast.pop(),
            right: right[0]
        });
        return true;
    }
}

function parsePeriod(tokens, ast){
    if(tokens[0].name === 'period'){
        tokens.shift();

        var token = {
                type: 'period'
            };

        if(tokens[0] && tokens[0].type === 'period'){
            tokens.shift();
            token.type = 'range';
        }

        var right = parseToken(tokens);

        if(token.type === 'range'){
            token.type = 'range';
            token.start = ast.pop();
            token.end = right.pop();
        }else{
            token.target = ast.pop();
            token.identifier = right.pop();
        }

        ast.push(token);
        return true;
    }
}

function parseString(tokens, ast){
    if(tokens[0].type === 'string'){
        ast.push({
            type: 'string',
            value: tokens.shift().source.slice(1,-1)
        });
        return true;
    }
}

function parseSemicolon(tokens){
    if(tokens[0].type === 'semicolon'){
        tokens.shift();
        return true;
    }
}

function parseFunctionCall(ast){
    var firstIndex = findFirstIndex(ast, 'parenthesisGroup');

    if(firstIndex<0){
        return;
    }

    var astIndex = firstIndex-1;

    if(matchStructure(ast.slice(astIndex), ['*', 'parenthesisGroup'])){
        ast.splice(astIndex, 0, {
            type: 'functionCall',
            target: ast.splice(astIndex, 1).pop(),
            arguments: ast.splice(astIndex, 1).pop().content
        });
        return true;
    }
}

function parseFunctionExpression(ast){
    var firstIndex = findFirstIndex(ast, 'parenthesisGroup');

    if(firstIndex<0){
        return;
    }

    if(matchStructure(ast.slice(firstIndex-1), ['identifier', 'parenthesisGroup', 'braceGroup'])){
        var identifier = ast.splice(firstIndex-1, 1).pop(),
            parameters = ast.splice(firstIndex-1, 1).pop(),
            braceGroup = ast.splice(firstIndex-1, 1).pop();

        ast.splice(firstIndex-1, 0, {
            type: 'functionExpression',
            identifier: identifier.name,
            parameters: parameters.content,
            content: braceGroup.content
        });
        return true;
    }

    if(matchStructure(ast.slice(firstIndex), ['parenthesisGroup', 'braceGroup'])){
        var parameters = ast.splice(firstIndex, 1).pop(),
            braceGroup = ast.splice(firstIndex, 1).pop();

        ast.splice(firstIndex, 0, {
            type: 'functionExpression',
            parameters: parameters.content,
            content: braceGroup.content
        });
        return true;
    }
}

var parsers = [
    parseDelimiters,
    parseComments,
    parseNumber,
    parseString,
    parseIdentifier,
    parseParenthesis,
    parseSet,
    parseBlock,
    parsePeriod,
    parseOpperator,
    parseSemicolon
];

var astParsers = [
    parseFunctionExpression,
    parseFunctionCall
];

function parseToken(tokens, ast){
    if(!ast){
        ast = [];
    };

    for(var i = 0; i <= parsers.length && tokens.length; i++){
        if(i === parsers.length && tokens.length){
            parseError('unknown token', tokens[0]);
            return;
        }

        if(parsers[i](tokens, ast)){
            return ast;
        }
    }
}

function parse(tokens, mutate){
    var ast = [];

    if(!mutate){
        tokens = tokens.slice();
    }

    while(tokens.length){
        parseToken(tokens, ast);
    }

    for(var j = 0; j < astParsers.length; j++){
        if(astParsers[j](ast)){
            j = -1;
        }
    }

    return ast;
}

module.exports = parse;