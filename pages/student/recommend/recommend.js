const { call } = require('../../../utils/cloud.js');
const QQ_MAP_KEY = 'BJYBZ-CDXE7-ARRXM-PC7IE-ZXBZH-6FFTM';
const STUDENT_SELECTED_LOCATION_KEY = 'studentSelectedLocation';
const DEFAULT_LOCATION = {
  latitude: 30.4746,
  longitude: 114.3524
};
const DEFAULT_LOCATION_TEXT = '武汉市华中农业大学';

function formatDistance(km) {
  if (km == null || !Number.isFinite(km)) return '未知';
  if (km < 1) return `${Math.max(1, Math.round(km * 1000))}m`;
  return `${km.toFixed(1)}km`;
}

function normalizeWorkTime(workTime, timeDesc) {
  if (Array.isArray(workTime) && workTime.length) {
    return workTime.join(' / ');
  }
  return timeDesc || '待沟通';
}

function buildLocation(location) {
  if (!location) return null;
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function isLocationServiceOffError(err) {
  const msg = String((err && (err.errMsg || err.message)) || '').toLowerCase();
  return msg.indexOf('system') > -1
    || msg.indexOf('service') > -1
    || msg.indexOf('gps') > -1
    || msg.indexOf('定位服务') > -1
    || msg.indexOf('位置服务') > -1
    || msg.indexOf('system permission denied') > -1
    || msg.indexOf('locationswitchoff') > -1
    || msg.indexOf('switch off') > -1
    || msg.indexOf('nocell&wifi') > -1
    || msg.indexOf('location disabled') > -1
    || msg.indexOf('location unavailable') > -1;
}

function isAuthDeniedError(err) {
  const msg = String((err && (err.errMsg || err.message)) || '').toLowerCase();
  return msg.indexOf('auth deny') > -1
    || msg.indexOf('permission denied') > -1
    || msg.indexOf('authdenied') > -1
    || msg.indexOf('未授权') > -1;
}

function persistSelectedLocation(location, locationText) {
  if (!location) return;
  try {
    wx.setStorageSync(STUDENT_SELECTED_LOCATION_KEY, {
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      text: locationText || DEFAULT_LOCATION_TEXT
    });
  } catch (e) {}
}

Page({
  data: {
    list: [],
    page: 1,
    pageSize: 10,
    hasMore: true,
    loading: false,
    locationReady: true,
    location: DEFAULT_LOCATION,
    locationText: DEFAULT_LOCATION_TEXT,
    expectedSalary: '',
    freeTimeSlotsText: ''
  },

  setDefaultLocation() {
    const location = { ...DEFAULT_LOCATION };
    this.setData({
      locationReady: true,
      location,
      locationText: DEFAULT_LOCATION_TEXT
    });
    persistSelectedLocation(location, DEFAULT_LOCATION_TEXT);
  },

  async onLoad() {
    await this.requestLocation();
    this.resetAndLoad();
  },

  onShow() {
    const pages = getCurrentPages();
    const currPage = pages[pages.length - 1];
    if (currPage.data && currPage.data.selectedLocation) {
      const loc = currPage.data.selectedLocation;
      const selectedLocation = buildLocation({
        latitude: loc.latitude,
        longitude: loc.longitude
      }) || { ...DEFAULT_LOCATION };
      this.setData({
        locationReady: true,
        location: selectedLocation,
        locationText: loc.address || loc.name || DEFAULT_LOCATION_TEXT,
        selectedLocation: null
      }, () => {
        persistSelectedLocation(
          selectedLocation,
          loc.address || loc.name || DEFAULT_LOCATION_TEXT
        );
        this.resetAndLoad();
      });
    }
  },

  onPullDownRefresh() {
    this.resetAndLoad().finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    this.loadMore();
  },

  async requestLocation() {
    const app = getApp();
    const globalData = (app && app.globalData) || {};
    const ensureAuthorized = () =>
      new Promise((resolve) => {
        wx.getSetting({
          success: (res) => {
            if (res && res.authSetting && res.authSetting['scope.userLocation']) {
              if (app && app.globalData) {
                app.globalData.locationAuthorized = true;
              }
              resolve({ ok: true });
              return;
            }
            // 推荐页仅触发首次授权弹窗
            if ((globalData.locationPromptCount || 0) >= 1) {
              resolve({ ok: false, reason: 'AUTH_DENIED' });
              return;
            }
            wx.authorize({
              scope: 'scope.userLocation',
              success: () => {
                if (app && app.globalData) {
                  app.globalData.locationAuthorized = true;
                }
                resolve({ ok: true });
              },
              fail: () => resolve({ ok: false, reason: 'AUTH_DENIED' }),
              complete: () => {
                if (app && app.globalData) {
                  app.globalData.locationPromptCount = (app.globalData.locationPromptCount || 0) + 1;
                  app.globalData.locationAuthPrompted = true;
                }
              }
            });
          },
          fail: () => resolve({ ok: false, reason: 'AUTH_DENIED' })
        });
      });

    const authRes = await ensureAuthorized();
    if (!authRes.ok) {
      this.setDefaultLocation();
      await this.guideOpenPermissionSettings();
      return;
    }
    await new Promise((resolve) => {
      wx.getLocation({
        type: 'gcj02',
        isHighAccuracy: true,
        highAccuracyExpireTime: 3000,
        success: (res) => {
          const location = {
            latitude: res.latitude,
            longitude: res.longitude
          };
          this.setData({
            locationReady: true,
            location
          });
          this.resolveLocationText(location);
          persistSelectedLocation(location, this.data.locationText || DEFAULT_LOCATION_TEXT);
          resolve();
        },
        fail: async (err) => {
          this.setDefaultLocation();
          if (isLocationServiceOffError(err)) {
            await this.guideEnableSystemLocationService();
          } else if (isAuthDeniedError(err)) {
            await this.guideOpenPermissionSettings();
          }
          resolve();
        }
      });
    });
  },

  async guideEnableSystemLocationService() {
    const modalRes = await new Promise((resolve) => {
      wx.showModal({
        title: '请打开定位服务',
        content: '检测到手机系统定位服务未开启，请先开启系统定位开关。是否前往系统设置？',
        confirmText: '去设置',
        cancelText: '稍后',
        success: resolve,
        fail: () => resolve({ confirm: false, cancel: true })
      });
    });
    if (!modalRes.confirm) return;
    const canOpenSystemSetting = !!(wx.openSystemSetting && typeof wx.openSystemSetting === 'function');
    if (canOpenSystemSetting) {
      wx.openSystemSetting({
        success: () => {},
        fail: () => {
          wx.showToast({ title: '请手动打开系统定位', icon: 'none' });
        }
      });
      return;
    }
    wx.showToast({ title: '请到系统设置开启定位', icon: 'none' });
  },

  async guideOpenPermissionSettings() {
    const modalRes = await new Promise((resolve) => {
      wx.showModal({
        title: '需要定位权限',
        content: '系统定位已开启，但当前小程序未获定位权限。是否前往权限管理？',
        confirmText: '去设置',
        cancelText: '稍后',
        success: resolve,
        fail: () => resolve({ confirm: false, cancel: true })
      });
    });
    if (!modalRes.confirm) return;
    const canOpenAppAuthorize = !!(wx.openAppAuthorizeSetting && typeof wx.openAppAuthorizeSetting === 'function');
    if (canOpenAppAuthorize) {
      wx.openAppAuthorizeSetting({
        success: () => {},
        fail: () => {
          wx.openSetting({ fail: () => {} });
        }
      });
      return;
    }
    wx.openSetting({ fail: () => {} });
  },

  async resolveLocationText(location) {
    try {
      const result = await this.requestMapApi({
        url: 'https://apis.map.qq.com/ws/geocoder/v1/',
        data: {
          key: QQ_MAP_KEY,
          location: `${location.latitude},${location.longitude}`
        }
      });
      const geocoder = result.result || {};
      const text = (geocoder.formatted_addresses && geocoder.formatted_addresses.recommend)
        || geocoder.address
        || '';
      this.setData({ locationText: text });
      persistSelectedLocation(location, text || DEFAULT_LOCATION_TEXT);
    } catch (e) {
      this.setData({ locationText: DEFAULT_LOCATION_TEXT });
      persistSelectedLocation(location, DEFAULT_LOCATION_TEXT);
    }
  },

  resetAndLoad() {
    return new Promise((resolve) => {
      this.setData(
        {
          list: [],
          page: 1,
          hasMore: true
        },
        async () => {
          await this.loadMore();
          resolve();
        }
      );
    });
  },

  async loadMore() {
    const {
      loading, hasMore, page, pageSize, list, location,
      expectedSalary, freeTimeSlotsText
    } = this.data;
    if (loading || !hasMore) return;
    this.setData({ loading: true });
    const safeLocation = buildLocation(location) || { ...DEFAULT_LOCATION };
    if (safeLocation !== location) {
      this.setData({ location: safeLocation, locationText: this.data.locationText || DEFAULT_LOCATION_TEXT });
    }
    try {
      const res = await call('job', {
        action: 'getRecommendedJobs',
        page,
        pageSize,
        location: safeLocation,
        expectedSalary: expectedSalary ? Number(expectedSalary) : undefined,
        freeTimeSlots: freeTimeSlotsText
          ? freeTimeSlotsText.split(/[，,、|/]/).map((x) => x.trim()).filter(Boolean)
          : undefined
      });
      const data = res.data || {};
      const incoming = (data.list || []).map((item) => ({
        ...item,
        distanceText: formatDistance(item.distanceKm),
        workTimeText: normalizeWorkTime(item.workTime, item.timeDesc),
        tagsText: Array.isArray(item.tags) ? item.tags.slice(0, 3).join(' · ') : ''
      }));
      this.setData({
        list: list.concat(incoming),
        page: page + 1,
        hasMore: !!data.hasMore,
        loading: false
      });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    }
  },

  open(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/student/job-detail?id=${id}` });
  },

  goRecommend() {},

  onExpectedSalaryInput(e) {
    this.setData({ expectedSalary: (e.detail.value || '').trim() });
  },

  onFreeTimeSlotsInput(e) {
    this.setData({ freeTimeSlotsText: (e.detail.value || '').trim() });
  },

  onApplyFilters() {
    this.resetAndLoad();
  },

  onChooseRecommendLocation() {
    const loc = buildLocation(this.data.location) || DEFAULT_LOCATION;
    const name = encodeURIComponent(this.data.locationText || DEFAULT_LOCATION_TEXT);
    wx.navigateTo({
      url: `/pages/location-picker/location-picker?from=recommend&latitude=${loc.latitude}&longitude=${loc.longitude}&name=${name}`
    });
  },

  requestMapApi({ url, data }) {
    return new Promise((resolve, reject) => {
      wx.request({
        url,
        method: 'GET',
        data,
        success: (res) => {
          const body = res.data || {};
          if (res.statusCode !== 200 || body.status !== 0) {
            reject(new Error((body.message || '地图接口请求失败')));
            return;
          }
          resolve(body);
        },
        fail: reject
      });
    });
  }
});
