using System;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
public static class TreasureBuild {
    public static void Setup() {
        var scene=EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
        var camera=new GameObject("Camera",typeof(Camera));camera.GetComponent<Camera>().clearFlags=CameraClearFlags.SolidColor;camera.GetComponent<Camera>().backgroundColor=new Color(.97f,.96f,.99f);
        new GameObject("TreasureGame",typeof(TreasureGame));
        EditorSceneManager.SaveScene(scene,"Assets/Treasure.unity");
        EditorBuildSettings.scenes=new[]{new EditorBuildSettingsScene("Assets/Treasure.unity",true)};
        PlayerSettings.companyName="Codex Component";PlayerSettings.productName="ことばの宝箱";
        PlayerSettings.defaultScreenWidth=1280;PlayerSettings.defaultScreenHeight=800;
        PlayerSettings.insecureHttpOption=InsecureHttpOption.AlwaysAllowed;
        PlayerSettings.WebGL.compressionFormat=WebGLCompressionFormat.Disabled;
        PlayerSettings.WebGL.memorySize=256;
        PlayerSettings.WebGL.exceptionSupport=WebGLExceptionSupport.FullWithoutStacktrace;
        AssetDatabase.SaveAssets();
        Debug.Log("TREASURE_SETUP_OK");
    }
    public static void Web() {
        Setup();var report=BuildPipeline.BuildPlayer(new BuildPlayerOptions{scenes=new[]{"Assets/Treasure.unity"},locationPathName="Build/Web",target=BuildTarget.WebGL,options=BuildOptions.Development});
        if(report.summary.result!=UnityEditor.Build.Reporting.BuildResult.Succeeded)throw new Exception("Web build failed: "+report.summary.result);
        Debug.Log("TREASURE_WEB_BUILD_OK");
    }
    public static void Playtest() {
        Setup();
        var game=UnityEngine.Object.FindFirstObjectByType<TreasureGame>();
        game.SendMessage("Awake");game.SendMessage("Start");
        Run();
    }
    static async void Run(){
        try{
            SessionState.SetBool("TreasurePlaytest",false);
            var game=TreasureGame.Instance;if(game==null)throw new Exception("No game instance");
            game.BeginPractice();
            await game.SubmitIdea("石");if(game.Score!=0)throw new Exception("Rejected item scored");
            await game.SubmitIdea("星のランプ");if(game.Score!=1)throw new Exception("Round 1 failed");
            await game.SubmitIdea("魔法の翼");if(game.Score!=2)throw new Exception("Round 2 failed");
            await game.SubmitIdea("花のプレゼント");if(game.Score!=3)throw new Exception("Win failed");
            await game.SubmitIdea("extra");if(game.Score!=3)throw new Exception("Scored after win");
            game.ResetGame();if(game.Score!=0)throw new Exception("Reset failed");
            Debug.Log("TREASURE_RULE_CHECK_OK: rejection, 3 rounds, win, win guard, reset");
            EditorApplication.Exit(0);
        }catch(Exception error){Debug.LogException(error);EditorApplication.Exit(1);}
    }
}
