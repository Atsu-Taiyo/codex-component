# Codex Component for Unity

Call the player's local Codex from Unity Web, Editor or desktop. Includes chat, models, generated images and cancellation. Each player must sign into Codex and run the local companion.

See the [complete installation guide and C# examples](https://github.com/Atsu-Taiyo/codex-component/blob/unity-v0.1.0/docs/unity.md).

Import **Chat example** from Package Manager → Samples. Pass a runtime pairing token to `Connect`, then call `Ask` from your game's UI. Never save tokens in scene assets.

Realtime voice is currently available only through the separate browser helper, not this Unity package. WebGL builds and published Sites connectivity have not yet been verified; browser local-network permissions and hosting policies apply.
