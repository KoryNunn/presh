var ansi = require('ansi-styles'),
    operators = require('./operators');

function parseError(message, token){
    var start = token.index > 50 ? token.index - 50 : 0,
        errorIndex = token.index > 50 ? 50 : token.index,
        surroundingSource = token.sourceRef.source.slice(start, token.index + 50),
        errorMessage = 'Parse error, ' + message + '\n' +
        'At ' + token.index + '\n"' +
        (start === 0 ? '' : '...\n') +
        surroundingSource.slice(0, errorIndex) +
        (global.window ? '-->' : ansi.red.open) +
        surroundingSource.slice(errorIndex, errorIndex+1) +
        (global.window ? '<--' : ansi.red.close) +
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
    var lastToken = ast[ast.length - 1],
        lastTokenType,
        matched;

    if(!lastToken){
        return;
    }

    lastTokenType = lastToken.type;

    for (var i = types.length-1, type = types[i]; i >= 0; i--, type = types[i]) {
        if(type === '!' + lastTokenType){
            return;
        }

        if(type === '*' || type === lastTokenType){
            matched = true;
        }
    }

    if(!matched){
        return;
    }

    if(pop){
        ast.pop();
    }
    return lastToken;
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

function functionCall(target, content){
    return {
        type: 'functionCall',
        target: target,
        content: content
    };
}

function parseParenthesis(tokens, ast) {
    if(tokens[0].type !== 'parenthesisOpen'){
        return;
    }

    var openToken = tokens[0],
        position = 0,
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

    var target = !openToken.delimiterPrefix && lastTokenMatches(ast, ['*', '!statement'], true),
        content = parse(tokens.splice(0, position).slice(1,-1)),
        astNode;

    if(target){
        astNode = functionCall(target, content);
    }else{
        astNode = {
            type: 'parenthesisGroup',
            content: content
        };
    }

    ast.push(astNode);

    return true;
}

function parseParameters(functionCall){
    return functionCall.content.map(function(token){
        if(token.type === 'identifier' || (token.name === 'spread' && token.right.type === 'identifier')){
            return token;
        }

        parseError('Unexpected token in parameter list', functionCall);
    });
}

function namedFunctionExpression(functionCall, content){
    if(functionCall.target.type !== 'identifier'){
        return false;
    }

    return {
        type: 'functionExpression',
        identifier: functionCall.target,
        parameters: parseParameters(functionCall),
        content: content
    };
}

function anonymousFunctionExpression(parenthesisGroup, content){
    return {
        type: 'functionExpression',
        parameters: parseParameters(parenthesisGroup),
        content: content
    };
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

    var targetToken = tokens[0],
        content = parse(tokens.splice(0, position).slice(1,-1));

    var functionCall = lastTokenMatches(ast, ['functionCall'], true),
        parenthesisGroup = lastTokenMatches(ast, ['parenthesisGroup'], true),
        astNode;

    if(functionCall){
        astNode = namedFunctionExpression(functionCall, content);
    }else if(parenthesisGroup){
        astNode = anonymousFunctionExpression(parenthesisGroup, content);
    }else{
        astNode = {
            type: 'braceGroup',
            content: content
        };
    }

    if(!astNode){
        parseError('unexpected token.', targetToken);
    }

    ast.push(astNode);

    return true;
}

function parseSet(tokens, ast) {
    if(tokens[0].type !== 'squareBraceOpen'){
        return;
    }

    var openToken = tokens[0],
        position = 0,
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

    var target = !openToken.delimiterPrefix && lastTokenMatches(ast, ['*', '!statement', '!operator'], true),
        content = parse(tokens.splice(0, position).slice(1,-1));

    if(target){
        ast.push({
            type: 'accessor',
            target: target,
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
        if(tokens[0]){
            tokens[0].delimiterPrefix = true;
        }
        return true;
    }
}

function parseComments(tokens, ast){
    if(tokens[0].type === 'comment'){
        tokens.shift();
        return true;
    }
}

function parseOperator(tokens, ast){
    if(tokens[0].type === 'operator'){
        var token = tokens.shift();
        ast.push({
            type: token.type,
            operator: token.source,
            name: token.name
        });
        return true;
    }
}

function findAll(array, fn){
    var results = [];

    for (var i = 0; i < array.length; i++) {
        var result = fn(array[i], i);
        if(result){
            results.push(result);
        }
    }

    return results;
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

function parseSemicolon(tokens, ast){
    if(tokens[0].type === 'semicolon'){
        tokens.shift();
        ast.push({
            type: 'statement',
            content: [ast.pop()]
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
    parseOperator,
    parseSemicolon
];

function parseOperators(ast){
    var operatorTokens = ast.filter(function(token, index){
        return token.type === 'operator';
    })
    .sort(function(a,b){
        return operators[b.operator].precedence - operators[a.operator].precedence
    })
    .map(function(token){
        var index = ast.indexOf(token),
            operator = operators[token.operator],
            left,
            right;

        if(operator.unary === 'left'){
            left = ast.splice(index-1,1);
        }else if(operator.unary === 'right'){
            right = ast.splice(index + 1,1);
        }else{
            left = ast.splice(index-1,1);
            right = ast.splice(index, 1);
        }

        if(left && left.length !== 1 || right && right.length !== 1){
            parseError('unexpected token.', token);
        }

        if(left){
            token.left = left[0];
        }
        if(right){
            token.right = right[0];
        }
    });
}

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

    parseOperators(ast);

    return ast;
}

module.exports = parse;