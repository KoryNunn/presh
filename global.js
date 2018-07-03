module.exports = {
    log: function(x){
        console.log.apply(console, arguments);
        return x;
    },
    slice: function(items, start, end){
        return items.slice(start, end);
    },
    find: function(items, fn){
        return items.find(fn);
    },
    indexOf: function(items, fn){
        return items.indexOf(fn);
    },
    map: function(items, fn){
        return items.map(fn);
    },
    fold: function(items, seed, fn){
        if(arguments.length === 2){
            return items.reduce(seed);
        }
        return items.reduce(fn, seed);
    },
    String: String,
    Number: Number,
    math: Math
};