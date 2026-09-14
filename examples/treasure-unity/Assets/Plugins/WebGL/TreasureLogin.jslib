mergeInto(LibraryManager.library, {
  Treasure_Login: function() {
    if (window.treasureLogin) window.treasureLogin();
    else SendMessage('TreasureGame','LoginStatus','ログイン画面を準備中です。少し待ってもう一度押してください。');
  }
});
