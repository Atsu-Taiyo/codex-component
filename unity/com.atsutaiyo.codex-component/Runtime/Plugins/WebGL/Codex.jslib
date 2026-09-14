mergeInto(LibraryManager.library, {
  $CodexTransport: {
    active: {},
    voices: {},
    stopVoice: function(target) {
      var s = CodexTransport.voices[target];
      if (!s) return Promise.resolve({});
      delete CodexTransport.voices[target]; s.stopped = true; s.controller.abort();
      if (s.stream) s.stream.getTracks().forEach(function(t){t.stop();});
      if (s.pc) { s.pc.onconnectionstatechange = null; s.pc.close(); }
      if (s.audio) { s.audio.pause(); s.audio.srcObject = null; s.audio.remove(); }
      if (!s.threadId) return Promise.resolve({});
      return s.request('/voice/stop', {threadId:s.threadId}, false);
    },
    startVoice: async function(target, base, token, options, controller) {
      if (CodexTransport.voices[target]) throw Error('Voice already active; stop it before starting again');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof RTCPeerConnection === 'undefined') throw Error('Voice requires a secure browser with microphone and WebRTC support');
      var s = {controller:controller, stopped:false};
      CodexTransport.voices[target] = s;
      var check = function() { if (s.stopped || controller.signal.aborted) throw Error('Voice cancelled'); };
      var event = function(value) { if (!s.stopped) SendMessage(target,'OnVoiceMessage',JSON.stringify(value)); };
      s.request = async function(route, body, cancellable) {
        var timeout = new AbortController(), timer = setTimeout(function(){timeout.abort();},40000);
        var abort = function(){timeout.abort();};
        if (cancellable !== false) { controller.signal.addEventListener('abort',abort,{once:true}); if (controller.signal.aborted) abort(); }
        try {
          if (route === '/unity/voice/start') { send('result', await CodexTransport.startVoice(target,base,token,JSON.parse(body),controller)); return; }
        if (route === '/unity/voice/stop') { send('result', await CodexTransport.stopVoice(target)); return; }
        var response = await fetch(base.replace(/\/$/,'')+route,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:timeout.signal});
          if (!response.ok) throw Error('HTTP '+response.status+': '+await response.text());
          return await response.json();
        } finally { clearTimeout(timer); controller.signal.removeEventListener('abort',abort); }
      };
      try {
        // Start capture before any network await so a button gesture reaches the browser.
        s.stream = await navigator.mediaDevices.getUserMedia({audio:true});
        if (s.stopped) s.stream.getTracks().forEach(function(t){t.stop();});
        check();
        s.audio = document.createElement('audio'); s.audio.autoplay = true; s.audio.setAttribute('playsinline','');
        s.audio.controls = true; s.audio.setAttribute('aria-label','Codex voice playback'); document.body.appendChild(s.audio);
        s.pc = new RTCPeerConnection();
        s.stream.getTracks().forEach(function(t){s.pc.addTrack(t,s.stream);});
        s.pc.ontrack = function(e) { if (s.stopped) return; s.audio.srcObject = e.streams[0] || new MediaStream([e.track]); s.audio.play().catch(function(){event({type:'playback-blocked',message:'Use the browser audio control to start playback'});}); };
        var channel = s.pc.createDataChannel('oai-events');
        channel.onmessage = function(e) { try { event(JSON.parse(e.data)); } catch (_) { event({type:'raw',message:e.data}); } };
        s.pc.onconnectionstatechange = function() {
          var state = s.pc.connectionState; event({type:'connection-state',state:state});
          if (state === 'failed' || state === 'closed') CodexTransport.stopVoice(target).catch(function(){});
        };
        s.threadId = options.threadId || (await s.request('/threads',{})).threadId;
        check();
        var offer = await s.pc.createOffer(); check(); await s.pc.setLocalDescription(offer); check();
        var body = {threadId:s.threadId,sdp:offer.sdp};
        ['model','voice','prompt'].forEach(function(k){if(options[k])body[k]=options[k];});
        var answer = await s.request('/voice/connect',body); check();
        await s.pc.setRemoteDescription({type:'answer',sdp:answer.sdp}); check();
        event({type:'ready',threadId:s.threadId});
        return {threadId:s.threadId};
      } catch (error) {
        if (CodexTransport.voices[target] === s) await CodexTransport.stopVoice(target).catch(function(){});
        throw error;
      }
    },

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
        if (route === '/unity/voice/start') { send('result', await CodexTransport.startVoice(target,base,token,JSON.parse(body),controller)); return; }
        if (route === '/unity/voice/stop') { send('result', await CodexTransport.stopVoice(target)); return; }
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
  Codex_StopVoice__deps: ['$CodexTransport'],
  Codex_StopVoice: function(target) { CodexTransport.stopVoice(UTF8ToString(target)).catch(function(){}); },
  Codex_Cancel__deps: ['$CodexTransport'],
  Codex_Cancel: function(target, id) {
    var key = UTF8ToString(target) + ':' + id, controller = CodexTransport.active[key];
    if (controller) { delete CodexTransport.active[key]; controller.abort(); if (CodexTransport.voices[UTF8ToString(target)] && CodexTransport.voices[UTF8ToString(target)].controller === controller) CodexTransport.stopVoice(UTF8ToString(target)).catch(function(){}); }
  }
});
