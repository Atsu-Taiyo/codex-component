mergeInto(LibraryManager.library, {
  $CodexTransport: {
    active: {},
    send: function(target, id, kind, value) {
      SendMessage(target, 'OnCodexMessage', JSON.stringify({id:id, kind:kind, json:JSON.stringify(value)}));
    },
    run: async function(target, id, base, token, route, body) {
      var key = target + ':' + id, controller = new AbortController();
      CodexTransport.active[key] = controller;
      var send = function(kind, value) {
        if (CodexTransport.active[key] === controller) CodexTransport.send(target, id, kind, value);
      };
      try {
        var url = new URL(base);
        if (!['localhost','127.0.0.1'].includes(url.hostname) || !['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('Expected a local companion URL');
        var response = await fetch(base.replace(/\/$/, '') + route, {
          method: body ? 'POST' : 'GET', redirect:'error',
          headers: Object.assign({Authorization:'Bearer ' + token}, body ? {'Content-Type':'application/json'} : {}),
          body: body || undefined, signal:controller.signal
        });
        if (!response.ok) throw Error('HTTP ' + response.status + ': ' + await response.text());
        if (route !== '/chat' && route !== '/images') { send('result', await response.json()); return; }
        if (!response.body) throw Error('Missing response stream');
        var reader = response.body.getReader(), decoder = new TextDecoder(), buffer = '', result;
        var consume = function(line) {
          if (!line.trim()) return;
          var event = JSON.parse(line);
          if (event.type === 'error') throw Error(event.error || 'Codex error');
          if (event.type === 'completed') result = event.result;
          send('event', event);
        };
        try {
          while (true) {
            var chunk = await reader.read();
            buffer += decoder.decode(chunk.value, {stream:!chunk.done});
            var index;
            while ((index = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0,index)); buffer = buffer.slice(index+1); }
            if (buffer.length > 32*1024*1024) throw Error('Stream frame too large');
            if (chunk.done) { consume(buffer); break; }
          }
          if (!result) throw Error('Stream ended without completion');
          send('result', result);
        } finally { await reader.cancel().catch(function(){}); reader.releaseLock(); }
      } catch (error) { send('error', {message:error.message}); }
      finally { delete CodexTransport.active[key]; }
    }
  },
  Codex_Request__deps: ['$CodexTransport'],
  Codex_Request: function(target, id, base, token, route, body) {
    CodexTransport.run(UTF8ToString(target), id, UTF8ToString(base), UTF8ToString(token), UTF8ToString(route), UTF8ToString(body));
  },
  Codex_Cancel__deps: ['$CodexTransport'],
  Codex_Cancel: function(target, id) {
    var key = UTF8ToString(target) + ':' + id, controller = CodexTransport.active[key];
    if (controller) { delete CodexTransport.active[key]; controller.abort(); }
  }
});
