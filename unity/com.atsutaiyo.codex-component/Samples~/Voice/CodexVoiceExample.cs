using System;
using CodexComponent;
using UnityEngine;
public sealed class CodexVoiceExample : MonoBehaviour {
    CodexClient client;
    public void Connect(string token) {
        if (client == null) {
            client = gameObject.AddComponent<CodexClient>();
            client.VoiceEvent += message => Debug.Log(message);
        }
        client.Configure(token);
    }
    public async void BeginVoice() {
        try {
            if (client == null) throw new InvalidOperationException("Connect with the player's token first");
            await client.StartVoiceAsync(new VoiceOptions { prompt = "日本語で短く会話するゲームの案内人です。" });
        } catch (OperationCanceledException) { Debug.Log("Voice cancelled"); }
          catch (Exception error) { Debug.LogError(error.Message); }
    }
    public async void EndVoice() {
        try { if (client != null) await client.StopVoiceAsync(); }
        catch (Exception error) { Debug.LogError(error.Message); }
    }
}
