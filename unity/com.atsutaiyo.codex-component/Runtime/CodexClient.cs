using System;
using System.Collections;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Networking;

namespace CodexComponent
{
    [Serializable] public class ChatInput { public string prompt; public string threadId; public string model; public string effort; public string[] images; }
    [Serializable] public class GeneratedImage { public string itemId; public string mimeType; public string dataUrl;
        public Texture2D ToTexture() {
            if (mimeType != "image/png" && mimeType != "image/jpeg") throw new NotSupportedException("Texture conversion supports PNG/JPEG; use dataUrl for other formats.");
            var texture = new Texture2D(2, 2);
            try { if (!ImageConversion.LoadImage(texture, Convert.FromBase64String(dataUrl.Substring(dataUrl.IndexOf(',') + 1)))) throw new FormatException("Invalid image"); return texture; }
            catch { UnityEngine.Object.Destroy(texture); throw; }
        }
    }
    [Serializable] public class ChatResult { public string threadId; public string turnId; public string text; public string status; public GeneratedImage[] images; }
    [Serializable] public class Model { public string id; public string model; public string displayName; }
    [Serializable] public class ConnectionStatus { public bool loggedIn; public bool experimental; }
    [Serializable] public class ChatEvent { public string type; public string text; public string threadId; public string turnId; public GeneratedImage image; public ChatResult result; public string error; }
    [Serializable] class Envelope { public int id; public string kind; public string json; }
    [Serializable] class ErrorMessage { public string message; }
    [Serializable] class StringValue { public string value; }
    [Serializable] class ModelList { public Model[] models; }

