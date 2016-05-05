var presh = require('../'),
    debounce = require('debounce'),
    crel = require('crel');

var defaultScope = "{ a: 10, b: 20, foo: function(input){ return input + ' World'}}"
var defaultCode = `bar(x){
    x > a && x < b ? foo(x) : foo('Hello');
}

[bar(13) bar(8)]`

var scopeInput, codeInput, output, ui = crel('div',
        crel('h2', 'Scope:'),
        scopeInput = crel('pre', {'contenteditable': true}, defaultScope),
        crel('h2', 'Input:'),
        codeInput = crel('pre', {'contenteditable': true}, defaultCode),
        crel('h2', 'Output:'),
        output = crel('div')
    );

var update = debounce(function(){

    var scope = {};

     try{
        scope = scopeInput.textContent ? eval('(' + scopeInput.textContent + ')') : scope;
        scopeInput.removeAttribute('error');
    }catch(error){
        scopeInput.setAttribute('error', error);
    }

    try{
        var result = presh(codeInput.textContent, scope);

        output.textContent = result.error || JSON.stringify(result.value, null, 4);
        codeInput.removeAttribute('error');
    }catch(error){
        codeInput.setAttribute('error', error);
    }
});
update();

scopeInput.addEventListener('keyup', update);
codeInput.addEventListener('keyup', update);

function tab(event){
    if(event.which === 9){
        event.preventDefault();

        var selection = document.getSelection(),
            range = selection.getRangeAt(0),
            tabNode = document.createTextNode('    ');

        range.insertNode(tabNode);
        range.setStartAfter(tabNode);
        range.setEndAfter(tabNode);
        selection.removeAllRanges();
        selection.addRange(range);
    }
}

scopeInput.addEventListener('keydown', tab);
codeInput.addEventListener('keydown', tab);

window.onload = function(){
    crel(document.body, ui);
};