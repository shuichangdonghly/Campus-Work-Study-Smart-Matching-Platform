const QQ_MAP_KEY = 'BJYBZ-CDXE7-ARRXM-PC7IE-ZXBZH-6FFTM';
const DEFAULT_CENTER = {
  // 使用华中农业大学主校区近似坐标，避免默认文案与地图点位不一致
  latitude: 30.4746,
  longitude: 114.3524,
  title: '武汉市华中农业大学',
  address: '武汉市华中农业大学'
};

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

Page({
  data: {
    loading: false,
    statusBarHeight: 20,
    navBarHeight: 44,
    locationBannerName: '定位中...',
    mapCenterName: '',
    mapCenterAddress: '',
    mapCenterLat: DEFAULT_CENTER.latitude,
    mapCenterLng: DEFAULT_CENTER.longitude,
    mapScale: 16,
    mapIncludePoints: [],
    showUserLocation: false,
    mapMarkers: [],
    selectedPlace: null,
    fromRecommend: false,
    keyword: '',
    suggestions: []
  },

  onLoad(options) {
    this.initNavBar();
    const optionLat = Number(options && options.latitude);
    const optionLng = Number(options && options.longitude);
    const hasOptionCoord = Number.isFinite(optionLat) && Number.isFinite(optionLng);
    if (hasOptionCoord) {
      const optionNameRaw = (options && options.name) || '';
      let optionName = DEFAULT_CENTER.title;
      try {
        optionName = decodeURIComponent(optionNameRaw || '').trim() || DEFAULT_CENTER.title;
      } catch (e) {
        optionName = String(optionNameRaw || '').trim() || DEFAULT_CENTER.title;
      }
      const initialPlace = {
        id: 'from-page',
        title: optionName,
        address: optionName,
        latitude: optionLat,
        longitude: optionLng
      };
      this.setData({ locationBannerName: optionName });
      this.applySelectedPlace(initialPlace, false);
    }
    this.setData({
      fromRecommend: !!(options && options.from === 'recommend')
    });
    this.initLocation();
  },

  onUnload() {
    if (this.keywordTimer) {
      clearTimeout(this.keywordTimer);
      this.keywordTimer = null;
    }
  },

  onKeywordInput(e) {
    const keyword = (e.detail.value || '').trim();
    this.setData({ keyword });
    if (this.keywordTimer) {
      clearTimeout(this.keywordTimer);
    }
    if (!keyword) {
      this.setData({ suggestions: [] });
      return;
    }
    this.keywordTimer = setTimeout(() => {
      this.fetchSuggestions(keyword);
    }, 280);
  },

  async onRelocate() {
    await this.initLocation();
  },

  onTapSuggestion(e) {
    const index = Number(e.currentTarget.dataset.index);
    const place = this.data.suggestions[index];
    if (!place) return;
    this.applySelectedPlace(place);
    this.setData({ suggestions: [] });
  },

  onBack() {
    wx.navigateBack({ delta: 1 });
  },

  onSave() {
    this.confirmSelection();
  },

  onMapRegionChange(e) {
    if (e.type !== 'end') return;
    if (!e.detail || e.detail.causedBy !== 'drag') return;
    // 先预留拖动回调，后续替换百度/腾讯SDK时可复用该入口更新中心点。
  },

  confirmSelection() {
    const place = this.data.selectedPlace;
    if (!place) {
      wx.showToast({ title: '请先选择地点', icon: 'none' });
      return;
    }
    const pages = getCurrentPages();
    const prevPage = pages[pages.length - 2];
    if (prevPage) {
      prevPage.setData({
        selectedLocation: {
          name: place.title,
          address: place.address,
          latitude: place.latitude,
          longitude: place.longitude
        }
      });
    }
    wx.navigateBack({ delta: 1 });
  },

  async initLocation() {
    this.setData({ loading: true, locationBannerName: '定位中...' });
    try {
      const location = await this.getAvailableLocation();
      const reverse = await this.reverseGeocode(location.latitude, location.longitude);
      const formattedAddresses = reverse && (reverse.formatted_addresses || reverse.formattedAddresses) || {};
      const addressComponent = reverse && reverse.address_component || {};
      const title = formattedAddresses.recommend || reverse.address || '当前位置';
      const detail = reverse.address || title;
      const place = {
        id: `current-${Date.now()}`,
        title: '当前位置',
        address: detail,
        latitude: location.latitude,
        longitude: location.longitude
      };
      this.setData({
        showUserLocation: true,
        locationBannerName: addressComponent.street
          ? `${addressComponent.district || ''}${addressComponent.street}`
          : title
      });
      this.applySelectedPlace(place, false);
    } catch (err) {
      const defaultPlace = {
        id: 'fallback-default',
        title: DEFAULT_CENTER.title,
        address: DEFAULT_CENTER.address,
        latitude: DEFAULT_CENTER.latitude,
        longitude: DEFAULT_CENTER.longitude
      };
      this.applySelectedPlace(defaultPlace, false);
      this.setData({
        showUserLocation: false,
        locationBannerName: DEFAULT_CENTER.title,
        mapCenterName: DEFAULT_CENTER.title,
        mapCenterAddress: DEFAULT_CENTER.address,
        mapCenterLat: DEFAULT_CENTER.latitude,
        mapCenterLng: DEFAULT_CENTER.longitude,
        selectedPlace: defaultPlace
      });
      const errMsg = String((err && err.errMsg) || (err && err.message) || '定位失败');
      if (isLocationServiceOffError(err)) {
        await this.guideEnableSystemLocationService();
      } else if (isAuthDeniedError(err)) {
        await this.guideOpenPermissionSettings();
      } else if (errMsg.toLowerCase().indexOf('getlocation:fail') > -1) {
        await this.guideEnableSystemLocationService();
      } else {
        wx.showToast({ title: errMsg.slice(0, 12), icon: 'none' });
      }
    } finally {
      this.setData({ loading: false });
    }
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

  applySelectedPlace(place, showToast = true) {
    this.setData({
      selectedPlace: place,
      mapCenterName: place.title,
      mapCenterAddress: place.address,
      mapCenterLat: place.latitude,
      mapCenterLng: place.longitude,
      mapIncludePoints: [{
        latitude: place.latitude,
        longitude: place.longitude
      }],
      mapMarkers: [{
        id: 1,
        latitude: place.latitude,
        longitude: place.longitude,
        title: place.title,
        width: 24,
        height: 30
      }]
    });
    if (showToast) {
      wx.showToast({ title: '已选中地点', icon: 'none' });
    }
  },

  async fetchSuggestions(keyword) {
    try {
      const region = this.data.locationBannerName || '全国';
      const data = {
        key: QQ_MAP_KEY,
        keyword,
        region
      };
      if (this.data.mapCenterLat && this.data.mapCenterLng) {
        data.location = `${this.data.mapCenterLat},${this.data.mapCenterLng}`;
      }
      const result = await this.request({
        url: 'https://apis.map.qq.com/ws/place/v1/suggestion',
        data
      });
      const list = (result.data || []).slice(0, 10).map((item, index) => ({
        id: `${item.id || item.title || 's'}-${index}`,
        title: item.title || '未命名地点',
        address: item.address || item.province || '暂无详细地址',
        latitude: item.location ? Number(item.location.lat) : 0,
        longitude: item.location ? Number(item.location.lng) : 0
      })).filter(item => item.latitude && item.longitude);
      this.setData({ suggestions: list });
    } catch (err) {
      this.setData({ suggestions: [] });
    }
  },

  async getAvailableLocation() {
    // 统一采用精确定位；失败时由上层使用默认中心点兜底。
    if (wx.canIUse('getLocation')) {
      const authorized = await this.ensureLocationAuth();
      if (!authorized) {
        throw new Error('AUTH_DENIED');
      }
      return this.getLocation();
    }
    throw new Error('当前基础库不支持定位');
  },

  ensureLocationAuth() {
    return new Promise((resolve) => {
      const app = getApp();
      const globalData = (app && app.globalData) || {};
      if (globalData.locationAuthorized) {
        resolve(true);
        return;
      }
      wx.getSetting({
        success: (res) => {
          if (res && res.authSetting && res.authSetting['scope.userLocation']) {
            if (app && app.globalData) app.globalData.locationAuthorized = true;
            resolve(true);
            return;
          }
          const promptCount = globalData.locationPromptCount || 0;
          const fromRecommend = !!this.data.fromRecommend;
          // 推荐链路规则：
          // - 推荐页已弹过1次且拒绝 -> 地图页允许第2次
          // - 第2次后（不论同意与否）本次登录不再弹
          // 其他入口默认最多弹1次
          const canPrompt = fromRecommend ? promptCount < 2 : promptCount < 1;
          if (!canPrompt) {
            resolve(false);
            return;
          }
          if (app && app.globalData) {
            app.globalData.locationAuthPrompted = true;
          }
          const canAuthorize = wx.canIUse && wx.canIUse('authorize');
          if (!canAuthorize) {
            resolve(false);
            return;
          }
          wx.authorize({
            scope: 'scope.userLocation',
            success: () => {
              if (app && app.globalData) app.globalData.locationAuthorized = true;
              resolve(true);
            },
            fail: () => resolve(false),
            complete: () => {
              if (app && app.globalData) {
                app.globalData.locationPromptCount = (app.globalData.locationPromptCount || 0) + 1;
              }
            }
          });
        },
        fail: () => resolve(false)
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

  getLocation() {
    return new Promise((resolve, reject) => {
      wx.getLocation({
        // 微信地图组件使用 gcj02 坐标系，使用 wgs84 会出现明显偏移
        type: 'gcj02',
        isHighAccuracy: true,
        highAccuracyExpireTime: 3000,
        success: resolve,
        fail: reject
      });
    });
  },

  initNavBar() {
    const systemInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const statusBarHeight = systemInfo.statusBarHeight || 20;
    let navBarHeight = 44;
    try {
      const menuRect = wx.getMenuButtonBoundingClientRect();
      navBarHeight = (menuRect.bottom - menuRect.top) + (menuRect.top - statusBarHeight) * 2;
    } catch (e) {
      navBarHeight = 44;
    }
    this.setData({
      statusBarHeight,
      navBarHeight
    });
  },

  reverseGeocode(latitude, longitude) {
    return this.request({
      url: 'https://apis.map.qq.com/ws/geocoder/v1/',
      data: {
        key: QQ_MAP_KEY,
        location: `${latitude},${longitude}`,
        get_poi: 1
      }
    }).then(res => res.result);
  },

  request({ url, data }) {
    return new Promise((resolve, reject) => {
      wx.request({
        url,
        method: 'GET',
        data,
        success: (res) => {
          const body = res.data || {};
          if (res.statusCode !== 200 || body.status !== 0) {
            reject(new Error((body.message || body.msg || '请求失败')));
            return;
          }
          resolve(body);
        },
        fail: reject
      });
    });
  }
});