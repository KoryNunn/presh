# Presh

[![Build Status](https://travis-ci.org/korynunn/presh.svg?branch=master)](https://travis-ci.org/korynunn/presh)
![GitHub code size in bytes](https://img.shields.io/github/languages/code-size/korynunn/presh)
[![GitHub package.json version](https://img.shields.io/github/package-json/v/korynunn/presh)](https://github.com/korynunn/presh/releases)
[![GitHub](https://img.shields.io/github/license/korynunn/presh)](https://github.com/korynunn/presh/blob/master/LICENSE)

An ex'presh'n langauge.. for safe evaluation of arbitrary functionality in javascript.

## Goals

Highly functional, stateless, easy to add scope to, expressive, readable.

## Try

[/example](https://rawgit.com/KoryNunn/presh/master/example/index.html)

## features

Implicit returns.

```
halve(x){ x / 2 }

halve(2) -> 1
```

No assignment.

```
x = 5 <- Nope!

var, let, const <- Nope nope nope!

namedFunction(x){ ... } <- Sure!
```

Ranges.

```
[1..10] -> [1,2,3,4,5,6,7,8,9,10]

[10..1] -> [10,9,8,7,6,5,4,3,2,1]

[-2..2] -> [-2,-1,0,1,2]

```

Spread (apply, array, object)

Apply:
```
sum(...args){ fold(args (a b) { a + b }) }

sum(1 2 3 4) -> 10

```

Array:
```
[0..10] -> [0,1,2,3,4,5,6,7,8,9,10]

```

Object:
```
defaults(){{a:1 b:2}}

{...defaults() c: 3} -> { a: 1, b: 2, c: 3 }
```

Literal delete:

Object:
```
defaults(){{a:1 b:2}}

{...defaults() c: 3 delete a} -> { b: 2, c: 3 }
```


## usage

result = presh(expression, scope);

```
    var presh = require('presh');

    var result = presh('2 + thing', {
        thing: 4
    });

    if(result.error){
        // If the expression execution errored

        console.log(result.error);
    }else{
        // The expression executed without error.

        console.log(result.value);
    }

```

### With cli
You can use the cli to run a script:
```
npm i -g presh
presh -e '1 + 1'
```

## Syntax

presh syntax is similar to javascript, but a little more weighted to functional programming.

Key differences from javascript:

 - no commas

### Function Expression

```
    // Named
    add(parameter1 parameter2){ parameter1 + parameter2 }

    // Anonymous
    (parameter1 parameter2){ parameter1 + parameter2 }

```

### Function Execution

```
    // From an identifier
    add(1 2) // -> 3

    // Anonymous
    ((x) {x+2}) (4) // -> 6

```

### Range

```
    [0..100] // -> [0,1,2,3,...,98,99,100]
```

### Looping

```
    map([0..100] (x){x*2})// -> [0,2,4,6,...,196,198,200]
```
