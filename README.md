# Presh

An ex'presh'n langauge.. for safe evaluation of arbitrary functionality in javascript.

## Goals

Highly functional, stateless, easy to add scope to, expressive, readable.

## features

Implicit returns.
No assignment.
Ranges.

## usage

presh(expression, scope);

```
    var presh = require('presh');

    var result = presh('2 + thing', {
        thing: 4
    });

```

## Syntax

presh syntax is similar to javascript, but a little more weighted to functional programming.

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