    /// <summary>Call all methods from Unity's main thread. Tokens are runtime-only.</summary>
    public sealed class CodexClient : MonoBehaviour
    {
        string baseUrl, token;
        int sequence;
        CodexRelay relay;
        readonly Dictionary<int, TaskCompletionSource<string>> pending = new Dictionary<int, TaskCompletionSource<string>>();
        readonly Dictionary<int, UnityWebRequest> native = new Dictionary<int, UnityWebRequest>();
        readonly Dictionary<int, Action<ChatEvent>> callbacks = new Dictionary<int, Action<ChatEvent>>();
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void Codex_Request(string target, int id, string url, string token, string route, string body);
        [DllImport("__Internal")] static extern void Codex_Cancel(string target, int id);
#endif
        public void Configure(string localToken, string url = "http://127.0.0.1:8787/api/ai") {
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Host != "localhost" && uri.Host != "127.0.0.1") || (uri.Scheme != "http" && uri.Scheme != "https") || uri.UserInfo.Length > 0 || uri.Query.Length > 0 || uri.Fragment.Length > 0) throw new ArgumentException("Expected localhost or 127.0.0.1 URL");
            if (string.IsNullOrWhiteSpace(localToken)) throw new ArgumentException("Pairing token is required");
            CancelAll(); baseUrl = url.TrimEnd('/'); token = localToken;
            if (relay == null) { var go = new GameObject("Codex-" + Guid.NewGuid().ToString("N")); go.transform.SetParent(transform); relay = go.AddComponent<CodexRelay>(); relay.receive = Receive; }
        }
        public async Task<ConnectionStatus> StatusAsync() => JsonUtility.FromJson<ConnectionStatus>(await Request("/status", null));
        public async Task<Model[]> ModelsAsync() => JsonUtility.FromJson<ModelList>("{\"models\":" + await Request("/models", null) + "}").models;
        public async Task<ChatResult> ChatAsync(ChatInput input, Action<ChatEvent> onEvent = null) => JsonUtility.FromJson<ChatResult>(await Request("/chat", SerializeInput(input), onEvent));
        public async Task<ChatResult> GenerateImageAsync(ChatInput input, Action<ChatEvent> onEvent = null) => JsonUtility.FromJson<ChatResult>(await Request("/images", SerializeInput(input), onEvent));
        static string Quote(string value) { var json = JsonUtility.ToJson(new StringValue { value = value }); return json.Substring(9, json.Length - 10); }
        static string SerializeInput(ChatInput input) {
            if (input == null || string.IsNullOrWhiteSpace(input.prompt)) throw new ArgumentException("Prompt is required");
            var json = "{\"prompt\":" + Quote(input.prompt);
            if (!string.IsNullOrEmpty(input.threadId)) json += ",\"threadId\":" + Quote(input.threadId);
            if (!string.IsNullOrEmpty(input.model)) json += ",\"model\":" + Quote(input.model);
            if (!string.IsNullOrEmpty(input.effort)) json += ",\"effort\":" + Quote(input.effort);
            if (input.images != null && input.images.Length > 0) json += ",\"images\":[" + string.Join(",", Array.ConvertAll(input.images, Quote)) + "]";
            return json + "}";
        }
        Task<string> Request(string route, string body, Action<ChatEvent> callback = null) {
            if (relay == null || string.IsNullOrEmpty(token)) throw new InvalidOperationException("Call Configure first");
            var id = ++sequence; var completion = new TaskCompletionSource<string>(); pending.Add(id, completion); callbacks[id] = callback;
#if UNITY_WEBGL && !UNITY_EDITOR
            Codex_Request(relay.gameObject.name, id, baseUrl, token, route, body ?? "");
#else
            StartCoroutine(NativeRequest(id, route, body));
#endif
            return completion.Task;
        }
        IEnumerator NativeRequest(int id, string route, string body) {
            using (var request = new UnityWebRequest(baseUrl + route, body == null ? "GET" : "POST")) {
                request.redirectLimit = 0;
                request.SetRequestHeader("Authorization", "Bearer " + token);
                request.downloadHandler = new DownloadHandlerBuffer();
                if (body != null) { request.uploadHandler = new UploadHandlerRaw(System.Text.Encoding.UTF8.GetBytes(body)); request.SetRequestHeader("Content-Type", "application/json"); }
                native[id] = request;
                yield return request.SendWebRequest();
                native.Remove(id);
                if (!pending.ContainsKey(id)) yield break;
                try {
                    if (request.result != UnityWebRequest.Result.Success) throw new Exception(request.error);
                    var text = request.downloadHandler.text;
                    if (route == "/chat" || route == "/images") {
                        ChatResult result = null;
                        foreach (var line in text.Split('\n')) { if (string.IsNullOrWhiteSpace(line)) continue; var e = JsonUtility.FromJson<ChatEvent>(line); if (e.type == "error") throw new Exception(e.error); Emit(id, e); if (e.type == "completed") result = e.result; }
                        if (result == null) throw new Exception("Stream ended without completion");
                        Finish(id, JsonUtility.ToJson(result), null);
                    } else Finish(id, text, null);
                } catch (Exception error) { Finish(id, null, error); }
            }
        }
        void Emit(int id, ChatEvent e) { if (callbacks.TryGetValue(id, out var callback)) { try { callback?.Invoke(e); } catch (Exception error) { Debug.LogException(error); } } }
        void Receive(string message) {
            var envelope = JsonUtility.FromJson<Envelope>(message);
            if (!pending.ContainsKey(envelope.id)) return;
            try {
                if (envelope.kind == "event") Emit(envelope.id, JsonUtility.FromJson<ChatEvent>(envelope.json));
                else Finish(envelope.id, envelope.json, envelope.kind == "error" ? new Exception(JsonUtility.FromJson<ErrorMessage>(envelope.json).message) : null);
            } catch (Exception error) { Finish(envelope.id, null, error); }
        }
        void Finish(int id, string result, Exception error) {
            if (!pending.TryGetValue(id, out var completion)) return;
            pending.Remove(id); callbacks.Remove(id);
            if (error == null) completion.TrySetResult(result); else completion.TrySetException(error);
        }
        public void CancelAll() {
            foreach (var id in new List<int>(pending.Keys)) {
#if UNITY_WEBGL && !UNITY_EDITOR
                Codex_Cancel(relay.gameObject.name, id);
#else
                if (native.TryGetValue(id, out var request)) request.Abort();
#endif
                var completion = pending[id]; pending.Remove(id); callbacks.Remove(id); completion.TrySetCanceled();
            }
        }
        void OnDisable() { CancelAll(); }
        void OnDestroy() { CancelAll(); token = null; }
    }
}
