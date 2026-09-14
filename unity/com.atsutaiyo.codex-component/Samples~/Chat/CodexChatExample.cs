using System;
using CodexComponent;
using UnityEngine;
public class CodexChatExample : MonoBehaviour {
    CodexClient client;
    string threadId;
    // Bind a runtime token input field to this method. Never store tokens in scenes.
    public void Connect(string token) { if (client == null) client = gameObject.AddComponent<CodexClient>(); client.Configure(token); }
    public async void Ask(string prompt) {
        try {
            var result = await client.ChatAsync(new ChatInput { prompt = prompt, threadId = threadId }, e => { if (e.type == "delta") Debug.Log(e.text); });
            threadId = result.threadId; Debug.Log(result.text);
        } catch (OperationCanceledException) { Debug.Log("Cancelled"); }
          catch (Exception error) { Debug.LogError(error.Message); }
    }
    public void Cancel() { if (client != null) client.CancelAll(); }
}
