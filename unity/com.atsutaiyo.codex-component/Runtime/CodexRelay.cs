using System;
using UnityEngine;
using UnityEngine.Scripting;
namespace CodexComponent {
    [Preserve] public sealed class CodexRelay : MonoBehaviour {
        internal Action<string> receive;
        internal Action<string> voice;
        [Preserve] public void OnVoiceMessage(string message) { voice?.Invoke(message); }
        [Preserve] public void OnCodexMessage(string message) { receive?.Invoke(message); }
    }
}
