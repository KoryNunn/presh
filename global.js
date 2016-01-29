module.exports = {
    log: function(x){
        console.log.apply(console, arguments);
        return x;
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
    math: Math
};