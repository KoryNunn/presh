var test = require('tape'),
    sameValue = require('same-value'),
    deepEqual = require('deep-equal'),
    presh = require('../');

function functionallyIdentical(tester){
    return function(a, b){
        var resultA = tester(a);
        var resultB = tester(b);

        // console.log(resultA, resultB);

        if(resultA && typeof resultA === 'object'){
            return deepEqual(resultA, resultB);
        }
        return sameValue(resultA, resultB);
    };
}

function testExpression(name, expression, scope, expected, comparitor){
    if(!scope || typeof scope !== 'object' || !expected ||  typeof expected === 'function'){
        comparitor = expected;
        expected = scope;
        scope = null;
    }

    test(name, function(t){
        t.plan(1);

        var result = presh(expression, scope || {
            bar: {
                baz: 'baz'
            }
        });

        if(comparitor){
            t.ok(comparitor(result.value, expected));
            return;
        }

        t.deepEqual(result.value, expected);

    });
}


testExpression('Booleans: true', 'true', true);
testExpression('Booleans: false', 'false', false);

testExpression('Numbers: 1', '1', 1);
testExpression('Numbers: -1', '-1', -1);
testExpression('Numbers: 1.1', '1.1', 1.1);
testExpression('Numbers: -1.1', '-1.1', -1.1);
testExpression('Numbers: .1', '.1', 0.1);
testExpression('Numbers: -.1', '-.1', -0.1);
testExpression('Numbers: 1e10', '1e10', 1e10);
testExpression('Numbers: -1e10', '-1e10', -1e10);
testExpression('Numbers: NaN', 'NaN', NaN, sameValue);
testExpression('Numbers: -NaN', '-NaN', NaN, sameValue);
testExpression('Numbers: Infinity', 'Infinity', Infinity, sameValue);
testExpression('Numbers: -Infinity', '-Infinity', -Infinity, sameValue);

testExpression('Strings: "foo"', '"foo"', 'foo');
testExpression('Strings: \'foo\'', '\'foo\'', 'foo');
testExpression('Strings: Escaping', '"foo \\" bar"', 'foo \" bar');
testExpression('Strings: Escape Escaping', '"foo \\\\" bar"', 'foo \\\" bar');

testExpression('Null:', 'null', null);
testExpression('Undefined:', 'undefined', undefined);

testExpression('Equality', 'true == true', true);
testExpression('Equality', 'true == false', false);
testExpression('Equality', '1 == "1"', true);
testExpression('Equality', '1 == "2"', false);

testExpression('Inequality', 'true != true', false);
testExpression('Inequality', 'true != false', true);
testExpression('Equality', '1 != "1"', false);
testExpression('Equality', '1 != "2"', true);

testExpression('Strict Equality', 'true === true', true);
testExpression('Strict Equality', 'true === false', false);
testExpression('Strict Equality', '1 === "1"', false);
testExpression('Strict Equality', '1 === "2"', false);

testExpression('Strict Inequality', 'true !== true', false);
testExpression('Strict Inequality', 'true !== false', true);
testExpression('Strict Equality', '1 !== "1"', true);
testExpression('Strict Equality', '1 !== "2"', true);

testExpression('Greater than', '2 > 1', true);
testExpression('Greater than', '2 > 2', false);
testExpression('Greater than', '1 > 2', false);

testExpression('Less than', '2 < 1', false);
testExpression('Less than', '2 < 2', false);
testExpression('Less than', '1 < 2', true);

testExpression('Greater than or equal', '2 >= 1', true);
testExpression('Greater than or equal', '2 >= 2', true);
testExpression('Greater than or equal', '1 >= 2', false);

testExpression('Less than or equal', '2 <= 1', false);
testExpression('Less than or equal', '2 <= 2', true);
testExpression('Less than or equal', '1 <= 2', true);

testExpression('Turnary 1', 'true ? "first" : "second"', 'first');
testExpression('Turnary 2', 'false ? "first" : "second"', 'second');
testExpression('Nested Turnary', 'true ? false ? "first" : "second" : "third"', 'second');

testExpression('Spread', '[0..2]', [0, 1, 2]);
testExpression('Spread reverse', '[2..0]', [2, 1, 0]);
testExpression('Spread negatives', '[-2..2]', [-2, -1, 0, 1, 2]);
testExpression('Spread negatives reverse', '[2..-2]', [2, 1, 0, -1, -2]);
testExpression('Spread non-number', '[(0)..2]', [0, 1, 2]);
testExpression('Spread complex', '(a){[a..a*2]}(3)', [3, 4, 5, 6]);

testExpression('Expression 1', '(x){x}', function(x){return x;}, functionallyIdentical(function(fn){
    return fn(1);
}));
testExpression('Expression 2', '(x){x + 1}', function(x){return x+1;}, functionallyIdentical(function(fn){
    return fn(1);
}));
testExpression('Expression  3', '(a b){a + b}', function(a, b){return a + b;}, functionallyIdentical(function(fn){
    return fn(1, 3);
}));

testExpression('Expression 4',
    '(...a){ map(a (x){x+1}) }',
    function(){
        return Array.prototype.slice.call(arguments).map(function(x){
            return x + 1;
        });
    },
    functionallyIdentical(function(fn){
        return fn(1, 2, 3, 4);
    })
);

testExpression('Named expression 1', 'foo(x){x} foo("hello")', 'hello');
testExpression('Named expression 2', 'foo(x){x} bar(fn){fn("world")} bar(foo)', 'world');

testExpression('Spread apply', '(a b c){a + b + c}(...[0..2])', 3);
testExpression('Spread concat', '[1 2 3 ...[4..6]]', [1, 2, 3, 4, 5, 6]);

testExpression('dots and that', 'thing.bar()', {thing: { bar: function(){return 'foo';}}}, 'foo');
testExpression('dots and that with brace accessor', 'thing["bar"]()', {thing: { bar: function(){return 'foo';}}}, 'foo');
testExpression('context', 'thing.bar()', {thing: { majigger: 2, bar: function(){return this.majigger;}}}, 2);
testExpression('context with brace accessor', 'thing["bar"]()', {thing: { majigger: 2, bar: function(){return this.majigger;}}}, 2);


test('errors', function(t){
    t.plan(2);

    var result = presh('foo.things; fail()', {
        fail:function(){
            t.fail();
        }
    });

    t.ok(result.error, 'did error');
    t.notOk(result.value, 'did not return a value');
});