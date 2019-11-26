var righto = require('righto');

module.exports = {
    log: function(x){
        console.log.apply(console, arguments);
        return x;
    },
    slice: function(items, start, end){
        return items.slice(start, end);
    },
    find: function(items, fn){
        function findNext(items){
            return items.length
                ? fn(items[0]).get(result => result ? items[0] : findNext(items.slice(1)))
                : undefined
        }
        return findNext(items);
    },
    indexOf: function(items, value){
        return items.indexOf(value);
    },
    map: function(items, fn){
        return righto.all(items.map(fn));
    },
    fold: function(items, seed, fn){
        if(arguments.length === 2){
            return righto.reduce(items, seed);
        }
        return righto.reduce(items, fn, seed);
    },
    String: String,
    Number: Number,
    math: Math
};