var test = require('tape')

test('call cli with no arguments', t => {
  t.plan(1);

  var child = require('child_process').execFile('./bin/presh', [],
    function(err, stdout, stderr) { 
      t.ok(stdout.includes('Nothing to do. You can either'));
    }
  );
})

test('call cli with exec', t => {
  t.plan(1);

  var child = require('child_process').execFile('./bin/presh', ['--exec', '1 + 1'],
    function(err, stdout, stderr) { 
      t.equal(stdout.trim(), '2');
    }
  );
})

test('call cli with e', t => {
  t.plan(1);

  var child = require('child_process').execFile('./bin/presh', ['-e', '1 + 1'],
    function(err, stdout, stderr) { 
      t.equal(stdout.trim(), '2');
    }
  );
})

test('call cli with wrong file path', t => {
  t.plan(1);

  var child = require('child_process').execFile('./bin/presh', ['nothere.pr'],
    function(err, stdout, stderr) { 
      t.ok(stderr.trim().includes('Could not find file'));
    }
  );
})

test('call cli with correct file path', t => {
  t.plan(1);

  var child = require('child_process').execFile('./bin/presh', ['./test/test.pr'],
    function(err, stdout, stderr) { 
      t.equal(stdout.trim(), '2');
    }
  );
})
