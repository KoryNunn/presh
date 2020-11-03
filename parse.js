var operators = require('./operators'),
    stableSort = require('stable'),
    printError = require('./printError');

function parseError(message, token){
    throw printError(message, token);
}

function findNextNonDelimiter(tokens){
    var result;

    while(result = tokens.shift()){
        if(!result || result.type !== 'delimiter'){
            return result;
        }
    }
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

function parseIdentifier(tokens, ast){
    if(tokens[0].type === 'word'){
        ast.push({
            sourceToken: tokens[0],
            type: 'identifier',
            name: tokens.shift().source
        });
        return true;
    }
}

function parseNumber(tokens, ast){
    if(tokens[0].type === 'number'){
        ast.push({
            sourceToken: tokens[0],
            type: 'number',
            value: parseFloat(tokens.shift().source)
        });
        return true;
    }
}

function functionCall(target, content){
    return {
        sourceToken: target,
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

    var target = !openToken.delimiterPrefix && lastTokenMatches(ast, ['*', '!statement', '!operator', '!set'], true),
        content = parse(tokens.splice(0, position).slice(1,-1)),
        astNode;

    if(target){
        astNode = functionCall(target, content);
    }else{
        astNode = {
            sourceToken: openToken,
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

function namedFunctionExpression(sourceToken, functionCall, content){
    if(functionCall.target.type !== 'identifier'){
        return false;
    }

    return {
        sourceToken,
        type: 'functionExpression',
        identifier: functionCall.target,
        parameters: parseParameters(functionCall),
        content: content
    };
}

function anonymousFunctionExpression(sourceToken, parenthesisGroup, content){
    return {
        sourceToken,
        type: 'functionExpression',
        parameters: parseParameters(parenthesisGroup),
        content: content
    };
}

function parseBlock(tokens, ast){
    if(tokens[0].type !== 'braceOpen'){
        return;
    }

    var wasDelimiterPrefixed = tokens[0].delimiterPrefix,
        position = 0,
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

    var functionCall = !wasDelimiterPrefixed && lastTokenMatches(ast, ['functionCall'], true),
        parenthesisGroup = !wasDelimiterPrefixed && lastTokenMatches(ast, ['parenthesisGroup'], true),
        astNode;

    if(functionCall){
        astNode = namedFunctionExpression(targetToken, functionCall, content);
    }else if(parenthesisGroup){
        astNode = anonymousFunctionExpression(targetToken, parenthesisGroup, content);
    }else{
        astNode = {
            sourceToken: targetToken,
            type: 'braceGroup',
            content: content
        }
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

    var content = parse(tokens.splice(0, position).slice(1,-1)),
        target = !openToken.delimiterPrefix && lastTokenMatches(ast, ['*', '!functionExpression', '!braceGroup', '!statement', '!operator'], true);

    if(target){
        ast.push({
            sourceToken: openToken,
            type: 'accessor',
            target: target,
            content: content
        });

        return true;
    }

    ast.push({
        sourceToken: openToken,
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

function parseComments(tokens){
    if(tokens[0].type === 'comment'){
        tokens.shift();
        return true;
    }
}

function parseOperator(tokens, ast){
    if(tokens[0].type === 'operator'){
        var token = tokens.shift(),
            operatorsForSource = operators[token.source],
            startOfStatement = !lastTokenMatches(ast, ['*', '!statement', '!operator']);

        if(operatorsForSource.binary && !startOfStatement &&
            !(
                operatorsForSource.unary &&
                (
                    token.delimiterPrefix &&
                    tokens[0].type !== 'delimiter'
                )
            )
        ){
            ast.push({
                sourceToken: token,
                type: 'operator',
                name: operatorsForSource.binary.name,
                operator: operatorsForSource.binary,
                sourceRef: token.sourceRef,
                index: token.index
            });
            return true;
        }

        if(operatorsForSource.unary){
            ast.push({
                sourceToken: token,
                type: 'operator',
                name: operatorsForSource.unary.name,
                operator: operatorsForSource.unary,
                sourceRef: token.sourceRef,
                index: token.index
            });
            return true;
        }


        if(operatorsForSource.trinary && !startOfStatement){
            ast.push({
                sourceToken: token,
                type: 'operator',
                name: operatorsForSource.trinary.name,
                operator: operatorsForSource.trinary,
                sourceRef: token.sourceRef,
                index: token.index
            });
            return true;
        }

        parseError('Unexpected token', token);
    }
}

function parsePeriod(tokens, ast){
    if(tokens[0].type === 'period'){
        var token = tokens.shift(),
            right = findNextNonDelimiter(tokens);

        if(!right){
            return parseError('Unexpected token', token);
        }

        ast.push({
            sourceToken: token,
            type: 'period',
            left: ast.pop(),
            right: parseToken([right]).pop()
        });

        return true;
    }
}

function parseString(tokens, ast){
    if(tokens[0].type === 'string'){
        ast.push({
            sourceToken: tokens[0],
            type: 'string',
            value: JSON.parse('"' + tokens.shift().source.slice(1,-1) + '"')
        });
        return true;
    }
}

function parseSemicolon(tokens, ast){
    if(tokens[0].type === 'semicolon'){
        ast.push({
            sourceToken: tokens.shift(),
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
    parsePeriod,
    parseParenthesis,
    parseSet,
    parseBlock,
    parseOperator,
    parseSemicolon
];

function parseOperators(ast){
    stableSort(ast.filter(function(token){
        return token.type === 'operator';
    }), function(a,b){
        if(a.operator.precedence === b.operator.precedence && a.operator.associativity === 'right'){
            return 1;
        }

        return b.operator.precedence - a.operator.precedence;
    })
    .forEach(function(token){
        var index = ast.indexOf(token),
            operator = token.operator,
            left,
            middle,
            right;

        // Token was parsed by some other parser step.
        if(!~index){
            return;
        }

        if(operator.trinary){
            left = ast.splice(index-1,1);
            middle = ast.splice(index,1);
            var trinary = ast.splice(index,1);
            right = ast.splice(index,1);
            if(!trinary.length || trinary[0].name !== operator.trinary){
                parseError('Unexpected token.', token);
            }
        }else if(operator.direction === 'left'){
            left = ast.splice(index-1,1);
        }else if(operator.direction === 'right'){
            right = ast.splice(index + 1,1);
        }else{
            left = ast.splice(index-1,1);
            right = ast.splice(index, 1);
        }

        if(
            left && left.length !== 1 ||
            middle && middle.length !== 1 ||
            right && right.length !== 1
        ){
            parseError('unexpected token.', token);
        }

        if(operator.name === 'assignment' && left[0].type !== 'identifier'){
            parseError('Unexpected token.', token);
        }

        if(left){
            token.left = left[0];
        }
        if(middle){
            token.middle = middle[0];
        }
        if(right){
            token.right = right[0];
        }
    });
}

function parseToken(tokens, ast){
    if(!ast){
        ast = [];
    }

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