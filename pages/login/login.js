function getDefaultHome(user) {
  if (user && user.role === 'admin') return '/pages/admin/audit';
  if (user && user.role === 'publisher' && user.verifyStatus === 'approved') {
    return '/pages/publisher/jobs';
  }
  return '/pages/student/jobs';
}

const DEFAULT_AVATAR = '/assets/images/default-avatar.png';
const LOGIN_BG = '/assets/images/login-bg.jpg';
// 一键切换：true=固定本地头像，false=显示用户真实头像
const USE_LOCAL_LOGIN_AVATAR = true;
const LAST_EXIT_AVATAR_KEY = 'lastExitAvatar';

Page({

  data: {
    defaultAvatar: DEFAULT_AVATAR,
    loginAvatar: DEFAULT_AVATAR,
    useLocalLoginAvatar: USE_LOCAL_LOGIN_AVATAR,
    avatarBroken: false,
    lastExitAvatar: '',
    loginBg: LOGIN_BG
  },

  resolveLoginAvatar(userInfo, serverUser, lastExitAvatar) {
    if (this.data.useLocalLoginAvatar) {
      return DEFAULT_AVATAR;
    }
    if (this.data.avatarBroken) {
      return DEFAULT_AVATAR;
    }
    const cachedLastAvatar = lastExitAvatar || this.data.lastExitAvatar;
    const serverAvatar = serverUser && serverUser.avatarUrl;
    const localAvatar = userInfo && userInfo.avatarUrl;
    return cachedLastAvatar || serverAvatar || localAvatar || DEFAULT_AVATAR;
  },

  updateLoginAvatar(userInfo, serverUser, lastExitAvatar) {
    const finalAvatar = this.resolveLoginAvatar(
      userInfo || this.data.userInfo,
      serverUser || this.data.serverUser,
      lastExitAvatar
    );
    this.setData({
      loginAvatar: finalAvatar
    });
    this.persistLastExitAvatar(finalAvatar);
  },

  persistLastExitAvatar(avatarUrl) {
    const value = avatarUrl || DEFAULT_AVATAR;
    wx.setStorageSync(LAST_EXIT_AVATAR_KEY, value);
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad() {
    const userInfo = wx.getStorageSync('userInfo') || {};
    const openid = wx.getStorageSync('openid') || '';
    const serverUser = wx.getStorageSync('user') || null;
    const lastExitAvatar = wx.getStorageSync(LAST_EXIT_AVATAR_KEY) || '';

    // hasUserInfo 仅用于控制 UI：是否展示“进入首页”而不是“登录按钮”
    const hasUserInfo = !!(serverUser && (serverUser.openid || openid));

    // 若本地 userInfo 缓存缺字段，则用 serverUser 的 nickName/avatarUrl 补齐
    let mergedUserInfo = userInfo;
    if ((!mergedUserInfo || !mergedUserInfo.avatarUrl) && serverUser) {
      mergedUserInfo = {
        avatarUrl: serverUser.avatarUrl,
        nickName: serverUser.nickName
      };
    }

    this.setData({
      hasUserInfo,
      userInfo: mergedUserInfo || {},
      openid: openid || (serverUser ? serverUser.openid : ''),
      serverUser,
      lastExitAvatar
    });
    this.updateLoginAvatar(mergedUserInfo || {}, serverUser, lastExitAvatar);
  },

  enterHome() {
    const target = getDefaultHome(this.data.serverUser);
    wx.reLaunch({ url: target });
  },

  onLoginAvatarError() {
    this.setData({
      avatarBroken: true,
      loginAvatar: DEFAULT_AVATAR
    });
    this.persistLastExitAvatar(DEFAULT_AVATAR);
  },

  getUserProfile() {
    wx.getUserProfile({
      desc: '用于完善会员资料',  // 必填，声明用途
      success: (res) => {
        const userInfo = res.userInfo;
        // 调用云函数进行登录
        this.doLogin(userInfo);
      },
      fail: (err) => {
        console.error('获取用户信息失败', err);
        wx.showToast({
          title: '需要授权才能登录',
          icon: 'none'
        });
      }
    });
  },

  // 调用云函数登录
  doLogin(userInfo) 
  {
    wx.showLoading({ title: '登录中...' });
    wx.cloud.callFunction({
      name: 'login',           // 云函数名称（后面要创建）
      data: {
        userInfo: userInfo     // 将用户信息传给云函数
      },
      success: (res) => {
        wx.hideLoading();
        const { openid, user } = res.result;
        wx.setStorageSync('userInfo', userInfo);
        wx.setStorageSync('openid', openid);
        if (user) wx.setStorageSync('user', user);
        this.setData({
          hasUserInfo: true,
          userInfo: userInfo,
          openid: openid,
          serverUser: user || null,
          avatarBroken: false,
          lastExitAvatar: ''
        });
        this.updateLoginAvatar(userInfo, user || null);
        wx.showToast({ title: '登录成功', icon: 'success' });
        setTimeout(() => {
          const target = getDefaultHome(user);
          wx.reLaunch({ url: target });
        }, 400);
      },
      fail: (err) => {
        wx.hideLoading();
        console.error('云函数调用失败', err);
        wx.showToast({
          title: '登录失败，请重试',
          icon: 'none'
        });
      }
    });
  },
  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    this.updateLoginAvatar(this.data.userInfo, this.data.serverUser);
  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {
    this.persistLastExitAvatar(this.data.loginAvatar);
  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {
    this.persistLastExitAvatar(this.data.loginAvatar);
  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {

  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {

  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {

  }
})