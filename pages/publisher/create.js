const { call } = require('../../utils/cloud.js');
const JOB_CATEGORIES = ['菜鸟驿站', '奶茶店', '实验室助手', '校外家教', '图书馆管理员', '活动协助', '其他'];
const DEFAULT_LOCATION = {
  name: '武汉市华中农业大学',
  address: '武汉市华中农业大学',
  latitude: 30.5234,
  longitude: 114.3694
};

const QQ_MAP_KEY = 'BJYBZ-CDXE7-ARRXM-PC7IE-ZXBZH-6FFTM'; // 腾讯地图Key

function toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

Page({
  data: {
    title: '',
    category: '',
    categoryOptions: JOB_CATEGORIES,
    categoryIndex: -1,
    location: '',
    locationAddress: '',
    locationLat: 0,
    locationLng: 0,
    timeDesc: '',
    rewardPoints: '',
    needCount: '',
    requiredDeposit: 0,
    description: '',
    contact: '',
    mapLatitude: 0,
    mapLongitude: 0,
    mapMarkers: []
  },

  onTitle(e) {
    this.setData({ title: e.detail.value });
  },
  onCatChange(e) {
    const idx = Number(e.detail.value);
    const category = JOB_CATEGORIES[idx] || '';
    this.setData({
      categoryIndex: Number.isNaN(idx) ? -1 : idx,
      category
    });
  },
  onLoc(e) {
    this.setData({ location: e.detail.value });
  },

  onChooseLocation() {
    wx.navigateTo({
      url: '/pages/location-picker/location-picker'
    });
  },

  onShow() {
    // 页面加载/返回时：若是返回，获取选中的地点
    const pages = getCurrentPages();
    const currPage = pages[pages.length - 1];
    if (currPage.data && currPage.data.selectedLocation) {
      const loc = currPage.data.selectedLocation || {};
      const latitude = toFiniteNumber(loc.latitude, DEFAULT_LOCATION.latitude);
      const longitude = toFiniteNumber(loc.longitude, DEFAULT_LOCATION.longitude);
      const name = (loc.name || '').trim() || DEFAULT_LOCATION.name;
      const address = (loc.address || '').trim() || name;
      this.setData({
        location: address,
        locationAddress: address,
        locationLat: latitude,
        locationLng: longitude,
        mapLatitude: latitude,
        mapLongitude: longitude,
        mapMarkers: [{
          id: 1,
          latitude,
          longitude,
          title: name,
          callout: {
            content: name,
            color: '#000000',
            fontSize: 12,
            borderRadius: 4,
            bgColor: '#ffffff'
          }
        }]
      });
      // 移除选中数据，避免后续重复处理
      this.setData({ selectedLocation: null });
    } else if (this.data.mapLatitude === 0) {
      // 首次进入页面，获取用户当前位置
      this.getUserLocation();
    }
  },

  async getUserLocation() {
    try {
      await this.ensureLocationAuth();
      if (!wx.canIUse('getLocation')) {
        throw new Error('当前基础库不支持定位');
      }
      const res = await this.getLocation();
      const { latitude, longitude } = res;
      this.setData({
        mapLatitude: latitude,
        mapLongitude: longitude,
        mapMarkers: [{
          id: 1,
          latitude,
          longitude,
          title: '当前位置',
          callout: {
            content: '当前位置',
            color: '#000000',
            fontSize: 12,
            borderRadius: 4,
            bgColor: '#ffffff'
          }
        }]
      });
    } catch (e) {
      const msg = (e && (e.message || e.errMsg)) || '定位失败';
      this.setData({
        location: DEFAULT_LOCATION.address,
        locationAddress: DEFAULT_LOCATION.address,
        locationLat: DEFAULT_LOCATION.latitude,
        locationLng: DEFAULT_LOCATION.longitude,
        mapLatitude: DEFAULT_LOCATION.latitude,
        mapLongitude: DEFAULT_LOCATION.longitude,
        mapMarkers: [{
          id: 1,
          latitude: DEFAULT_LOCATION.latitude,
          longitude: DEFAULT_LOCATION.longitude,
          title: DEFAULT_LOCATION.name,
          callout: {
            content: DEFAULT_LOCATION.name,
            color: '#000000',
            fontSize: 12,
            borderRadius: 4,
            bgColor: '#ffffff'
          }
        }]
      });
      wx.showToast({ title: msg.slice(0, 12), icon: 'none' });
    }
  },

  getLocation() {
    return new Promise((resolve, reject) => {
      wx.getLocation({
        type: 'gcj02',
        isHighAccuracy: true,
        highAccuracyExpireTime: 3000,
        success: resolve,
        fail: reject
      });
    });
  },

  ensureLocationAuth() {
    return new Promise((resolve, reject) => {
      wx.getSetting({
        success: (res) => {
          if (res.authSetting['scope.userLocation']) {
            resolve();
            return;
          }
          wx.authorize({
            scope: 'scope.userLocation',
            success: resolve,
            fail: () => {
              this.openSettingForScope('scope.userLocation', resolve, reject);
            }
          });
        },
        fail: reject
      });
    });
  },

  openSettingForScope(scope, resolve, reject) {
    wx.showModal({
      title: '需要定位权限',
      content: '请在设置中允许定位权限后重试',
      confirmText: '去设置',
      success: (modalRes) => {
        if (!modalRes.confirm) {
          reject(new Error('未授权定位'));
          return;
        }
        wx.openSetting({
          success: (settingRes) => {
            if (settingRes.authSetting[scope]) {
              resolve();
            } else {
              reject(new Error('未授权定位'));
            }
          },
          fail: reject
        });
      },
      fail: reject
    });
  },
  onTime(e) {
    this.setData({ timeDesc: e.detail.value });
  },
  onRp(e) {
    this.setData({ rewardPoints: e.detail.value }, () => this.syncRequiredDeposit());
  },
  onNc(e) {
    this.setData({ needCount: e.detail.value }, () => this.syncRequiredDeposit());
  },
  onDesc(e) {
    this.setData({ description: e.detail.value });
  },
  onContact(e) {
    this.setData({ contact: e.detail.value });
  },

  syncRequiredDeposit() {
    const reward = parseInt(this.data.rewardPoints, 10) || 0;
    const need = parseInt(this.data.needCount, 10) || 0;
    const requiredDeposit = reward > 0 && need > 0 ? Math.ceil(reward * need * 1.5) : 0;
    this.setData({ requiredDeposit });
  },

  async showRechargeOrBackModal(content) {
    const modalRes = await new Promise((resolve) => {
      wx.showModal({
        title: '工分不足',
        content,
        confirmText: '前往充值',
        cancelText: '取消',
        success: resolve,
        fail: () => resolve({ confirm: false, cancel: true })
      });
    });
    if (modalRes.confirm) {
      wx.navigateTo({ url: '/pages/wallet/recharge' });
      return;
    }
    return;
  },

  async submit() {
    if (!this.data.category) {
      wx.showToast({ title: '请选择工作类型', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '提交中' });
    try {
      const reward = parseInt(this.data.rewardPoints, 10) || 0;
      const need = parseInt(this.data.needCount, 10) || 0;
      const requiredDeposit = reward > 0 && need > 0 ? Math.ceil(reward * need * 1.5) : 0;
      const profileRes = await call('user', { action: 'getProfile' });
      const balance = parseInt((profileRes.user && profileRes.user.pointsBalance) || 0, 10) || 0;
      if (requiredDeposit > 0 && balance < requiredDeposit) {
        wx.hideLoading();
        await this.showRechargeOrBackModal(`发布该兼职需押金 ${requiredDeposit} 工分，当前余额不足。是否前往充值？`);
        return;
      }

      await call('job', {
        action: 'createJob',
        title: this.data.title,
        category: this.data.category,
        location: this.data.location,
        locationAddress: this.data.locationAddress || this.data.location,
        locationLat: this.data.locationLat || this.data.mapLatitude || DEFAULT_LOCATION.latitude,
        locationLng: this.data.locationLng || this.data.mapLongitude || DEFAULT_LOCATION.longitude,
        timeDesc: this.data.timeDesc,
        rewardPoints: this.data.rewardPoints,
        needCount: this.data.needCount,
        description: this.data.description,
        contact: this.data.contact
      });
      wx.showToast({ title: '已提交审核', icon: 'success' });
      setTimeout(() => wx.redirectTo({ url: '/pages/publisher/jobs' }), 500);
    } catch (e) {
      const msg = (e && e.message) || '失败';
      if (msg.indexOf('工分余额不足') > -1 || (msg.indexOf('工分不足') > -1 && msg.indexOf('押金') > -1)) {
        wx.hideLoading();
        await this.showRechargeOrBackModal(msg);
        return;
      }
      wx.showToast({ title: (e && e.message) || '失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  goJobs() {
    wx.redirectTo({ url: '/pages/publisher/jobs' });
  }
});
