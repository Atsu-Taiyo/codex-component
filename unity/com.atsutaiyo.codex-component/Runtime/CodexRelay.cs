using System;
using UnityEngine;
using UnityEngine.Scripting;
namespace CodexComponent {
    [Preserve] public sealed class CodexRelay : MonoBehaviour {
        internal Action<string> receive;
        [Preserve] public void OnCodexMessage(string message) { receive?.Invoke(message); }
    }
}
