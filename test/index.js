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

function executeTest(test, name, expression, scope, expected, comparitor){
    if(!scope || typeof scope !== 'object' || (!expected && arguments.length < 5) ||  typeof expected === 'function'){
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

var testExpression = executeTest.bind(null, test);
testExpression.only = executeTest.bind(null, test.only);

testExpression('Booleans: true', 'true', true);
testExpression('Booleans: false', 'false', false);

testExpression('Comments: /*foo*/', '/*foo*/', undefined);
testExpression('Comments: /*foo/bar*/', '/*foo/bar*/', undefined);


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

testExpression('Precedence: + binds binary first with preceding and following delimiter', '1 + 1', 2);
testExpression('Precedence: + binds unary without preceeding delimiter', '1 +1', 1);
testExpression('Precedence: + binds binary without any delimiter first', '1+1', 2);

testExpression('Strings: "foo"', '"foo"', 'foo');
testExpression('Strings: \'foo\'', '\'foo\'', 'foo');
testExpression('Strings: Escaping', '"foo \\" bar"', 'foo \" bar');
testExpression('Strings: Escape Escaping', '"foo \\\\\\\\ bar"', 'foo \\\\ bar');
testExpression('Strings: Escape String Escaping', '"foo \\\\\\\\"', 'foo \\\\');
testExpression('Strings: Mixed string tokens', '"foo\'s"', 'foo\'s');
testExpression('Strings: Newline', '"\\n"', '\n');
testExpression('Strings: Newline', '"\\\\n"', '\\n');

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

testExpression('Constant assignment', 'a = 2; a', 2);

test('Attempted constant reassignment', function(t){
    t.plan(2);

    var result = presh('a = 2; a = 3;');

    t.ok(result.error, 'did error');
    t.notOk(result.value, 'did not return a value');
});

test('assignment to non-identifier', function(t){
    t.plan(1);

    t.throws(function(){
        presh('a.b = 2');
    }, 'Threw a parse error');
});

testExpression('Objects', '{}', {});
testExpression('Objects with shallow content', '{a:1}', {a: 1});
testExpression('Objects with shallow content {a:1 b:1}', '{a:1 b:1}', {a: 1, b: 1});
testExpression('Objects with shallow content with commas {a:1, b:1}', '{a:1, b:1}', {a: 1, b: 1});
testExpression('Objects with deep content', '{a: {b:1}}', {a: {b: 1}});
testExpression('Objects with identifiers', '(x){ {x} }(6)', {x: 6});
testExpression('Objects with evaluated keys', '{[2+2]:true}', {4: true});
testExpression('Objects with spread', '(a){ {...a b: 2} }({a: 1})', {a:1, b:2});
testExpression('Objects with spread with commas', '(a){ {...a, b: 2} }({a: 1})', {a:1, b:2});
testExpression('Objects with delete', '{a: 1 delete a}', {});
testExpression('Objects with delete with commas', '{a: 1, delete a}', {});
testExpression('Objects with spread delete', '(a){ {...a b: 2 delete c} }({a: 1 c: 3})', {a:1, b:2});
testExpression('Objects with spread delete with commas', '(a){ {...a, b: 2, delete c} }({a: 1, c: 3})', {a:1, b:2});
testExpression('indexOf', '{ index: 0 }.index', 0);
testExpression('tilde bug', '~indexOf([0..3] 1)', { indexOf: (a, b) => a.indexOf(b) }, -2);
testExpression('tilde bug with commas', '~indexOf([0..3], 1)', { indexOf: (a, b) => a.indexOf(b) }, -2);

testExpression('Array', '[1 2 3]', [1,2,3]);
testExpression('Array with commas', '[1, 2, 3]', [1,2,3]);
testExpression('Array concat', '[1 2 3 ...[4 5 6]]', [1, 2, 3, 4, 5, 6]);
testExpression('Range', '[1 .. 4]', [1, 2, 3, 4]);

test('Range cannot be infinite', function(t){
    t.plan(4);

    var result1 = presh('[1 .. Infinity]');

    t.ok(result1.error, 'did error');
    t.notOk(result1.value, 'did not return a value');

    var result2 = presh('[-Infinity .. 0]');

    t.ok(result2.error, 'did error');
    t.notOk(result2.value, 'did not return a value');
});

testExpression('Expression 1', '(x){x}', function(x){return x;}, functionallyIdentical(function(fn){
    return fn(1);
}));
testExpression('Expression 2', '(x){x + 1}', function(x){return x+1;}, functionallyIdentical(function(fn){
    return fn(1);
}));
testExpression('Expression  3', '(a b){a + b}', function(a, b){return a + b;}, functionallyIdentical(function(fn){
    return fn(1, 3);
}));
testExpression('Expression  3 with commas', '(a, b){a + b}', function(a, b){return a + b;}, functionallyIdentical(function(fn){
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
testExpression('commas seperate anonymous expression from identifiers', 'a = 1 foo(a b){ a + b() } foo(a,(){ 1 })', 2);

testExpression('Spread apply', '(a b c){a + b + c}(...[0..2])', 3);
testExpression('Spread apply with commas', '(a, b, c){a + b + c}(...[0..2])', 3);
testExpression('Spread concat', '[1 2 3 ...[4..6]]', [1, 2, 3, 4, 5, 6]);
testExpression('Spread concat with commas', '[1, 2, 3, ...[4..6]]', [1, 2, 3, 4, 5, 6]);

testExpression('Slice', 'slice([1..10] 3 4)', [4]);
testExpression('Find', 'find([1..10] (item){ item === 6 })', 6);
testExpression('indexOf', 'indexOf([1..10] 6)', 5);

testExpression('String', 'String(1)', "1");
testExpression('Number', 'Number("1")', 1);

testExpression('dots and that', 'thing.bar()', {thing: { bar: function(){return 'foo';}}}, 'foo');
testExpression('dots and that with brace accessor', 'thing["bar"]()', {thing: { bar: function(){return 'foo';}}}, 'foo');
testExpression('context', 'thing.bar()', {thing: { majigger: 2, bar: function(){return this.majigger;}}}, 2);
testExpression('context with brace accessor', 'thing["bar"]()', {thing: { majigger: 2, bar: function(){return this.majigger;}}}, 2);

testExpression('has error', 'thing.stuff()', {thing: { bar: function(){return 'foo';}}}, undefined);

testExpression('catches error', 'map(null null)', undefined);
testExpression('catches error with commas', 'map(null, null)', undefined);
testExpression('math is global', 'math.floor(foo) + math.abs(bar)', {foo: 123.456, bar: -123}, 246);

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

test('accessor errors', function(t){
    t.plan(1);

    var result = presh('foo.things.stuff');
    t.ok(result.error.message.match(/-->.*<--/), 'Has helpful error');
});

testExpression('fizzbuzz', 'map([1..100](x){log((x%3?"":"Fizz")+(x%5?"":"Buzz")||x)})', (function(){
    var result = [];

    for (var i = 1; i <= 100; i++) {
       result.push((i%3?'':'Fizz') + (i%5?'':'Buzz')||i);
    };

     return result;
})());

testExpression('and both true', 'true && true', true);
testExpression('and second false', 'true && false', false);
testExpression('and both false', 'false && true', false);
testExpression('and first false', 'false && true', false);
testExpression('and first false second error', 'false && foo.bar.baz', false);

test('and first error', function(t){
    t.plan(2);

    var result = presh('foo.bar.baz && true');

    t.ok(result.error, 'did error');
    t.notOk(result.value, 'did not return a value');
});

test('Example program', function(t){
    t.plan(2);

    var result = presh(`
        a = (){ 1 };

        someFunction(){
            b = a();

            b;
        }

        someFunction()
    `);

    t.notOk(result.error, 'did not error');
    t.equal(result.value, 1, 'Got expected result');
});
