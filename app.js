App({
  globalData: {
    // 定位授权会话态：本次登录生命周期内避免重复弹授权请求
    locationAuthPrompted: false,
    locationAuthorized: false,
    // 本次登录已触发定位授权请求次数（用于“推荐页一次 + 地图页二次”控制）
    locationPromptCount: 0
  },
  onLaunch: function () 
  {
    if (!wx.cloud) 
    {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } 
    else 
    {
      wx.cloud.init
      ({
        env: 'cloud1-5gcyy4y20bf048c8',   // 云开发环境ID
        traceUser: true   // 追踪用户
      });
    }
  }
});
